import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractBearerToken,
  isValidHttpApiToken,
  normalizeHttpApiBindHost,
  normalizeHttpApiPort
} from '../electron/services/httpApiSecurityPolicy.ts'

test('HTTP API accepts credentials only from a strict Bearer header', () => {
  assert.equal(extractBearerToken('Bearer 0123456789abcdef'), '0123456789abcdef')
  assert.equal(extractBearerToken('bearer\t0123456789abcdef'), '0123456789abcdef')
  assert.equal(extractBearerToken('Basic 0123456789abcdef'), '')
  assert.equal(extractBearerToken('Bearer'), '')
  assert.equal(extractBearerToken('Bearer token with spaces'), '')
  assert.equal(extractBearerToken(['Bearer 0123456789abcdef']), '')
})

test('HTTP API rejects missing, weak, oversized and multiline tokens', () => {
  assert.equal(isValidHttpApiToken('0123456789abcdef'), true)
  assert.equal(isValidHttpApiToken(' short-token '), false)
  assert.equal(isValidHttpApiToken('a'.repeat(513)), false)
  assert.equal(isValidHttpApiToken('0123456789abcdef\ninjected'), false)
})

test('HTTP API bind policy accepts explicit IPv4 interfaces but no hostnames', () => {
  assert.equal(normalizeHttpApiBindHost('localhost'), '127.0.0.1')
  assert.equal(normalizeHttpApiBindHost('127.0.0.1'), '127.0.0.1')
  assert.equal(normalizeHttpApiBindHost('0.0.0.0'), '0.0.0.0')
  assert.equal(normalizeHttpApiBindHost('192.168.1.8'), '192.168.1.8')
  assert.equal(normalizeHttpApiBindHost('example.test'), null)
  assert.equal(normalizeHttpApiBindHost('::1'), null)
})

test('HTTP API port policy accepts only non-privileged integer ports', () => {
  assert.equal(normalizeHttpApiPort(5031), 5031)
  assert.equal(normalizeHttpApiPort('65535'), 65535)
  assert.equal(normalizeHttpApiPort(80), null)
  assert.equal(normalizeHttpApiPort(65536), null)
  assert.equal(normalizeHttpApiPort(5031.5), null)
})
