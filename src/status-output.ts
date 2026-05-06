import type { InventoryStatus } from './status.ts'

export function formatStatusText(status: InventoryStatus): string {
  const rows: [string, string][] = [
    ['Path', status.path],
    ['Exists', String(status.exists)],
    ['Schema version', status.schemaVersion === null ? 'missing' : String(status.schemaVersion)],
    ['Empty', String(status.empty)],
    ['Stale', status.stale],
  ]

  if (status.metadata) {
    rows.push(
      ['Network', status.metadata.network ?? 'unknown'],
      ['Subgraph URL', status.metadata.subgraphUrl ?? 'unknown'],
      ['RPC URL', status.metadata.rpcUrl ?? 'unknown'],
      ['Subgraph block', formatBlock(status.metadata.subgraphBlockNumber, status.metadata.subgraphBlockHash)],
      ['Started at', status.metadata.startedAt ?? 'unknown'],
      ['Completed at', status.metadata.completedAt ?? 'unknown']
    )
  }

  if (Object.keys(status.counts).length > 0) {
    rows.push(['Rows', ''])

    for (const [table, count] of Object.entries(status.counts)) {
      rows.push([`  ${table}`, String(count)])
    }
  }

  return formatRows(rows)
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function formatBlock(number: number | null, hash: string | null): string {
  if (number === null && hash === null) {
    return 'unknown'
  }

  if (hash === null) {
    return String(number)
  }

  if (number === null) {
    return hash
  }

  return `${number} (${hash})`
}

function formatRows(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length))

  return `${rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n')}\n`
}
