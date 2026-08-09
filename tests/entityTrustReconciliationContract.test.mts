import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('startup entity trust reconciliation uses complete SQLCipher memory instead of a feed', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const start = service.indexOf('private enforceEntityTrustOnDerivedMemory')
  const end = service.indexOf('private ensureLegacyEntityReviews', start)
  const implementation = service.slice(start, end)
  assert.match(implementation, /listConfirmedMemoryTrustViolations\(trustedIds\)/)
  assert.doesNotMatch(implementation, /getMemoryFeed\(/)
  assert.match(store, /SELECT id,subject_id,object_entity_id FROM claims\s+WHERE status='confirmed'/s)
  assert.match(store, /INNER JOIN events event ON event\.id=participant\.event_id\s+WHERE event\.status='confirmed'/s)
})

test('all trust downgrades and their cumulative audit share one reversible cross-store transaction', () => {
  const service = read('electron/services/aiAssistantService.ts')
  assert.match(service, /runReversibleGraphMutation\(\{[\s\S]*startup-entity-trust-reconciliation[\s\S]*for \(const claimId of violations\.claims\)[\s\S]*for \(const eventId of violations\.events\)[\s\S]*for \(const relation of relationViolations\)[\s\S]*recordEntityTrustReconciliation[\s\S]*this\.saveState\(true\)/)
  assert.match(service, /restore: graph => \{ this\.state\.graph = graph \}/)
  assert.match(service, /persistRestored: \(\) => this\.persistCrossStoreMutationState\(\)/)
})

test('full diagnostics expose current and cumulative entity trust reconciliation', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /实体信任与全历史记忆对账/)
  assert.match(page, /checkedRelations/)
  assert.match(page, /downgradedClaimsTotal/)
  assert.match(page, /不依赖首页最近数据/)
})
