import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('asynchronous memory entity scope selection rejects late responses', () => {
  const start = page.indexOf('const selectMemoryEntityScope = async (')
  const end = page.indexOf('const loadMoreMemoryResults = async () => {', start)
  const select = page.slice(start, end)

  assert.match(page, /const memoryEntityScopeGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(select, /const request = memoryEntityScopeGate\.current\.begin\(\)/)
  assert.match(select, /if \(!memoryEntityScopeGate\.current\.isCurrent\(request\)\) return/)
  assert.ok(
    select.indexOf('if (!memoryEntityScopeGate.current.isCurrent(request)) return') <
      select.indexOf('setMemoryEntitySelection({ ...entity, directoryRevision: result.revision })')
  )
})

test('entity scope lookup failures are contained and visible', () => {
  const start = page.indexOf('const selectMemoryEntityScope = async (')
  const end = page.indexOf('const loadMoreMemoryResults = async () => {', start)
  const select = page.slice(start, end)

  assert.match(select, /catch \(error: any\)/)
  assert.match(select, /实体范围读取失败：/)
  assert.match(select, /fallbackName \|\| id/)
})

test('direct selection, clear and authoritative invalidation cancel pending scope lookup', () => {
  assert.match(page, /onSelect=\{entity => \{\s*memoryEntityScopeGate\.current\.invalidate\(\)/)
  assert.match(page, /onClear=\{\(\) => \{\s*memoryEntityScopeGate\.current\.invalidate\(\)/)
  assert.match(page, /if \(page\.entityScopeStale\) \{\s*memoryEntityScopeGate\.current\.invalidate\(\)/)
  assert.match(page, /memorySearchGate\.current\.invalidate\(\)\s*memoryEntityScopeGate\.current\.invalidate\(\)\s*setMemoryQuery\(plan\.query\)/)
})
