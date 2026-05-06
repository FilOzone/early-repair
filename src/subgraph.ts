export const subgraphPageSize = 1000

export type SubgraphProvider = {
  id: string
  address: string
}

export type SubgraphDataSet = {
  id: string
  setId: string
  owner: {
    address: string
  }
  isActive: boolean
  status: string
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

export type SubgraphPieceCount = {
  pieces: bigint
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

type ProviderDataSetsVariables = PageVariables & {
  providerId: string
  serviceId: string
}

type ServiceVariables = {
  serviceId: string
}

type DataSetRootsVariables = PageVariables & {
  dataSetId: string
}

const providersQuery = `#graphql
  query InventoryProviders($first: Int!, $idGt: String!) {
    providers(first: $first, where: { id_gt: $idGt }, orderBy: id, orderDirection: asc) {
      id
      address
    }
  }
`

const providerDataSetsQuery = `#graphql
  query InventoryProviderDataSets($first: Int!, $idGt: String!, $providerId: Bytes!, $serviceId: Bytes!) {
    dataSets(first: $first, where: { id_gt: $idGt, owner: $providerId, listener: $serviceId }, orderBy: id, orderDirection: asc) {
      id
      setId
      isActive
      status
    }
  }
`

const rootsQuery = `#graphql
  query InventoryRoots($first: Int!, $idGt: String!, $dataSetId: Bytes!) {
    roots(first: $first, where: { id_gt: $idGt, proofSet: $dataSetId }, orderBy: id, orderDirection: asc) {
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

const pieceCountQuery = `#graphql
  query InventoryPieceCount($serviceId: Bytes!) {
    service(id: $serviceId) {
      totalRoots
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

export async function fetchProviderDataSetsPage(
  subgraphUrl: string,
  provider: SubgraphProvider,
  serviceId: string,
  idGt: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphDataSet[]> {
  const response = await postGraphql<
    {
      dataSets: Array<Omit<SubgraphDataSet, 'owner'>>
    },
    ProviderDataSetsVariables
  >(
    subgraphUrl,
    providerDataSetsQuery,
    {
      ...pageVariables(idGt),
      providerId: provider.id,
      serviceId,
    },
    fetchFn
  )

  return response.dataSets.map((dataSet) => ({
    ...dataSet,
    owner: {
      address: provider.address,
    },
  }))
}

export async function fetchRootsPage(
  subgraphUrl: string,
  dataSet: SubgraphDataSet,
  idGt: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphRoot[]> {
  const response = await postGraphql<{ roots: SubgraphRoot[] }, DataSetRootsVariables>(
    subgraphUrl,
    rootsQuery,
    {
      ...pageVariables(idGt),
      dataSetId: dataSet.id,
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

export async function fetchSubgraphPieceCount(
  subgraphUrl: string,
  serviceId: string,
  fetchFn: GraphqlFetch = fetch
): Promise<SubgraphPieceCount> {
  const response = await postGraphql<{ service: { totalRoots: string | null } | null }, ServiceVariables>(
    subgraphUrl,
    pieceCountQuery,
    { serviceId },
    fetchFn
  )

  return {
    pieces: BigInt(response.service?.totalRoots ?? 0),
  }
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
