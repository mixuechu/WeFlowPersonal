import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('task reminder dashboard and pages use the SQLCipher authority without full task scans', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const dashboardStart = service.indexOf('getDashboard(): any')
  const dashboardEnd = service.indexOf('\n  getTaskWorkspace(', dashboardStart)
  const dashboard = service.slice(dashboardStart, dashboardEnd)
  const queryStart = service.indexOf('private queryTaskReminderPage(')
  const queryEnd = service.indexOf('\n  getTaskHistoryPage(', queryStart)
  const query = service.slice(queryStart, queryEnd)
  assert.match(dashboard, /getTaskReminderDashboardPage\(\)/)
  assert.doesNotMatch(dashboard, /buildTaskReminders|applyReminderPreferences|paginateTaskReminders/)
  assert.match(dashboard, /sqlcipher_paginated_complete/)
  assert.match(query, /personalMemoryStore\.listTaskReminderPage\(/)
  assert.doesNotMatch(query, /this\.state\.tasks/)
  assert.match(query, /nextBoundaryMs/)
})

test('task reminder feedback reauthorizes the exact current SQLCipher reminder', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const start = service.indexOf('updateReminderPreference(input:')
  const end = service.indexOf('\n  updateGraphReview(', start)
  const mutation = service.slice(start, end)
  assert.match(mutation, /this\.queryTaskReminderPage\(\{/)
  assert.match(mutation, /target\.id/)
  assert.match(mutation, /target\.taskId/)
  assert.match(mutation, /target\.kind/)
  assert.doesNotMatch(mutation, /buildTaskReminders|this\.state\.tasks/)
})

test('task reminder UI consumes the authoritative next offset and explains the directory', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /offset: taskReminderPage\.nextOffset/)
  assert.match(page, /nextOffset: Number\(result\.nextOffset/)
  assert.match(page, /行动提醒由 SQLCipher/)
  assert.match(page, /下一个时间边界自动失效/)
  assert.match(page, /每日系统通知同样使用完整权威总数/)
})

test('daily reminder notification reads the SQLCipher directory without scanning all tasks', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const start = service.indexOf('private async runSchedulerTick(')
  const end = service.indexOf('\n  private ', start + 10)
  const scheduler = service.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(scheduler, /this\.queryTaskReminderPage\(\{ limit: 2 \}, now\)/)
  assert.match(scheduler, /reminderPage\.total/)
  assert.match(scheduler, /reminderPage\.items\.map/)
  assert.doesNotMatch(scheduler, /buildTaskReminders|applyReminderPreferences|this\.state\.tasks/)
  assert.match(service, /notification: 'sqlcipher_first_two_exact_total'/)
})
