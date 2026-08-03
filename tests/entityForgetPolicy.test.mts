import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertEntityForgetConfirmation,
  buildEntityForgetPreviewToken
} from '../electron/services/entityForgetPolicy.ts'

const preview = {
  entityId: 'person-1',
  canonicalName: '隐私测试人',
  names: ['测试人', '隐私测试人'],
  claimIds: ['claim-2', 'claim-1'],
  relationIds: ['relation-1'],
  eventIds: ['event-1'],
  taskIds: ['task-1']
}

test('entity forget preview token is stable across harmless collection order changes', () => {
  assert.equal(buildEntityForgetPreviewToken(preview), buildEntityForgetPreviewToken({
    ...preview,
    names: [...preview.names].reverse(),
    claimIds: [...preview.claimIds].reverse()
  }))
})

test('entity forget requires the exact visible name and the current preview token', () => {
  const previewToken = buildEntityForgetPreviewToken(preview)
  assert.doesNotThrow(() => assertEntityForgetConfirmation(preview, {
    previewToken,
    confirmation: preview.canonicalName
  }))
  assert.throws(() => assertEntityForgetConfirmation(preview, {
    previewToken,
    confirmation: '测试人'
  }), /请输入人物名称/)
  assert.throws(() => assertEntityForgetConfirmation(preview, {
    previewToken: '',
    confirmation: preview.canonicalName
  }), /重新核对删除范围/)
})

test('entity forget rejects a stale preview when any related durable identity changes', () => {
  const previewToken = buildEntityForgetPreviewToken(preview)
  for (const changed of [
    { ...preview, canonicalName: '隐私测试人（新）' },
    { ...preview, claimIds: [...preview.claimIds, 'claim-3'] },
    { ...preview, relationIds: [...preview.relationIds, 'relation-2'] },
    { ...preview, eventIds: [...preview.eventIds, 'event-2'] },
    { ...preview, taskIds: [...preview.taskIds, 'task-2'] }
  ]) {
    assert.throws(() => assertEntityForgetConfirmation(changed, {
      previewToken,
      confirmation: changed.canonicalName
    }), /重新核对删除范围/)
  }
})
