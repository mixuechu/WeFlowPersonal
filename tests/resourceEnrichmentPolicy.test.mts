import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RESOURCE_ENRICHMENT_KINDS,
  selectDueResourceEnrichmentKind
} from '../electron/services/resourceEnrichmentPolicy.ts'

test('idle resource enrichment rotates fairly across every due queue', () => {
  const due = Object.fromEntries(RESOURCE_ENRICHMENT_KINDS.map(kind => [kind, true]))
  const selected = new Set(RESOURCE_ENRICHMENT_KINDS.map((_, minute) =>
    selectDueResourceEnrichmentKind(due, minute * 60_000)))
  assert.deepEqual(selected, new Set(RESOURCE_ENRICHMENT_KINDS))
})

test('idle resource enrichment skips disabled or empty queues without losing rotation', () => {
  assert.equal(selectDueResourceEnrichmentKind({ web_snapshot: true }, 0), 'web_snapshot')
  assert.equal(selectDueResourceEnrichmentKind({}, 0), null)
})

test('idle enrichment is a first-class writer in scheduling, diagnostics and shutdown', () => {
  const service = readFileSync(join(process.cwd(), 'electron/services/aiAssistantService.ts'), 'utf8')
  assert.match(service, /private resourceEnrichmentPromise: Promise<string> \| null = null/)
  assert.match(service, /\{ name: 'resource_enrichment', promise: this\.resourceEnrichmentPromise \}/)
  assert.match(service, /resourceEnriching: Boolean\(this\.resourceEnrichmentPromise\)/)
  assert.match(service, /const resourceEnrichmentOutcome = this\.continueIdleResourceEnrichment\(now\)/)
  assert.match(service, /if \(resourceEnrichmentOutcome\) return await resourceEnrichmentOutcome/)
  assert.match(service, /if \(this\.resourceEnrichmentPromise\) \{\s*await Promise\.allSettled/)
  assert.match(service, /idle: !this\.activeSync && !this\.vectorIndexPromise && !this\.memorySearchRepairPromise &&\s*!this\.resourceEnrichmentPromise/)
  assert.match(service, /continueIdentityVectorScanWhileIdle[\s\S]*?this\.resourceEnrichmentPromise\) \{/)
  assert.match(service, /continueLegacyResourceContentBudgetMigration[\s\S]*?this\.resourceEnrichmentPromise\) \{/)
})
