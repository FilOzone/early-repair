import { and, eq, inArray } from 'drizzle-orm'
import type { OperationInsert, OperationSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase } from '../types.ts'
import { upsertOperations } from './upsert-operations.ts'

export type SyncPiecesOnchainOptions = {
  indexerDb: IndexerDatabase
  localDb: LocalDatabase
  dataSetId: bigint
  cidToOperation: Map<string, OperationSelect>
}

/**
 * Sync pieces onchain to avoid duplicates.
 */
export async function syncPiecesOnchain({ indexerDb, localDb, dataSetId, cidToOperation }: SyncPiecesOnchainOptions) {
  const cids = Array.from(cidToOperation.keys())
  const schema = indexerDb._.fullSchema
  let completedOperations = 0
  const rows = await indexerDb
    .select({ cid: schema.pieces.cid })
    .from(schema.pieces)
    .where(
      and(eq(schema.pieces.dataSetId, dataSetId), eq(schema.pieces.removed, false), inArray(schema.pieces.cid, cids))
    )

  const existingCids = new Set<string>()
  const completedOperation: OperationInsert[] = []

  for (const row of rows) {
    const operation = cidToOperation.get(row.cid)
    if (!operation) {
      continue
    }
    completedOperation.push({
      ...operation,
      status: 'completed',
      error: null,
    })
    existingCids.add(row.cid)
    cidToOperation.delete(row.cid)
    completedOperations++
  }

  if (completedOperation.length > 0) {
    await upsertOperations({
      localDb,
      operations: completedOperation,
    })
  }

  return completedOperations
}
