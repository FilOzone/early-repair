import * as p from '@clack/prompts'
import { Cli, z } from 'incur'
import path from 'path'
import type { Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { DEFAULT_API_URL } from '../api.ts'
import { config, createLocalDatabase, globalOptions, migrateLocalDatabase } from '../utils.ts'

function validateHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const setup = Cli.create('setup', {
  description: 'Setup the CLI',
  options: globalOptions,
  run: async (c) => {
    try {
      // Private key
      const pk = await p.text({
        message: 'Enter your private key',
        validate(value) {
          if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
            return `Invalid private key! (must be 64 hex characters) starting with 0x`
          }
        },
        initialValue: config.get('privateKey'),
        withGuide: false,
      })
      if (p.isCancel(pk)) {
        return c.error({
          code: 'SETUP_CANCELLED',
          message: 'Setup cancelled',
          retryable: false,
        })
      }

      // API URL
      const apiUrl = await p.text({
        message: 'Enter the Filecoin API URL',
        validate(value) {
          if (!value || !validateHttpUrl(value)) {
            return `Invalid http(s) URL!`
          }
        },
        initialValue: config.get('apiUrl') ?? DEFAULT_API_URL,
        withGuide: false,
      })
      if (p.isCancel(apiUrl)) {
        return c.error({
          code: 'SETUP_CANCELLED',
          message: 'Setup cancelled',
          retryable: false,
        })
      }

      // Chain
      const chainId = await p.select({
        message: 'Select your chain',
        options: [
          { value: 314, label: 'Mainnet' },
          { value: 314159, label: 'Calibration' },
        ],
        withGuide: false,
        initialValue: config.get('chainId'),
      })
      if (p.isCancel(chainId)) {
        return c.error({
          code: 'SETUP_CANCELLED',
          message: 'Setup cancelled',
          retryable: false,
        })
      }

      // DB path
      const dbPath = await p.text({
        message: 'Enter your DB path',
        initialValue: config.get('dbPath') || path.join(path.dirname(config.path), 'sqlite.db'),
        withGuide: false,
      })
      if (p.isCancel(dbPath)) {
        return c.error({
          code: 'SETUP_CANCELLED',
          message: 'Setup cancelled',
          retryable: false,
        })
      }

      const source = await p.text({
        message: 'Enter your source',
        placeholder: 'Dataset source',
        defaultValue: 'early-repair',
        initialValue: config.get('source'),
        withGuide: false,
      })
      if (p.isCancel(source)) {
        return c.error({
          code: 'SETUP_CANCELLED',
          message: 'Setup cancelled',
          retryable: false,
        })
      }

      // Set config
      config.set('privateKey', pk)
      config.set('apiUrl', apiUrl)
      config.set('chainId', chainId)
      config.set('dbPath', dbPath)
      config.set('source', source)

      // setup database
      const db = await createLocalDatabase(dbPath)
      await migrateLocalDatabase(db)

      const account = privateKeyToAccount(pk as Hash)

      return c.ok({
        address: account.address,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'SETUP_FAILED',
        message: error instanceof Error ? error.message : 'Failed to setup the CLI',
        retryable: true,
      })
    }
  },
})
