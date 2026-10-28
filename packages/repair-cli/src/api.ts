import {
  ApiError,
  createApiClient,
  type DataSet,
  DEFAULT_API_URL,
  type Piece,
  type PieceWithDataSet,
  type Provider,
  unwrap,
} from '@filecoin-project/api-client'
import { pipeline, withRateLimit, withRetry, withTimeout } from 'fetch-extras'
import type { IndexerApi } from './types.ts'

export { ApiError, DEFAULT_API_URL } from '@filecoin-project/api-client'
export type { DataSet, Piece, PieceWithDataSet, Provider }

/** filecoin-api network path segment. */
export type Network = 'mainnet' | 'calibration'

/** Largest page size filecoin-api accepts. */
export const MAX_PAGE_SIZE = 200

/** Retries for network errors and `408`, `429` and `5xx` responses. */
const MAX_RETRIES = 5

/** Per-attempt request timeout; a timed-out request fails instead of retrying. */
const REQUEST_TIMEOUT_MS = 30_000

/** filecoin-api allows 120 requests per minute per client IP. */
const RATE_LIMIT = { requestsPerInterval: 120, interval: 60_000 }

/** Map a chain ID to its filecoin-api network. */
export function networkFromChainId(chainId: number): Network {
  return chainId === 314 ? 'mainnet' : 'calibration'
}

/**
 * Create a filecoin-api client for a chain.
 *
 * @param options.baseUrl - API origin; defaults to the client's production URL.
 * @param options.chainId - Chain ID used to pick the network.
 */
export function createIndexerApi({ baseUrl, chainId }: { baseUrl?: string; chainId: number }): IndexerApi {
  // Pace requests under the API's limit, and still retry 429s (other clients may share the IP),
  // honouring Retry-After.
  const fetchWithRetry = pipeline(
    fetch,
    withTimeout(REQUEST_TIMEOUT_MS),
    withRateLimit(RATE_LIMIT),
    withRetry({ retries: MAX_RETRIES })
  )
  return {
    client: createApiClient({ baseUrl: baseUrl ?? DEFAULT_API_URL, fetch: fetchWithRetry }),
    network: networkFromChainId(chainId),
  }
}

/** Return `null` instead of throwing for a filecoin-api 404. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch (error) {
    if (ApiError.isNotFound(error)) return null
    throw error
  }
}

/** Collect every item from a cursor-paginated walk. */
async function collect<T>(pages: AsyncIterable<T[]>): Promise<T[]> {
  const items: T[] = []
  for await (const page of pages) items.push(...page)
  return items
}

/**
 * Walk a cursor-paginated list, yielding one page of items at a time.
 *
 * @param fetchPage - Fetches the page after `cursor` (`undefined` for the first page).
 */
async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ data: T[]; nextCursor: string | null }>
): AsyncGenerator<T[]> {
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    yield page.data
    cursor = page.nextCursor ?? undefined
  } while (cursor)
}

/** Get a provider by ID, or `null` when it does not exist. */
export function getProvider({ client, network }: IndexerApi, providerId: bigint): Promise<Provider | null> {
  return orNull(
    client
      .GET('/{network}/providers/{providerId}', {
        params: { path: { network, providerId: providerId.toString() } },
      })
      .then((result) => unwrap(result).data)
  )
}

/** List every provider matching the filters. */
export function listProviders(
  { client, network }: IndexerApi,
  query: { active?: boolean; approved?: boolean; endorsed?: boolean } = {}
): Promise<Provider[]> {
  return collect(
    paginate((cursor) =>
      client
        .GET('/{network}/providers', {
          params: {
            path: { network },
            query: {
              limit: MAX_PAGE_SIZE,
              cursor,
              active: bool(query.active),
              approved: bool(query.approved),
              endorsed: bool(query.endorsed),
            },
          },
        })
        .then(unwrap)
    )
  )
}

/** Get a data set by ID, or `null` when it does not exist. */
export function getDataSet({ client, network }: IndexerApi, dataSetId: bigint): Promise<DataSet | null> {
  return orNull(
    client
      .GET('/{network}/data-sets/{dataSetId}', {
        params: { path: { network, dataSetId: dataSetId.toString() } },
      })
      .then((result) => unwrap(result).data)
  )
}

/** List every data set matching the filters, newest ID first. */
export function listDataSets(
  { client, network }: IndexerApi,
  query: { owner?: string; providerId?: bigint; deleted?: boolean; withCdn?: boolean }
): Promise<DataSet[]> {
  return collect(
    paginate((cursor) =>
      client
        .GET('/{network}/data-sets', {
          params: {
            path: { network },
            query: {
              limit: MAX_PAGE_SIZE,
              cursor,
              owner: query.owner,
              provider_id: query.providerId?.toString(),
              deleted: bool(query.deleted),
              with_cdn: bool(query.withCdn),
            },
          },
        })
        .then(unwrap)
    )
  )
}

/** Walk the pieces of one data set page by page, newest piece ID first. */
export function dataSetPiecePages(
  { client, network }: IndexerApi,
  dataSetId: bigint,
  query: { removed?: boolean } = {}
): AsyncGenerator<Piece[]> {
  return paginate((cursor) =>
    client
      .GET('/{network}/data-sets/{dataSetId}/pieces', {
        params: {
          path: { network, dataSetId: dataSetId.toString() },
          query: { limit: MAX_PAGE_SIZE, cursor, removed: bool(query.removed) },
        },
      })
      .then(unwrap)
  )
}

/** List every piece in one data set, newest piece ID first. */
export function listDataSetPieces(
  api: IndexerApi,
  dataSetId: bigint,
  query: { removed?: boolean } = {}
): Promise<Piece[]> {
  return collect(dataSetPiecePages(api, dataSetId, query))
}

/**
 * Walk the pieces of every data set a provider stores, page by page, newest data set and piece
 * first. One walk covers all of the provider's data sets.
 */
export function providerPiecePages(
  { client, network }: IndexerApi,
  providerId: bigint,
  query: { removed?: boolean } = {}
): AsyncGenerator<PieceWithDataSet[]> {
  return paginate((cursor) =>
    client
      .GET('/{network}/pieces', {
        params: {
          path: { network },
          query: { limit: MAX_PAGE_SIZE, cursor, provider_id: providerId.toString(), removed: bool(query.removed) },
        },
      })
      .then(unwrap)
  )
}

/** Encode an optional boolean filter as a query string value. */
function bool(value: boolean | undefined): 'true' | 'false' | undefined {
  return value === undefined ? undefined : value ? 'true' : 'false'
}

/** Convert API piece metadata to the string record stored on local operations. */
export function toStringMetadata(metadata: Record<string, unknown> | null): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, String(value)]))
}
