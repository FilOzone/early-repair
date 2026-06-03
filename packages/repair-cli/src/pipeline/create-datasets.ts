import * as SP from '@filoz/synapse-core/sp'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getRepairDataset } from '../db/get-repair-dataset.ts'
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
import { getRepairDatasetMetadata, hashLink } from '../utils.ts'

export type RunCreateDatasetsPhaseOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  client: WalletClient
  repair: SelectRepair
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
      const maybeDataset = await getRepairDataset({
        indexerDb: options.indexerDb,
        providerId: options.repair.targetProviderId,
        payer: options.client.account.address,
        blockNumber: options.repair.blockNumber,
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
          metadata: getRepairDatasetMetadata(),
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
        targetDataSetId: result.dataSetId,
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

/** Run pending `create_dataset` operations and verify the repair dataset exists. */
export async function runCreateDatasetsPhase({
  localDb,
  indexerDb,
  client,
  repair,
  reset,
}: RunCreateDatasetsPhaseOptions): Promise<void> {
  const operation = await localDb.query.operations.findFirst({
    where: and(
      eq(localSchema.operations.repairId, repair.id),
      inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending']),
      eq(localSchema.operations.type, 'create_dataset')
    ),
    orderBy: [asc(localSchema.operations.id)],
  })

  if (operation) {
    const worker = createDatasetWorker({
      client,
      localDb,
      indexerDb,
      repair,
    })
    await worker(operation)
  }

  const repairDataset = await localDb.query.repairs.findFirst({
    where: eq(localSchema.repairs.id, repair.id),
    columns: { targetDataSetId: true },
  })

  if (!repairDataset) throw new RepairNotFoundError(repair.id)

  if (repairDataset.targetDataSetId === null) {
    throw new MissingRepairDataSetError()
  }
}
