export type PersonalDataSourceKind = 'chat' | 'email' | 'calendar' | 'document'
export type PersonalDataSourceCapability =
  | 'incremental'
  | 'original-evidence'
  | 'tasks'
  | 'claims'
  | 'events'
  | 'attachments'

export type PersonalDataSourceItem = {
  sourceId: string
  externalId: string
  kind: 'message' | 'email' | 'calendar-event' | 'document'
  occurredAt: string
  title: string
  content: string
  scopeId?: string
  scopeName?: string
  participants?: Array<{ id: string; name: string; role?: string }>
  metadata?: Record<string, unknown>
}

export type PersonalDataSourcePullResult = {
  items: PersonalDataSourceItem[]
  nextCheckpoint: string
  hasMore: boolean
  warnings?: string[]
}

export interface PersonalDataSourceConnector {
  id: string
  kind: PersonalDataSourceKind
  displayName: string
  description: string
  available: boolean
  localOnly: boolean
  capabilities: readonly PersonalDataSourceCapability[]
  pull(input: { checkpoint: string; limit: number; signal?: AbortSignal }): Promise<PersonalDataSourcePullResult>
}

export const PERSONAL_DATA_SOURCE_CATALOG = [
  {
    id: 'wechat',
    kind: 'chat',
    displayName: '微信',
    description: '本机微信消息、联系人、群成员、语音、图片和附件',
    available: true,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence', 'tasks', 'claims', 'events', 'attachments']
  },
  {
    id: 'mail',
    kind: 'email',
    displayName: 'macOS Mail',
    description: '只读索引你明确授权并选择的 Mail 邮箱；正文默认仅保存在本机',
    available: false,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence', 'attachments']
  },
  {
    id: 'calendar',
    kind: 'calendar',
    displayName: 'macOS 日历',
    description: '只读索引你明确授权并选择的日历；事件和参与人保留原始证据',
    available: false,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence', 'events']
  },
  {
    id: 'documents',
    kind: 'document',
    displayName: '本机文档目录',
    description: '预留文件夹连接器；支持断点扫描、内容哈希和本地解析',
    available: false,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence', 'claims', 'events', 'attachments']
  }
] as const

export function normalizeDataSourceClaimNature(
  sourceId: string,
  requested: string
): 'self_statement' | 'other_statement' | 'inference' {
  const normalized = ['self_statement', 'other_statement', 'inference'].includes(requested)
    ? requested as 'self_statement' | 'other_statement' | 'inference'
    : 'inference'
  return sourceId === 'documents' && normalized === 'self_statement'
    ? 'other_statement'
    : normalized
}

export function classifyDocumentTaskOwnership(
  modelClassification: string,
  content: string,
  ownerTerms: string[]
): 'mine' | 'uncertain' | 'others' {
  if (modelClassification === 'others') return 'others'
  const normalizedContent = String(content || '').toLowerCase()
  const explicitlyNamesOwner = ownerTerms
    .map(term => String(term || '').trim().toLowerCase())
    .filter(Boolean)
    .some(term => normalizedContent.includes(term))
  return modelClassification === 'mine' && explicitlyNamesOwner ? 'mine' : 'uncertain'
}

export function filterModelEligibleMemoryResults(
  results: any[],
  sourcePolicies: Record<string, { allowModelAnalysis?: boolean }> = {}
): any[] {
  return (results || []).filter(item => {
    if (getMemoryEvidenceEligibility(item).visibility === 'excluded') return false
    if (item?.metadata?.modelAnalysisAllowed === false) return false
    const sourceId = String(item?.metadata?.sourceId || '')
    if (!sourceId) return true
    const policy = sourcePolicies[sourceId]
    return !policy || policy.allowModelAnalysis !== false
  })
}

export type MemoryEvidenceEligibility = {
  status: 'candidate' | 'confirmed' | 'rejected' | 'cancelled' | 'not_applicable'
  visibility: 'normal' | 'excluded'
  canSupportFacts: boolean
  trustLabel: string
  policyReason: string
}

/**
 * One policy shared by local search presentation and outbound model context.
 * `status` is epistemic only for extracted claims, relations and events; task
 * workflow states such as `todo` or `cancelled` must not accidentally become
 * trust judgements.
 */
