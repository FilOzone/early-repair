import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import Database from 'better-sqlite3'

import { initializeInventoryDb, openInventoryDb } from './db.ts'
import { readInventoryStatus, UnsupportedInventorySchemaError } from './status.ts'

describe('inventory status', () => {
  it('reports a missing DB without creating it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')

    const status = readInventoryStatus(path)

    assert.equal(status.exists, false)
    assert.equal(status.path, path)
    assert.equal(status.schemaVersion, null)
    assert.deepEqual(status.counts, {})
    assert.equal(existsSync(path), false)
  })

  it('reads an empty initialized DB', () => {
    const path = createInitializedInventoryDb()

    const status = readInventoryStatus(path)

    assert.equal(status.exists, true)
    assert.equal(status.schemaVersion, 1)
    assert.equal(status.empty, true)
    assert.deepEqual(status.counts, {
      providers: 0,
      data_sets: 0,
      pieces: 0,
      provider_registry_enrichment: 0,
    })
    assert.equal(status.metadata.network, null)
  })

  it('reports missing sync metadata as unsupported schema', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')
    const db = new Database(path)
    db.exec('create table providers (address text primary key)')
    db.close()

    assert.throws(
      () => readInventoryStatus(path),
      (error) =>
        error instanceof UnsupportedInventorySchemaError &&
        error.message ===
          `Unsupported inventory DB schema in ${path}: missing sync_metadata table. Run sync to rebuild.`
    )
  })

  it('includes the exact schema version detail in unsupported schema errors', () => {
    const path = createInitializedInventoryDb()
    const db = new Database(path)
    db.prepare('update sync_metadata set schema_version = ? where id = 1').run(2)
    db.close()

    assert.throws(
      () => readInventoryStatus(path),
      (error) =>
        error instanceof UnsupportedInventorySchemaError &&
        error.message === `Unsupported inventory DB schema version in ${path}: expected 1, got 2. Run sync to rebuild.`
    )
  })
})

function createInitializedInventoryDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')
  const inventory = openInventoryDb(path, { mode: 'write' })
  initializeInventoryDb(inventory)
  inventory.close()

  return path
}
