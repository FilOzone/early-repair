import { Hono } from 'hono'

export type FindPieceMetadata = (
  dataSetId: bigint,
  pieceId: bigint
) => Promise<Record<string, string> | null | undefined>

const unsignedInt8 = /^(0|[1-9]\d{0,18})$/
const maxPostgresBigint = (1n << 63n) - 1n

function parseId(value: string): bigint | undefined {
  if (!unsignedInt8.test(value)) return undefined

  const id = BigInt(value)
  return id <= maxPostgresBigint ? id : undefined
}

export function createIndexApi(findPieceMetadata: FindPieceMetadata) {
  const app = new Hono()

  app.onError((error, c) => {
    console.error('Failed to serve piece metadata', error)
    return c.json({ error: 'Internal server error' }, 500)
  })

  app.get('/index/v0/datasets/:dataSetId/pieces/:pieceId/metadata', async (c) => {
    const dataSetId = parseId(c.req.param('dataSetId'))
    const pieceId = parseId(c.req.param('pieceId'))

    if (dataSetId === undefined || pieceId === undefined) {
      return c.json({ error: 'dataSetId and pieceId must be unsigned int8 values' }, 400)
    }

    const metadata = await findPieceMetadata(dataSetId, pieceId)
    if (metadata === undefined) {
      return c.json({ error: 'Piece not found' }, 404)
    }

    return c.json(metadata)
  })

  return app
}
