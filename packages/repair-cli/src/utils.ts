import type { MetadataObject } from '@filoz/synapse-core'
import { type Chain, getChain } from '@filoz/synapse-core/chains'
import Conf from 'conf'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { getTableColumns, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { z } from 'incur'
import { request } from 'iso-web/http'
import pLocate from 'p-locate'
import terminalLink from 'terminal-link'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import packageJson from '../package.json' with { type: 'json' }
import * as schema from './local-schema.ts'
import type { Config, LocalDatabase } from './types.ts'

export const EARLY_REPAIR_SOURCE = 'early-repair6'

export const config = new Conf<Config>({
  projectName: packageJson.name,
  projectSuffix: '',
  schema: {
    privateKey: {
      type: 'string',
    },
    dbPath: {
      type: 'string',
    },
    indexerMainnetUrl: {
      type: 'string',
    },
    indexerCalibrationUrl: {
      type: 'string',
    },
    chainId: {
      type: 'number',
    },
  },
})

export const name = packageJson.name
export const version = packageJson.version

function privateKeyFromConfig() {
  const privateKey = config.get('privateKey')
  if (!privateKey) {
    throw new Error('Private key not found. Please run `repair-cli setup` first.')
  }
  return privateKey
}

/**
 * Create a private key client
 * If the private key is not found, it will throw an error
 *
 * @param chainId - The chain ID to use
 */
export function getClient(chainId: number) {
  const chain = getChain(chainId)

  const privateKey = privateKeyFromConfig()

  const account = privateKeyToAccount(privateKey)
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  return {
    client,
    chain,
  }
}

/**
 * Global options for the CLI
 * - debug - Debug mode
 */
export const globalOptions = z.object({
  debug: z.boolean().optional().default(false).describe('Debug mode'),
})

export async function createLocalDatabase(dbPath: string): Promise<LocalDatabase> {
  const localDb = drizzle(`file:${dbPath}`, {
    schema,
  }) as LocalDatabase

  await localDb.$client.execute('PRAGMA journal_mode = WAL')

  return localDb
}

export async function migrateLocalDatabase(db: LocalDatabase) {
  // @ts-expect-error - TODO: fix this
  const result = await pushSQLiteSchema(schema, db)
  if (result.hasDataLoss) {
    throw new Error('Data loss detected during migration')
  }
  if (result.warnings.length > 0) {
    throw new Error(`Warnings detected during migration:\n${result.warnings.join('\n')}`)
  }

  await result.apply()
  return result
}

/**
 * Create a link to the hash on the block explorer
 *
 * @param hash - The hash to create a link for
 * @param chain - The chain to use
 * @returns The link
 */
export function hashLink(hash: string, chain: Chain) {
  const link = terminalLink(hash, `${chain.blockExplorers?.default?.url}/tx/${hash}`)
  return link
}

/** Get metadata for the single IPFS-enabled repair dataset. */
export function getRepairDatasetMetadata(): MetadataObject {
  return {
    source: EARLY_REPAIR_SOURCE,
    withIPFSIndexing: '',
  }
}

/**
 * Get a piece from a service URL
 */
export async function getPiece({ pieceCid, serviceUrl }: { pieceCid: string; serviceUrl: string }) {
  const url = new URL(`/piece/${pieceCid}`, serviceUrl)
  const response = await request.head(url, {
    retry: {
      retries: 2,
    },
    timeout: 3000,
  })

  if (response.error) {
    console.log(response.error.message, url.toString())
    throw response.error
  }
  return pieceCid
}

/**
 * Find the piece on the providers
 *
 * @param providers - {@link string[]}
 * @param pieceCid - {@link string}
 * @returns The piece URL
 */
export async function findPieceOnProviders(providers: string[], pieceCid: string) {
  const result = await pLocate(
    providers.map((p) =>
      getPiece({
        serviceUrl: p,
        pieceCid,
      }).then(
        () => p,
        () => undefined
      )
    ),
    (p) => p !== undefined,
    { concurrency: 5 }
  )
  return result
}

export const buildConflictUpdateColumns = <T extends PgTable | SQLiteTable, Q extends keyof T['_']['columns']>(
  table: T,
  columns?: Q[]
) => {
  const cls = getTableColumns(table)
  const cols = columns ?? (Object.keys(cls) as Q[])
  const r = cols.reduce(
    (acc, column) => {
      const colName = cls[column].name

      acc[column] = sql.raw(`excluded.${colName}`)
      return acc
    },
    {} as Record<Q, SQL>
  )

  return r
}
