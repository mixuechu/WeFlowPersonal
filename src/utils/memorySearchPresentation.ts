export type MemoryEvidence = {
  sourceId: string
  messageId: string
  sessionId: string
  sessionName: string
  timestamp: number
  sender: string
  excerpt: string
  role: string
}

export const MEMORY_SOURCE_LABELS: Record<string, string> = {
  wechat: '微信',
  documents: '本机文档',
  calendar: 'macOS 日历',
  mail: 'macOS Mail',
  legacy: '历史来源未标注'
}

function inferEvidenceSourceId(input: any): string {
  const explicit = String(input?.source_id ?? input?.sourceId ?? '').trim()
  if (explicit) return explicit
  const sessionId = String(input?.session_id ?? input?.sessionId ?? '').trim()
  const dataSource = sessionId.match(/^data-source:([^:]+)/)?.[1]
  if (dataSource) return dataSource
  const messageId = String(input?.message_id ?? input?.messageId ?? '').trim()
  const evidenceKey = String(input?.evidence_key ?? input?.evidenceKey ?? '').trim()
  return messageId.match(/^(wechat|documents|calendar|mail):/)?.[1]
    || evidenceKey.match(/^([^:]+):/)?.[1]
    || 'legacy'
}

export function memoryEvidenceSourceLabel(input: any): string {
  const sourceId = typeof input === 'string' ? input : inferEvidenceSourceId(input)
  return MEMORY_SOURCE_LABELS[sourceId] || sourceId || MEMORY_SOURCE_LABELS.legacy
}

const TYPE_ORDER = ['entity', 'relation', 'claim', 'event', 'task', 'resource']

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  entity: '实体',
  relation: '关系',
  claim: '事实',
  event: '事件',
  task: '待办',
  resource: '原始资料',
  graph_review: '图谱候选原文'
}

export function normalizeMemoryEvidence(input: any): MemoryEvidence {
  const timestamp = Number(input?.timestamp || 0)
  return {
    sourceId: inferEvidenceSourceId(input),
    messageId: String(input?.message_id ?? input?.messageId ?? ''),
    sessionId: String(input?.session_id ?? input?.sessionId ?? ''),
    sessionName: String(input?.session_name ?? input?.sessionName ?? ''),
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    sender: String(input?.sender || ''),
    excerpt: String(input?.excerpt || ''),
    role: String(input?.evidence_role ?? input?.evidenceRole ?? input?.role ?? 'support')
  }
}

export type WechatEvidenceNavigation = {
  sessionId: string
  messageId: number
}

export function wechatEvidenceNavigation(input: any): WechatEvidenceNavigation | null {
  const evidence = normalizeMemoryEvidence(input)
  const messageId = evidenceLocalMessageId(evidence)
  if (evidence.sourceId !== 'wechat' || !evidence.sessionId || !messageId) return null
  return { sessionId: evidence.sessionId, messageId }
}

export function evidenceNavigationUnavailableReason(input: any): string {
  const evidence = normalizeMemoryEvidence(input)
  if (wechatEvidenceNavigation(evidence)) return ''
  if (evidence.sourceId !== 'wechat') {
    return `${memoryEvidenceSourceLabel(evidence)}证据不支持微信原消息跳转`
  }
  if (!evidence.sessionId) return '微信会话身份缺失，无法打开原消息'
  return '微信消息身份不可用，无法打开原消息'
}

export function evidenceLocalMessageId(input: any): number | null {
  const raw = String(input?.message_id ?? input?.messageId ?? '').trim()
  const candidate = /^\d+$/.test(raw) ? raw : raw.match(/^wechat:.+:(\d+)$/)?.[1]
  if (!candidate) return null
  const value = Number(candidate)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function groupMemorySearchResults(results: any[]): Array<{ type: string; label: string; results: any[] }> {
  const grouped = new Map<string, any[]>()
  for (const result of results || []) {
    const type = String(result?.document_type || 'other')
    grouped.set(type, [...(grouped.get(type) || []), result])
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => {
      const leftIndex = TYPE_ORDER.indexOf(left)
      const rightIndex = TYPE_ORDER.indexOf(right)
      return (leftIndex < 0 ? TYPE_ORDER.length : leftIndex) -
        (rightIndex < 0 ? TYPE_ORDER.length : rightIndex) || left.localeCompare(right)
    })
    .map(([type, groupedResults]) => ({
      type,
      label: MEMORY_TYPE_LABELS[type] || type,
      results: groupedResults
    }))
}
