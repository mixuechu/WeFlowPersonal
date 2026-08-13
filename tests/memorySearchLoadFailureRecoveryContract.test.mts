import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('unified search failure is actionable and distinct from no matching memory', () => {
  assert.match(page, /统一检索失败/)
  assert.match(page, /当前不会把失败解释为“没有找到相关记忆”/)
  assert.match(page, /memorySearchState\.status === 'ready' && !memoryResults\.length/)
  assert.match(page, /else setMemorySearchRefreshKey\(value => value \+ 1\)/)
})

test('search continuation failures preserve and retry the revision-bound result prefix', () => {
  assert.match(page, /setMemorySearchState\(current => \(\{ \.\.\.current, status: 'error', error:/)
  assert.match(page, /已加载的.*条结果仍可查看和核验，但当前结果集尚未读完/)
  assert.match(page, /if \(memoryResults\.length\) void loadMoreMemoryResults\(\)/)
  assert.match(page, /offset: Number\(memorySearchState\.nextOffset \?\? memoryResults\.length\),[\s\S]*revision: memorySearchState\.revision/)
  assert.match(page, /setMemorySearchState\(current => \(\{ \.\.\.current, status: 'ready', error: undefined \}\)\)/)
})
