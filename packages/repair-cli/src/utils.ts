import { type Chain, getChain } from '@filoz/synapse-core/chains'
import * as Piece from '@filoz/synapse-core/piece'
import type * as SP from '@filoz/synapse-core/sp'
import { getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { z } from 'incur'
import { Conf } from 'iso-conf'
import { request } from 'iso-web/http'
import pLocate from 'p-locate'
import terminalLink from 'terminal-link'
import { createWalletClient, type Hash, type Hex, http, TransactionReceiptNotFoundError } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getTransactionReceipt } from 'viem/actions'
import packageJson from '../package.json' with { type: 'json' }
import type { OperationSelect } from './local-schema.ts'
import * as schema from './local-schema.ts'
import type { LocalDatabase, WalletClient } from './types.ts'

export const configSchema = z.object({
  privateKey: z.string().optional(),
  indexerMainnetUrl: z.url().optional(),
  indexerCalibrationUrl: z.url().optional(),
  chainId: z.number().optional(),
  dbPath: z.string().optional(),
  source: z.string().optional(),
})

export const config = new Conf({
  projectName: packageJson.name,
  projectSuffix: '',
  schema: configSchema,
})

export const name = packageJson.name
export const version = packageJson.version

function privateKeyFromConfig() {
  const privateKey = config.get('privateKey')
  if (!privateKey) {
    throw new Error('Private key not found. Please run `repair-cli setup` first.')
  }
  return privateKey as Hex
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
  // Keep local DB setup runtime-only; drizzle-kit/api has undeclared deps that
  // break in pnpm dlx/pnpx installs of the published CLI.
  await db.$client.execute(`
    CREATE TABLE IF NOT EXISTS repairs (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      repair_provider_id text NOT NULL,
      target_provider_id text NOT NULL,
      target_provider_url text NOT NULL,
      target_data_set_id text,
      repair_data_set_id text,
      block_number text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `)
  try {
    await db.$client.execute(`
      ALTER TABLE repairs ADD COLUMN repair_data_set_id text
    `)
  } catch {
    // Column already exists on databases created with the updated schema.
  }
  await db.$client.execute(`
    CREATE TABLE IF NOT EXISTS operations (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      repair_id integer NOT NULL,
      type text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      cid text NOT NULL,
      metadata text NOT NULL,
      alternate_provider text NOT NULL,
      tx_hash text,
      error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (repair_id) REFERENCES repairs(id)
    )
  `)
  try {
    await db.$client.execute(`
      ALTER TABLE operations ADD COLUMN tx_hash text
    `)
  } catch {
    // Column already exists on databases created with the updated schema.
  }
  try {
    await db.$client.execute(`
      ALTER TABLE operations DROP COLUMN result
    `)
  } catch {
    // Column does not exist on databases created with the updated schema.
  }
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

/**
 * Mark operations with successful mined transactions as completed.
 *
 * @returns Operations that are not completed yet.
 */
export async function completeConfirmedOperations({
  localDb,
  client,
  operations,
}: {
  localDb: LocalDatabase
  client: WalletClient
  operations: OperationSelect[]
}): Promise<OperationSelect[]> {
  const hashes = new Set(
    operations.map((operation) => operation.txHash).filter((txHash): txHash is Hash => txHash != null)
  )
  const completedHashes = new Set<Hash>()

  for (const hash of hashes) {
    try {
      const receipt = await getTransactionReceipt(client, { hash })
      if (receipt.status === 'success') {
        completedHashes.add(hash)
      }
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) {
        throw error
      }
    }
  }

  const completedOperations = operations.filter(
    (operation) => operation.txHash != null && completedHashes.has(operation.txHash as Hash)
  )

  if (completedOperations.length > 0) {
    await localDb
      .update(schema.operations)
      .set({
        status: 'completed',
        error: null,
        updatedAt: Date.now(),
      })
      .where(
        inArray(
          schema.operations.id,
          completedOperations.map((operation) => operation.id)
        )
      )
  }
  const completedOperationIds = new Set(completedOperations.map((operation) => operation.id))

  return operations.filter((operation) => operation.status !== 'completed' && !completedOperationIds.has(operation.id))
}

/**
 * Get a piece from a service URL
 */
export async function getPiece({ pieceCid, serviceUrl }: { pieceCid: string; serviceUrl: string }) {
  const url = new URL(`/piece/${pieceCid}`, serviceUrl)
  const response = await request.head(url, {
    retry: {
      retries: 2,
      minTimeout: 250,
    },
    timeout: 3000,
  })

  if (response.error) {
    // console.log(response.error.message, url.toString())
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

/**
 * Filter out operations by CID
 */
export function excludeOperationsByCid(operations: OperationSelect[], cid: string) {
  const operationToCommit: OperationSelect[] = []
  const operationToFailed: OperationSelect[] = []
  for (const operation of operations) {
    if (operation.cid === cid) {
      operationToFailed.push(operation)
    } else {
      operationToCommit.push(operation)
    }
  }
  return { operationToCommit, operationToFailed }
}

/**
 * Convert operations to pull pieces deduped by CID
 */
export function operationsToPullPieces(operations: OperationSelect[]) {
  const cids = new Set<string>()
  const pieces: SP.PullPieceInput[] = []
  for (const operation of operations) {
    if (cids.has(operation.cid)) {
      continue
    }
    pieces.push({
      sourceUrl: Piece.createPieceUrlPDP({
        cid: operation.cid,
        serviceURL: operation.alternateProvider,
      }),
      pieceCid: Piece.from(operation.cid),
    })
    cids.add(operation.cid)
  }
  return pieces
}
