import { renameSync, rmSync } from 'node:fs'

import { type InventoryDb, initializeInventoryDb, openInventoryDb } from './db.ts'
import { recordSyncMetadata, upsertDataSets, upsertPieces, upsertProviders } from './inventory-import.ts'
import {
  fetchProviderDataSetsPage,
  fetchProvidersPage,
  fetchRootsPage,
  fetchSubgraphMetadata,
  fetchSubgraphPieceCount,
  type GraphqlFetch,
  type SubgraphDataSet,
  type SubgraphProvider,
  subgraphPageSize,
} from './subgraph.ts'

export type SyncCollection = 'providers' | 'data_sets' | 'pieces'

export type SyncProgressEvent =
  | {
      type: 'temp-db-opened'
      dbPath: string
      tempDbPath: string
    }
  | {
      type: 'schema-initialized'
    }
  | {
      type: 'page-fetched'
      collection: SyncCollection
      page: number
      idGt: string
      rows: number
      totalRows: number
      done: boolean
      providerAddress?: string
      dataSetId?: string
      dataSetSetId?: string
    }
  | {
      type: 'rows-imported'
      collection: SyncCollection
      rows: number
    }
  | {
      type: 'piece-count-fetched'
      pieces: bigint
    }
  | {
      type: 'metadata-fetched'
      subgraphBlockNumber: number
      subgraphBlockHash: string | null
    }
  | {
      type: 'metadata-recorded'
    }
  | {
      type: 'db-replaced'
      dbPath: string
    }
  | {
      type: 'complete'
      result: SyncInventoryResult
    }

export type SyncInventoryOptions = {
  dbPath: string
  network: string
  subgraphUrl: string
  fwssServiceAddress: string
  rpcUrl?: string | null
  fetchFn?: GraphqlFetch
  now?: () => Date
  onProgress?: (event: SyncProgressEvent) => void
}

export type SyncInventoryResult = {
  dbPath: string
  providers: number
  dataSets: number
  pieces: number
  subgraphBlockNumber: number
  subgraphBlockHash: string | null
}

export async function syncInventory(options: SyncInventoryOptions): Promise<SyncInventoryResult> {
  const now = options.now ?? (() => new Date())
  const fetchFn = options.fetchFn ?? fetch
  const fwssServiceAddress = options.fwssServiceAddress.toLowerCase()
  const startedAt = now().toISOString()
  const inventory = openInventoryDb(options.dbPath, { mode: 'temp-write' })
  let shouldRemoveTemp = true

  try {
    options.onProgress?.({
      type: 'temp-db-opened',
      dbPath: options.dbPath,
      tempDbPath: inventory.path,
    })

    initializeInventoryDb(inventory)
    options.onProgress?.({ type: 'schema-initialized' })

    const providers = await fetchInventoryPages('providers', options, (idGt) =>
      fetchProvidersPage(options.subgraphUrl, idGt, fetchFn)
    )
    upsertProviders(inventory, providers)
    options.onProgress?.({ type: 'rows-imported', collection: 'providers', rows: providers.length })

    const dataSetImport = await fetchAndImportProviderDataSets(
      providers,
      inventory,
      options,
      fwssServiceAddress,
      fetchFn
    )
    options.onProgress?.({ type: 'rows-imported', collection: 'data_sets', rows: dataSetImport.count })

    const pieceCount = await fetchSubgraphPieceCount(options.subgraphUrl, fwssServiceAddress, fetchFn)
    options.onProgress?.({ type: 'piece-count-fetched', pieces: pieceCount.pieces })

    const pieceCountImported = await fetchAndImportDataSetRoots(dataSetImport.dataSets, inventory, options, fetchFn)
    options.onProgress?.({ type: 'rows-imported', collection: 'pieces', rows: pieceCountImported })

    const subgraphMetadata = await fetchSubgraphMetadata(options.subgraphUrl, fetchFn)
    options.onProgress?.({
      type: 'metadata-fetched',
      subgraphBlockNumber: subgraphMetadata.block.number,
      subgraphBlockHash: subgraphMetadata.block.hash,
    })
    const completedAt = now().toISOString()

    recordSyncMetadata(inventory, {
      network: options.network,
      subgraphUrl: options.subgraphUrl,
      rpcUrl: options.rpcUrl ?? null,
      startedAt,
      completedAt,
      subgraph: subgraphMetadata,
    })
    options.onProgress?.({ type: 'metadata-recorded' })

    inventory.close()
    renameSync(inventory.path, options.dbPath)
    shouldRemoveTemp = false
    options.onProgress?.({ type: 'db-replaced', dbPath: options.dbPath })

    const result = {
      dbPath: options.dbPath,
      providers: providers.length,
      dataSets: dataSetImport.count,
      pieces: pieceCountImported,
      subgraphBlockNumber: subgraphMetadata.block.number,
      subgraphBlockHash: subgraphMetadata.block.hash,
    }
    options.onProgress?.({ type: 'complete', result })

    return result
  } finally {
    if (inventory.sqlite.open) {
      inventory.close()
    }

    if (shouldRemoveTemp) {
      rmSync(inventory.path, { force: true })
    }
  }
}

