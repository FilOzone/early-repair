import { taskLog } from '@clack/prompts'
import * as Piece from '@filoz/synapse-core/piece'
import { createPieceUrlPDP } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import PQueue from 'p-queue'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import { syncPiecesOnchain } from '../db/sync-pieces-onchain.ts'
import { updateOperation } from '../db/update-operation.ts'
import { upsertOperations } from '../db/upsert-operations.ts'
import type { OperationSelect, RepairSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'
import { hashLink } from '../utils.ts'

/** Pending `add_piece` operations batched for a single pull job. */
export type PullPiecesBatch = {
  operations: OperationSelect[]
}

export type RunPullPiecesPhaseOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  repair: RepairSelect
  concurrency: number
  batchSize: number
  client: WalletClient
  reset: boolean
}

/** Mock pull worker: logs each batch and its piece CIDs. */
export function createPullPiecesWorker({
  localDb,
  indexerDb,
  repair,
  client,
  state,
  log,
}: {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  repair: RepairSelect
  client: WalletClient
  state: {
    totalBatches: number
    totalOperations: number
    completedOperations: number
    failedOperations: number
  }
  log: ReturnType<typeof taskLog>
}) {
  return async (batch: PullPiecesBatch, batchNumber: number) => {
    let completedCids = 0
    let failedCids = 0
    const cidToOperation = new Map<string, OperationSelect>()

    const spin = log.group(`Batch ${batchNumber}/${state.totalBatches}`)
    spin.message(`Pull 0 completed, 0 failed`)

    try {
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, client })

      for (const operation of batch.operations) {
        cidToOperation.set(operation.cid, operation)
      }

      // sync pieces onchain to avoid duplicates
      const completedOperations1 = await syncPiecesOnchain({
        indexerDb,
        localDb,
        dataSetId: dataset.dataSetId,
        cidToOperation,
      })
      state.completedOperations += completedOperations1
      completedCids += completedOperations1

      // create pull pieces
      const pullPieces: SP.PullPieceInput[] = []
      for (const [cid, operation] of cidToOperation) {
        const pieceCid = Piece.from(cid)
        const sourceUrl = createPieceUrlPDP({
          cid,
          serviceURL: operation.alternateProvider,
        })
        pullPieces.push({ pieceCid, sourceUrl })
      }

      if (pullPieces.length > 0) {
        // wait for pull pieces
        const pullResult = await SP.waitForPullPieces(client, {
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: pullPieces,
          timeout: 1000 * 60 * 30,
          onStatus: (_status) => {
            const completed = _status.pieces.filter((piece) => piece.status === 'complete').length
            const failed = _status.pieces.filter((piece) => piece.status === 'failed').length
            spin.message(`Pull ${completed} completed, ${failed} failed`)
          },
        })

        for (const { pieceCid, status } of pullResult.pieces) {
          const cid = pieceCid.toString()
          const operation = cidToOperation.get(cid)
          if (!operation) {
            console.log(`operation not found for cid ${cid}`)
            continue
          }

          if (status !== 'complete') {
            state.failedOperations++
            failedCids++
            cidToOperation.delete(cid)
            await updateOperation({
              localDb,
              operationId: operation.id,
              status: 'failed',
              error: `pull failed with status ${status}`,
            })
          }
        }
      }

      // sync against indexer to avoid duplicates
      const completedOperations2 = await syncPiecesOnchain({
        indexerDb,
        localDb,
        dataSetId: dataset.dataSetId,
        cidToOperation,
      })
      state.completedOperations += completedOperations2
      completedCids += completedOperations2

      const commitPieces: SP.addPieces.PieceType[] = []
      for (const [cid] of cidToOperation) {
        commitPieces.push({
          pieceCid: Piece.from(cid),
        })
      }

      if (commitPieces.length > 0) {
        const addPiecesResult = await SP.addPieces(client, {
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: commitPieces,
        })

        spin.message(`Waiting for add pieces ${hashLink(addPiecesResult.txHash, client.chain)}...`)
        const addPiecesResult2 = await SP.waitForAddPieces(addPiecesResult)
        state.completedOperations += cidToOperation.size
        completedCids += cidToOperation.size
        await upsertOperations({
          localDb,
          operations: Array.from(cidToOperation.values()).map((operation) => ({
            ...operation,
            status: 'completed',
            error: null,
            result: { dataSetId: addPiecesResult2.dataSetId, txHash: addPiecesResult2.txHash },
          })),
        })
      }
      spin.success(`Batch ${batchNumber}/${state.totalBatches} ${completedCids} added, ${failedCids} failed`)
    } catch (error) {
      state.failedOperations += cidToOperation.size
      const message = error instanceof Error ? error.message : 'Unknown error'
      spin.error(`Batch ${batchNumber}/${state.totalBatches} - ${message.replace(/\n/g, ' ')}`)
      await upsertOperations({
        localDb,
        operations: Array.from(cidToOperation.values()).map((operation) => ({
          ...operation,
          status: 'failed',
          error: message,
        })),
      })
    }
  }
}

/**
 * Pull pending `add_piece` operations without loading the whole repair into memory.
 *
 * Pending piece operations are fetched lazily and queued with bounded backpressure. Failed piece
 * operations are intentionally skipped unless `reset` is set.
 */
export async function runPullPiecesPhase({
  localDb,
  indexerDb,
  repair,
  concurrency,
  batchSize,
  client,
  reset,
}: RunPullPiecesPhaseOptions): Promise<void> {
  const localSchema = localDb._.fullSchema
  const pullConcurrency = Math.max(1, concurrency)
  const pullBatchSize = Math.max(1, batchSize)
  let pullCursor = 0

  const totalOperations = await localDb.$count(
    localSchema.operations,
    and(
      eq(localSchema.operations.repairId, repair.id),
      eq(localSchema.operations.type, 'add_piece'),
      inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending'])
    )
  )
  let batchNumber = 0
  const state = {
    totalBatches: Math.ceil(totalOperations / pullBatchSize),
    totalOperations,
    completedOperations: 0,
    failedOperations: 0,
  }

  const log = taskLog({
    title: 'Pulling pieces',
    limit: 1,
  })

  async function getNextPullBatch(): Promise<PullPiecesBatch | null> {
    const operations = await localDb.query.operations.findMany({
      where: and(
        eq(localSchema.operations.repairId, repair.id),
        eq(localSchema.operations.type, 'add_piece'),
        inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending']),
        gt(localSchema.operations.id, pullCursor)
      ),
      orderBy: [asc(localSchema.operations.id)],
      limit: pullBatchSize,
    })
    if (operations.length === 0) {
      return null
    }

    pullCursor = operations.at(-1)?.id ?? pullCursor
    return { operations }
  }

  const pullPiecesWorker = createPullPiecesWorker({ localDb, indexerDb, repair, client, state, log })
  const pullPiecesQueue = new PQueue({ concurrency: pullConcurrency })

  while (true) {
    await pullPiecesQueue.onSizeLessThan(pullConcurrency)
    const batch = await getNextPullBatch()
    if (!batch) break
    batchNumber++
    const currentBatchNumber = batchNumber
    pullPiecesQueue.add(() => pullPiecesWorker(batch, currentBatchNumber)).catch(console.error)
  }

  await pullPiecesQueue.onIdle()

  log.success(`Pulled ${state.completedOperations} pieces, ${state.failedOperations} failed`)
}
