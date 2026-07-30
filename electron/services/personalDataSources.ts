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
    displayName: '邮件',
    description: '预留标准邮件连接器；凭证和范围将由用户单独授权',
    available: false,
    localOnly: false,
    capabilities: ['incremental', 'original-evidence', 'tasks', 'claims', 'events', 'attachments']
  },
  {
    id: 'calendar',
    kind: 'calendar',
    displayName: '日历',
    description: '预留日历连接器；事件、参与人和提醒将保留来源证据',
    available: false,
    localOnly: false,
    capabilities: ['incremental', 'original-evidence', 'tasks', 'events']
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
