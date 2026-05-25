import { and, eq } from 'drizzle-orm'
import type { IndexerQueryOptions } from '../types.ts'
import type { RepairProvider } from './select-alternate-repair-provider.ts'

export type GetRepairProviderOptions = IndexerQueryOptions & {
  providerId: bigint
}

/**
 * Load an active provider by ID for use as a repair target.
 */
export async function getRepairProvider({
  indexerDb,
  indexerSchema,
  providerId,
}: GetRepairProviderOptions): Promise<RepairProvider | null> {
  const [provider] = await indexerDb
    .select({
      providerId: indexerSchema.providers.providerId,
      providerAddress: indexerSchema.providers.providerAddress,
      name: indexerSchema.providers.name,
      serviceUrl: indexerSchema.providers.serviceUrl,
      approved: indexerSchema.providers.approved,
      endorsed: indexerSchema.providers.endorsed,
    })
    .from(indexerSchema.providers)
    .where(
      and(
        eq(indexerSchema.providers.providerId, providerId),
        eq(indexerSchema.providers.providerActive, true),
        eq(indexerSchema.providers.pdpProductActive, true)
      )
    )
    .limit(1)

  if (!provider?.providerAddress || !provider?.serviceUrl || !provider?.name) {
    return null
  }

  return {
    providerId: provider.providerId,
    providerAddress: provider.providerAddress,
    name: provider.name,
    serviceUrl: provider.serviceUrl,
    approved: provider.approved,
    endorsed: provider.endorsed,
  }
}
