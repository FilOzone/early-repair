import { taskLog } from '@clack/prompts'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import PQueue from 'p-queue'
import { dedupeCids } from '../db/dedupe-cids.ts'
import { getTargetDataset } from '../db/get-target-dataset.ts'
import { repairUpdate } from '../db/repair-update.ts'
import { upsertOperations } from '../db/upsert-operations.ts'
import type { OperationSelect, RepairSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'
import { excludeOperationsByCid, hashLink, operationsToPullPieces } from '../utils.ts'

export type RunPullPiecesPhaseOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  repair: RepairSelect
  concurrency: number
  batchSize: number
  client: WalletClient
}

type CreateAddPiecesWorkerOptions = {
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
}

type AddPiecesJobOptions = {
  operations: OperationSelect[]
  batchNumber: number
}

/**
 * Create a worker function that adds pieces to the target repair dataset.
 */
function createAddPiecesWorker({ localDb, indexerDb, repair, client, state, log }: CreateAddPiecesWorkerOptions) {
  return async (options: AddPiecesJobOptions) => {
    let completedOps = 0
    let failedOps = 0
    let operations: OperationSelect[] = options.operations
    const isRepair = repair.repairDataSetId == null

    const group = log.group(`Batch ${options.batchNumber}/${state.totalBatches}`)

    try {
      const dataset = await getTargetDataset({ localDb, repairId: repair.id, client })

      // dedupe operations by CID on the target dataset for repairs jobs
      if (isRepair) {
        operations = await dedupeCids({ indexerDb, localDb, dataSetId: dataset.dataSetId, operations })
      }
      group.message(`Pulling ${operations.length} pieces...`)
      // pull pieces
      if (operations.length > 0) {
        const pullResult = await SP.waitForPullPieces(client, {
          serviceURL: repair.targetProviderUrl,
          dataSetId: dataset.dataSetId,
          clientDataSetId: dataset.clientDataSetId,
          pieces: operationsToPullPieces(operations),
          timeout: 1000 * 60 * 30,
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
          pieces: operations.map((operation) => ({
            pieceCid: Piece.from(operation.cid),
            metadata: isRepair ? undefined : operation.metadata,
          })),
        })

        group.message(`Waiting for add pieces ${hashLink(addPiecesResult.txHash, client.chain)}...`)
        const addPiecesResult2 = await SP.waitForAddPieces(addPiecesResult)
        state.completedOperations += operations.length
        completedOps += operations.length
        await upsertOperations({
          localDb,
          operations: operations.map((operation) => ({
            ...operation,
            status: 'completed',
            error: null,
            result: { dataSetId: addPiecesResult2.dataSetId, txHash: addPiecesResult2.txHash },
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
  indexerDb,
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
    totalBatches: Math.ceil(totalOperations / batchSize),
    totalOperations,
    completedOperations: 0,
    failedOperations: 0,
  }

  const log = taskLog({
    title: 'Adding pieces',
    limit: 1,
  })

  async function getNextBatch(): Promise<OperationSelect[] | null> {
    const operations = await localDb.query.operations.findMany({
      where: and(
        eq(localSchema.operations.repairId, repair.id),
        eq(localSchema.operations.type, 'add_piece'),
        inArray(localSchema.operations.status, ['pending', 'failed']),
        gt(localSchema.operations.id, cursor)
      ),
      orderBy: [asc(localSchema.operations.id)],
      limit: batchSize,
    })
    if (operations.length === 0) {
      return null
    }

    cursor = operations.at(-1)?.id ?? cursor
    return operations
  }

  const addPiecesJob = createAddPiecesWorker({ localDb, indexerDb, repair, client, state, log })
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
