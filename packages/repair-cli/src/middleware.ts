import type { Chain } from '@filoz/synapse-core/chains'
import { middleware, z } from 'incur'
import type { Account, Client, Transport } from 'viem'
import { createIndexerApi } from './api.ts'
import type { IndexerApi, LocalDatabase } from './types.ts'
import { config, createLocalDatabase, getClient } from './utils.ts'

export const contextSchema = z.object({
  api: z.custom<IndexerApi>(),
  localDb: z.custom<LocalDatabase>(),
  config: z.custom<typeof config>(),
  client: z.custom<Client<Transport, Chain, Account>>(),
  chain: z.custom<Chain>(),
  source: z.string(),
  isInteractive: z.boolean(),
})

export const contextMiddleware = middleware<typeof contextSchema>(async (c, next) => {
  const { dbPath, chainId, apiUrl, source } = config.store

  if (!dbPath || !chainId || !source) {
    return c.error({
      code: 'CONFIG_NOT_SET',
      message: 'Config not set. Please run `repair setup` first.',
      retryable: false,
    })
  }

  const localDb = await createLocalDatabase(dbPath)
  const api = createIndexerApi({ baseUrl: apiUrl, chainId })

  const { client, chain } = getClient(chainId)
  c.set('localDb', localDb)
  c.set('api', api)
  c.set('config', config)
  c.set('client', client)
  c.set('chain', chain)
  c.set('source', source)
  c.set('isInteractive', !c.agent && !c.formatExplicit)
  await next()

  localDb.$client.close()
})
