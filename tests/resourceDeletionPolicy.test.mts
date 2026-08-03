import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertResourceDeletionConfirmation,
  buildResourceDeletionPreviewToken,
  resourceDeletionConfirmation
} from '../electron/services/resourceDeletionPolicy.ts'

test('resource deletion preview is action-bound and requires the visible confirmation', () => {
  const deletion = {
    action: 'delete' as const,
    resourceId: 'resource-1',
    identitySha256: 'a'.repeat(64)
  }
  const previewToken = buildResourceDeletionPreviewToken(deletion)
  assert.equal(resourceDeletionConfirmation('delete'), '移入回收站')
  assert.doesNotThrow(() => assertResourceDeletionConfirmation(deletion, {
    previewToken,
    confirmation: '移入回收站'
  }))
  assert.throws(() => assertResourceDeletionConfirmation(deletion, {
    previewToken,
    confirmation: '永久删除资源'
  }), /请输入“移入回收站”/)
  assert.throws(() => assertResourceDeletionConfirmation({
    ...deletion,
    action: 'purge'
  }, {
    previewToken,
    confirmation: '永久删除资源'
  }), /重新核对处理范围/)
})

test('resource deletion rejects content or evidence drift after preview', () => {
  const preview = {
    action: 'purge' as const,
    resourceId: 'resource-1',
    identitySha256: 'a'.repeat(64)
  }
  const previewToken = buildResourceDeletionPreviewToken(preview)
  assert.throws(() => assertResourceDeletionConfirmation({
    ...preview,
    identitySha256: 'b'.repeat(64)
  }, {
    previewToken,
    confirmation: '永久删除资源'
  }), /重新核对处理范围/)
})
