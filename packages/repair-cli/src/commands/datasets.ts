import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { and, asc, eq } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { isAddress } from 'viem'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions, hashLink } from '../utils.ts'

export const datasets = Cli.create('datasets', {
  description: 'Dataset commands',
  options: globalOptions,
  vars: contextSchema,
})

datasets.command('list', {
  description: 'List all datasets owned by the repair wallet',
  options: globalOptions.extend({
    providerId: z.coerce.bigint().optional().describe('Filter datasets by provider ID'),
    payer: z.string().refine(isAddress, 'Invalid address').optional().describe('Filter datasets by payer address'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const schema = c.var.indexerDb._.fullSchema
      const payer = c.options.payer?.toLowerCase() ?? c.var.client.account.address.toLowerCase()
      const conditions = [eq(schema.dataSets.deleted, false), eq(schema.dataSets.payer, payer)]

      if (c.options.providerId != null) {
        conditions.push(eq(schema.dataSets.providerId, c.options.providerId))
      }

      const datasets = await c.var.indexerDb.query.dataSets.findMany({
        where: and(...conditions),
        with: {
          provider: true,
          pieces: {
            where: eq(c.var.indexerDb._.fullSchema.pieces.removed, false),
          },
        },
        orderBy: [asc(schema.dataSets.dataSetId)],
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

datasets.command('terminate', {
  description: 'Terminate a dataset',
  args: z.object({
    id: z.coerce.bigint().describe('Dataset ID to terminate'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { isInteractive } = c.var
    const spinner = p.spinner()
    try {
      if (isInteractive) {
        spinner.start('Getting dataset...')
      }
      const dataset = await getPdpDataSet(c.var.client, { dataSetId: c.args.id })
      if (!dataset) {
        return c.error({
          code: 'DATASET_NOT_FOUND',
          message: 'Dataset not found',
          retryable: false,
        })
      }
      if (isInteractive) {
        spinner.message(`Terminating dataset ${dataset?.dataSetId} at ${dataset?.provider.pdp.serviceURL}...`)
      }
      const result = await SP.terminateService(c.var.client, {
        dataSetId: c.args.id,
        serviceURL: dataset?.provider.pdp.serviceURL,
      })

      const waitForResult = await SP.waitForTerminateService({
        statusUrl: result.statusUrl,
        onHash: (hash) => {
          if (isInteractive) {
            spinner.message(`Waiting for tx ${hashLink(hash, c.var.chain)} to be mined...`)
          }
        },
      })
      if (isInteractive) {
        spinner.stop(`Dataset ${dataset?.dataSetId} terminated successfully.`)
      }
      return c.ok(waitForResult)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to terminate the dataset'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'DATASETS_FAILED',
        message: msg,
        retryable: true,
      })
    }
  },
})

datasets.command('show', {
  description: 'Show a dataset',
  args: z.object({
    id: z.coerce.bigint().describe('Dataset ID to show'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const dataset = await c.var.indexerDb.query.dataSets.findFirst({
        where: eq(c.var.indexerDb._.fullSchema.dataSets.dataSetId, c.args.id),
        with: {
          provider: true,
          pieces: {
            where: eq(c.var.indexerDb._.fullSchema.pieces.removed, false),
          },
        },
      })

      if (!dataset) {
        return c.error({
          code: 'DATASET_NOT_FOUND',
          message: 'Dataset not found',
          retryable: false,
        })
      }
      return c.ok(dataset)
    } catch (error) {
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'DATASETS_FAILED',
        message: error instanceof Error ? error.message : 'Failed to terminate the dataset',
        retryable: true,
      })
    }
  },
})
