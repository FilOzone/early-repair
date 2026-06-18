import * as Piece from '@filoz/synapse-core/piece'
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import pMap from 'p-map'
import type { OperationInsert } from '../local-schema.ts'
import type { IndexerDatabase } from '../types.ts'
import { findProvidersByCid } from './find-providers-by-cid.ts'

/** Default page size when paginating pieces from the indexer. */
export const DEFAULT_PIECES_PAGE_SIZE = 3000

/** Options for fetching one page of `add_piece` operations for a repair. */
export type GetPiecesPageOptions = {
  indexerDb: IndexerDatabase
  /** Source provider whose pieces are being repaired. */
  providerId: bigint
  /** Local repair row to attach operations to. */
  repairId: number
  /** Chain block number captured when the repair was created. */
  blockNumber: bigint
  /** Max indexer rows per page. Defaults to {@link DEFAULT_PIECES_PAGE_SIZE}. */
  limit?: number
  /** SQL offset for the indexer query. */
  offset?: number
  /**
   * CIDs already emitted across prior pages. Pass the value returned from the previous call
   * so the same CID is not queued twice when it appears in multiple source datasets.
   */
  seenCids?: Set<string>
}

/** Result of a single {@link getPiecesPage} call. */
export type GetPiecesPageResult = {
  /** `add_piece` operations ready to insert for this page (may include `skipped` rows). */
  operations: OperationInsert[]
  /** Whether another indexer page may exist after this one. */
  hasMore: boolean
  /** Offset to pass as `offset` on the next page. */
  nextOffset: number
  /** Updated dedupe set; pass into the next {@link getPiecesPage} call. */
  seenCids: Set<string>
}

/** Options for {@link forEachPiecesPage}; pagination state is managed internally. */
export type ForEachPiecesPageOptions = Omit<GetPiecesPageOptions, 'offset' | 'seenCids'>

/** Options for fetching one page of source-dataset pieces for replication. */
export type GetDataSetPiecesPageOptions = {
  indexerDb: IndexerDatabase
  /** Source dataset whose pieces are being replicated. */
  dataSetId: bigint
  /** Local job row to attach operations to. */
  repairId: number
  /** Provider URL that serves the source dataset pieces. */
  sourceProviderUrl: string
  /** Max indexer rows per page. Defaults to {@link DEFAULT_PIECES_PAGE_SIZE}. */
  limit?: number
  /** SQL offset for the indexer query. */
  offset?: number
}

/** Result of a single {@link getDataSetPiecesPage} call. */
export type GetDataSetPiecesPageResult = {
  /** `add_piece` operations ready to insert for this page. */
  operations: OperationInsert[]
  /** Whether another indexer page may exist after this one. */
  hasMore: boolean
  /** Offset to pass as `offset` on the next page. */
  nextOffset: number
}

/** Options for {@link forEachDataSetPiecesPage}; pagination state is managed internally. */
export type ForEachDataSetPiecesPageOptions = Omit<GetDataSetPiecesPageOptions, 'offset'>

type PieceForOperation = {
  cid: string
  metadata: Record<string, string> | null
}

/** Empty CID set for starting a paginated piece walk. */
export function emptySeenCids(): Set<string> {
  return new Set()
}

/**
 * Fetch one page of pieces for a provider at the repair block and map them to `add_piece` operations.
 *
 * Pieces are read from the indexer in stable dataset/piece order. CIDs are deduped globally so a
 * piece stored under multiple source datasets is queued once into the single IPFS repair dataset.
 * Alternate providers are resolved in one batch per page; operations without alternates are
 * inserted as `skipped` with a descriptive error.
 *
 * Pass `seenCids` and `nextOffset` from the prior result to continue pagination.
 *
 * @param options - Indexer connection, repair context, and optional pagination state.
 * @returns Operations for this page plus pagination cursors.
 */
