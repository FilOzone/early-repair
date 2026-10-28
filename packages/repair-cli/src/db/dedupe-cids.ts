import type { OperationSelect } from '../local-schema.ts'
import type { LocalDatabase } from '../types.ts'
import { upsertOperations } from './upsert-operations.ts'

export type DedupeCidsOptions = {
  localDb: LocalDatabase
  /** CIDs already in the target repair dataset. */
  existingCids: ReadonlySet<string>
  operations: OperationSelect[]
}

/**
 * Mark operations whose CID is already in the target repair dataset as completed.
 * Returns operations that are not onchain.
 */
export async function dedupeCids({ localDb, existingCids, operations }: DedupeCidsOptions) {
  const completedOperations = operations.filter((operation) => existingCids.has(operation.cid))

  if (completedOperations.length > 0) {
    await upsertOperations({
      localDb,
      operations: completedOperations.map((operation) => ({
        ...operation,
        status: 'completed',
        error: null,
      })),
    })
  }

  // return operations that are not onchain
  return operations.filter((operation) => !existingCids.has(operation.cid))
}
