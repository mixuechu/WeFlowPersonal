import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatAvatarCacheConsoleEvent,
  formatNotificationRendererLoad,
  formatSystemNotificationNavigation,
  formatSystemNotificationShown
} from '../electron/services/runtimeConsolePrivacy.ts'

test('avatar cache console events never contain URL, path or cache identity', () => {
  assert.equal(formatAvatarCacheConsoleEvent('downloaded'), '[AvatarFileCache] Cached one avatar')
  assert.equal(formatAvatarCacheConsoleEvent('evicted'), '[AvatarFileCache] Evicted one cached avatar')
  assert.equal(formatAvatarCacheConsoleEvent('cleared'), '[AvatarFileCache] Cache cleared')
})

test('system notification success logs only a bounded process-local id', () => {
  assert.equal(formatSystemNotificationShown(42), '[SystemNotification] Shown notification 42')
  assert.equal(formatSystemNotificationShown('联系人甲'), '[SystemNotification] Shown notification 0')
})

test('notification navigation logs classify targets without serializing them', () => {
  const sessionSecret = 'wxid_customer_secret'
  const structuredSecret = {
    sessionId: sessionSecret,
    targetRoute: '/ai-assistant?person=Customer-Zeta',
    insightRecordId: 'private-record-id'
  }
  const sessionMessage = formatSystemNotificationNavigation(sessionSecret)
  const structuredMessage = formatSystemNotificationNavigation(structuredSecret)

  assert.equal(sessionMessage, '[NotificationWindow] System notification clicked (session target)')
  assert.equal(structuredMessage, '[NotificationWindow] System notification clicked (structured target)')
  assert.doesNotMatch(`${sessionMessage} ${structuredMessage}`, /wxid|Customer-Zeta|private-record/i)
})

test('notification renderer load logs do not include a file or development URL', () => {
  assert.equal(formatNotificationRendererLoad(false), '[NotificationWindow] Loading packaged renderer')
  assert.equal(formatNotificationRendererLoad(true), '[NotificationWindow] Loading development renderer')
})
