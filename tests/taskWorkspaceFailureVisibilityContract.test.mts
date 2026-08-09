import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/pages/AiAssistantPage.scss', import.meta.url), 'utf8')

test('active task and calendar failures remain distinct from authoritative empty results', () => {
  assert.match(page, /error\?: string[\s\S]*taskWorksetLoadingMore/)
  assert.match(page, /当前行动读取失败/)
  assert.match(page, /本月任务读取失败/)
  assert.match(page, /!taskWorkset\.error && displayedTasks\.length === 0/)
  assert.match(page, /taskView === 'calendar' && \(taskCalendarPage\.error/)
  assert.match(page, /不会把读取失败显示成“本月 0 项”/)
  assert.match(page, /setTaskCalendarRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /setTaskWorksetRefreshKey\(value => value \+ 1\)/)
  assert.match(styles, /\.assistant-task-load-failure \{/)
})

test('failed task continuation preserves the successful prefix and supports an exact retry', () => {
  assert.match(page, /catch \(error: any\) \{[\s\S]*setTaskWorkset\(current => \(\{[\s\S]*\.\.\.current,[\s\S]*error:/)
  assert.match(page, /已成功加载的.*仍可使用，但不会声称已读完/)
  assert.match(page, /if \(taskWorkset\.items\.length\) void loadMoreActiveTasks\(\)/)
})
