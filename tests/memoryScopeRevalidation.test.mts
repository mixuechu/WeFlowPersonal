import test from 'node:test'
import assert from 'node:assert/strict'
import { runWithMemoryScopeRevalidation } from '../electron/services/memoryScopeRevalidation.ts'

test('memory scope is verified on both sides of asynchronous retrieval', async () => {
  const boundaries: string[] = []
  const result = await runWithMemoryScopeRevalidation(async boundary => {
    boundaries.push(boundary)
  }, async () => 'trusted-result')
  assert.equal(result, 'trusted-result')
  assert.deepEqual(boundaries, ['before', 'after'])
})

test('scope drift while asynchronous work is in flight rejects the stale result', async () => {
  let revision = 'scope-v1'
  const expectedRevision = revision
  await assert.rejects(
    runWithMemoryScopeRevalidation(async boundary => {
      if (revision !== expectedRevision) throw new Error(`scope changed ${boundary}`)
    }, async () => {
      revision = 'scope-v2'
      return 'must-not-escape'
    }),
    /scope changed after/
  )
})

test('failed work does not claim an after-boundary authorization', async () => {
  const boundaries: string[] = []
  await assert.rejects(
    runWithMemoryScopeRevalidation(async boundary => {
      boundaries.push(boundary)
    }, async () => {
      throw new Error('retrieval failed')
    }),
    /retrieval failed/
  )
  assert.deepEqual(boundaries, ['before'])
})
