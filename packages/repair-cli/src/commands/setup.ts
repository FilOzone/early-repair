import * as p from '@clack/prompts'
import { drizzle } from 'drizzle-orm/libsql'
import { Cli, z } from 'incur'
import path from 'path'
import type { Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type * as schema from '../local-schema.ts'
import { config, globalOptions, migrateLocalDatabase } from '../utils.ts'

function validatePostgresUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return false
  }

  return Boolean(url.hostname && url.username && url.password && url.pathname.length > 1)
}

export const setup = Cli.create('setup', {
  description: 'Setup the CLI',
  options: globalOptions.extend({
    privateKey: z.string().optional().describe('Private key to use'),
  }),
  run: async (c) => {
    try {
      // Private key
      const pk = await p.text({
        message: 'Enter your private key',
        validate(value) {
          if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
            return `Invalid private key!`
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

      // Indexer URL
      const indexerUrl = await p.text({
        message: 'Enter your Indexer Postgres URL',
        validate(value) {
          if (!value || !validatePostgresUrl(value)) {
            return `Invalid postgres URL!`
          }
        },
        initialValue: config.get('indexerUrl'),
        withGuide: false,
      })
      if (p.isCancel(indexerUrl)) {
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

      // Set config
      config.set('privateKey', pk)
      config.set('indexerUrl', indexerUrl)
      config.set('dbPath', dbPath)

      // setup database
      const db = drizzle<typeof schema>(`file:${dbPath}`)
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
