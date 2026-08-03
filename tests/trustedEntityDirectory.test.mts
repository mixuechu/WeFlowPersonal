import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTrustedEntityDirectory } from '../electron/services/trustedEntityDirectory.ts'

const confirmedEntities = Array.from({ length: 5_005 }, (_, index) => ({
  id: `entity-${index}`,
  type: index % 4 === 0 ? 'organization' : 'person',
  canonicalName: `实体 ${String(index).padStart(5, '0')}`,
  aliases: [`别名-${index}`],
  accountIds: [`wxid-${index}`],
  externalIdentities: [{
    platform: 'email',
    accountId: `person-${index}@example.com`,
    displayName: `外部身份 ${index}`
  }],
  trustStatus: 'confirmed',
  updatedAt: `2026-08-04T00:${String(index % 60).padStart(2, '0')}:00.000Z`
}))

test('trusted entity directory paginates thousands of entities without dashboard payload', () => {
  const first = buildTrustedEntityDirectory(confirmedEntities, { limit: 100 })
  assert.equal(first.total, 5_005)
  assert.equal(first.items.length, 100)
  assert.equal(first.hasMore, true)
  const last = buildTrustedEntityDirectory(confirmedEntities, {
    offset: 5_000,
    limit: 100,
    expectedRevision: first.revision
  })
  assert.equal(last.items.length, 5)
  assert.equal(last.hasMore, false)
})

test('entity search finds canonical names, aliases, accounts and external identities', () => {
  for (const query of ['实体 00123', '别名-123', 'wxid-123', 'person-123@example.com', '外部身份 123']) {
    const result = buildTrustedEntityDirectory(confirmedEntities, { query })
    assert.ok(result.total >= 1, query)
    assert.equal(result.items[0].id, 'entity-123', query)
  }
})

test('candidate and rejected entities never enter trusted retrieval scope', () => {
  const result = buildTrustedEntityDirectory([
    confirmedEntities[0],
    { id: 'candidate', canonicalName: '候选人物', type: 'person', trustStatus: 'candidate' },
    { id: 'rejected', canonicalName: '已拒绝人物', type: 'person', trustStatus: 'rejected' },
    { id: 'legacy', canonicalName: '历史未确认', type: 'person', trustStatus: 'legacy_unverified' }
  ])
  assert.deepEqual(result.items.map(item => item.id), ['entity-0'])
  assert.equal(result.counts.all, 1)
})

test('same-name trusted entities remain distinct and expose collision counts', () => {
  const result = buildTrustedEntityDirectory([
    { ...confirmedEntities[0], id: 'same-a', canonicalName: '王伟', type: 'person' },
    { ...confirmedEntities[1], id: 'same-b', canonicalName: ' 王伟 ', type: 'person' },
    { ...confirmedEntities[2], id: 'same-org', canonicalName: '王伟', type: 'organization' }
  ], { query: '王伟' })
  assert.equal(result.total, 3)
  assert.deepEqual(new Set(result.items.map(item => item.id)), new Set(['same-a', 'same-b', 'same-org']))
  assert.ok(result.items.every(item => item.canonicalNameCollisionCount === 3))
})

test('entity directory rejects stale follow-up pages after identity changes', () => {
  const first = buildTrustedEntityDirectory(confirmedEntities.slice(0, 10), { limit: 5 })
  const changed = buildTrustedEntityDirectory([
    ...confirmedEntities.slice(0, 10),
    { ...confirmedEntities[10], canonicalName: '新增可信实体' }
  ], {
    offset: 5,
    limit: 5,
    expectedRevision: first.revision
  })
  assert.equal(changed.stale, true)
  assert.deepEqual(changed.items, [])
})
