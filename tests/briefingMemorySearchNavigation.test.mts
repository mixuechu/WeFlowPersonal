import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBriefingMemorySearchPlan } from '../src/utils/briefingMemorySearchNavigation.ts'

test('briefing day navigation opens one complete authoritative Shanghai day', () => {
  assert.deepEqual(buildBriefingMemorySearchPlan('2026-08-12'), {
    query: '', mode: 'hybrid', entityId: '', sessionId: '', sessionQuery: '',
    sourceId: '', documentType: '', trustStatus: '', supportability: '',
    evidenceConflict: '', evidenceStrength: '', evidenceBreadth: '',
    from: '2026-08-12', to: '2026-08-12'
  })
})

test('briefing day navigation rejects malformed and impossible dates', () => {
  for (const value of ['', '2026-8-12', '2026-02-30', '2026-13-01', null]) {
    assert.equal(buildBriefingMemorySearchPlan(value), null)
  }
})
