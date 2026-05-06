import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { initializeInventoryDb, openInventoryDb } from './db.ts'
import { inventoryTableNames } from './db-schema.ts'

describe('inventory DB', () => {
  it('initializes the expected tables', () => {
    const path = tempInventoryPath()
    const inventory = openInventoryDb(path, { mode: 'write' })
    initializeInventoryDb(inventory)

    const tableNames = inventory.sqlite
      .prepare<[], { name: string }>("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => row.name)

    assert.deepEqual(tableNames, [...inventoryTableNames].sort())

    const schemaVersion = inventory.sqlite
      .prepare('select schema_version from sync_metadata where id = 1')
      .pluck()
      .safeIntegers()
      .get()

    assert.equal(schemaVersion, 1n)

    inventory.close()
  })

  it('opens status DBs read-only', () => {
    const path = tempInventoryPath()
    const writable = openInventoryDb(path, { mode: 'write' })
    initializeInventoryDb(writable)
    writable.close()

    const readonly = openInventoryDb(path, { mode: 'status' })

    assert.notEqual(readonly, null)
    assert.equal(readonly?.sqlite.readonly, true)

    readonly?.close()
  })

  it('does not create missing DBs for status', () => {
    const path = tempInventoryPath()

    assert.equal(openInventoryDb(path, { mode: 'status' }), null)
    assert.equal(existsSync(path), false)
  })

  it('opens temp write DBs without creating the target DB', () => {
    const path = tempInventoryPath()
    const inventory = openInventoryDb(path, { mode: 'temp-write' })

    assert.notEqual(inventory.path, path)
    assert.equal(existsSync(inventory.path), true)
    assert.equal(existsSync(path), false)

    inventory.close()
  })
})

function tempInventoryPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'early-repair-db-')), 'inventory.sqlite')
}
