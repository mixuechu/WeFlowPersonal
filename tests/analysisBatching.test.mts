import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverlappingAnalysisBatches } from '../electron/services/analysisBatching.ts'

const key = (message: any) => `${message.sessionId}:${message.id}`

test('analysis batches keep persisted page-boundary messages as context only', () => {
  const boundaryContext = Array.from({ length: 20 }, (_, index) => ({
    id: `old-${index}`,
    sessionId: 'busy-chat',
    timestamp: index + 1
  }))
  const fresh = Array.from({ length: 101 }, (_, index) => ({
    id: `fresh-${index}`,
    sessionId: 'busy-chat',
    timestamp: index + 21
  }))
  const forcedContextKeys = new Set(boundaryContext.map(key))
  const batches = buildOverlappingAnalysisBatches(
    [...boundaryContext, ...fresh],
    { messageKey: key, forcedContextKeys, coreSize: 100, overlap: 20, maxBatchSize: 160 }
  )
  assert.equal(batches.length, 2)
  assert.ok(batches[0].length <= 160)
  assert.ok(batches[1].length <= 160)
  assert.ok(batches.every(batch => new Set(batch.map(key)).size === batch.length))
  assert.ok(batches.flat()
    .filter(message => forcedContextKeys.has(key(message)))
    .every(message => message.analysisScope === 'context'))
  const coreCounts = new Map<string, number>()
  for (const message of batches.flat()) {
    if (message.analysisScope !== 'core') continue
    coreCounts.set(key(message), (coreCounts.get(key(message)) || 0) + 1)
  }
  assert.equal(coreCounts.size, fresh.length)
  assert.ok([...coreCounts.values()].every(count => count === 1))
})

test('analysis batching emits no model window when a page contains only processed overlap', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `old-${index}`,
    sessionId: 'busy-chat',
    timestamp: index
  }))
  assert.deepEqual(buildOverlappingAnalysisBatches(messages, {
    messageKey: key,
    forcedContextKeys: new Set(messages.map(key))
  }), [])
})

test('small ordinary sessions remain entirely core evidence', () => {
  const messages = [
    { id: 'a', sessionId: 'chat', timestamp: 1 },
    { id: 'b', sessionId: 'chat', timestamp: 2 }
  ]
  const batches = buildOverlappingAnalysisBatches(messages, { messageKey: key })
  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].map(message => message.analysisScope), ['core', 'core'])
})
