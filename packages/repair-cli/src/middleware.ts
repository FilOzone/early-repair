import type { Chain } from '@filoz/synapse-core/chains'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { middleware, z } from 'incur'
import type { Account, Client, Transport } from 'viem'
import * as indexerSchema from './indexer-schema.ts'
import type { IndexerDatabase, LocalDatabase } from './types.ts'
import { config, createLocalDatabase, getClient } from './utils.ts'

export const contextSchema = z.object({
  indexerDb: z.custom<IndexerDatabase>(),
  localDb: z.custom<LocalDatabase>(),
  config: z.custom<typeof config>(),
  client: z.custom<Client<Transport, Chain, Account>>(),
  chain: z.custom<Chain>(),
  source: z.string(),
})

export const contextMiddleware = middleware<typeof contextSchema>(async (c, next) => {
  const { dbPath, chainId, indexerMainnetUrl, indexerCalibrationUrl, source } = config.store

  if (!dbPath || !chainId || !indexerMainnetUrl || !indexerCalibrationUrl || !source) {
    return c.error({
      code: 'CONFIG_NOT_SET',
      message: 'Config not set. Please run `repair setup` first.',
      retryable: false,
    })
  }

  const localDb = await createLocalDatabase(dbPath)
  const indexerDb = drizzlePostgres(chainId === 314 ? indexerMainnetUrl : indexerCalibrationUrl, {
    schema: indexerSchema,
  })

  const { client, chain } = getClient(chainId)
  c.set('localDb', localDb)
  c.set('indexerDb', indexerDb)
  c.set('config', config)
  c.set('client', client)
  c.set('chain', chain)
  c.set('source', source)
  await next()

  localDb.$client.close()
  await indexerDb.$client.end()
})
