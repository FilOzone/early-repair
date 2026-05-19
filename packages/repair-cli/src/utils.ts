import { type Chain, getChain } from '@filoz/synapse-core/chains'
import Conf from 'conf'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { z } from 'incur'
import terminalLink from 'terminal-link'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import packageJson from '../package.json' with { type: 'json' }
import * as schema from './local-schema.ts'
import type { Config, LocalDatabase } from './types.ts'

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
