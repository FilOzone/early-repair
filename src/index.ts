#!/usr/bin/env node

import { cli } from 'cleye'

import { status } from './commands/status.ts'
import { sync } from './commands/sync.ts'

const argv = cli({
  name: 'early-repair',
  version: '0.0.0',
  commands: [status, sync],
  flags: {
    verbose: {
      type: Boolean,
      description: 'Print additional diagnostic output',
      default: false,
    },
  },
})

if (!argv.command) {
  argv.showHelp()
  process.exitCode = 1
}
