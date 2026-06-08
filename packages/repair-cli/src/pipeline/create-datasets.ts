import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { getRepairDataset } from '../db/get-repair-dataset.ts'
import { repairUpdate } from '../db/repair-update.ts'
import type { RepairSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'
import { getRepairDatasetMetadata, hashLink } from '../utils.ts'

export type EnsureRepairDatasetOptions = {
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  client: WalletClient
  repair: RepairSelect
}

/**
 * Ensure the repair dataset exists by creating it if it doesn't.
 *
 * @param options - The options for ensuring the repair dataset.
 * @returns {Promise<bigint>} - The ID of the created dataset.
 */
export async function ensureRepairDataset({
  localDb,
  indexerDb,
  client,
  repair,
}: EnsureRepairDatasetOptions): Promise<bigint> {
  const log = p.taskLog({
    title: 'Ensuring repair dataset',
  })
  const provider = await getPDPProvider(client, {
    providerId: repair.targetProviderId,
  })

  if (!provider) throw new Error(`Target provider ${repair.targetProviderId} not found or inactive`)

  let datasetId: bigint | null = null
  // check if dataset already exists
  const existingDatasetId = await getRepairDataset({
    indexerDb,
    providerId: repair.targetProviderId,
    payer: client.account.address,
  })

  if (existingDatasetId) {
    datasetId = existingDatasetId
    log.success(`Data set #${datasetId} already exists at ${provider.pdp.serviceURL}`)
  } else {
    const { txHash, statusUrl } = await SP.createDataSet(client, {
      payee: provider.payee,
      serviceURL: provider.pdp.serviceURL,
      payer: client.account.address,
      cdn: false,
      metadata: getRepairDatasetMetadata(),
    })
    log.message(`Waiting for data to be created at ${provider.pdp.serviceURL} ${hashLink(txHash, client.chain)}...`)
    const waitForResult = await SP.waitForCreateDataSet({
      statusUrl,
    })
    datasetId = waitForResult.dataSetId
    log.success(`Data set #${datasetId} created at ${provider.pdp.serviceURL}`)
  }
  await repairUpdate({
    localDb,
    repairId: repair.id,
    targetDataSetId: datasetId,
  })
  return datasetId
}
