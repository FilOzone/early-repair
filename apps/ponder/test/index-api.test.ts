import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createIndexApi } from '../src/api/index-api.ts'

test('metadata endpoint returns the metadata field as the response body', async () => {
  const app = createIndexApi(async (dataSetId, pieceId) => {
    assert.equal(dataSetId, 123n)
    assert.equal(pieceId, 42n)
    return { name: 'example', type: 'application/octet-stream' }
  })

  const response = await app.request('/index/v0/datasets/123/pieces/42/metadata')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { name: 'example', type: 'application/octet-stream' })
})

test('metadata endpoint distinguishes absent metadata from an unknown piece', async () => {
  const withoutMetadata = createIndexApi(async () => null)
  const missingPiece = createIndexApi(async () => undefined)

  const withoutMetadataResponse = await withoutMetadata.request('/index/v0/datasets/123/pieces/42/metadata')
  const missingPieceResponse = await missingPiece.request('/index/v0/datasets/123/pieces/42/metadata')

  assert.equal(withoutMetadataResponse.status, 200)
  assert.equal(await withoutMetadataResponse.json(), null)
  assert.equal(missingPieceResponse.status, 404)
  assert.deepEqual(await missingPieceResponse.json(), { error: 'Piece not found' })
})

test('metadata endpoint rejects non-canonical unsigned IDs before querying', async () => {
  let queryCount = 0
  const app = createIndexApi(async () => {
    queryCount++
    return null
  })

  for (const path of [
    '/index/v0/datasets/-1/pieces/42/metadata',
    '/index/v0/datasets/01/pieces/42/metadata',
    '/index/v0/datasets/123/pieces/not-a-number/metadata',
    '/index/v0/datasets/9223372036854775808/pieces/42/metadata',
    `/index/v0/datasets/${'9'.repeat(1_000)}/pieces/42/metadata`,
  ]) {
    const response = await app.request(path)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'dataSetId and pieceId must be unsigned int8 values' })
  }

  assert.equal(queryCount, 0)
})

test('metadata endpoint does not disclose query errors', async () => {
  const app = createIndexApi(async () => {
    throw new Error('database connection string leaked')
  })
  const consoleError = console.error
  console.error = () => undefined

  try {
    const response = await app.request('/index/v0/datasets/123/pieces/42/metadata')

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'Internal server error' })
  } finally {
    console.error = consoleError
  }
})
