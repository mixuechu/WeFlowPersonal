import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('graph review load failures remain distinct from an authoritative empty queue', () => {
  assert.match(page, /reviewPage\.status === 'error'[\s\S]*审阅记录读取失败/)
  assert.match(page, /reviewPage\.status === 'ready' && !visibleReviews\.length/)
  assert.match(page, /当前不会把读取失败解释为“没有待处理候选”/)
  assert.match(page, /else setReviewRefreshKey\(value => value \+ 1\)/)
})

test('graph review continuation failures preserve and retry the successful prefix', () => {
  assert.match(page, /setReviewPage\(current => \(\{ \.\.\.current, status: 'error', error:/)
  assert.match(page, /已加载的.*条仍可处理，但当前尚未读完/)
  assert.match(page, /if \(visibleReviews\.length\) void loadMoreReviews\(\)/)
  assert.match(page, /reviewPage\.items\.length,[\s\S]*revision: reviewPage\.revision/)
})
