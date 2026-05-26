/** biome-ignore-all lint/suspicious/noConsole: cli */
import * as ERC20 from '@filoz/synapse-core/erc20'
import * as Pay from '@filoz/synapse-core/pay'
import { claimTokens, formatBalance, formatFraction, parseUnits } from '@filoz/synapse-core/utils'
import { Cli, z } from 'incur'
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
  async *run(c) {
    const { client, chain } = c.var

    yield 'Funding wallet...'
    try {
      const hashes = await claimTokens({ address: client.account.address })

      yield `Waiting for tx ${hashLink(hashes[0].tx_hash, chain)} to be mined...`
      await waitForTransactionReceipt(client, {
        hash: hashes[0].tx_hash,
      })
      const balance = await getBalance(client, {
        address: client.account.address,
      })
      yield {
        address: client.account.address,
        balance: formatBalance({ value: balance }),
      }
    } catch (error) {
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_FUND_WALLET',
        message: 'Failed to fund wallet',
      })
    }
  },
})

wallet.command('balance', {
  description: 'Get wallet and pay account summary',
  options: globalOptions,
  middleware: [contextMiddleware],
  async run(c) {
    const { client } = c.var
    const balanceFIL = await getBalance(client, {
      address: client.account.address,
    })

    const balanceUSDFC = await ERC20.balance(client, {
      address: client.account.address,
    })

    const summary = await Pay.getAccountSummary(client, {
      address: client.account.address,
    })
    return {
      address: client.account.address,
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
  async *run(c) {
    const { client, chain } = c.var

    try {
      yield `Depositing ${c.args.amount} tokens to wallet...`
      const hash = await Pay.depositAndApprove(client, {
        amount: parseUnits(c.args.amount),
      })
      yield `Waiting for tx ${hashLink(hash, chain)} to be mined...`
      await waitForTransactionReceipt(client, {
        hash,
      })
      yield `Deposit successful`
      return
    } catch (error) {
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_DEPOSIT',
        message: (error as Error).message,
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
  async *run(c) {
    const { client, chain } = c.var

    try {
      yield `Withdrawing ${c.args.amount} USDFC from pay account...`
      const hash = await Pay.withdraw(client, {
        amount: parseUnits(c.args.amount),
      })
      yield `Waiting for tx ${hashLink(hash, chain)} to be mined...`
      await waitForTransactionReceipt(client, {
        hash,
      })
      yield `Withdrawal successful`
      return
    } catch (error) {
      if (c.options.debug) {
        console.error(error)
      }
      return c.error({
        code: 'FAILED_TO_WITHDRAW',
        message: (error as Error).message,
      })
    }
  },
})
