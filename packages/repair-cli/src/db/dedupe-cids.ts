import { and, eq, inArray } from 'drizzle-orm'
import type { OperationSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase } from '../types.ts'
import { upsertOperations } from './upsert-operations.ts'

export type SyncPiecesOnchainOptions = {
  indexerDb: IndexerDatabase
  localDb: LocalDatabase
  dataSetId: bigint
  operations: OperationSelect[]
}

/**
 * Dedupe operations by CID on the target repair dataset.
 * Returns operations that are not onchain.
 */
export async function dedupeCids({ indexerDb, localDb, dataSetId, operations }: SyncPiecesOnchainOptions) {
  const cids = operations.map((operation) => operation.cid)
  const schema = indexerDb._.fullSchema

  const rows = await indexerDb
    .select({ cid: schema.pieces.cid })
    .from(schema.pieces)
    .where(
      and(eq(schema.pieces.dataSetId, dataSetId), eq(schema.pieces.removed, false), inArray(schema.pieces.cid, cids))
    )

  const existingCids = new Set<string>()
  const completedOperations: OperationSelect[] = []

  for (const row of rows) {
    completedOperations.push(...operations.filter((operation) => operation.cid === row.cid))
    existingCids.add(row.cid)
  }

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
