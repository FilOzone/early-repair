import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import type { Address } from 'viem'
import { getDataSet, toStringMetadata } from '../api.ts'
import { findRepairDataset } from '../db/find-repair-dataset.ts'
import { repairUpdate } from '../db/repair-update.ts'
import type { RepairSelect } from '../local-schema.ts'
import type { IndexerApi, LocalDatabase, WalletClient } from '../types.ts'
import { hashLink } from '../utils.ts'

export type EnsureRepairDatasetOptions = {
  source: string
  localDb: LocalDatabase
  api: IndexerApi
  client: WalletClient
  repair: RepairSelect
  payer: Address
}

/**
 * Ensure the repair dataset exists by creating it if it doesn't.
 *
 * @param options - The options for ensuring the repair dataset.
 */
export async function ensureRepairDataset({ source, localDb, api, client, repair, payer }: EnsureRepairDatasetOptions) {
  const log = p.taskLog({
    title: 'Ensuring repair dataset',
  })
  const provider = await getPDPProvider(client, {
    providerId: repair.targetProviderId,
  })

  if (!provider) throw new Error(`Target provider ${repair.targetProviderId} not found or inactive`)

  let datasetId: bigint | null = null
  // check if dataset already exists
  const existingDatasetId = await findRepairDataset({
    api,
    providerId: repair.targetProviderId,
    payer,
    source,
  })

  if (existingDatasetId) {
    datasetId = existingDatasetId
    log.success(`Data set #${datasetId} already exists at ${provider.pdp.serviceURL}`)
  } else {
    const { txHash, statusUrl } = await SP.createDataSet(client, {
      payee: provider.payee,
      serviceURL: provider.pdp.serviceURL,
      payer,
      cdn: false,
      metadata: {
        source,
        withIPFSIndexing: '',
      },
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

/**
 * Ensure a replication target dataset exists by creating a fresh dataset with source metadata.
 *
 * @param options - The options for ensuring the replication dataset.
 */
export async function ensureReplicateDataset({ localDb, api, client, repair, payer }: EnsureRepairDatasetOptions) {
  const log = p.taskLog({
    title: 'Ensuring replication dataset',
  })

  if (repair.repairDataSetId == null) {
    throw new Error('Missing source dataset ID')
  }

  const provider = await getPDPProvider(client, {
    providerId: repair.targetProviderId,
  })

  if (!provider) throw new Error(`Target provider ${repair.targetProviderId} not found or inactive`)

  if (repair.targetDataSetId != null) {
    log.success(`Data set #${repair.targetDataSetId} already exists at ${provider.pdp.serviceURL}`)
    return repair.targetDataSetId
  }

  const sourceDataSet = await getDataSet(api, repair.repairDataSetId)

  if (!sourceDataSet) {
    throw new Error(`Source dataset ${repair.repairDataSetId} not found`)
  }

  const { txHash, statusUrl } = await SP.createDataSet(client, {
    payee: provider.payee,
    serviceURL: provider.pdp.serviceURL,
    payer,
    cdn: sourceDataSet.withCdn ?? false,
    metadata: sourceDataSet.metadata ? toStringMetadata(sourceDataSet.metadata) : undefined,
  })
  log.message(`Waiting for data to be created at ${provider.pdp.serviceURL} ${hashLink(txHash, client.chain)}...`)
  const waitForResult = await SP.waitForCreateDataSet({
    statusUrl,
  })
  const datasetId = waitForResult.dataSetId
  log.success(`Data set #${datasetId} created at ${provider.pdp.serviceURL}`)

  await repairUpdate({
    localDb,
    repairId: repair.id,
    targetDataSetId: datasetId,
  })
  return datasetId
}
