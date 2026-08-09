import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')
const assistantPage = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

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

test('legacy graph review provenance repair is strict, durable, and visible', () => {
  const start = store.indexOf('private repairGraphReviewEvidenceProvenance')
  const end = store.indexOf('\n  getGraphReviewEvidenceStorageHealth', start)
  const implementation = store.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(implementation, /unique_authoritative_carrier_only/)
  assert.match(implementation, /matchingSenders\.length === 1/)
  assert.match(implementation, /matchingSenders\.length > 1/)
  assert.match(implementation, /rowsMergedThisStart/)
  assert.match(implementation, /graph_review_evidence_provenance_repair_v1/)
  assert.match(implementation, /WITH requested\(session_id,message_id\)/)
  assert.match(implementation, /FROM json_each\(\?\)/)
  assert.doesNotMatch(implementation, /authority\.all\(/)
  assert.match(implementation, /WHERE rowid>\? AND message_id!=''/)
  assert.match(implementation, /batchLimit = 500/)
  assert.match(implementation, /rowid_keyset_bounded_v1/)
  assert.match(assistantPage, /本次来源\/发送者自愈/)
  assert.match(assistantPage, /发送者歧义\/仍未知/)
  assert.match(assistantPage, /自愈查询索引/)
  assert.match(assistantPage, /单批峰值/)
})

test('graph review evidence archive filters before authoritative pagination', () => {
  const start = store.indexOf('listGraphReviewEvidencePage(options:')
  const end = store.indexOf('\n  getGraphReviewRevision()', start)
  const implementation = store.slice(start, end)
  assert.match(implementation, /unfilteredTotal/)
  assert.match(implementation, /LOWER\(COALESCE\(source_id,''\)\)=\?/)
  assert.match(implementation, /INSTR\(LOWER\(COALESCE\(sender,''\)\),LOWER\(\?\)\)>0/)
  assert.match(implementation, /INSTR\(LOWER\(COALESCE\(excerpt,''\)\),LOWER\(\?\)\)>0/)
  assert.match(implementation, /timestamp>=\?/)
  assert.match(implementation, /timestamp<=\?/)
  assert.match(assistantPage, /'graph_review', review\.id/)
  assert.match(assistantPage, /筛选原文档案/)
  assert.match(assistantPage, /memoryEvidenceArchive\.documentType !== 'graph_review'/)
})
