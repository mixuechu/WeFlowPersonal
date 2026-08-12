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

test('invalid date ranges stop search and memory Q&A before retrieval', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  const types = read('src/types/electron.d.ts')
  const searchStart = service.indexOf('async searchMemoryPage(')
  const dateValidation = service.indexOf(
    'validateShanghaiDateRange(options.from, options.to)', searchStart
  )
  const scopeCreation = service.indexOf(
    'personalMemoryStore.createSearchDocumentScope(scopedOptions)', searchStart
  )
  assert.ok(searchStart >= 0 && dateValidation > searchStart && scopeCreation > dateValidation)
  assert.match(service, /dateScopeInvalid: true,[\s\S]*?dateScopeInvalidReason: dateRange\.reason/)
  assert.match(service, /async askMemory\([\s\S]*?this\.assertValidMemorySearchDateRange\(options\)[\s\S]*?this\.runMemoryQuestion/)
  assert.match(service, /async searchMemoryWithTrustedScope\([\s\S]*?this\.assertValidMemorySearchDateRange\(options\)[\s\S]*?runWithMemoryScopeRevalidation/)
  assert.match(service, /this\.assertValidMemorySearchDateRange\(plannedOptions\)[\s\S]*?createSearchDocumentScope\(scopeAuditOptions\)/)
  assert.match(page, /if \(page\.dateScopeInvalid\)[\s\S]*?开始日期不能晚于结束日期/)
  assert.match(types, /dateScopeInvalidReason\?: 'invalid_from' \| 'invalid_to' \| 'reversed'/)
})
