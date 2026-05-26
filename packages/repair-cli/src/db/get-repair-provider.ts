import { and, eq } from 'drizzle-orm'
import type { Context, RepairProvider } from '../types.ts'

export interface GetRepairProviderOptions extends Pick<Context, 'indexerDb'> {
  providerId: bigint
}

/**
 * Load an active provider by ID for use as a repair target.
 */
export async function getRepairProvider({
  indexerDb,
  providerId,
}: GetRepairProviderOptions): Promise<RepairProvider | null> {
  const schema = indexerDb._.fullSchema
  const [provider] = await indexerDb
    .select({
      providerId: schema.providers.providerId,
      providerAddress: schema.providers.providerAddress,
      name: schema.providers.name,
      serviceUrl: schema.providers.serviceUrl,
      approved: schema.providers.approved,
      endorsed: schema.providers.endorsed,
    })
    .from(schema.providers)
    .where(
      and(
        eq(schema.providers.providerId, providerId),
        eq(schema.providers.providerActive, true),
        eq(schema.providers.pdpProductActive, true)
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
