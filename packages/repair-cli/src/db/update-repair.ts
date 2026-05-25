import { eq } from 'drizzle-orm'
import type { InsertRepair } from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type UpdateRepairOptions = {
  localDb: LocalDatabase
  repairId: number
  status?: localSchema.RepairStatus
  targetDataSets?: localSchema.RepairTargetDataSets
}

export async function updateRepair({ localDb, repairId, status, targetDataSets }: UpdateRepairOptions) {
  const update: Partial<InsertRepair> = {
    updatedAt: Date.now(),
  }
  if (status) update.status = status
  if (targetDataSets) {
    const repair = await localDb.query.repairs.findFirst({
      where: eq(localSchema.repairs.id, repairId),
      columns: { targetDataSets: true },
    })
    update.targetDataSets = { ...(repair?.targetDataSets ?? {}), ...targetDataSets }
  }
  await localDb.update(localSchema.repairs).set(update).where(eq(localSchema.repairs.id, repairId))
}
