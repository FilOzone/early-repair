import { type Command, command } from 'cleye'

import { resolveDbPath } from '../config.ts'
import { readInventoryStatus } from '../status.ts'
import { formatJson, formatStatusText } from '../status-output.ts'

export const status: Command = command(
  {
    name: 'status',
    help: {
      description: 'Read the status of the local repair inventory',
    },
    flags: {
      db: {
        type: String,
        description: 'Path to the local inventory SQLite database',
        placeholder: '<path>',
      },
      json: {
        type: Boolean,
        description: 'Print structured JSON output',
        default: false,
      },
    },
  },
  (argv) => {
    const dbPath = resolveDbPath(argv.flags.db)

    try {
      const inventoryStatus = readInventoryStatus(dbPath)
      process.stdout.write(argv.flags.json ? formatJson(inventoryStatus) : formatStatusText(inventoryStatus))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (argv.flags.json) {
        process.stderr.write(formatJson({ ok: false, error: message, path: dbPath }))
      } else {
        process.stderr.write(`${message}\n`)
      }

      process.exitCode = 1
    }
  }
)
