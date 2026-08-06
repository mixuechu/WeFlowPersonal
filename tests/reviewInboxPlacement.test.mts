import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)

test('review inbox is near the page entrance and every target has one durable anchor', () => {
  const inbox = source.indexOf('id="review-inbox"')
  const taskArchive = source.indexOf('<h3>已关闭任务档案</h3>')
  assert.ok(inbox >= 0)
  assert.ok(taskArchive > inbox)
  for (const id of [
    'task-ownership-review',
    'memory-search',
    'structured-claims',
    'event-timeline',
    'graph-review-ledger'
  ]) {
    assert.equal(source.split(`id="${id}"`).length - 1, 1, `${id} anchor must be unique`)
  }
})
