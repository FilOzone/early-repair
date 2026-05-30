import { eq, type SQL, sql } from 'drizzle-orm'
import type { InsertRepair } from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'
import { stringify } from '../utils.ts'

export type UpdateRepairOptions = {
  localDb: LocalDatabase
  repairId: number
  status?: localSchema.RepairStatus
  targetDataSets?: localSchema.RepairTargetDataSets
}

type RepairUpdate = Partial<Omit<InsertRepair, 'targetDataSets'>> & {
  targetDataSets?: SQL
}

export async function updateRepair({ localDb, repairId, status, targetDataSets }: UpdateRepairOptions) {
  const update: RepairUpdate = {
    updatedAt: Date.now(),
  }
  if (status) update.status = status
  if (targetDataSets) {
    let targetDataSetsSql: SQL = sql`${localSchema.repairs.targetDataSets}`
    for (const [group, dataSetId] of Object.entries(targetDataSets)) {
      targetDataSetsSql = sql`json_set(${targetDataSetsSql}, ${`$.${group}`}, json(${stringify(dataSetId)}))`
    }
    update.targetDataSets = targetDataSetsSql
  }
  await localDb.update(localSchema.repairs).set(update).where(eq(localSchema.repairs.id, repairId))
}
