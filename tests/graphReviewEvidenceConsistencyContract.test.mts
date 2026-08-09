import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')

test('graph review directory and archive share one SQLCipher evidence authority', () => {
  assert.match(store, /private normalizeGraphReviewEvidence\(payload: any\)/)
  assert.match(store, /CREATE TABLE IF NOT EXISTS graph_review_evidence/)
  assert.match(store, /ROW_NUMBER\(\) OVER \(\s*PARTITION BY review_id/)
  assert.match(store, /SELECT source_id,session_id,message_id,timestamp,sender,excerpt,evidence_json\s*FROM graph_review_evidence WHERE review_id=\?/)
  assert.match(store, /LIMIT \? OFFSET \?/)
  assert.doesNotMatch(store, /const items = evidence\.slice\(offset, offset \+ limit\)/)
})

test('canonical graph review evidence uses source carrier identity and newest-first order', () => {
  const start = store.indexOf('private normalizeGraphReviewEvidence')
  const end = store.indexOf('\n  listReviewLedgerPage', start)
  const implementation = store.slice(start, end)
  assert.match(implementation, /`\$\{sourceId\}\\0\$\{sessionId\}\\0\$\{messageId\}`/)
  assert.match(implementation, /Number\(right\.timestamp \|\| 0\) - Number\(left\.timestamp \|\| 0\)/)
  assert.match(implementation, /sourceId,/)
})
