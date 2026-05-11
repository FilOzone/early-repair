export const subgraphPageSize = 1000

export type SubgraphProvider = {
  id: string
  address: string
}

export type SubgraphDataSet = {
  id: string
  setId: string
  nextPieceId: string
  owner: {
    address: string
  }
  isActive: boolean
  status: string
}

export type SubgraphService = {
  id: string
  address: string
}

export type SubgraphRoot = {
  id: string
  setId: string
  rootId: string
  cid: string
  removed: boolean
  proofSet: {
    setId: string
  }
}

export type SubgraphMetadata = {
  block: {
    number: number
    hash: string | null
  }
}

export type GraphqlFetch = typeof fetch

type GraphqlResponse<TData> = {
  data?: TData
  errors?: Array<{
    message: string
  }>
}

type PageVariables = {
  first: number
  idGt: string
}

type ServiceAddressVariables = {
  serviceAddress: string
}

type ServiceVariables = {
  serviceId: string
}

type RootSetIdsVariables = PageVariables & {
  setIds: string[]
}

const providersQuery = `#graphql
  query InventoryProviders($first: Int!, $idGt: String!) {
    providers(first: $first, where: { id_gt: $idGt }, orderBy: id, orderDirection: asc) {
      id
      address
    }
  }
`

const serviceByAddressQuery = `#graphql
  query InventoryServiceByAddress($serviceAddress: Bytes!) {
    services(first: 1, where: { address: $serviceAddress }) {
      id
      address
    }
  }
`

const dataSetsQuery = `#graphql
  query InventoryDataSets($first: Int!, $idGt: String!, $serviceId: Bytes!) {
    dataSets(first: $first, where: { id_gt: $idGt, listener: $serviceId }, orderBy: id, orderDirection: asc) {
      id
      setId
      nextPieceId
      owner {
        address
      }
      isActive
      status
    }
  }
`

const rootsQuery = `#graphql
  query InventoryRoots($first: Int!, $idGt: String!, $setIds: [BigInt!]!) {
    roots(first: $first, where: { id_gt: $idGt, setId_in: $setIds }, orderBy: id, orderDirection: asc) {
      id
      setId
      rootId
      cid
      removed
      proofSet {
        setId
      }
    }
  }
`

const metadataQuery = `#graphql
  query InventoryMetadata {
    _meta {
      block {
        number
        hash
      }
    }
  }
`

export async function fetchProvidersPage(
  subgraphUrl: string,
  idGt: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphProvider[]> {
  const response = await postGraphql<{ providers: SubgraphProvider[] }, PageVariables>(
    subgraphUrl,
    providersQuery,
    pageVariables(idGt),
    fetchFn
  )

  return response.providers
}

export async function fetchServiceByAddress(
  subgraphUrl: string,
  serviceAddress: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphService> {
  const response = await postGraphql<{ services: SubgraphService[] }, ServiceAddressVariables>(
    subgraphUrl,
    serviceByAddressQuery,
    { serviceAddress },
    fetchFn
  )
  const service = response.services[0]

  if (!service) {
    throw new Error(`FWSS service ${serviceAddress} was not found in the subgraph`)
  }

  return service
}

export async function fetchDataSetsPage(
  subgraphUrl: string,
  serviceId: string,
  idGt: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphDataSet[]> {
  const response = await postGraphql<{ dataSets: SubgraphDataSet[] }, PageVariables & ServiceVariables>(
    subgraphUrl,
    dataSetsQuery,
    {
      ...pageVariables(idGt),
      serviceId,
    },
    fetchFn
  )

  return response.dataSets
}

export async function fetchRootsPage(
  subgraphUrl: string,
  setIds: string[],
  idGt: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphRoot[]> {
  if (setIds.length === 0) {
    return []
  }

  const response = await postGraphql<{ roots: SubgraphRoot[] }, RootSetIdsVariables>(
    subgraphUrl,
    rootsQuery,
    {
      ...pageVariables(idGt),
      setIds,
    },
    fetchFn
  )

  return response.roots
}

export async function fetchSubgraphMetadata(
  subgraphUrl: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphMetadata> {
  const response = await postGraphql<{ _meta: SubgraphMetadata }, Record<string, never>>(
    subgraphUrl,
    metadataQuery,
    {},
    fetchFn
  )

  return response._meta
}

export async function fetchAllPages<TRow extends { id: string }>(
  fetchPage: (idGt: string) => Promise<TRow[]>
): Promise<TRow[]> {
  const rows: TRow[] = []
  let idGt = ''

  for (;;) {
    const page = await fetchPage(idGt)
    rows.push(...page)

    if (page.length < subgraphPageSize) {
      return rows
    }

    idGt = page[page.length - 1]?.id ?? idGt
  }
}

function pageVariables(idGt: string): PageVariables {
  return {
    first: subgraphPageSize,
    idGt,
  }
}

async function postGraphql<TData, TVariables extends Record<string, unknown>>(
  subgraphUrl: string,
  query: string,
  variables: TVariables,
  fetchFn: GraphqlFetch
): Promise<TData> {
  const response = await fetchFn(subgraphUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`Subgraph request failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as GraphqlResponse<TData>

  if (payload.errors?.length) {
    throw new Error(`Subgraph request failed: ${payload.errors.map((error) => error.message).join('; ')}`)
  }

  if (!payload.data) {
    throw new Error('Subgraph request returned no data')
  }

  return payload.data
}
