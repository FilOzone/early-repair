import { and, asc, eq } from 'drizzle-orm'
import type { Address } from 'viem'
import type { DataSetForGroup, Group, IndexerDatabase } from '../types.ts'
import { EARLY_REPAIR_SOURCE, flagsFromGroup } from '../utils.ts'

export type GetDatasetForGroupOptions = {
  indexerDb: IndexerDatabase
  providerId: bigint
  payer: Address
  group: Group
}

/**
 * Find one active dataset for a provider and repair group, if it exists.
 *
 * When multiple datasets match, the lowest `dataSetId` is returned.
 */
export async function getDatasetForGroup({
  indexerDb,
  providerId,
  payer,
  group,
}: GetDatasetForGroupOptions): Promise<DataSetForGroup | null> {
  const schema = indexerDb._.fullSchema
  const { withCdn, withIpfsIndexing } = flagsFromGroup(group)

  const [row] = await indexerDb
    .select({
      dataSetId: schema.dataSets.dataSetId,
      withCdn: schema.dataSets.withCdn,
      withIpfsIndexing: schema.dataSets.withIpfsIndexing,
      payer: schema.dataSets.payer,
      source: schema.dataSets.source,
    })
    .from(schema.dataSets)
    .where(
      and(
        eq(schema.dataSets.providerId, providerId),
        eq(schema.dataSets.deleted, false),
        eq(schema.dataSets.payer, payer.toLowerCase()),
        eq(schema.dataSets.source, EARLY_REPAIR_SOURCE),
        eq(schema.dataSets.withCdn, withCdn),
        eq(schema.dataSets.withIpfsIndexing, withIpfsIndexing)
      )
    )
    .orderBy(asc(schema.dataSets.dataSetId))
    .limit(1)

  return row ?? null
}
