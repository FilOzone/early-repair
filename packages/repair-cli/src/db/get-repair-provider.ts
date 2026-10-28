import type { Address } from 'viem'
import { getProvider } from '../api.ts'
import type { Context, RepairProvider } from '../types.ts'

export interface GetRepairProviderOptions extends Pick<Context, 'api'> {
  providerId: bigint
}

/**
 * Load an active provider by ID for use as a repair target.
 */
export async function getRepairProvider({ api, providerId }: GetRepairProviderOptions): Promise<RepairProvider | null> {
  const provider = await getProvider(api, providerId)

  if (!provider?.active || !provider.pdpProductActive || !provider.serviceUrl || !provider.name) {
    return null
  }

  return {
    providerId: BigInt(provider.providerId),
    providerAddress: provider.address as Address,
    name: provider.name,
    serviceUrl: provider.serviceUrl,
    approved: provider.approved ?? false,
    endorsed: provider.endorsed ?? false,
  }
}
