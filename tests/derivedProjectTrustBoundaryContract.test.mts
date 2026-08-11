import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('derived projects never infer structured memory from a bounded recent feed', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const start = service.indexOf('getProjectWorkspace(projectId: string)')
  const end = service.indexOf('\n  getDashboard()', start)
  const implementation = service.slice(start, end)
  assert.doesNotMatch(implementation, /getMemoryFeed\(/)
  assert.match(implementation, /: \{ claims: \[\], events: \[\] \}/)
  assert.match(implementation, /task_field_only_until_entity_confirmed/)
  assert.match(implementation, /blocked_until_entity_confirmed/)
})

test('the project dossier explains the trust boundary before showing structured memory', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /只展示明确写入待办“项目”字段的任务、进度和风险/)
  assert.match(page, /不会按名称猜测并吸收事实、关系或事件/)
})

test('trusted project tasks and risks stay paginated inside SQLCipher', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const workspaceStart = service.indexOf('getProjectWorkspace(projectId: string)')
  const taskPageStart = service.indexOf('getProjectTaskPage(', workspaceStart)
  const riskPageStart = service.indexOf('getProjectRiskPage(', taskPageStart)
  const nextMethod = service.indexOf('\n  getEventTimeline(', riskPageStart)
  const workspace = service.slice(workspaceStart, taskPageStart)
  const taskPage = service.slice(taskPageStart, riskPageStart)
  const riskPage = service.slice(riskPageStart, nextMethod)
  assert.match(workspace, /getDerivedProjectIdentityById\(id\)/)
  assert.match(workspace, /listProjectTaskPage\(projectNames, \{[\s\S]*?limit: 40[\s\S]*?explicitProjectOnly/)
  assert.match(workspace, /listProjectRiskPage\(projectNames, shanghaiDate\(\), \{/)
  assert.match(workspace, /sqlcipher_paginated_40/)
  assert.match(workspace, /sqlcipher_union_paginated_40/)
  assert.match(workspace, /sqlcipher_explicit_project_paginated_40/)
  assert.match(workspace, /sqlcipher_explicit_project_union_paginated_40/)
  assert.doesNotMatch(workspace, /this\.state\.(?:tasks|graph\.(?:entities|relations))/)
  assert.match(taskPage, /listProjectTaskPage\(/)
  assert.match(riskPage, /listProjectRiskPage\(/)
  assert.match(taskPage, /explicitProjectOnly: Boolean\(derivedProject\)/)
  assert.match(riskPage, /explicitProjectOnly: Boolean\(derivedProject\)/)
  assert.doesNotMatch(taskPage, /this\.state\.tasks|buildProjectInsight|paginateProjectTasks/)
  assert.doesNotMatch(riskPage, /this\.state\.tasks|buildProjectInsight|paginateProjectRisks/)
  assert.match(taskPage, /nextOffset: offset/)
  assert.match(riskPage, /nextOffset: offset/)

  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /offset: Number\(project\.taskOffset \|\| project\.tasks\?\.length \|\| 0\)/)
  assert.match(page, /taskOffset: page\.nextOffset/)
  assert.match(page, /offset: Number\(project\.riskOffset \|\| project\.risks\?\.length \|\| 0\)/)
  assert.match(page, /riskOffset: page\.nextOffset/)
  assert.match(page, /SQLCipher 按项目名与已确认别名直接筛选、计数和分页/)
})

test('the complete project directory is counted and paged inside SQLCipher', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const directoryStart = service.indexOf('getProjectDirectory(options: any = {})')
  const dashboardStart = service.indexOf('\n  getDashboard()', directoryStart)
  const directory = service.slice(directoryStart, dashboardStart)
  const dashboardEnd = service.indexOf('\n  getTaskWorkspace(', dashboardStart)
  const dashboard = service.slice(dashboardStart, dashboardEnd)
  assert.match(directory, /personalMemoryStore\.listProjectDirectoryPage\(/)
  assert.doesNotMatch(directory, /buildProjectDirectory|paginateProjectDirectory|this\.state\.tasks/)
  assert.match(directory, /nextOffset: offset/)
  assert.match(service, /getProjectDirectoryCount\(revision: string\)[\s\S]*?personalMemoryStore\.countProjectDirectory\(\)/)
  assert.match(dashboard, /this\.getProjectDirectoryCount\(projectRevision\)/)
  assert.doesNotMatch(dashboard, /countProjectDirectory\(\{/)
  assert.match(dashboard, /sqlcipher_paginated_on_demand/)
  assert.match(dashboard, /sqlcipher_distinct_trusted_and_derived/)
  assert.match(dashboard, /countCache:[\s\S]*?revisionBound: true/)

  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /offset: Number\(projectDirectory\.nextOffset \?\? projectDirectory\.items\.length\)/)
  assert.match(page, /nextOffset: result\.nextOffset/)
  assert.match(page, /项目总数、搜索、阶段、进度、风险和候选计数均在 SQLCipher 内完成/)
})
