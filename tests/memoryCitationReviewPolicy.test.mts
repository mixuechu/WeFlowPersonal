import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertMemoryCitationReviewToken,
  buildMemoryCitationReviewIdentity,
  buildMemoryCitationReviewToken
} from '../electron/services/memoryCitationReviewPolicy.ts'

const document = {
  id: 'claim:claim_1',
  document_type: 'claim',
  source_id: 'claim_1',
  content_hash: 'a'.repeat(64),
  metadata: { status: 'proposed' },
  evidenceTotal: 3,
  evidenceAuthorityRevision: 7,
  evidence: [{
    source_id: 'wechat',
    session_id: 'chat_1',
    message_id: 'message_1',
    evidence_role: 'support',
    timestamp: 123,
    sender: '联系人',
    excerpt: '原始证据'
  }]
}

test('citation review token binds the answer, document, scope and evidence', () => {
  const identity = buildMemoryCitationReviewIdentity({
    assistantMessageId: 'answer_1',
    document,
    scopeFingerprint: 'scope_1'
  })
  const token = buildMemoryCitationReviewToken(identity)
  assert.doesNotThrow(() => assertMemoryCitationReviewToken(identity, token))
  for (const changed of [
    { ...document, content_hash: 'b'.repeat(64) },
    { ...document, metadata: { status: 'confirmed' } },
    { ...document, evidenceTotal: 4 },
    { ...document, evidenceAuthorityRevision: 8 },
    { ...document, evidence: [{ ...document.evidence[0], message_id: 'message_2' }] },
    { ...document, evidence: [{ ...document.evidence[0], excerpt: '证据正文已修订' }] }
  ]) {
    const current = buildMemoryCitationReviewIdentity({
      assistantMessageId: 'answer_1',
      document: changed,
      scopeFingerprint: 'scope_1'
    })
    assert.throws(() => assertMemoryCitationReviewToken(current, token), /已经变化/)
  }
  const changedScope = buildMemoryCitationReviewIdentity({
    assistantMessageId: 'answer_1',
    document,
    scopeFingerprint: 'scope_2'
  })
  assert.throws(() => assertMemoryCitationReviewToken(changedScope, token), /已经变化/)
})

test('citation review identity is stable when evidence ordering changes', () => {
  const extra = {
    source_id: 'wechat',
    session_id: 'chat_1',
    message_id: 'message_2',
    evidence_role: 'contradiction',
    timestamp: 456,
    sender: '另一联系人',
    excerpt: '反证'
  }
  const first = buildMemoryCitationReviewIdentity({
    assistantMessageId: 'answer_1',
    document: { ...document, evidence: [document.evidence[0], extra] }
  })
  const second = buildMemoryCitationReviewIdentity({
    assistantMessageId: 'answer_1',
    document: { ...document, evidence: [extra, document.evidence[0]] }
  })
  assert.equal(buildMemoryCitationReviewToken(first), buildMemoryCitationReviewToken(second))
})
