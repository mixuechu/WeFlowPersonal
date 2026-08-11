import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../electron/services/personalMemoryStore.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('every completed personal-memory maintenance direction enters one durable audit outbox', () => {
  for (const operation of [
    'backup_create', 'backup_restore', 'backup_delete', 'bundle_export', 'bundle_import',
    'import_staging_discard', 'backup_trash_restore', 'backup_trash_discard'
  ]) {
    assert.match(service, new RegExp(`operation: '${operation}'`))
    assert.match(store, new RegExp(`'${operation}'`))
    assert.match(page, new RegExp(`value="${operation}"`))
  }
  assert.match(service, /maintenanceAuditOutbox/)
  assert.match(service, /this\.saveState\(\)[\s\S]*?this\.flushMemoryMaintenanceAuditOutbox\(\)/)
  assert.match(service, /personalMemoryStore\.recordMemoryMaintenanceAudit\(event\)/)
  assert.match(service, /pending\.length >= 256/)
})

test('maintenance audit is SQLCipher paginated and does not expose sensitive artifact identity', () => {
  assert.match(store, /CREATE TABLE IF NOT EXISTS memory_maintenance_audit/)
  assert.match(store, /event_id TEXT NOT NULL UNIQUE/)
  assert.match(store, /ensureMemoryMaintenanceAuditRevisionTriggers/)
  const pageMethod = store.slice(
    store.indexOf('  listMemoryMaintenanceAuditPage('),
    store.indexOf('  getMemoryMaintenanceAuditStats(')
  )
  assert.doesNotMatch(pageMethod, /event_id|path|filename|passphrase|sha256|content/)
  assert.match(pageMethod, /ORDER BY completed_at DESC,id DESC/)
  assert.match(preload, /getMemoryMaintenanceAuditPage/)
  assert.match(main, /ai-assistant:getMemoryMaintenanceAuditPage/)
  assert.match(page, /不保存路径、文件名、口令、哈希或记忆正文/)
})
