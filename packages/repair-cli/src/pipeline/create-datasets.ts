import * as SP from '@filoz/synapse-core/sp'
import { and, eq, inArray } from 'drizzle-orm'
import type { queueAsPromised } from 'fastq'
import fastq from 'fastq'
import { getDatasetForGroup } from '../db/get-dataset-for-group.ts'
import { updateOperation } from '../db/update-operation.ts'
import { updateRepair } from '../db/update-repair.ts'
import { MissingRepairDataSetError, RepairNotFoundError } from '../error.ts'
import type {
  CreateDatasetOperationData,
  CreateDatasetOperationResult,
  SelectOperation,
  SelectRepair,
} from '../local-schema.ts'
import * as localSchema from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'
import { getMetadataForGroup, hashLink } from '../utils.ts'

export type RunCreateDatasetsPhaseOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  client: WalletClient
  repair: SelectRepair
  concurrency: number
  reset: boolean
}

export interface CreateDatasetWorkerOptions {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  client: WalletClient
  repair: SelectRepair
}

export function createDatasetWorker(options: CreateDatasetWorkerOptions) {
  return async (operation: SelectOperation): Promise<void> => {
    const data = operation.data as CreateDatasetOperationData

    try {
      let result: CreateDatasetOperationResult

      // check if dataset already exists
      const maybeDataset = await getDatasetForGroup({
        indexerDb: options.indexerDb,
        providerId: options.repair.repairProviderId,
        payer: options.client.account.address,
        group: operation.group,
      })

      if (maybeDataset) {
        result = {
          dataSetId: maybeDataset.dataSetId,
        }
      } else {
        const { txHash, statusUrl } = await SP.createDataSet(options.client, {
          payee: data.payee,
          serviceURL: options.repair.targetProviderUrl,
          payer: options.client.account.address,
          cdn: false,
          metadata: getMetadataForGroup(operation.group),
        })

        console.log(`Waiting for data set creation to be completed ${hashLink(txHash, options.client.chain)}...`)
        const waitForResult = await SP.waitForCreateDataSet({
          statusUrl,
        })
        console.log(`Data set creation completed: ${waitForResult.dataSetId}`)
        result = {
          txHash,
          dataSetId: waitForResult.dataSetId,
        }
      }

      await updateOperation({
        localDb: options.localDb,
        operationId: operation.id,
        status: 'completed',
        result,
      })
      await updateRepair({
        localDb: options.localDb,
        repairId: operation.repairId,
        targetDataSets: { [operation.group]: result.dataSetId },
      })
    } catch (error) {
      console.error(error)
      await updateOperation({
        localDb: options.localDb,
        operationId: operation.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

/**
 * Run pending `create_dataset` operations and return successful creations by group.
 */
export async function runCreateDatasetsPhase({
  localDb,
  indexerDb,
  client,
  repair,
  concurrency,
  reset,
}: RunCreateDatasetsPhaseOptions): Promise<void> {
  const operations = await localDb.query.operations.findMany({
    where: and(
      eq(localSchema.operations.repairId, repair.id),
      inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending']),
      eq(localSchema.operations.type, 'create_dataset')
    ),
  })

  const worker = createDatasetWorker({
    client,
    localDb,
    indexerDb,
    repair,
  })

  const queue: queueAsPromised<SelectOperation, void> = fastq.promise(worker, Math.max(1, concurrency))
  for (const operation of operations) {
    queue.push(operation).catch(console.error)
  }
  await queue.drained()

  // Validate that the repair has all target data sets
  const repairDatasets = await localDb.query.repairs.findFirst({
    where: eq(localSchema.repairs.id, repair.id),
    columns: { targetDataSets: true },
  })

  if (!repairDatasets) throw new RepairNotFoundError(repair.id)

  // check if all target data sets are present
  for (const [key, value] of Object.entries(repairDatasets.targetDataSets)) {
    if (value === null) {
      throw new MissingRepairDataSetError(key)
    }
  }
}
