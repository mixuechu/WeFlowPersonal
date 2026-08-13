import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNameIdentityPairPage,
  normalizePersistedIdentityScanState
} from '../electron/services/identityDisambiguation.ts'

const defaults = {
  lastFullScanAt: null,
  lastRunAt: null,
  lastMode: null,
  lastCandidateCount: 0,
  fullPairCandidates: 0,
  fullLargestNameBucket: 0,
  fullTruncated: false,
  fullScanCursor: null,
  fullScanSnapshotFingerprint: null,
  fullScanProcessedPairs: 0,
  fullScanContinuationAt: null,
  fullScanContinuationError: null,
  fullScanContinuationFailures: 0,
  fullScanNextAttemptAt: null,
  contextualTruncated: false,
  decisionLookupAt: null,
  vectorContinuationAt: null,
  vectorContinuationError: null,
  vectorContinuationFailures: 0,
  vectorNextAttemptAt: null
}

test('valid identity continuation survives restart with bounded normalized diagnostics', () => {
  const page = buildNameIdentityPairPage(Array.from({ length: 4 }, (_, index) => ({
    id: `person-${index}`, type: 'person', canonicalName: '同名', identityVersion: 1
  })), { limit: 2 })
  const normalized = normalizePersistedIdentityScanState({
    lastFullScanAt: '2026-08-01T00:00:00+08:00',
    lastRunAt: '2026-08-12T00:00:00Z',
    lastMode: 'full',
    lastCandidateCount: 3.8,
    fullTruncated: true,
    fullScanCursor: page.nextCursor,
    fullScanSnapshotFingerprint: page.snapshotFingerprint,
    fullScanProcessedPairs: 2,
    fullScanContinuationFailures: 2,
    fullScanNextAttemptAt: '2026-08-12T00:15:00Z',
    vectorContinuationFailures: 3,
    vectorNextAttemptAt: '2026-08-12T00:30:00Z',
    futurePrivateField: 'discarded'
  }, defaults)
  assert.equal(normalized.lastFullScanAt, '2026-07-31T16:00:00.000Z')
  assert.equal(normalized.lastMode, 'full')
  assert.equal(normalized.lastCandidateCount, 3)
  assert.equal(normalized.fullScanCursor, page.nextCursor)
  assert.equal(normalized.fullScanProcessedPairs, 2)
  assert.equal(normalized.fullScanContinuationFailures, 2)
  assert.equal(normalized.fullScanNextAttemptAt, '2026-08-12T00:15:00.000Z')
  assert.equal(normalized.vectorContinuationFailures, 3)
  assert.equal(normalized.vectorNextAttemptAt, '2026-08-12T00:30:00.000Z')
  assert.equal('futurePrivateField' in normalized, false)
})

test('malformed or incomplete identity continuation fails closed to a fresh authoritative scan', () => {
  for (const raw of [{
    fullScanCursor: 'x'.repeat(2_049),
    fullScanSnapshotFingerprint: 'a'.repeat(64),
    fullScanProcessedPairs: Number.MAX_VALUE,
    fullTruncated: true
  }, {
    fullScanCursor: 'not-base64-json',
    fullScanSnapshotFingerprint: 'a'.repeat(64),
    fullScanProcessedPairs: 99,
    fullScanContinuationFailures: 8,
    fullScanNextAttemptAt: '2026-08-12T06:00:00Z',
    fullTruncated: true
  }, {
    fullScanCursor: Buffer.from(JSON.stringify(['同名', 'a', 'b'])).toString('base64url'),
    fullScanSnapshotFingerprint: 'wrong',
    fullScanProcessedPairs: 99,
    fullTruncated: true
  }]) {
    const normalized = normalizePersistedIdentityScanState(raw, defaults)
    assert.equal(normalized.fullScanCursor, null)
    assert.equal(normalized.fullScanSnapshotFingerprint, null)
    assert.equal(normalized.fullScanProcessedPairs, 0)
    assert.equal(normalized.fullTruncated, false)
    assert.equal(normalized.fullScanContinuationFailures, 0)
    assert.equal(normalized.fullScanNextAttemptAt, null)
  }
})

test('identity restart normalization bounds invalid timestamps, counters, enums and errors', () => {
  const normalized = normalizePersistedIdentityScanState({
    lastFullScanAt: 'not-a-time',
    lastRunAt: 42,
    lastMode: 'corrupted',
    lastCandidateCount: -10,
    fullPairCandidates: Infinity,
    contextualTruncated: 'false',
    vectorContinuationError: '错'.repeat(800),
    fullScanContinuationFailures: -4,
    fullScanNextAttemptAt: 'not-a-time',
    vectorContinuationFailures: -8,
    vectorNextAttemptAt: 'also-not-a-time'
  }, defaults)
  assert.equal(normalized.lastFullScanAt, null)
  assert.equal(normalized.lastRunAt, null)
  assert.equal(normalized.lastMode, null)
  assert.equal(normalized.lastCandidateCount, 0)
  assert.equal(normalized.fullPairCandidates, 0)
  assert.equal(normalized.contextualTruncated, false)
  assert.equal(normalized.vectorContinuationError.length, 500)
  assert.equal(normalized.fullScanContinuationFailures, 0)
  assert.equal(normalized.fullScanNextAttemptAt, null)
  assert.equal(normalized.vectorContinuationFailures, 0)
  assert.equal(normalized.vectorNextAttemptAt, null)
})
