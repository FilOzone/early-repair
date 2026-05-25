import type { MetadataObject } from '@filoz/synapse-core'
import type * as SP from '@filoz/synapse-core/sp'
import { relations } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as t from 'drizzle-orm/sqlite-core'
import { customType, sqliteTable as table } from 'drizzle-orm/sqlite-core'
import type { Address } from 'viem'
import { parse, stringify } from './utils.ts'

export type RepairStatus = 'pending' | 'completed' | 'failed'
export type RepairTargetDataSets = Partial<Record<OperationGroup, bigint | null>>

export type OperationStatus = 'pending' | 'pulled' | 'committed' | 'completed' | 'failed' | 'skipped'
export type OperationType = 'create_dataset' | 'add_piece'
export type OperationGroup = 'cdn' | 'ipfs' | 'both' | 'none'

export interface CreateDatasetOperationData {
  serviceUrl: string
  payee: Address
}

export type CreateDatasetOperationResult = Omit<
  SP.CreateDataSetSuccess,
  'txStatus' | 'ok' | 'dataSetCreated' | 'service'
>

export interface AddPieceOperationData {
  cid: string
  serviceUrl: string
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
    return stringify(value)
  },
  fromDriver(value) {
    return parse(value as string)
  },
})

export type InsertRepair = typeof repairs.$inferInsert
export type SelectRepair = typeof repairs.$inferSelect

export const repairs = table('repairs', {
  id: t.int().primaryKey({ autoIncrement: true }),
  status: t.text().$type<RepairStatus>().notNull().default('pending'),
  repairProviderId: t.text('repair_provider_id').notNull(),
  targetProviderId: t.text('target_provider_id').notNull(),
  targetDataSets: jsonType('target_data_sets').$type<RepairTargetDataSets>().notNull(),
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
  group: t.text().$type<OperationGroup>().notNull(),
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
