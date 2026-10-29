import { taskLog } from '@clack/prompts'
import { PullError } from '@filoz/synapse-core/errors'
import * as SP from '@filoz/synapse-core/sp'
import { signAddPieces } from '@filoz/synapse-core/typed-data'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import PQueue from 'p-queue'
import { listDataSetPieces } from '../api.ts'
import { dedupeCids } from '../db/dedupe-cids.ts'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import { repairUpdate } from '../db/repair-update.ts'
import { upsertOperations } from '../db/upsert-operations.ts'
import type { OperationSelect, RepairSelect } from '../local-schema.ts'
import type { IndexerApi, LocalDatabase, WalletClient } from '../types.ts'
import {
  completeConfirmedOperations,
  excludeOperationsByCid,
  fitAddPiecesBatch,
  hashLink,
  operationsToAddPieces,
  operationsToPullPieces,
} from '../utils.ts'

/** Operations read per batch before fitting; above the ~400 metadata-free pieces one addPieces message holds. */
const MAX_BATCH_CANDIDATES = 500

/**
 * Curio admits at most 108 unique pieces per pull request and 108 pending pulled pieces per client.
 *
 * @see https://github.com/filecoin-project/curio/blob/main/pdp/pull_types.go
 */
const MAX_PULL_PIECES = 108

/**
 * Other clients' pending pieces lower our per-client limit, but never below 10.
 * Pulls this small are refused only when the whole node is full.
 */
const MIN_PULL_PIECES = 10

/** Curio answers 429 with Retry-After (1-5 minutes) while its pull queue is full; wait it out instead of failing. */
const PULL_RETRY_COUNT = 10

/** Curio's 429 body when a pull would exceed its pending-piece limits. */
function isPullBackpressure(error: unknown) {
  return PullError.is(error) && error.details?.includes('pull queue backpressure') === true
}

export type RunPullPiecesPhaseOptions = {
  localDb: LocalDatabase
  api: IndexerApi
  repair: RepairSelect
  concurrency: number
  /** Max pieces per batch. Defaults to as many as fit in one addPieces message. */
  batchSize?: number
  client: WalletClient
}

type CreateAddPiecesWorkerOptions = {
  localDb: LocalDatabase
  /** CIDs already in the target dataset; repairs only. Updated as batches are added. */
  targetCids?: Set<string>
  /** Max unique pieces per pull request, shared by all workers and lowered when Curio pushes back. */
  pullChunk: { size: number }
  repair: RepairSelect
  client: WalletClient
  state: {
    totalOperations: number
    completedOperations: number
    failedOperations: number
  }
  log: ReturnType<typeof taskLog>
}

type AddPiecesJobOptions = {
  operations: OperationSelect[]
  batchNumber: number
}

/**
 * Pull pieces in chunks Curio admits, one chunk at a time.
 * When Curio refuses a chunk for backpressure, halve `pullChunk.size` (shared with other workers) and try again.
 */
