import { taskLog } from '@clack/prompts'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import PQueue from 'p-queue'
import { filterPiecesNotInDataset } from '../db/filter-pull-pieces-not-in-dataset.ts'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import { updateOperation } from '../db/update-operation.ts'
import { upsertOperations } from '../db/upsert-operations.ts'

import type { AddPieceOperationData, SelectOperation, SelectRepair } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'

/** Pending `add_piece` operations batched for a single pull job. */
export type PullPiecesBatch = {
  operations: SelectOperation[]
}

export type RunPullPiecesPhaseOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  repair: SelectRepair
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
  repair: SelectRepair
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
    const spin = log.group(`Batch ${batchNumber}/${state.totalBatches}`)
    spin.message(`Pull 0 completed, 0 failed`)
    try {
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, client })
      // create pull pieces
      const pullPieces: SP.PullPieceInput[] = []
      for (const operation of batch.operations) {
        const data = operation.data as AddPieceOperationData
        const pieceCid = Piece.from(data.cid)
        const sourceUrl = new URL(`/piece/${pieceCid.toString()}`, data.alternateProviders[0]).toString()
        pullPieces.push({ pieceCid, sourceUrl, metadata: data.metadata })
      }

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

      const completedCids = []
      const failedCids = []

      for (const { pieceCid, status } of pullResult.pieces) {
        const operation = batch.operations.find(
          (operation) => (operation.data as AddPieceOperationData).cid === pieceCid.toString()
        )
        const data = operation?.data as AddPieceOperationData

        switch (status) {
          case 'complete': {
            completedCids.push(pieceCid)
            if (operation) {
              await updateOperation({
                localDb,
                operationId: operation.id,
                status: 'pending',
                error: null,
              })
            }
            break
          }
          case 'failed': {
            if (operation) {
              failedCids.push(pieceCid)
              console.log(`cid ${pieceCid} failed to pull from ${data.alternateProviders[0]}`)
              await updateOperation({
                localDb,
                operationId: operation.id,
                status: 'failed',
                error: `failed to pull from ${data.alternateProviders[0]}`,
              })
            }
            break
          }
          default: {
            console.log(`Piece ${pieceCid} status: ${status}`)
            break
          }
        }
      }
      state.completedOperations += completedCids.length
      state.failedOperations += failedCids.length

      // prepare operations for commit
      const notInDatasetCids = await filterPiecesNotInDataset({
        indexerDb,
        dataSetId: dataset.dataSetId,
        cids: completedCids,
      })
      const commitPieces: SP.addPieces.PieceType[] = []
      for (const cid of notInDatasetCids) {
        commitPieces.push({
          pieceCid: Piece.from(cid),
          metadata: pullPieces.find(({ pieceCid }) => pieceCid.toString() === cid)?.metadata,
        })
      }
      spin.success(
        `Batch ${batchNumber}/${state.totalBatches} ${completedCids.length} completed, ${failedCids.length} failed`
      )
      // console.log(commitPieces)
    } catch (error) {
      state.failedOperations += batch.operations.length
      const message = error instanceof Error ? error.message : 'Unknown error'
      spin.error(`Batch ${batchNumber}/${state.totalBatches} - ${message.replace(/\n/g, ' ')}`)
      await upsertOperations({
        localDb,
        operations: batch.operations.map((operation) => ({
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
