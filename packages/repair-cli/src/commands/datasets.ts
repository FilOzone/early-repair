import { and, eq } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions } from '../utils.ts'
export const datasets = Cli.create('datasets', {
  description: 'Dataset commands',
  options: globalOptions,
  vars: contextSchema,
})

datasets.command('list', {
  description: 'List all datasets',
  options: globalOptions.extend({
    providerId: z.coerce.bigint().optional().describe('Filter datasets by provider ID'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const conditions = [
        eq(c.var.indexerSchema.dataSets.deleted, false),
        eq(c.var.indexerSchema.dataSets.payer, c.var.client.account.address.toLowerCase()),
      ]
      if (c.options.providerId != null) {
        conditions.push(eq(c.var.indexerSchema.dataSets.providerId, c.options.providerId))
      }

      const datasets = await c.var.indexerDb.query.dataSets.findMany({
        where: and(...conditions),
        with: {
          provider: true,
          pieces: true,
        },
      })

      const datasetsFlattened = datasets.map((dataset) => {
        const { provider, pieces } = dataset
        return {
          id: dataset.dataSetId,
          withCdn: dataset.withCdn,
          withIpfsIndexing: dataset.withIpfsIndexing,
          source: dataset.source,
          provider: provider.serviceUrl,
          pdpEndEpoch: dataset.pdpEndEpoch,
          pieces: pieces.length,
          //   metadata: JSON.stringify(dataset.metadata),
        }
      })

      return c.ok({
        datasets: datasetsFlattened,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'DATASETS_FAILED',
        message: error instanceof Error ? error.message : 'Failed to list datasets',
        retryable: true,
      })
    }
  },
})
