import { and, desc, eq, inArray } from 'drizzle-orm'
import type { queueAsPromised } from 'fastq'
import fastq from 'fastq'
import { Cli, z } from 'incur'
import { createRepair } from '../db.ts'
import type { SelectOperation } from '../local-schema.ts'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { globalOptions } from '../utils.ts'
export const repair = Cli.create('repair', {
  description: 'Repair commands',
  vars: contextSchema,
})

repair.command('create', {
  description: 'Create a new repair',
  options: globalOptions.extend({
    providerId: z.coerce.bigint().describe('Provider ID to repair'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { providerId } = c.options
      const { indexerDb, indexerSchema, localDb, localSchema, client } = c.var

      const repairId = await createRepair({
        indexerDb,
        indexerSchema,
        localDb,
        localSchema,
        repairProviderId: providerId,
        payer: client.account.address,
      })

      return c.ok({
        repairId,
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

repair.command('list', {
  description: 'List all repairs',
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const repairs = await c.var.localDb.query.repairs.findMany({
        orderBy: [desc(c.var.localSchema.repairs.createdAt)],
        with: {
          operations: true,
        },
      })

      const repairFlattened = repairs.map((repair) => {
        const { operations, ...repairWithoutOperations } = repair
        return {
          id: repairWithoutOperations.id,
          status: repairWithoutOperations.status,
          repairProviderId: repairWithoutOperations.repairProviderId,
          targetProviderId: repairWithoutOperations.targetProviderId,
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

repair.command('run', {
  description: 'Run a repair',
  args: z.object({
    repairId: z.coerce.number().describe('Repair ID to run'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const repair = await c.var.localDb.query.repairs.findFirst({
        where: and(
          eq(c.var.localSchema.repairs.id, c.args.repairId),
          inArray(c.var.localSchema.repairs.status, ['pending', 'running'])
        ),
        with: {
          operations: {
            where: and(
              eq(c.var.localSchema.operations.status, 'pending'),
              eq(c.var.localSchema.operations.type, 'create_dataset')
            ),
          },
        },
      })
      if (!repair) {
        return c.error({
          code: 'REPAIR_NOT_FOUND',
          message: 'Repair not found, it may have already been run or completed',
          retryable: false,
        })
      }

      async function worker(operation: SelectOperation) {
        console.log('Processing operation', operation)
      }

      const queue: queueAsPromised<SelectOperation> = fastq.promise(worker, 4)
      for (const operation of repair.operations) {
        queue.push(operation).catch(console.error)
      }

      await queue.drain()
      return c.ok({
        repair,
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
