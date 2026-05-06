import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { and, count, eq } from 'drizzle-orm'

import { initializeInventoryDb, openInventoryDb } from './db.ts'
import { dataSets, pieces, providers, syncMetadata } from './db-schema.ts'
import { upsertDataSets, upsertPieces, upsertProviders } from './inventory-import.ts'
import { type SyncProgressEvent, syncInventory } from './sync.ts'

type MockGraphqlRequest = {
  operation: string
  variables: Record<string, unknown>
}

const testFwssServiceAddress = '0xfwss'

describe('inventory sync', () => {
  it('paginates subgraph collections with id_gt and first 1000', async () => {
    const providerPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `provider-${index.toString().padStart(4, '0')}`,
      address: `0x${index.toString().padStart(40, '0')}`,
    }))
    const requests: MockGraphqlRequest[] = []

    await syncInventory({
      dbPath: tempInventoryPath(),
      network: 'calibration',
      subgraphUrl: 'https://example.test/subgraph',
      fwssServiceAddress: testFwssServiceAddress,
      rpcUrl: 'https://example.test/rpc',
      fetchFn: mockGraphqlFetch(requests, {
        InventoryProviders: [
          { providers: providerPage },
          { providers: [{ id: 'provider-1000', address: '0x1000000000000000000000000000000000000000' }] },
        ],
        InventoryPieceCount: [{ service: { totalRoots: '0' } }],
        InventoryRoots: [{ roots: [] }],
        InventoryMetadata: [{ _meta: { block: { number: 123, hash: '0xabc' } } }],
      }),
    })

    assert.deepEqual(
      requests.filter((request) => request.operation === 'InventoryProviders').map((request) => request.variables),
      [
        { first: 1000, idGt: '' },
        { first: 1000, idGt: 'provider-0999' },
      ]
    )
  })

  it('reports progress for temp DB setup, page fetches, imports, metadata, replacement, and completion', async () => {
    const events: SyncProgressEvent[] = []

    await syncInventory({
      dbPath: tempInventoryPath(),
      network: 'calibration',
      subgraphUrl: 'https://example.test/subgraph',
      fwssServiceAddress: testFwssServiceAddress,
      fetchFn: mockGraphqlFetch([], basicSyncPages()),
      onProgress: (event) => events.push(event),
    })

    assert.deepEqual(
      events.map((event) => event.type),
      [
        'temp-db-opened',
        'schema-initialized',
        'page-fetched',
        'rows-imported',
        'page-fetched',
        'page-fetched',
        'rows-imported',
        'piece-count-fetched',
        'page-fetched',
        'page-fetched',
        'rows-imported',
        'metadata-fetched',
        'metadata-recorded',
        'db-replaced',
        'complete',
      ]
    )
    assert.deepEqual(
      events.filter((event) => event.type === 'page-fetched'),
      [
        { type: 'page-fetched', collection: 'providers', page: 1, idGt: '', rows: 2, totalRows: 2, done: true },
        {
          type: 'page-fetched',
          collection: 'data_sets',
          page: 1,
          idGt: '',
          rows: 1,
          totalRows: 1,
          done: true,
          providerAddress: '0xprovider1',
        },
        {
          type: 'page-fetched',
          collection: 'data_sets',
          page: 1,
          idGt: '',
          rows: 1,
          totalRows: 2,
          done: true,
          providerAddress: '0xprovider2',
        },
        {
          type: 'page-fetched',
          collection: 'pieces',
          page: 1,
          idGt: '',
          rows: 2,
          totalRows: 2,
          done: true,
          dataSetId: 'dataset-1',
          dataSetSetId: '1',
        },
        {
          type: 'page-fetched',
          collection: 'pieces',
          page: 1,
          idGt: '',
          rows: 1,
          totalRows: 3,
          done: true,
          dataSetId: 'dataset-2',
          dataSetSetId: '2',
        },
      ]
    )
    assert.deepEqual(
      events.filter((event) => event.type === 'rows-imported'),
      [
        { type: 'rows-imported', collection: 'providers', rows: 2 },
        { type: 'rows-imported', collection: 'data_sets', rows: 2 },
        { type: 'rows-imported', collection: 'pieces', rows: 3 },
      ]
    )
    assert.deepEqual(
      events.find((event) => event.type === 'piece-count-fetched'),
      {
        type: 'piece-count-fetched',
        pieces: 3n,
      }
    )
    assert.deepEqual(
      events.find((event) => event.type === 'metadata-fetched'),
      {
        type: 'metadata-fetched',
        subgraphBlockNumber: 123,
        subgraphBlockHash: '0xabc',
      }
    )
  })

  it('queries the expected piece count before fetching piece pages', async () => {
    const requests: MockGraphqlRequest[] = []

    await syncInventory({
      dbPath: tempInventoryPath(),
      network: 'calibration',
      subgraphUrl: 'https://example.test/subgraph',
      fwssServiceAddress: testFwssServiceAddress,
      fetchFn: mockGraphqlFetch(requests, basicSyncPages()),
    })

    assert.deepEqual(
      requests.map((request) => request.operation),
      [
        'InventoryProviders',
        'InventoryProviderDataSets',
        'InventoryProviderDataSets',
        'InventoryPieceCount',
        'InventoryRoots',
        'InventoryRoots',
        'InventoryMetadata',
      ]
    )
    assert.deepEqual(
      requests
        .filter((request) => request.operation === 'InventoryProviderDataSets')
        .map((request) => request.variables),
      [
        { first: 1000, idGt: '', providerId: 'provider-1', serviceId: testFwssServiceAddress },
        { first: 1000, idGt: '', providerId: 'provider-2', serviceId: testFwssServiceAddress },
      ]
    )
    assert.deepEqual(requests.find((request) => request.operation === 'InventoryPieceCount')?.variables, {
      serviceId: testFwssServiceAddress,
    })
    assert.deepEqual(
      requests.filter((request) => request.operation === 'InventoryRoots').map((request) => request.variables),
      [
        { first: 1000, idGt: '', dataSetId: 'dataset-1' },
        { first: 1000, idGt: '', dataSetId: 'dataset-2' },
      ]
    )
  })

  it('imports providers, data sets, pieces, and sync metadata into the expected tables', async () => {
    const path = tempInventoryPath()

    await syncInventory({
      dbPath: path,
      network: 'mainnet',
      subgraphUrl: 'https://example.test/subgraph',
      fwssServiceAddress: testFwssServiceAddress,
      rpcUrl: 'https://example.test/rpc',
      now: fixedClock(['2026-05-06T10:00:00.000Z', '2026-05-06T10:00:05.000Z']),
      fetchFn: mockGraphqlFetch([], basicSyncPages()),
    })

    const inventory = openInventoryDb(path, { mode: 'status' })
    if (!inventory) {
      throw new Error('expected inventory DB to exist')
    }

    assert.deepEqual(
      inventory.db.select({ address: providers.address, subgraphId: providers.subgraphId }).from(providers).all(),
      [
        { address: '0xprovider1', subgraphId: 'provider-1' },
        { address: '0xprovider2', subgraphId: 'provider-2' },
      ]
    )
    assert.deepEqual(
      inventory.db
        .select({
          setId: dataSets.setId,
          providerAddress: dataSets.providerAddress,
          isActive: dataSets.isActive,
          status: dataSets.status,
        })
        .from(dataSets)
        .all(),
      [
        { setId: 1n, providerAddress: '0xprovider1', isActive: true, status: 'READY' },
        { setId: 2n, providerAddress: '0xprovider2', isActive: true, status: 'READY' },
      ]
    )
    assert.deepEqual(
      inventory.db
        .select({
          dataSetId: pieces.dataSetId,
          pieceId: pieces.pieceId,
          providerAddress: pieces.providerAddress,
          cid: pieces.cid,
          removed: pieces.removed,
        })
        .from(pieces)
        .orderBy(pieces.dataSetId, pieces.pieceId)
        .all(),
      [
        { dataSetId: 1n, pieceId: 10n, providerAddress: '0xprovider1', cid: 'baga-cid-1', removed: false },
        { dataSetId: 1n, pieceId: 11n, providerAddress: '0xprovider1', cid: 'baga-cid-1', removed: false },
        { dataSetId: 2n, pieceId: 10n, providerAddress: '0xprovider2', cid: 'baga-cid-1', removed: false },
      ]
    )
    assert.deepEqual(inventory.db.select().from(syncMetadata).where(eq(syncMetadata.id, 1n)).get(), {
      id: 1n,
      schemaVersion: 1n,
      network: 'mainnet',
      subgraphUrl: 'https://example.test/subgraph',
      rpcUrl: 'https://example.test/rpc',
      subgraphBlockNumber: 123n,
      subgraphBlockHash: '0xabc',
      startedAt: '2026-05-06T10:00:00.000Z',
      completedAt: '2026-05-06T10:00:05.000Z',
    })

    inventory.close()
  })

  it('imports large dataset and piece syncs page-by-page without exceeding SQLite variable limits', async () => {
    const rowCount = 7000
    const result = await syncInventory({
      dbPath: tempInventoryPath(),
      network: 'calibration',
      subgraphUrl: 'https://example.test/subgraph',
      fwssServiceAddress: testFwssServiceAddress,
      fetchFn: mockGraphqlFetch([], largeSyncPages(rowCount)),
    })

    assert.equal(result.providers, 1)
    assert.equal(result.dataSets, rowCount)
    assert.equal(result.pieces, rowCount)
  })

  it('preserves repeated CIDs across providers as separate piece rows', async () => {
    const path = await syncBasicInventory()
    const inventory = openInventoryDb(path, { mode: 'status' })
    if (!inventory) {
      throw new Error('expected inventory DB to exist')
    }

    assert.deepEqual(
      inventory.db
        .select({
          dataSetId: pieces.dataSetId,
          pieceId: pieces.pieceId,
          providerAddress: pieces.providerAddress,
        })
        .from(pieces)
        .where(eq(pieces.cid, 'baga-cid-1'))
        .orderBy(pieces.dataSetId, pieces.pieceId)
        .all(),
      [
        { dataSetId: 1n, pieceId: 10n, providerAddress: '0xprovider1' },
        { dataSetId: 1n, pieceId: 11n, providerAddress: '0xprovider1' },
        { dataSetId: 2n, pieceId: 10n, providerAddress: '0xprovider2' },
      ]
    )

    inventory.close()
  })

  it('allows duplicate CIDs within one data set only as distinct set_id and piece_id rows', () => {
    const path = tempInventoryPath()
    const inventory = openInventoryDb(path, { mode: 'write' })
    initializeInventoryDb(inventory)
    upsertProviders(inventory, [{ id: 'provider-1', address: '0xprovider1' }])
    upsertDataSets(inventory, [
      { id: 'dataset-1', setId: '1', owner: { address: '0xprovider1' }, isActive: true, status: 'READY' },
    ])

    upsertPieces(inventory, [
      { id: 'root-1-10', setId: '1', rootId: '10', cid: 'baga-cid-1', removed: false, proofSet: { setId: '1' } },
      { id: 'root-1-11', setId: '1', rootId: '11', cid: 'baga-cid-1', removed: false, proofSet: { setId: '1' } },
      { id: 'root-1-11', setId: '1', rootId: '11', cid: 'baga-cid-1', removed: false, proofSet: { setId: '1' } },
    ])

    assert.equal(
      inventory.db
        .select({ count: count() })
        .from(pieces)
        .where(and(eq(pieces.dataSetId, 1n), eq(pieces.cid, 'baga-cid-1')))
        .get()?.count,
      2
    )

    inventory.close()
  })

  it('leaves the previous DB untouched when sync fails', async () => {
    const path = tempInventoryPath()
    const previous = openInventoryDb(path, { mode: 'write' })
    initializeInventoryDb(previous)
    upsertProviders(previous, [{ id: 'previous-provider', address: '0xprevious' }])
    previous.close()

    await assert.rejects(
      () =>
        syncInventory({
          dbPath: path,
          network: 'calibration',
          subgraphUrl: 'https://example.test/subgraph',
          fwssServiceAddress: testFwssServiceAddress,
          fetchFn: async () => {
            throw new Error('mock subgraph outage')
          },
        }),
      /mock subgraph outage/
    )

    assert.equal(existsSync(path), true)

    const inventory = openInventoryDb(path, { mode: 'status' })
    if (!inventory) {
      throw new Error('expected inventory DB to exist')
    }
    assert.deepEqual(
      inventory.db.select({ address: providers.address, subgraphId: providers.subgraphId }).from(providers).all(),
      [{ address: '0xprevious', subgraphId: 'previous-provider' }]
    )
    inventory.close()
  })
})

function tempInventoryPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'early-repair-sync-')), 'inventory.sqlite')
}

async function syncBasicInventory(): Promise<string> {
  const path = tempInventoryPath()

  await syncInventory({
    dbPath: path,
    network: 'calibration',
    subgraphUrl: 'https://example.test/subgraph',
    fwssServiceAddress: testFwssServiceAddress,
    fetchFn: mockGraphqlFetch([], basicSyncPages()),
  })

  return path
}

function basicSyncPages(): Record<string, Array<Record<string, unknown>>> {
  return {
    InventoryProviders: [
      {
        providers: [
          { id: 'provider-1', address: '0xprovider1' },
          { id: 'provider-2', address: '0xprovider2' },
        ],
      },
    ],
    InventoryProviderDataSets: [
      {
        dataSets: [{ id: 'dataset-1', setId: '1', isActive: true, status: 'READY' }],
      },
      {
        dataSets: [{ id: 'dataset-2', setId: '2', isActive: true, status: 'READY' }],
      },
    ],
    InventoryRoots: [
      {
        roots: [
          { id: 'root-1-10', setId: '1', rootId: '10', cid: 'baga-cid-1', removed: false, proofSet: { setId: '1' } },
          { id: 'root-1-11', setId: '1', rootId: '11', cid: 'baga-cid-1', removed: false, proofSet: { setId: '1' } },
        ],
      },
      {
        roots: [
          { id: 'root-2-10', setId: '2', rootId: '10', cid: 'baga-cid-1', removed: false, proofSet: { setId: '2' } },
        ],
      },
    ],
    InventoryPieceCount: [{ service: { totalRoots: '3' } }],
    InventoryMetadata: [{ _meta: { block: { number: 123, hash: '0xabc' } } }],
  }
}

