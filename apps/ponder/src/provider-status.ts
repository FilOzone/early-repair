import type { Context } from 'ponder:registry'
import { ponder } from 'ponder:registry'
import { providers } from 'ponder:schema'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { ProviderIdSetAbi } from './abis.ts'
import { NETWORKS } from './networks.ts'

function endorsementSetAddress(chainId: number): `0x${string}` | null {
  for (const network of Object.values(NETWORKS)) {
    if (network.CHAIN_ID === chainId) return network.ENDORSEMENT_SET
  }
  return null
}

type ProviderStatusContext = Pick<Context<'ProviderStatusSync:block'>, 'chain' | 'client' | 'db'>

async function syncEndorsements(context: ProviderStatusContext, blockNumber: bigint) {
  const address = endorsementSetAddress(context.chain.id)
  if (!address) return

  let providerIds: readonly bigint[]
  try {
    providerIds = await context.client.readContract({
      abi: ProviderIdSetAbi,
      address,
      functionName: 'getProviderIds',
      blockNumber,
    })
  } catch (error) {
    // The endorsement set was deployed after FWSS. Historical syncs before that block can safely skip it.
    console.warn('Failed to read endorsement provider IDs; skipping endorsement sync for block', {
      address,
      blockNumber: blockNumber.toString(),
      chainId: context.chain.id,
      error,
    })
    return
  }

  const endorsedProviderIds = [...new Set(providerIds)]

  if (endorsedProviderIds.length === 0) {
    await context.db.sql
      .update(providers)
      .set({
        endorsed: false,
        updatedAtBlock: blockNumber,
      })
      .where(eq(providers.endorsed, true))
  } else {
    await context.db.sql
      .update(providers)
      .set({
        endorsed: false,
        updatedAtBlock: blockNumber,
      })
      .where(and(eq(providers.endorsed, true), notInArray(providers.providerId, endorsedProviderIds)))
  }

  if (endorsedProviderIds.length > 0) {
    await context.db.sql
      .update(providers)
      .set({
        endorsed: true,
        updatedAtBlock: blockNumber,
      })
      .where(and(eq(providers.endorsed, false), inArray(providers.providerId, endorsedProviderIds)))
  }
}

ponder.on('ProviderStatusSync:block', async ({ event, context }) => {
  await syncEndorsements(context, event.block.number)
})
