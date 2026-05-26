import { and, asc, eq } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions } from '../utils.ts'

export const providers = Cli.create('providers', {
  description: 'Provider commands',
  options: globalOptions,
  vars: contextSchema,
})

providers.command('list', {
  description: 'List all providers from the indexer',
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const schema = c.var.indexerDb._.fullSchema
      const rows = await c.var.indexerDb.query.providers.findMany({
        orderBy: [asc(schema.providers.providerId)],
        where: and(eq(schema.providers.providerActive, true), eq(schema.providers.pdpProductActive, true)),
      })

      const providersFlattened = rows.map((provider) => ({
        id: provider.providerId,
        name: provider.name,
        approved: provider.approved,
        endorsed: provider.endorsed,
      }))

      return c.ok({
        providers: providersFlattened,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'PROVIDERS_FAILED',
        message: error instanceof Error ? error.message : 'Failed to list providers',
        retryable: true,
      })
    }
  },
})
