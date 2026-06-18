import { and, asc, count, eq, inArray, isNull, lte, or, type SQLWrapper, sum } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { getBlockNumber } from 'viem/actions'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions } from '../utils.ts'

/** Format byte count as decimal gigabytes with two fractional digits. */
function formatBytesAsGb(bytes: bigint): string {
  const scaled = (bytes * 100n) / 1_000_000_000n
  const whole = scaled / 100n
  const fraction = scaled % 100n
  return `${whole}.${fraction.toString().padStart(2, '0')} GB`
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
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const schema = c.var.indexerDb._.fullSchema
      const filters: (SQLWrapper | undefined)[] = [
        eq(schema.providers.providerActive, true),
        eq(schema.providers.pdpProductActive, true),
      ]
      if (!c.options.all) {
        filters.push(or(eq(schema.providers.approved, true), eq(schema.providers.endorsed, true)))
      }
      const blockNumber = await getBlockNumber(c.var.client)
      const rows = await c.var.indexerDb.query.providers.findMany({
        orderBy: [asc(schema.providers.providerId)],
        where: and(...filters),
      })

      const providerIds = rows.map((provider) => provider.providerId)
      const statsByProviderId = new Map<bigint, { pieceCount: number; totalSize: bigint }>()

      if (providerIds.length > 0) {
        const stats = await c.var.indexerDb
          .select({
            providerId: schema.dataSets.providerId,
            pieceCount: count(schema.pieces.pieceId),
            totalSize: sum(schema.pieces.rawSize),
          })
          .from(schema.pieces)
          .innerJoin(schema.dataSets, eq(schema.pieces.dataSetId, schema.dataSets.dataSetId))
          .where(
            and(
              inArray(schema.dataSets.providerId, providerIds),
              eq(schema.dataSets.deleted, false),
              or(isNull(schema.dataSets.pdpEndEpoch), lte(schema.dataSets.pdpEndEpoch, blockNumber)),
              eq(schema.pieces.removed, false)
            )
          )
          .groupBy(schema.dataSets.providerId)

        for (const stat of stats) {
          statsByProviderId.set(stat.providerId, {
            pieceCount: stat.pieceCount,
            totalSize: stat.totalSize == null ? 0n : BigInt(stat.totalSize),
          })
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
          pieceCount: stats?.pieceCount ?? 0,
          totalSize: formatBytesAsGb(stats?.totalSize ?? 0n),
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
