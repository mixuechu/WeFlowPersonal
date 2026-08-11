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

test('memory search facets stay in SQLCipher instead of materializing one id set per facet', () => {
  assert.ok(pageStart > 0 && pageEnd > pageStart)
  assert.equal((page.match(/listScopedSearchDocumentIds\(/g) || []).length, 1)
  assert.ok((page.match(/countSearchDocumentsInScope\(/g) || []).length >= 4)
  assert.doesNotMatch(page, /facetAllowedIds|trustFacetAllowedIds|supportFacetAllowedIds|conflictFacetAllowedIds/)
})

test('hybrid paging reuses the already authorized primary scope', () => {
  assert.match(page, /searchMemoryHybrid\([\s\S]*?\{ allowedIds \}\s*\)/)
})

test('scope planning is honest and visible in complete diagnostics', () => {
  assert.match(store, /memorySearchScopePlanning:\s*\{[\s\S]*?facetStrategy: 'sqlcipher_direct_count'[\s\S]*?facetIdentityMaterializations: 0[\s\S]*?primaryScopeStrategy: 'single_shared_identity_set'[\s\S]*?hybridScopeReused: true/)
  assert.match(pageSource, /检索范围执行策略[\s\S]*?SQLCipher 直接计数[\s\S]*?主检索范围 <b>单份复用/)
})
