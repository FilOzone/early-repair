import { and, eq } from 'drizzle-orm'
import { type Group, type LocalDatabase, PIECE_GROUPS } from '../types.ts'

export type GetRepairGroupsOptions = {
  localDb: LocalDatabase
  repairId: number
}

/**
 * List repair groups for a repair from pending `add_piece` operations in the local DB.
 */
export async function getRepairGroups({ localDb, repairId }: GetRepairGroupsOptions): Promise<Group[]> {
  const localSchema = localDb._.fullSchema
  const operations = await localDb
    .selectDistinct({ group: localSchema.operations.group })
    .from(localSchema.operations)
    .where(
      and(
        eq(localSchema.operations.repairId, repairId),
        eq(localSchema.operations.type, 'add_piece'),
        eq(localSchema.operations.status, 'pending')
      )
    )

  const groups = new Set(operations.map(({ group }) => group))
  return PIECE_GROUPS.filter((group) => groups.has(group))
}
