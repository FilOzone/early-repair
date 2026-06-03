import { eq } from 'drizzle-orm'
import type { InsertRepair } from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type UpdateRepairOptions = {
  localDb: LocalDatabase
  repairId: number
  status?: localSchema.RepairStatus
  targetDataSetId?: bigint | null
}

type RepairUpdate = Partial<InsertRepair>

export async function updateRepair({ localDb, repairId, status, targetDataSetId }: UpdateRepairOptions) {
  const update: RepairUpdate = {
    updatedAt: Date.now(),
  }
  if (status) update.status = status
  if (targetDataSetId !== undefined) update.targetDataSetId = targetDataSetId
  await localDb.update(localSchema.repairs).set(update).where(eq(localSchema.repairs.id, repairId))
}
