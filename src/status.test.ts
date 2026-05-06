import { strict as assert } from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import Database from 'better-sqlite3'

import { readInventoryStatus, UnsupportedInventorySchemaError } from './status.ts'

describe('inventory status', () => {
  it('reports a missing DB without creating it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')

    const status = readInventoryStatus(path)

    assert.equal(status.exists, false)
    assert.equal(status.path, path)
    assert.equal(status.schemaVersion, null)
    assert.deepEqual(status.counts, {})
  })

  it('reads provisional stub metadata and counts from a supported DB', () => {
    const path = createInventoryDb()

    const status = readInventoryStatus(path)

    assert.equal(status.exists, true)
    assert.equal(status.schemaVersion, 1)
    assert.equal(status.empty, false)
    assert.equal(status.counts.providers, 1)
    assert.equal(status.metadata.network, 'calibration')
  })

  it('includes the exact missing-table detail in unsupported schema errors', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')
    const db = new Database(path)
    db.exec('create table sync_metadata (schema_version integer not null)')
    db.exec('insert into sync_metadata (schema_version) values (1)')
    db.close()

    assert.throws(
      () => readInventoryStatus(path),
      (error) =>
        error instanceof UnsupportedInventorySchemaError &&
        error.message === `Unsupported inventory DB schema in ${path}: missing table providers. Run sync to rebuild.`
    )
  })

  it('includes the exact schema version detail in unsupported schema errors', () => {
    const path = createInventoryDb({ schemaVersion: 2 })

    assert.throws(
      () => readInventoryStatus(path),
      (error) =>
        error instanceof UnsupportedInventorySchemaError &&
        error.message === `Unsupported inventory DB schema version in ${path}: expected 1, got 2. Run sync to rebuild.`
    )
  })
})

function createInventoryDb(options: { schemaVersion?: number } = {}): string {
  const path = join(mkdtempSync(join(tmpdir(), 'early-repair-status-')), 'inventory.sqlite')
  const db = new Database(path)

  db.exec(`
    create table sync_metadata (
      schema_version integer not null,
      network text,
      subgraph_url text,
      rpc_url text,
      subgraph_block_number integer,
      subgraph_block_hash text,
      started_at text,
      completed_at text
    );

    create table providers (
      address text primary key
    );

    create table data_sets (
      id text primary key
    );

    create table roots (
      id text primary key
    );

    create table provider_registry_enrichment (
      provider_id integer primary key
    );

    insert into sync_metadata (
      schema_version,
      network,
      subgraph_url,
      rpc_url,
      subgraph_block_number,
      subgraph_block_hash,
      started_at,
      completed_at
    ) values (
      ${options.schemaVersion ?? 1},
      'calibration',
      'https://example.com/subgraph',
      'https://example.com/rpc',
      123,
      '0xabc',
      '2026-05-06T10:00:00.000Z',
      '2026-05-06T10:01:00.000Z'
    );

    insert into providers (address) values ('0x1');
    insert into data_sets (id) values ('set-1');
    insert into roots (id) values ('root-1');
    insert into provider_registry_enrichment (provider_id) values (100);
  `)

  db.close()

  return path
}
