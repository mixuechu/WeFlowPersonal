import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactReviewSourceId,
  reviewSourceKindLabel,
  trustedEntityTypeLabel
} from '../src/utils/reviewSourcePresentation.ts'

test('review source labels distinguish project navigation from entity dossiers', () => {
  assert.equal(reviewSourceKindLabel('project'), '项目')
  assert.equal(reviewSourceKindLabel('entity'), '实体档案')
})

test('review source ids stay recognizable without allowing unbounded UI text', () => {
  assert.equal(compactReviewSourceId(' stable-id '), 'stable-id')
  assert.equal(
    compactReviewSourceId('1234567890abcdefghijklmnopqrstuv9876543210'),
    '1234567890…9876543210'
  )
})

test('trusted entity source types use user-facing labels', () => {
  assert.equal(trustedEntityTypeLabel('person'), '人物')
  assert.equal(trustedEntityTypeLabel('organization'), '组织')
  assert.equal(trustedEntityTypeLabel('group'), '群聊')
  assert.equal(trustedEntityTypeLabel('unrecognized'), '实体')
})
