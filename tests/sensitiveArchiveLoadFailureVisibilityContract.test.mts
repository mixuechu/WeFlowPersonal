import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('model request audit distinguishes first-page and continuation failures', () => {
  assert.match(page, /模型发送审计读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有模型发送记录”/)
  assert.match(page, /!modelRequestAudits\.loading && !modelRequestAudits\.error/)
  assert.match(page, /更早模型发送记录尚未读完/)
  assert.match(page, /已加载的记录继续保留/)
  assert.match(page, /setModelRequestAuditRefreshKey\(value => value \+ 1\)/)
})

test('answer review archive preserves loaded prefix when a later page fails', () => {
  assert.match(page, /历史回答核验队列读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有待核验回答”/)
  assert.match(page, /!assistantAnswerReviews\.loading && !assistantAnswerReviews\.error/)
  assert.match(page, /更多回答核验记录尚未读完/)
  assert.match(page, /已加载的核验记录继续保留/)
  assert.match(page, /setAssistantAnswerReviewRevision\(value => value \+ 1\)/)
})

test('merge history keeps failures distinct from an empty identity archive', () => {
  assert.match(page, /身份合并档案读取失败/)
  assert.match(page, /当前不会把读取故障解释为“没有身份合并记录”/)
  assert.match(page, /读取失败，统计未知/)
  assert.match(page, /!mergeArchive\.error && !mergeArchive\.items\.length/)
  assert.match(page, /身份合并档案尚未读完/)
  assert.match(page, /已加载的合并记录继续保留/)
  assert.match(page, /setMergeArchiveRefreshKey\(value => value \+ 1\)/)
})
