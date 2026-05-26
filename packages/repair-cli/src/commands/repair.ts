import { and, desc, eq, inArray } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { createRepair } from '../db/create-repair.ts'
import { deleteRepair } from '../db/delete-repair.ts'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { runCreateDatasetsPhase } from '../pipeline/create-datasets.ts'
import { runPullPiecesPhase } from '../pipeline/pull.ts'
import { globalOptions } from '../utils.ts'
export const repair = Cli.create('repair', {
  description: 'Repair commands',
  vars: contextSchema,
})

repair.command('create', {
  description: 'Create a new repair',
  options: globalOptions.extend({
    providerId: z.coerce.bigint().describe('Provider ID to repair'),
    targetProviderId: z.coerce.bigint().optional().describe('Target provider ID for repair'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { providerId, targetProviderId } = c.options

      const repairId = await createRepair({
        ...c.var,
        repairProviderId: providerId,
        targetProviderId,
      })

      return c.ok({
        repairId,
      })
    } catch (error) {
      // console.error(error)
      return c.error({
        code: 'REPAIR_FAILED',
        message: error instanceof Error ? error.message : 'Failed to repair the dataset',
        retryable: true,
      })
    }
  },
})

repair.command('list', {
  description: 'List all repairs',
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const localSchema = c.var.localDb._.fullSchema
      const repairs = await c.var.localDb.query.repairs.findMany({
        orderBy: [desc(localSchema.repairs.createdAt)],
        with: {
          operations: {
            where: eq(localSchema.operations.status, 'pending'),
          },
        },
      })

      const repairFlattened = repairs.map((repair) => {
        const { operations, ...repairWithoutOperations } = repair
        return {
          id: repairWithoutOperations.id,
          status: repairWithoutOperations.status,
          repairProviderId: repairWithoutOperations.repairProviderId,
          targetProviderId: repairWithoutOperations.targetProviderId,
          targetDataSets: repairWithoutOperations.targetDataSets,
          createdAt: new Date(repairWithoutOperations.createdAt).toISOString(),
          updatedAt: new Date(repairWithoutOperations.updatedAt).toISOString(),
          operations: operations.length,
        }
      })

      return c.ok({
        repairs: repairFlattened,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPAIR_FAILED',
        message: error instanceof Error ? error.message : 'Failed to repair the dataset',
        retryable: true,
      })
    }
  },
})

repair.command('delete', {
  description: 'Delete a repair',
  args: z.object({
    repairId: z.coerce.number().describe('Repair ID to delete'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { deleted, operationsDeleted } = await deleteRepair({
        localDb: c.var.localDb,
        repairId: c.args.repairId,
      })

      if (!deleted) {
        return c.error({
          code: 'REPAIR_NOT_FOUND',
          message: 'Repair not found',
          retryable: false,
        })
      }

      return c.ok({
        repairId: c.args.repairId,
        operationsDeleted,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPAIR_FAILED',
        message: error instanceof Error ? error.message : 'Failed to delete the repair',
        retryable: true,
      })
    }
  },
})

repair.command('run', {
  description: 'Run a repair',
  args: z.object({
    repairId: z.coerce.number().describe('Repair ID to run'),
  }),
  options: globalOptions.extend({
    concurrency: z.coerce.number().default(4).describe('Concurrency level'),
    batchSize: z.coerce.number().default(10).describe('Max add_piece operations per pull batch (same group)'),
    reset: z.boolean().default(false).describe('Reset the repair'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const schema = c.var.localDb._.fullSchema
      const repair = await c.var.localDb.query.repairs.findFirst({
        where: and(eq(schema.repairs.id, c.args.repairId), inArray(schema.repairs.status, ['pending'])),
      })
      if (!repair) {
        return c.error({
          code: 'REPAIR_NOT_FOUND',
          message: 'Repair not found, it may have already been run or completed',
          retryable: false,
        })
      }

      const concurrency = Math.max(1, c.options.concurrency)
      await runCreateDatasetsPhase({
        localDb: c.var.localDb,
        indexerDb: c.var.indexerDb,
        client: c.var.client,
        repair,
        concurrency,
        reset: c.options.reset,
      })

      await runPullPiecesPhase({
        localDb: c.var.localDb,
        repair,
        concurrency,
        batchSize: c.options.batchSize,
        client: c.var.client,
      })
      return c.ok({
        repairId: repair.id,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPAIR_FAILED',
        message: error instanceof Error ? error.message : 'Failed to repair the dataset',
        retryable: true,
      })
    }
  },
})
