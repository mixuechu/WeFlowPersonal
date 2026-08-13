import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types/electron.d.ts', import.meta.url), 'utf8')
const projectScope = readFileSync(new URL('../electron/services/projectDirectoryScope.ts', import.meta.url), 'utf8')

test('task workset continuation fails closed on a missing or changed filter scope', () => {
  assert.match(service, /buildActiveTaskWorksetScopeToken\(options\)[\s\S]*offset > 0 &&[\s\S]*options\?\.taskWorksetScopeToken[\s\S]*!== taskWorksetScopeToken/)
  assert.match(service, /taskWorksetScopeStale: true, taskWorksetScopeToken/)
  assert.match(page, /revision: taskWorkset\.revision,[\s\S]*taskWorksetScopeToken: taskWorkset\.taskWorksetScopeToken/)
  assert.match(types, /getActiveTaskWorkset:[\s\S]*?taskWorksetScopeToken\?: string[\s\S]*?taskWorksetScopeStale\?: boolean/)
})

test('project continuation binds query, phase and Shanghai day boundary', () => {
  assert.match(projectScope, /project-directory-scope-v1', query, phase, today/)
  assert.match(service, /computeProjectDirectoryScopeToken\([\s\S]*today[\s\S]*offset > 0 &&[\s\S]*projectDirectoryScopeToken/)
  assert.match(page, /revision: projectDirectory\.revision,[\s\S]*projectDirectoryScopeToken: projectDirectory\.projectDirectoryScopeToken/)
  assert.match(types, /getProjectDirectory:[\s\S]*?projectDirectoryScopeToken\?: string[\s\S]*?projectDirectoryScopeStale\?: boolean/)
})

test('whole-month collector carries its first page scope token across every page', () => {
  assert.match(service, /buildTaskCalendarScopeToken\(options\)[\s\S]*offset > 0 &&[\s\S]*options\?\.taskCalendarScopeToken[\s\S]*!== taskCalendarScopeToken/)
  assert.match(page, /let taskCalendarScopeToken = ''[\s\S]*offset: items\.length,[\s\S]*taskCalendarScopeToken[\s\S]*if \(!taskCalendarScopeToken\) taskCalendarScopeToken = result\.taskCalendarScopeToken/)
  assert.match(types, /getTaskCalendarPage:[\s\S]*?taskCalendarScopeToken\?: string[\s\S]*?taskCalendarScopeStale\?: boolean/)
})
