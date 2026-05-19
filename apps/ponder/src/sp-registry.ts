import type { Context, Event } from 'ponder:registry'
import { ponder } from 'ponder:registry'
import { providers } from 'ponder:schema'
import { PDP_PRODUCT_TYPE } from '@filoz/repair-db'
import type { Address } from 'viem'
import { ServiceProviderRegistryAbi } from './abis.ts'
import { eventBlock } from './event-utils.ts'

interface ProviderInfo {
  providerAddress: Address | null
  name: string | null
  providerActive: boolean
}

type SpRegistryContext = Pick<Context<'SPRegistry:ProviderRegistered'>, 'client' | 'db'>
type SpRegistryEvent = Pick<Event<'SPRegistry:ProviderRegistered'>, 'block' | 'log'>

function decodeCapabilityValue(hex: `0x${string}`): string {
  try {
    const bytes = Buffer.from(hex.slice(2), 'hex')
    const value = bytes.toString('utf-8')
    if (value.includes('\ufffd')) return hex
    return value.replace(/\0+$/u, '')
  } catch {
    return hex
  }
}

function capabilitiesFromEntries(
  keys: readonly string[],
  values: readonly `0x${string}`[]
): Record<string, string> | null {
  if (keys.length === 0) return null

  const capabilities: Record<string, string> = {}
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = values[i]
    if (key === undefined) continue
    capabilities[key] = value ? decodeCapabilityValue(value) : ''
  }
  return capabilities
}

async function readProviderInfo(
  context: Pick<SpRegistryContext, 'client'>,
  registryAddress: Address,
  providerId: bigint,
  blockNumber: bigint
): Promise<ProviderInfo> {
  const result = await context.client.readContract({
    abi: ServiceProviderRegistryAbi,
    address: registryAddress,
    functionName: 'providers',
    args: [providerId],
    blockNumber,
  })

  const [providerAddress, , name, , providerActive] = result

  return { providerAddress, name, providerActive }
}

async function upsertProviderInfo({
  context,
  event,
  providerId,
  providerAddress,
}: {
  context: SpRegistryContext
  event: SpRegistryEvent
  providerId: bigint
  providerAddress?: Address
}) {
  let info: ProviderInfo = {
    providerAddress: providerAddress ?? null,
    name: null,
    providerActive: true,
  }

  try {
    info = await readProviderInfo(context, event.log.address, providerId, event.block.number)
  } catch {
    // The event payload is enough to keep address-level repair inventory usable.
  }

  const block = eventBlock(event)
  await context.db
    .insert(providers)
    .values({
      providerId,
      providerAddress: info.providerAddress,
      name: info.name,
      serviceUrl: null,
      providerActive: info.providerActive,
      pdpProductActive: false,
      approved: false,
      endorsed: false,
      createdAtBlock: event.block.number,
      ...block,
    })
    .onConflictDoUpdate({
      providerAddress: info.providerAddress,
      name: info.name,
      providerActive: info.providerActive,
      ...block,
    })
}

ponder.on('SPRegistry:ProviderRegistered', async ({ event, context }) => {
  const { providerId, serviceProvider } = event.args

  await upsertProviderInfo({ context, event, providerId, providerAddress: serviceProvider })
})

ponder.on('SPRegistry:ProviderInfoUpdated', async ({ event, context }) => {
  const { providerId } = event.args
  await upsertProviderInfo({ context, event, providerId })
})

ponder.on('SPRegistry:ProductAdded', async ({ event, context }) => {
  const { providerId, productType, serviceProvider, capabilityKeys, capabilityValues } = event.args
  if (productType !== PDP_PRODUCT_TYPE) return

  const capabilities = capabilitiesFromEntries(capabilityKeys, capabilityValues)
  const block = eventBlock(event)

  await context.db
    .insert(providers)
    .values({
      providerId,
      providerAddress: serviceProvider,
      name: null,
      serviceUrl: capabilities?.serviceURL ?? null,
      providerActive: true,
      pdpProductActive: true,
      approved: false,
      endorsed: false,
      createdAtBlock: event.block.number,
      ...block,
    })
    .onConflictDoUpdate({
      providerAddress: serviceProvider,
      serviceUrl: capabilities?.serviceURL ?? null,
      pdpProductActive: true,
      ...block,
    })
})

ponder.on('SPRegistry:ProductUpdated', async ({ event, context }) => {
  const { providerId, productType, serviceProvider, capabilityKeys, capabilityValues } = event.args
  if (productType !== PDP_PRODUCT_TYPE) return

  const capabilities = capabilitiesFromEntries(capabilityKeys, capabilityValues)
  const block = eventBlock(event)

  await context.db
    .insert(providers)
    .values({
      providerId,
      providerAddress: serviceProvider,
      name: null,
      serviceUrl: capabilities?.serviceURL ?? null,
      providerActive: true,
      pdpProductActive: true,
      approved: false,
      endorsed: false,
      createdAtBlock: event.block.number,
      ...block,
    })
    .onConflictDoUpdate({
      providerAddress: serviceProvider,
      serviceUrl: capabilities?.serviceURL ?? null,
      pdpProductActive: true,
      ...block,
    })
})

ponder.on('SPRegistry:ProductRemoved', async ({ event, context }) => {
  const { providerId, productType } = event.args
  if (productType !== PDP_PRODUCT_TYPE) return

  const existing = await context.db.find(providers, { providerId })
  if (!existing) return

  await context.db.update(providers, { providerId }).set({
    pdpProductActive: false,
    ...eventBlock(event),
  })
})

ponder.on('SPRegistry:ProviderRemoved', async ({ event, context }) => {
  const { providerId } = event.args
  const existing = await context.db.find(providers, { providerId })
  if (!existing) return

  await context.db.update(providers, { providerId }).set({
    providerActive: false,
    ...eventBlock(event),
  })
})
