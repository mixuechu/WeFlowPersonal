import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL(
  '../electron/services/aiAssistantService.ts', import.meta.url
), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('every task directory and renderer mutation fails closed without a current token', () => {
  for (const [startMarker, endMarker] of [
    ['  getTaskArchive(', '\n  getTaskArchiveProjects('],
    ['  getActiveTaskWorkset(', '\n  getTaskCalendarPage('],
    ['  getTaskCalendarPage(', '\n  getTaskOwnershipReviews(']
  ]) {
    const start = service.indexOf(startMarker)
    const end = service.indexOf(endMarker, start)
    const method = service.slice(start, end)
    assert.match(method, /mutationToken: task \? buildTaskMutationToken\(task\) : undefined/)
    assert.match(method, /sqlcipher_history_read_only/)
  }

  assert.match(page, /disabled=\{!task\.mutationToken\}/)
  assert.match(page, /SQLCipher 权威记录 · 当前只读/)
  assert.match(page, /不能直接恢复/)
  assert.match(page, /Boolean\(task\.mutationToken\)/)
  assert.match(page, /task\.mutationToken && <button onClick=\{\(\) => setEditingTask/)
  assert.match(page, /disabled=\{!displayedTasks\.some\(task =>[\s\S]*?Boolean\(task\.mutationToken\)\)\}/)
})
