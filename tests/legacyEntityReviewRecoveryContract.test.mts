import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('legacy entity review recovery uses a bounded full-history SQLCipher query', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const start = service.indexOf('private ensureLegacyEntityReviews')
  const end = service.indexOf('private quarantinePlaceholderEntities', start)
  const implementation = service.slice(start, end)
  assert.match(implementation, /listLegacyEntityReviewEvidence/)
  assert.doesNotMatch(implementation, /getMemoryFeed\(/)
  assert.match(store, /ROW_NUMBER\(\) OVER \([\s\S]*PARTITION BY target_id/)
  assert.match(store, /FROM ranked WHERE evidence_rank<=\?/)
  assert.match(store, /JOIN claims claim[\s\S]*JOIN relations relation[\s\S]*JOIN event_participants participant/)
})

test('legacy review evidence keeps complete carrier identity for collision-safe deduplication', () => {
  const policy = read('electron/services/entityTrustPolicy.ts')
  assert.match(policy, /sourceId: String\(item\?\.sourceId \|\| item\?\.source_id \|\| 'legacy'\)/)
  assert.match(policy, /`\$\{item\.sourceId\}:\$\{item\.sessionId\}:\$\{item\.messageId\}`/)
})

test('full diagnostics expose legacy review recovery and its missing-evidence cases', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(service, /legacyEntityReviewRecovery: this\.legacyEntityReviewRecovery/)
  assert.match(page, /旧版实体全历史原文恢复/)
  assert.match(page, /reviewsWithoutEvidence/)
  assert.match(page, /不受首页最近 100 条限制/)
})
