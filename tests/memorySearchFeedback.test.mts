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
  assert.equal(first.scopeJson.includes('trustStatuses'), false)
  const confirmedOnly = buildMemorySearchFeedbackContext('谁在等我 回复', {
    entityId: 'person-1',
    sourceIds: ['wechat', 'calendar'],
    documentTypes: ['task', 'event'],
    trustStatuses: ['confirmed']
  })
  assert.notEqual(first.scopeFingerprint, confirmedOnly.scopeFingerprint)
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

test('search feedback reranking is idempotent across sub-query and final RAG merge layers', () => {
  const results = [
    { id: 'first', hybrid_score: 0.05 },
    { id: 'second', hybrid_score: 0.045 }
  ]
  const decisions = new Map<string, 'helpful' | 'not_relevant'>([
    ['first', 'not_relevant'],
    ['second', 'helpful']
  ])
  const once = applyMemorySearchFeedback(results, decisions)
  const twice = applyMemorySearchFeedback(once, decisions)
  assert.deepEqual(twice.map(item => item.id), once.map(item => item.id))
  assert.deepEqual(twice.map(item => item.hybrid_score), once.map(item => item.hybrid_score))
  assert.equal(twice.find(item => item.id === 'first')?.ranking_base_score, 0.05)
  assert.equal(twice.find(item => item.id === 'second')?.ranking_base_score, 0.045)
})
