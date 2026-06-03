import type { MetadataObject } from '@filoz/synapse-core'
import type * as SP from '@filoz/synapse-core/sp'
import { relations } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as t from 'drizzle-orm/sqlite-core'
import { customType, sqliteTable as table } from 'drizzle-orm/sqlite-core'
import * as Json from 'iso-base/json'
import type { Address, Hash } from 'viem'

export type RepairStatus = 'pending' | 'completed' | 'failed'

export type OperationStatus = 'pending' | 'pulled' | 'committed' | 'completed' | 'failed' | 'skipped'
export type OperationType = 'create_dataset' | 'add_piece'

export interface CreateDatasetOperationData {
  payee: Address
}

export type CreateDatasetOperationResult = {
  txHash?: Hash
  dataSetId: bigint
}

export interface AddPieceOperationData {
  cid: string
  metadata: MetadataObject
  alternateProviders: string[]
}

export type AddPieceOperationResult = Omit<SP.AddPiecesSuccess, 'txStatus' | 'addMessageOk' | 'piecesAdded'>

export type OperationData = CreateDatasetOperationData | AddPieceOperationData

export type OperationResult = CreateDatasetOperationResult | AddPieceOperationResult

/**
 * Custom type for JSON
 * It will be used to store JSON data in the database
 */
export const jsonType = customType<{ data: Record<string, any> }>({
  dataType() {
    return 'text'
  },
  toDriver(value) {
    return Json.stringify(value)
  },
  fromDriver(value) {
    return Json.parse(value as string)
  },
})

export const bigintType = customType<{ data: bigint }>({
  dataType() {
    return 'text'
  },
  toDriver(value) {
    return value.toString()
  },
  fromDriver(value) {
    return BigInt(value as string)
  },
})

export type InsertRepair = typeof repairs.$inferInsert
export type SelectRepair = typeof repairs.$inferSelect

export const repairs = table('repairs', {
  id: t.int().primaryKey({ autoIncrement: true }),
  status: t.text().$type<RepairStatus>().notNull().default('pending'),
  repairProviderId: bigintType('repair_provider_id').notNull(),
  targetProviderId: bigintType('target_provider_id').notNull(),
  targetProviderUrl: t.text('target_provider_url').notNull(),
  targetDataSetId: bigintType('target_data_set_id'),
  blockNumber: bigintType('block_number').notNull(),
  createdAt: t.integer('created_at').notNull(),
  updatedAt: t.integer('updated_at').notNull(),
})

export type InsertOperation = typeof operations.$inferInsert
export type SelectOperation = typeof operations.$inferSelect

export const operations = table('operations', {
  id: t.int().primaryKey({ autoIncrement: true }),
  repairId: t
    .int('repair_id')
    .references((): AnySQLiteColumn => repairs.id)
    .notNull(),
  type: t.text().$type<OperationType>().notNull(),
  status: t.text().$type<OperationStatus>().notNull().default('pending'),
  data: jsonType().$type<OperationData>().notNull(),
  result: jsonType().$type<OperationResult>(),
  error: t.text(),
  createdAt: t.integer('created_at').notNull(),
  updatedAt: t.integer('updated_at').notNull(),
})

export const repairRelations = relations(repairs, ({ many }) => ({
  operations: many(operations),
}))

export const operationRelations = relations(operations, ({ one }) => ({
  repair: one(repairs, {
    fields: [operations.repairId],
    references: [repairs.id],
  }),
}))
