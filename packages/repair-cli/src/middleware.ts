import type { Chain } from '@filoz/synapse-core/chains'
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { middleware, z } from 'incur'
import type { Account, Client, Transport } from 'viem'
import * as indexerSchema from './indexer-schema.ts'
import * as localSchema from './local-schema.ts'
import type { IndexerDatabase, LocalDatabase } from './types.ts'
import { config, getClient } from './utils.ts'

export const contextSchema = z.object({
  indexerDb: z.custom<IndexerDatabase>(),
  localDb: z.custom<LocalDatabase>(),
  indexerSchema: z.custom<typeof indexerSchema>(),
  localSchema: z.custom<typeof localSchema>(),
  config: z.custom<typeof config>(),
  client: z.custom<Client<Transport, Chain, Account>>(),
  chain: z.custom<Chain>(),
})

export const contextMiddleware = middleware<typeof contextSchema>(async (c, next) => {
  const { dbPath, chainId, indexerMainnetUrl, indexerCalibrationUrl } = config.store
  const localDb = drizzleLibsql(`file:${dbPath}`, {
    schema: localSchema,
  })
  const indexerDb = drizzlePostgres(chainId === 314 ? indexerMainnetUrl : indexerCalibrationUrl, {
    schema: indexerSchema,
  })

  const { client, chain } = getClient(chainId)
  c.set('localDb', localDb)
  c.set('indexerDb', indexerDb)
  c.set('indexerSchema', indexerSchema)
  c.set('localSchema', localSchema)
  c.set('config', config)
  c.set('client', client)
  c.set('chain', chain)
  await next()

  localDb.$client.close()
  await indexerDb.$client.end()
})
