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

test('task dossiers fall back to revision-bound SQLCipher history without stale mutations', () => {
  const start = service.indexOf('  getTaskWorkspace(')
  const end = service.indexOf('\n  private buildTaskReminderAuthorityKey(', start)
  const method = service.slice(start, end)
  assert.match(method, /runtimeTask \|\| personalMemoryStore\.getTaskDirectoryDossierItem\(id\)/)
  assert.match(method, /getTaskArchiveRevision\(\)/)
  assert.match(method, /mutationToken: runtimeTask \? buildTaskMutationToken\(runtimeTask\) : undefined/)
  assert.match(method, /eligible: Boolean\(runtimeTask\)/)
  assert.match(method, /sqlcipher_history_read_only/)

  const storeStart = store.indexOf('  getTaskDirectoryDossierItem(')
  const storeEnd = store.indexOf('\n  listEntityRelatedTaskPage(', storeStart)
  const lookup = store.slice(storeStart, storeEnd)
  assert.match(lookup, /FROM task_directory WHERE id=\?/)
  assert.match(lookup, /COUNT\(\*\) OVER \(\) AS evidence_total/)
  assert.match(lookup, /mutationToken: _mutationToken/)
  assert.match(lookup, /LIMIT \?/)

  assert.match(page, /SQLCipher 中的历史任务权威档案/)
  assert.match(page, /当前没有可用操作令牌，因此只读/)
})
