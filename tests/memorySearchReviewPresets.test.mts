import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMemorySearchReviewPresetActive,
  memorySearchReviewPreset
} from '../shared/memorySearchReviewPresets.ts'

test('conservative evidence review preset binds every trust gate', () => {
  const filters = memorySearchReviewPreset('conservative_support')
  assert.deepEqual(filters, {
    trustStatus: 'confirmed',
    supportability: 'supporting',
    evidenceConflict: 'without_contradiction',
    evidenceStrength: 'direct',
    evidenceBreadth: 'multi_source'
  })
  assert.equal(isMemorySearchReviewPresetActive('conservative_support', filters), true)
  assert.equal(isMemorySearchReviewPresetActive('conservative_support', {
    ...filters,
    evidenceConflict: 'with_contradiction'
  }), false)
})

test('fragile candidate preset remains an explicit review-only queue', () => {
  const filters = memorySearchReviewPreset('fragile_candidate')
  assert.deepEqual(filters, {
    trustStatus: 'candidate',
    supportability: 'review_only',
    evidenceConflict: '',
    evidenceStrength: 'indirect_only',
    evidenceBreadth: 'single_source'
  })
  assert.equal(isMemorySearchReviewPresetActive('fragile_candidate', {
    ...filters,
    unrelatedDate: '2026-08-06'
  }), true)
  assert.equal(isMemorySearchReviewPresetActive('fragile_candidate', {
    ...filters,
    evidenceStrength: 'direct'
  }), false)
})
