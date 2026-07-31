import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMemorySearchFeedback,
  buildMemorySearchFeedbackContext
} from '../electron/services/memorySearchFeedback.ts'

test('search feedback context is stable but isolated by retrieval scope', () => {
  const first = buildMemorySearchFeedbackContext('  谁在等我 回复  ', {
    entityId: 'person-1',
    sourceIds: ['wechat', 'calendar'],
    documentTypes: ['task', 'event']
  })
  const reordered = buildMemorySearchFeedbackContext('谁在等我 回复', {
    entityId: 'person-1',
    sourceIds: ['calendar', 'wechat', 'wechat'],
    documentTypes: ['event', 'task']
  })
  const anotherPerson = buildMemorySearchFeedbackContext('谁在等我 回复', {
    entityId: 'person-2',
    sourceIds: ['wechat', 'calendar'],
    documentTypes: ['task', 'event']
  })
  assert.equal(first.queryFingerprint, reordered.queryFingerprint)
  assert.equal(first.scopeFingerprint, reordered.scopeFingerprint)
  assert.notEqual(first.scopeFingerprint, anotherPerson.scopeFingerprint)
  assert.equal(first.query, '谁在等我 回复')
})

test('search feedback conservatively reranks without deleting any result', () => {
  const results = [
    { id: 'first', hybrid_score: 0.05 },
    { id: 'second', hybrid_score: 0.045 },
    { id: 'third', hybrid_score: 0.04 }
  ]
  const reranked = applyMemorySearchFeedback(results, new Map([
    ['first', 'not_relevant'],
    ['third', 'helpful']
  ]))
  assert.deepEqual(reranked.map(item => item.id), ['third', 'second', 'first'])
  assert.equal(reranked.length, results.length)
  assert.equal(reranked[0].relevance_adjustment, 0.02)
  assert.equal(reranked[2].relevance_adjustment, -0.04)
})
