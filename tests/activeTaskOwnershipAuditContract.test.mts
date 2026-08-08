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
  assert.match(store, /human-review-calibration-v4/)
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

test('mine-task audit index health is visible and participates in runtime repair', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /ensureMineTaskOwnershipAuditIndex\(\)/)
  assert.match(store, /mineTaskOwnershipAuditIndexHealthy/)
  assert.match(store, /after\.mineTaskOwnershipAuditIndexHealthy/)
  assert.match(store, /mineTaskOwnershipAuditIndex:[\s\S]*?after\.mineTaskOwnershipAuditIndexHealthy/)
  assert.match(page, /自动归属抽检队列索引/)
  assert.match(page, /mineTaskOwnershipAuditIndex\.repairsTotal/)
})

test('selected ownership reviews expose uncertainty instead of claiming population accuracy', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /selectedReviewBinomialCalibration/)
  assert.match(store, /selected_review_interval_not_population_accuracy/)
  assert.match(store, /recommendedMinimum/)
  assert.match(page, /95% 统计区间/)
  assert.match(page, /仍不能代表未抽检的全部待办/)
})

test('ownership calibration keeps rule, prompt, schema, model and source versions comparable', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(service, /ownershipPolicyVersion: TASK_ASSIGNMENT_POLICY_VERSION/)
  assert.match(service, /ownershipPolicyVersion: DOCUMENT_TASK_OWNERSHIP_POLICY_VERSION/)
  assert.match(service, /ownershipPromptVersion:/)
  assert.match(service, /ownershipSchemaVersion:/)
  assert.match(service, /ownershipModel:/)
  assert.match(store, /legacy-unknown-policy/)
  assert.match(store, /GROUP BY policy_version,prompt_version,schema_version,model,source_kind/)
  assert.match(store, /COUNT\(\*\) OVER\(\) AS version_group_total/)
  assert.match(page, /按归属版本查看真实抽检/)
  assert.match(page, /当前仅展示最近有人工判断的 12 组版本/)
})
