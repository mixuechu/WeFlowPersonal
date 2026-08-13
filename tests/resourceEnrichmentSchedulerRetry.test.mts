import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY,
  normalizeResourceEnrichmentSchedulerRetry,
  planResourceEnrichmentDiscoveryFailure,
  resourceEnrichmentDiscoveryCoolingDown
} from '../electron/services/resourceEnrichmentSchedulerPolicy.ts'

test('resource enrichment discovery failures use persistent bounded backoff', () => {
  const now = new Date('2026-08-12T00:00:00.000Z')
  const expectedMinutes = [5, 15, 30, 60, 180, 360, 360]
  expectedMinutes.forEach((minutes, previousFailures) => {
    const retry = planResourceEnrichmentDiscoveryFailure({
      ...EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY,
      failures: previousFailures
    }, now, 'database unavailable')
    assert.equal(retry.failures, previousFailures + 1)
    assert.equal(Date.parse(retry.nextAttemptAt || ''), now.getTime() + minutes * 60_000)
    assert.equal(retry.lastError, 'database unavailable')
  })
})

test('resource enrichment discovery becomes due at the exact retry boundary', () => {
  const nowMs = Date.parse('2026-08-12T00:00:00.000Z')
  assert.equal(resourceEnrichmentDiscoveryCoolingDown({
    ...EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY,
    nextAttemptAt: '2026-08-12T00:00:01.000Z'
  }, nowMs), true)
  assert.equal(resourceEnrichmentDiscoveryCoolingDown({
    ...EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY,
    nextAttemptAt: '2026-08-12T00:00:00.000Z'
  }, nowMs), false)
})

test('resource enrichment discovery health is bounded at restart', () => {
  const normalized = normalizeResourceEnrichmentSchedulerRetry({
    failures: 3.9,
    lastAttemptAt: '2026-08-12T08:00:00+08:00',
    lastError: '错'.repeat(800),
    nextAttemptAt: 'invalid',
    privateQueueIdentity: 'must-not-survive'
  })
  assert.equal(normalized.failures, 3)
  assert.equal(normalized.lastAttemptAt, '2026-08-12T00:00:00.000Z')
  assert.equal(normalized.lastError?.length, 500)
  assert.equal(normalized.nextAttemptAt, null)
  assert.equal('privateQueueIdentity' in normalized, false)
})

test('scheduler cools down before querying any enrichment queue and exposes recovery', () => {
  const service = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8'
  )
  const start = service.indexOf('private continueIdleResourceEnrichment')
  const end = service.indexOf('private schedulerTick', start)
  const continuation = service.slice(start, end)
  assert.ok(continuation.indexOf('resourceEnrichmentDiscoveryCoolingDown(') <
    continuation.indexOf('personalMemoryStore.getAttachmentIndexMigrationStats(now)'))
  assert.match(continuation, /resource_enrichment_discovery_cooling_down/)
  assert.match(continuation, /planResourceEnrichmentDiscoveryFailure/)
  assert.match(continuation, /persistCrossStoreMutationState/)
  assert.match(continuation, /EMPTY_RESOURCE_ENRICHMENT_SCHEDULER_RETRY/)
  assert.match(continuation, /commitPersistedRuntimeTransition/)
  assert.doesNotMatch(continuation, /resourceEnrichmentRetry = planResourceEnrichmentDiscoveryFailure/)

  const page = readFileSync(
    new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8'
  )
  assert.match(page, /资源补全队列检查失败/)
  assert.match(page, /resourceEnrichmentScheduler\.nextAttemptAt/)
  assert.match(page, /resourceEnrichmentScheduler\.failures/)
})
