import { type Command, command } from 'cleye'

import { isNetwork, resolveDbPath, resolveNetworkDefaults } from '../config.ts'
import { type SyncProgressEvent, syncInventory } from '../sync.ts'

export const sync: Command = command(
  {
    name: 'sync',
    help: {
      description: 'Build the local repair inventory',
    },
    flags: {
      network: {
        type: String,
        description: 'Network to sync',
        placeholder: '<mainnet|calibration>',
      },
      db: {
        type: String,
        description: 'Path to the local inventory SQLite database',
        placeholder: '<path>',
      },
      subgraphUrl: {
        type: String,
        description: 'Override the network default subgraph URL',
        placeholder: '<url>',
      },
      rpcUrl: {
        type: String,
        description: 'Override the network default RPC URL',
        placeholder: '<url>',
      },
      fwssServiceAddress: {
        type: String,
        description: 'Override the network default FWSS service proxy address',
        placeholder: '<address>',
      },
    },
  },
  async (argv) => {
    const network = argv.flags.network

    if (!network || !isNetwork(network)) {
      process.stderr.write('Missing or invalid --network. Expected mainnet or calibration.\n')
      process.exitCode = 1
      return
    }

    const defaults = resolveNetworkDefaults(network)
    const dbPath = resolveDbPath(argv.flags.db)
    const subgraphUrl = argv.flags.subgraphUrl ?? defaults.subgraphUrl
    const rpcUrl = argv.flags.rpcUrl ?? defaults.rpcUrl
    const fwssServiceAddress = argv.flags.fwssServiceAddress ?? defaults.fwssServiceAddress

    try {
      const result = await syncInventory({
        dbPath,
        network,
        subgraphUrl,
        fwssServiceAddress,
        rpcUrl,
        onProgress: reportSyncProgress,
      })

      process.stdout.write(
        [
          `Synced ${result.providers} providers, ${result.dataSets} data sets, ${result.pieces} pieces.`,
          `Subgraph block: ${result.subgraphBlockNumber}${result.subgraphBlockHash ? ` (${result.subgraphBlockHash})` : ''}.`,
          `Inventory DB: ${result.dbPath}`,
          '',
        ].join('\n')
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Sync failed: ${message}\n`)
      process.exitCode = 1
    }
  }
)

function reportSyncProgress(event: SyncProgressEvent): void {
  switch (event.type) {
    case 'temp-db-opened':
      process.stderr.write(`Opened temporary inventory DB: ${event.tempDbPath}\n`)
      break
    case 'schema-initialized':
      process.stderr.write('Initialized inventory schema.\n')
      break
    case 'page-fetched':
      process.stderr.write(
        `Fetched ${event.collection} page ${event.page} from id_gt="${event.idGt}": ${event.rows} rows (${event.totalRows} total).\n`
      )
      break
    case 'rows-imported':
      process.stderr.write(`Imported ${event.rows} ${event.collection} rows.\n`)
      break
    case 'piece-count-fetched':
      process.stderr.write(
        `Subgraph reports ${event.pieces.toLocaleString()} piece slots to fetch, including removed pieces.\n`
      )
      break
    case 'metadata-fetched':
      process.stderr.write(
        `Fetched subgraph metadata at block ${event.subgraphBlockNumber}${event.subgraphBlockHash ? ` (${event.subgraphBlockHash})` : ''}.\n`
      )
      break
    case 'metadata-recorded':
      process.stderr.write('Recorded sync metadata.\n')
      break
    case 'db-replaced':
      process.stderr.write(`Replaced inventory DB: ${event.dbPath}\n`)
      break
    case 'complete':
      process.stderr.write('Sync complete.\n')
      break
  }
}
