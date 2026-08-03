import crypto from 'node:crypto'

export const ASSISTANT_CONVERSATION_DELETE_CONFIRMATION = '删除对话'

export type AssistantConversationDeletionIdentity = {
  conversationId: string
  identitySha256: string
}

export function buildAssistantConversationDeletionPreviewToken(
  identity: AssistantConversationDeletionIdentity
): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    action: 'delete_assistant_conversation',
    conversationId: String(identity.conversationId || '').trim(),
    identitySha256: String(identity.identitySha256 || '').trim()
  })).digest('hex')
}

export function assertAssistantConversationDeletionConfirmation(input: {
  previewToken?: string
  confirmation?: string
}, current: AssistantConversationDeletionIdentity): void {
  const expectedToken = buildAssistantConversationDeletionPreviewToken(current)
  if (!input?.previewToken || input.previewToken !== expectedToken) {
    throw new Error('问答历史在预览后发生了变化，请重新核对删除范围')
  }
  if (String(input.confirmation || '') !== ASSISTANT_CONVERSATION_DELETE_CONFIRMATION) {
    throw new Error(`请输入“${ASSISTANT_CONVERSATION_DELETE_CONFIRMATION}”确认删除`)
  }
}
