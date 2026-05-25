import { getDataSet } from '@filoz/synapse-core/warm-storage'
import { eq } from 'drizzle-orm'
import { MissingRepairDataSetError, RepairNotFoundError } from '../error.ts'
import type { Group, LocalDatabase, LocalSchema, WalletClient } from '../types.ts'

const targetDatasetCache = new Map<number, Map<Group, getDataSet.OutputType>>()

export async function getTargetDataset({
  localDb,
  localSchema,
  repairId,
  group,
  client,
}: {
  localDb: LocalDatabase
  localSchema: LocalSchema
  repairId: number
  group: Group
  client: WalletClient
}) {
  const cached = targetDatasetCache.get(repairId)?.get(group)
  if (cached) {
    return cached
  }

  const repair = await localDb.query.repairs.findFirst({
    where: eq(localSchema.repairs.id, repairId),
    columns: { targetDataSets: true },
  })
  if (!repair) {
    throw new RepairNotFoundError(repairId)
  }

  if (!repair.targetDataSets[group]) {
    throw new MissingRepairDataSetError(group)
  }

  const dataSetId = repair.targetDataSets[group]

  const dataSet = await getDataSet(client, { dataSetId })
  if (!dataSet) {
    throw new MissingRepairDataSetError(group)
  }

  let byGroup = targetDatasetCache.get(repairId)
  if (!byGroup) {
    byGroup = new Map()
    targetDatasetCache.set(repairId, byGroup)
  }
  byGroup.set(group, dataSet)

  return dataSet
}
