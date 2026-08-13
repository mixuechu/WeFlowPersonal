import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('ownership feedback archive distinguishes loading, empty and failure states', () => {
  assert.match(page, /归属反馈档案读取失败/)
  assert.match(page, /当前不会把失败解释为“没有反馈记录”/)
  assert.match(page, /!taskFeedbackArchive\.loading && !taskFeedbackArchive\.error && !taskFeedbackArchive\.items\.length/)
  assert.match(page, /taskFeedbackArchive\.error && !taskFeedbackArchive\.items\.length[\s\S]*'读取失败'/)
  assert.match(page, /!taskFeedbackArchive\.error && <small>/)
})

test('ownership feedback continuation failures preserve reversible history', () => {
  assert.match(page, /setTaskFeedbackArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*条仍可核验或撤销，但当前档案尚未读完/)
  assert.match(page, /if \(taskFeedbackArchive\.items\.length\) void loadMoreTaskFeedback\(\)/)
  assert.match(page, /offset: taskFeedbackArchive\.items\.length,[\s\S]*revision: taskFeedbackArchive\.revision/)
  assert.match(page, /taskFeedbackArchive\.hasMore && !taskFeedbackArchive\.error/)
})
