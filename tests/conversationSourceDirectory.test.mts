import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertConversationSourceMutation,
  buildConversationSourceDirectory,
  resolveConversationSourceSelection
} from '../electron/services/conversationSourceDirectory.ts'

const sessions = Array.from({ length: 10_005 }, (_, index) => ({
  username: index % 2 === 0 ? `group-${index}@chatroom` : `person-${index}`,
  displayName: index % 2 === 0 ? `项目群 ${index}` : `联系人 ${index}`,
  lastTimestamp: 20_000 - index
}))

test('conversation source directory covers ten thousand sessions with stable server pagination', () => {
  const first = buildConversationSourceDirectory(sessions, [], { type: 'group', limit: 100 })
  assert.equal(first.counts.total, 10_005)
  assert.equal(first.total, 5_003)
  assert.equal(first.items.length, 100)
  assert.equal(first.hasMore, true)

  const last = buildConversationSourceDirectory(sessions, [], {
    type: 'group',
    offset: 5_000,
    limit: 100,
    expectedRevision: first.revision
  })
  assert.equal(last.items.length, 3)
  assert.equal(last.hasMore, false)
  assert.equal(new Set([...first.items, ...last.items].map(item => item.sessionId)).size, 103)
})

test('conversation source directory filters names, ids, type and current enabled state', () => {
  const result = buildConversationSourceDirectory(sessions.slice(0, 20), [{
    sessionId: 'group-8@chatroom',
    displayName: '旧名称',
    sessionType: 'group',
    enabled: false,
    updatedAt: '2026-08-04T00:00:00.000Z'
  }], {
    query: '项目群 8',
    type: 'group',
    enabled: 'disabled'
  })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].sessionId, 'group-8@chatroom')
  assert.equal(result.items[0].enabled, false)
})

test('official accounts are excluded and duplicate session ids cannot inflate bulk scope', () => {
  const result = buildConversationSourceDirectory([
    { username: 'gh_public', displayName: '公众号', lastTimestamp: 9 },
    { username: 'same', displayName: '新名称', lastTimestamp: 8 },
    { username: 'same', displayName: '旧名称', lastTimestamp: 7 }
  ], [])
  assert.equal(result.counts.total, 1)
  assert.equal(result.items[0].displayName, '新名称')
})

test('same display names are marked unsafe for legacy name fallback without merging ids', () => {
  const result = buildConversationSourceDirectory([
    { username: 'first@chatroom', displayName: '项目讨论', lastTimestamp: 9 },
    { username: 'second@chatroom', displayName: ' 项目讨论 ', lastTimestamp: 8 },
    { username: 'unique', displayName: '唯一联系人', lastTimestamp: 7 }
  ], [], { query: '项目讨论' })
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map(item => item.sessionId), [
    'first@chatroom',
    'second@chatroom'
  ])
  assert.ok(result.items.every(item =>
    item.displayNameCollisionCount === 2 && item.legacyNameFallbackSafe === false
  ))
  const unique = buildConversationSourceDirectory([
    { username: 'unique', displayName: '唯一联系人', lastTimestamp: 7 }
  ], []).items[0]
  assert.equal(unique.displayNameCollisionCount, 1)
  assert.equal(unique.legacyNameFallbackSafe, true)
})

test('pagination revision and item mutation token reject stale directory state', () => {
  const first = buildConversationSourceDirectory(sessions.slice(0, 4), [], { limit: 2 })
  const changed = buildConversationSourceDirectory(sessions.slice(0, 4), [{
    sessionId: first.items[0].sessionId,
    displayName: first.items[0].displayName,
    sessionType: first.items[0].type,
    enabled: false,
    updatedAt: '2026-08-04T01:00:00.000Z'
  }], {
    offset: 2,
    limit: 2,
    expectedRevision: first.revision
  })
  assert.equal(changed.stale, true)
  assert.deepEqual(changed.items, [])

  assert.throws(
    () => assertConversationSourceMutation(
      buildConversationSourceDirectory(sessions.slice(0, 4), [], { limit: 2 }).items[0],
      'stale-token'
    ),
    /目录已经变化/
  )
})

test('conversation scope selection binds one durable id and rejects renamed or policy-changed state', () => {
  const initial = buildConversationSourceDirectory([
    { username: 'same-name-a', displayName: '同名联系人', lastTimestamp: 9 },
    { username: 'same-name-b', displayName: '同名联系人', lastTimestamp: 8 }
  ], [])
  const selected = initial.items.find(item => item.sessionId === 'same-name-a')!
  assert.equal(resolveConversationSourceSelection(initial.items, {
    sessionId: 'same-name-a',
    expectedSelectionToken: selected.selectionToken
  }).item?.sessionId, 'same-name-a')
  assert.equal(resolveConversationSourceSelection(initial.items, {
    sessionId: 'same-name-b',
    expectedSelectionToken: selected.selectionToken
  }).reason, 'selection_changed')

  const renamed = buildConversationSourceDirectory([
    { username: 'same-name-a', displayName: '新名称', lastTimestamp: 10 }
  ], [])
  assert.equal(resolveConversationSourceSelection(renamed.items, {
    sessionId: 'same-name-a',
    expectedSelectionToken: selected.selectionToken
  }).reason, 'selection_changed')

  const newMessageOnly = buildConversationSourceDirectory([
    { username: 'same-name-a', displayName: '同名联系人', lastTimestamp: 99 }
  ], [])
  assert.equal(resolveConversationSourceSelection(newMessageOnly.items, {
    sessionId: 'same-name-a',
    expectedSelectionToken: selected.selectionToken
  }).stale, false)
})