async function fetchAndImportProviderDataSets(
  providers: SubgraphProvider[],
  inventory: InventoryDb,
  options: SyncInventoryOptions,
  fwssServiceAddress: string,
  fetchFn: GraphqlFetch
): Promise<{
  count: number
  dataSets: SubgraphDataSet[]
}> {
  const dataSets: SubgraphDataSet[] = []

  for (const provider of providers) {
    await fetchAndImportInventoryPages(
      'data_sets',
      options,
      (idGt) => fetchProviderDataSetsPage(options.subgraphUrl, provider, fwssServiceAddress, idGt, fetchFn),
      (page) => {
        upsertDataSets(inventory, page)
        dataSets.push(...page)
      },
      {
        providerAddress: provider.address,
        initialTotalRows: dataSets.length,
      }
    )
  }

  return {
    count: dataSets.length,
    dataSets,
  }
}

async function fetchAndImportDataSetRoots(
  dataSets: SubgraphDataSet[],
  inventory: InventoryDb,
  options: SyncInventoryOptions,
  fetchFn: GraphqlFetch
): Promise<number> {
  let pieceCount = 0

  for (const dataSet of dataSets) {
    const dataSetPieceCount = await fetchAndImportInventoryPages(
      'pieces',
      options,
      (idGt) => fetchRootsPage(options.subgraphUrl, dataSet, idGt, fetchFn),
      (page) => upsertPieces(inventory, page),
      {
        dataSetId: dataSet.id,
        dataSetSetId: dataSet.setId,
        initialTotalRows: pieceCount,
      }
    )
    pieceCount += dataSetPieceCount
  }

  return pieceCount
}

async function fetchAndImportInventoryPages<TRow extends { id: string }>(
  collection: SyncCollection,
  options: SyncInventoryOptions,
  fetchPage: (idGt: string) => Promise<TRow[]>,
  importPage: (page: TRow[]) => void,
  progressContext: {
    providerAddress?: string
    dataSetId?: string
    dataSetSetId?: string
    initialTotalRows?: number
  } = {}
): Promise<number> {
  let rowCount = 0
  let idGt = ''
  let pageNumber = 1

  for (;;) {
    const page = await fetchPage(idGt)
    importPage(page)
    rowCount += page.length

    const done = page.length < subgraphPageSize
    options.onProgress?.({
      type: 'page-fetched',
      collection,
      page: pageNumber,
      idGt,
      rows: page.length,
      totalRows: (progressContext.initialTotalRows ?? 0) + rowCount,
      done,
      ...(progressContext.providerAddress ? { providerAddress: progressContext.providerAddress } : {}),
      ...(progressContext.dataSetId ? { dataSetId: progressContext.dataSetId } : {}),
      ...(progressContext.dataSetSetId ? { dataSetSetId: progressContext.dataSetSetId } : {}),
    })

    if (done) {
      return rowCount
    }

    idGt = page[page.length - 1]?.id ?? idGt
    pageNumber += 1
  }
}

async function fetchInventoryPages<TRow extends { id: string }>(
  collection: SyncCollection,
  options: SyncInventoryOptions,
  fetchPage: (idGt: string) => Promise<TRow[]>,
  progressContext: {
    providerAddress?: string
    dataSetId?: string
    dataSetSetId?: string
    initialTotalRows?: number
  } = {}
): Promise<TRow[]> {
  const rows: TRow[] = []
  let idGt = ''
  let pageNumber = 1

  for (;;) {
    const page = await fetchPage(idGt)
    rows.push(...page)

    const done = page.length < subgraphPageSize
    options.onProgress?.({
      type: 'page-fetched',
      collection,
      page: pageNumber,
      idGt,
      rows: page.length,
      totalRows: (progressContext.initialTotalRows ?? 0) + rows.length,
      done,
      ...(progressContext.providerAddress ? { providerAddress: progressContext.providerAddress } : {}),
      ...(progressContext.dataSetId ? { dataSetId: progressContext.dataSetId } : {}),
      ...(progressContext.dataSetSetId ? { dataSetSetId: progressContext.dataSetSetId } : {}),
    })

    if (done) {
      return rows
    }

    idGt = page[page.length - 1]?.id ?? idGt
    pageNumber += 1
  }
}
