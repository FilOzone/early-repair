import { sql } from 'drizzle-orm'
import { check, customType, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const inventorySchemaVersion = 1

// Drizzle's SQLite integer column maps to number; use a custom type for 64-bit IDs.
const int64 = customType<{
  data: bigint
  driverData: bigint
}>({
  dataType() {
    return 'integer'
  },
  fromDriver(value) {
    return BigInt(value)
  },
  toDriver(value) {
    return value
  },
})

export const syncMetadata = sqliteTable(
  'sync_metadata',
  {
    id: int64('id').primaryKey(),
    schemaVersion: int64('schema_version').notNull(),
    network: text('network'),
    subgraphUrl: text('subgraph_url'),
    rpcUrl: text('rpc_url'),
    subgraphBlockNumber: int64('subgraph_block_number'),
    subgraphBlockHash: text('subgraph_block_hash'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (table) => [check('sync_metadata_single_row', sql`${table.id} = 1`)]
)

export const providers = sqliteTable('providers', {
  address: text('address').primaryKey(),
  subgraphId: text('subgraph_id').notNull().unique(),
})

export const dataSets = sqliteTable(
  'data_sets',
  {
    setId: int64('set_id').primaryKey(),
    subgraphId: text('subgraph_id').notNull().unique(),
    providerAddress: text('provider_address')
      .notNull()
      .references(() => providers.address),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    status: text('status').notNull(),
  },
  (table) => [index('data_sets_provider_active_idx').on(table.providerAddress, table.isActive)]
)

export const pieces = sqliteTable(
  'pieces',
  {
    dataSetId: int64('data_set_id')
      .notNull()
      .references(() => dataSets.setId),
    pieceId: int64('piece_id').notNull(),
    subgraphId: text('subgraph_id').notNull().unique(),
    providerAddress: text('provider_address')
      .notNull()
      .references(() => providers.address),
    cid: text('cid').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dataSetId, table.pieceId] }),
    index('pieces_cid_idx').on(table.cid),
    index('pieces_provider_removed_idx').on(table.providerAddress, table.removed),
    index('pieces_cid_provider_removed_idx').on(table.cid, table.providerAddress, table.removed),
    index('pieces_data_set_removed_idx').on(table.dataSetId, table.removed),
  ]
)

export const providerRegistryEnrichment = sqliteTable(
  'provider_registry_enrichment',
  {
    providerId: int64('provider_id').primaryKey(),
    serviceProviderAddress: text('service_provider_address').notNull().unique(),
    pdpServiceUrl: text('pdp_service_url'),
    name: text('name'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    checkedAt: text('checked_at').notNull(),
    lastError: text('last_error'),
  },
  (table) => [uniqueIndex('provider_registry_enrichment_service_provider_address_idx').on(table.serviceProviderAddress)]
)

export const inventorySchema = {
  syncMetadata,
  providers,
  dataSets,
  pieces,
  providerRegistryEnrichment,
}

export const inventoryTableNames = [
  'sync_metadata',
  'providers',
  'data_sets',
  'pieces',
  'provider_registry_enrichment',
] as const

export const inventoryDataTableNames = inventoryTableNames.filter((table) => table !== 'sync_metadata')
