import { and, asc, eq } from 'drizzle-orm'
import type { Address } from 'viem'
import type { Group, IndexerDatabase } from '../types.ts'
import { EARLY_REPAIR_SOURCE } from '../utils.ts'

export type GetDataSetsByGroupOptions = {
  indexerDb: IndexerDatabase
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
  providerId,
  payer,
}: GetDataSetsByGroupOptions): Promise<DataSetsByGroup> {
  const schema = indexerDb._.fullSchema
  const rows = await indexerDb
    .select({
      dataSetId: schema.dataSets.dataSetId,
      withCdn: schema.dataSets.withCdn,
      withIpfsIndexing: schema.dataSets.withIpfsIndexing,
      payer: schema.dataSets.payer,
      source: schema.dataSets.source,
    })
    .from(schema.dataSets)
    .where(
      and(
        eq(schema.dataSets.providerId, providerId),
        eq(schema.dataSets.deleted, false),
        eq(schema.dataSets.payer, payer.toLowerCase()),
        eq(schema.dataSets.source, EARLY_REPAIR_SOURCE)
      )
    )
    .orderBy(asc(schema.dataSets.dataSetId))

  const groups: DataSetsByGroup = { cdn: null, ipfs: null, both: null, none: null }

  for (const row of rows) {
    const group = pieceGroupFromFlags(row.withCdn, row.withIpfsIndexing)
    if (groups[group]) continue
    groups[group] = row
  }

  return groups
}
