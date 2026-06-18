import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Address } from 'viem'
import type { IndexerDatabase } from '../types.ts'

export type FindRepairDatasetOptions = {
  indexerDb: IndexerDatabase
  providerId: bigint
  payer: Address
  source: string
}

/**
 * Find one IPFS-enabled repair dataset for a provider at the repair block, if it exists.
 *
 * When multiple datasets match, the lowest `dataSetId` is returned.
 */
export async function findRepairDataset({
  indexerDb,
  providerId,
  payer,
  source,
}: FindRepairDatasetOptions): Promise<bigint | null> {
  const schema = indexerDb._.fullSchema

  const result = await indexerDb
    .select({
      dataSetId: schema.dataSets.dataSetId,
    })
    .from(schema.dataSets)
    .where(
      and(
        eq(schema.dataSets.providerId, providerId),
        eq(schema.dataSets.deleted, false),
        isNull(schema.dataSets.pdpEndEpoch),
        eq(schema.dataSets.payer, payer.toLowerCase()),
        eq(schema.dataSets.source, source),
        eq(schema.dataSets.withCdn, false),
        eq(schema.dataSets.withIpfsIndexing, true)
      )
    )
    .orderBy(asc(schema.dataSets.dataSetId))
    .limit(1)

  if (result.length === 0) {
    return null
  }

  return result[0].dataSetId
}
