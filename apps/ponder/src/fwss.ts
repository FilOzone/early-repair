import { ponder } from 'ponder:registry'
import { dataSets, pieces } from 'ponder:schema'
import { decodePiece } from './cid-utils.ts'
import { eventBlock, metadataFromEntries } from './event-utils.ts'

ponder.on('FWSS:DataSetCreated', async ({ event, context }) => {
  const { dataSetId, providerId, metadataKeys, metadataValues } = event.args as {
    dataSetId: bigint
    providerId: bigint
    metadataKeys?: readonly string[]
    metadataValues?: readonly string[]
  }

  const metadata = metadataFromEntries(metadataKeys, metadataValues)
  const block = eventBlock(event)

  await context.db
    .insert(dataSets)
    .values({
      dataSetId,
      providerId,
      metadata,
      pdpEndEpoch: 0n,
      deleted: false,
      createdAtBlock: event.block.number,
      ...block,
    })
    .onConflictDoUpdate({
      providerId,
      metadata,
      deleted: false,
      ...block,
    })
})

ponder.on('FWSS:PieceAdded', async ({ event, context }) => {
  const {
    dataSetId,
    pieceId,
    pieceCid: pieceCidRaw,
    keys,
    values,
  } = event.args as {
    dataSetId: bigint
    pieceId: bigint
    pieceCid: { data: `0x${string}` }
    keys?: readonly string[]
    values?: readonly string[]
  }

  const decoded = decodePiece(pieceCidRaw)
  const metadata = metadataFromEntries(keys, values)
  const block = eventBlock(event)

  await context.db
    .insert(pieces)
    .values({
      dataSetId,
      pieceId,
      cid: decoded.cid,
      rawSize: decoded.rawSize,
      metadata,
      removed: false,
      addedAtBlock: event.block.number,
      removedAtBlock: null,
      ...block,
    })
    .onConflictDoUpdate({
      cid: decoded.cid,
      rawSize: decoded.rawSize,
      metadata,
      removed: false,
      removedAtBlock: null,
      ...block,
    })
})

ponder.on('FWSS:PDPPaymentTerminated', async ({ event, context }) => {
  const { dataSetId, endEpoch } = event.args as { dataSetId: bigint; endEpoch: bigint }
  const existing = await context.db.find(dataSets, { dataSetId })
  if (!existing) return

  await context.db.update(dataSets, { dataSetId }).set({
    pdpEndEpoch: endEpoch,
    ...eventBlock(event),
  })
})
