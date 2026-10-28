import { Cli, z } from 'incur'
import { getBlockNumber } from 'viem/actions'
import { listProviders, providerPiecePages } from '../api.ts'
import { getActiveDataSetIds } from '../db/get-active-data-set-ids.ts'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions } from '../utils.ts'

/** Format byte count as decimal gigabytes with two fractional digits. */
function formatBytesAsGb(bytes: bigint): string {
  const scaled = (bytes * 100n) / 1_000_000_000n
  const whole = scaled / 100n
  const fraction = scaled % 100n
  return `${whole}.${fraction.toString().padStart(2, '0')} GB`
}

/** Compare decimal ID strings numerically. */
function compareIds(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

export const providers = Cli.create('providers', {
  description: 'Provider commands',
  options: globalOptions,
  vars: contextSchema,
})

providers.command('list', {
  description: 'List all providers from the indexer',
  options: globalOptions.extend({
    all: z.boolean().optional().default(false).describe('Include all providers'),
    stats: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include piece count and total size (slow: walks every piece of each provider)'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { api } = c.var
      const rows = (await listProviders(api, { active: true }))
        .filter((provider) => provider.pdpProductActive && (c.options.all || provider.approved || provider.endorsed))
        .sort((a, b) => compareIds(a.providerId, b.providerId))

      const statsByProviderId = new Map<string, { pieceCount: number; totalSize: bigint }>()

      if (c.options.stats && rows.length > 0) {
        const blockNumber = await getBlockNumber(c.var.client)
        for (const provider of rows) {
          const providerId = BigInt(provider.providerId)
          const activeDataSetIds = await getActiveDataSetIds({ api, providerId, blockNumber })
          const stats = { pieceCount: 0, totalSize: 0n }
          for await (const pieces of providerPiecePages(api, providerId, { removed: false })) {
            for (const piece of pieces) {
              if (!activeDataSetIds.has(piece.dataSetId)) continue
              stats.pieceCount++
              stats.totalSize += BigInt(piece.rawSize ?? 0)
            }
          }
          statsByProviderId.set(provider.providerId, stats)
        }
      }

      const providersFlattened = rows.map((provider) => {
        const stats = statsByProviderId.get(provider.providerId)
        return {
          id: provider.providerId,
          name: provider.name,
          serviceUrl: provider.serviceUrl,
          approved: provider.approved,
          endorsed: provider.endorsed,
          ...(stats && { pieceCount: stats.pieceCount, totalSize: formatBytesAsGb(stats.totalSize) }),
        }
      })

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
