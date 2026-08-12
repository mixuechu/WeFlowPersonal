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

test('memory search continuation binds the original query and complete scope', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  const types = read('src/types/electron.d.ts')
  assert.match(service, /const pageScopeToken = buildMemorySearchPageScopeToken\(text, scopedOptions, searchMode\)/)
  assert.match(service, /if \(offset > 0 && expectedPageScopeToken !== pageScopeToken\)/)
  assert.match(service, /pageScopeStale: true, pageScopeToken/)
  assert.match(page, /pageScopeToken: memorySearchState\.pageScopeToken/)
  assert.match(page, /page\.pageScopeStale[\s\S]*?避免混合两次查询/)
  assert.match(types, /pageScopeStale\?: boolean/)
})

test('memory and graph-review evidence continuations bind every archive filter', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  const types = read('src/types/electron.d.ts')
  assert.match(service, /buildMemoryEvidenceArchiveScopeToken\(\s*'memory'/)
  assert.match(service, /buildMemoryEvidenceArchiveScopeToken\(\s*'graph_review'/)
  assert.match(service, /offset > 0 && String\([^)]*evidenceScopeToken/)
  assert.match(service, /evidenceScopeStale: true,[\s\S]*?evidenceScopeToken/)
  assert.match(page, /evidenceScopeToken: archive\.evidenceScopeToken/)
  assert.match(page, /page\.evidenceScopeStale[\s\S]*?避免混合两组证据/)
  assert.match(types, /evidenceScopeStale\?: boolean/)
})

test('graph review directory continuation binds the complete candidate scope', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  const types = read('src/types/electron.d.ts')
  assert.match(service, /const reviewScope = buildGraphReviewPageScopeToken\(options \|\| \{\}\)/)
  assert.match(service, /offset > 0 && String\([^)]*reviewScopeToken/)
  assert.match(service, /reviewScopeStale: true,[\s\S]*?reviewScopeToken/)
  assert.match(page, /reviewScopeToken: reviewPage\.reviewScopeToken/)
  assert.match(page, /page\.reviewScopeStale[\s\S]*?避免混合不同候选队列/)
  assert.match(types, /reviewScopeStale\?: boolean/)
})

test('inline graph-review evidence carries the archive scope token across pages', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  const methodStart = page.indexOf('const loadReviewEvidence = async')
  const methodEnd = page.indexOf('\n  const updateMemoryStatus', methodStart)
  const method = page.slice(methodStart, methodEnd)
  assert.match(method, /evidenceScopeToken: loadMore \? current\?\.evidenceScopeToken : undefined/)
  assert.match(method, /if \(page\.evidenceScopeStale\)[\s\S]*?loadReviewEvidence\(reviewId, false\)/)
  assert.match(method, /审阅原文或候选状态已有变化[\s\S]*?setReviewRefreshKey/)
})

test('trusted entity directory continuation binds the original lookup scope', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  const types = read('src/types/electron.d.ts')
  assert.match(service, /const directoryScopeToken = buildTrustedEntityDirectoryScopeToken\(options\)/)
  assert.match(service, /offset > 0 && String\([^)]*directoryScopeToken/)
  assert.match(service, /directoryScopeStale: true, directoryScopeToken/)
  assert.match(page, /expectedRevision: revision,[\s\S]*?directoryScopeToken/)
  assert.match(types, /directoryScopeStale\?: boolean/)
})
