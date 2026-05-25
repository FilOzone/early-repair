import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import type { IndexerQueryOptions } from '../types.ts'
import type { RepairProvider } from './select-alternate-repair-provider.ts'

export type GetProvidersByCidOptions = IndexerQueryOptions & {
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
 * Deleted datasets and removed pieces are ignored. Every requested CID is present in
 * the result; CIDs with no alternate providers map to an empty array.
 */
export async function getProvidersByCid({
  indexerDb,
  indexerSchema,
  cids,
  excludedProviderIds,
}: GetProvidersByCidOptions): Promise<ProvidersByCid> {
  const providersByCid = Object.fromEntries(cids.map((cid) => [cid, []])) as ProvidersByCid
  if (cids.length === 0) return providersByCid

  const filters = [
    inArray(indexerSchema.pieces.cid, [...cids]),
    eq(indexerSchema.dataSets.deleted, false),
    eq(indexerSchema.pieces.removed, false),
  ]
  if (excludedProviderIds.length > 0) {
    filters.push(notInArray(indexerSchema.dataSets.providerId, [...excludedProviderIds]))
  }

  // Join through datasets because providers own datasets, while pieces only reference dataset IDs.
  const rows = await indexerDb
    .selectDistinct({
      cid: indexerSchema.pieces.cid,
      providerId: indexerSchema.providers.providerId,
      providerAddress: indexerSchema.providers.providerAddress,
      name: indexerSchema.providers.name,
      serviceUrl: indexerSchema.providers.serviceUrl,
      approved: indexerSchema.providers.approved,
      endorsed: indexerSchema.providers.endorsed,
    })
    .from(indexerSchema.pieces)
    .innerJoin(indexerSchema.dataSets, eq(indexerSchema.pieces.dataSetId, indexerSchema.dataSets.dataSetId))
    .innerJoin(indexerSchema.providers, eq(indexerSchema.dataSets.providerId, indexerSchema.providers.providerId))
    .where(and(...filters))
    .orderBy(asc(indexerSchema.pieces.cid), asc(indexerSchema.providers.providerId))

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