export function getMemoryEvidenceEligibility(item: any): MemoryEvidenceEligibility {
  const type = String(item?.document_type || item?.type || '')
  const epistemic = ['claim', 'relation', 'event'].includes(type)
  const rawStatus = epistemic ? String(item?.metadata?.status || item?.status || '') : ''
  const status = (['candidate', 'confirmed', 'rejected', 'cancelled'].includes(rawStatus)
    ? rawStatus
    : 'not_applicable') as MemoryEvidenceEligibility['status']
  const hasEvidence = Array.isArray(item?.evidence) && item.evidence.length > 0

  if (status === 'rejected') {
    return {
      status,
      visibility: 'excluded',
      canSupportFacts: false,
      trustLabel: '已拒绝',
      policyReason: '人工已判定不准确，默认搜索与模型上下文均排除'
    }
  }
  if (status === 'candidate') {
    return {
      status,
      visibility: 'normal',
      canSupportFacts: false,
      trustLabel: '待确认',
      policyReason: '模型抽取候选仅用于审阅和继续检索，不能支持事实结论'
    }
  }
  if (status === 'cancelled') {
    return {
      status,
      visibility: 'normal',
      canSupportFacts: false,
      trustLabel: '已取消',
      policyReason: '仅保留为历史状态，不能支持当前或已发生事实结论'
    }
  }
  if (status === 'confirmed') {
    return {
      status,
      visibility: 'normal',
      canSupportFacts: hasEvidence,
      trustLabel: '已确认',
      policyReason: hasEvidence ? '已确认且包含原始证据' : '已确认但缺少原始证据'
    }
  }
  return {
    status,
    visibility: 'normal',
    canSupportFacts: hasEvidence,
    trustLabel: hasEvidence ? '原始资料' : '检索线索',
    policyReason: hasEvidence ? '非推断型资料且包含原始证据' : '缺少原始证据'
  }
}

export function buildModelMemoryContext(
  results: any[],
  sourcePolicies: Record<string, { allowModelAnalysis?: boolean }> = {},
  limit = 20
): any[] {
  return filterModelEligibleMemoryResults(results, sourcePolicies)
    .slice(0, Math.max(0, limit))
    .map(item => {
      const eligibility = getMemoryEvidenceEligibility(item)
      return {
        documentId: item.id,
        sourceId: item.source_id,
        type: item.document_type,
        title: item.title,
        content: item.search_text,
        status: eligibility.status,
        trustLabel: eligibility.trustLabel,
        evidencePolicy: eligibility.policyReason,
        evidence: item.evidence,
        evidenceTotal: Math.max(
          Array.isArray(item.evidence) ? item.evidence.length : 0,
          Number(item.evidenceTotal || 0)
        ),
        canSupportFacts: eligibility.canSupportFacts
      }
    })
}

export function finalizeGroundedMemoryAnswer(
  parsed: any,
  context: any[]
): { answer: string; citationIds: string[]; citations: any[] } {
  const allowed = new Set((context || [])
    .filter(item => item.canSupportFacts === true && Array.isArray(item.evidence) && item.evidence.length > 0)
    .map(item => String(item.documentId)))
  const citationIds = [...new Set((Array.isArray(parsed?.citationIds) ? parsed.citationIds : [])
    .map(String)
    .filter((id: string) => allowed.has(id)))]
  const citations = (context || []).filter(item => citationIds.includes(String(item.documentId)))
  const proposedAnswer = String(parsed?.answer || '').trim()
  return {
    answer: (citationIds.length
      ? proposedAnswer || '没有足够证据回答。'
      : '没有足够的已确认原始证据回答。检索到的待确认候选或线索不会被当作事实。').slice(0, 6000),
    citationIds,
    citations
  }
}

function validateItem(connector: PersonalDataSourceConnector, item: PersonalDataSourceItem): void {
  if (item.sourceId !== connector.id) throw new Error(`数据源 ${connector.id} 返回了错误的 sourceId`)
  if (!String(item.externalId || '').trim()) throw new Error(`数据源 ${connector.id} 返回了空 externalId`)
  if (!Number.isFinite(Date.parse(item.occurredAt))) throw new Error(`数据源 ${connector.id} 返回了无效时间`)
  if (!String(item.content || '').trim() && !String(item.title || '').trim()) {
    throw new Error(`数据源 ${connector.id} 返回了空内容`)
  }
}

export async function runPersonalDataSourceBatch(
  connector: PersonalDataSourceConnector,
  checkpoint: string,
  consume: (items: PersonalDataSourceItem[]) => Promise<void>,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<{ checkpoint: string; pulled: number; hasMore: boolean; warnings: string[] }> {
  if (!connector.available) throw new Error(`数据源 ${connector.displayName} 尚不可用`)
  const result = await connector.pull({
    checkpoint,
    limit: Math.max(1, Math.min(1000, Number(options.limit || 200))),
    signal: options.signal
  })
  const unique = new Map<string, PersonalDataSourceItem>()
  for (const item of result.items || []) {
    validateItem(connector, item)
    unique.set(item.externalId, item)
  }
  const items = [...unique.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  await consume(items)
  return {
    checkpoint: String(result.nextCheckpoint || checkpoint),
    pulled: items.length,
    hasMore: Boolean(result.hasMore),
    warnings: (result.warnings || []).map(value => String(value).slice(0, 500)).slice(0, 20)
  }
}
