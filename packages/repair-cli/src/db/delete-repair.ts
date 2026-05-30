import { eq } from 'drizzle-orm'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type DeleteRepairOptions = {
  localDb: LocalDatabase
  repairId: number
}

export type DeleteRepairResult = {
  deleted: boolean
  operationsDeleted: number
}

/**
 * Delete a repair and all of its operations from the local database.
 */
export async function deleteRepair({ localDb, repairId }: DeleteRepairOptions): Promise<DeleteRepairResult> {
  const repair = await localDb.query.repairs.findFirst({
    where: eq(localSchema.repairs.id, repairId),
    columns: { id: true },
    with: {
      operations: {
        columns: { id: true },
      },
    },
  })

  if (!repair) {
    return { deleted: false, operationsDeleted: 0 }
  }

  await localDb.delete(localSchema.operations).where(eq(localSchema.operations.repairId, repairId))
  const deleted = await localDb.delete(localSchema.repairs).where(eq(localSchema.repairs.id, repairId))

  return { deleted: true, operationsDeleted: deleted.rowsAffected }
}
