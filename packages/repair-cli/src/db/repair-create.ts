import { taskLog } from '@clack/prompts'
import { getBlockNumber } from 'viem/actions'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { Context } from '../types.ts'
import { forEachPiecesPage } from './get-pieces.ts'
import { getRepairProvider } from './get-repair-provider.ts'

export interface RepairCreateOptions extends Context {
  repairProviderId: bigint
  targetProviderId: bigint
}

/**
 * Prepare a repair by selecting a target provider, creating the repair row, and
 * inserting pending dataset and piece operations.
 *
 * @param {RepairCreateOptions} options - The options for creating a repair.
 * @returns {Promise<number>} The ID of the created repair.
 */
export async function repairCreate(options: RepairCreateOptions): Promise<number> {
  const { indexerDb, localDb, repairProviderId, targetProviderId, client } = options
  const localSchema = localDb._.fullSchema
  const now = Date.now()
  const blockNumber = await getBlockNumber(client)

  const log = taskLog({
    title: 'Creating repair',
    limit: 10,
    retainLog: true,
  })

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
      repairDataSetId: null,
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
  let totalOperations = 0
  let totalPendingOperations = 0
  let totalSkippedOperations = 0
  const seenCids = new Set<string>()
  await forEachPiecesPage(
    {
      indexerDb,
      providerId: repairProviderId,
      repairId: repair.id,
      blockNumber,
    },
    async (page) => {
      for (const operation of page.operations) {
        if (seenCids.has(operation.cid)) {
          continue
        }
        seenCids.add(operation.cid)
      }
      const pendingOperations = page.operations.filter((operation) => operation.status === 'pending').length
      const skippedOperations = page.operations.filter((operation) => operation.status === 'skipped').length
      totalOperations += page.operations.length
      totalPendingOperations += pendingOperations
      totalSkippedOperations += skippedOperations

      if (page.operations.length > 0) {
        await localDb.insert(localSchema.operations).values(page.operations)
      }

      log.message(
        `Inserted ${page.operations.length} operations (${pendingOperations} pending, ${skippedOperations} skipped)`
      )
    }
  )

  log.success(
    `Created repair ${repair.id} with ${totalOperations} operations (${totalPendingOperations} pending, ${totalSkippedOperations} skipped)`,
    { showLog: true }
  )
  return repair.id
}
