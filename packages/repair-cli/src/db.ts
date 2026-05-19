import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import type { Address } from 'viem'
import { NoAlternateProviderError, RepairCreationError } from './error.ts'
import type * as IndexerSchema from './indexer-schema.ts'
import type * as LocalSchema from './local-schema.ts'
import type { InsertOperation } from './local-schema.ts'
import type { IndexerDatabase, LocalDatabase } from './types.ts'

type IndexerQueryOptions = {
  indexerDb: IndexerDatabase
  indexerSchema: typeof IndexerSchema
}

export type GetPiecesByGroupOptions = IndexerQueryOptions & {
  providerId: bigint
}

export type GetDataSetsByGroupOptions = IndexerQueryOptions & {
  providerId: bigint
  payer: Address
}

export type GetProvidersByCidOptions = IndexerQueryOptions & {
  cids: readonly string[]
  excludedProviderId: bigint
}

export type SelectAlternateRepairProviderOptions = IndexerQueryOptions & {
  providerId: bigint
}

export type CreateRepairOptions = IndexerQueryOptions & {
  localDb: LocalDatabase
  localSchema: typeof LocalSchema
  repairProviderId: bigint
  payer: Address
}

export type PieceGroup = 'cdn' | 'ipfs' | 'both' | 'none'

export const PIECE_GROUPS = ['cdn', 'ipfs', 'both', 'none'] as const satisfies readonly PieceGroup[]

export type PieceForGroup = {
  cid: string
  metadata: Record<string, string> | null
}

export type PiecesByGroup = Record<PieceGroup, PieceForGroup[]>

export type DataSetForGroup = {
  dataSetId: bigint
  withCdn: boolean
  withIpfsIndexing: boolean
  payer: string
  source: string | null
}

export interface DataSetsByGroup {
  cdn: DataSetForGroup | null
  ipfs: DataSetForGroup | null
  both: DataSetForGroup | null
  none: DataSetForGroup | null
}

function pieceGroupFromFlags(withCdn: boolean, withIpfsIndexing: boolean): PieceGroup {
  if (withCdn && withIpfsIndexing) return 'both'
  if (withCdn) return 'cdn'
  if (withIpfsIndexing) return 'ipfs'
  return 'none'
}

/**
 * Provider details used for repair selection and CID replica lookup.
 */
export type RepairProvider = {
  providerId: bigint
  providerAddress: Address
  name: string
  serviceUrl: string
  approved: boolean
  endorsed: boolean
}

type ProviderTier = 'endorsed' | 'approved' | 'none'

function providerTier(approved: boolean, endorsed: boolean): ProviderTier {
  if (endorsed) return 'endorsed'
  if (approved) return 'approved'
  return 'none'
}

function matchesProviderTier(provider: Pick<RepairProvider, 'approved' | 'endorsed'>, tier: ProviderTier) {
  if (tier === 'endorsed') return provider.endorsed
  if (tier === 'approved') return provider.approved && !provider.endorsed
  return !provider.approved && !provider.endorsed
}

function fallbackTiersFor(preferredTier: ProviderTier): ProviderTier[] {
  if (preferredTier === 'endorsed') return ['approved', 'none']
  if (preferredTier === 'approved') return ['none']
  return []
}

/**
 * Map of piece CID to providers that currently store that CID.
 */
export type ProvidersByCid = Record<string, RepairProvider[]>

/**
 * List active pieces for a provider, grouped by dataset repair flags.
 *
 * Groups are mutually exclusive: `cdn` and `ipfs` require only one flag enabled;
 * `both` requires both; `none` requires neither.
 */
