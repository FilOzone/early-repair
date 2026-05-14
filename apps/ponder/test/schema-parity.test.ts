import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tables as drizzleTables } from '@filoz/repair-db'
import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { dataSets, pieces, providers } from '../ponder.schema.ts'

const ponderTables = {
  providers,
  dataSets,
  pieces,
} as const

function columnName(column: unknown): string {
  return (column as { name: string }).name
}

function normalizeTable(table: unknown) {
  const config = getTableConfig(table as never)
  const columnSet = new Set(config.columns)
  const columnKeys = Object.fromEntries(
    Object.entries(table as Record<string, unknown>)
      .filter((entry): entry is [string, (typeof config.columns)[number]] => columnSet.has(entry[1] as never))
      .map(([key, column]) => [column.name, key])
      .sort(([left], [right]) => left.localeCompare(right))
  )

  const inlinePrimaryKeys = config.columns.filter((column) => column.primary).map((column) => [column.name])
  const compositePrimaryKeys = config.primaryKeys.map((primaryKey) => primaryKey.columns.map((column) => column.name))

  return {
    name: getTableName(table as never),
    columns: config.columns.map((column) => ({
      key: columnKeys[column.name],
      name: column.name,
      notNull: column.notNull,
      primary: column.primary,
      sqlType: column.getSQLType(),
    })),
    indexes: config.indexes
      .map((index) => ({
        columns: index.config.columns.map(columnName),
        unique: index.config.unique,
      }))
      .sort((left, right) => left.columns.join(',').localeCompare(right.columns.join(','))),
    primaryKeys: [...inlinePrimaryKeys, ...compositePrimaryKeys].sort((left, right) =>
      left.join(',').localeCompare(right.join(','))
    ),
  }
}

test('Ponder schema matches Drizzle schema', () => {
  for (const tableName of Object.keys(drizzleTables) as (keyof typeof drizzleTables)[]) {
    assert.deepEqual(normalizeTable(ponderTables[tableName]), normalizeTable(drizzleTables[tableName]), tableName)
  }
})
