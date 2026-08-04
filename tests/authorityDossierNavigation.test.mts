import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorityReturnLabel,
  buildAuthorityReturnTarget
} from '../src/utils/authorityDossierNavigation.ts'

test('authority dossier return targets retain only stable identity and revision', () => {
  assert.deepEqual(buildAuthorityReturnTarget({
    status: 'ready',
    kind: 'relation',
    sourceId: 'relation-stable-id',
    revision: 'search-revision-8',
    document: { title: '同名关系标题' },
    item: { subject_name: '可能重名的人' }
  }), {
    kind: 'relation',
    sourceId: 'relation-stable-id',
    searchRevision: 'search-revision-8'
  })
  assert.equal(authorityReturnLabel({
    kind: 'claim',
    sourceId: 'claim-1',
    searchRevision: '10'
  }), '返回事实档案')
  assert.equal(authorityReturnLabel({
    kind: 'event',
    sourceId: 'event-1',
    searchRevision: '10'
  }), '返回事件档案')
  assert.equal(authorityReturnLabel(null), '完成')
})

test('authority dossier return targets reject loading, invalid types and missing revisions', () => {
  assert.equal(buildAuthorityReturnTarget({
    status: 'loading',
    kind: 'claim',
    sourceId: 'claim-1',
    revision: '1'
  }), null)
  assert.equal(buildAuthorityReturnTarget({
    status: 'ready',
    kind: 'entity',
    sourceId: 'entity-1',
    revision: '1'
  }), null)
  assert.equal(buildAuthorityReturnTarget({
    status: 'ready',
    kind: 'event',
    sourceId: 'event-1',
    revision: ''
  }), null)
})
