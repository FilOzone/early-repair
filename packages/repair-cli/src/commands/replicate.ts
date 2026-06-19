import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Cli, z } from 'incur'
import { isAddress } from 'viem'
import { repairDelete } from '../db/repair-delete.ts'
import { replicateCreate } from '../db/replicate-create.ts'
import { contextMiddleware, contextSchema } from '../middleware.ts'
import { runAddPieces } from '../pipeline/add-pieces.ts'
import { ensureReplicateDataset } from '../pipeline/create-datasets.ts'
import { globalOptions } from '../utils.ts'

export const replicate = Cli.create('replicate', {
  description: 'Replicate dataset commands',
  vars: contextSchema,
})

replicate.command('create', {
  description: 'Create a new dataset replication',
  options: globalOptions.extend({
    dataSetId: z.coerce.bigint().describe('Dataset ID to replicate'),
    targetProviderId: z.coerce.bigint().describe('Target provider ID for replication'),
  }),
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { dataSetId, targetProviderId } = c.options

      const replicateId = await replicateCreate({
        ...c.var,
        dataSetId,
        targetProviderId,
      })

      return c.ok({
        replicateId,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPLICATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to replicate the dataset',
        retryable: true,
      })
    }
  },
})

replicate.command('list', {
  description: 'List all replications',
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const localSchema = c.var.localDb._.fullSchema
      const replications = await c.var.localDb.query.repairs.findMany({
        where: isNotNull(localSchema.repairs.repairDataSetId),
        orderBy: [desc(localSchema.repairs.createdAt)],
        with: {
          operations: true,
        },
      })

      const replicationsFlattened = replications.map((repair) => {
        const { operations, ...replicationWithoutOperations } = repair
        return {
          id: replicationWithoutOperations.id,
          status: replicationWithoutOperations.status,
          sourceProviderId: replicationWithoutOperations.repairProviderId,
          sourceDataSetId: replicationWithoutOperations.repairDataSetId,
          targetProviderId: replicationWithoutOperations.targetProviderId,
          targetProviderUrl: replicationWithoutOperations.targetProviderUrl,
          targetDataSetId: replicationWithoutOperations.targetDataSetId,
          blockNumber: replicationWithoutOperations.blockNumber,
          operations: operations.length,
          pending: operations.filter((operation) => operation.status === 'pending').length,
          failed: operations.filter((operation) => operation.status === 'failed').length,
          completed: operations.filter((operation) => operation.status === 'completed').length,
          skipped: operations.filter((operation) => operation.status === 'skipped').length,
        }
      })

      return c.ok({
        replications: replicationsFlattened,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPLICATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to list replications',
        retryable: true,
      })
    }
  },
})

replicate.command('delete', {
  description: 'Delete a replication',
  args: z.object({
    replicateId: z.coerce.number().describe('Replication ID to delete'),
  }),
  options: globalOptions,
  middleware: [contextMiddleware],
  run: async (c) => {
    try {
      const { deleted, operationsDeleted } = await repairDelete({
        localDb: c.var.localDb,
        repairId: c.args.replicateId,
      })

      if (!deleted) {
        return c.error({
          code: 'REPLICATE_NOT_FOUND',
          message: 'Replication not found',
          retryable: false,
        })
      }

      return c.ok({
        replicateId: c.args.replicateId,
        operationsDeleted,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPLICATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to delete the replication',
        retryable: true,
      })
    }
  },
})

replicate.command('run', {
  description: 'Run a replication',
  args: z.object({
    replicateId: z.coerce.number().describe('Replication ID to run'),
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
          eq(schema.repairs.id, c.args.replicateId),
          inArray(schema.repairs.status, ['pending', 'failed']),
          isNotNull(schema.repairs.repairDataSetId)
        ),
      })
      if (!repair) {
        return c.error({
          code: 'REPLICATE_NOT_FOUND',
          message: 'Replication not found, it may have already been run or completed',
          retryable: false,
        })
      }

      await ensureReplicateDataset({
        ...c.var,
        repair,
        payer,
        source: c.var.source,
      })

      await runAddPieces({
        ...c.var,
        repair,
        concurrency: c.options.concurrency,
        batchSize: c.options.batchSize,
      })
      return c.ok({
        replicateId: repair.id,
      })
    } catch (error) {
      console.error(error)
      return c.error({
        code: 'REPLICATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to replicate the dataset',
        retryable: true,
      })
    }
  },
})
