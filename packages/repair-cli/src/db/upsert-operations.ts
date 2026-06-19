import type { OperationInsert } from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'
import { buildConflictUpdateColumns } from '../utils.ts'

export type UpsertOperationsOptions = {
  localDb: LocalDatabase
  operations: OperationInsert[]
}

/**
 * Upserts operations in the database.
 */
export async function upsertOperations({ localDb, operations }: UpsertOperationsOptions) {
  const now = Date.now()
  await localDb
    .insert(localDb._.fullSchema.operations)
    .values(operations.map((operation) => ({ ...operation, updatedAt: now })))
    .onConflictDoUpdate({
      target: localDb._.fullSchema.operations.id,
      set: buildConflictUpdateColumns(localSchema.operations, ['status', 'error', 'updatedAt', 'txHash']),
    })
}
