import { db } from 'ponder:api'
import { pieces } from 'ponder:schema'
import { and, eq } from 'ponder'
import { createIndexApi } from './index-api.ts'

const app = createIndexApi(async (dataSetId, pieceId) => {
  const [piece] = await db
    .select({ metadata: pieces.metadata })
    .from(pieces)
    .where(and(eq(pieces.dataSetId, dataSetId), eq(pieces.pieceId, pieceId)))
    .limit(1)

  return piece?.metadata
})

export default app
