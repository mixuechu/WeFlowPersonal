import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')

test('current extraction contract requires lifecycle and reconciles terminal signals', () => {
  assert.match(service, /personal-os-prompt-v10/)
  assert.match(service, /personal-memory-schema-v8/)
  assert.match(service, /lifecycle=open\|completed\|cancelled/)
  assert.match(service, /completed\/cancelled 只用于关闭此前存在的匹配任务/)
  assert.match(service, /if \(!previous && lifecycleRequiresExistingTask\(lifecycle\.lifecycle\)\) continue/g)
  assert.match(service, /reconcileTaskStatus\(previous\.status, lifecycle\)/g)
})

test('all model-created tasks pass through the persistence privacy projection', () => {
  assert.equal((service.match(/const task: AssistantTask = sanitizeTaskForPersistence\(\{/g) || []).length, 2)
  assert.match(service, /this\.state\.tasks = sanitizeTasksForPersistence\(this\.state\.tasks\)/)
})
