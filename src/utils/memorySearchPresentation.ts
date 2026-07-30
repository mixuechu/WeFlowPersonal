export type MemoryEvidence = {
  messageId: string
  sessionId: string
  timestamp: number
  sender: string
  excerpt: string
  role: string
}

const TYPE_ORDER = ['entity', 'relation', 'claim', 'event', 'task', 'resource']

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  entity: '实体',
  relation: '关系',
  claim: '事实',
  event: '事件',
  task: '待办',
  resource: '原始资料'
}

export function normalizeMemoryEvidence(input: any): MemoryEvidence {
  const timestamp = Number(input?.timestamp || 0)
  return {
    messageId: String(input?.message_id ?? input?.messageId ?? ''),
    sessionId: String(input?.session_id ?? input?.sessionId ?? ''),
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    sender: String(input?.sender || ''),
    excerpt: String(input?.excerpt || ''),
    role: String(input?.evidence_role ?? input?.evidenceRole ?? 'support')
  }
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
