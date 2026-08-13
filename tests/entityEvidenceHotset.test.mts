import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT,
  compactEntityEvidenceMessageIds
} from '../shared/entityEvidenceHotset.ts'

test('entity evidence message hotset is unique, bounded and keeps the newest tail', () => {
  const values = [
    '',
    ...Array.from({ length: 750 }, (_, index) => `message-${index}`),
    'message-749'
  ]
  const compacted = compactEntityEvidenceMessageIds(values)
  assert.equal(compacted.length, ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT)
  assert.equal(compacted[0], 'message-250')
  assert.equal(compacted.at(-1), 'message-749')
  assert.equal(new Set(compacted).size, compacted.length)
})
