import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { middleware, z } from 'incur'
import * as indexerSchema from './indexer-schema.ts'
import * as localSchema from './local-schema.ts'
import type { IndexerDatabase, LocalDatabase } from './types.ts'
import { config } from './utils.ts'

export const contextSchema = z.object({
  indexerDb: z.custom<IndexerDatabase>(),
  localDb: z.custom<LocalDatabase>(),
  indexerSchema: z.custom<typeof indexerSchema>(),
  localSchema: z.custom<typeof localSchema>(),
  config: z.custom<typeof config>(),
})

export const contextMiddleware = middleware<typeof contextSchema>(async (c, next) => {
  const { dbPath, indexerUrl } = config.store
  const localDb = drizzleLibsql(`file:${dbPath}`, {
    schema: localSchema,
  })
  const indexerDb = drizzlePostgres(indexerUrl, {
    schema: indexerSchema,
  })
  c.set('localDb', localDb)
  c.set('indexerDb', indexerDb)
  c.set('indexerSchema', indexerSchema)
  c.set('localSchema', localSchema)
  c.set('config', config)
  await next()

  localDb.$client.close()
  await indexerDb.$client.end()
})