function largeSyncPages(rowCount: number): Record<string, Array<Record<string, unknown>>> {
  return {
    InventoryProviders: [
      {
        providers: [{ id: 'provider-1', address: '0xprovider1' }],
      },
    ],
    InventoryProviderDataSets: [
      ...chunkRows(
        Array.from({ length: rowCount }, (_, index) => ({
          id: `dataset-${index + 1}`,
          setId: String(index + 1),
          isActive: true,
          status: 'READY',
        }))
      ).map((dataSets) => ({ dataSets })),
      { dataSets: [] },
    ],
    InventoryPieceCount: [{ service: { totalRoots: String(rowCount) } }],
    InventoryRoots: [
      ...Array.from({ length: rowCount }, (_, index) => ({
        roots: [
          {
            id: `root-${index + 1}`,
            setId: String(index + 1),
            rootId: '1',
            cid: `baga-cid-${index + 1}`,
            removed: false,
            proofSet: { setId: String(index + 1) },
          },
        ],
      })),
    ],
    InventoryMetadata: [{ _meta: { block: { number: 123, hash: '0xabc' } } }],
  }
}

function chunkRows<TRow>(rows: TRow[]): TRow[][] {
  const chunks: TRow[][] = []

  for (let index = 0; index < rows.length; index += 1000) {
    chunks.push(rows.slice(index, index + 1000))
  }

  return chunks
}

function mockGraphqlFetch(
  requests: MockGraphqlRequest[],
  pages: Record<string, Array<Record<string, unknown>>>
): typeof fetch {
  const nextPageByOperation = new Map<string, number>()

  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables?: Record<string, unknown>
    }
    const operation = body.query.match(/query\s+(\w+)/)?.[1]

    if (!operation) {
      throw new Error('mock fetch received query without operation name')
    }

    requests.push({
      operation,
      variables: body.variables ?? {},
    })

    const nextPage = nextPageByOperation.get(operation) ?? 0
    nextPageByOperation.set(operation, nextPage + 1)

    const data =
      pages[operation]?.[nextPage] ?? (operation === 'InventoryProviderDataSets' ? { dataSets: [] } : undefined)

    if (!data) {
      throw new Error(`mock fetch has no page ${nextPage} for ${operation}`)
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  }
}

function fixedClock(timestamps: string[]): () => Date {
  let index = 0

  return () => new Date(timestamps[index++] ?? timestamps[timestamps.length - 1] ?? '2026-05-06T00:00:00.000Z')
}
