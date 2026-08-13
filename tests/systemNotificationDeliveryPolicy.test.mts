import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  showAndConfirmSystemNotification
} from '../electron/services/systemNotificationDeliveryPolicy.ts'

class FakeNotification extends EventEmitter {
  closed = false
  showAction: () => void = () => this.emit('show')

  show() {
    this.showAction()
  }

  close() {
    this.closed = true
  }
}

test('notification delivery is confirmed only by the real show event', async () => {
  const notification = new FakeNotification()
  const result = await showAndConfirmSystemNotification(notification, 100)
  assert.deepEqual(result, { shown: true })
  assert.equal(notification.closed, false)
})

test('an asynchronous failed event keeps notification delivery unconfirmed', async () => {
  const notification = new FakeNotification()
  notification.showAction = () => {
    queueMicrotask(() => notification.emit('failed', {}, new Error('permission denied')))
  }
  const result = await showAndConfirmSystemNotification(notification, 100)
  assert.equal(result.shown, false)
  assert.match(String(result.error), /permission denied/)
})

test('a missing show acknowledgement is closed and remains unconfirmed', async () => {
  const notification = new FakeNotification()
  notification.showAction = () => {}
  const result = await showAndConfirmSystemNotification(notification, 100)
  assert.equal(result.shown, false)
  assert.equal(notification.closed, true)
  assert.match(String(result.error), /未在确认时间内显示/)
})

test('a synchronous show exception remains an explicit failed delivery', async () => {
  const notification = new FakeNotification()
  notification.showAction = () => {
    throw new Error('native failure')
  }
  const result = await showAndConfirmSystemNotification(notification, 100)
  assert.equal(result.shown, false)
  assert.match(String(result.error), /native failure/)
})
