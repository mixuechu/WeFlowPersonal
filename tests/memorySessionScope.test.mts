import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMemorySessionScope } from '../src/utils/memorySessionScope.ts'

test('unique session names still bind retrieval to the durable id', () => {
  assert.deepEqual(buildMemorySessionScope({
    sessionId: 'wxid-unique',
    displayName: '唯一联系人',
    displayNameCollisionCount: 1,
    legacyNameFallbackSafe: true,
    selectionToken: 'session-selection-1'
  }), {
    sessionId: 'wxid-unique',
    sessionName: undefined,
    sessionSelectionToken: 'session-selection-1',
    precision: 'id_only'
  })
})

test('same-name sessions bind retrieval to the selected id only', () => {
  assert.deepEqual(buildMemorySessionScope({
    sessionId: 'room-a@chatroom',
    displayName: '项目讨论',
    displayNameCollisionCount: 2,
    legacyNameFallbackSafe: false
  }), {
    sessionId: 'room-a@chatroom',
    sessionName: undefined,
    sessionSelectionToken: undefined,
    precision: 'id_only_due_to_name_collision'
  })
})

test('empty and inconsistent selections cannot create a name-only scope', () => {
  assert.deepEqual(buildMemorySessionScope({
    displayName: '项目讨论',
    displayNameCollisionCount: 1,
    legacyNameFallbackSafe: true
  }), { precision: 'none' })
  assert.equal(buildMemorySessionScope({
    sessionId: 'room-a@chatroom',
    displayName: '项目讨论',
    displayNameCollisionCount: 2,
    legacyNameFallbackSafe: true
  }).sessionName, undefined)
})
