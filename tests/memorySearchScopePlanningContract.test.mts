import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const service = readFileSync(join(process.cwd(), 'electron/services/aiAssistantService.ts'), 'utf8')
const store = readFileSync(join(process.cwd(), 'electron/services/personalMemoryStore.ts'), 'utf8')
const pageSource = readFileSync(join(process.cwd(), 'src/pages/AiAssistantPage.tsx'), 'utf8')
const pageStart = service.indexOf('  async searchMemoryPage(')
const pageEnd = service.indexOf('\n  getMemoryEvidencePage(', pageStart)
const page = service.slice(pageStart, pageEnd)
const questionStart = service.indexOf('  private async runMemoryQuestion(')
const questionEnd = service.indexOf('\n  private ', questionStart + 10)
const question = service.slice(questionStart, questionEnd)

test('memory search facets stay in SQLCipher instead of materializing one id set per facet', () => {
  assert.ok(pageStart > 0 && pageEnd > pageStart)
  assert.equal((page.match(/listScopedSearchDocumentIds\(/g) || []).length, 0)
  assert.equal((page.match(/createSearchDocumentScope\(/g) || []).length, 1)
  assert.equal((page.match(/releaseSearchDocumentScope\(/g) || []).length, 1)
  assert.ok((page.match(/countSearchDocumentsInScope\(/g) || []).length >= 4)
  assert.doesNotMatch(page, /facetAllowedIds|trustFacetAllowedIds|supportFacetAllowedIds|conflictFacetAllowedIds/)
})

test('hybrid paging reuses the already authorized primary scope', () => {
  assert.match(page, /searchMemoryHybrid\([\s\S]*?\{ allowedIds \}\s*\)/)
})

test('evidence Q&A reuses one SQLCipher scope across planning branches and releases it before model I/O', () => {
  assert.ok(questionStart > 0 && questionEnd > questionStart)
  assert.equal((question.match(/listScopedSearchDocumentIds\(/g) || []).length, 0)
  assert.equal((question.match(/createSearchDocumentScope\(/g) || []).length, 1)
  assert.equal((question.match(/releaseSearchDocumentScope\(/g) || []).length, 1)
  assert.ok((question.match(/\{ allowedIds: plannedScope \}/g) || []).length >= 2)
  assert.match(question, /findGraphPath\([\s\S]*?plannedScope/)
  assert.match(store, /findRelationPathInScope\([\s\S]*?WITH RECURSIVE eligible_edges/)
  assert.doesNotMatch(question, /new Set\(scopedRelationIds\)|listSearchDocumentSourceIdsInScope/)
  assert.ok(
    question.indexOf('releaseSearchDocumentScope(plannedScope)')
      < question.indexOf('runWithMemoryScopeRevalidation(')
  )
})

test('scope planning is honest and visible in complete diagnostics', () => {
  assert.match(store, /memorySearchScopePlanning:\s*\{[\s\S]*?version: 4[\s\S]*?facetStrategy: 'sqlcipher_direct_count'[\s\S]*?facetIdentityMaterializations: 0[\s\S]*?primaryScopeStrategy: 'sqlcipher_isolated_temp_table'[\s\S]*?primaryIdentityMaterializations: 0[\s\S]*?hybridScopeReused: true[\s\S]*?releasedAfterRequest: true[\s\S]*?handleOnlyScopeApi: true[\s\S]*?legacySharedScopeRemoved: true[\s\S]*?scopedGraphPathStrategy: 'sqlcipher_recursive_cte'[\s\S]*?scopedGraphRelationIdentityMaterializations: 0/)
  assert.doesNotMatch(store, /replaceActiveSearchScope|CREATE TEMP TABLE IF NOT EXISTS active_memory_search_scope\s*\(/)
  assert.doesNotMatch(store, /type SearchDocumentScope\s*=\s*Set/)
  assert.match(pageSource, /检索范围执行策略[\s\S]*?SQLCipher 直接计数[\s\S]*?主检索范围 <b>SQLCipher 临时范围[\s\S]*?旧共享范围[\s\S]*?已移除[\s\S]*?范围内图路径[\s\S]*?SQLCipher 最短路径[\s\S]*?关系 ID 集合/)
})
