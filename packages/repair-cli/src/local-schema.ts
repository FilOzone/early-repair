import { relations } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as t from 'drizzle-orm/sqlite-core'
import { customType, sqliteTable as table } from 'drizzle-orm/sqlite-core'
import type { Address } from 'viem'

export type RepairStatus = 'pending' | 'running' | 'completed' | 'failed'
export type RepairOperationStatus = 'pending' | 'pulling' | 'committing' | 'completed' | 'failed'
export type RepairOperationType = 'create_dataset' | 'add_piece'
export type RepairPieceGroup = 'cdn' | 'ipfs' | 'both' | 'none'

export interface CreateDatasetOperationData {
  serviceUrl: string
  payee: Address
}

export interface AddPieceOperationData {
  cid: string
  serviceUrl: string
  metadata: Record<string, string>
}

export type OperationData = CreateDatasetOperationData | AddPieceOperationData

/**
 * Custom type for JSON
 * It will be used to store JSON data in the database
 */
export const jsonType = customType<{ data: Record<string, any> }>({
  dataType() {
    return 'text'
  },
  toDriver(value) {
    return JSON.stringify(value)
  },
  fromDriver(value) {
    return JSON.parse(value as string)
  },
})

export const repairs = table('repairs', {
  id: t.int().primaryKey({ autoIncrement: true }),
  status: t.text().$type<RepairStatus>().notNull().default('pending'),
  repairProviderId: t.text('repair_provider_id').notNull(),
  targetProviderId: t.text('target_provider_id').notNull(),
  createdAt: t.integer().notNull(),
  updatedAt: t.integer().notNull(),
})

export type InsertOperation = typeof operations.$inferInsert
export type SelectOperation = typeof operations.$inferSelect

export const operations = table('operations', {
  id: t.int().primaryKey({ autoIncrement: true }),
  repairId: t
    .int()
    .references((): AnySQLiteColumn => repairs.id)
    .notNull(),
  type: t.text().$type<RepairOperationType>().notNull(),
  status: t.text().$type<RepairOperationStatus>().notNull().default('pending'),
  group: t.text().$type<RepairPieceGroup>().notNull(),
  data: jsonType().$type<OperationData>().notNull(),
  error: t.text(),
  createdAt: t.integer().notNull(),
  updatedAt: t.integer().notNull(),
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
