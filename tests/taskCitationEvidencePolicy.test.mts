import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTaskEvidenceFromCitations,
  mergeTaskEvidenceHotset,
  taskIdFromAssistantAnswer
} from '../electron/services/taskCitationEvidencePolicy.ts'

test('task evidence preserves complete cross-source citation identity', () => {
  const evidence = buildTaskEvidenceFromCitations([
    {
      evidence: [
        {
          source_id: 'wechat',
          session_id: 'group-a',
          message_id: 'same-message',
          timestamp: 100,
          sender: '甲',
          excerpt: '微信群原文'
        },
        {
          source_id: 'calendar',
          session_id: 'calendar-a',
          message_id: 'same-message',
          timestamp: 200,
          sender: '日历',
          excerpt: '日历原文'
        }
      ]
    }
  ])
  assert.equal(evidence.length, 2)
  assert.deepEqual(evidence.map(item => [
    item.sourceId, item.sessionId, item.messageId
  ]), [
    ['wechat', 'group-a', 'same-message'],
    ['calendar', 'calendar-a', 'same-message']
  ])
})

test('task citation evidence deduplicates only exact carrier identities and infers source', () => {
  const evidence = buildTaskEvidenceFromCitations([
    {
      evidence: [
        {
          sessionId: 'data-source:documents:design',
          messageId: 'document-message',
          excerpt: '文档证据'
        },
        {
          session_id: 'data-source:documents:design',
          message_id: 'document-message',
          excerpt: '重复文档证据'
        },
        {
          sessionId: 'mailbox',
          messageId: 'mail:thread:1',
          excerpt: '邮件证据'
        }
      ]
    }
  ])
  assert.equal(evidence.length, 2)
  assert.equal(evidence[0].sourceId, 'documents')
  assert.equal(evidence[1].sourceId, 'mail')
  assert.equal(evidence[0].excerpt, '文档证据')
})

test('one authenticated answer maps to one stable task identity', () => {
  const first = taskIdFromAssistantAnswer('answer-message-1')
  assert.match(first, /^task_memory_[a-f0-9]{32}$/)
  assert.equal(first, taskIdFromAssistantAnswer('answer-message-1'))
  assert.notEqual(first, taskIdFromAssistantAnswer('answer-message-2'))
  assert.throws(() => taskIdFromAssistantAnswer(''), /回答消息 ID/)
})

test('task evidence hotsets retain cross-source identities and enrich repeated evidence', () => {
  const merged = mergeTaskEvidenceHotset([{
    sourceId: 'wechat',
    sessionId: 'shared',
    messageId: 'same',
    timestamp: 10,
    sender: '',
    excerpt: '短'
  }, {
    sourceId: 'mail',
    sessionId: 'shared',
    messageId: 'same',
    timestamp: 11,
    sender: '邮件发送者',
    excerpt: '邮件证据'
  }], [{
    sourceId: 'wechat',
    sessionId: 'shared',
    messageId: 'same',
    timestamp: 12,
    sender: '微信发送者',
    excerpt: '更完整的微信证据'
  }])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map(item => item.sourceId), ['mail', 'wechat'])
  assert.equal(merged[1].sender, '微信发送者')
  assert.equal(merged[1].excerpt, '更完整的微信证据')
  assert.equal(merged[1].timestamp, 12)

  const bounded = mergeTaskEvidenceHotset([], Array.from({ length: 55 }, (_, index) => ({
    sourceId: 'wechat',
    sessionId: 'group',
    messageId: `message-${index}`,
    timestamp: index,
    sender: '群友',
    excerpt: String(index)
  })))
  assert.equal(bounded.length, 50)
  assert.equal(bounded[0].messageId, 'message-5')
  assert.equal(bounded.at(-1)?.messageId, 'message-54')
})