export async function getPiecesByGroup({
  indexerDb,
  indexerSchema,
  providerId,
}: GetPiecesByGroupOptions): Promise<PiecesByGroup> {
  const rows = await indexerDb
    .select({
      cid: indexerSchema.pieces.cid,
      metadata: indexerSchema.pieces.metadata,
      withCdn: indexerSchema.dataSets.withCdn,
      withIpfsIndexing: indexerSchema.dataSets.withIpfsIndexing,
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

  const groups: PiecesByGroup = { cdn: [], ipfs: [], both: [], none: [] }
  const seenByGroup: Record<PieceGroup, Set<string>> = {
    cdn: new Set(),
    ipfs: new Set(),
    both: new Set(),
    none: new Set(),
  }

  for (const { cid, metadata, withCdn, withIpfsIndexing } of rows) {
    const group = pieceGroupFromFlags(withCdn, withIpfsIndexing)
    if (seenByGroup[group].has(cid)) continue
    seenByGroup[group].add(cid)
    groups[group].push({ cid, metadata })
  }

  return groups
}

/**
 * Find one active dataset per repair group for a provider, if it exists.
 *
 * Groups are mutually exclusive: `cdn` and `ipfs` require only one flag enabled;
 * `both` requires both; `none` requires neither. When multiple datasets match a
 * group, the lowest `dataSetId` is returned.
 */
export async function getDataSetsByGroup({
  indexerDb,
  indexerSchema,
  providerId,
  payer,
}: GetDataSetsByGroupOptions): Promise<DataSetsByGroup> {
  const rows = await indexerDb
    .select({
      dataSetId: indexerSchema.dataSets.dataSetId,
      withCdn: indexerSchema.dataSets.withCdn,
      withIpfsIndexing: indexerSchema.dataSets.withIpfsIndexing,
      payer: indexerSchema.dataSets.payer,
      source: indexerSchema.dataSets.source,
    })
    .from(indexerSchema.dataSets)
    .where(
      and(
        eq(indexerSchema.dataSets.providerId, providerId),
        eq(indexerSchema.dataSets.deleted, false),
        eq(indexerSchema.dataSets.payer, payer)
      )
    )
    .orderBy(asc(indexerSchema.dataSets.dataSetId))

  const groups: DataSetsByGroup = { cdn: null, ipfs: null, both: null, none: null }

  for (const row of rows) {
    const group = pieceGroupFromFlags(row.withCdn, row.withIpfsIndexing)
    if (groups[group]) continue
    groups[group] = row
  }

  return groups
}

/**
 * Find alternate providers for each CID, excluding the provider currently being repaired.
 *
 * Deleted datasets and removed pieces are ignored. Every requested CID is present in
 * the result; CIDs with no alternate providers map to an empty array.
 */
export async function getProvidersByCid({
  indexerDb,
  indexerSchema,
  cids,
  excludedProviderId,
}: GetProvidersByCidOptions): Promise<ProvidersByCid> {
  const providersByCid = Object.fromEntries(cids.map((cid) => [cid, []])) as ProvidersByCid
  if (cids.length === 0) return providersByCid

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

/**
 * Pick an active alternate provider to repair to, matching the source provider's status tier
 * when possible.
 *
 * Tier precedence for the source provider: endorsed, then approved, then neither. Fallbacks only
 * step down: endorsed → approved → none; approved → none; none has no fallback.
 */
export async function selectAlternateRepairProvider({
  indexerDb,
  indexerSchema,
  providerId,
}: SelectAlternateRepairProviderOptions): Promise<RepairProvider | null> {
  const [source] = await indexerDb
    .select({
      approved: indexerSchema.providers.approved,
      endorsed: indexerSchema.providers.endorsed,
    })
    .from(indexerSchema.providers)
    .where(eq(indexerSchema.providers.providerId, providerId))
    .limit(1)

  if (!source) return null

  const candidates = await indexerDb
    .select({
      providerId: indexerSchema.providers.providerId,
      providerAddress: indexerSchema.providers.providerAddress,
      name: indexerSchema.providers.name,
      serviceUrl: indexerSchema.providers.serviceUrl,
      approved: indexerSchema.providers.approved,
      endorsed: indexerSchema.providers.endorsed,
    })
    .from(indexerSchema.providers)
    .where(
      and(
        ne(indexerSchema.providers.providerId, providerId),
        eq(indexerSchema.providers.providerActive, true),
        eq(indexerSchema.providers.pdpProductActive, true)
      )
    )
    .orderBy(asc(indexerSchema.providers.providerId))

  if (candidates.length === 0) return null

  const preferredTier = providerTier(source.approved, source.endorsed)
  const tiersToTry = [preferredTier, ...fallbackTiersFor(preferredTier)]

  for (const tier of tiersToTry) {
    const match = candidates.find((candidate) => matchesProviderTier(candidate, tier))
    if (match?.providerAddress && match?.serviceUrl && match?.name) {
      return {
        providerId: match.providerId,
        providerAddress: match.providerAddress,
        name: match.name,
        serviceUrl: match.serviceUrl,
        approved: match.approved,
        endorsed: match.endorsed,
      }
    }
  }

  return null
}

/**
 * Prepare a repair by selecting a target provider, creating the repair row, and
 * inserting pending dataset and piece operations.
 */
export async function createRepair({
  indexerDb,
  indexerSchema,
  localDb,
  localSchema,
  repairProviderId,
  payer,
}: CreateRepairOptions): Promise<number> {
  // Pick a replacement provider with matching endorsement/approval tier when possible.
  const targetProvider = await selectAlternateRepairProvider({
    indexerDb,
    indexerSchema,
    providerId: repairProviderId,
  })
  if (!targetProvider) throw new NoAlternateProviderError()

  // Get the target datasets for the repair. If no dataset is found, a new one will be created.
  const dataSetsByGroup = await getDataSetsByGroup({
    indexerDb,
    indexerSchema,
    providerId: targetProvider.providerId,
    payer,
  })
  const piecesByGroup = await getPiecesByGroup({ indexerDb, indexerSchema, providerId: repairProviderId })
  const now = Date.now()

  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      repairProviderId: repairProviderId.toString(),
      targetProviderId: targetProvider.providerId.toString(),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError()

  const addPieceOperations: InsertOperation[] = []

  // Each group needs a target dataset before pieces can be added; queue missing datasets first.
  for (const group of PIECE_GROUPS) {
    const dataSet = dataSetsByGroup[group]
    const pieces = piecesByGroup[group]
    if (!dataSet && pieces.length > 0) {
      await localDb.insert(localSchema.operations).values({
        repairId: repair.id,
        type: 'create_dataset',
        group,
        status: 'pending',
        data: {
          serviceUrl: targetProvider.serviceUrl,
          payee: targetProvider.providerAddress,
        },
        createdAt: now,
        updatedAt: now,
      })
    }
    // Collect add_piece ops for a single batch insert after the loop.
    for (const piece of pieces) {
      addPieceOperations.push({
        repairId: repair.id,
        type: 'add_piece',
        group,
        status: 'pending',
        data: {
          cid: piece.cid,
          serviceUrl: targetProvider.serviceUrl,
          metadata: piece.metadata ?? {},
        },
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  if (addPieceOperations.length > 0) {
    await localDb.insert(localSchema.operations).values(addPieceOperations)
  }

  return repair.id
}
