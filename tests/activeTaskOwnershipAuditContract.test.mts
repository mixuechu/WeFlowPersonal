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
  assert.match(store, /human-review-calibration-v6/)
  assert.match(page, /自动归给我：正确 \/ 误判/)
  assert.match(page, /待定归属：确认 \/ 排除/)
})

test('structured memory calibration counts first candidate rulings with extraction provenance', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /previous_status='candidate'/)
  assert.match(store, /PARTITION BY item_kind,item_id ORDER BY id ASC/)
  assert.match(store, /memory_change_log discovery/)
  assert.match(store, /ingestion_batch_commits commit_row/)
  assert.match(store, /getMemoryChangeLogRevision\(\)/)
  assert.match(store, /getIngestionArchiveRevision\(\)/)
  assert.match(store, /getIngestionRecoveryRevision\(\)/)
  assert.match(store, /GROUP BY item_kind,prompt_version,schema_version,model,source_kind_version/)
  assert.match(page, /模型候选首次裁决/)
  assert.match(page, /后续恢复、反复修改与系统级联不重复计入/)
  assert.match(page, /按抽取版本查看事实事件首次裁决/)
  assert.match(store, /structured-candidate-rolling-30-v1/)
  assert.match(store, /latestMemoryRolling\.reviewed < 30 \|\| previousMemoryRolling\.reviewed < 30/)
  assert.match(page, /最近抽取版本内/)
  assert.match(page, /避免版本切换或小样本误报/)
})

test('identity merge suggestions keep append-only versioned human calibration', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(service, /IDENTITY_CANDIDATE_POLICY_VERSION/)
  assert.match(service, /candidateInstanceId:/)
  assert.match(service, /recordIdentityReviewDecision/)
  assert.match(store, /CREATE TABLE IF NOT EXISTS identity_review_decisions/)
  assert.match(store, /candidate_instance_id TEXT NOT NULL UNIQUE/)
  assert.match(store, /identity-candidate-rolling-30-v1/)
  assert.match(store, /latestIdentityRolling\.reviewed < 30 \|\| previousIdentityRolling\.reviewed < 30/)
  assert.match(page, /同一人建议首次裁决/)
  assert.match(page, /不含姓名、账号、候选解释或聊天原文/)
  assert.match(page, /按候选版本查看同一人首次裁决/)
})

test('graph candidates preserve exact, corrected and rejected versioned calibration', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(service, /GRAPH_CANDIDATE_POLICY_VERSION/)
  assert.match(service, /stampModelCandidate/)
  assert.match(service, /recordGraphCandidateReviewDecision/)
  assert.match(store, /CREATE TABLE IF NOT EXISTS graph_candidate_review_decisions/)
  assert.match(store, /accepted_exact/)
  assert.match(store, /accepted_corrected/)
  assert.match(store, /graph-candidate-rolling-30-v1/)
  assert.match(page, /图谱候选首次裁决：原样正确/)
  assert.match(page, /人工修改后采用不会冒充模型原样正确/)
  assert.match(page, /按版本查看图谱候选首次裁决/)
})

test('legacy user reviews backfill calibration without copying review content', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /backfillHumanReviewCalibrationHistory/)
  assert.match(store, /human_review_calibration_backfill_v1/)
  assert.match(store, /resolutionActor'\)='user'/)
  assert.match(store, /legacy-unknown-prompt/)
  assert.match(page, /已从升级前仍可核验的人工审阅中安全回填/)
  assert.match(page, /不复制姓名、候选解释或聊天原文/)
})

test('ownership calibration detects rolling drift without small-sample alarms', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const page = read('src/pages/AiAssistantPage.tsx')

  assert.match(store, /selected-review-rolling-30-v1/)
  assert.match(store, /latest_identity AS \([\s\S]*?ORDER BY updated_at DESC,evidence_fingerprint ASC LIMIT 1/)
  assert.match(store, /JOIN latest_identity USING\([\s\S]*?policy_version,prompt_version,schema_version,model,source_kind/)
  assert.match(store, /ROW_NUMBER\(\) OVER \([\s\S]*?updated_at DESC,evidence_fingerprint ASC/)
  assert.match(store, /latestRolling\.reviewed < 30 \|\| previousRolling\.reviewed < 30/)
  assert.match(store, /latestRolling\.upper95[\s\S]*?previousRolling\.lower95/)
  assert.match(page, /最近版本内抽检/)
  assert.match(page, /两组各满 30 项后才判断趋势，避免小样本误报/)
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
