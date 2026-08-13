import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)
const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('suspend checkpoint failure enters persisted scheduler backoff without escaping', () => {
  const start = service.indexOf('handleSystemSuspend(')
  const end = service.indexOf('async handleSystemResume(', start)
  const suspend = service.slice(start, end)
  assert.match(suspend, /try \{[\s\S]*this\.saveState\(\)/)
  assert.match(suspend, /catch \(error\) \{[\s\S]*recordSchedulerRuntimeFailure\(error, observedAt\)/)
  assert.match(main, /powerMonitor\.on\('suspend',[\s\S]*try \{[\s\S]*handleSystemSuspend\(\)[\s\S]*catch \(error\)/)
})

test('resume start and result checkpoints fail visibly before returning success', () => {
  const start = service.indexOf('private async runSystemResume(')
  const end = service.indexOf('private migrateLegacyData(', start)
  const resume = service.slice(start, end)
  assert.match(resume, /system_resume_checkpoint_failed/)
  assert.match(resume, /system_resume_result_checkpoint_failed/)
  assert.equal((resume.match(/this\.recordSchedulerRuntimeFailure\(/g) || []).length, 2)
  assert.match(resume, /await this\.schedulerTick\('system_resume', observedAt\)/)
})

test('scheduler failures and power checkpoints share one persisted redacted policy', () => {
  assert.match(service, /private recordSchedulerRuntimeFailure\(error: unknown, now = new Date\(\)\)/)
  assert.match(service, /planSchedulerRuntimeFailure\([\s\S]*sanitizeDiagnosticText\(error\)/)
  assert.match(service, /persistCrossStoreMutationState\(\)/)
  const guardedStart = service.indexOf('private async runSchedulerTickGuarded(')
  const guardedEnd = service.indexOf('private async runSchedulerTick(', guardedStart)
  assert.match(service.slice(guardedStart, guardedEnd), /recordSchedulerRuntimeFailure\(error, now\)/)
})
