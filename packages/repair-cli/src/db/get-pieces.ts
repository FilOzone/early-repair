import * as Piece from '@filoz/synapse-core/piece'
import pMap from 'p-map'
import { listDataSetPieces, MAX_PAGE_SIZE, providerPiecePages, toStringMetadata } from '../api.ts'
import type { OperationInsert } from '../local-schema.ts'
import type { IndexerApi } from '../types.ts'
import { getActiveDataSetIds } from './get-active-data-set-ids.ts'
import { getAlternateProviderUrls } from './get-alternate-provider-urls.ts'

/** Options for walking `add_piece` operations for a repair. */
export type ForEachPiecesPageOptions = {
  api: IndexerApi
  /** Source provider whose pieces are being repaired. */
  providerId: bigint
  /** Local repair row to attach operations to. */
  repairId: number
  /** Chain block number captured when the repair was created. */
  blockNumber: bigint
}

/** Options for walking source-dataset pieces for replication. */
export type ForEachDataSetPiecesPageOptions = {
  api: IndexerApi
  /** Source dataset whose pieces are being replicated. */
  dataSetId: bigint
  /** Local job row to attach operations to. */
  repairId: number
  /** Provider URL that serves the source dataset pieces. */
  sourceProviderUrl: string
}

/** One page of operations ready to insert into the local database. */
export type PiecesPage = {
  /** `add_piece` operations for this page (repairs may include `skipped` rows). */
  operations: OperationInsert[]
}

type PieceForOperation = {
  cid: string
  metadata: Record<string, string>
}

/**
 * Map pieces to repair `add_piece` operations, probing the alternate providers for a copy of each.
 *
 * Operations without a reachable alternate are returned as `skipped` with a descriptive error.
 */
async function piecesToRepairOperations({
  pieces,
  repairId,
  alternateProviderUrls,
}: {
  pieces: PieceForOperation[]
  repairId: number
  alternateProviderUrls: string[]
}): Promise<OperationInsert[]> {
  const now = Date.now()

  return pMap(
    pieces,
    async ({ cid, metadata }) => {
      let skippedMessage = ''
      let validProvider: string | undefined
      if (alternateProviderUrls.length > 0) {
        validProvider = await Piece.findPieceOnProviders(alternateProviderUrls, Piece.from(cid))

        if (!validProvider) {
          skippedMessage = `Piece not found on any of ${alternateProviderUrls.length} probed providers`
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
        metadata,
        alternateProvider: validProvider ?? '',
        error: validProvider ? undefined : skippedMessage,
        createdAt: now,
        updatedAt: now,
      } satisfies OperationInsert
    },
    { concurrency: 20 }
  )
}

/**
 * Walk every live piece of a provider at the repair block and map them to `add_piece` operations,
 * invoking `onPage` per API page.
 *
 * Pieces are walked newest dataset and piece first. CIDs are deduped globally so a piece stored
 * under multiple source datasets is queued once into the single IPFS repair dataset. Each piece is
 * looked up directly on the approved or endorsed providers, then the provider being repaired
 * (`HEAD /piece/{cid}`), rather than in the API, so finding a pull source costs no API requests.
 *
 * @param options - API client and repair context.
 * @param onPage - Async handler for each page (e.g. batch insert into local DB).
 */
export async function forEachPiecesPage(
  { api, providerId, repairId, blockNumber }: ForEachPiecesPageOptions,
  onPage: (page: PiecesPage) => Promise<void>
): Promise<void> {
  const activeDataSetIds = await getActiveDataSetIds({ api, providerId, blockNumber })
  const alternateProviderUrls = await getAlternateProviderUrls({ api, repairProviderId: providerId })
  const seenCids = new Set<string>()

  for await (const rows of providerPiecePages(api, providerId, { removed: false })) {
    const pieces: PieceForOperation[] = []
    for (const { cid, metadata, dataSetId } of rows) {
      if (!activeDataSetIds.has(dataSetId)) continue
      // Same CID can appear on multiple source datasets; only repair it once.
      if (cid == null || seenCids.has(cid)) continue
      seenCids.add(cid)
      pieces.push({ cid, metadata: toStringMetadata(metadata) })
    }

    await onPage({ operations: await piecesToRepairOperations({ pieces, repairId, alternateProviderUrls }) })
  }
}

/**
 * Walk every live piece of a source dataset and map them to replication operations, invoking
 * `onPage` per batch.
 *
 * Unlike repairs, replication preserves source dataset ordering (ascending piece ID) and does not
 * dedupe repeated CIDs.
 *
 * @param options - API client and dataset context.
 * @param onPage - Async handler for each page (e.g. batch insert into local DB).
 */
export async function forEachDataSetPiecesPage(
  { api, dataSetId, repairId, sourceProviderUrl }: ForEachDataSetPiecesPageOptions,
  onPage: (page: PiecesPage) => Promise<void>
): Promise<void> {
  // The API lists newest pieces first; load the whole dataset and reverse to keep source order.
  const pieces = (await listDataSetPieces(api, dataSetId, { removed: false })).reverse()
  const now = Date.now()

  for (let offset = 0; offset < pieces.length; offset += MAX_PAGE_SIZE) {
    const operations: OperationInsert[] = []
    for (const { cid, metadata } of pieces.slice(offset, offset + MAX_PAGE_SIZE)) {
      if (cid == null) continue
      operations.push({
        repairId,
        type: 'add_piece',
        status: 'pending',
        cid,
        metadata: toStringMetadata(metadata),
        alternateProvider: sourceProviderUrl,
        createdAt: now,
        updatedAt: now,
      })
    }
    await onPage({ operations })
  }
}
