import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('stale task dependency and project directories cannot remain permanently loading', () => {
  assert.match(page, /if \(result\.stale\) \{[\s\S]*setTaskDependencyCandidates\(\{[\s\S]*loading: false,[\s\S]*可依赖任务目录在读取期间发生了变化/)
  assert.match(page, /if \(result\.stale\) \{[\s\S]*setTaskArchiveProjects\(\{[\s\S]*loading: false,[\s\S]*历史项目目录在读取期间发生了变化/)
  assert.match(page, /可依赖任务读取失败[\s\S]*setTaskDependencyRefreshKey/)
  assert.match(page, /历史任务项目目录读取失败[\s\S]*setTaskArchiveProjectRefreshKey/)
})

test('stale entity growth first page becomes a visible retryable failure', () => {
  assert.match(page, /setEntityMemoryGrowth\(\{[\s\S]*status: 'error',[\s\S]*人物成长记录在读取期间发生了变化/)
  assert.match(page, /人物成长记录读取失败[\s\S]*当前不会把读取失败解释为没有成长记录/)
  assert.match(page, /setEntityMemoryGrowthRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /entityMemoryGrowthRefreshKey\s*\]/)
})

test('entity growth continuation failure preserves its prefix and offers the correct recovery direction', () => {
  const start = page.indexOf('  const loadMoreEntityMemoryGrowth = async () =>')
  const end = page.indexOf('\n  const loadMoreIngestionRuns', start)
  const loader = page.slice(start, end)
  assert.match(loader, /loadMoreError: undefined, stale: false/)
  assert.match(loader, /stale: true,[\s\S]*loadMoreError: '人物成长记录在翻页期间发生了变化/)
  assert.match(loader, /\.\.\.current, loadMoreError: errorMessage/)
  assert.doesNotMatch(loader, /items: \[\], status: 'loading'/)
  assert.match(page, /更早成长记录尚未读完[\s\S]*已加载的成长记录保持不变/)
  assert.match(page, /entityMemoryGrowth\.stale \? '从最新第一页重新加载' : '重试加载更早记录'/)
})
