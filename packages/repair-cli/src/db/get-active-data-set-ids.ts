import { type DataSet, listDataSets } from '../api.ts'
import type { IndexerApi } from '../types.ts'

/**
 * Whether a data set's pieces count at the repair block: not deleted, and either not terminated
 * (no PDP end epoch) or terminated with an end epoch after `blockNumber`, so the provider still
 * has to prove it.
 */
export function isDataSetActiveAt(dataSet: Pick<DataSet, 'deleted' | 'pdpEndEpoch'>, blockNumber: bigint): boolean {
  return !dataSet.deleted && (dataSet.pdpEndEpoch == null || BigInt(dataSet.pdpEndEpoch) > blockNumber)
}

/**
 * IDs of a provider's data sets that are active at the repair block (see {@link isDataSetActiveAt}).
 */
export async function getActiveDataSetIds({
  api,
  providerId,
  blockNumber,
}: {
  api: IndexerApi
  providerId: bigint
  blockNumber: bigint
}): Promise<Set<string>> {
  const dataSets = await listDataSets(api, { providerId, deleted: false })
  return new Set(
    dataSets.filter((dataSet) => isDataSetActiveAt(dataSet, blockNumber)).map((dataSet) => dataSet.dataSetId)
  )
}
