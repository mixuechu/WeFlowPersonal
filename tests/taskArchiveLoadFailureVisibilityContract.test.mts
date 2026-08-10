import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('task archive distinguishes loading, authoritative empty and failure states', () => {
  assert.match(page, /setTaskArchive\(current => \(\{[\s\S]*items: \[\], loading: true, error: undefined/)
  assert.match(page, /历史任务档案读取失败/)
  assert.match(page, /当前不会把失败解释为“没有已关闭任务”/)
  assert.match(page, /!taskArchive\.error && !taskArchive\.items\.length/)
  assert.match(page, /taskArchive\.error && !taskArchive\.items\.length[\s\S]*'读取失败'/)
})

test('task archive continuation failures preserve the successful revision-bound prefix', () => {
  assert.match(page, /setTaskArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*项仍可查看或恢复，但当前档案尚未读完/)
  assert.match(page, /if \(taskArchive\.items\.length\) void loadMoreTaskArchive\(\)/)
  assert.match(page, /offset: taskArchive\.items\.length,[\s\S]*revision: taskArchive\.revision/)
  assert.match(page, /taskArchive\.hasMore && !taskArchive\.error/)
})
