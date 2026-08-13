import { createHash } from 'node:crypto'

export interface ConversationSourceCursorState {
  cursor: number | null
  offset: number | null
}

export const readConversationSourceCursorState = (
  cursorState: any,
  sessionId: string
): ConversationSourceCursorState => ({
  cursor: Object.prototype.hasOwnProperty.call(cursorState?.sessionCursors || {}, sessionId)
    ? Number(cursorState.sessionCursors[sessionId])
    : null,
  offset: Object.prototype.hasOwnProperty.call(cursorState?.sessionOffsets || {}, sessionId)
    ? Number(cursorState.sessionOffsets[sessionId])
    : null
})

export const buildConversationSourceCursorToken = (
  sessionId: string,
  state: ConversationSourceCursorState
): string => createHash('sha256').update(JSON.stringify([
  'conversation-source-cursor-v1',
  String(sessionId || ''),
  Number.isFinite(state.cursor) ? state.cursor : null,
  Number.isFinite(state.offset) ? state.offset : null
])).digest('hex')

export const classifyConversationSourceMutationRecovery = (
  cursorState: any,
  beforeTokens: Record<string, string>,
  afterTokens: Record<string, string>
): 'apply' | 'abandon' | 'conflict' => {
  const ids = [...new Set([...Object.keys(beforeTokens || {}), ...Object.keys(afterTokens || {})])]
  if (!ids.length) return 'conflict'
  const currentToken = (id: string) => buildConversationSourceCursorToken(
    id,
    readConversationSourceCursorState(cursorState, id)
  )
  if (ids.every(id => currentToken(id) === String(afterTokens?.[id] || ''))) return 'apply'
  if (ids.every(id => currentToken(id) === String(beforeTokens?.[id] || ''))) return 'abandon'
  return 'conflict'
}
