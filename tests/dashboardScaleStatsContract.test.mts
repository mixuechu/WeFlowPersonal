import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('dashboard graph and weekly task totals are revision-cached SQLCipher statistics', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const start = service.indexOf('getDashboard(): any')
  const end = service.indexOf('\n  getTaskWorkspace(', start)
  const dashboard = service.slice(start, end)
  assert.match(dashboard, /personalMemoryStore\.getDashboardScaleStats\(\)/)
  assert.match(dashboard, /previousScaleStats\?\.revision === dashboardScaleRevision/)
  assert.match(dashboard, /buildWeeklyBriefing\(this\.state\.briefings, \[\], new Date\(\), dashboardScaleStats\.tasks\)/)
  assert.doesNotMatch(dashboard, /this\.state\.tasks\.filter/)
  assert.doesNotMatch(dashboard, /graph\.entities\.filter/)
  assert.doesNotMatch(dashboard, /graph\.relations\.filter/)
  assert.match(dashboard, /authority: 'sqlcipher_revision_cached'/)

  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /首页图谱总量与周简报任务计数由 SQLCipher 权威聚合/)
  assert.match(page, /不再随每次首页刷新遍历完整图谱和任务集合/)
})

test('dashboard scale query retains the exact product semantics', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const start = store.indexOf('getDashboardScaleStats():')
  const end = store.indexOf('\n  getEntityEvidenceAuthorityStats()', start)
  const method = store.slice(start, end)
  assert.match(method, /entities WHERE trust_status<>'rejected'/)
  assert.match(method, /relations WHERE status<>'rejected'/)
  assert.match(method, /classification='mine' AND status NOT IN \('done','cancelled'\)/)
  assert.match(method, /status='waiting' OR task_kind='waiting'/)
  assert.match(method, /priority='high'/)
})