export async function pullInChunks({
  client,
  serviceURL,
  dataSetId,
  clientDataSetId,
  pieces: pullPieces,
  pullChunk,
  onMessage,
}: {
  client: WalletClient
  serviceURL: string
  dataSetId: bigint
  clientDataSetId: bigint
  pieces: SP.PullPieceInput[]
  pullChunk: { size: number }
  onMessage: (message: string) => void
}): Promise<SP.pullPieces.ReturnType['pieces']> {
  const results: SP.pullPieces.ReturnType['pieces'] = []
  let offset = 0
  while (offset < pullPieces.length) {
    const pieces = pullPieces.slice(offset, offset + pullChunk.size)
    // Sign once so the admission check and the wait below share one pull.
    const extraData = await signAddPieces(client, {
      clientDataSetId,
      pieces: pieces.map(({ pieceCid }) => ({ pieceCid })),
    })

    // Another client's pending pull lowers our limit; shrink the chunk instead of waiting on the same size.
    if (pullChunk.size > MIN_PULL_PIECES) {
      try {
        // Single POST: the SDK's own retries would wait out Retry-After on the same size.
        await SP.pullPiecesApiRequest({
          serviceURL,
          recordKeeper: client.chain.contracts.fwss.address,
          extraData,
          dataSetId,
          pieces: pieces.map(({ pieceCid, sourceUrl }) => ({ pieceCid: pieceCid.toString(), sourceUrl })),
          retryCount: 0,
        })
      } catch (error) {
        if (isPullBackpressure(error)) {
          pullChunk.size = Math.max(MIN_PULL_PIECES, Math.floor(Math.min(pullChunk.size, pieces.length) / 2))
          onMessage(`Curio pull queue is busy, pulling ${pullChunk.size} pieces at a time`)
          continue
        }
        // Leave other errors to the retries in waitForPullPieces.
      }
    }

    const pullResult = await SP.waitForPullPieces(client, {
      serviceURL,
      dataSetId,
      clientDataSetId,
      pieces,
      extraData,
      retryCount: PULL_RETRY_COUNT,
      onStatus: (status) => {
        const completed = status.pieces.filter((piece) => piece.status === 'complete').length
        const failed = status.pieces.filter((piece) => piece.status === 'failed').length
        onMessage(
          `Pulling pieces ${offset + 1}-${offset + pieces.length} of ${pullPieces.length}: ${completed} completed, ${failed} failed`
        )
      },
    })
    results.push(...pullResult.pieces)
    offset += pieces.length
  }
  return results
}

/**
 * Create a worker function that adds pieces to the target repair dataset.
 */
function createAddPiecesWorker({
  localDb,
  targetCids,
  pullChunk,
  repair,
  client,
  state,
  log,
}: CreateAddPiecesWorkerOptions) {
  return async (options: AddPiecesJobOptions) => {
    let completedOps = 0
    let failedOps = 0
    let operations: OperationSelect[] = options.operations

    const group = log.group(`Batch ${options.batchNumber} (${options.operations.length} pieces)`)

    try {
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, client })

      // dedupe operations by CID on the target dataset for repairs jobs
      if (targetCids) {
        operations = await dedupeCids({ localDb, existingCids: targetCids, operations })
      }
      // A previous run may have submitted a transaction and crashed before marking rows completed.
      const operationsBeforeConfirmationCheck = operations.length
      operations = await completeConfirmedOperations({ localDb, client, operations })
      const confirmedOperations = operationsBeforeConfirmationCheck - operations.length
      if (confirmedOperations > 0) {
        state.completedOperations += confirmedOperations
        completedOps += confirmedOperations
      }

      group.message(`Pulling ${operations.length} pieces...`)
      // pull pieces in chunks that Curio admits, one chunk at a time per worker
      if (operations.length > 0) {
        const pullResult = await pullInChunks({
          client,
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: operationsToPullPieces(operations),
          pullChunk,
          onMessage: (message) => group.message(message),
        })

        for (const { pieceCid, status } of pullResult) {
          const cid = pieceCid.toString()
          if (status !== 'complete') {
            state.failedOperations++
            failedOps++
            const { operationToFailed, operationToCommit } = excludeOperationsByCid(operations, cid)
            operations = operationToCommit
            await upsertOperations({
              localDb,
              operations: operationToFailed.map((operation) => ({
                ...operation,
                status: 'failed',
                error: `pull failed with status ${status}`,
              })),
            })
          }
        }
      }

      // add pieces
      if (operations.length > 0) {
        group.message(`Adding ${operations.length} pieces...`)
        const addPiecesResult = await SP.addPieces(client, {
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: operationsToAddPieces(operations, !targetCids),
        })
        await upsertOperations({
          localDb,
          operations: operations.map((operation) => ({
            ...operation,
            txHash: addPiecesResult.txHash,
          })),
        })

        group.message(`Waiting for add pieces ${hashLink(addPiecesResult.txHash, client.chain)}...`)
        const waitForAddPieces = await SP.waitForAddPieces(addPiecesResult)
        // Curio may replace the message by fee; record the hash that landed on chain.
        const confirmedTxHash = waitForAddPieces.confirmedTxHash ?? waitForAddPieces.txHash
        state.completedOperations += operations.length
        completedOps += operations.length
        for (const operation of operations) targetCids?.add(operation.cid)
        await upsertOperations({
          localDb,
          operations: operations.map((operation) => ({
            ...operation,
            status: 'completed',
            error: null,
            txHash: confirmedTxHash,
          })),
        })
      }
      group.message(`Done. ${completedOps} added, ${failedOps} failed`)
    } catch (error) {
      state.failedOperations += operations.length
      const message = error instanceof Error ? error.message : 'Unknown error'
      group.message(`${message.replace(/\n/g, ' ')}`)
      await upsertOperations({
        localDb,
        operations: operations.map((operation) => ({
          ...operation,
          status: 'failed',
          error: message,
        })),
      })
    }
  }
}

