import { taskLog } from '@clack/prompts'
import { eq } from 'drizzle-orm'
import { getBlockNumber } from 'viem/actions'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { Context } from '../types.ts'
import { forEachDataSetPiecesPage } from './get-pieces.ts'
import { getRepairProvider } from './get-repair-provider.ts'

export interface ReplicateCreateOptions extends Context {
  dataSetId: bigint
  targetProviderId: bigint
}

/**
 * Prepare a replication job by creating a local row and inserting every source dataset piece.
 *
 * @param options - The options for creating a replication job.
 * @returns The ID of the created local job.
 */
export async function replicateCreate(options: ReplicateCreateOptions): Promise<number> {
  const { indexerDb, localDb, dataSetId, targetProviderId, client } = options
  const indexerSchema = indexerDb._.fullSchema
  const localSchema = localDb._.fullSchema
  const now = Date.now()
  const blockNumber = await getBlockNumber(client)

  const log = taskLog({
    title: 'Creating replication',
    limit: 10,
    retainLog: true,
  })

  const [sourceDataSet] = await indexerDb
    .select({
      dataSetId: indexerSchema.dataSets.dataSetId,
      providerId: indexerSchema.dataSets.providerId,
      deleted: indexerSchema.dataSets.deleted,
    })
    .from(indexerSchema.dataSets)
    .where(eq(indexerSchema.dataSets.dataSetId, dataSetId))
    .limit(1)

  if (!sourceDataSet || sourceDataSet.deleted) {
    throw new RepairCreationError(`Source dataset ${dataSetId} not found or deleted`)
  }

  if (targetProviderId === sourceDataSet.providerId) {
    throw new RepairCreationError('Target provider must differ from the source dataset provider')
  }

  const sourceProvider = await getRepairProvider({
    indexerDb,
    providerId: sourceDataSet.providerId,
  })

  if (!sourceProvider) {
    throw new RepairCreationError(`Source provider ${sourceDataSet.providerId} not found or inactive`)
  }

  const targetProvider = await getRepairProvider({
    indexerDb,
    providerId: targetProviderId,
  })

  if (!targetProvider) {
    throw new NoAlternateProviderError(targetProviderId)
  }

  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      repairProviderId: sourceProvider.providerId,
      repairDataSetId: sourceDataSet.dataSetId,
      targetProviderId: targetProvider.providerId,
      targetProviderUrl: targetProvider.serviceUrl,
      targetDataSetId: null,
      blockNumber,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError('Failed to create replication row')

  let totalOperations = 0
  await forEachDataSetPiecesPage(
    {
      indexerDb,
      dataSetId: sourceDataSet.dataSetId,
      repairId: repair.id,
      sourceProviderUrl: sourceProvider.serviceUrl,
    },
    async (page) => {
      totalOperations += page.operations.length

      if (page.operations.length > 0) {
        await localDb.insert(localSchema.operations).values(page.operations)
      }

      log.message(`Inserted ${page.operations.length} operations`)
    }
  )

  log.success(`Created replication ${repair.id} with ${totalOperations} operations`, { showLog: true })
  return repair.id
}
