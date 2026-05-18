import assert from 'node:assert/strict'
import { test } from 'node:test'
import { metadataFromEntries, metadataHasEmptyFlag } from '../src/event-utils.ts'

test('metadataFromEntries maps missing values to empty strings', () => {
  assert.deepEqual(metadataFromEntries(['withCDN', 'name'], ['']), {
    withCDN: '',
    name: '',
  })
})

test('metadataHasEmptyFlag only matches present empty-string flags', () => {
  assert.equal(metadataHasEmptyFlag({ withCDN: '' }, 'withCDN'), true)
  assert.equal(metadataHasEmptyFlag({ withCDN: 'true' }, 'withCDN'), false)
  assert.equal(metadataHasEmptyFlag({ withIPFSIndexing: '' }, 'withCDN'), false)
  assert.equal(metadataHasEmptyFlag(null, 'withCDN'), false)
})
