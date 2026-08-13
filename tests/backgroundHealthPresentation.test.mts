import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  BACKGROUND_HEALTH_DIAGNOSTICS_TARGET,
  BACKGROUND_HEALTH_PERSISTENCE_TARGET,
  buildBackgroundHealthPresentation
} from '../src/utils/backgroundHealthPresentation.ts'

test('healthy dashboard does not produce a background incident banner', () => {
  assert.equal(buildBackgroundHealthPresentation({}), null)
  assert.equal(buildBackgroundHealthPresentation({
    schedulerRuntime: { failures: 3, lastError: '' }
  }), null)
})

test('global scheduler failure has priority and incidents are aggregated', () => {
  const presentation = buildBackgroundHealthPresentation({
    schedulerRuntime: {
      failures: 2,
      lastError: 'database unavailable',
      nextAttemptAt: '2026-08-13T10:30:00.000Z'
    },
    preparedRecoveryScheduler: {
      failures: 1,
      lastError: 'recovery read failed',
      nextAttemptAt: '2026-08-13T10:20:00.000Z'
    },
    resourceEnrichmentScheduler: {
      failures: 4,
      lastError: 'queue read failed',
      nextAttemptAt: '2026-08-13T11:00:00.000Z'
    }
  })

  assert.ok(presentation)
  assert.equal(presentation.count, 3)
  assert.equal(presentation.primary.kind, 'scheduler_runtime')
  assert.equal(presentation.primary.failures, 2)
  assert.equal(presentation.nextAttemptAt, '2026-08-13T10:20:00.000Z')
  assert.equal(presentation.diagnosticsTarget, 'message-resources')
})

test('resource budget migration uses its persisted failure streak', () => {
  const presentation = buildBackgroundHealthPresentation({
    resourceContentBudget: {
      migration: {
        failureStreak: 3.9,
        lastError: 'legacy row read failed',
        nextAttemptAt: 'not-a-date'
      }
    }
  })

  assert.ok(presentation)
  assert.equal(presentation.primary.kind, 'resource_content_budget')
  assert.equal(presentation.primary.failures, 3)
  assert.equal(presentation.nextAttemptAt, '')
})

test('model result persistence failures take priority and explain force-quit risk', () => {
  const presentation = buildBackgroundHealthPresentation({
    schedulerRuntime: {
      failures: 2,
      lastError: 'scheduler failed',
      nextAttemptAt: '2026-08-13T10:30:00.000Z'
    }
  }, {
    privacy: { sensitiveCaches: {
      insightProfiles: { persistenceRetry: {
        failureCount: 3,
        lastError: 'write failed',
        nextAttemptAt: '2026-08-13T10:10:00.000Z'
      } },
      groupSummaryRecords: { persistenceRetry: {
        failureCount: 1,
        lastError: 'log write failed',
        nextAttemptAt: '2026-08-13T10:15:00.000Z'
      } }
    } }
  })

  assert.ok(presentation)
  assert.equal(presentation.count, 2)
  assert.equal(presentation.primary.kind, 'model_result_persistence')
  assert.equal(presentation.primary.failures, 4)
  assert.equal(presentation.severity, 'critical')
  assert.match(presentation.primary.detail, /避免强制退出或断电/)
  assert.equal(presentation.nextAttemptAt, '2026-08-13T10:10:00.000Z')
  assert.equal(presentation.diagnosticsTarget, BACKGROUND_HEALTH_PERSISTENCE_TARGET)
})

test('derived cache persistence failure is lower impact and identifies authoritative memory as safe', () => {
  const presentation = buildBackgroundHealthPresentation({}, {
    privacy: { sensitiveCaches: {
      sessionMessages: { persistenceRetry: {
        failureCount: 1,
        lastError: 'cache unavailable',
        nextAttemptAt: ''
      } }
    } }
  })

  assert.ok(presentation)
  assert.equal(presentation.primary.kind, 'derived_cache_persistence')
  assert.equal(presentation.severity, 'warning')
  assert.match(presentation.primary.detail, /SQLCipher 权威个人记忆未受影响/)
})

test('omitted diagnostics cannot turn a stale persistence snapshot into a current alert', () => {
  assert.equal(buildBackgroundHealthPresentation({}, undefined), null)
})

test('current-run auxiliary AI failures are visible at page level and aggregate service names', () => {
  const presentation = buildBackgroundHealthPresentation({}, {
    legacyBackgroundServices: {
      insight: { lastError: 'insight failed', consecutiveFailures: 2 },
      groupSummary: { lastError: 'summary failed', consecutiveFailures: 1 },
      messagePush: { lastError: '', consecutiveFailures: 0 }
    }
  })
  assert.ok(presentation)
  assert.equal(presentation.primary.kind, 'legacy_ai_service')
  assert.equal(presentation.primary.failures, 3)
  assert.match(presentation.primary.title, /联系人见解、群聊自动总结/)
  assert.match(presentation.primary.detail, /不会导致应用退出/)
  assert.equal(presentation.diagnosticsTarget, BACKGROUND_HEALTH_PERSISTENCE_TARGET)
})

test('a recovered auxiliary service is not retained as a current page incident', () => {
  assert.equal(buildBackgroundHealthPresentation({}, {
    legacyBackgroundServices: {
      insight: { lastError: '', consecutiveFailures: 0, lastSuccessAt: '2026-08-13T08:00:00Z' }
    }
  }), null)
})

test('persisted auxiliary cooldown remains visible after application restart', () => {
  const presentation = buildBackgroundHealthPresentation({}, {
    legacyBackgroundServices: {
      insight: {
        lastError: '',
        consecutiveFailures: 0,
        retry: {
          failures: 4,
          lastError: 'database unavailable',
          nextAttemptAt: '2026-08-13T09:00:00.000Z'
        }
      }
    }
  })
  assert.ok(presentation)
  assert.equal(presentation.primary.kind, 'legacy_ai_service')
  assert.equal(presentation.primary.failures, 4)
  assert.equal(presentation.nextAttemptAt, '2026-08-13T09:00:00.000Z')
  assert.match(presentation.primary.detail, /加密保存的退避时间/)
})

test('AI assistant page exposes the diagnostics target and consumes the presentation', () => {
  const source = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(source, /buildBackgroundHealthPresentation\([\s\S]*dashboard,[\s\S]*memoryDiagnosticsError \? undefined : memoryDiagnostics/)
  assert.match(source, /data-background-health-count=/)
  assert.match(source, /diagnosticsTarget === 'memory-diagnostics'/)
  assert.match(source, /id="message-resources"/)
  assert.equal(BACKGROUND_HEALTH_DIAGNOSTICS_TARGET, 'message-resources')
})
