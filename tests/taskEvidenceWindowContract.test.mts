import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL(
  '../electron/services/aiAssistantService.ts', import.meta.url
), 'utf8')
const store = readFileSync(new URL(
  '../electron/services/personalMemoryStore.ts', import.meta.url
), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('runtime task hydration and lifecycle audits use bounded SQLCipher evidence windows', () => {
  const hydrateStart = service.indexOf('  private hydrateTaskEvidenceFromSql(')
  const hydrateEnd = service.indexOf('\n  private restoreActiveTaskEvidenceHotsets(', hydrateStart)
  const restoreEnd = service.indexOf('\n  private recoverPreparedTaskMutationCommits(', hydrateEnd)
  const lifecycleStart = service.indexOf('  private async runActiveTaskLifecycleAudit(')
  const lifecycleEnd = service.indexOf('\n  private async ', lifecycleStart + 10)
  const hydrate = service.slice(hydrateStart, hydrateEnd)
  const restore = service.slice(hydrateEnd, restoreEnd)
  const lifecycle = service.slice(lifecycleStart, lifecycleEnd > lifecycleStart
    ? lifecycleEnd : lifecycleStart + 20000)
  assert.match(hydrate, /listTaskEvidenceWindow\([\s\S]*?tail: 50/)
  assert.doesNotMatch(hydrate, /listTaskEvidence\(/)
  assert.match(restore, /listTaskEvidenceWindow\([\s\S]*?tail: 50/)
  assert.doesNotMatch(restore, /listTaskEvidence\(/)
  assert.match(lifecycle, /listTaskEvidenceWindow\([\s\S]*?head: 5, tail: 15/)
  assert.doesNotMatch(lifecycle, /listTaskEvidence\(/)

  const windowStart = store.indexOf('  listTaskEvidenceWindow(')
  const windowEnd = store.indexOf('\n  getTaskDirectoryDossierItem(', windowStart)
  const windowMethod = store.slice(windowStart, windowEnd)
  assert.match(windowMethod, /idx_task_evidence_window_asc/)
  assert.match(windowMethod, /idx_search_document_evidence_archive_time/)
  assert.match(windowMethod, /ROW_NUMBER\(\) OVER \(PARTITION BY document_id/)
  assert.match(windowMethod, /WHERE evidence_rank<=\?/)
  assert.doesNotMatch(windowMethod, /head_rank<=\? OR tail_rank<=\?/)
  assert.match(windowMethod, /slice\(0, 500\)/)

  assert.match(service, /runtimeEvidenceHydrationStrategy: 'sqlcipher_tail_window'/)
  assert.match(service, /runtimeEvidenceHydrationLimitPerTask: 50/)
  assert.match(service, /lifecycleEvidenceStrategy: 'sqlcipher_head_tail_window'/)
  assert.match(service, /lifecycleEvidenceHeadPerTask: 5/)
  assert.match(service, /lifecycleEvidenceTailPerTask: 15/)
  assert.match(service, /completeEvidenceArchive: 'sqlcipher_authoritative_paginated'/)
  assert.match(page, /运行时补齐 <b>每项最新/)
  assert.match(page, /生命周期复核 <b>最早/)
  assert.match(page, /完整证据档案 <b>/)
})
