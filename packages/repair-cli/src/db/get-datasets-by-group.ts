import { and, asc, eq } from 'drizzle-orm'
import type { Address } from 'viem'
import type { Group, IndexerQueryOptions } from '../types.ts'
import { EARLY_REPAIR_SOURCE } from '../utils.ts'

export type GetDataSetsByGroupOptions = IndexerQueryOptions & {
  providerId: bigint
  payer: Address
}

export type DataSetForGroup = {
  dataSetId: bigint
  withCdn: boolean
  withIpfsIndexing: boolean
  payer: string
  source: string | null
}

export interface DataSetsByGroup {
  cdn: DataSetForGroup | null
  ipfs: DataSetForGroup | null
  both: DataSetForGroup | null
  none: DataSetForGroup | null
}

function pieceGroupFromFlags(withCdn: boolean, withIpfsIndexing: boolean): Group {
  if (withCdn && withIpfsIndexing) return 'both'
  if (withCdn) return 'cdn'
  if (withIpfsIndexing) return 'ipfs'
  return 'none'
}

/**
 * Find one active dataset per repair group for a provider, if it exists.
 *
 * Groups are mutually exclusive: `cdn` and `ipfs` require only one flag enabled;
 * `both` requires both; `none` requires neither. When multiple datasets match a
 * group, the lowest `dataSetId` is returned.
 */
export async function getDataSetsByGroup({
  indexerDb,
  indexerSchema,
  providerId,
  payer,
}: GetDataSetsByGroupOptions): Promise<DataSetsByGroup> {
  const rows = await indexerDb
    .select({
      dataSetId: indexerSchema.dataSets.dataSetId,
      withCdn: indexerSchema.dataSets.withCdn,
      withIpfsIndexing: indexerSchema.dataSets.withIpfsIndexing,
      payer: indexerSchema.dataSets.payer,
      source: indexerSchema.dataSets.source,
    })
    .from(indexerSchema.dataSets)
    .where(
      and(
        eq(indexerSchema.dataSets.providerId, providerId),
        eq(indexerSchema.dataSets.deleted, false),
        eq(indexerSchema.dataSets.payer, payer.toLowerCase()),
        eq(indexerSchema.dataSets.source, EARLY_REPAIR_SOURCE)
      )
    )
    .orderBy(asc(indexerSchema.dataSets.dataSetId))

  const groups: DataSetsByGroup = { cdn: null, ipfs: null, both: null, none: null }

  for (const row of rows) {
    const group = pieceGroupFromFlags(row.withCdn, row.withIpfsIndexing)
    if (groups[group]) continue
    groups[group] = row
  }

  return groups
}
