import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('active mine-task ownership audit is exposed through one authenticated IPC contract', () => {
  const main = read('electron/main.ts')
  const preload = read('electron/preload.ts')
  const types = read('src/types/electron.d.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(main, /ipcMain\.handle\('ai-assistant:reviewMineTaskOwnership'/)
  assert.match(preload, /ipcRenderer\.invoke\(\s*'ai-assistant:reviewMineTaskOwnership'/)
  assert.match(types, /reviewMineTaskOwnership:[\s\S]*?'mine' \| 'rejected'/)
  assert.match(page, /这项待办真的属于你吗？/)
  assert.match(page, /reviewMineTaskOwnership\(\s*task\.id,[\s\S]*?task\.mutationToken/)
})

test('mine-task rejection uses the recoverable task mutation protocol', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')

  assert.match(service, /task_ownership_audit_/)
  assert.match(service, /prepareTaskMutationCommit\([\s\S]*?feedbackEvidenceFingerprint/)
  assert.match(service, /TASK_ABSENT_MUTATION_TOKEN/)
  assert.match(store, /ownership_audit_confirmed/)
  assert.match(store, /recordTaskReviewDecisionInCurrentTransaction/)
  assert.match(store, /fingerprint !== taskEvidenceFingerprint\(task\)/)
})
