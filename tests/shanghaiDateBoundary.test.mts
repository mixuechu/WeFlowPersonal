import assert from 'node:assert/strict'
import test from 'node:test'
import { parseShanghaiDateBoundary } from '../shared/shanghaiDateBoundary.ts'

test('Shanghai date boundaries cover the complete natural day', () => {
  const from = parseShanghaiDateBoundary('2026-08-12')
  const to = parseShanghaiDateBoundary('2026-08-12', true)
  assert.equal(from.state, 'valid')
  assert.equal(from.milliseconds, Date.parse('2026-08-12T00:00:00.000+08:00'))
  assert.equal(to.milliseconds, Date.parse('2026-08-12T23:59:59.999+08:00'))
  assert.equal(Number(to.milliseconds) - Number(from.milliseconds), 86_399_999)
})

test('Shanghai date boundaries reject calendar rollover and malformed input', () => {
  for (const value of [
    '2026-02-30', '2025-02-29', '2026-13-01', 'not-a-date',
    '2026-08-12T18:30:00.000', '2026-08-12 18:30:00'
  ]) {
    assert.equal(parseShanghaiDateBoundary(value).state, 'invalid')
  }
  assert.equal(parseShanghaiDateBoundary('2024-02-29').state, 'valid')
  assert.equal(parseShanghaiDateBoundary('').state, 'empty')
})

test('explicit ISO instants preserve their exact instant after date validation', () => {
  const boundary = parseShanghaiDateBoundary('2026-08-12T18:30:00.000Z')
  assert.equal(boundary.state, 'valid')
  assert.equal(boundary.iso, '2026-08-12T18:30:00.000Z')
})
