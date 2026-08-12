import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  getFullIdentityScanSchedule,
  projectIdentityScanDiagnostics
} from '../electron/services/identityDisambiguation.ts'

test('identity diagnostics expose progress but keep resumable identity material in the main process', () => {
  const diagnostics = projectIdentityScanDiagnostics({
    lastFullScanAt: null,
    lastRunAt: '2026-08-12T00:00:00.000Z',
    fullTruncated: true,
    fullScanProcessedPairs: 20_000,
    fullScanCursor: 'decodes-to-name-and-two-entity-ids',
    fullScanSnapshotFingerprint: 'private-identity-snapshot',
    futurePrivateField: 'must-not-cross-ipc'
  }, getFullIdentityScanSchedule(1_000, null, new Date('2026-08-12T00:00:00.000Z')))
  assert.equal(diagnostics.fullTruncated, true)
  assert.equal(diagnostics.fullScanProcessedPairs, 20_000)
  assert.equal('fullScanCursor' in diagnostics, false)
  assert.equal('fullScanSnapshotFingerprint' in diagnostics, false)
  assert.equal('futurePrivateField' in diagnostics, false)
  assert.doesNotMatch(JSON.stringify(diagnostics), /name-and-two-entity|private-identity|cross-ipc/)
})

test('dashboard uses an explicit identity diagnostic projection instead of spreading durable state', () => {
  const source = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url),
    'utf8'
  )
  const start = source.indexOf('identityDisambiguation:')
  const end = source.indexOf('mergeHistoryArchive:', start)
  const projection = source.slice(start, end)
  assert.match(projection, /projectIdentityScanDiagnostics/)
  assert.doesNotMatch(projection, /\.\.\.this\.state\.graph\.identityScan/)
})
