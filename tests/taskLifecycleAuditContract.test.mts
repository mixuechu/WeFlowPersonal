import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const policy = readFileSync(new URL('../electron/services/taskLifecycleAuditPolicy.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../electron/services/personalMemoryStore.ts', import.meta.url), 'utf8')

test('active task lifecycle audit is reachable and visible across the Electron boundary', () => {
  assert.match(main, /ai-assistant:auditActiveTaskLifecycles/)
  assert.match(preload, /auditActiveTaskLifecycles/)
  assert.match(page, /复核活动待办/)
  assert.match(page, /只会关闭高置信度的已完成或已取消事项/)
  assert.match(page, /上次待办复核：检查/)
  assert.match(service, /taskLifecycleAudit: \{[\s\S]*?\.\.\.this\.taskLifecycleAuditState/)
})

test('lifecycle audit participates in concurrency, shutdown and mutation audit gates', () => {
  assert.match(service, /当前正在复核活动待办，请等待完成后再开始增量处理/)
  assert.match(service, /name: 'task_lifecycle_audit', promise: this\.taskLifecycleAuditPromise/)
  assert.match(service, /buildTaskMutationToken\(current\)/)
  assert.match(service, /this\.updateTasks\(updates\)/)
  assert.match(service, /只返回一个 JSON 对象/)
  assert.match(policy, /model_lifecycle_audit_completed_v1/)
})

test('lifecycle model batches are private, filterable and visible in the shared ledger', () => {
  assert.match(service, /recordTaskLifecycleModelRequestStarted/)
  assert.match(service, /task_lifecycle_batch_committed/)
  assert.match(store, /counts_digest_no_task_ids_prompt_evidence_or_model_output_v1/)
  assert.match(store, /request_kind TEXT NOT NULL DEFAULT 'memory_answer'/)
  assert.match(page, /待办生命周期复核（/)
  assert.match(page, /不保存问题、任务名称、Prompt、聊天正文/)
  assert.match(service, /taskLifecycleAuditResume/)
  assert.match(service, /classifyTaskLifecycleAuditRequestFailure/)
  assert.match(page, /继续复核剩余/)
})