/**
 * Add pieces to the target dataset.
 */
export async function runAddPieces({
  localDb,
  api,
  repair,
  concurrency,
  batchSize,
  client,
}: RunPullPiecesPhaseOptions): Promise<void> {
  const localSchema = localDb._.fullSchema
  let cursor = 0

  const totalOperations = await localDb.$count(
    localSchema.operations,
    and(
      eq(localSchema.operations.repairId, repair.id),
      eq(localSchema.operations.type, 'add_piece'),
      inArray(localSchema.operations.status, ['pending', 'failed'])
    )
  )
  let batchNumber = 0
  const state = {
    totalOperations,
    completedOperations: 0,
    failedOperations: 0,
  }

  const log = taskLog({
    title: 'Adding pieces',
    limit: 1,
  })

  const dataset = totalOperations > 0 ? await getTargetDataset({ localDb, repairId: repair.id, client }) : undefined

  // Repairs and second copies dedupe into one shared dataset; read its CIDs once instead of per batch.
  let targetCids: Set<string> | undefined
  if (repair.repairDataSetId == null && dataset) {
    const pieces = await listDataSetPieces(api, dataset.dataSetId, { removed: false })
    targetCids = new Set(pieces.flatMap((piece) => (piece.cid == null ? [] : [piece.cid])))
  }

  async function getNextBatch(): Promise<OperationSelect[] | null> {
    if (!dataset) {
      return null
    }
    const candidates = await localDb.query.operations.findMany({
      where: and(
        eq(localSchema.operations.repairId, repair.id),
        eq(localSchema.operations.type, 'add_piece'),
        inArray(localSchema.operations.status, ['pending', 'failed']),
        gt(localSchema.operations.id, cursor)
      ),
      orderBy: [asc(localSchema.operations.id)],
      limit: batchSize ?? MAX_BATCH_CANDIDATES,
    })
    if (candidates.length === 0) {
      return null
    }

    // Size the batch by what fits in one addPieces message rather than a fixed piece count.
    const operations = fitAddPiecesBatch({
      operations: candidates,
      dataSetId: dataset.dataSetId,
      chain: client.chain,
      withMetadata: !targetCids,
    })

    cursor = operations.at(-1)?.id ?? cursor
    return operations
  }

  // Keep pieces pulling across all workers within Curio's per-client limit.
  const pullChunk = { size: Math.max(1, Math.floor(MAX_PULL_PIECES / concurrency)) }
  const addPiecesJob = createAddPiecesWorker({ localDb, targetCids, pullChunk, repair, client, state, log })
  const queue = new PQueue({ concurrency })

  while (true) {
    await queue.onSizeLessThan(concurrency)
    const operations = await getNextBatch()
    if (!operations) break
    batchNumber++
    const currentBatchNumber = batchNumber
    queue.add(() => addPiecesJob({ operations, batchNumber: currentBatchNumber })).catch(console.error)
  }

  await queue.onIdle()

  log.success(`Added ${state.completedOperations} pieces, ${state.failedOperations} failed`, { showLog: true })

  await repairUpdate({
    localDb,
    repairId: repair.id,
    status: state.failedOperations > 0 ? 'failed' : 'completed',
  })
}
