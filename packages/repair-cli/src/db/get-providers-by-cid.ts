import { and, asc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { IndexerDatabase, RepairProvider } from '../types.ts'

export type GetProvidersByCidOptions = {
  indexerDb: IndexerDatabase
  cids: readonly string[]
  excludedProviderIds: readonly bigint[]
}

/**
 * Map of piece CID to providers that currently store that CID.
 */
export type ProvidersByCid = Record<string, RepairProvider[]>

/**
 * Find alternate providers for each CID, excluding the given provider IDs.
 *
 * Deleted datasets and removed pieces are ignored. Only approved or endorsed providers are
 * included. Every requested CID is present in the result; CIDs with no alternate providers
 * map to an empty array.
 */
export async function getProvidersByCid({
  indexerDb,
  cids,
  excludedProviderIds,
}: GetProvidersByCidOptions): Promise<ProvidersByCid> {
  const schema = indexerDb._.fullSchema
  const providersByCid = Object.fromEntries(cids.map((cid) => [cid, []])) as ProvidersByCid
  if (cids.length === 0) return providersByCid

  const filters = [
    inArray(schema.pieces.cid, [...cids]),
    eq(schema.dataSets.deleted, false),
    isNull(schema.dataSets.pdpEndEpoch),
    eq(schema.pieces.removed, false),
    or(eq(schema.providers.approved, true), eq(schema.providers.endorsed, true)),
  ]
  if (excludedProviderIds.length > 0) {
    filters.push(notInArray(schema.dataSets.providerId, [...excludedProviderIds]))
  }

  // Join through datasets because providers own datasets, while pieces only reference dataset IDs.
  const rows = await indexerDb
    .selectDistinct({
      cid: schema.pieces.cid,
      providerId: schema.providers.providerId,
      providerAddress: schema.providers.providerAddress,
      name: schema.providers.name,
      serviceUrl: schema.providers.serviceUrl,
      approved: schema.providers.approved,
      endorsed: schema.providers.endorsed,
    })
    .from(schema.pieces)
    .innerJoin(schema.dataSets, eq(schema.pieces.dataSetId, schema.dataSets.dataSetId))
    .innerJoin(schema.providers, eq(schema.dataSets.providerId, schema.providers.providerId))
    .where(and(...filters))
    .orderBy(asc(schema.pieces.cid), asc(schema.providers.providerId))

  for (const { cid, ...provider } of rows) {
    if (provider.providerAddress && provider.serviceUrl && provider.name) {
      providersByCid[cid]?.push({
        providerId: provider.providerId,
        providerAddress: provider.providerAddress,
        name: provider.name,
        serviceUrl: provider.serviceUrl,
        approved: provider.approved,
        endorsed: provider.endorsed,
      })
    }
  }

  return providersByCid
}
