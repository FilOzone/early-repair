import * as Piece from '@filoz/synapse-core/piece'
import { type PullPieceInput, waitForPullPieces } from '@filoz/synapse-core/sp'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { queueAsPromised } from 'fastq'
import fastq from 'fastq'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import type { AddPieceOperationData, SelectOperation } from '../local-schema.ts'
import { type Group, type LocalDatabase, type LocalSchema, PIECE_GROUPS, type WalletClient } from '../types.ts'

/** Pending `add_piece` operations batched for a single pull job (same repair group). */
export type PullPiecesBatch = {
  group: Group
  operations: SelectOperation[]
}

export type RunPullPiecesPhaseOptions = {
  localDb: LocalDatabase
  localSchema: LocalSchema
  repairId: number
  concurrency: number
  batchSize: number
  client: WalletClient
}

/** Mock pull worker: logs each batch and its piece CIDs. */
export function createPullPiecesWorker({
  localDb,
  localSchema,
  repairId,
  client,
}: {
  localDb: LocalDatabase
  localSchema: LocalSchema
  repairId: number
  client: WalletClient
}) {
  return async (batch: PullPiecesBatch) => {
    try {
      const dataset = await getTargetDataset({ localDb, localSchema, repairId, group: batch.group, client })

      const pullPieces: PullPieceInput[] = []
      for (const operation of batch.operations) {
        const data = operation.data as AddPieceOperationData
        const pieceCid = Piece.parse(data.cid)

        for (const alternateProvider of data.alternateProviders) {
          const sourceUrl = new URL(`/piece/${pieceCid.toString()}`, alternateProvider).toString()
          pullPieces.push({ pieceCid, sourceUrl, metadata: data.metadata })
        }
      }
      const pullResult = await waitForPullPieces(client, {
        serviceURL: batch.operations[0].data.serviceUrl,
        dataSetId: dataset.dataSetId,
        clientDataSetId: dataset.clientDataSetId,
        pieces: pullPieces,
      })
      console.log('pullResult', pullResult)
      // console.log('pieces', pieces)
      // console.log(`Pulling ${pieces.length} piece(s) [${batch.group}] from dataset ${dataset.clientDataSetId}:`)
      // await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Unknown error')
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
  localSchema,
  repairId,
  concurrency,
  batchSize,
  client,
}: RunPullPiecesPhaseOptions): Promise<void> {
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
          eq(localSchema.operations.repairId, repairId),
          eq(localSchema.operations.type, 'add_piece'),
          eq(localSchema.operations.status, 'pending'),
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

  const pullPiecesWorker = createPullPiecesWorker({ localDb, localSchema, repairId, client })
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
