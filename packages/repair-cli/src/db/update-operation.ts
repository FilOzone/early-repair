import { eq } from 'drizzle-orm'
import * as localSchema from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'

export type UpdateOperationOptions = {
  localDb: LocalDatabase
  operationId: number
  status: localSchema.OperationStatus
  txHash?: string | null
  error?: string | null
}

/**
 * Updates an operation in the database.
 */
export async function updateOperation({ localDb, operationId, status, txHash, error }: UpdateOperationOptions) {
  await localDb
    .update(localSchema.operations)
    .set({
      status,
      txHash,
      error: error ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(localSchema.operations.id, operationId))
}
