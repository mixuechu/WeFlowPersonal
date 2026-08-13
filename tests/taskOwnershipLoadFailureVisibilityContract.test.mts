import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('ownership review failures stay visible even when the previous total was zero', () => {
  assert.match(page, /taskOwnershipReviews\.total > 0 \|\| taskOwnershipReviews\.loading \|\| taskOwnershipReviews\.error/)
  assert.match(page, /待办归属审阅读取失败/)
  assert.match(page, /当前不会把失败解释为“没有待确认归属”/)
  assert.match(page, /!taskOwnershipReviews\.loading && !taskOwnershipReviews\.error && !taskReviewQueue\.length/)
  assert.match(page, /taskOwnershipReviews\.error && !taskReviewQueue\.length[\s\S]*'读取失败'/)
})

test('ownership continuation failures retain candidates and retry the same revision', () => {
  assert.match(page, /setTaskOwnershipReviews\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*项仍可审阅，但当前候选目录尚未读完/)
  assert.match(page, /if \(taskReviewQueue\.length\) void loadMoreTaskOwnershipReviews\(\)/)
  assert.match(page, /offset: taskOwnershipReviews\.items\.length,[\s\S]*revision: taskOwnershipReviews\.revision/)
  assert.match(page, /taskOwnershipReviews\.hasMore && !taskOwnershipReviews\.error/)
})
