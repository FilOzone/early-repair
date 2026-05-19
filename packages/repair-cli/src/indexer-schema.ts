import { relations } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core'

export type JsonRecord = Record<string, string>

const schema = pgSchema('early-repair')

export const providers = schema.table(
  'providers',
  {
    providerId: bigint('provider_id', { mode: 'bigint' }).primaryKey(),
    providerAddress: text('provider_address'),
    name: text('name'),
    serviceUrl: text('service_url'),
    providerActive: boolean('provider_active').notNull(),
    pdpProductActive: boolean('pdp_product_active').notNull(),
    createdAtBlock: bigint('created_at_block', { mode: 'bigint' }),
    updatedAtBlock: bigint('updated_at_block', { mode: 'bigint' }).notNull(),
  },
  (table) => [index('providers_provider_address_idx').on(table.providerAddress)]
)

export const providersRelations = relations(providers, ({ many }) => ({
  dataSets: many(dataSets),
}))

export const dataSets = schema.table(
  'data_sets',
  {
    dataSetId: bigint('data_set_id', { mode: 'bigint' }).primaryKey(),
    providerId: bigint('provider_id', { mode: 'bigint' }).notNull(),
    metadata: jsonb('metadata').$type<JsonRecord | null>(),
    pdpEndEpoch: bigint('pdp_end_epoch', { mode: 'bigint' }).notNull(),
    deleted: boolean('deleted').notNull(),
    createdAtBlock: bigint('created_at_block', { mode: 'bigint' }).notNull(),
    updatedAtBlock: bigint('updated_at_block', { mode: 'bigint' }).notNull(),
  },
  (table) => [index('data_sets_provider_id_idx').on(table.providerId)]
)

export const dataSetsRelations = relations(dataSets, ({ one, many }) => ({
  provider: one(providers, {
    fields: [dataSets.providerId],
    references: [providers.providerId],
  }),
  pieces: many(pieces),
}))

export const pieces = schema.table(
  'pieces',
  {
    dataSetId: bigint('data_set_id', { mode: 'bigint' }).notNull(),
    pieceId: bigint('piece_id', { mode: 'bigint' }).notNull(),
    cid: text('cid').notNull(),
    rawSize: bigint('raw_size', { mode: 'bigint' }).notNull(),
    metadata: jsonb('metadata').$type<JsonRecord | null>(),
    removed: boolean('removed').notNull(),
    addedAtBlock: bigint('added_at_block', { mode: 'bigint' }).notNull(),
    removedAtBlock: bigint('removed_at_block', { mode: 'bigint' }),
    updatedAtBlock: bigint('updated_at_block', { mode: 'bigint' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.dataSetId, table.pieceId] }), index('pieces_cid_idx').on(table.cid)]
)

export const piecesRelations = relations(pieces, ({ one }) => ({
  dataSet: one(dataSets, {
    fields: [pieces.dataSetId],
    references: [dataSets.dataSetId],
  }),
}))
