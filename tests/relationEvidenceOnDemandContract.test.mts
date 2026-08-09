import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('graph and review evidence presentation hydrates only the visible scope on demand', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')
  const focus = service.slice(service.indexOf('const visibleRelations = allRelations.slice(0, 200)'),
    service.indexOf('const relationHistoryPage', service.indexOf('const visibleRelations = allRelations.slice(0, 200)')))
  const path = service.slice(service.indexOf('findGraphPath('), service.indexOf('findCommonNeighbors('))
  const common = service.slice(service.indexOf('findCommonNeighbors('), service.indexOf('async askMemory('))

  assert.match(focus, /getRelationEvidenceHotset\([\s\S]*visibleRelations\.map/)
  assert.match(path, /getRelationEvidenceHotset\([\s\S]*path\.steps\.map/)
  assert.match(common, /getRelationEvidenceHotset\([\s\S]*relationIds/)
  const snapshot = store.slice(store.indexOf('loadGraphSnapshot(): MemoryGraph'),
    store.indexOf('getRelationEvidenceCounts():', store.indexOf('loadGraphSnapshot(): MemoryGraph')))
  assert.match(snapshot, /SELECT relation_id,COUNT\(\*\) AS evidence_total/)
  assert.match(snapshot, /SELECT evidence\.review_id,COUNT\(\*\) AS evidence_total/)
  assert.doesNotMatch(snapshot, /sender,excerpt,[\s\S]*FROM evidence WHERE relation_id/)
  assert.doesNotMatch(snapshot, /sender,excerpt,evidence_json,[\s\S]*FROM graph_review_evidence/)
  const reviewDirectory = store.slice(store.indexOf('listReviewLedgerPage('),
    store.indexOf('listGraphReviewEvidencePage(', store.indexOf('listReviewLedgerPage(')))
  assert.match(reviewDirectory, /visibleReviewIds/)
  assert.match(reviewDirectory, /WHERE evidence_rank<=3/)
})
