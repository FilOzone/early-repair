import { getDataSet } from '@filoz/synapse-core/warm-storage'
import { eq } from 'drizzle-orm'
import { MissingRepairDataSetError, RepairNotFoundError } from '../error.ts'
import type { LocalDatabase, WalletClient } from '../types.ts'

const targetDatasetCache = new Map<number, getDataSet.OutputType>()

/**
 * Get a targetdataset for a repair.
 *
 * @param options - The options for getting the target dataset.
 */
export async function getTargetDataset({
  localDb,
  repairId,
  client,
}: {
  localDb: LocalDatabase
  repairId: number
  client: WalletClient
}) {
  const cached = targetDatasetCache.get(repairId)
  if (cached) {
    return cached
  }

  const repair = await localDb.query.repairs.findFirst({
    where: eq(localDb._.fullSchema.repairs.id, repairId),
    columns: { targetDataSetId: true },
  })
  if (!repair) {
    throw new RepairNotFoundError(repairId)
  }

  if (repair.targetDataSetId == null) {
    throw new MissingRepairDataSetError()
  }

  const dataSet = await getDataSet(client, { dataSetId: repair.targetDataSetId })
  if (!dataSet) {
    throw new MissingRepairDataSetError()
  }

  targetDatasetCache.set(repairId, dataSet)

  return dataSet
}
