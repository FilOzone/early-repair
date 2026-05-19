import { relations } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as t from 'drizzle-orm/sqlite-core'
import { customType, sqliteTable as table } from 'drizzle-orm/sqlite-core'

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
  address: t.text().notNull(),
  params: jsonType().$type<Record<string, any>>().notNull(),
  createdAt: t.integer().notNull(),
  updatedAt: t.integer().notNull(),
})

export const operations = table('operations', {
  id: t.int().primaryKey({ autoIncrement: true }),
  repairId: t
    .int()
    .references((): AnySQLiteColumn => repairs.id)
    .notNull(),
  operation: t.text().notNull(),
  createdAt: t.integer().notNull(),
  updatedAt: t.integer().notNull(),
})

export const repairRelations = relations(repairs, ({ many }) => ({
  operations: many(operations),
}))
