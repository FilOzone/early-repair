import { eq } from 'drizzle-orm'
import type { Address } from 'viem'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { RepairTargetDataSets } from '../local-schema.ts'
import type { IndexerQueryOptions, LocalDatabase, LocalSchema } from '../types.ts'
import { getDataSetsByGroup } from './get-datasets-by-group.ts'
import { forEachPiecesPage } from './get-pieces.ts'
import { getRepairGroups } from './get-repair-groups.ts'
import { getRepairProvider } from './get-repair-provider.ts'
import { selectAlternateRepairProvider } from './select-alternate-repair-provider.ts'

export type CreateRepairOptions = IndexerQueryOptions & {
  localDb: LocalDatabase
  localSchema: LocalSchema
  repairProviderId: bigint
  targetProviderId?: bigint
  payer: Address
}

/**
 * Prepare a repair by selecting a target provider, creating the repair row, and
 * inserting pending dataset and piece operations.
 *
 * @param {CreateRepairOptions} options - The options for creating a repair.
 * @returns {Promise<number>} The ID of the created repair.
 */
export async function createRepair({
  indexerDb,
  indexerSchema,
  localDb,
  localSchema,
  repairProviderId,
  targetProviderId,
  payer,
}: CreateRepairOptions): Promise<number> {
  if (targetProviderId != null && targetProviderId === repairProviderId) {
    throw new RepairCreationError('Target provider must differ from the provider being repaired')
  }

  const targetProvider = targetProviderId
    ? await getRepairProvider({
        indexerDb,
        indexerSchema,
        providerId: targetProviderId,
      })
    : await selectAlternateRepairProvider({
        indexerDb,
        indexerSchema,
        providerId: repairProviderId,
      })

  if (!targetProvider) {
    throw new NoAlternateProviderError(targetProviderId)
  }

  const now = Date.now()

  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      repairProviderId: repairProviderId.toString(),
      targetProviderId: targetProvider.providerId.toString(),
      targetDataSets: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError()

  await forEachPiecesPage(
    {
      indexerDb,
      indexerSchema,
      providerId: repairProviderId,
      repairId: repair.id,
      serviceUrl: targetProvider.serviceUrl,
    },
    async (page) => {
      if (page.operations.length > 0) {
        await localDb.insert(localSchema.operations).values(page.operations)
      }
    }
  )

  console.log('Pieces added to repair')
  const repairGroups = await getRepairGroups({ localDb, localSchema, repairId: repair.id })
  // Get the target datasets for the repair. If no dataset is found, a new one will be created.
  const dataSetsByGroup = await getDataSetsByGroup({
    indexerDb,
    indexerSchema,
    providerId: targetProvider.providerId,
    payer,
  })

  // Each group needs a target dataset before pieces can be added; queue missing datasets first.
  const targetDataSets: RepairTargetDataSets = {}
  for (const group of repairGroups) {
    const dataSet = dataSetsByGroup[group]
    if (dataSet) {
      targetDataSets[group] = dataSet.dataSetId
    } else {
      targetDataSets[group] = null
      await localDb.insert(localSchema.operations).values({
        repairId: repair.id,
        type: 'create_dataset',
        group,
        status: 'pending',
        data: {
          serviceUrl: targetProvider.serviceUrl,
          payee: targetProvider.providerAddress,
        },
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  await localDb
    .update(localSchema.repairs)
    .set({ targetDataSets, updatedAt: now })
    .where(eq(localSchema.repairs.id, repair.id))

  return repair.id
}
