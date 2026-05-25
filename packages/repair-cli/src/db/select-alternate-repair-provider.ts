import { and, asc, eq, ne } from 'drizzle-orm'
import type { Address } from 'viem'
import type { IndexerQueryOptions } from '../types.ts'

export type SelectAlternateRepairProviderOptions = IndexerQueryOptions & {
  providerId: bigint
}

/**
 * Provider details used for repair selection and CID replica lookup.
 */
export type RepairProvider = {
  providerId: bigint
  providerAddress: Address
  name: string
  serviceUrl: string
  approved: boolean
  endorsed: boolean
}

type ProviderTier = 'endorsed' | 'approved' | 'none'

function providerTier(approved: boolean, endorsed: boolean): ProviderTier {
  if (endorsed) return 'endorsed'
  if (approved) return 'approved'
  return 'none'
}

function matchesProviderTier(provider: Pick<RepairProvider, 'approved' | 'endorsed'>, tier: ProviderTier) {
  if (tier === 'endorsed') return provider.endorsed
  if (tier === 'approved') return provider.approved && !provider.endorsed
  return !provider.approved && !provider.endorsed
}

function fallbackTiersFor(preferredTier: ProviderTier): ProviderTier[] {
  if (preferredTier === 'endorsed') return ['approved', 'none']
  if (preferredTier === 'approved') return ['none']
  return []
}

/**
 * Pick an active alternate provider to repair to, matching the source provider's status tier
 * when possible.
 *
 * Tier precedence for the source provider: endorsed, then approved, then neither. Fallbacks only
 * step down: endorsed → approved → none; approved → none; none has no fallback.
 */
export async function selectAlternateRepairProvider({
  indexerDb,
  indexerSchema,
  providerId,
}: SelectAlternateRepairProviderOptions): Promise<RepairProvider | null> {
  const [source] = await indexerDb
    .select({
      approved: indexerSchema.providers.approved,
      endorsed: indexerSchema.providers.endorsed,
    })
    .from(indexerSchema.providers)
    .where(eq(indexerSchema.providers.providerId, providerId))
    .limit(1)

  if (!source) return null

  const candidates = await indexerDb
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
        ne(indexerSchema.providers.providerId, providerId),
        eq(indexerSchema.providers.providerActive, true),
        eq(indexerSchema.providers.pdpProductActive, true)
      )
    )
    .orderBy(asc(indexerSchema.providers.providerId))

  if (candidates.length === 0) return null

  const preferredTier = providerTier(source.approved, source.endorsed)
  const tiersToTry = [preferredTier, ...fallbackTiersFor(preferredTier)]

  for (const tier of tiersToTry) {
    const match = candidates.find((candidate) => matchesProviderTier(candidate, tier))
    if (match?.providerAddress && match?.serviceUrl && match?.name) {
      return {
        providerId: match.providerId,
        providerAddress: match.providerAddress,
        name: match.name,
        serviceUrl: match.serviceUrl,
        approved: match.approved,
        endorsed: match.endorsed,
      }
    }
  }

  return null
}
