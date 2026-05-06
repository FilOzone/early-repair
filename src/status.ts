import { existsSync } from 'node:fs'

import Database from 'better-sqlite3'

export const inventorySchemaVersion = 1

const stubInventoryTables = [
  'sync_metadata',
  'providers',
  'data_sets',
  'roots',
  'provider_registry_enrichment',
] as const

type StubSyncMetadataRow = {
  schema_version: number
  network: string | null
  subgraph_url: string | null
  rpc_url: string | null
  subgraph_block_number: number | null
  subgraph_block_hash: string | null
  started_at: string | null
  completed_at: string | null
}

export type InventoryStatus =
  | {
      exists: false
      path: string
      schemaVersion: null
      ok: true
      empty: true
      stale: 'unknown'
      metadata: null
      counts: Record<string, number>
    }
  | {
      exists: true
      path: string
      schemaVersion: number
      ok: true
      empty: boolean
      stale: 'unknown'
      metadata: {
        network: string | null
        subgraphUrl: string | null
        rpcUrl: string | null
        subgraphBlockNumber: number | null
        subgraphBlockHash: string | null
        startedAt: string | null
        completedAt: string | null
      }
      counts: Record<string, number>
    }

export class InventoryStatusError extends Error {
  readonly causeMessage: string | undefined

  constructor(message: string, cause: unknown) {
    super(cause instanceof Error ? `${message}: ${cause.message}` : message)
    this.name = 'InventoryStatusError'
    this.causeMessage = cause instanceof Error ? cause.message : undefined
  }
}

export class UnsupportedInventorySchemaError extends Error {
  constructor(message: string) {
    super(`${message}. Run sync to rebuild.`)
    this.name = 'UnsupportedInventorySchemaError'
  }
}

export function readInventoryStatus(dbPath: string): InventoryStatus {
  if (!existsSync(dbPath)) {
    return {
      exists: false,
      path: dbPath,
      schemaVersion: null,
      ok: true,
      empty: true,
      stale: 'unknown',
      metadata: null,
      counts: {},
    }
  }

  let db: Database.Database
  try {
    db = new Database(dbPath, { fileMustExist: true, readonly: true })
  } catch (error) {
    throw new InventoryStatusError(`Failed to open inventory DB at ${dbPath}`, error)
  }

  try {
    const stubSnapshot = readStubInventorySnapshot(db, dbPath)

    if (stubSnapshot.metadata.schema_version !== inventorySchemaVersion) {
      throw new UnsupportedInventorySchemaError(
        `Unsupported inventory DB schema version in ${dbPath}: expected ${inventorySchemaVersion}, got ${stubSnapshot.metadata.schema_version}`
      )
    }

    return {
      exists: true,
      path: dbPath,
      schemaVersion: stubSnapshot.metadata.schema_version,
      ok: true,
      empty: Object.values(stubSnapshot.counts).every((count) => count === 0),
      stale: 'unknown',
      metadata: {
        network: stubSnapshot.metadata.network,
        subgraphUrl: stubSnapshot.metadata.subgraph_url,
        rpcUrl: stubSnapshot.metadata.rpc_url,
        subgraphBlockNumber: stubSnapshot.metadata.subgraph_block_number,
        subgraphBlockHash: stubSnapshot.metadata.subgraph_block_hash,
        startedAt: stubSnapshot.metadata.started_at,
        completedAt: stubSnapshot.metadata.completed_at,
      },
      counts: stubSnapshot.counts,
    }
  } catch (error) {
    if (error instanceof UnsupportedInventorySchemaError) {
      throw error
    }

    throw new InventoryStatusError(`Failed to read inventory DB at ${dbPath}`, error)
  } finally {
    db.close()
  }
}

// Temporary DB reader stub for the status slice.
//
// The real inventory schema and Drizzle access layer will land with
// `sync`. Until then, status only proves the CLI contract:
// read-only open, exact unsupported-schema errors, latest metadata row,
// and live table counts for the provisional inventory tables.
function readStubInventorySnapshot(
  db: Database.Database,
  dbPath: string
): {
  metadata: StubSyncMetadataRow
  counts: Record<string, number>
} {
  validateStubTables(db, dbPath)

  return {
    metadata: readStubMetadata(db, dbPath),
    counts: readStubCounts(db),
  }
}

function validateStubTables(db: Database.Database, dbPath: string): void {
  const tableExists = db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").pluck()

  for (const table of stubInventoryTables) {
    if (tableExists.get(table) !== 1) {
      throw new UnsupportedInventorySchemaError(`Unsupported inventory DB schema in ${dbPath}: missing table ${table}`)
    }
  }
}

function readStubMetadata(db: Database.Database, dbPath: string): StubSyncMetadataRow {
  const row = db.prepare('select * from sync_metadata order by rowid desc limit 1').get() as
    | StubSyncMetadataRow
    | undefined

  if (!row) {
    throw new UnsupportedInventorySchemaError(`Unsupported inventory DB schema in ${dbPath}: missing sync_metadata row`)
  }

  if (typeof row.schema_version !== 'number') {
    throw new UnsupportedInventorySchemaError(
      `Unsupported inventory DB schema in ${dbPath}: sync_metadata.schema_version is missing`
    )
  }

  return row
}

function readStubCounts(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const table of stubInventoryTables) {
    if (table === 'sync_metadata') {
      continue
    }

    counts[table] = db.prepare(`select count(*) from ${table}`).pluck().get() as number
  }

  return counts
}
