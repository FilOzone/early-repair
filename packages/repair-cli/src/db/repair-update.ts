import { eq } from 'drizzle-orm'
import type { RepairUpdate } from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type RepairUpdateOptions = {
  localDb: LocalDatabase
  repairId: number
  status?: localSchema.RepairStatus
  targetDataSetId?: bigint | null
}

export async function repairUpdate({ localDb, repairId, status, targetDataSetId }: RepairUpdateOptions) {
  const update: RepairUpdate = {
    updatedAt: Date.now(),
  }
  if (status) update.status = status
  if (targetDataSetId !== undefined) update.targetDataSetId = targetDataSetId
  await localDb.update(localSchema.repairs).set(update).where(eq(localSchema.repairs.id, repairId))
}
