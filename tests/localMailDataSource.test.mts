import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LocalMailDataSource,
  mailMessageToDataSourceItem,
  type LocalMailMessage
} from '../electron/services/localMailDataSource.ts'
import {
  buildModelMemoryContext,
  filterModelEligibleMemoryResults,
  finalizeGroundedMemoryAnswer,
  getMemoryEvidenceEligibility,
  runPersonalDataSourceBatch
} from '../electron/services/personalDataSources.ts'

function message(overrides: Partial<LocalMailMessage> = {}): LocalMailMessage {
  return {
    id: 'local-1',
    messageId: '<message-1@example.test>',
    accountId: 'account-1',
    mailboxId: 'mailbox-inbox',
    mailboxName: '工作邮箱 / 收件箱',
    subject: '产品评审安排',
    sender: 'Hun <hun@example.test>',
    to: ['owner@example.test'],
    cc: ['team@example.test'],
    receivedAt: '2026-07-30T02:00:00Z',
    sentAt: '2026-07-30T01:59:00Z',
    content: '请确认明天下午的评审时间。',
    read: false,
    flagged: true,
    size: 1024,
    attachmentNames: ['agenda.pdf'],
    ...overrides
  }
}

test('mail message becomes bounded local evidence without enabling model analysis', () => {
  const item = mailMessageToDataSourceItem(message())
  assert.equal(item.sourceId, 'mail')
  assert.equal(item.kind, 'email')
  assert.equal(item.scopeName, '工作邮箱 / 收件箱')
  assert.match(item.content, /Hun <hun@example\.test>/)
  assert.match(item.content, /agenda\.pdf/)
  assert.equal(item.metadata?.flagged, true)
  assert.match(String(item.externalId), /^[a-f0-9]{32}$/)
  const moved = mailMessageToDataSourceItem(message({
    id: 'local-99',
    mailboxId: 'mailbox-archive',
    mailboxName: '工作邮箱 / 归档'
  }))
  assert.equal(moved.externalId, item.externalId)
  assert.notEqual(moved.metadata?.contentHash, item.metadata?.contentHash)
})

test('mail evidence stays searchable locally but current connector policy gates model context', () => {
  const localResults = [
    {
      id: 'mail-message:1',
      search_text: '本机可检索的邮件正文',
      metadata: { sourceId: 'mail', modelAnalysisAllowed: true }
    },
    {
      id: 'chat-message:1',
      search_text: '微信证据',
      metadata: { sourceId: 'wechat' }
    }
  ]
  assert.deepEqual(
    filterModelEligibleMemoryResults(localResults, {
      mail: { allowModelAnalysis: false }
    }).map(item => item.id),
    ['chat-message:1']
  )
  assert.deepEqual(
    filterModelEligibleMemoryResults(localResults, {
      mail: { allowModelAnalysis: true }
    }).map(item => item.id),
    ['mail-message:1', 'chat-message:1']
  )
  assert.equal(localResults.length, 2)
})

test('memory evidence eligibility keeps review status separate from factual support', () => {
  const evidence = [{ message_id: 'message-1', excerpt: '原始证据' }]
  const item = (type: string, status?: string, withEvidence = true) => ({
    document_type: type,
    metadata: status ? { status } : {},
    evidence: withEvidence ? evidence : [],
    evidenceTotal: withEvidence ? 7 : 0
  })

  assert.deepEqual(
    ['candidate', 'confirmed', 'rejected', 'cancelled'].map(status =>
      getMemoryEvidenceEligibility(item('claim', status)).canSupportFacts),
    [false, true, false, false]
  )
  assert.equal(getMemoryEvidenceEligibility(item('confirmed', undefined)).status, 'not_applicable')
  assert.equal(getMemoryEvidenceEligibility(item('message', undefined)).canSupportFacts, true)
  assert.equal(getMemoryEvidenceEligibility(item('claim', 'confirmed', false)).canSupportFacts, false)

  const results = [
    { id: 'candidate', ...item('claim', 'candidate') },
    { id: 'confirmed', ...item('claim', 'confirmed') },
    { id: 'rejected', ...item('claim', 'rejected') },
    { id: 'cancelled', ...item('event', 'cancelled') },
    { id: 'raw', ...item('message') }
  ]
  assert.deepEqual(
    filterModelEligibleMemoryResults(results).map(result => result.id),
    ['candidate', 'confirmed', 'cancelled', 'raw']
  )
  assert.deepEqual(
    buildModelMemoryContext(results).map(result => ({
      id: result.documentId,
      status: result.status,
      canSupportFacts: result.canSupportFacts
    })),
    [
      { id: 'candidate', status: 'candidate', canSupportFacts: false },
      { id: 'confirmed', status: 'confirmed', canSupportFacts: true },
      { id: 'cancelled', status: 'cancelled', canSupportFacts: false },
      { id: 'raw', status: 'not_applicable', canSupportFacts: true }
    ]
  )

  const context = buildModelMemoryContext(results)
  assert.equal(context.find(result => result.documentId === 'confirmed')?.evidenceTotal, 7)
  const rejectedHallucination = finalizeGroundedMemoryAnswer({
    answer: '候选内容一定是真的。',
    citationIds: ['candidate', 'rejected', 'cancelled']
  }, context)
  assert.deepEqual(rejectedHallucination.citationIds, [])
  assert.match(rejectedHallucination.answer, /没有足够的已确认原始证据/)

  const grounded = finalizeGroundedMemoryAnswer({
    answer: '这是有依据的回答。',
    citationIds: ['candidate', 'confirmed', 'confirmed']
  }, context)
  assert.deepEqual(grounded.citationIds, ['confirmed'])
  assert.equal(grounded.answer, '这是有依据的回答。')
})

