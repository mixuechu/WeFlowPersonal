import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRendererPageIncident,
  normalizeRendererPageIncident,
  rendererPageKind
} from '../shared/rendererPageIncident.ts'

test('renderer page incidents retain only category, class and irreversible digest', async () => {
  const secret = 'wxid_private sk-secret /Users/private/chat.txt'
  const payload = await buildRendererPageIncident(
    '/ai-assistant',
    new TypeError(secret),
    `at SecretCard (${secret})`
  )
  assert.deepEqual({ pageKind: payload.pageKind, errorClass: payload.errorClass }, {
    pageKind: 'ai_assistant',
    errorClass: 'TypeError'
  })
  assert.match(payload.fingerprint, /^[a-f0-9]{24}$/)
  assert.doesNotMatch(JSON.stringify(payload), /wxid_private|sk-secret|Users|chat\.txt/)
  assert.deepEqual(normalizeRendererPageIncident(payload), payload)
})

test('chunk failures and routes are reduced to fixed public categories', async () => {
  const payload = await buildRendererPageIncident(
    '/resources/private-id',
    new TypeError('Failed to fetch dynamically imported module: file:///private/chunk.js'),
    ''
  )
  assert.equal(payload.pageKind, 'resources')
  assert.equal(payload.errorClass, 'ChunkLoadError')
  assert.equal(rendererPageKind('/unknown/private-value'), 'other')
})

test('main-process normalization rejects invented categories and malformed digests', () => {
  assert.equal(normalizeRendererPageIncident({
    version: 'renderer-page-incident-v1',
    pageKind: 'private-chat-name',
    errorClass: 'TypeError',
    fingerprint: 'a'.repeat(24)
  }), null)
  assert.equal(normalizeRendererPageIncident({
    version: 'renderer-page-incident-v1',
    pageKind: 'chat',
    errorClass: 'SecretError',
    fingerprint: 'a'.repeat(24)
  }), null)
  assert.equal(normalizeRendererPageIncident({
    version: 'renderer-page-incident-v1',
    pageKind: 'chat',
    errorClass: 'TypeError',
    fingerprint: '../unsafe'
  }), null)
})
