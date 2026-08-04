import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accumulateExtractionAttemptMeta,
  inspectExtractionCoverage,
  splitSaturatedAnalysisBatch
} from '../electron/services/extractionCoveragePolicy.ts'

const key = (message: any) => `${message.sessionId}:${message.id}`

test('extraction coverage identifies every array that reaches its output budget', () => {
  const digest = {
    entities: Array(30),
    relations: Array(2),
    claims: Array(20),
    events: Array(15),
    tasks: Array(3)
  }
  const coverage = inspectExtractionCoverage(digest)
  assert.equal(coverage.saturated, true)
  assert.deepEqual(coverage.saturatedKinds, ['entities', 'claims', 'events'])
  assert.equal(coverage.unresolved, false)
})

test('saturated batch split preserves context while assigning every core message once', () => {
  const batch = [
    ...Array.from({ length: 60 }, (_, index) => ({
      id: `core-${index}`,
      sessionId: index % 2 ? 'b' : 'a',
      analysisScope: 'core'
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `context-${index}`,
      sessionId: 'a',
      analysisScope: 'context'
    }))
  ]
  const split = splitSaturatedAnalysisBatch(batch, { messageKey: key, minimumCoreSize: 25 })
  assert.equal(split.length, 2)
  assert.ok(split.every(partition => partition.length === batch.length))
  const coreCounts = new Map<string, number>()
  for (const message of split.flat()) {
    if (message.analysisScope !== 'core') continue
    coreCounts.set(key(message), (coreCounts.get(key(message)) || 0) + 1)
  }
  assert.equal(coreCounts.size, 60)
  assert.ok([...coreCounts.values()].every(count => count === 1))
})

test('small saturated batch is left intact to bound recursive model calls', () => {
  const batch = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    sessionId: 'a',
    analysisScope: 'core'
  }))
  assert.deepEqual(
    splitSaturatedAnalysisBatch(batch, { messageKey: key, minimumCoreSize: 25 }),
    []
  )
})

test('discarded probe usage is carried into the first committed child', () => {
  assert.deepEqual(accumulateExtractionAttemptMeta(
    { inputTokens: 100, outputTokens: 20, durationMs: 1_000, attempts: 1 },
    { inputTokens: 50, outputTokens: 10, durationMs: 500 }
  ), {
    inputTokens: 150,
    outputTokens: 30,
    durationMs: 1_500,
    attempts: 2
  })
})
