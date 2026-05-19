import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type * as IndexerSchema from './indexer-schema.ts'
import type { IndexerDatabase } from './types.ts'

export type PieceGroup = 'withCDN' | 'withIPFSIndexing' | 'both' | 'none'

export type PieceForRepair = {
  cid: string
  group: PieceGroup
}

export type PiecesByGroup = Record<PieceGroup, PieceForRepair[]>

/**
 * Provider details returned for a CID replica.
 */
export type ProviderForCid = {
  providerId: bigint
  providerAddress: string | null
  name: string | null
  serviceUrl: string | null
}

/**
 * Map of piece CID to providers that currently store that CID.
 */
export type ProvidersByCid = Record<string, ProviderForCid[]>

/**
 * Alternate providers found for a set of CIDs, plus the CIDs that had no matches.
 */
export type ProvidersByCidResult = {
  providersByCid: ProvidersByCid
  cidsWithNoProviders: string[]
}

/**
 * List active pieces for a provider, grouped by dataset metadata repair flags.
 */
export async function getPiecesByGroup(
  indexerDb: IndexerDatabase,
  indexerSchema: typeof IndexerSchema,
  providerId: bigint
): Promise<PiecesByGroup> {
  // Classify each piece from dataset metadata where repair flags are empty-string markers.
  const pieceGroup = sql<PieceGroup>`
    case
      when ${indexerSchema.dataSets.metadata} ? 'withCDN'
        and ${indexerSchema.dataSets.metadata}->>'withCDN' = ''
        and ${indexerSchema.dataSets.metadata} ? 'withIPFSIndexing'
        and ${indexerSchema.dataSets.metadata}->>'withIPFSIndexing' = ''
        then 'both'
      when ${indexerSchema.dataSets.metadata} ? 'withCDN'
        and ${indexerSchema.dataSets.metadata}->>'withCDN' = ''
        then 'withCDN'
      when ${indexerSchema.dataSets.metadata} ? 'withIPFSIndexing'
        and ${indexerSchema.dataSets.metadata}->>'withIPFSIndexing' = ''
        then 'withIPFSIndexing'
      else 'none'
    end
  `

  // Only active pieces from active datasets owned by the provider are candidates for repair.
  const pieces = await indexerDb
    .select({
      cid: indexerSchema.pieces.cid,
      group: pieceGroup,
    })
    .from(indexerSchema.pieces)
    .innerJoin(indexerSchema.dataSets, eq(indexerSchema.pieces.dataSetId, indexerSchema.dataSets.dataSetId))
    .where(
      and(
        eq(indexerSchema.dataSets.providerId, providerId),
        // should we use pdpEndEpoch? maybe something pdpEndEpoch > currentEpoch?
        eq(indexerSchema.dataSets.deleted, false),
        eq(indexerSchema.pieces.removed, false)
      )
    )
    .orderBy(asc(indexerSchema.pieces.dataSetId), asc(indexerSchema.pieces.pieceId))

  // Track seen CIDs separately per group so a CID can appear in multiple repair categories.
  const seenCidsByGroup: Record<PieceGroup, Set<string>> = {
    withCDN: new Set(),
    withIPFSIndexing: new Set(),
    both: new Set(),
    none: new Set(),
  }

  return pieces.reduce<PiecesByGroup>(
    (groups, piece) => {
      const seenCids = seenCidsByGroup[piece.group]
      // Duplicate CIDs inside a group do not need duplicate repair work.
      if (seenCids.has(piece.cid)) return groups
      seenCids.add(piece.cid)
      groups[piece.group].push(piece)
      return groups
    },
    {
      withCDN: [],
      withIPFSIndexing: [],
      both: [],
      none: [],
    }
  )
}

/**
 * Find alternate providers for each CID, excluding the provider currently being repaired.
 *
 * Deleted datasets and removed pieces are ignored. CIDs that have no alternate providers
 * are omitted from `providersByCid` and listed in `cidsWithNoProviders`.
 */
export async function getProvidersByCid(
  indexerDb: IndexerDatabase,
  indexerSchema: typeof IndexerSchema,
  cids: readonly string[],
  excludedProviderId: bigint
): Promise<ProvidersByCidResult> {
  // Seed all requested CIDs so the missing-provider pass can distinguish no matches.
  const providersByCid = Object.fromEntries(cids.map((cid) => [cid, []])) as ProvidersByCid
  if (cids.length === 0) {
    return {
      providersByCid,
      cidsWithNoProviders: [],
    }
  }

  // Join through datasets because providers own datasets, while pieces only reference dataset IDs.
  const rows = await indexerDb
    .selectDistinct({
      cid: indexerSchema.pieces.cid,
      providerId: indexerSchema.providers.providerId,
      providerAddress: indexerSchema.providers.providerAddress,
      name: indexerSchema.providers.name,
      serviceUrl: indexerSchema.providers.serviceUrl,
    })
    .from(indexerSchema.pieces)
    .innerJoin(indexerSchema.dataSets, eq(indexerSchema.pieces.dataSetId, indexerSchema.dataSets.dataSetId))
    .innerJoin(indexerSchema.providers, eq(indexerSchema.dataSets.providerId, indexerSchema.providers.providerId))
    .where(
      and(
        inArray(indexerSchema.pieces.cid, [...cids]),
        ne(indexerSchema.dataSets.providerId, excludedProviderId),
        eq(indexerSchema.dataSets.deleted, false),
        eq(indexerSchema.pieces.removed, false)
      )
    )
    .orderBy(asc(indexerSchema.pieces.cid), asc(indexerSchema.providers.providerId))

  for (const { cid, ...provider } of rows) {
    providersByCid[cid]?.push(provider)
  }

  // Keep the provider map focused on usable replicas and report missing CIDs separately.
  const cidsWithNoProviders = cids.filter((cid) => providersByCid[cid]?.length === 0)
  for (const cid of cidsWithNoProviders) {
    delete providersByCid[cid]
  }

  return {
    providersByCid,
    cidsWithNoProviders,
  }
}
