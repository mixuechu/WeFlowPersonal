import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)
const preload = readFileSync(
  new URL('../electron/preload.ts', import.meta.url),
  'utf8'
)
const main = readFileSync(
  new URL('../electron/main.ts', import.meta.url),
  'utf8'
)
const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('memory growth is a first-class pageable archive with current dossier navigation', () => {
  const growth = page.indexOf('id="memory-growth"')
  const ingestion = page.indexOf('{ingestionStatus && (')
  assert.ok(growth >= 0)
  assert.ok(ingestion > growth)
  assert.match(page.slice(growth, ingestion), /memoryGrowthKind/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthChange/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthDetail/)
  assert.match(page.slice(growth, ingestion), /value="enriched"/)
  assert.match(page.slice(growth, ingestion), /entry\.changeDetail/)
  assert.match(page.slice(growth, ingestion), /memoryGrowthEntity/)
  assert.match(page.slice(growth, ingestion), /loadMoreMemoryGrowth/)
  assert.match(page.slice(growth, ingestion), /openMemoryGrowthItem/)
  assert.match(page, /id="entity-dossier-memory-growth"/)
  assert.match(page, /loadMoreEntityMemoryGrowth/)
  assert.match(page, /getCurrentStructuredMemoryDossier\(structuredKind, id\)/)
  assert.match(page, /openSearchResourceDossier\(id\)/)
  assert.match(preload, /getMemoryChangeLogPage/)
  assert.match(main, /ai-assistant:getMemoryChangeLogPage/)
  assert.match(service, /entityId: String\(options\?\.entityId \|\| ''\)/)
})
