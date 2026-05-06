import {
  openInventoryDb,
  readInventoryMetadata,
  readInventoryTableCounts,
  UnsupportedInventorySchemaError,
} from './db.ts'

export type InventoryStatus =
  | {
      exists: false
      path: string
      schemaVersion: null
      ok: true
      empty: true
      stale: 'unknown'
      metadata: null
      counts: Record<string, number>
    }
  | {
      exists: true
      path: string
      schemaVersion: number
      ok: true
      empty: boolean
      stale: 'unknown'
      metadata: {
        network: string | null
        subgraphUrl: string | null
        rpcUrl: string | null
        subgraphBlockNumber: number | null
        subgraphBlockHash: string | null
        startedAt: string | null
        completedAt: string | null
      }
      counts: Record<string, number>
    }

export class InventoryStatusError extends Error {
  readonly causeMessage: string | undefined

  constructor(message: string, cause: unknown) {
    super(cause instanceof Error ? `${message}: ${cause.message}` : message)
    this.name = 'InventoryStatusError'
    this.causeMessage = cause instanceof Error ? cause.message : undefined
  }
}

export { UnsupportedInventorySchemaError }

export function readInventoryStatus(dbPath: string): InventoryStatus {
  const inventory = (() => {
    try {
      return openInventoryDb(dbPath, { mode: 'status' })
    } catch (error) {
      if (error instanceof UnsupportedInventorySchemaError) {
        throw error
      }

      throw new InventoryStatusError(`Failed to open inventory DB at ${dbPath}`, error)
    }
  })()

  if (!inventory) {
    return {
      exists: false,
      path: dbPath,
      schemaVersion: null,
      ok: true,
      empty: true,
      stale: 'unknown',
      metadata: null,
      counts: {},
    }
  }

  try {
    const metadata = readInventoryMetadata(inventory)
    const counts = readInventoryTableCounts(inventory)

    return {
      exists: true,
      path: dbPath,
      schemaVersion: Number(metadata.schemaVersion),
      ok: true,
      empty: Object.values(counts).every((count) => count === 0),
      stale: 'unknown',
      metadata: {
        network: metadata.network,
        subgraphUrl: metadata.subgraphUrl,
        rpcUrl: metadata.rpcUrl,
        subgraphBlockNumber: metadata.subgraphBlockNumber === null ? null : Number(metadata.subgraphBlockNumber),
        subgraphBlockHash: metadata.subgraphBlockHash,
        startedAt: metadata.startedAt,
        completedAt: metadata.completedAt,
      },
      counts,
    }
  } catch (error) {
    if (error instanceof UnsupportedInventorySchemaError) {
      throw error
    }

    throw new InventoryStatusError(`Failed to read inventory DB at ${dbPath}`, error)
  } finally {
    inventory.close()
  }
}