export async function getPiecesPage({
  indexerDb,
  providerId,
  repairId,
  blockNumber,
  limit = DEFAULT_PIECES_PAGE_SIZE,
  offset = 0,
  seenCids = emptySeenCids(),
}: GetPiecesPageOptions): Promise<GetPiecesPageResult> {
  const schema = indexerDb._.fullSchema
  const rows = await indexerDb
    .select({
      cid: schema.pieces.cid,
      metadata: schema.pieces.metadata,
    })
    .from(schema.pieces)
    .innerJoin(schema.dataSets, eq(schema.pieces.dataSetId, schema.dataSets.dataSetId))
    .where(
      and(
        eq(schema.dataSets.providerId, providerId),
        eq(schema.dataSets.deleted, false),
        or(isNull(schema.dataSets.pdpEndEpoch), lte(schema.dataSets.pdpEndEpoch, blockNumber)),
        eq(schema.pieces.removed, false)
      )
    )
    .orderBy(asc(schema.pieces.dataSetId), asc(schema.pieces.pieceId))
    .limit(limit)
    .offset(offset)

  const now = Date.now()
  const pieces: PieceForOperation[] = []

  for (const { cid, metadata } of rows) {
    // Same CID can appear on multiple source datasets; only repair it once.
    if (seenCids.has(cid)) continue
    seenCids.add(cid)

    pieces.push({ cid, metadata })
  }

  // Resolve pull sources in one query per page; exclude the provider being repaired from alternates.
  const providersByCid = await findProvidersByCid({
    indexerDb,
    cids: pieces.map((piece) => piece.cid),
    blockNumber,
  })

  const operations: OperationInsert[] = await pMap(
    pieces,
    async ({ cid, metadata }) => {
      const alternateProviders = providersByCid[cid]?.map((provider) => provider.serviceUrl) ?? []
      let skippedMessage = ''
      let validProvider: string | undefined
      if (alternateProviders.length > 0) {
        validProvider = await Piece.findPieceOnProviders(alternateProviders, Piece.from(cid))

        if (!validProvider) {
          skippedMessage = `Found ${alternateProviders.length} alternate providers, but none are valid. ${alternateProviders.join(', ')}`
        }
      } else {
        skippedMessage = `No alternate providers found`
      }

      return {
        repairId,
        type: 'add_piece',
        // Cannot pull without another replica; mark skipped up front so run skips these ops.
        status: validProvider ? 'pending' : 'skipped',
        cid,
        metadata: metadata ?? {},
        alternateProvider: validProvider ?? '',
        error: validProvider ? undefined : skippedMessage,
        createdAt: now,
        updatedAt: now,
      }
    },
    { concurrency: 20 }
  )

  // )

  return {
    operations,
    // A full page means there may be more rows; a short page ends pagination.
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length,
    seenCids,
  }
}

/**
 * Fetch one page of pieces for a specific dataset and map them to replication operations.
 *
 * Unlike repairs, replication preserves source dataset ordering and does not dedupe repeated CIDs.
 *
 * @param options - Indexer connection, dataset context, and optional pagination state.
 * @returns Operations for this page plus pagination cursors.
 */
export async function getDataSetPiecesPage({
  indexerDb,
  dataSetId,
  repairId,
  sourceProviderUrl,
  limit = DEFAULT_PIECES_PAGE_SIZE,
  offset = 0,
}: GetDataSetPiecesPageOptions): Promise<GetDataSetPiecesPageResult> {
  const schema = indexerDb._.fullSchema
  const rows = await indexerDb
    .select({
      cid: schema.pieces.cid,
      metadata: schema.pieces.metadata,
    })
    .from(schema.pieces)
    .where(and(eq(schema.pieces.dataSetId, dataSetId), eq(schema.pieces.removed, false)))
    .orderBy(asc(schema.pieces.pieceId))
    .limit(limit)
    .offset(offset)

  const now = Date.now()
  const operations: OperationInsert[] = rows.map(({ cid, metadata }) => ({
    repairId,
    type: 'add_piece',
    status: 'pending',
    cid,
    metadata: metadata ?? {},
    alternateProvider: sourceProviderUrl,
    createdAt: now,
    updatedAt: now,
  }))

  return {
    operations,
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length,
  }
}

/**
 * Walk every page of `add_piece` operations for a provider, invoking `onPage` per batch.
 *
 * Manages `offset` and `seenCids` across pages so callers only handle inserts.
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
  let seenCids = emptySeenCids()

  while (hasMore) {
    const page = await getPiecesPage({
      ...options,
      offset,
      seenCids,
    })

    await onPage(page)

    offset = page.nextOffset
    seenCids = page.seenCids
    hasMore = page.hasMore
  }
}

/**
 * Walk every page of `add_piece` operations for a source dataset, invoking `onPage` per batch.
 *
 * Replication pagination intentionally has no CID dedupe state so duplicate pieces are preserved.
 *
 * @param options - Same inputs as {@link getDataSetPiecesPage} except pagination cursor.
 * @param onPage - Async handler for each page result (e.g. batch insert into local DB).
 */
export async function forEachDataSetPiecesPage(
  options: ForEachDataSetPiecesPageOptions,
  onPage: (page: GetDataSetPiecesPageResult) => Promise<void>
): Promise<void> {
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const page = await getDataSetPiecesPage({
      ...options,
      offset,
    })

    await onPage(page)

    offset = page.nextOffset
    hasMore = page.hasMore
  }
}
