import * as p from '@clack/prompts'
import * as SessionKey from '@filoz/synapse-core/session-key'
import { Cli, z } from 'incur'
import { type Address, isAddress } from 'viem'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions, hashLink } from '../utils.ts'

const sessionKeyAddressArgs = z.object({
  address: z.string().refine(isAddress, 'Invalid session key address').describe('Session key address'),
})

export const sessionKey = Cli.create('session-key', {
  description: 'Session key commands',
  vars: contextSchema,
})

sessionKey.command('approve', {
  description: 'Approve a session key for storage operations',
  args: sessionKeyAddressArgs,
  options: globalOptions.extend({
    expiresInDays: z.coerce.number().gt(0).default(100).describe('Session key expiry duration in days'),
    origin: z.string().optional().describe('Origin recorded on-chain for the authorization'),
  }),
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { client, chain, source, isInteractive } = c.var
    const address = c.args.address as Address
    const expiresAt = BigInt(Math.floor(Date.now() / 1000 + c.options.expiresInDays * 24 * 60 * 60))
    const spinner = p.spinner()

    try {
      if (isInteractive) {
        spinner.start(`Approving session key ${address}...`)
      }
      const result = await SessionKey.loginSync(client, {
        address,
        expiresAt,
        origin: c.options.origin ?? source,
        onHash: (hash) => {
          if (isInteractive) {
            spinner.message(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
          }
        },
      })

      if (isInteractive) {
        spinner.stop(`Session key ${address} approved successfully.`)
      }

      return c.ok({
        address,
        expiresAt: expiresAt.toString(),
        transactionHash: result.receipt.transactionHash,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to approve session key'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_APPROVE_SESSION_KEY',
        message: msg,
      })
    }
  },
})

sessionKey.command('revoke', {
  description: 'Revoke a session key for storage operations',
  args: sessionKeyAddressArgs,
  options: globalOptions.extend({
    origin: z.string().optional().describe('Origin recorded on-chain for the revocation'),
  }),
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { client, chain, source, isInteractive } = c.var
    const address = c.args.address as Address
    const spinner = p.spinner()

    try {
      if (isInteractive) {
        spinner.start(`Revoking session key ${address}...`)
      }
      const result = await SessionKey.revokeSync(client, {
        address,
        origin: c.options.origin ?? source,
        onHash: (hash) => {
          if (isInteractive) {
            spinner.message(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
          }
        },
      })

      if (isInteractive) {
        spinner.stop(`Session key ${address} revoked successfully.`)
      }

      return c.ok({
        address,
        transactionHash: result.receipt.transactionHash,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to revoke session key'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_REVOKE_SESSION_KEY',
        message: msg,
      })
    }
  },
})
