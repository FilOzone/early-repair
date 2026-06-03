import { eq } from 'drizzle-orm'
import { getBlockNumber } from 'viem/actions'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { Context } from '../types.ts'
import { forEachPiecesPage } from './get-pieces.ts'
import { getRepairDataset } from './get-repair-dataset.ts'
import { getRepairProvider } from './get-repair-provider.ts'

export interface CreateRepairOptions extends Context {
  repairProviderId: bigint
  targetProviderId: bigint
}

/**
 * Prepare a repair by selecting a target provider, creating the repair row, and
 * inserting pending dataset and piece operations.
 *
 * @param {CreateRepairOptions} options - The options for creating a repair.
 * @returns {Promise<number>} The ID of the created repair.
 */
export async function createRepair(options: CreateRepairOptions): Promise<number> {
  const { indexerDb, localDb, repairProviderId, targetProviderId, client } = options
  const localSchema = localDb._.fullSchema
  const now = Date.now()
  const blockNumber = await getBlockNumber(client)

  // Load the explicit target provider.
  if (targetProviderId === repairProviderId) {
    throw new RepairCreationError('Target provider must differ from the provider being repaired')
  }
  const targetProvider = await getRepairProvider({
    indexerDb,
    providerId: targetProviderId,
  })

  if (!targetProvider) {
    throw new NoAlternateProviderError(targetProviderId)
  }

  // Create the repair row
  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      repairProviderId,
      targetProviderId: targetProvider.providerId,
      targetProviderUrl: targetProvider.serviceUrl,
      targetDataSetId: null,
      blockNumber,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError()

  // Add the pieces to the repair
  let hasPendingPieces = false
  await forEachPiecesPage(
    {
      indexerDb,
      providerId: repairProviderId,
      repairId: repair.id,
      blockNumber,
    },
    async (page) => {
      if (page.operations.length > 0) {
        hasPendingPieces ||= page.operations.some((operation) => operation.status === 'pending')
        await localDb.insert(localSchema.operations).values(page.operations)
      }
    }
  )

  if (!hasPendingPieces) {
    return repair.id
  }

  // Get the single IPFS-enabled target dataset for the repair. If none exists, create one before pulling.
  const targetDataset = await getRepairDataset({
    indexerDb,
    providerId: targetProvider.providerId,
    payer: client.account.address,
    blockNumber,
  })

  if (!targetDataset) {
    await localDb.insert(localSchema.operations).values({
      repairId: repair.id,
      type: 'create_dataset',
      status: 'pending',
      data: {
        payee: targetProvider.providerAddress,
      },
      createdAt: now,
      updatedAt: now,
    })
  }

  await localDb
    .update(localSchema.repairs)
    .set({ targetDataSetId: targetDataset?.dataSetId ?? null, updatedAt: now })
    .where(eq(localSchema.repairs.id, repair.id))

  return repair.id
}
