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
}: {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  repair: SelectRepair
  client: WalletClient
}) {
  return async (batch: PullPiecesBatch) => {
    try {
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, client })
      // create pull pieces
      const pullPieces: SP.PullPieceInput[] = []
      for (const operation of batch.operations) {
        const data = operation.data as AddPieceOperationData
        const pieceCid = Piece.parse(data.cid)
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
          // console.log(`${JSON.stringify(_status)}`)
        },
      })

      // console.log('🚀 ~ createPullPiecesWorker ~ pullResult:', pullResult.pieces)

      const completedCids = []

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

      // prepare operations for commit
      const notInDatasetCids = await filterPiecesNotInDataset({
        indexerDb,
        dataSetId: dataset.dataSetId,
        cids: completedCids,
      })
      const commitPieces: SP.addPieces.PieceType[] = []
      for (const cid of notInDatasetCids) {
        commitPieces.push({
          pieceCid: Piece.parse(cid),
          metadata: pullPieces.find(({ pieceCid }) => pieceCid.toString() === cid)?.metadata,
        })
      }
      console.log(`Pulled ${commitPieces.length} pieces in dataset ${dataset.dataSetId}`)
      // console.log(commitPieces)
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Unknown error')
      await upsertOperations({
        localDb,
        operations: batch.operations.map((operation) => ({
          ...operation,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
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

  const pullPiecesWorker = createPullPiecesWorker({ localDb, indexerDb, repair, client })
  const pullPiecesQueue = new PQueue({ concurrency: pullConcurrency })

  while (true) {
    await pullPiecesQueue.onSizeLessThan(pullConcurrency)
    const batch = await getNextPullBatch()
    if (!batch) break
    pullPiecesQueue.add(() => pullPiecesWorker(batch)).catch(console.error)
  }

  await pullPiecesQueue.onIdle()
}
