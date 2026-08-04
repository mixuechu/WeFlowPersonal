import { createHash } from 'node:crypto'

export type TaskCitationEvidence = {
  sourceId: string
  sessionId: string
  messageId: string
  timestamp: number
  sender: string
  excerpt: string
}

function inferEvidenceSourceId(item: any): string {
  const explicit = String(item?.source_id ?? item?.sourceId ?? '').trim()
  if (explicit) return explicit.slice(0, 120)
  const sessionId = String(item?.session_id ?? item?.sessionId ?? '').trim()
  const dataSource = sessionId.match(/^data-source:([^:]+)/)?.[1]
  if (dataSource) return dataSource.slice(0, 120)
  const messageId = String(item?.message_id ?? item?.messageId ?? '').trim()
  return messageId.match(/^(wechat|documents|calendar|mail):/)?.[1] || 'legacy'
}

export function buildTaskEvidenceFromCitations(
  citations: unknown,
  limit = 30
): TaskCitationEvidence[] {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)))
  const unique = new Map<string, TaskCitationEvidence>()
  for (const citation of Array.isArray(citations) ? citations : []) {
    for (const item of Array.isArray(citation?.evidence) ? citation.evidence : []) {
      const messageId = String(item?.message_id ?? item?.messageId ?? '').trim()
      if (!messageId) continue
      const normalized: TaskCitationEvidence = {
        sourceId: inferEvidenceSourceId(item),
        sessionId: String(item?.session_id ?? item?.sessionId ?? '').trim().slice(0, 512),
        messageId: messageId.slice(0, 1000),
        timestamp: Number.isFinite(Number(item?.timestamp)) ? Number(item.timestamp) : 0,
        sender: String(item?.sender || '').slice(0, 500),
        excerpt: String(item?.excerpt || '').slice(0, 2000)
      }
      const identity = [
        normalized.sourceId,
        normalized.sessionId,
        normalized.messageId
      ].join('\u0000')
      if (!unique.has(identity)) unique.set(identity, normalized)
      if (unique.size >= boundedLimit) return [...unique.values()]
    }
  }
  return [...unique.values()]
}

export function taskIdFromAssistantAnswer(assistantMessageId: unknown): string {
  const normalized = String(assistantMessageId || '').trim()
  if (!normalized) throw new Error('缺少本机回答消息 ID')
  return `task_memory_${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`
}
