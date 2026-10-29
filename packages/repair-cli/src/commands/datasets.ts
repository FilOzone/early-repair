import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { Cli, z } from 'incur'
import { isAddress } from 'viem'
import { getDataSet, getProvider, listDataSetPieces, listDataSets, listProviders } from '../api.ts'
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
    stats: z.boolean().optional().default(false).describe('Include piece counts (slow: walks every piece)'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { api } = c.var
      const payer = c.options.payer?.toLowerCase() ?? c.var.client.account.address.toLowerCase()
      const [rows, providers] = await Promise.all([
        listDataSets(api, { owner: payer, providerId: c.options.providerId, deleted: false }),
        listProviders(api),
      ])
      const serviceUrls = new Map(providers.map((provider) => [provider.providerId, provider.serviceUrl]))

      const datasetsFlattened = []
      for (const dataset of rows.reverse()) {
        datasetsFlattened.push({
          id: dataset.dataSetId,
          withCdn: dataset.withCdn,
          withIpfsIndexing: dataset.withIpfsIndexing,
          source: dataset.source,
          provider: dataset.providerId == null ? null : serviceUrls.get(dataset.providerId),
          pdpEndEpoch: dataset.pdpEndEpoch,
          ...(c.options.stats && {
            pieces: (await listDataSetPieces(api, BigInt(dataset.dataSetId), { removed: false })).length,
          }),
        })
      }

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
      if (!dataset.provider) {
        return c.error({
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider ${dataset.providerId} for dataset ${dataset.dataSetId} is not available`,
          retryable: false,
        })
      }
      if (isInteractive) {
        spinner.message(`Terminating dataset ${dataset.dataSetId} at ${dataset.provider.pdp.serviceURL}...`)
      }
      const result = await SP.terminateService(c.var.client, {
        dataSetId: c.args.id,
        serviceURL: dataset.provider.pdp.serviceURL,
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
      const { api } = c.var
      const dataset = await getDataSet(api, c.args.id)

      if (!dataset) {
        return c.error({
          code: 'DATASET_NOT_FOUND',
          message: 'Dataset not found',
          retryable: false,
        })
      }
      const [provider, pieces] = await Promise.all([
        dataset.providerId == null ? null : getProvider(api, BigInt(dataset.providerId)),
        listDataSetPieces(api, c.args.id, { removed: false }),
      ])
      return c.ok({ ...dataset, provider, pieces: pieces.reverse() })
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
