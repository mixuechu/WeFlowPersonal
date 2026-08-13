import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolvePersonalUpdateAvailability
} from '../electron/services/personalUpdatePolicy.ts'

test('personal builds do not contact an inherited update repository by default', () => {
  assert.deepEqual(resolvePersonalUpdateAvailability({}), {
    enabled: false,
    feedBaseUrl: '',
    reason: '当前为本地固化版本，尚未配置受信任的更新源'
  })
})

test('personal update feeds require credential-free HTTPS', () => {
  assert.equal(resolvePersonalUpdateAvailability({
    feedBaseUrl: 'http://updates.example.com/releases'
  }).enabled, false)
  assert.equal(resolvePersonalUpdateAvailability({
    feedBaseUrl: 'https://token@example.com/releases'
  }).enabled, false)
})

test('a trusted personal release base enables channel-specific update checks', () => {
  assert.deepEqual(resolvePersonalUpdateAvailability({
    feedBaseUrl: 'https://github.com/mixuechu/WeFlowPersonal/releases/'
  }), {
    enabled: true,
    feedBaseUrl: 'https://github.com/mixuechu/WeFlowPersonal/releases',
    reason: ''
  })
})

test('development and explicit opt-out override a configured feed', () => {
  const feedBaseUrl = 'https://github.com/mixuechu/WeFlowPersonal/releases'
  assert.equal(resolvePersonalUpdateAvailability({
    feedBaseUrl,
    developmentServer: 'http://localhost:5173'
  }).enabled, false)
  assert.equal(resolvePersonalUpdateAvailability({
    feedBaseUrl,
    explicitEnabled: '0'
  }).enabled, false)
})
