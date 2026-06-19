import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { eq } from 'drizzle-orm'
import type { Address } from 'viem'
import { findRepairDataset } from '../db/find-repair-dataset.ts'
import { repairUpdate } from '../db/repair-update.ts'
import type { RepairSelect } from '../local-schema.ts'
import type { IndexerDatabase, LocalDatabase, WalletClient } from '../types.ts'
import { hashLink } from '../utils.ts'

export type EnsureRepairDatasetOptions = {
  source: string
  localDb: LocalDatabase
  indexerDb: IndexerDatabase
  client: WalletClient
  repair: RepairSelect
  payer: Address
}

/**
 * Ensure the repair dataset exists by creating it if it doesn't.
 *
 * @param options - The options for ensuring the repair dataset.
 */
export async function ensureRepairDataset({
  source,
  localDb,
  indexerDb,
  client,
  repair,
  payer,
}: EnsureRepairDatasetOptions) {
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
    indexerDb,
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
export async function ensureReplicateDataset({
  localDb,
  indexerDb,
  client,
  repair,
  payer,
}: EnsureRepairDatasetOptions) {
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

  const schema = indexerDb._.fullSchema
  const sourceDataSet = await indexerDb.query.dataSets.findFirst({
    where: eq(schema.dataSets.dataSetId, repair.repairDataSetId),
    columns: {
      metadata: true,
      withCdn: true,
    },
  })

  if (!sourceDataSet) {
    throw new Error(`Source dataset ${repair.repairDataSetId} not found`)
  }

  const { txHash, statusUrl } = await SP.createDataSet(client, {
    payee: provider.payee,
    serviceURL: provider.pdp.serviceURL,
    payer,
    cdn: sourceDataSet.withCdn,
    metadata: sourceDataSet.metadata ?? undefined,
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
