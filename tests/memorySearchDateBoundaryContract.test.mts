import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

test('all memory-search and briefing date scopes share one strict Shanghai parser', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const filters = read('electron/services/memorySearchFilters.ts')
  const briefing = read('electron/services/briefingIntelligence.ts')
  const navigation = read('src/utils/briefingMemorySearchNavigation.ts')
  for (const source of [store, filters, briefing, navigation]) {
    assert.match(source, /parseShanghaiDateBoundary/)
  }
  assert.ok((store.match(/parseShanghaiDateBoundary/g) || []).length >= 11)
  assert.doesNotMatch(store, /23:59:59\.999.*\+08:00/)
  assert.doesNotMatch(filters, /23:59:59\.999.*\+08:00/)
})
