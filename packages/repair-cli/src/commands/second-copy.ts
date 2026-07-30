import { and, desc, eq, inArray } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { isAddress } from 'viem'
import { repairDelete } from '../db/repair-delete.ts'
import { secondCopyCreate } from '../db/second-copy-create.ts'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { runAddPieces } from '../pipeline/add-pieces.ts'
import { ensureRepairDataset } from '../pipeline/create-datasets.ts'
import { globalOptions } from '../utils.ts'

export const secondCopy = Cli.create('second-copy', {
  description: 'Second-copy piece commands',
  vars: contextSchema,
})

secondCopy.command('create', {
  description: 'Create a second-copy job from a pieces file',
  options: globalOptions.extend({
    piecesFile: z.string().describe('Path to JSON file with aggregates[].piece_cid'),
    sourceProviderUrl: z.string().url().describe('Source provider URL to pull pieces from'),
    targetProviderId: z.coerce.bigint().describe('Target provider ID for second-copy'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { piecesFile, sourceProviderUrl, targetProviderId } = c.options

      const secondCopyId = await secondCopyCreate({
        ...c.var,
        piecesFile,
        sourceProviderUrl,
        targetProviderId,
      })

      return c.ok({
        secondCopyId,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'SECOND_COPY_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create the second-copy job',
        retryable: true,
      })
    }
  },
})

secondCopy.command('list', {
  description: 'List all second-copy jobs',
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const localSchema = c.var.localDb._.fullSchema
      const jobs = await c.var.localDb.query.repairs.findMany({
        where: eq(localSchema.repairs.kind, 'second_copy'),
        orderBy: [desc(localSchema.repairs.createdAt)],
        with: {
          operations: true,
        },
      })

      const secondCopies = jobs.map((repair) => {
        const { operations, ...job } = repair
        return {
          id: job.id,
          status: job.status,
          sourceProviderUrl: job.sourceProviderUrl,
          targetProviderId: job.targetProviderId,
          targetProviderUrl: job.targetProviderUrl,
          targetDataSetId: job.targetDataSetId,
          blockNumber: job.blockNumber,
          operations: operations.length,
          pending: operations.filter((operation) => operation.status === 'pending').length,
          failed: operations.filter((operation) => operation.status === 'failed').length,
          completed: operations.filter((operation) => operation.status === 'completed').length,
          skipped: operations.filter((operation) => operation.status === 'skipped').length,
        }
      })

      return c.ok({
        secondCopies,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'SECOND_COPY_FAILED',
        message: error instanceof Error ? error.message : 'Failed to list second-copy jobs',
        retryable: true,
      })
    }
  },
})

secondCopy.command('delete', {
  description: 'Delete a second-copy job',
  args: z.object({
    secondCopyId: z.coerce.number().describe('Second-copy ID to delete'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { deleted, operationsDeleted } = await repairDelete({
        localDb: c.var.localDb,
        repairId: c.args.secondCopyId,
      })

      if (!deleted) {
        return c.error({
          code: 'SECOND_COPY_NOT_FOUND',
          message: 'Second-copy job not found',
          retryable: false,
        })
      }

      return c.ok({
        secondCopyId: c.args.secondCopyId,
        operationsDeleted,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'SECOND_COPY_FAILED',
        message: error instanceof Error ? error.message : 'Failed to delete the second-copy job',
        retryable: true,
      })
    }
  },
})

secondCopy.command('run', {
  description: 'Run a second-copy job',
  args: z.object({
    secondCopyId: z.coerce.number().describe('Second-copy ID to run'),
  }),
  options: globalOptions.extend({
    concurrency: z.coerce.number().min(1).max(10).default(4).describe('Concurrency level'),
    batchSize: z.coerce.number().min(1).max(40).default(40).describe('Max pieces per batch'),
    payer: z.string().refine(isAddress, 'Invalid address').optional().describe('Payer address'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const schema = c.var.localDb._.fullSchema
      const payer = c.options.payer ?? c.var.client.account.address
      const repair = await c.var.localDb.query.repairs.findFirst({
        where: and(
          eq(schema.repairs.id, c.args.secondCopyId),
          inArray(schema.repairs.status, ['pending', 'failed']),
          eq(schema.repairs.kind, 'second_copy')
        ),
      })
      if (!repair) {
        return c.error({
          code: 'SECOND_COPY_NOT_FOUND',
          message: 'Second-copy job not found, it may have already been run or completed',
          retryable: false,
        })
      }

      await ensureRepairDataset({
        ...c.var,
        repair,
        payer,
      })

      await runAddPieces({
        ...c.var,
        repair,
        concurrency: c.options.concurrency,
        batchSize: c.options.batchSize,
      })
      return c.ok({
        secondCopyId: repair.id,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'SECOND_COPY_FAILED',
        message: error instanceof Error ? error.message : 'Failed to run the second-copy job',
        retryable: true,
      })
    }
  },
})
