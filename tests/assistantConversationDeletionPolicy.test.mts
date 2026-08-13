import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASSISTANT_CONVERSATION_DELETE_CONFIRMATION,
  assertAssistantConversationDeletionConfirmation,
  buildAssistantConversationDeletionPreviewToken
} from '../electron/services/assistantConversationDeletionPolicy.ts'

test('assistant conversation deletion token binds conversation and complete identity', () => {
  const identity = {
    conversationId: 'conversation-1',
    identitySha256: 'a'.repeat(64)
  }
  const previewToken = buildAssistantConversationDeletionPreviewToken(identity)
  assert.doesNotThrow(() => assertAssistantConversationDeletionConfirmation({
    previewToken,
    confirmation: ASSISTANT_CONVERSATION_DELETE_CONFIRMATION
  }, identity))
  assert.throws(() => assertAssistantConversationDeletionConfirmation({
    previewToken,
    confirmation: ASSISTANT_CONVERSATION_DELETE_CONFIRMATION
  }, {
    ...identity,
    identitySha256: 'b'.repeat(64)
  }), /预览后发生了变化/)
  assert.throws(() => assertAssistantConversationDeletionConfirmation({
    previewToken,
    confirmation: ASSISTANT_CONVERSATION_DELETE_CONFIRMATION
  }, {
    ...identity,
    conversationId: 'conversation-2'
  }), /预览后发生了变化/)
})

test('assistant conversation deletion requires the exact visible confirmation', () => {
  const identity = {
    conversationId: 'conversation-1',
    identitySha256: 'a'.repeat(64)
  }
  assert.throws(() => assertAssistantConversationDeletionConfirmation({
    previewToken: buildAssistantConversationDeletionPreviewToken(identity),
    confirmation: '永久删除'
  }, identity), /请输入“删除对话”/)
})
