/** biome-ignore-all lint/suspicious/noConsole: cli */
import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import * as ERC20 from '@filoz/synapse-core/erc20'
import * as Pay from '@filoz/synapse-core/pay'
import { claimTokens, formatBalance, formatFraction, parseUnits } from '@filoz/synapse-core/utils'
import { Cli, z } from 'incur'
import { isAddress } from 'viem'
import { getBalance, waitForTransactionReceipt } from 'viem/actions'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions, hashLink } from '../utils.ts'

export const wallet = Cli.create('wallet', {
  description: 'Wallet commands',
  vars: contextSchema,
})

wallet.command('fund', {
  description: 'Fund a calibration wallet from a faucet',
  options: globalOptions,
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { client, chain, isInteractive } = c.var

    if (chain.id !== calibration.id) {
      return c.error({
        code: 'INVALID_CHAIN',
        message: `Wallet fund is only available on Filecoin Calibration (chain ID ${calibration.id})`,
      })
    }

    const spinner = p.spinner()
    try {
      if (isInteractive) {
        spinner.start('Funding wallet...')
      }
      const hashes = await claimTokens({ address: client.account.address })

      if (isInteractive) {
        spinner.message(`Waiting for tx ${hashLink(hashes[0].tx_hash, chain)} to be mined...`)
      }
      await waitForTransactionReceipt(client, {
        hash: hashes[0].tx_hash,
      })
      const balance = await getBalance(client, {
        address: client.account.address,
      })
      if (isInteractive) {
        spinner.stop('Wallet funded successfully.')
      }
      return c.ok({
        address: client.account.address,
        balance: formatBalance({ value: balance }),
        transactionHash: hashes[0].tx_hash,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to fund wallet'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_FUND_WALLET',
        message: msg,
      })
    }
  },
})

wallet.command('balance', {
  description: 'Get wallet and pay account summary',
  options: globalOptions.extend({
    address: z.string().refine(isAddress, 'Invalid address').optional().describe('Address to get balance for'),
  }),
  middleware: [contextMiddleware],
  async run(c) {
    const { client } = c.var
    const address = c.options.address ?? client.account.address
    const balanceFIL = await getBalance(client, {
      address,
    })

    const balanceUSDFC = await ERC20.balance(client, {
      address,
    })

    const summary = await Pay.getAccountSummary(client, {
      address,
    })
    return {
      address,
      fil: formatBalance({ value: balanceFIL }),
      usdfc: formatBalance({ value: balanceUSDFC.value }),
      pay: {
        funds: formatBalance({ value: summary.funds }),
        availableFunds: formatBalance({ value: summary.availableFunds }),
        debt: formatBalance({ value: summary.debt }),
        lockupRatePerEpoch: formatFraction({ value: summary.lockupRatePerEpoch }),
        lockupRatePerMonth: formatBalance({ value: summary.lockupRatePerMonth }),
        totalLockup: formatBalance({ value: summary.totalLockup }),
        totalFixedLockup: formatBalance({ value: summary.totalFixedLockup }),
        totalRateBasedLockup: formatBalance({ value: summary.totalRateBasedLockup }),
        runwayInEpochs: summary.runwayInEpochs,
        grossCoverageInEpochs: summary.grossCoverageInEpochs,
        epoch: summary.epoch,
      },
    }
  },
})

wallet.command('deposit', {
  description: 'Deposit wallet funds to a pay account',
  args: z.object({
    amount: z.coerce.number().gt(0).describe('Amount of USDFC to deposit'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { client, chain, isInteractive } = c.var
    const spinner = p.spinner()

    try {
      if (isInteractive) {
        spinner.start(`Depositing ${c.args.amount} USDFC to pay account...`)
      }
      const hash = await Pay.depositAndApprove(client, {
        amount: parseUnits(c.args.amount),
      })
      if (isInteractive) {
        spinner.message(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
      }
      await waitForTransactionReceipt(client, {
        hash,
      })
      if (isInteractive) {
        spinner.stop('Deposit successful.')
      }
      return c.ok({
        amount: c.args.amount,
        transactionHash: hash,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to deposit'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_DEPOSIT',
        message: msg,
      })
    }
  },
})

wallet.command('withdraw', {
  description: 'Withdraw wallet funds from a pay account',
  args: z.object({
    amount: z.coerce.number().gt(0).describe('Amount of USDFC to withdraw'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  outputPolicy: 'agent-only',
  run: async (c) => {
    const { client, chain, isInteractive } = c.var
    const spinner = p.spinner()

    try {
      if (isInteractive) {
        spinner.start(`Withdrawing ${c.args.amount} USDFC from pay account...`)
      }
      const hash = await Pay.withdraw(client, {
        amount: parseUnits(c.args.amount),
      })
      if (isInteractive) {
        spinner.message(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
      }
      await waitForTransactionReceipt(client, {
        hash,
      })
      if (isInteractive) {
        spinner.stop('Withdrawal successful.')
      }
      return c.ok({
        amount: c.args.amount,
        transactionHash: hash,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to withdraw'
      if (isInteractive) {
        spinner.error(msg)
      }
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_WITHDRAW',
        message: msg,
      })
    }
  },
})
