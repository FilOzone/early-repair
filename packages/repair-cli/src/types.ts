import type { Chain } from '@filoz/synapse-core/chains'
import type { Client } from '@libsql/client'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { Account, Hex, Transport, Client as ViemClient } from 'viem'
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
  indexerMainnetUrl: string
  indexerCalibrationUrl: string
  chainId: number
  dbPath: string
}

export type IndexerSchema = typeof indexerSchema
export type LocalSchema = typeof localSchema
export type WalletClient = ViemClient<Transport, Chain, Account>

export type Group = 'cdn' | 'ipfs' | 'both' | 'none'

export const PIECE_GROUPS = ['cdn', 'ipfs', 'both', 'none'] as const satisfies readonly Group[]

export type IndexerQueryOptions = {
  indexerDb: IndexerDatabase
  indexerSchema: IndexerSchema
}
