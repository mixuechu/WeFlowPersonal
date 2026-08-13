import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('briefing continuation is guarded against late responses', () => {
  const start = page.indexOf('const loadMoreBriefingArchive = async () => {')
  const end = page.indexOf('const refreshDashboardAfterCommittedAction =', start)
  const loader = page.slice(start, end)

  assert.match(loader, /const request = briefingArchiveGate\.current\.begin\(\)/)
  assert.match(loader, /if \(!briefingArchiveGate\.current\.isCurrent\(request\)\) return/)
  assert.match(loader, /finally \{[\s\S]*briefingArchiveGate\.current\.isCurrent\(request\)/)
})

test('briefing continuation failures preserve the loaded prefix and exact retry', () => {
  const start = page.indexOf('const loadMoreBriefingArchive = async () => {')
  const end = page.indexOf('const refreshDashboardAfterCommittedAction =', start)
  const loader = page.slice(start, end)

  assert.match(loader, /catch \(error\) \{[\s\S]*\.\.\.current,[\s\S]*loadMoreError:/)
  assert.doesNotMatch(loader, /catch \(error\) \{[\s\S]*status: 'error'/)
  assert.match(page, /briefingArchive\.loadMoreError[\s\S]*已加载的 \{briefingArchive\.items\.length\} 天仍可查看/)
  assert.match(page, /重试加载更早简报/)
  assert.match(page, /briefingArchive\.hasMore && !briefingArchive\.loadMoreError/)
})

test('resource archive first-page errors have an in-place retry', () => {
  assert.match(page, /资源目录读取失败：\{resourceArchive\.error\}[\s\S]*setResourceRefreshKey\(value => value \+ 1\)/)
})
