import { type Command, command } from 'cleye'

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
    },
  },
  () => {
    process.stderr.write('sync is not implemented yet\n')
    process.exitCode = 1
  }
)
