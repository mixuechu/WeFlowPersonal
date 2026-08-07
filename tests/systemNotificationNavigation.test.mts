import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSystemNotificationActionPayload } from '../electron/services/systemNotificationNavigationPolicy.ts'

test('AI assistant notifications preserve their application route on click', () => {
  assert.deepEqual(buildSystemNotificationActionPayload({
    channel: 'ai-assistant',
    targetRoute: '/ai-assistant'
  }), {
    sessionId: undefined,
    channel: 'ai-assistant',
    insightRecordId: undefined,
    targetRoute: '/ai-assistant'
  })
})

test('chat notifications keep the legacy scalar session payload', () => {
  assert.equal(buildSystemNotificationActionPayload({
    sessionId: 'session-1'
  }), 'session-1')
})

test('notifications without a navigation target do not emit an empty action', () => {
  assert.equal(buildSystemNotificationActionPayload({}), null)
})
