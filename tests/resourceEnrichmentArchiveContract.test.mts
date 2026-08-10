import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../electron/services/personalMemoryStore.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')

test('resource enrichment queues are server-filtered, reviewable and privacy-minimal', () => {
  assert.match(page, /resourceEnrichmentKind/)
  assert.match(page, /resourceEnrichmentStatus/)
  assert.match(page, /RESOURCE_ENRICHMENT_KIND_LABELS/)
  assert.match(page, /RESOURCE_ENRICHMENT_STATE_LABELS/)
  assert.match(page, /下次自动尝试/)
  assert.match(page, /setResourceEnrichmentKind\(kind\)/)
  assert.match(page, /setResourceEnrichmentStatus\(state\)/)
  assert.match(service, /attachmentStructureParserVersion: ATTACHMENT_STRUCTURE_PARSER_VERSION/)
  assert.match(service, /imageSemanticModelVersion: localImageSemanticService\.getStatus\(\)\.modelVersion/)
  assert.match(store, /enrichmentStatus/)
  assert.match(store, /enrichment_next_at/)
  assert.match(store, /safeReasonCodes/)
  assert.match(store, /\.\.\.directoryItem,\s*enrichment:/)
  assert.doesNotMatch(page, /enrichment\.localPath|enrichment\.mediaLocalPath/)
})
