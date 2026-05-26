import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import type { queueAsPromised } from 'fastq'
import fastq from 'fastq'
import { filterPiecesNotInDataset } from '../db/filter-pull-pieces-not-in-dataset.ts'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import { updateOperation } from '../db/update-operation.ts'
import { upsertOperations } from '../db/upsert-operations.ts'
import type { AddPieceOperationData, SelectOperation, SelectRepair } from '../local-schema.ts'
import type { IndexerDatabase } from '../types.ts'
import { type Group, type LocalDatabase, PIECE_GROUPS, type WalletClient } from '../types.ts'

/** Pending `add_piece` operations batched for a single pull job (same repair group). */
export type PullPiecesBatch = {
  group: Group
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
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, group: batch.group, client })
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
        onStatus: (status) => {
          console.log(`Pull status: ${JSON.stringify(status)}`)
        },
      })

      if (pullResult.status === 'complete') {
        // log failed pieces
        for (const { pieceCid, status } of pullResult.pieces) {
          const operationId = batch.operations.find(
            (operation) => (operation.data as AddPieceOperationData).cid === pieceCid.toString()
          )?.id
          if (status === 'failed' && operationId) {
            console.log(`Operation ${operationId} failed`)
            await updateOperation({
              localDb,
              operationId,
              status: 'failed',
              error: `Piece ${pieceCid} failed to pull`,
            })
          }
        }

        // prepare operations for commit
        const pulledPieces = pullResult.pieces.filter(({ status }) => status === 'complete')
        const notInDatasetCids = await filterPiecesNotInDataset({
          indexerDb,
          dataSetId: dataset.dataSetId,
          cids: pulledPieces.map(({ pieceCid }) => pieceCid.toString()),
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
      } else {
        await upsertOperations({
          localDb,
          operations: batch.operations.map((operation) => ({
            ...operation,
            status: 'failed',
            error: `Failed to pull pieces`,
          })),
        })
      }
    } catch (error) {
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
 * Each query returns one same-group batch, and the producer only fetches more work when
 * a fastq worker completes. Failed piece operations are intentionally skipped.
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
  const pullGroupCursors = Object.fromEntries(PIECE_GROUPS.map((group) => [group, 0])) as Record<Group, number>
  const exhaustedPullGroups = new Set<Group>()
  let nextPullGroupIndex = 0

  async function getNextPullBatch(): Promise<PullPiecesBatch | null> {
    for (let attempts = 0; attempts < PIECE_GROUPS.length; attempts++) {
      const group = PIECE_GROUPS[nextPullGroupIndex]
      nextPullGroupIndex = (nextPullGroupIndex + 1) % PIECE_GROUPS.length
      if (exhaustedPullGroups.has(group)) continue

      const operations = await localDb.query.operations.findMany({
        where: and(
          eq(localSchema.operations.repairId, repair.id),
          eq(localSchema.operations.type, 'add_piece'),
          inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending']),
          eq(localSchema.operations.group, group),
          gt(localSchema.operations.id, pullGroupCursors[group])
        ),
        orderBy: [asc(localSchema.operations.id)],
        limit: pullBatchSize,
      })
      if (operations.length === 0) {
        exhaustedPullGroups.add(group)
        continue
      }

      pullGroupCursors[group] = operations.at(-1)?.id ?? pullGroupCursors[group]
      return { group, operations }
    }
    return null
  }

  const pullPiecesWorker = createPullPiecesWorker({ localDb, indexerDb, repair, client })
  const pullPiecesQueue: queueAsPromised<PullPiecesBatch> = fastq.promise(pullPiecesWorker, pullConcurrency)
  const pendingPulls = new Set<Promise<void>>()

  async function enqueueNextPullBatch(): Promise<boolean> {
    const batch = await getNextPullBatch()
    if (!batch) return false

    let task: Promise<void>
    task = pullPiecesQueue
      .push(batch)
      .catch(console.error)
      .finally(() => {
        pendingPulls.delete(task)
      })
    pendingPulls.add(task)
    return true
  }

  async function fillPullQueue(): Promise<void> {
    let queued = true
    while (pendingPulls.size < pullConcurrency && queued) {
      queued = await enqueueNextPullBatch()
    }
  }

  await fillPullQueue()
  while (pendingPulls.size > 0) {
    await Promise.race(pendingPulls)
    await fillPullQueue()
  }

  await pullPiecesQueue.drained()
}
