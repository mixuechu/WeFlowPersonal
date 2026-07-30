import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedEvidencePayload } from '../shared/evidencePayload.ts'

test('bounded evidence payload keeps provenance, newest rows and a truthful total', () => {
  const payload = boundedEvidencePayload(Array.from({ length: 12 }, (_, index) => ({
    message_id: `wechat:session:${index + 1}`,
    session_id: 'session',
    timestamp: index + 1,
    sender: `发送者 ${index + 1}`,
    excerpt: `${'长'.repeat(1200)} ${index + 1}`,
    evidence_role: index % 2 ? 'direct' : 'indirect'
  })), 5)
  assert.equal(payload.evidenceTotal, 12)
  assert.equal(payload.evidence.length, 5)
  assert.equal(payload.evidence[0].messageId, 'wechat:session:8')
  assert.equal(payload.evidence.at(-1).messageId, 'wechat:session:12')
  assert.equal(payload.evidence.at(-1).sessionId, 'session')
  assert.equal(payload.evidence.at(-1).sender, '发送者 12')
  assert.equal(payload.evidence.at(-1).role, 'direct')
  assert.equal(payload.evidence.at(-1).excerpt.length, 1000)
})

test('bounded evidence payload ignores unusable rows and clamps caller limits', () => {
  assert.deepEqual(boundedEvidencePayload([null, {}, { excerpt: '线索' }], 0), {
    evidence: [{
      messageId: '',
      sessionId: '',
      timestamp: 0,
      sender: '',
      excerpt: '线索',
      role: ''
    }],
    evidenceTotal: 1
  })
  assert.equal(boundedEvidencePayload(Array.from({ length: 150 }, (_, index) => ({
    messageId: String(index + 1)
  })), 1000).evidence.length, 100)
})
