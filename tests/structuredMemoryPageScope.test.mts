import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildClaimPageScopeToken,
  buildEntityEvidencePageScopeToken,
  buildEventPageScopeToken,
  buildIdentityAnchorPageScopeToken,
  buildRelationPageScopeToken
} from '../electron/services/structuredMemoryPageScope.ts'

test('structured-memory tokens bind each complete effective range', () => {
  const cases: Array<[any, Record<string, unknown>, Record<string, unknown>]> = [
    [buildClaimPageScopeToken,
      { entityId: 'e1', sourceId: 'wechat', status: 'confirmed', reasonCode: 'x', predicate: '公司', from: 'a', to: 'b' },
      { predicate: '职位' }],
    [buildEventPageScopeToken,
      { entityId: 'e1', eventTypes: ['meeting', 'decision'], sourceId: 'mail', status: 'candidate', reasonCode: 'x', query: '发布', from: 'a', to: 'b' },
      { eventTypes: ['delivery'] }],
    [buildRelationPageScopeToken,
      { entityId: 'e1', direction: 'incoming', status: 'confirmed', sourceId: 'wechat', query: '同事' },
      { direction: 'outgoing' }],
    [buildIdentityAnchorPageScopeToken,
      { entityId: 'e1', kind: 'identity', identityScope: 'wechat', platform: '微信', query: 'wxid' },
      { identityScope: 'external' }],
    [buildEntityEvidencePageScopeToken,
      { entityId: 'e1', sourceId: 'wechat', memoryKind: 'claim', evidenceState: 'current', evidenceRole: 'direct', query: '证据', from: 'a', to: 'b' },
      { evidenceRole: 'contradiction' }]
  ]
  for (const [builder, base, change] of cases) {
    const first = builder(base)
    assert.notEqual(first, builder({ ...base, ...change }))
    assert.equal(first, builder({ ...base, offset: 999, limit: 1 }))
  }
})

test('event type order and duplicate values do not change range identity', () => {
  assert.equal(
    buildEventPageScopeToken({ eventTypes: ['meeting', 'decision', 'meeting'] }),
    buildEventPageScopeToken({ eventTypes: ['decision', 'meeting'] })
  )
})
