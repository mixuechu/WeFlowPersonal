import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('embedding cleanup failure cannot skip personal memory database close', () => {
  const start = service.indexOf('async prepareForAppShutdown')
  const end = service.indexOf('handleSystemSuspend', start)
  const shutdown = service.slice(start, end)
  const embeddingStart = shutdown.indexOf('await localEmbeddingService.dispose()')
  const embeddingCatch = shutdown.indexOf("cleanupFailures.push('embedding_dispose')", embeddingStart)
  const databaseClose = shutdown.indexOf('personalMemoryStore.close()', embeddingStart)
  assert.ok(embeddingStart > 0)
  assert.ok(embeddingCatch > embeddingStart)
  assert.ok(databaseClose > embeddingCatch)
  assert.match(shutdown, /cleanupFailures\.push\('personal_memory_close'\)/)
  assert.match(shutdown, /databaseClosed = true/)
  assert.match(shutdown, /embeddingDisposed = true/)
})

test('shutdown cleanup diagnostics expose fixed categories rather than exception text', () => {
  const start = service.indexOf('async prepareForAppShutdown')
  const end = service.indexOf('handleSystemSuspend', start)
  const shutdown = service.slice(start, end)
  assert.match(shutdown, /cleanupFailures: Array<'embedding_dispose' \| 'personal_memory_close'>/)
  assert.match(shutdown, /cleanupFailures,/)
  assert.doesNotMatch(shutdown, /cleanupFailures\.push\([^'\n]/)
})
