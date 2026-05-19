#!/usr/bin/env node
import { Cli } from 'incur'
import { repair } from './commands/repair.ts'
import { setup } from './commands/setup.ts'
import { wallet } from './commands/wallet.ts'

const cli = Cli.create('repair', {
  version: '0.0.0',
  description: 'Early repair for faulty service providers and datasets',
})

cli.command(setup)
cli.command(wallet)
cli.command(repair)
cli.serve()
