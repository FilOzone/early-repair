import type { Client } from '@libsql/client'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { Hex } from 'viem'
import type * as indexerSchema from './indexer-schema.ts'
import type * as localSchema from './local-schema.ts'

export type LocalDatabase = LibSQLDatabase<typeof localSchema> & {
  $client: Client
}

export type IndexerDatabase = NodePgDatabase<typeof indexerSchema> & {
  $client: Pool
}

export interface Config {
  privateKey: Hex
  indexerUrl: string
  dbPath: string
}
