import { and, asc, eq, ne } from 'drizzle-orm'
import type { Context, RepairProvider } from '../types.ts'

export interface SelectAlternateRepairProviderOptions extends Pick<Context, 'indexerDb'> {
  providerId: bigint
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
  providerId,
}: SelectAlternateRepairProviderOptions): Promise<RepairProvider | null> {
  const schema = indexerDb._.fullSchema
  const [source] = await indexerDb
    .select({
      approved: schema.providers.approved,
      endorsed: schema.providers.endorsed,
    })
    .from(schema.providers)
    .where(eq(schema.providers.providerId, providerId))
    .limit(1)

  if (!source) return null

  const candidates = await indexerDb
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
        ne(schema.providers.providerId, providerId),
        eq(schema.providers.providerActive, true),
        eq(schema.providers.pdpProductActive, true)
      )
    )
    .orderBy(asc(schema.providers.providerId))

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
