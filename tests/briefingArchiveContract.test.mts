import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

test('briefing archive has one bounded service, IPC, preload and renderer path', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const main = read('electron/main.ts')
  const preload = read('electron/preload.ts')
  const types = read('src/types/electron.d.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(service, /getBriefingArchivePage\([\s\S]*?buildBriefingArchivePage\(this\.state\.briefings/)
  assert.match(service, /const latestBriefing = buildLatestBriefingFromState\(this\.state\.briefings\)/)
  assert.match(service, /briefing: latestBriefing/)
  assert.doesNotMatch(service, /briefing: latest \? \{ \.\.\.latest/)
  assert.match(main, /ai-assistant:getBriefingArchivePage/)
  assert.match(preload, /getBriefingArchivePage:[\s\S]*?ai-assistant:getBriefingArchivePage/)
  assert.match(types, /getBriefingArchivePage:/)
  assert.match(page, />90 天档案</)
  assert.match(page, /briefingArchive\.hasMore/)
  assert.match(page, /revision: briefingArchive\.revision/)
  assert.match(page, /page\.stale/)
  assert.match(page, /summaryEvidenceTruncated/)
  assert.match(page, /inspectBriefingDateInMemorySearch\(item\.date\)/)
  assert.match(page, />\s*查看该日完整记忆\s*</)
  assert.match(page, /setMemorySearchRefreshKey\(value => value \+ 1\)/)
  assert.match(page, /inspectBriefingDateInMemorySearch\(briefing\.date\)/)
  assert.equal((page.match(/查看该日完整记忆/g) || []).length, 3)
})
