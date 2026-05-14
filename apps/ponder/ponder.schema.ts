import { tableNames } from '@filoz/repair-db'
import { index, onchainTable, primaryKey } from 'ponder'

export const providers = onchainTable(
  tableNames.providers,
  (t) => ({
    providerId: t.int8({ mode: 'bigint' }).primaryKey(),
    providerAddress: t.text(),
    name: t.text(),
    serviceUrl: t.text(),
    providerActive: t.boolean().notNull(),
    pdpProductActive: t.boolean().notNull(),
    createdAtBlock: t.int8({ mode: 'bigint' }),
    updatedAtBlock: t.int8({ mode: 'bigint' }).notNull(),
  }),
  (table) => ({
    providerAddressIdx: index().on(table.providerAddress),
  })
)

export const dataSets = onchainTable(
  tableNames.dataSets,
  (t) => ({
    dataSetId: t.int8({ mode: 'bigint' }).primaryKey(),
    providerId: t.int8({ mode: 'bigint' }).notNull(),
    metadata: t.jsonb(),
    pdpEndEpoch: t.int8({ mode: 'bigint' }).notNull(),
    deleted: t.boolean().notNull(),
    createdAtBlock: t.int8({ mode: 'bigint' }).notNull(),
    updatedAtBlock: t.int8({ mode: 'bigint' }).notNull(),
  }),
  (table) => ({
    providerIdIdx: index().on(table.providerId),
  })
)

export const pieces = onchainTable(
  tableNames.pieces,
  (t) => ({
    dataSetId: t.int8({ mode: 'bigint' }).notNull(),
    pieceId: t.int8({ mode: 'bigint' }).notNull(),
    cid: t.text().notNull(),
    rawSize: t.int8({ mode: 'bigint' }).notNull(),
    metadata: t.jsonb(),
    removed: t.boolean().notNull(),
    addedAtBlock: t.int8({ mode: 'bigint' }).notNull(),
    removedAtBlock: t.int8({ mode: 'bigint' }),
    updatedAtBlock: t.int8({ mode: 'bigint' }).notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.dataSetId, table.pieceId] }),
    cidIdx: index().on(table.cid),
  })
)
