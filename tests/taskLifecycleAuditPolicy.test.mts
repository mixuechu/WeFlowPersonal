import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canResumeTaskLifecycleAudit,
  classifyTaskLifecycleAuditRequestFailure,
  planTaskLifecycleAuditDecision,
  selectTaskLifecycleAuditEvidence
} from '../electron/services/taskLifecycleAuditPolicy.ts'

const base = {
  currentExists: true,
  currentStatus: 'todo',
  currentMutationToken: 'same',
  expectedMutationToken: 'same',
  allowedEvidenceIds: ['task:e1']
}

test('lifecycle audit closes only a high-confidence grounded terminal decision', () => {
  assert.deepEqual(planTaskLifecycleAuditDecision({
    ...base,
    decision: { lifecycle: 'completed', confidence: 0.95, evidenceIds: ['task:e1'] }
  }), {
    action: 'close', status: 'done', reason: 'model_lifecycle_audit_completed_v1', evidenceIds: ['task:e1']
  })
  assert.equal(planTaskLifecycleAuditDecision({
    ...base,
    decision: { lifecycle: 'cancelled', confidence: 0.95, evidenceIds: ['task:e1'] }
  }).status, 'cancelled')
})

test('lifecycle audit keeps open, low-confidence and invented-evidence decisions', () => {
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'open', confidence: 1, evidenceIds: ['task:e1'] }
  }).action, 'keep')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'completed', confidence: 0.89, evidenceIds: ['task:e1'] }
  }).action, 'keep')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, decision: { lifecycle: 'completed', confidence: 1, evidenceIds: ['invented'] }
  }).action, 'keep')
})

test('lifecycle audit skips stale, missing and already terminal tasks', () => {
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentMutationToken: 'changed', decision: {}
  }).action, 'skip')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentExists: false, decision: {}
  }).action, 'skip')
  assert.equal(planTaskLifecycleAuditDecision({
    ...base, currentStatus: 'done', decision: {}
  }).action, 'skip')
})

test('lifecycle audit evidence keeps task origin and recent outcome within a hard budget', () => {
  const selected = selectTaskLifecycleAuditEvidence(Array.from({ length: 50 }, (_, index) => index), 20)
  assert.deepEqual(selected.slice(0, 5), [0, 1, 2, 3, 4])
  assert.deepEqual(selected.slice(-3), [47, 48, 49])
  assert.equal(selected.length, 20)
})

test('lifecycle audit resumes only an exact encrypted batch cursor', () => {
  assert.equal(canResumeTaskLifecycleAudit({
    running: false,
    total: 23,
    processed: 20,
    candidateIds: Array.from({ length: 23 }, (_, index) => `task-${index}`),
    nextOffset: 20
  }), true)
  assert.equal(canResumeTaskLifecycleAudit({
    running: false,
    total: 23,
    processed: 20,
    candidateIds: Array.from({ length: 22 }, (_, index) => `task-${index}`),
    nextOffset: 20
  }), false)
  assert.equal(canResumeTaskLifecycleAudit({
    running: false,
    total: 23,
    processed: 20,
    candidateIds: Array.from({ length: 23 }, (_, index) => `task-${index}`),
    nextOffset: 10
  }), false)
  assert.equal(canResumeTaskLifecycleAudit({
    running: true,
    total: 23,
    processed: 20,
    candidateIds: Array.from({ length: 23 }, (_, index) => `task-${index}`),
    nextOffset: 20
  }), false)
})

test('lifecycle audit classifies English, Chinese and bounded timeout failures', () => {
  assert.equal(classifyTaskLifecycleAuditRequestFailure({
    message: '模型请求超过 90 秒，已安全取消'
  }), 'timeout')
  assert.equal(classifyTaskLifecycleAuditRequestFailure({ message: 'request timeout' }), 'timeout')
  assert.equal(classifyTaskLifecycleAuditRequestFailure({ message: '模型请求超时' }), 'timeout')
  assert.equal(classifyTaskLifecycleAuditRequestFailure({
    name: 'AbortError',
    message: '模型请求超过 90 秒，已安全取消'
  }), 'cancelled')
  assert.equal(classifyTaskLifecycleAuditRequestFailure({ message: '连接已重置' }), 'request_failed')
})

test('lifecycle audit selects its durable candidate snapshot inside SQLCipher', () => {
  const service = readFileSync(join(process.cwd(), 'electron/services/aiAssistantService.ts'), 'utf8')
  const store = readFileSync(join(process.cwd(), 'electron/services/personalMemoryStore.ts'), 'utf8')
  const page = readFileSync(join(process.cwd(), 'src/pages/AiAssistantPage.tsx'), 'utf8')
  const start = service.indexOf('  auditActiveTaskLifecycles(): Promise<any>')
  const end = service.indexOf('\n  private async runActiveTaskLifecycleAudit(', start)
  const method = service.slice(start, end)
  assert.match(method, /personalMemoryStore\.listActiveMineTaskLifecycleCandidateIds\(\)/)
  assert.match(method, /candidateSelection\?\.stale/)
  assert.doesNotMatch(method, /this\.state\.tasks\.(?:filter|map|flatMap)/)
  assert.match(store, /listActiveMineTaskLifecycleCandidateIds\(\)[\s\S]*?FROM task_directory[\s\S]*?classification='mine'[\s\S]*?status IN \('todo','doing','waiting'\)[\s\S]*?completedRevision === revision/)
  assert.match(service, /candidateSelection: 'sqlcipher_active_mine_stable_ids'/)
  assert.match(service, /candidateFullTaskMaterializations: 0/)
  assert.match(service, /resumeSnapshot: 'encrypted_stable_ids'/)
  assert.match(page, /复核候选由 SQLCipher 按本人未完成任务一次固化稳定 ID/)
})
