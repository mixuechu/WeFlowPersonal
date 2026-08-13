import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { removeLegacyAnalyticsCacheFile } from '../electron/services/analyticsCachePrivacy.ts'

test('legacy plaintext analytics cache is deleted without exposing its path', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-analytics-privacy-'))
  const filePath = join(directory, 'analytics_cache.json')
  try {
    writeFileSync(filePath, JSON.stringify({ key: 'private-session-scope', data: { total: 42 } }))
    const status = await removeLegacyAnalyticsCacheFile(filePath)
    assert.equal(existsSync(filePath), false)
    assert.deepEqual(status, {
      version: 'analytics-memory-only-v1',
      persistence: 'memory_only',
      legacyFilePresent: false,
      removedThisStart: true,
      error: ''
    })
    assert.equal(JSON.stringify(status).includes(filePath), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('analytics aggregation has no persistent plaintext read or write path', () => {
  const service = readFileSync(new URL('../electron/services/analyticsService.ts', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const assistant = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(service, /loadCacheFromFile|saveCacheToFile|file-cache/)
  assert.doesNotMatch(service, /readFile|writeFile|analytics_cache\.json/)
  assert.match(main, /migrateLegacyCachePrivacy\([\s\S]{0,160}analytics_cache\.json/)
  assert.match(assistant, /analyticsAggregate: analyticsService\.getCachePrivacyStatus\(\)/)
  assert.match(page, /统计聚合缓存/)
  assert.match(page, /Number\(cache\?\.logFiles \|\| 0\) > 0/)
})
