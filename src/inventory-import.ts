import { eq, inArray, sql } from 'drizzle-orm'

import type { InventoryDb } from './db.ts'
import {
  dataSets as dataSetsTable,
  pieces as piecesTable,
  providers as providersTable,
  syncMetadata,
} from './db-schema.ts'
import type { SubgraphDataSet, SubgraphMetadata, SubgraphProvider, SubgraphRoot } from './subgraph.ts'

export type SyncMetadataInput = {
  network: string
  subgraphUrl: string
  rpcUrl: string | null
  startedAt: string
  completedAt: string
  subgraph: SubgraphMetadata
}

export function upsertProviders(inventory: InventoryDb, providers: SubgraphProvider[]): void {
  if (providers.length === 0) {
    return
  }

  inventory.db
    .insert(providersTable)
    .values(
      providers.map((provider) => ({
        address: provider.address,
        subgraphId: provider.id,
      }))
    )
    .onConflictDoUpdate({
      target: providersTable.address,
      set: {
        subgraphId: sql`excluded.subgraph_id`,
      },
    })
    .run()
}

export function upsertDataSets(inventory: InventoryDb, dataSets: SubgraphDataSet[]): void {
  if (dataSets.length === 0) {
    return
  }

  inventory.db
    .insert(dataSetsTable)
    .values(
      dataSets.map((dataSet) => ({
        setId: BigInt(dataSet.setId),
        subgraphId: dataSet.id,
        providerAddress: dataSet.owner.address,
        isActive: dataSet.isActive,
        status: dataSet.status,
      }))
    )
    .onConflictDoUpdate({
      target: dataSetsTable.setId,
      set: {
        subgraphId: sql`excluded.subgraph_id`,
        providerAddress: sql`excluded.provider_address`,
        isActive: sql`excluded.is_active`,
        status: sql`excluded.status`,
      },
    })
    .run()
}

export function upsertPieces(inventory: InventoryDb, roots: SubgraphRoot[]): void {
  if (roots.length === 0) {
    return
  }

  const setIds = [...new Set(roots.map((root) => BigInt(root.proofSet.setId)))]
  const dataSetOwners = inventory.db
    .select({
      setId: dataSetsTable.setId,
      providerAddress: dataSetsTable.providerAddress,
    })
    .from(dataSetsTable)
    .where(inArray(dataSetsTable.setId, setIds))
    .all()
  const providerBySetId = new Map(dataSetOwners.map((dataSet) => [dataSet.setId, dataSet.providerAddress]))

  inventory.db
    .insert(piecesTable)
    .values(
      roots.map((root) => {
        const dataSetId = BigInt(root.proofSet.setId)
        const providerAddress = providerBySetId.get(dataSetId)

        if (!providerAddress) {
          throw new Error(`Root ${root.id} references unknown data set ${root.proofSet.setId}`)
        }

        return {
          dataSetId,
          pieceId: BigInt(root.rootId),
          subgraphId: root.id,
          providerAddress,
          cid: root.cid,
          removed: root.removed,
        }
      })
    )
    .onConflictDoUpdate({
      target: [piecesTable.dataSetId, piecesTable.pieceId],
      set: {
        subgraphId: sql`excluded.subgraph_id`,
        providerAddress: sql`excluded.provider_address`,
        cid: sql`excluded.cid`,
        removed: sql`excluded.removed`,
      },
    })
    .run()
}

export function recordSyncMetadata(inventory: InventoryDb, metadata: SyncMetadataInput): void {
  inventory.db
    .update(syncMetadata)
    .set({
      network: metadata.network,
      subgraphUrl: metadata.subgraphUrl,
      rpcUrl: metadata.rpcUrl,
      subgraphBlockNumber: BigInt(metadata.subgraph.block.number),
      subgraphBlockHash: metadata.subgraph.block.hash,
      startedAt: metadata.startedAt,
      completedAt: metadata.completedAt,
    })
    .where(eq(syncMetadata.id, 1n))
    .run()
}
