import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  BoundedResponseError,
  LEGACY_MODEL_RESPONSE_MAX_BYTES,
  readBoundedIncomingMessage
} from '../electron/services/boundedNodeResponse.ts'

class MockIncomingMessage extends EventEmitter {
  headers: Record<string, string> = {}
  destroyedWith: Error | undefined

  destroy(error?: Error): this {
    this.destroyedWith = error
    return this
  }
}

test('bounded Node response collects a model body below the limit', async () => {
  const response = new MockIncomingMessage()
  const reading = readBoundedIncomingMessage(response as any, 32)
  response.emit('data', Buffer.from('{"ok":'))
  response.emit('data', Buffer.from('true}'))
  response.emit('end')
  assert.equal(await reading, '{"ok":true}')
  assert.equal(response.destroyedWith, undefined)
  assert.equal(LEGACY_MODEL_RESPONSE_MAX_BYTES, 8 * 1024 * 1024)
})

test('bounded Node response rejects declared oversized bodies before listeners consume data', async () => {
  const response = new MockIncomingMessage()
  response.headers['content-length'] = '4096'
  await assert.rejects(
    readBoundedIncomingMessage(response as any, 64),
    (error: unknown) => error instanceof BoundedResponseError && error.maxBytes === 64
  )
})

test('bounded Node response destroys unknown-length streams when accumulated bytes exceed the limit', async () => {
  const response = new MockIncomingMessage()
  const reading = readBoundedIncomingMessage(response as any, 8)
  response.emit('data', Buffer.from('1234'))
  response.emit('data', Buffer.from('56789'))
  await assert.rejects(
    reading,
    (error: unknown) => error instanceof BoundedResponseError && error.code === 'response_too_large'
  )
  assert.ok(response.destroyedWith instanceof BoundedResponseError)
})

test('bounded Node response rejects an aborted body instead of returning partial JSON', async () => {
  const response = new MockIncomingMessage()
  const reading = readBoundedIncomingMessage(response as any, 64)
  response.emit('data', Buffer.from('{"partial":'))
  response.emit('aborted')
  await assert.rejects(reading, /response_aborted/)
})
