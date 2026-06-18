#!/usr/bin/env node
import { Cli } from 'incur'
import { datasets } from './commands/datasets.ts'
import { providers } from './commands/providers.ts'
import { repair } from './commands/repair.ts'
import { replicate } from './commands/replicate.ts'
import { setup } from './commands/setup.ts'
import { wallet } from './commands/wallet.ts'
import { version } from './utils.ts'

const cli = Cli.create('repair', {
  version,
  description: 'Early repair for faulty service providers and datasets',
})

cli.command(setup)
cli.command(wallet)
cli.command(repair)
cli.command(replicate)
cli.command(datasets)
cli.command(providers)
cli.serve()
