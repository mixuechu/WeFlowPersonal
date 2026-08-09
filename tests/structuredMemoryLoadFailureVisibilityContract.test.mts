import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('claim and event archives distinguish loading, authoritative empty and failed states', () => {
  assert.match(page, /setClaimArchive\(current => \(\{ \.\.\.current, items: \[\], loading: true, error: undefined \}\)\)/)
  assert.match(page, /setEventTimeline\(current => \(\{ \.\.\.current, items: \[\], loading: true, error: undefined \}\)\)/)
  assert.match(page, /事实档案读取失败/)
  assert.match(page, /事件时间线读取失败/)
  assert.match(page, /!claimArchive\.error && !visibleClaims\.length/)
  assert.match(page, /!eventTimeline\.error && !visibleEvents\.length/)
  assert.match(page, /eventTimeline\.loading[\s\S]*正在读取事件时间线/)
  assert.match(page, /claimArchive\.error && !visibleClaims\.length[\s\S]*'读取失败'/)
  assert.match(page, /eventTimeline\.error && !visibleEvents\.length[\s\S]*'读取失败'/)
})

test('structured memory continuation failures preserve successful prefixes and retry the same scope', () => {
  assert.match(page, /setClaimArchive\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /setEventTimeline\(current => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*条仍可审阅，但当前尚未读完/)
  assert.match(page, /已加载的.*项仍可审阅，但当前尚未读完/)
  assert.match(page, /if \(visibleClaims\.length\) void loadMoreClaims\(\)/)
  assert.match(page, /if \(visibleEvents\.length\) void loadMoreEvents\(\)/)
  assert.match(page, /claimArchive\.hasMore && !claimArchive\.error/)
  assert.match(page, /eventTimeline\.hasMore && !eventTimeline\.error/)
})
