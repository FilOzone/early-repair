import { eq } from 'drizzle-orm'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type UpdateOperationOptions = {
  localDb: LocalDatabase
  operationId: number
  status: localSchema.OperationStatus
  result?: localSchema.OperationResult | null
  error?: string | null
}

/**
 * Updates an operation in the database.
 */
export async function updateOperation({ localDb, operationId, status, result, error }: UpdateOperationOptions) {
  await localDb
    .update(localSchema.operations)
    .set({
      status,
      result,
      error: error ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(localSchema.operations.id, operationId))
}
