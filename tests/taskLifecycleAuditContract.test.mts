import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const policy = readFileSync(new URL('../electron/services/taskLifecycleAuditPolicy.ts', import.meta.url), 'utf8')

test('active task lifecycle audit is reachable and visible across the Electron boundary', () => {
  assert.match(main, /ai-assistant:auditActiveTaskLifecycles/)
  assert.match(preload, /auditActiveTaskLifecycles/)
  assert.match(page, /复核活动待办/)
  assert.match(page, /只会关闭高置信度的已完成或已取消事项/)
  assert.match(page, /上次待办复核：检查/)
  assert.match(service, /taskLifecycleAudit: \{ \.\.\.this\.taskLifecycleAuditState \}/g)
})

test('lifecycle audit participates in concurrency, shutdown and mutation audit gates', () => {
  assert.match(service, /当前正在复核活动待办，请等待完成后再开始增量处理/)
  assert.match(service, /name: 'task_lifecycle_audit', promise: this\.taskLifecycleAuditPromise/)
  assert.match(service, /buildTaskMutationToken\(current\)/)
  assert.match(service, /this\.updateTasks\(updates\)/)
  assert.match(service, /只返回一个 JSON 对象/)
  assert.match(policy, /model_lifecycle_audit_completed_v1/)
})
