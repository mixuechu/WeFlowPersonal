import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertResourceEnrichmentBatchToken,
  buildResourceEnrichmentBatchToken,
  RESOURCE_ENRICHMENT_BATCH_LIMIT
} from '../electron/services/resourceEnrichmentBatchPolicy.ts'

const identity = {
  revision: '18',
  kind: 'image_ocr',
  status: 'deferred',
  filters: { resourceType: 'image', sourceId: 'wechat', query: '合同', from: '', to: '' },
  items: [
    { id: 'resource-a', retryToken: 'a'.repeat(64) },
    { id: 'resource-b', retryToken: 'b'.repeat(64) }
  ]
}

test('resource enrichment batch token binds revision, filters, order and item state', () => {
  const token = buildResourceEnrichmentBatchToken(identity)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.doesNotThrow(() => assertResourceEnrichmentBatchToken(identity, token))
  for (const changed of [
    { ...identity, revision: '19' },
    { ...identity, status: 'pending' },
    { ...identity, filters: { ...identity.filters, query: '报价' } },
    { ...identity, items: [...identity.items].reverse() },
    { ...identity, items: [{ ...identity.items[0], retryToken: 'c'.repeat(64) }] }
  ]) {
    assert.throws(() => assertResourceEnrichmentBatchToken(changed, token), /预览已过期/)
  }
})

test('resource enrichment batch identity is bounded to the execution limit', () => {
  const items = Array.from({ length: RESOURCE_ENRICHMENT_BATCH_LIMIT + 5 }, (_, index) => ({
    id: `resource-${index}`,
    retryToken: String(index).padStart(64, '0').slice(-64)
  }))
  const longToken = buildResourceEnrichmentBatchToken({ ...identity, items })
  const boundedToken = buildResourceEnrichmentBatchToken({
    ...identity,
    items: items.slice(0, RESOURCE_ENRICHMENT_BATCH_LIMIT)
  })
  assert.equal(longToken, boundedToken)
})
