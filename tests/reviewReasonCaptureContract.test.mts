import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('fixed review reasons cross renderer, preload, IPC and store boundaries', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  const preload = read('electron/preload.ts')
  const main = read('electron/main.ts')
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')

  assert.match(page, /aria-label="不准确的具体原因"/)
  assert.match(page, /REVIEW_REASON_LABELS/)
  assert.match(page, /只统计固定原因代码和数量，不保存自由文本、姓名或聊天原文/)
  for (const boundary of [preload, main, service]) {
    assert.match(boundary, /reasonCode/)
  }
  assert.match(store, /normalizeReviewReasonCode\('task'/)
  assert.match(store, /normalizeReviewReasonCode\('memory'/)
  assert.match(store, /normalizeReviewReasonCode\('graph'/)
  assert.match(store, /normalizeReviewReasonCode\('identity'/)
  assert.match(store, /human-review-calibration-v9/)
  assert.doesNotMatch(store, /rejection_reason_text/i)
})
