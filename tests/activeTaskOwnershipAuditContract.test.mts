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

test('real-world calibration separates active mine audits from candidate decisions', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /active_mine_correct/)
  assert.match(store, /candidate_confirmed/)
  assert.match(store, /human-review-calibration-v2/)
  assert.match(page, /自动归给我：正确 \/ 误判/)
  assert.match(page, /待定归属：确认 \/ 排除/)
})

test('dashboard exposes one bounded sample from the complete unreviewed mine-task queue', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /getMineTaskOwnershipAuditSample\(\)/)
  assert.match(store, /ownership_audit_eligible=1/)
  assert.match(store, /NOT EXISTS \([\s\S]*?task_review_decisions/)
  assert.match(store, /ORDER BY td\.ownership_fingerprint ASC,td\.id ASC[\s\S]*?LIMIT 1/)
  assert.match(service, /mineTaskOwnershipAudit:[\s\S]*?mine-task-ownership-audit-sample-v1/)
  assert.match(page, /帮助校准自动归属/)
  assert.match(page, /抽检下一项/)
})