test('mail connector keeps independent mailbox cursors and retries failed consumption', async () => {
  const sourceMessages: Record<string, LocalMailMessage[]> = {
    inbox: [message({ id: 'inbox-1', mailboxId: 'inbox', receivedAt: '2026-07-28T02:00:00Z' })],
    sent: [message({
      id: 'sent-1',
      messageId: '<sent-1@example.test>',
      mailboxId: 'sent',
      mailboxName: '工作邮箱 / 已发送',
      receivedAt: '2026-07-29T02:00:00Z'
    })]
  }
  const calls: Array<{ mailboxId: string; startAt: string; skipped: string[] }> = []
  const service = {
    async listMessages(mailboxId: string, startAt: string, _endAt: string, limit: number, skipped: string[]) {
      calls.push({ mailboxId, startAt, skipped })
      const available = sourceMessages[mailboxId].filter(item => !skipped.includes(item.id))
      return { messages: available.slice(0, limit), hasMore: available.length > limit }
    }
  }
  const connector = new LocalMailDataSource(
    ['inbox', 'sent'],
    service,
    () => new Date('2026-07-30T00:00:00Z')
  )
  let checkpoint = ''
  await assert.rejects(
    runPersonalDataSourceBatch(connector, checkpoint, async () => {
      throw new Error('database unavailable')
    }),
    /database unavailable/
  )
  const retried = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.deepEqual(items.map(item => item.scopeId), ['inbox', 'sent'])
  })
  checkpoint = retried.checkpoint
  assert.equal(retried.pulled, 2)
  assert.equal(calls[0].startAt, '2026-06-30T00:00:00.000Z')

  const unchanged = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 0)
  })
  assert.equal(unchanged.pulled, 0)
  assert.ok(calls.at(-2)?.skipped.includes('inbox-1'))
  assert.ok(calls.at(-1)?.skipped.includes('sent-1'))
})

test('mail connector paginates oldest-first without one mailbox starving another', async () => {
  const sourceMessages: Record<string, LocalMailMessage[]> = {
    inbox: [
      message({ id: 'i1', messageId: '<i1>', mailboxId: 'inbox', receivedAt: '2026-07-28T01:00:00Z' }),
      message({ id: 'i2', messageId: '<i2>', mailboxId: 'inbox', receivedAt: '2026-07-28T02:00:00Z' })
    ],
    sent: [
      message({ id: 's1', messageId: '<s1>', mailboxId: 'sent', receivedAt: '2026-07-29T01:00:00Z' })
    ]
  }
  const service = {
    async listMessages(mailboxId: string, _startAt: string, _endAt: string, limit: number, skipped: string[]) {
      const available = sourceMessages[mailboxId].filter(item => !skipped.includes(item.id))
      return { messages: available.slice(0, limit), hasMore: available.length > limit }
    }
  }
  const connector = new LocalMailDataSource(
    ['inbox', 'sent'],
    service,
    () => new Date('2026-07-30T00:00:00Z')
  )
  let checkpoint = ''
  const seen: string[] = []
  for (let page = 0; page < 3; page += 1) {
    const result = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
      seen.push(...items.map(item => String(item.metadata?.localMessageId)))
    }, { limit: 1 })
    checkpoint = result.checkpoint
  }
  assert.deepEqual(seen, ['i1', 'i2', 's1'])
})
