import assert from 'node:assert/strict'
import test from 'node:test'
import { RendererPageIncidentAdmission } from '../electron/services/rendererPageIncidentAdmission.ts'
import type { RendererPageIncidentPayload } from '../shared/rendererPageIncident.ts'

const incident = (fingerprint: string): RendererPageIncidentPayload => ({
  version: 'renderer-page-incident-v1',
  pageKind: 'ai_assistant',
  errorClass: 'TypeError',
  fingerprint
})

test('one deterministic page failure is persisted once per duplicate window', () => {
  const admission = new RendererPageIncidentAdmission({
    duplicateWindowMs: 5_000,
    rateWindowMs: 1_000,
    maximumPerRateWindow: 8
  })
  assert.deepEqual(admission.admit(incident('a'.repeat(24)), 10_000), {
    recorded: true,
    reason: 'recorded'
  })
  assert.deepEqual(admission.admit(incident('a'.repeat(24)), 14_999), {
    recorded: false,
    reason: 'duplicate'
  })
  assert.deepEqual(admission.admit(incident('a'.repeat(24)), 15_001), {
    recorded: true,
    reason: 'recorded'
  })
})

test('distinct fingerprint flooding is bounded without rejecting later healthy windows', () => {
  const admission = new RendererPageIncidentAdmission({
    duplicateWindowMs: 5_000,
    rateWindowMs: 1_000,
    maximumPerRateWindow: 2
  })
  assert.equal(admission.admit(incident('a'.repeat(24)), 10_000).reason, 'recorded')
  assert.equal(admission.admit(incident('b'.repeat(24)), 10_100).reason, 'recorded')
  assert.deepEqual(admission.admit(incident('c'.repeat(24)), 10_200), {
    recorded: false,
    reason: 'rate_limited'
  })
  assert.equal(admission.admit(incident('c'.repeat(24)), 11_001).reason, 'recorded')
})

test('admission diagnostics remain bounded to active windows', () => {
  const admission = new RendererPageIncidentAdmission({
    duplicateWindowMs: 5_000,
    rateWindowMs: 1_000,
    maximumPerRateWindow: 2
  })
  admission.admit(incident('a'.repeat(24)), 10_000)
  admission.admit(incident('b'.repeat(24)), 10_100)
  assert.deepEqual(admission.diagnostics(10_500), {
    acceptedInRateWindow: 2,
    trackedIdentities: 2,
    maximumPerRateWindow: 2,
    rateWindowMs: 1_000,
    duplicateWindowMs: 5_000
  })
  assert.equal(admission.diagnostics(16_000).acceptedInRateWindow, 0)
  assert.equal(admission.diagnostics(16_000).trackedIdentities, 0)
})
