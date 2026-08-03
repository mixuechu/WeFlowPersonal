import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertStructuredMemoryDeletionConfirmation,
  buildStructuredMemoryDeletionPreviewToken,
  structuredMemoryDeletionConfirmation
} from '../electron/services/structuredMemoryDeletionPolicy.ts'

test('structured memory deletion binds permanent and not-important actions independently', () => {
  const permanent = {
    kind: 'claim' as const,
    id: 'claim-1',
    reason: 'manual_delete' as const,
    identitySha256: 'a'.repeat(64)
  }
  const previewToken = buildStructuredMemoryDeletionPreviewToken(permanent)
  assert.equal(structuredMemoryDeletionConfirmation('manual_delete'), '永久删除')
  assert.doesNotThrow(() => assertStructuredMemoryDeletionConfirmation(permanent, {
    previewToken,
    confirmation: '永久删除'
  }))
  assert.throws(() => assertStructuredMemoryDeletionConfirmation({
    ...permanent,
    reason: 'not_important'
  }, {
    previewToken,
    confirmation: '标记不重要'
  }), /重新核对/)
})

test('structured memory deletion rejects related-range drift and wrong confirmation', () => {
  const preview = {
    kind: 'event' as const,
    id: 'event-1',
    reason: 'not_important' as const,
    identitySha256: 'a'.repeat(64)
  }
  const previewToken = buildStructuredMemoryDeletionPreviewToken(preview)
  assert.throws(() => assertStructuredMemoryDeletionConfirmation({
    ...preview,
    identitySha256: 'b'.repeat(64)
  }, {
    previewToken,
    confirmation: '标记不重要'
  }), /重新核对/)
  assert.throws(() => assertStructuredMemoryDeletionConfirmation(preview, {
    previewToken,
    confirmation: '永久删除'
  }), /请输入“标记不重要”/)
})
