import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const openStart = page.indexOf('  const openMemoryEvidenceArchive = async (')
const openEnd = page.indexOf('\n  const closeMemoryEvidenceArchive', openStart)
const openArchive = page.slice(openStart, openEnd)
const moreStart = page.indexOf('  const loadMoreMemoryEvidence = async () =>')
const moreEnd = page.indexOf('\n  const openMemoryConversation', moreStart)
const loadMore = page.slice(moreStart, moreEnd)

test('evidence archive opening retries transient revision drift only within a fixed bound', () => {
  assert.ok(openStart >= 0 && openEnd > openStart)
  assert.match(openArchive, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(openArchive, /250 \* \(attempt \+ 1\)/)
  assert.match(openArchive, /三次重新读取仍未获得一致快照/)
  assert.doesNotMatch(openArchive, /void openMemoryEvidenceArchive\(/)
})

test('evidence archive retries retain the original authority snapshot', () => {
  assert.match(openArchive, /openingSnapshot,[\s\S]*status: 'loading'/)
  assert.match(openArchive, /expectedSearchRevision: openingSnapshot\.searchRevision/)
  assert.match(openArchive, /expectedContentHash: openingSnapshot\.contentHash/)
  assert.match(openArchive, /expectedEvidenceAuthorityRevision: openingSnapshot\.evidenceAuthorityRevision/)
  assert.match(page, /memoryEvidenceArchive\.status === 'error'[\s\S]*memoryEvidenceArchive\.openingSnapshot/)
  assert.match(loadMore, /archive\.filters,[\s\S]*archive\.openingSnapshot/)
})

test('evidence continuation failures preserve the loaded prefix and exact continuation', () => {
  assert.match(loadMore, /setMemoryEvidenceArchive\(current => current \? \{ \.\.\.current, loadMoreError: undefined \}/)
  assert.match(loadMore, /\? \{ \.\.\.current, loadMoreError: error\?\.message \|\| String\(error\) \}/)
  assert.match(page, /memoryEvidenceArchive\.loadMoreError &&[\s\S]*更早证据尚未读完/)
  assert.match(page, /已加载的证据保持不变/)
  assert.match(page, /重试加载更早证据/)
  assert.match(page, /memoryEvidenceArchive\.hasMore &&[\s\S]*!memoryEvidenceArchive\.loadMoreError/)
})

test('stale evidence continuation releases loading before starting a replacement request', () => {
  assert.match(loadMore, /if \(page\.stale\)[\s\S]*setMemoryEvidenceLoadingMore\(false\)[\s\S]*void openMemoryEvidenceArchive/)
})

test('answer review history uses bounded snapshot retries and an actionable error state', () => {
  const historyStart = page.indexOf('  const loadAssistantAnswerReviewHistory = async (')
  const historyEnd = page.indexOf('\n  const toggleAssistantAnswerReviewHistory', historyStart)
  const history = page.slice(historyStart, historyEnd)
  assert.match(history, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(history, /三次重新读取仍未获得一致快照/)
  assert.doesNotMatch(history, /void loadAssistantAnswerReviewHistory\(/)
  assert.match(page, /回答处理记录读取失败/)
  assert.match(page, /当前不会把读取失败解释为没有处理记录/)
  assert.match(page, /loadMoreAssistantAnswerReviewHistory\(item\.message_id\)[\s\S]*loadAssistantAnswerReviewHistory\(item\.message_id\)/)
})

test('answer review continuation failures retain their prefix and do not duplicate retry controls', () => {
  const moreStart = page.indexOf('  const loadMoreAssistantAnswerReviewHistory = async (')
  const moreEnd = page.indexOf('\n  const loadOlderAssistantMessages', moreStart)
  const more = page.slice(moreStart, moreEnd)
  assert.match(more, /loading: true, error: undefined/)
  assert.match(more, /\.\.\.current\[messageId\],[\s\S]*loading: false,[\s\S]*error:/)
  assert.match(page, /更早处理记录尚未读完/)
  assert.match(page, /!assistantAnswerReviewHistories\[item\.message_id\]\.error && <button/)
})
