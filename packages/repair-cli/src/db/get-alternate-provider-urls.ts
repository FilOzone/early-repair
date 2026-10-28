import { listProviders, type Provider } from '../api.ts'
import type { IndexerApi } from '../types.ts'

/** Rank endorsed providers first, then approved, then by ascending ID. */
function compareProviders(a: Provider, b: Provider): number {
  if (a.endorsed !== b.endorsed) return a.endorsed ? -1 : 1
  if (a.approved !== b.approved) return a.approved ? -1 : 1
  const x = BigInt(a.providerId)
  const y = BigInt(b.providerId)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Service URLs of the providers to probe for a copy of a repaired piece: approved or endorsed
 * providers with a service URL, then the provider being repaired as a last resort, so pieces only
 * it stores can still be pulled while it serves them.
 *
 * Callers probe these with `findPieceOnProviders`, which keeps this order, so endorsed providers
 * are preferred as pull sources and the repaired provider is used only when no other one serves
 * the piece.
 */
export async function getAlternateProviderUrls({
  api,
  repairProviderId,
}: {
  api: IndexerApi
  repairProviderId: bigint
}): Promise<string[]> {
  const providers = await listProviders(api)
  const repairProviderUrl = providers.find((provider) => BigInt(provider.providerId) === repairProviderId)?.serviceUrl
  const urls = providers
    .filter(
      (provider) =>
        (provider.approved || provider.endorsed) &&
        provider.serviceUrl &&
        BigInt(provider.providerId) !== repairProviderId
    )
    .sort(compareProviders)
    .map((provider) => provider.serviceUrl as string)

  if (repairProviderUrl) urls.push(repairProviderUrl)
  return urls
}
