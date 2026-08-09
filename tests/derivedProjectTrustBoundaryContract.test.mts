import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('derived projects never infer structured memory from a bounded recent feed', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const start = service.indexOf('getProjectWorkspace(projectId: string)')
  const end = service.indexOf('\n  getDashboard()', start)
  const implementation = service.slice(start, end)
  assert.doesNotMatch(implementation, /getMemoryFeed\(/)
  assert.match(implementation, /: \{ claims: \[\], events: \[\] \}/)
  assert.match(implementation, /task_field_only_until_entity_confirmed/)
  assert.match(implementation, /blocked_until_entity_confirmed/)
})

test('the project dossier explains the trust boundary before showing structured memory', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /只展示明确写入待办“项目”字段的任务、进度和风险/)
  assert.match(page, /不会按名称猜测并吸收事实、关系或事件/)
})
