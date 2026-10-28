import type { Address } from 'viem'
import { listDataSets } from '../api.ts'
import type { IndexerApi } from '../types.ts'

export type FindRepairDatasetOptions = {
  api: IndexerApi
  providerId: bigint
  payer: Address
  source: string
}

/**
 * Find one live IPFS-enabled repair dataset for a provider, if it exists.
 *
 * When multiple datasets match, the lowest `dataSetId` is returned.
 */
export async function findRepairDataset({
  api,
  providerId,
  payer,
  source,
}: FindRepairDatasetOptions): Promise<bigint | null> {
  const dataSets = await listDataSets(api, {
    owner: payer.toLowerCase(),
    providerId,
    deleted: false,
    withCdn: false,
  })

  let dataSetId: bigint | null = null
  for (const dataSet of dataSets) {
    if (dataSet.pdpEndEpoch != null || dataSet.source !== source || !dataSet.withIpfsIndexing) continue
    const id = BigInt(dataSet.dataSetId)
    if (dataSetId == null || id < dataSetId) dataSetId = id
  }

  return dataSetId
}
