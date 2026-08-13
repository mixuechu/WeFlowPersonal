import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  cachePersistenceRetryDelayMs,
  emptyCachePersistenceRetry,
  planCachePersistenceRetry
} from '../electron/services/cachePersistenceRetry.ts'
import { sensitivePersistenceImpact } from '../src/utils/sensitivePersistencePresentation.ts'

test('derived cache persistence retries use bounded delays and redacted diagnostics', () => {
  const started = new Date('2026-08-13T03:00:00.000Z')
  let state = planCachePersistenceRetry(
    emptyCachePersistenceRetry(),
    new Error('failed at /Users/private/wxid_secret'),
    started
  )
  assert.equal(state.failureCount, 1)
  assert.equal(state.nextAttemptAt, '2026-08-13T03:00:05.000Z')
  assert.equal(state.lastError.includes('/Users/private'), false)
  assert.equal(state.lastError.includes('wxid_secret'), false)
  for (let index = 1; index < 10; index += 1) {
    state = planCachePersistenceRetry(state, 'still unavailable', started)
  }
  assert.equal(state.nextAttemptAt, '2026-08-13T03:30:00.000Z')
  assert.equal(cachePersistenceRetryDelayMs(state, started.getTime()), 30 * 60_000)
})

test('all identity-bearing encrypted caches retain failed writes for automatic retry', () => {
  for (const file of [
    'cacheMapStore.ts',
    'contactCacheService.ts',
    'sessionStatsCacheService.ts',
    'groupMyMessageCountCacheService.ts'
    , 'insightProfileService.ts'
    , 'exportRecordService.ts'
    , 'insightRecordService.ts'
    , 'groupSummaryRecordService.ts'
  ]) {
    const source = readFileSync(new URL(`../electron/services/${file}`, import.meta.url), 'utf8')
    if (!['insightProfileService.ts', 'exportRecordService.ts', 'insightRecordService.ts', 'groupSummaryRecordService.ts'].includes(file)) {
      assert.match(source, /this\.persistDirty = true[\s\S]*planCachePersistenceRetry/)
    } else {
      assert.match(source, /this\.persistenceRetry = planCachePersistenceRetry/)
    }
    assert.match(source, /this\.persist\(cachePersistenceRetryDelayMs\(this\.persistenceRetry\)\)/)
    assert.match(source, /persistenceRetry: \{ \.\.\.this\.persistenceRetry \}/)
    assert.match(source, /this\.persistenceRetry = emptyCachePersistenceRetry\(\)/)
    assert.match(source, /will-quit[\s\S]*flush/)
  }
})

test('cache retry health is visible without presenting derived caches as memory authority', () => {
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /sensitiveCachePersistenceFailures/)
  assert.match(page, /下次自动重试/)
  assert.match(page, /sensitivePersistenceImpact\(kind\)/)
})

test('persistence warnings distinguish model results, exports and rebuildable caches', () => {
  assert.match(sensitivePersistenceImpact('model_result'), /强制断电.*重新生成/)
  assert.match(sensitivePersistenceImpact('model_result'), /SQLCipher 权威个人记忆未受影响/)
  assert.match(sensitivePersistenceImpact('operational_record'), /已经导出的文件不受影响/)
  assert.match(sensitivePersistenceImpact('derived_cache'), /可重建派生缓存/)
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /kind: 'model_result'/)
  assert.match(page, /kind: 'operational_record'/)
  assert.match(page, /sensitivePersistenceImpact\(kind\)/)
})
