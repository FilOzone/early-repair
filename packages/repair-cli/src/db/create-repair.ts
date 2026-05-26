import { eq } from 'drizzle-orm'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { RepairTargetDataSets } from '../local-schema.ts'
import type { Context } from '../types.ts'
import { getDataSetsByGroup } from './get-datasets-by-group.ts'
import { forEachPiecesPage } from './get-pieces.ts'
import { getRepairGroups } from './get-repair-groups.ts'
import { getRepairProvider } from './get-repair-provider.ts'
import { selectAlternateRepairProvider } from './select-alternate-repair-provider.ts'

export interface CreateRepairOptions extends Context {
  repairProviderId: bigint
  targetProviderId?: bigint
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

  // Select the target provider
  if (targetProviderId != null && targetProviderId === repairProviderId) {
    throw new RepairCreationError('Target provider must differ from the provider being repaired')
  }
  const targetProvider = targetProviderId
    ? await getRepairProvider({
        indexerDb,
        providerId: targetProviderId,
      })
    : await selectAlternateRepairProvider({
        indexerDb,
        providerId: repairProviderId,
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
      targetDataSets: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError()

  // Add the pieces to the repair
  await forEachPiecesPage(
    {
      indexerDb,
      providerId: repairProviderId,
      repairId: repair.id,
    },
    async (page) => {
      if (page.operations.length > 0) {
        await localDb.insert(localSchema.operations).values(page.operations)
      }
    }
  )

  // Get the repair groups
  const repairGroups = await getRepairGroups({ localDb, repairId: repair.id })
  // Get the target datasets for the repair. If no dataset is found, a new one will be created.
  const dataSetsByGroup = await getDataSetsByGroup({
    indexerDb,
    providerId: targetProvider.providerId,
    payer: client.account.address,
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
