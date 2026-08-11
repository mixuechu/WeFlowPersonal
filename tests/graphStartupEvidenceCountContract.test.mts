import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('graph startup counts ordinary identity evidence directly and recurses only for active merges', () => {
  const store = read('electron/services/personalMemoryStore.ts')
  const start = store.indexOf('loadGraphSnapshot(): MemoryGraph')
  const end = store.indexOf('\n  getGraphSnapshotHydrationStats()', start)
  const hydration = store.slice(start, end)
  assert.match(hydration, /direct_counts\(root_id,evidence_total\)/)
  assert.match(hydration, /NOT EXISTS \(\s*SELECT 1 FROM merged_roots/)
  assert.match(hydration, /merged_scope\(root_id,entity_id\)/)
  assert.match(hydration, /idx_entity_evidence_entity_time/)
  assert.match(hydration, /idx_merge_history_active_target/)
  assert.match(hydration, /fixed_eight_queries_direct_counts_merge_exception_only/)
  assert.doesNotMatch(hydration, /SELECT id,id FROM entities WHERE deleted_at IS NULL/)

  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /只有确实存在有效身份合并链的人物才进入递归去重/)
  assert.match(page, /普通人物不会再为不存在的合并关系参与全量递归分组/)
})
