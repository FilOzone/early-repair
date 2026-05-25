import * as SP from '@filoz/synapse-core/sp'
import { and, eq, inArray } from 'drizzle-orm'
import type { queueAsPromised } from 'fastq'
import fastq from 'fastq'
import { updateOperation } from '../db/update-operation.ts'
import { updateRepair } from '../db/update-repair.ts'
import { MissingRepairDataSetError, RepairNotFoundError } from '../error.ts'
import type { CreateDatasetOperationData, CreateDatasetOperationResult, SelectOperation } from '../local-schema.ts'
import type { LocalDatabase, LocalSchema, WalletClient } from '../types.ts'
import { getMetadataForGroup, hashLink } from '../utils.ts'

export type RunCreateDatasetsPhaseOptions = {
  localDb: LocalDatabase
  localSchema: LocalSchema
  client: WalletClient
  repairId: number
  concurrency: number
  reset: boolean
}

export interface CreateDatasetWorkerOptions {
  localDb: LocalDatabase
  localSchema: LocalSchema
  client: WalletClient
}

export function createDatasetWorker(options: CreateDatasetWorkerOptions) {
  return async (operation: SelectOperation): Promise<void> => {
    const data = operation.data as CreateDatasetOperationData

    try {
      const { txHash, statusUrl } = await SP.createDataSet(options.client, {
        payee: data.payee,
        serviceURL: data.serviceUrl,
        payer: options.client.account.address,
        cdn: false,
        metadata: getMetadataForGroup(operation.group),
      })

      console.log(`Waiting for data set creation to be completed ${hashLink(txHash, options.client.chain)}...`)
      const result = await SP.waitForCreateDataSet({
        statusUrl,
      })
      console.log(`Data set creation completed: ${result.dataSetId} on ${result.service}`)
      const operationResult = {
        createMessageHash: result.createMessageHash,
        dataSetId: result.dataSetId,
      } satisfies CreateDatasetOperationResult

      await updateOperation({
        localDb: options.localDb,
        operationId: operation.id,
        status: 'completed',
        result: operationResult,
      })
      await updateRepair({
        localDb: options.localDb,
        repairId: operation.repairId,
        targetDataSets: { [operation.group]: operationResult.dataSetId },
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
  localSchema,
  client,
  repairId,
  concurrency,
  reset,
}: RunCreateDatasetsPhaseOptions): Promise<void> {
  const operations = await localDb.query.operations.findMany({
    where: and(
      eq(localSchema.operations.repairId, repairId),
      inArray(localSchema.operations.status, reset ? ['pending', 'failed'] : ['pending']),
      eq(localSchema.operations.type, 'create_dataset')
    ),
  })

  const worker = createDatasetWorker({
    client,
    localDb,
    localSchema,
  })

  const queue: queueAsPromised<SelectOperation, void> = fastq.promise(worker, Math.max(1, concurrency))
  for (const operation of operations) {
    queue.push(operation).catch(console.error)
  }
  await queue.drained()

  const repair = await localDb.query.repairs.findFirst({
    where: eq(localSchema.repairs.id, repairId),
    columns: { targetDataSets: true },
  })
  if (!repair) throw new RepairNotFoundError(repairId)

  // check if all target data sets are present
  for (const [key, value] of Object.entries(repair.targetDataSets)) {
    if (value === null) {
      throw new MissingRepairDataSetError(key)
    }
  }
}
