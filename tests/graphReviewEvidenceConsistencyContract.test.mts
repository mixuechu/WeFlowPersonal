import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')

test('graph review directory and archive share one canonical evidence implementation', () => {
  assert.match(store, /private normalizeGraphReviewEvidence\(payload: any\)/)
  assert.equal((store.match(/this\.normalizeGraphReviewEvidence\(payload\)/g) || []).length, 2)
  assert.match(store, /evidence: fullEvidence\.slice\(0, 3\)/)
  assert.doesNotMatch(store, /evidence: fullEvidence\.slice\(-3\)/)
})

test('canonical graph review evidence uses source carrier identity and newest-first order', () => {
  const start = store.indexOf('private normalizeGraphReviewEvidence')
  const end = store.indexOf('\n  listReviewLedgerPage', start)
  const implementation = store.slice(start, end)
  assert.match(implementation, /`\$\{sourceId\}\\0\$\{sessionId\}\\0\$\{messageId\}`/)
  assert.match(implementation, /Number\(right\.timestamp \|\| 0\) - Number\(left\.timestamp \|\| 0\)/)
  assert.match(implementation, /sourceId,/)
})
