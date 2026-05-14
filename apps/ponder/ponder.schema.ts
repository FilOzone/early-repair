import { tableNames } from '@filoz/repair-db'
import { index, onchainTable, primaryKey } from 'ponder'

export const providers = onchainTable(
  tableNames.providers,
  (t) => ({
    providerId: t.bigint().primaryKey(),
    providerAddress: t.text(),
    name: t.text(),
    serviceUrl: t.text(),
    providerActive: t.boolean().notNull(),
    pdpProductActive: t.boolean().notNull(),
    createdAtBlock: t.bigint(),
    updatedAtBlock: t.bigint().notNull(),
  }),
  (table) => ({
    providerAddressIdx: index().on(table.providerAddress),
  })
)

export const dataSets = onchainTable(
  tableNames.dataSets,
  (t) => ({
    dataSetId: t.bigint().primaryKey(),
    providerId: t.bigint().notNull(),
    metadata: t.jsonb(),
    pdpEndEpoch: t.bigint().notNull(),
    deleted: t.boolean().notNull(),
    empty: t.boolean().notNull(),
    createdAtBlock: t.bigint().notNull(),
    updatedAtBlock: t.bigint().notNull(),
  }),
  (table) => ({
    providerIdIdx: index().on(table.providerId),
  })
)

export const pieces = onchainTable(
  tableNames.pieces,
  (t) => ({
    dataSetId: t.bigint().notNull(),
    pieceId: t.bigint().notNull(),
    cid: t.text().notNull(),
    rawSize: t.bigint().notNull(),
    metadata: t.jsonb(),
    removed: t.boolean().notNull(),
    addedAtBlock: t.bigint().notNull(),
    removedAtBlock: t.bigint(),
    updatedAtBlock: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.dataSetId, table.pieceId] }),
    cidIdx: index().on(table.cid),
  })
)
