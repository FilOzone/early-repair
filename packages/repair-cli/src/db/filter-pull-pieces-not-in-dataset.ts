import { and, eq, inArray } from 'drizzle-orm'
import type { IndexerDatabase } from '../types.ts'

export type FilterPiecesNotInDatasetOptions = {
  indexerDb: IndexerDatabase
  dataSetId: bigint
  cids: readonly string[]
}

/**
 * Return CIDs that are not already present in the dataset.
 *
 * Removed pieces in the indexer are ignored.
 */
export async function filterPiecesNotInDataset({
  indexerDb,
  dataSetId,
  cids,
}: FilterPiecesNotInDatasetOptions): Promise<string[]> {
  if (cids.length === 0) return []

  const schema = indexerDb._.fullSchema

  const rows = await indexerDb
    .select({ cid: schema.pieces.cid })
    .from(schema.pieces)
    .where(
      and(
        eq(schema.pieces.dataSetId, dataSetId),
        eq(schema.pieces.removed, false),
        inArray(schema.pieces.cid, [...cids])
      )
    )

  const existingCids = new Set(rows.map((row) => row.cid))
  return cids.filter((cid) => !existingCids.has(cid))
}
