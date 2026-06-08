import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Address } from 'viem'
import type { IndexerDatabase } from '../types.ts'
import { EARLY_REPAIR_SOURCE } from '../utils.ts'

export type GetRepairDatasetOptions = {
  indexerDb: IndexerDatabase
  providerId: bigint
  payer: Address
}

/**
 * Find one IPFS-enabled repair dataset for a provider at the repair block, if it exists.
 *
 * When multiple datasets match, the lowest `dataSetId` is returned.
 */
export async function getRepairDataset({
  indexerDb,
  providerId,
  payer,
}: GetRepairDatasetOptions): Promise<bigint | null> {
  const schema = indexerDb._.fullSchema

  const [row] = await indexerDb
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
        eq(schema.dataSets.source, EARLY_REPAIR_SOURCE),
        eq(schema.dataSets.withCdn, false),
        eq(schema.dataSets.withIpfsIndexing, true)
      )
    )
    .orderBy(asc(schema.dataSets.dataSetId))
    .limit(1)

  return row.dataSetId ?? null
}
