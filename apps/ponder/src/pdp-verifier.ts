import { ponder } from 'ponder:registry'
import { dataSets, pieces } from 'ponder:schema'
import { eventBlock } from './event-utils.ts'

ponder.on('PDPVerifier:PiecesRemoved', async ({ event, context }) => {
  const { setId, pieceIds } = event.args
  const block = eventBlock(event)

  for (const pieceId of pieceIds) {
    const existing = await context.db.find(pieces, { dataSetId: setId, pieceId })
    if (!existing) continue

    await context.db.update(pieces, { dataSetId: setId, pieceId }).set({
      removed: true,
      removedAtBlock: event.block.number,
      ...block,
    })
  }
})

ponder.on('PDPVerifier:DataSetDeleted', async ({ event, context }) => {
  const { setId } = event.args
  const existing = await context.db.find(dataSets, { dataSetId: setId })
  if (!existing) return

  await context.db.update(dataSets, { dataSetId: setId }).set({
    deleted: true,
    ...eventBlock(event),
  })
})
