import { and, asc, eq } from 'drizzle-orm'
import type { InsertOperation } from '../local-schema.ts'
import type { Group, IndexerDatabase } from '../types.ts'
import { getProvidersByCid } from './get-providers-by-cid.ts'

/** Default page size when paginating pieces from the indexer. */
export const DEFAULT_PIECES_PAGE_SIZE = 3000

/** Options for fetching one page of `add_piece` operations for a repair. */
export type GetPiecesPageOptions = {
  indexerDb: IndexerDatabase
  /** Source provider whose pieces are being repaired. */
  providerId: bigint
  /** Local repair row to attach operations to. */
  repairId: number
  /** Max indexer rows per page. Defaults to {@link DEFAULT_PIECES_PAGE_SIZE}. */
  limit?: number
  /** SQL offset for the indexer query. */
  offset?: number
  /**
   * CIDs already emitted per group across prior pages. Pass the value returned from
   * the previous call so the same CID is not queued twice when it appears in multiple datasets.
   */
  seenCidsByGroup?: Record<Group, Set<string>>
}

/** Result of a single {@link getPiecesPage} call. */
export type GetPiecesPageResult = {
  /** `add_piece` operations ready to insert for this page (may include `failed` rows). */
  operations: InsertOperation[]
  /** Whether another indexer page may exist after this one. */
  hasMore: boolean
  /** Offset to pass as `offset` on the next page. */
  nextOffset: number
  /** Updated dedupe sets; pass into the next {@link getPiecesPage} call. */
  seenCidsByGroup: Record<Group, Set<string>>
}

/** Options for {@link forEachPiecesPage}; pagination state is managed internally. */
export type ForEachPiecesPageOptions = Omit<GetPiecesPageOptions, 'offset' | 'seenCidsByGroup'>

type PieceForOperation = {
  cid: string
  metadata: Record<string, string> | null
  group: Group
}

/**
 * Map dataset CDN/IPFS flags to a mutually exclusive repair group.
 *
 * `both` requires both flags; `cdn` and `ipfs` require only that flag; `none` requires neither.
 */
function pieceGroupFromFlags(withCdn: boolean, withIpfsIndexing: boolean): Group {
  if (withCdn && withIpfsIndexing) return 'both'
  if (withCdn) return 'cdn'
  if (withIpfsIndexing) return 'ipfs'
  return 'none'
}

/** Empty per-group CID sets for starting a paginated piece walk. */
export function emptySeenCidsByGroup(): Record<Group, Set<string>> {
  return {
    cdn: new Set(),
    ipfs: new Set(),
    both: new Set(),
    none: new Set(),
  }
}

/**
 * Fetch one page of active pieces for a provider and map them to `add_piece` operations.
 *
 * Pieces are read from the indexer in stable dataset/piece order. Within each page, CIDs are
 * deduped per repair group so a piece stored under multiple datasets of the same group is only
 * queued once. Alternate providers (excluding the source provider) are resolved in one batch per
 * page; operations without alternates are inserted as `failed` with a descriptive error.
 *
 * Pass `seenCidsByGroup` and `nextOffset` from the prior result to continue pagination.
 *
 * @param options - Indexer connection, repair context, and optional pagination state.
 * @returns Operations for this page plus pagination cursors.
 */
export async function getPiecesPage({
  indexerDb,
  providerId,
  repairId,
  limit = DEFAULT_PIECES_PAGE_SIZE,
  offset = 0,
  seenCidsByGroup = emptySeenCidsByGroup(),
}: GetPiecesPageOptions): Promise<GetPiecesPageResult> {
  const schema = indexerDb._.fullSchema
  const rows = await indexerDb
    .select({
      cid: schema.pieces.cid,
      metadata: schema.pieces.metadata,
      withCdn: schema.dataSets.withCdn,
      withIpfsIndexing: schema.dataSets.withIpfsIndexing,
    })
    .from(schema.pieces)
    .innerJoin(schema.dataSets, eq(schema.pieces.dataSetId, schema.dataSets.dataSetId))
    .where(
      and(
        eq(schema.dataSets.providerId, providerId),
        eq(schema.dataSets.deleted, false),
        eq(schema.pieces.removed, false)
      )
    )
    .orderBy(asc(schema.pieces.dataSetId), asc(schema.pieces.pieceId))
    .limit(limit)
    .offset(offset)

  const now = Date.now()
  const pieces: PieceForOperation[] = []

  for (const { cid, metadata, withCdn, withIpfsIndexing } of rows) {
    const group = pieceGroupFromFlags(withCdn, withIpfsIndexing)
    // Same CID can appear on multiple datasets in one group; only repair it once per group.
    if (seenCidsByGroup[group].has(cid)) continue
    seenCidsByGroup[group].add(cid)

    pieces.push({ cid, metadata, group })
  }

  // Resolve pull sources in one query per page; exclude the provider being repaired from alternates.
  const providersByCid = await getProvidersByCid({
    indexerDb,
    cids: pieces.map((piece) => piece.cid),
    excludedProviderIds: [providerId],
  })

  const operations: InsertOperation[] = pieces.map(({ cid, metadata, group }) => {
    const alternateProviders = providersByCid[cid]?.map((provider) => provider.serviceUrl) ?? []
    const hasAlternates = alternateProviders.length > 0

    return {
      repairId,
      type: 'add_piece',
      group,
      // Cannot pull without another replica; mark failed up front so run skips these ops.
      status: hasAlternates ? 'pending' : 'skipped',
      data: {
        cid,
        metadata: metadata ?? {},
        alternateProviders,
      },
      error: hasAlternates ? undefined : 'No alternate providers found',
      createdAt: now,
      updatedAt: now,
    }
  })

  return {
    operations,
    // A full page means there may be more rows; a short page ends pagination.
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length,
    seenCidsByGroup,
  }
}

/**
 * Walk every page of `add_piece` operations for a provider, invoking `onPage` per batch.
 *
 * Manages `offset` and `seenCidsByGroup` across pages so callers only handle inserts.
 *
 * @param options - Same inputs as {@link getPiecesPage} except pagination cursors.
 * @param onPage - Async handler for each page result (e.g. batch insert into local DB).
 */
export async function forEachPiecesPage(
  options: ForEachPiecesPageOptions,
  onPage: (page: GetPiecesPageResult) => Promise<void>
): Promise<void> {
  let offset = 0
  let hasMore = true
  let seenCidsByGroup = emptySeenCidsByGroup()

  while (hasMore) {
    const page = await getPiecesPage({
      ...options,
      offset,
      seenCidsByGroup,
    })

    await onPage(page)

    offset = page.nextOffset
    seenCidsByGroup = page.seenCidsByGroup
    hasMore = page.hasMore
  }
}
