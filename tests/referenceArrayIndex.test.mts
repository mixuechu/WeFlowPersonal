import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ReferenceArrayIndex } from '../electron/services/referenceArrayIndex.ts'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('reference array index reuses one authority index and invalidates on replacement', () => {
  const cache = new ReferenceArrayIndex<{ id: string; title: string }>(item => item.id)
  const first = [{ id: 'a', title: '初始' }, { id: 'b', title: '第二项' }]
  const firstIndex = cache.get(first)
  assert.equal(firstIndex.get('a'), first[0])
  assert.equal(cache.get(first), firstIndex)
  assert.deepEqual(cache.stats(first), { builds: 1, indexedItems: 2, current: true })

  first[0].title = '原对象已更新'
  assert.equal(cache.get(first).get('a')?.title, '原对象已更新')
  assert.equal(cache.stats(first).builds, 1)

  const replacement = [{ id: 'b', title: '替换后' }, { id: 'c', title: '新增' }]
  const replacementIndex = cache.get(replacement)
  assert.notEqual(replacementIndex, firstIndex)
  assert.equal(replacementIndex.has('a'), false)
  assert.equal(replacementIndex.get('c'), replacement[1])
  assert.deepEqual(cache.stats(replacement), { builds: 2, indexedItems: 2, current: true })
})

test('reference array index repairs an in-place length change', () => {
  const cache = new ReferenceArrayIndex<{ id: string }>(item => item.id)
  const items = [{ id: 'a' }, { id: 'b' }]
  cache.get(items)
  items.pop()
  assert.deepEqual(cache.stats(items), { builds: 1, indexedItems: 0, current: false })
  assert.deepEqual([...cache.get(items).keys()], ['a'])
  assert.deepEqual(cache.stats(items), { builds: 2, indexedItems: 1, current: true })
})

test('bounded task views reuse the authoritative task index instead of rebuilding it per page', () => {
  const methods = [
    'getTaskWorkspace', 'getTaskArchive', 'getActiveTaskWorkset', 'getTaskCalendarPage',
    'getGraphWorkspace', 'getEntityTaskPage', 'getProjectWorkspace', 'getProjectTaskPage',
    'inspectCrossStoreRecoveryAbandon'
  ]
  for (const method of methods) {
    const start = service.indexOf(
      method === 'inspectCrossStoreRecoveryAbandon' ? `  private ${method}(` : `  ${method}(`
    )
    assert.ok(start >= 0, `${method} should exist`)
    const remainder = service.slice(start + 3)
    const nextMethod = remainder.search(/\n  (?:private |public )?(?:async )?[A-Za-z][A-Za-z0-9_]*\(/)
    const end = nextMethod >= 0 ? start + 3 + nextMethod : service.length
    const body = service.slice(start, end)
    assert.match(body, /getTaskStateIndex\(\)/, `${method} should reuse the task index`)
    assert.doesNotMatch(body, /new Map\(this\.state\.tasks\.map/, `${method} must not rebuild every task id`)
  }
  assert.match(service, /mutationTokenLookup: 'cached_authoritative_state_index'[\s\S]*?perPageFullIndexBuilds: 0/)
  assert.doesNotMatch(service, /this\.state\.tasks\.(?:splice|unshift)\(/)
  const hydrationStart = service.indexOf('  private hydrateTaskEvidenceFromSql(')
  const hydrationEnd = service.indexOf('\n  private restoreActiveTaskEvidenceHotsets(', hydrationStart)
  const hydration = service.slice(hydrationStart, hydrationEnd)
  assert.match(hydration, /getTaskStateIndex\(\)/)
  assert.doesNotMatch(hydration, /this\.state\.tasks\.filter/)
  assert.match(page, /操作令牌索引[\s\S]*?跨页面复用[\s\S]*?单页全量重建/)
})
