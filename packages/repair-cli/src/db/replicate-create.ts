import { taskLog } from '@clack/prompts'
import { getBlockNumber } from 'viem/actions'
import { getDataSet } from '../api.ts'
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
  const { api, localDb, dataSetId, targetProviderId, client } = options
  const localSchema = localDb._.fullSchema
  const now = Date.now()
  const blockNumber = await getBlockNumber(client)

  const log = taskLog({
    title: 'Creating replication',
    limit: 10,
    retainLog: true,
  })

  const sourceDataSet = await getDataSet(api, dataSetId)

  if (!sourceDataSet || sourceDataSet.deleted || sourceDataSet.providerId == null) {
    throw new RepairCreationError(`Source dataset ${dataSetId} not found or deleted`)
  }
  const sourceProviderId = BigInt(sourceDataSet.providerId)

  if (targetProviderId === sourceProviderId) {
    throw new RepairCreationError('Target provider must differ from the source dataset provider')
  }

  const sourceProvider = await getRepairProvider({
    api,
    providerId: sourceProviderId,
  })

  if (!sourceProvider) {
    throw new RepairCreationError(`Source provider ${sourceProviderId} not found or inactive`)
  }

  const targetProvider = await getRepairProvider({
    api,
    providerId: targetProviderId,
  })

  if (!targetProvider) {
    throw new NoAlternateProviderError(targetProviderId)
  }

  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      kind: 'replicate',
      repairProviderId: sourceProvider.providerId,
      repairDataSetId: dataSetId,
      sourceProviderUrl: sourceProvider.serviceUrl,
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
      api,
      dataSetId,
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
