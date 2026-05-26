import type { MetadataObject } from '@filoz/synapse-core'
import { type Chain, getChain } from '@filoz/synapse-core/chains'
import Conf from 'conf'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { getTableColumns, SQL, sql } from 'drizzle-orm'
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
import type { Config, Group, LocalDatabase } from './types.ts'

export const EARLY_REPAIR_SOURCE = 'early-repair5'

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

export async function migrateLocalDatabase(db: LocalDatabase) {
  // @ts-expect-error - db type needs fixing
  const result = await pushSQLiteSchema(schema, db)
  if (result.hasDataLoss) {
    throw new Error('Data loss detected during migration')
  }
  if (result.warnings.length > 0) {
    throw new Error(`Warnings detected during migration:\n${result.warnings.join('\n')}}`)
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

/**
 * Get the metadata for a group
 *
 * @param group - The group to get the metadata for
 * @returns The metadata for the group
 */
export function getMetadataForGroup(group: Group): MetadataObject {
  switch (group) {
    case 'cdn':
      return {
        source: EARLY_REPAIR_SOURCE,
        withCDN: '',
      }
    case 'ipfs':
      return {
        source: EARLY_REPAIR_SOURCE,
        withIPFSIndexing: '',
      }
    case 'both':
      return {
        source: EARLY_REPAIR_SOURCE,
        withCDN: '',
        withIPFSIndexing: '',
      }
    case 'none':
      return {
        source: EARLY_REPAIR_SOURCE,
      }
    default:
      throw new Error(`Invalid group: ${group}`)
  }
}

/**
 * Get the flags for a group
 *
 * @param group - The group to get the flags for
 * @returns The flags for the group
 */
export function groupFlags(group: Group): { withCdn: boolean; withIpfsIndexing: boolean } {
  switch (group) {
    case 'both':
      return { withCdn: true, withIpfsIndexing: true }
    case 'cdn':
      return { withCdn: true, withIpfsIndexing: false }
    case 'ipfs':
      return { withCdn: false, withIpfsIndexing: true }
    case 'none':
      return { withCdn: false, withIpfsIndexing: false }
  }
}

// JSON.stringify and JSON.parse with URL, Map and Uint8Array type support.

/**
 * Json replacer with URL, Map, Set, BitInt, RegExp and Uint8Array type support.
 *
 * @param {string} _k
 * @param {unknown} v
 */
export const replacer = (_k: string, v: any) => {
  if (v instanceof URL) {
    return { $url: v.toString() }
  }
  if (v instanceof Map) {
    return { $map: [...v.entries()] }
  }
  if (v instanceof Uint8Array) {
    return { $bytes: [...v.values()] }
  }
  if (v instanceof ArrayBuffer) {
    return { $bytes: [...new Uint8Array(v).values()] }
  }
  if (v?.type === 'Buffer' && Array.isArray(v.data)) {
    return { $bytes: v.data }
  }
  if (typeof v === 'bigint') {
    return { $bigint: v.toString() }
  }
  if (v instanceof Set) {
    return { $set: [...v.values()] }
  }
  if (v instanceof RegExp) {
    return { $regex: [v.source, v.flags] }
  }
  return v
}

// const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/**
 * Json reviver with URL, Map, Set, BitInt, RegExp and Uint8Array type support.
 *
 * @param {string} _k - key
 * @param {any} v - value
 */
export const reviver = (_k: string, v: any) => {
  if (!v) return v
  if (v.$url) return new URL(v.$url)
  if (v.$map) return new Map(v.$map)
  if (v.$bytes) return new Uint8Array(v.$bytes)
  if (v.$bigint) return BigInt(v.$bigint)
  //   if (typeof v === 'string' && isoDateRegex.test(v)) return new Date(v)
  if (v.$set) return new Set(v.$set)
  if (v.$regex) return new RegExp(v.$regex[0], v.$regex[1])
  return v
}

/**
 * @param {any} value
 * @param {number|string} [space]
 */
export const stringify = (value: any, space?: number | string) => JSON.stringify(value, replacer, space)

/** @param {string} value */
export const parse = (value: string) => JSON.parse(value, reviver)

/**
 * Get a piece from a service URL
 */
export async function getPiece({ pieceCid, serviceUrl }: { pieceCid: string; serviceUrl: string }) {
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })
  const response = await request.json.get<{ pieceCid: string }>(new URL(`pdp/piece?${params.toString()}`, serviceUrl), {
    retry: {
      retries: 3,
    },
    timeout: 5000,
  })
  if (response.error) {
    throw response.error
  }
  return response.result.pieceCid
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
        () => null
      )
    ),
    (p) => {
      if (p !== null) {
        return true
      }
      return false
    },
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
