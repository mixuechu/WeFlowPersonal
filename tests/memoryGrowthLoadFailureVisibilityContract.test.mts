import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('memory growth loading distinguishes failure from an authoritative empty ledger', () => {
  assert.match(page, /items: \[\], loading: true, error: undefined/)
  assert.match(page, /记忆成长记录读取失败/)
  assert.match(page, /当前不会把失败解释为“没有新增记忆”/)
  assert.match(page, /!memoryGrowth\.error && !memoryGrowth\.items\.length/)
  assert.match(page, /memoryGrowth\.error && !memoryGrowth\.items\.length[\s\S]*'读取失败'/)
})

test('memory growth continuation failures preserve and retry the same ledger page', () => {
  assert.match(page, /setMemoryGrowth\(\(current: any\) => \(\{ \.\.\.current, error: errorMessage \}\)\)/)
  assert.match(page, /已加载的.*条仍可核验，但当前尚未读完/)
  assert.match(page, /if \(memoryGrowth\.items\.length\) void loadMoreMemoryGrowth\(\)/)
  assert.match(page, /offset: memoryGrowth\.items\.length,[\s\S]*revision: memoryGrowth\.revision/)
  assert.match(page, /memoryGrowth\.hasMore && !memoryGrowth\.error/)
})
