import { Cli, z } from 'incur'
import { getPiecesByGroup, getProvidersByCid } from '../db.ts'
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
      const { indexerDb, indexerSchema } = c.var
      const groupedPieces = await getPiecesByGroup(indexerDb, indexerSchema, providerId)

      return {
        pieces: groupedPieces.withCDN,
        providersByCid: await getProvidersByCid(
          indexerDb,
          indexerSchema,
          groupedPieces.withCDN.map((piece) => piece.cid),
          providerId
        ),
      }
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
