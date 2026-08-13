import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearLegacyBackgroundFailure,
  emptyLegacyBackgroundRetries,
  legacyBackgroundRetryDelayMs,
  normalizeLegacyBackgroundRetries,
  planLegacyBackgroundFailure
} from '../electron/services/legacyBackgroundRetryPolicy.ts'
import {
  configureLegacyBackgroundRetries,
  getLegacyBackgroundRetries,
  getLegacyBackgroundRetryDelayMs,
  recordPersistentLegacyBackgroundFailure,
  recordPersistentLegacyBackgroundSuccess,
  resetLegacyBackgroundRetryController
} from '../electron/services/legacyBackgroundRetryController.ts'

test.afterEach(() => resetLegacyBackgroundRetryController())

test('normalization uses a strict three-service schema and clamps unsafe values', () => {
  const value = normalizeLegacyBackgroundRetries({
    insight: {
      failures: -4,
      lastFailureAt: 'bad',
      lastError: 'x'.repeat(900),
      nextAttemptAt: '2026-08-13T08:00:00+08:00',
      privateMessages: ['must not survive']
    },
    unknownService: { failures: 99 }
  }) as any

  assert.deepEqual(Object.keys(value).sort(), ['groupSummary', 'insight', 'messagePush'])
  assert.equal(value.insight.failures, 0)
  assert.equal(value.insight.lastFailureAt, null)
  assert.equal(value.insight.nextAttemptAt, '2026-08-13T00:00:00.000Z')
  assert.equal(value.insight.lastError.length, 500)
  assert.equal(value.insight.privateMessages, undefined)
  assert.equal(value.unknownService, undefined)
})

test('failure backoff advances from five minutes and caps at six hours', () => {
  let retry = emptyLegacyBackgroundRetries().insight
  const start = new Date('2026-08-13T00:00:00.000Z')
  const expectedMinutes = [5, 15, 30, 60, 180, 360, 360]
  expectedMinutes.forEach((minutes, index) => {
    retry = planLegacyBackgroundFailure(retry, new Error('/Users/private/chat.db failed'), start)
    assert.equal(retry.failures, index + 1)
    assert.equal(legacyBackgroundRetryDelayMs(retry, start.getTime()), minutes * 60_000)
    assert.doesNotMatch(String(retry.lastError), /\/Users\/private/)
  })
})

test('success records recovery without inventing a recovery timestamp before failure', () => {
  const empty = emptyLegacyBackgroundRetries().messagePush
  assert.equal(clearLegacyBackgroundFailure(empty, new Date()).lastRecoveredAt, null)
  const failed = planLegacyBackgroundFailure(empty, 'offline', new Date('2026-08-13T00:00:00Z'))
  const recovered = clearLegacyBackgroundFailure(failed, new Date('2026-08-13T01:00:00Z'))
  assert.equal(recovered.failures, 0)
  assert.equal(recovered.nextAttemptAt, null)
  assert.equal(recovered.lastRecoveredAt, '2026-08-13T01:00:00.000Z')
})

test('controller publishes retry state only after durable persistence succeeds', () => {
  const durable = emptyLegacyBackgroundRetries()
  configureLegacyBackgroundRetries(durable, () => { throw new Error('disk full') })

  assert.throws(
    () => recordPersistentLegacyBackgroundFailure('groupSummary', 'failed', new Date('2026-08-13T00:00:00Z')),
    /disk full/
  )
  assert.deepEqual(getLegacyBackgroundRetries(), durable)
  assert.equal(getLegacyBackgroundRetryDelayMs('groupSummary'), 0)
})

test('controller restores persisted cooldown after restart and commits recovery', () => {
  let durable = emptyLegacyBackgroundRetries()
  configureLegacyBackgroundRetries(durable, next => { durable = structuredClone(next) })
  recordPersistentLegacyBackgroundFailure('messagePush', 'offline', new Date('2026-08-13T00:00:00Z'))
  assert.equal(durable.messagePush.failures, 1)

  resetLegacyBackgroundRetryController()
  configureLegacyBackgroundRetries(durable, next => { durable = structuredClone(next) })
  assert.equal(getLegacyBackgroundRetryDelayMs('messagePush', Date.parse('2026-08-13T00:01:00Z')), 4 * 60_000)

  recordPersistentLegacyBackgroundSuccess('messagePush', new Date('2026-08-13T00:06:00Z'))
  assert.equal(durable.messagePush.failures, 0)
  assert.equal(durable.messagePush.lastRecoveredAt, '2026-08-13T00:06:00.000Z')
})

test('service contracts gate operational work and initialize after encrypted state', async () => {
  const fs = await import('node:fs/promises')
  const [main, assistant, insight, summary, push] = await Promise.all([
    fs.readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/services/insightService.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/services/groupSummaryService.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/services/messagePushService.ts', import.meta.url), 'utf8')
  ])
  assert.ok(main.indexOf('await aiAssistantService.initialize()') < main.indexOf('messagePushService.start()'))
  assert.match(assistant, /legacyBackgroundRetries: normalizeLegacyBackgroundRetries/)
  assert.match(assistant, /configureLegacyBackgroundRetries\(/)
  assert.match(insight, /getLegacyBackgroundRetryDelayMs\('insight'\)/)
  assert.match(summary, /getLegacyBackgroundRetryDelayMs\('groupSummary'\)/)
  assert.match(push, /Math\.max\(this\.debounceMs, retryDelayMs\)/)
})
