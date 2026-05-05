#!/usr/bin/env node

import { cli } from 'cleye'

const argv = cli({
  name: 'early-repair',
  version: '0.0.0',
  flags: {
    verbose: {
      type: Boolean,
      description: 'Print additional diagnostic output',
      default: false,
    },
  },
})

if (argv.flags.verbose) {
  console.error('Verbose logging enabled')
}

argv.showHelp()
