import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('task dependency candidates distinguish failed loading from no matches', () => {
  assert.match(page, /可依赖任务读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有匹配的可依赖任务”/)
  assert.match(page, /!taskDependencyCandidates\.loading && !taskDependencyCandidates\.error/)
  assert.match(page, /候选读取失败，匹配总数未知/)
  assert.match(page, /setTaskDependencyRefreshKey\(value => value \+ 1\)/)
})

test('closed-task project directory exposes independent failure and retry state', () => {
  assert.match(page, /历史任务项目目录读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有历史项目”/)
  assert.match(page, /taskArchiveProjects\.error[\s\S]*'读取失败，匹配项目数未知'/)
  assert.match(page, /setTaskArchiveProjectRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /taskArchiveRefreshKey, taskArchiveProjectRefreshKey/)
})
