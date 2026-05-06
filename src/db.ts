import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import Database from 'better-sqlite3'
import { eq, type InferSelectModel } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

import { inventoryDataTableNames, inventorySchema, inventorySchemaVersion, syncMetadata } from './db-schema.ts'

export type InventoryDb = {
  path: string
  sqlite: Database.Database
  db: BetterSQLite3Database<typeof inventorySchema>
  close(): void
}

export type SyncMetadataRow = InferSelectModel<typeof syncMetadata>

export type OpenInventoryDbOptions =
  | {
      mode: 'status'
    }
  | {
      mode: 'write'
    }
  | {
      mode: 'temp-write'
    }

export type OpenInventoryDbResult<TOptions extends OpenInventoryDbOptions> = TOptions['mode'] extends 'status'
  ? InventoryDb | null
  : InventoryDb

type BetterSqliteError = Error & {
  code?: string
}

export class UnsupportedInventorySchemaError extends Error {
  constructor(message: string) {
    super(`${message}. Run sync to rebuild.`)
    this.name = 'UnsupportedInventorySchemaError'
  }
}

export function openInventoryDb<TOptions extends OpenInventoryDbOptions>(
  dbPath: string,
  options: TOptions
): OpenInventoryDbResult<TOptions> {
  if (options.mode === 'status' && !existsSync(dbPath)) {
    return null as OpenInventoryDbResult<TOptions>
  }

  if (options.mode !== 'status') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const path =
    options.mode === 'temp-write'
      ? join(dirname(dbPath), `.${basename(dbPath)}.tmp-${process.pid}-${Date.now()}`)
      : dbPath
  const inventory = createInventoryDb(path, {
    fileMustExist: options.mode === 'status',
    readonly: options.mode === 'status',
  })

  if (options.mode === 'status') {
    try {
      assertSupportedInventorySchema(inventory)
    } catch (error) {
      inventory.close()
      throw error
    }
  }

  return inventory as OpenInventoryDbResult<TOptions>
}

export function initializeInventoryDb(inventory: InventoryDb): void {
  inventory.sqlite.exec(inventorySchemaSql)
  inventory.sqlite
    .prepare('insert or ignore into sync_metadata (id, schema_version) values (1, ?)')
    .run(BigInt(inventorySchemaVersion))
}

export function readInventoryMetadata(inventory: InventoryDb): SyncMetadataRow {
  const row = inventory.db.select().from(syncMetadata).where(eq(syncMetadata.id, 1n)).get()

  if (!row) {
    throw new UnsupportedInventorySchemaError(
      `Unsupported inventory DB schema in ${inventory.path}: missing sync_metadata row`
    )
  }

  if (row.schemaVersion !== BigInt(inventorySchemaVersion)) {
    throw new UnsupportedInventorySchemaError(
      `Unsupported inventory DB schema version in ${inventory.path}: expected ${inventorySchemaVersion}, got ${row.schemaVersion}`
    )
  }

  return row
}

export function readInventoryTableCounts(inventory: InventoryDb): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const table of inventoryDataTableNames) {
    counts[table] = Number(inventory.sqlite.prepare(`select count(*) from ${table}`).pluck().safeIntegers().get())
  }

  return counts
}

function createInventoryDb(
  dbPath: string,
  options: {
    readonly: boolean
    fileMustExist: boolean
  }
): InventoryDb {
  const sqlite = new Database(dbPath, {
    fileMustExist: options.fileMustExist,
    readonly: options.readonly,
  })

  sqlite.defaultSafeIntegers()
  sqlite.pragma('foreign_keys = ON')

  return {
    path: dbPath,
    sqlite,
    db: drizzle(sqlite, { schema: inventorySchema }),
    close() {
      sqlite.close()
    },
  }
}

function assertSupportedInventorySchema(inventory: InventoryDb): void {
  try {
    readInventoryMetadata(inventory)
  } catch (error) {
    if (error instanceof UnsupportedInventorySchemaError) {
      throw error
    }

    if (isMissingSyncMetadataTableError(error)) {
      throw new UnsupportedInventorySchemaError(
        `Unsupported inventory DB schema in ${inventory.path}: missing sync_metadata table`
      )
    }

    throw error
  }
}

function isMissingSyncMetadataTableError(error: unknown): error is BetterSqliteError {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'SQLITE_ERROR' &&
    error.message.includes('no such table: sync_metadata')
  )
}

const inventorySchemaSql = `
create table if not exists sync_metadata (
  id integer primary key not null check (id = 1),
  schema_version integer not null,
  network text,
  subgraph_url text,
  rpc_url text,
  subgraph_block_number integer,
  subgraph_block_hash text,
  started_at text,
  completed_at text
);

create table if not exists providers (
  address text primary key not null,
  subgraph_id text not null unique
);

create table if not exists data_sets (
  set_id integer primary key not null,
  subgraph_id text not null unique,
  provider_address text not null references providers(address),
  is_active integer not null check (is_active in (0, 1)),
  status text not null
);

create index if not exists data_sets_provider_active_idx
  on data_sets(provider_address, is_active);

create table if not exists pieces (
  data_set_id integer not null references data_sets(set_id),
  piece_id integer not null,
  subgraph_id text not null unique,
  provider_address text not null references providers(address),
  cid text not null,
  removed integer not null check (removed in (0, 1)),
  primary key (data_set_id, piece_id)
);

create index if not exists pieces_cid_idx
  on pieces(cid);

create index if not exists pieces_provider_removed_idx
  on pieces(provider_address, removed);

create index if not exists pieces_cid_provider_removed_idx
  on pieces(cid, provider_address, removed);

create index if not exists pieces_data_set_removed_idx
  on pieces(data_set_id, removed);

create table if not exists provider_registry_enrichment (
  provider_id integer primary key not null,
  service_provider_address text not null unique,
  pdp_service_url text,
  name text,
  is_active integer not null check (is_active in (0, 1)),
  checked_at text not null,
  last_error text
);

create unique index if not exists provider_registry_enrichment_service_provider_address_idx
  on provider_registry_enrichment(service_provider_address);
`
