import { taskLog } from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
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
 * Create a worker function that adds pieces to the target repair dataset.
 */
function createAddPiecesWorker({ localDb, targetCids, repair, client, state, log }: CreateAddPiecesWorkerOptions) {
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
      // pull pieces
      if (operations.length > 0) {
        const pullResult = await SP.waitForPullPieces(client, {
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: operationsToPullPieces(operations),
          onStatus: (status) => {
            const completed = status.pieces.filter((piece) => piece.status === 'complete').length
            const failed = status.pieces.filter((piece) => piece.status === 'failed').length
            group.message(`Pull ${completed} completed, ${failed} failed`)
          },
        })

        for (const { pieceCid, status } of pullResult.pieces) {
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

  const addPiecesJob = createAddPiecesWorker({ localDb, targetCids, repair, client, state, log })
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
