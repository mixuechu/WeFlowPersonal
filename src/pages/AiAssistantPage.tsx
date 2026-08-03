import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Bot, CalendarDays, Check, Clock3, Filter, Network, Paperclip, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { buildTaskCalendar, shanghaiToday } from '../utils/taskCalendar'
import type { ReviewStatusFilter } from '../utils/graphReviewFilters'
import { evidenceLocalMessageId, groupMemorySearchResults, memoryEvidenceSourceLabel, MEMORY_TYPE_LABELS, normalizeMemoryEvidence, type MemoryEvidence } from '../utils/memorySearchPresentation'
import { LatestRequestGate } from '../utils/latestRequestGate'
import { buildMemorySessionScope } from '../utils/memorySessionScope'
import { evidenceArchiveIdentity } from '../../shared/evidencePayload'
import './AiAssistantPage.scss'

type Task = {
  id: string
  title: string
  detail?: string
  owner?: string
  collaborators?: string[]
  project?: string
  dependsOnIds?: string[]
  taskKind?: 'action' | 'delegated' | 'waiting'
  due?: string
  source?: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
  status: 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled'
  classification?: 'mine' | 'uncertain' | 'others'
  assignmentEvidence?: string
  ownershipPolicyReason?: string
  createdAt?: string
  updatedAt?: string
  mutationToken?: string
  evidence?: Array<{ messageId: string; timestamp: number; sender: string; excerpt: string }>
}

type MemoryEvidenceArchiveFilters = {
  query: string
  source: string
  session: string
  sender: string
  role: 'direct' | 'indirect' | 'contradiction' | 'support' | 'original' | ''
  from: string
  to: string
}

const EMPTY_MEMORY_EVIDENCE_FILTERS: MemoryEvidenceArchiveFilters = {
  query: '',
  source: '',
  session: '',
  sender: '',
  role: '',
  from: '',
  to: ''
}

function memoryEvidenceTimestamp(value: string, end = false): number {
  const iso = shanghaiInputToIso(value)
  const timestamp = iso ? Math.floor(Date.parse(iso) / 1000) : 0
  return timestamp > 0 ? timestamp + (end ? 59 : 0) : 0
}

function taskHistoryValue(value: string): string {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.join('、') : String(parsed || '空')
  } catch {
    return value || '空'
  }
}

function isoToShanghaiInput(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function shanghaiInputToIso(value?: string): string {
  const normalized = String(value || '').trim()
  return normalized ? new Date(`${normalized}:00+08:00`).toISOString() : ''
}

function evidenceTime(timestamp: number): string {
  if (!Number(timestamp)) return '时间未知'
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  return new Date(milliseconds).toLocaleString('zh-CN')
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function memorySourceLabels(item: { source_id?: string; source_ids?: string }): string {
  const ids = [...new Set(String(item.source_ids || item.source_id || '')
    .split(',').map(value => value.trim()).filter(Boolean))]
  const labels: Record<string, string> = {
    wechat: '微信',
    documents: '本机文档',
    calendar: 'macOS 日历',
    mail: 'Mail',
    legacy: '历史未知来源'
  }
  return ids.map(id => labels[id] || id).join('、') || '历史未知来源'
}

function EvidenceRows({
  evidence: rawEvidence,
  total,
  roleLabels = false,
  onOpenArchive
}: {
  evidence?: any[]
  total?: number
  roleLabels?: boolean
  onOpenArchive?: () => void
}) {
  const evidence = (rawEvidence || []).map(normalizeMemoryEvidence)
  if (!evidence.length) return <>
    <small className="assistant-evidence-empty">尚无已加载的原文证据</small>
    {Number(total || 0) > 0 && onOpenArchive && <button
      className="assistant-open-evidence-archive"
      onClick={onOpenArchive}>
      读取全部 {Number(total || 0)} 条原文
    </button>}
  </>
  return <>
    {evidence.map((item, index) => {
      const localMessageId = evidenceLocalMessageId(item)
      const role = item.role === 'indirect' ? '间接证据'
        : item.role === 'contradiction' ? '反证'
          : roleLabels ? '直接证据' : '证据'
      return <div className="assistant-evidence-row" key={`${item.sourceId}-${item.sessionId}-${item.messageId}-${index}`}>
        <small>{role} · {memoryEvidenceSourceLabel(item)} · {item.sender || '发送者未知'} · {evidenceTime(item.timestamp)}：“{item.excerpt}”</small>
        {item.sessionId && localMessageId && <button onClick={() =>
          void window.electronAPI.window.openChatHistoryWindow(item.sessionId, localMessageId)}>打开原消息</button>}
      </div>
    })}
    {Number(total || 0) > evidence.length && <small className="assistant-evidence-limit">
      当前显示最近 {evidence.length} / {total} 条。
    </small>}
    {Number(total || 0) > evidence.length && onOpenArchive && <button
      className="assistant-open-evidence-archive"
      onClick={onOpenArchive}>
      查看全部 {Number(total || 0)} 条原文
    </button>}
  </>
}

function memoryAuditStatusLabel(value: string): string {
  return value === 'confirmed' ? '已确认'
    : value === 'rejected' ? '不准确'
      : value === 'cancelled' ? '已取消' : '待确认'
}

function schedulerCatchupResultLabel(value: string): string {
  return ({
    assistant_disabled: 'AI 助理当时处于关闭状态，未自动补齐',
    sync_already_running: '已有增量整理正在运行，无需重复启动',
    backlog_throttled: '积压补齐仍在一分钟防重复窗口内',
    backlog_catchup_attempted: '已立即继续高流量积压补齐',
    before_daily_schedule: '尚未到每日整理时间，保留正常计划',
    daily_already_complete: '当天完整整理已经完成',
    scheduled_retry_cooling_down: '失败来源仍在持久退避期，未绕过冷却',
    daily_throttled: '每日整理仍在防重复窗口内',
    daily_partial_saved: '已保存成功部分，剩余内容继续按 checkpoint 重试',
    daily_completed: '已完成当天全部来源的补齐',
    daily_failed_saved: '本次失败已保存，后续按退避时间重试',
    resume_incremental_completed: '已按上次时间戳完成唤醒后的普通增量补齐',
    resume_incremental_partial: '已保存唤醒补齐的成功部分，剩余内容继续续跑',
    resume_incremental_failed: '唤醒增量补齐失败，原 checkpoint 未前移',
    resume_incremental_throttled: '距上次同步尝试不足 15 分钟，已避免重复请求',
    resume_retry_throttled: '唤醒补齐重试仍在一分钟防重复窗口内',
    resume_retry_completed: '网络恢复后已自动完成唤醒补齐',
    resume_retry_partial: '网络恢复重试已保存成功部分，仍将继续',
    resume_retry_failed: '网络仍不可用或来源失败，已推进持久退避'
  } as Record<string, string>)[value] || value || '尚无结果'
}

function memoryAuditSnapshotText(kind: 'claim' | 'event', value: any): string {
  if (kind === 'claim') {
    const object = value?.value || (value?.objectEntityId ? `实体 ${value.objectEntityId}` : '空值')
    const validity = value?.validFrom || value?.validTo
      ? ` · 有效期 ${value.validFrom || '未知'}—${value.validTo || '至今'}` : ''
    return `${value?.predicate || '事实'}：${value?.polarity === 'negative' ? '否定 ' : ''}${object}` +
      ` · ${memoryAuditStatusLabel(value?.status || '')}${validity}`
  }
  return `${value?.title || '未命名事件'} · ${value?.eventType || '事件'}` +
    `${value?.startAt || value?.endAt ? ` · ${value.startAt || '未知'}—${value.endAt || '未结束'}` : ''}` +
    `${value?.location ? ` · ${value.location}` : ''} · ${memoryAuditStatusLabel(value?.status || '')}`
}

function MemoryItemAuditRows({ kind, items }: { kind: 'claim' | 'event'; items: any[] }) {
  return <div className="assistant-evidence-stack">
    {items.map(item => item.auditKind === 'correction'
      ? <small key={item.id}>
          <b>本人纠正</b> · {new Date(item.createdAt).toLocaleString('zh-CN')}<br />
          修正前：{memoryAuditSnapshotText(kind, item.before)}<br />
          修正后：{memoryAuditSnapshotText(kind, item.after)}
        </small>
      : <small key={item.id}>
          <b>{item.actor === 'system' ? '系统规则' : '本人操作'}</b> ·
          {memoryAuditStatusLabel(item.previousStatus)} → {memoryAuditStatusLabel(item.decision)}
          {' · '}{new Date(item.createdAt).toLocaleString('zh-CN')}
          {item.reason ? ` · ${item.reason}` : ''}
          {item.protectFromExtraction ? ' · 阻止模型覆盖' : ' · 不冻结模型更新'}
        </small>)}
  </div>
}

function setBoundedAuditCache(
  current: Record<string, any>,
  key: string,
  value: any,
  limit = 12
): Record<string, any> {
  const next = { ...current }
  delete next[key]
  next[key] = value
  for (const expired of Object.keys(next).slice(0, Math.max(0, Object.keys(next).length - limit))) {
    delete next[expired]
  }
  return next
}

function IngestionBatchAudit({ batch, run }: { batch: any; run: any }) {
  return <article className={batch.status}>
    <div><b>批次 {Number(batch.batch_index) + 1}</b><span>{batch.status} · {batch.message_count} 条 · 尝试 {batch.attempts} 次</span></div>
    <small>{batch.model || run.model} · {batch.prompt_version || run.prompt_version}{batch.schema_version ? ` / ${batch.schema_version}` : ''}</small>
    <small>Token {Number(batch.input_tokens || 0).toLocaleString()} 入 / {Number(batch.output_tokens || 0).toLocaleString()} 出 · {(Number(batch.duration_ms || 0) / 1000).toFixed(1)} 秒</small>
    {!!batch.sensitiveRedaction?.total && <small>
      发送前脱敏 {batch.sensitiveRedaction.total} 处 · {Object.entries(batch.sensitiveRedaction.counts || {})
        .map(([type, count]) => `${type} ${count}`).join('、')}
    </small>}
    {!!batch.structuredEvidence?.version && <small>
      结构化证据门禁：
      接受 {Object.values(batch.structuredEvidence.accepted || {}).reduce((sum: number, count: any) => sum + Number(count || 0), 0)} 项
      {' · '}拒绝 {Object.values(batch.structuredEvidence.rejected || {}).reduce((sum: number, count: any) => sum + Number(count || 0), 0)} 项无效引用
    </small>}
    {!!batch.extractionContext?.version && <small>
      可信长期上下文：
      实体 {Number(batch.extractionContext.totals?.selectedEntities ?? batch.extractionContext.selectedEntities ?? 0)}
      （直接命中 {Number(batch.extractionContext.totals?.directEntities ?? batch.extractionContext.directEntities ?? 0)}
      {' / '}一跳扩展 {Number(batch.extractionContext.totals?.expandedEntities ?? batch.extractionContext.expandedEntities ?? 0)}）
      {' · '}关系 {Number(batch.extractionContext.totals?.relations ?? batch.extractionContext.relations ?? 0)}
      {' · '}事实 {Number(batch.extractionContext.totals?.claims ?? batch.extractionContext.claims ?? 0)} / {Number(batch.extractionContext.totals?.claimMatches ?? batch.extractionContext.claimMatches ?? 0)}
      {' · '}事件 {Number(batch.extractionContext.totals?.events ?? batch.extractionContext.events ?? 0)} / {Number(batch.extractionContext.totals?.eventMatches ?? batch.extractionContext.eventMatches ?? 0)}
    </small>}
    {!!batch.extractionContext?.entities?.length && <details className="assistant-extraction-context-audit">
      <summary>
        查看模型当时使用的长期记忆清单
        {batch.extractionContext.inputFingerprint
          ? ` · 输入指纹 ${String(batch.extractionContext.inputFingerprint).slice(0, 12)}`
          : ''}
      </summary>
      <p>
        该清单只记录有界结构化记忆，不复制整段聊天。
        本批核心消息 {Number(batch.extractionContext.messageScope?.core || 0)} 条，
        重叠上下文 {Number(batch.extractionContext.messageScope?.context || 0)} 条。
      </p>
      <section>
        <b>实体与命中原因</b>
        {batch.extractionContext.entities.map((entity: any) =>
          <small key={entity.id}>{entity.name || entity.id} · {entity.type || 'entity'} · {(entity.reasons || []).join('、') || '可信上下文'}</small>)}
      </section>
      {!!batch.extractionContext.relations?.length && <section>
        <b>已确认关系</b>
        {batch.extractionContext.relations.map((relation: any) =>
          <small key={relation.id}>{relation.subject} — {relation.predicate} → {relation.object}</small>)}
      </section>}
      {!!batch.extractionContext.claims?.length && <section>
        <b>已确认事实</b>
        {batch.extractionContext.claims.map((claim: any) =>
          <small key={claim.id}>{claim.subject} · {claim.predicate} · {claim.polarity === 'negative' ? '非 ' : ''}{claim.value || '结构化实体'}</small>)}
      </section>}
      {!!batch.extractionContext.events?.length && <section>
        <b>已确认事件</b>
        {batch.extractionContext.events.map((event: any) =>
          <small key={event.id}>{event.title || event.type}{event.startAt ? ` · ${event.startAt}` : ''}</small>)}
      </section>}
    </details>}
    {batch.error && <p>{batch.error}</p>}
  </article>
}

function TrustedEntityPicker({
  value,
  selected,
  placeholder,
  ariaLabel,
  onSelect,
  onClear,
  onError,
  disabled = false
}: {
  value: string
  selected?: any
  placeholder: string
  ariaLabel: string
  onSelect: (entity: any) => void
  onClear: () => void
  onError?: (message: string) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const requestGate = useRef(new LatestRequestGate())

  useEffect(() => {
    setQuery(value && selected ? String(selected.canonicalName || '') : '')
  }, [value, selected])

  useEffect(() => {
    if (!open) return
    const request = requestGate.current.begin()
    const timer = window.setTimeout(() => {
      setLoading(true)
      void window.electronAPI.aiAssistant.getTrustedEntityDirectory({
        query: query.trim() || undefined,
        limit: 20,
        offset: 0
      }).then(result => {
        if (!requestGate.current.isCurrent(request)) return
        setOptions(result.items)
        setTotal(result.total)
        setRevision(result.revision)
      }).catch(error => {
        if (!requestGate.current.isCurrent(request)) return
        setOptions([])
        setTotal(0)
        setRevision('')
        onError?.(error?.message || String(error))
      }).finally(() => {
        if (requestGate.current.isCurrent(request)) setLoading(false)
      })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [open, query, onError])

  return <div className="assistant-memory-entity-picker"
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
    <div>
      <input
        disabled={disabled}
        value={query}
        onFocus={() => { if (!disabled) setOpen(true) }}
        onChange={event => {
          setQuery(event.target.value)
          onClear()
          setOpen(true)
        }}
        placeholder={placeholder}
        aria-label={ariaLabel} />
      {!disabled && (query || value) && <button type="button" aria-label={`清除${ariaLabel}`} onClick={() => {
        setQuery('')
        onClear()
        setOpen(false)
      }}>×</button>}
    </div>
    {selected && <small className="assistant-memory-entity-selected">
      已选：{selected.type} · {selected.id}
      {selected.canonicalNameCollisionCount > 1
        ? ` · ${selected.canonicalNameCollisionCount} 个同名实体，按 ID 精确选择`
        : selected.trustStatus && selected.trustStatus !== 'confirmed'
          ? ' · 此端实体尚未确认，请先完成实体审阅'
          : ' · 已确认实体'}
    </small>}
    {open && !disabled && <div className="assistant-memory-entity-options">
      {options.map(entity => {
        const identityHint = [
          ...(entity.accountIds || []),
          ...(entity.externalIdentities || []).flatMap((identity: any) =>
            [identity.displayName, identity.accountId]),
          ...(entity.aliases || [])
        ].filter(Boolean).slice(0, 3).join(' · ')
        return <button type="button" key={entity.id} onClick={() => {
          onSelect({ ...entity, directoryRevision: revision })
          setQuery(entity.canonicalName)
          setOpen(false)
        }}>
          <strong>{entity.canonicalName}</strong>
          <small>{entity.type} · {entity.id}
            {entity.canonicalNameCollisionCount > 1
              ? ` · ${entity.canonicalNameCollisionCount} 个同名`
              : ''}
          </small>
          {identityHint && <small>{identityHint}</small>}
        </button>
      })}
      {!loading && !options.length && <span>没有匹配的已确认实体</span>}
      {loading && <span>正在搜索全部可信实体…</span>}
      {!loading && total > options.length && <span>
        匹配 {total} 个，继续输入名称、别名或账号缩小范围
      </span>}
    </div>}
  </div>
}

function AiAssistantPage() {
  const [status, setStatus] = useState<any>(null)
  const [dashboard, setDashboard] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [graphQuery, setGraphQuery] = useState('')
  const [graphRelationType, setGraphRelationType] = useState('')
  const [graphRelationStatus, setGraphRelationStatus] = useState('')
  const [graphFocusDepth, setGraphFocusDepth] = useState(1)
  const [graphNodeLimit, setGraphNodeLimit] = useState(60)
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [graphWorkspace, setGraphWorkspace] = useState<any>({
    viewport: {
      entities: [], relations: [], levels: {}, mode: 'overview',
      totalAvailable: 0, truncated: 0, totalRelationsAvailable: 0,
      truncatedRelations: 0, matchingSeeds: 0, maxNodes: 60
    },
    summary: { entities: 0, relations: 0 },
    predicates: [],
    focus: null,
    revision: '',
    stale: false,
    status: 'idle'
  })
  const [graphWorkspaceRefreshKey, setGraphWorkspaceRefreshKey] = useState(0)
  const graphWorkspaceGate = useRef(new LatestRequestGate())
  const [showEntityDossier, setShowEntityDossier] = useState(false)
  const [entityDossierPages, setEntityDossierPages] = useState<any>({
    claims: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' },
    relations: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' },
    events: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' }
  })
  const [entityDossierLoadingMore, setEntityDossierLoadingMore] = useState<Record<string, boolean>>({})
  const [entityDossierRefreshKeys, setEntityDossierRefreshKeys] = useState({
    claims: 0, relations: 0, events: 0
  })
  const refreshEntityDossierSection = (kind: 'claims' | 'relations' | 'events') =>
    setEntityDossierRefreshKeys(current => ({ ...current, [kind]: current[kind] + 1 }))
  const [entityClaimQuery, setEntityClaimQuery] = useState('')
  const [entityClaimStatus, setEntityClaimStatus] = useState<'all' | 'candidate' | 'confirmed' | 'rejected'>('all')
  const [entityClaimSource, setEntityClaimSource] = useState<'all' | 'wechat' | 'documents' | 'calendar' | 'mail' | 'legacy'>('all')
  const [entityClaimFrom, setEntityClaimFrom] = useState('')
  const [entityClaimTo, setEntityClaimTo] = useState('')
  const [entityRelationQuery, setEntityRelationQuery] = useState('')
  const [entityRelationDirection, setEntityRelationDirection] = useState<'all' | 'outgoing' | 'incoming'>('all')
  const [entityRelationStatus, setEntityRelationStatus] = useState<'all' | 'candidate' | 'confirmed'>('all')
  const [entityRelationSource, setEntityRelationSource] = useState<'all' | 'wechat' | 'documents' | 'calendar' | 'mail' | 'legacy'>('all')
  const [entityEventQuery, setEntityEventQuery] = useState('')
  const [entityEventStatus, setEntityEventStatus] = useState<'all' | 'candidate' | 'confirmed' | 'rejected' | 'cancelled'>('all')
  const [entityEventSource, setEntityEventSource] = useState<'all' | 'wechat' | 'documents' | 'calendar' | 'mail' | 'legacy'>('all')
  const [entityEventFrom, setEntityEventFrom] = useState('')
  const [entityEventTo, setEntityEventTo] = useState('')
  const entityClaimGate = useRef(new LatestRequestGate())
  const entityRelationGate = useRef(new LatestRequestGate())
  const entityEventGate = useRef(new LatestRequestGate())
  const [entityEvidencePage, setEntityEvidencePage] = useState<any>({
    items: [], total: 0, hasMore: false, revision: '', status: 'idle'
  })
  const [entityEvidenceQuery, setEntityEvidenceQuery] = useState('')
  const [entityEvidenceSource, setEntityEvidenceSource] = useState('')
  const [entityEvidenceLoadingMore, setEntityEvidenceLoadingMore] = useState(false)
  const [entityEvidenceRefreshKey, setEntityEvidenceRefreshKey] = useState(0)
  const entityEvidenceGate = useRef(new LatestRequestGate())
  const [entityTaskLoadingMore, setEntityTaskLoadingMore] = useState(false)
  const entityTaskGate = useRef(new LatestRequestGate())
  const [entityAuditLoadingMore, setEntityAuditLoadingMore] = useState('')
  const entityAuditGate = useRef(new LatestRequestGate())
  const [briefingPeriod, setBriefingPeriod] = useState<'latest' | 'week'>('latest')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectDirectory, setProjectDirectory] = useState<any>({
    items: [], total: 0, hasMore: false, revision: '', loading: false
  })
  const [projectQuery, setProjectQuery] = useState('')
  const [projectPhase, setProjectPhase] = useState('')
  const [projectDirectoryLoadingMore, setProjectDirectoryLoadingMore] = useState(false)
  const [projectDirectoryRefreshKey, setProjectDirectoryRefreshKey] = useState(0)
  const projectDirectoryGate = useRef(new LatestRequestGate())
  const [projectWorkspace, setProjectWorkspace] = useState<any>({ project: null, status: 'idle' })
  const [projectWorkspaceRefreshKey, setProjectWorkspaceRefreshKey] = useState(0)
  const projectWorkspaceGate = useRef(new LatestRequestGate())
  const [projectTaskLoadingMore, setProjectTaskLoadingMore] = useState(false)
  const projectTaskGate = useRef(new LatestRequestGate())
  const [projectRiskLoadingMore, setProjectRiskLoadingMore] = useState(false)
  const projectRiskGate = useRef(new LatestRequestGate())
  const [projectMemoryPages, setProjectMemoryPages] = useState<any>({
    claims: { items: [], total: 0, hasMore: false, revision: '' },
    events: { items: [], total: 0, hasMore: false, revision: '' },
    status: 'idle'
  })
  const [projectMemoryLoadingMore, setProjectMemoryLoadingMore] = useState('')
  const [projectMemoryRefreshKey, setProjectMemoryRefreshKey] = useState(0)
  const projectMemoryGate = useRef(new LatestRequestGate())
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [taskWorkspace, setTaskWorkspace] = useState<any>({ task: null, history: [], status: 'idle' })
  const [taskWorkspaceRefreshKey, setTaskWorkspaceRefreshKey] = useState(0)
  const taskWorkspaceGate = useRef(new LatestRequestGate())
  const [forgettingEntityId, setForgettingEntityId] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showDataSources, setShowDataSources] = useState(false)
  const [sourceDirectory, setSourceDirectory] = useState<any>({
    items: [], total: 0, hasMore: false, revision: '', counts: {
      total: 0, enabled: 0, disabled: 0, group: 0, private: 0, groupEnabled: 0, privateEnabled: 0
    }
  })
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceTypeFilter, setSourceTypeFilter] = useState<'all' | 'group' | 'private'>('all')
  const [sourceEnabledFilter, setSourceEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const sourceDirectoryGate = useRef(new LatestRequestGate())
  const [dataSources, setDataSources] = useState<any[]>([])
  const [eventTimeline, setEventTimeline] = useState<{ items: any[]; total: number; hasMore: boolean; revision?: string; stale?: boolean }>({
    items: [], total: 0, hasMore: false
  })
  const [claimArchive, setClaimArchive] = useState<{ items: any[]; total: number; hasMore: boolean; revision?: string; stale?: boolean; loading?: boolean }>({
    items: [], total: 0, hasMore: false
  })
  const [claimArchiveRefreshKey, setClaimArchiveRefreshKey] = useState(0)
  const [eventTimelineRefreshKey, setEventTimelineRefreshKey] = useState(0)
  const [claimLoadingMore, setClaimLoadingMore] = useState(false)
  const [eventLoadingMore, setEventLoadingMore] = useState(false)
  const [claimEntityFilter, setClaimEntityFilter] = useState('')
  const [claimEntitySelection, setClaimEntitySelection] = useState<any>(null)
  const [claimSourceFilter, setClaimSourceFilter] = useState('')
  const [claimStatusFilter, setClaimStatusFilter] = useState('')
  const [claimPredicateFilter, setClaimPredicateFilter] = useState('')
  const [claimFrom, setClaimFrom] = useState('')
  const [claimTo, setClaimTo] = useState('')
  const [eventSourceFilter, setEventSourceFilter] = useState('')
  const [eventStatusFilter, setEventStatusFilter] = useState('')
  const [eventFrom, setEventFrom] = useState('')
  const [eventTo, setEventTo] = useState('')
  const [resourceArchive, setResourceArchive] = useState<any>({
    items: [], total: 0, hasMore: false, revision: '', status: 'idle'
  })
  const [resourceQuery, setResourceQuery] = useState('')
  const [resourceTypeFilter, setResourceTypeFilter] = useState('')
  const [resourceSourceFilter, setResourceSourceFilter] = useState<
    '' | 'wechat' | 'documents' | 'calendar' | 'mail' | 'legacy'
  >('')
  const [resourceFrom, setResourceFrom] = useState('')
  const [resourceTo, setResourceTo] = useState('')
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0)
  const [resourceLoadingMore, setResourceLoadingMore] = useState(false)
  const [selectedResourceDossier, setSelectedResourceDossier] = useState<any>(null)
  const [resourceTrashArchive, setResourceTrashArchive] = useState<any>({
    items: [], total: 0, hasMore: false, revision: '', status: 'idle'
  })
  const [resourceTrashOpen, setResourceTrashOpen] = useState(false)
  const [resourceTrashQuery, setResourceTrashQuery] = useState('')
  const [resourceTrashLoadingMore, setResourceTrashLoadingMore] = useState(false)
  const dashboardLoadGate = useRef(new LatestRequestGate())
  const claimArchiveGate = useRef(new LatestRequestGate())
  const eventTimelineGate = useRef(new LatestRequestGate())
  const resourceArchiveGate = useRef(new LatestRequestGate())
  const resourceDossierGate = useRef(new LatestRequestGate())
  const resourceTrashGate = useRef(new LatestRequestGate())
  const [calendarPicker, setCalendarPicker] = useState<{
    calendars: Array<{ id: string; title: string; source: string; type: string }>
    selectedIds: string[]
  } | null>(null)
  const [calendarConnecting, setCalendarConnecting] = useState(false)
  const [mailPicker, setMailPicker] = useState<{
    mailboxes: Array<{ id: string; accountId: string; accountName: string; path: string[]; displayName: string }>
    selectedIds: string[]
    allowModelAnalysis: boolean
  } | null>(null)
  const [mailConnecting, setMailConnecting] = useState(false)
  const [sourceQuery, setSourceQuery] = useState('')
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryResults, setMemoryResults] = useState<any[]>([])
  const [memorySearchState, setMemorySearchState] = useState<{
    status: 'idle' | 'waiting' | 'searching' | 'ready' | 'error'
    query: string
    error?: string
    total?: number
    hasMore?: boolean
    truncated?: boolean
    scopeCandidates?: number | null
    revision?: string
    nextOffset?: number
  }>({ status: 'idle', query: '' })
  const [memoryLoadingMore, setMemoryLoadingMore] = useState(false)
  const [memorySearchFeedback, setMemorySearchFeedback] = useState<any[]>([])
  const [memorySearchFeedbackSaving, setMemorySearchFeedbackSaving] = useState('')
  const [memorySearchRefreshKey, setMemorySearchRefreshKey] = useState(0)
  const memorySearchGate = useRef(new LatestRequestGate())
  const [memoryFeedbackArchiveOpen, setMemoryFeedbackArchiveOpen] = useState(false)
  const [memoryFeedbackArchive, setMemoryFeedbackArchive] = useState<any>({
    items: [], total: 0, hasMore: false, counts: {}, status: 'idle'
  })
  const [memoryFeedbackArchiveQuery, setMemoryFeedbackArchiveQuery] = useState('')
  const [memoryFeedbackArchiveAction, setMemoryFeedbackArchiveAction] = useState<'helpful' | 'not_relevant' | 'cleared' | ''>('')
  const [memoryFeedbackArchiveFrom, setMemoryFeedbackArchiveFrom] = useState('')
  const [memoryFeedbackArchiveTo, setMemoryFeedbackArchiveTo] = useState('')
  const [memoryFeedbackArchiveRefreshKey, setMemoryFeedbackArchiveRefreshKey] = useState(0)
  const [memoryFeedbackArchiveLoadingMore, setMemoryFeedbackArchiveLoadingMore] = useState(false)
  const memoryFeedbackArchiveGate = useRef(new LatestRequestGate())
  const [memoryFeedbackDeleteDialog, setMemoryFeedbackDeleteDialog] = useState<any>(null)
  const [memoryFeedbackDeleteConfirmation, setMemoryFeedbackDeleteConfirmation] = useState('')
  const memoryFeedbackDeleteGate = useRef(new LatestRequestGate())
  const [memoryEvidenceArchive, setMemoryEvidenceArchive] = useState<{
    documentType: string
    sourceId: string
    title: string
    items: any[]
    total: number
    unfilteredTotal: number
    hasMore: boolean
    filters: MemoryEvidenceArchiveFilters
    revision?: string
    stale?: boolean
    status: 'loading' | 'ready' | 'error'
    error?: string
  } | null>(null)
  const [memoryEvidenceFilters, setMemoryEvidenceFilters] = useState<MemoryEvidenceArchiveFilters>(
    EMPTY_MEMORY_EVIDENCE_FILTERS
  )
  const [memoryEvidenceLoadingMore, setMemoryEvidenceLoadingMore] = useState(false)
  const memoryEvidenceArchiveGate = useRef(new LatestRequestGate())
  const memoryConversationGate = useRef(new LatestRequestGate())
  const [conversationDeletionDialog, setConversationDeletionDialog] = useState<any>(null)
  const [conversationDeletionConfirmation, setConversationDeletionConfirmation] = useState('')
  const conversationDeletionGate = useRef(new LatestRequestGate())
  const [editingClaim, setEditingClaim] = useState<any>(null)
  const [editingEvent, setEditingEvent] = useState<any>(null)
  const [memoryItemAudits, setMemoryItemAudits] = useState<Record<string, any>>({})
  const [memoryItemAuditLoading, setMemoryItemAuditLoading] = useState('')
  const memoryItemAuditRequests = useRef<Record<string, symbol>>({})
  const [memoryDeletionDialog, setMemoryDeletionDialog] = useState<any>(null)
  const [memoryDeletionConfirmation, setMemoryDeletionConfirmation] = useState('')
  const memoryDeletionGate = useRef(new LatestRequestGate())
  const [entityForgetDialog, setEntityForgetDialog] = useState<any>(null)
  const [entityForgetConfirmation, setEntityForgetConfirmation] = useState('')
  const entityForgetGate = useRef(new LatestRequestGate())
  const [resourceDeletionDialog, setResourceDeletionDialog] = useState<any>(null)
  const [resourceDeletionConfirmation, setResourceDeletionConfirmation] = useState('')
  const resourceDeletionGate = useRef(new LatestRequestGate())
  const [memoryDeletionArchive, setMemoryDeletionArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [memoryDeletionKind, setMemoryDeletionKind] = useState<'all' | 'claim' | 'event' | 'relation'>('all')
  const [memoryDeletionReason, setMemoryDeletionReason] = useState<'all' | 'manual_delete' | 'not_important'>('all')
  const [memoryDeletionQuery, setMemoryDeletionQuery] = useState('')
  const [memoryDeletionFrom, setMemoryDeletionFrom] = useState('')
  const [memoryDeletionTo, setMemoryDeletionTo] = useState('')
  const [memoryDeletionLoadingMore, setMemoryDeletionLoadingMore] = useState(false)
  const [memoryDeletionArchiveRefreshKey, setMemoryDeletionArchiveRefreshKey] = useState(0)
  const memoryDeletionArchiveGate = useRef(new LatestRequestGate())
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskDependencyQuery, setTaskDependencyQuery] = useState('')
  const [taskDependencyCandidates, setTaskDependencyCandidates] = useState<any>({
    items: [], total: 0, revision: '', loading: false
  })
  const taskDependencyGate = useRef(new LatestRequestGate())
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | Task['status']>('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<'all' | Task['priority']>('all')
  const [taskKindFilter, setTaskKindFilter] = useState<'all' | NonNullable<Task['taskKind']>>('all')
  const [taskQuery, setTaskQuery] = useState('')
  const [focusedTaskId, setFocusedTaskId] = useState('')
  const [taskView, setTaskView] = useState<'list' | 'calendar'>('list')
  const [taskWorkset, setTaskWorkset] = useState<{
    items: Task[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [taskWorksetLoadingMore, setTaskWorksetLoadingMore] = useState(false)
  const [taskWorksetRefreshKey, setTaskWorksetRefreshKey] = useState(0)
  const taskWorksetGate = useRef(new LatestRequestGate())
  const [taskArchive, setTaskArchive] = useState<{
    items: Task[]
    total: number
    hasMore: boolean
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false })
  const [taskArchiveProjects, setTaskArchiveProjects] = useState<{
    items: Array<{ project: string; taskTotal: number; lastUpdatedAt: string }>
    total: number
    loading?: boolean
  }>({ items: [], total: 0 })
  const [taskArchiveStatus, setTaskArchiveStatus] = useState<'all' | 'done' | 'cancelled'>('all')
  const [taskArchivePriority, setTaskArchivePriority] = useState('')
  const [taskArchiveProject, setTaskArchiveProject] = useState('')
  const [taskArchiveQuery, setTaskArchiveQuery] = useState('')
  const [taskArchiveFrom, setTaskArchiveFrom] = useState('')
  const [taskArchiveTo, setTaskArchiveTo] = useState('')
  const [taskArchiveLoadingMore, setTaskArchiveLoadingMore] = useState(false)
  const [taskArchiveRefreshKey, setTaskArchiveRefreshKey] = useState(0)
  const taskArchiveGate = useRef(new LatestRequestGate())
  const taskArchiveProjectGate = useRef(new LatestRequestGate())
  const [taskOwnershipReviews, setTaskOwnershipReviews] = useState<{
    items: Task[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [taskOwnershipClassification, setTaskOwnershipClassification] = useState('')
  const [taskOwnershipPriority, setTaskOwnershipPriority] = useState('')
  const [taskOwnershipQuery, setTaskOwnershipQuery] = useState('')
  const [taskOwnershipFrom, setTaskOwnershipFrom] = useState('')
  const [taskOwnershipTo, setTaskOwnershipTo] = useState('')
  const [taskOwnershipLoadingMore, setTaskOwnershipLoadingMore] = useState(false)
  const [taskOwnershipRefreshKey, setTaskOwnershipRefreshKey] = useState(0)
  const taskOwnershipGate = useRef(new LatestRequestGate())
  const [taskFeedbackArchive, setTaskFeedbackArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: { active: number; revoked: number; all: number }
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: { active: 0, revoked: 0, all: 0 } })
  const [taskFeedbackStatus, setTaskFeedbackStatus] = useState<'all' | 'active' | 'revoked'>('all')
  const [taskFeedbackDecision, setTaskFeedbackDecision] = useState<'all' | 'mine' | 'rejected'>('all')
  const [taskFeedbackQuery, setTaskFeedbackQuery] = useState('')
  const [taskFeedbackFrom, setTaskFeedbackFrom] = useState('')
  const [taskFeedbackTo, setTaskFeedbackTo] = useState('')
  const [taskFeedbackLoadingMore, setTaskFeedbackLoadingMore] = useState(false)
  const [taskFeedbackRefreshKey, setTaskFeedbackRefreshKey] = useState(0)
  const [taskFeedbackDossier, setTaskFeedbackDossier] = useState<any>(null)
  const [taskFeedbackHistoryLoadingMore, setTaskFeedbackHistoryLoadingMore] = useState(false)
  const taskFeedbackArchiveGate = useRef(new LatestRequestGate())
  const taskFeedbackDossierGate = useRef(new LatestRequestGate())
  const [calendarMonth, setCalendarMonth] = useState(() => shanghaiToday().slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => shanghaiToday())
  const [pathFromId, setPathFromId] = useState('')
  const [pathToId, setPathToId] = useState('')
  const [pathFromSelection, setPathFromSelection] = useState<any>(null)
  const [pathToSelection, setPathToSelection] = useState<any>(null)
  const [graphPath, setGraphPath] = useState<any>(null)
  const [graphCommonNeighbors, setGraphCommonNeighbors] = useState<any>(null)
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({})
  const [entityNameEdits, setEntityNameEdits] = useState<Record<string, string>>({})
  const [relationEdits, setRelationEdits] = useState<Record<string, {
    subjectId: string
    predicate: string
    objectId: string
    subjectEntity?: any
    objectEntity?: any
  }>>({})
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({})
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>('pending')
  const [reviewKindFilter, setReviewKindFilter] = useState('')
  const [reviewQuery, setReviewQuery] = useState('')
  const [reviewPage, setReviewPage] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: { pending: number; resolved: number; all: number }
    revision?: string
    stale?: boolean
    status: 'idle' | 'loading' | 'ready' | 'error'
    error?: string
  }>({
    items: [],
    total: 0,
    hasMore: false,
    counts: { pending: 0, resolved: 0, all: 0 },
    status: 'idle'
  })
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false)
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0)
  const reviewPageGate = useRef(new LatestRequestGate())
  const [mergeArchive, setMergeArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: { active: number; reverted: number; all: number }
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({
    items: [], total: 0, hasMore: false,
    counts: { active: 0, reverted: 0, all: 0 }
  })
  const [mergeArchiveStatus, setMergeArchiveStatus] = useState<'all' | 'active' | 'reverted'>('all')
  const [mergeArchiveQuery, setMergeArchiveQuery] = useState('')
  const [mergeArchiveFrom, setMergeArchiveFrom] = useState('')
  const [mergeArchiveTo, setMergeArchiveTo] = useState('')
  const [mergeArchiveLoadingMore, setMergeArchiveLoadingMore] = useState(false)
  const [mergeArchiveRefreshKey, setMergeArchiveRefreshKey] = useState(0)
  const mergeArchiveGate = useRef(new LatestRequestGate())
  const [mergeRevertDialog, setMergeRevertDialog] = useState<any>(null)
  const [mergeRevertConfirmation, setMergeRevertConfirmation] = useState('')
  const mergeRevertGate = useRef(new LatestRequestGate())
  const [memoryDiagnostics, setMemoryDiagnostics] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [ingestionArchive, setIngestionArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [ingestionArchiveStatus, setIngestionArchiveStatus] = useState<
    'all' | 'running' | 'completed' | 'partial' | 'failed'
  >('all')
  const [ingestionArchiveQuery, setIngestionArchiveQuery] = useState('')
  const [ingestionArchiveFrom, setIngestionArchiveFrom] = useState('')
  const [ingestionArchiveTo, setIngestionArchiveTo] = useState('')
  const [ingestionArchiveLoadingMore, setIngestionArchiveLoadingMore] = useState(false)
  const [ingestionArchiveRefreshKey, setIngestionArchiveRefreshKey] = useState(0)
  const [ingestionDossier, setIngestionDossier] = useState<any>(null)
  const [ingestionBatchesLoadingMore, setIngestionBatchesLoadingMore] = useState(false)
  const [ingestionRecoveryQueue, setIngestionRecoveryQueue] = useState<any>(null)
  const [ingestionRecoveryLoadingMore, setIngestionRecoveryLoadingMore] = useState(false)
  const [ingestionRecoveryRetrying, setIngestionRecoveryRetrying] = useState(false)
  const ingestionArchiveGate = useRef(new LatestRequestGate())
  const ingestionDossierGate = useRef(new LatestRequestGate())
  const ingestionRecoveryGate = useRef(new LatestRequestGate())
  const [backingUpMemory, setBackingUpMemory] = useState(false)
  const [restoringMemory, setRestoringMemory] = useState(false)
  const [memoryRestoreDialog, setMemoryRestoreDialog] = useState<any>(null)
  const [memoryRestoreConfirmation, setMemoryRestoreConfirmation] = useState('')
  const memoryRestoreGate = useRef(new LatestRequestGate())
  const [migratingMemory, setMigratingMemory] = useState(false)
  const [migrationDialog, setMigrationDialog] = useState<any>(null)
  const [migrationPassphrase, setMigrationPassphrase] = useState('')
  const [migrationPassphraseConfirmation, setMigrationPassphraseConfirmation] = useState('')
  const [migrationImportConfirmation, setMigrationImportConfirmation] = useState('')
  const [indexingVectors, setIndexingVectors] = useState(false)
  const [memoryQuestion, setMemoryQuestion] = useState('')
  const [memoryAnswer, setMemoryAnswer] = useState<any>(null)
  const [memoryConversationId, setMemoryConversationId] = useState<string | null>(null)
  const [memoryConversation, setMemoryConversation] = useState<any>(null)
  const [assistantArchive, setAssistantArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    revision?: string
    stale?: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false })
  const [assistantArchiveQuery, setAssistantArchiveQuery] = useState('')
  const [assistantArchiveFrom, setAssistantArchiveFrom] = useState('')
  const [assistantArchiveTo, setAssistantArchiveTo] = useState('')
  const [assistantArchiveRevalidation, setAssistantArchiveRevalidation] = useState('')
  const [assistantArchiveLoadingMore, setAssistantArchiveLoadingMore] = useState(false)
  const [assistantArchiveRefreshKey, setAssistantArchiveRefreshKey] = useState(0)
  const [assistantMessagesLoadingMore, setAssistantMessagesLoadingMore] = useState(false)
  const assistantArchiveGate = useRef(new LatestRequestGate())
  const [assistantAnswerReviewsOpen, setAssistantAnswerReviewsOpen] = useState(false)
  const [assistantAnswerReviews, setAssistantAnswerReviews] = useState<any>({
    items: [], total: 0, hasMore: false,
    counts: { attention: 0, invalid: 0, needs_review: 0, current: 0 }
  })
  const [assistantAnswerReviewStatus, setAssistantAnswerReviewStatus] = useState('attention')
  const [assistantAnswerReviewState, setAssistantAnswerReviewState] = useState('pending')
  const [assistantAnswerReviewQuery, setAssistantAnswerReviewQuery] = useState('')
  const [assistantAnswerReviewFrom, setAssistantAnswerReviewFrom] = useState('')
  const [assistantAnswerReviewTo, setAssistantAnswerReviewTo] = useState('')
  const [assistantAnswerReviewsLoadingMore, setAssistantAnswerReviewsLoadingMore] = useState(false)
  const [assistantAnswerReviewSaving, setAssistantAnswerReviewSaving] = useState('')
  const [assistantAnswerReviewRevision, setAssistantAnswerReviewRevision] = useState(0)
  const [assistantAnswerReviewHistories, setAssistantAnswerReviewHistories] =
    useState<Record<string, any>>({})
  const assistantAnswerReviewsGate = useRef(new LatestRequestGate())
  const [askingMemory, setAskingMemory] = useState(false)
  const [creatingMemoryTask, setCreatingMemoryTask] = useState(false)
  const [memoryEntityFilter, setMemoryEntityFilter] = useState('')
  const [memoryEntitySelection, setMemoryEntitySelection] = useState<any>(null)
  const [memorySessionFilter, setMemorySessionFilter] = useState('')
  const [memorySessionSelection, setMemorySessionSelection] = useState<any>(null)
  const [memorySessionQuery, setMemorySessionQuery] = useState('')
  const [memorySessionOptions, setMemorySessionOptions] = useState<any[]>([])
  const [memorySessionOptionTotal, setMemorySessionOptionTotal] = useState(0)
  const [memorySessionPickerOpen, setMemorySessionPickerOpen] = useState(false)
  const [memorySessionPickerLoading, setMemorySessionPickerLoading] = useState(false)
  const memorySessionPickerGate = useRef(new LatestRequestGate())
  const [memorySourceFilter, setMemorySourceFilter] = useState('')
  const [memoryTypeFilter, setMemoryTypeFilter] = useState('')
  const [memoryFrom, setMemoryFrom] = useState('')
  const [memoryTo, setMemoryTo] = useState('')
  const selectedMemorySessionScope = useMemo(
    () => buildMemorySessionScope(memorySessionSelection),
    [memorySessionSelection]
  )
  const memorySearchOptions = useMemo(() => ({
    entityId: memoryEntityFilter || undefined,
    entitySelectionRevision: memoryEntitySelection?.directoryRevision || undefined,
    sessionId: selectedMemorySessionScope.sessionId,
    sessionName: selectedMemorySessionScope.sessionName,
    sourceIds: memorySourceFilter ? [memorySourceFilter] : undefined,
    documentTypes: memoryTypeFilter ? [memoryTypeFilter] : undefined,
    from: memoryFrom || undefined,
    to: memoryTo || undefined
  }), [
    memoryEntityFilter, memoryEntitySelection, memorySessionFilter, selectedMemorySessionScope,
    memorySourceFilter, memoryTypeFilter, memoryFrom, memoryTo
  ])
  const hasMemoryScope = Boolean(memoryEntityFilter || memorySessionFilter || memorySourceFilter || memoryTypeFilter || memoryFrom || memoryTo)
  const memoryFeedbackArchiveOptions = useMemo(() => ({
    action: memoryFeedbackArchiveAction || undefined,
    query: memoryFeedbackArchiveQuery.trim() || undefined,
    from: memoryFeedbackArchiveFrom || undefined,
    to: memoryFeedbackArchiveTo || undefined,
    offset: 0,
    limit: 40
  }), [
    memoryFeedbackArchiveAction,
    memoryFeedbackArchiveQuery,
    memoryFeedbackArchiveFrom,
    memoryFeedbackArchiveTo
  ])
  const sensitiveCaches = memoryDiagnostics?.privacy?.sensitiveCaches
  const sensitiveCachesSecure = [
    'ocr',
    'imageSemantics',
    'voiceTranscripts',
    'contacts',
    'sessionStats',
    'groupMyMessageCounts',
    'cacheMaps'
  ].every(kind => {
    const cache = sensitiveCaches?.[kind]
    return !cache?.exists || (cache.encrypted === true && cache.writable !== false && cache.mode === '600')
  })
  const eventTimelineOptions = useMemo(() => ({
    sourceId: eventSourceFilter || undefined,
    status: eventStatusFilter || undefined,
    from: eventFrom ? new Date(`${eventFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: eventTo ? new Date(`${eventTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 100,
    offset: 0
  }), [eventSourceFilter, eventStatusFilter, eventFrom, eventTo])
  const claimArchiveOptions = useMemo(() => ({
    entityId: claimEntityFilter || undefined,
    sourceId: claimSourceFilter || undefined,
    status: claimStatusFilter || undefined,
    predicate: claimPredicateFilter || undefined,
    from: claimFrom ? new Date(`${claimFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: claimTo ? new Date(`${claimTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 100,
    offset: 0
  }), [claimEntityFilter, claimSourceFilter, claimStatusFilter, claimPredicateFilter, claimFrom, claimTo])
  const resourceArchiveOptions = useMemo(() => ({
    resourceType: resourceTypeFilter || undefined,
    sourceId: resourceSourceFilter || undefined,
    query: resourceQuery.trim() || undefined,
    from: resourceFrom ? new Date(`${resourceFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: resourceTo ? new Date(`${resourceTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [
    resourceTypeFilter, resourceSourceFilter, resourceQuery, resourceFrom, resourceTo
  ])
  const taskArchiveOptions = useMemo(() => ({
    status: taskArchiveStatus,
    priority: taskArchivePriority || undefined,
    project: taskArchiveProject || undefined,
    query: taskArchiveQuery || undefined,
    from: taskArchiveFrom ? new Date(`${taskArchiveFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: taskArchiveTo ? new Date(`${taskArchiveTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [taskArchiveStatus, taskArchivePriority, taskArchiveProject, taskArchiveQuery, taskArchiveFrom, taskArchiveTo])
  const taskWorksetOptions = useMemo(() => ({
    taskId: focusedTaskId || undefined,
    status: focusedTaskId || taskStatusFilter === 'all' ? undefined : taskStatusFilter,
    priority: focusedTaskId || taskPriorityFilter === 'all' ? undefined : taskPriorityFilter,
    taskKind: focusedTaskId || taskKindFilter === 'all' ? undefined : taskKindFilter,
    query: focusedTaskId ? undefined : taskQuery.trim() || undefined,
    limit: 100,
    offset: 0
  }), [focusedTaskId, taskStatusFilter, taskPriorityFilter, taskKindFilter, taskQuery])
  const projectDirectoryOptions = useMemo(() => ({
    query: projectQuery.trim() || undefined,
    phase: projectPhase || undefined,
    limit: 40,
    offset: 0
  }), [projectQuery, projectPhase])
  const assistantArchiveOptions = useMemo(() => ({
    query: assistantArchiveQuery || undefined,
    from: assistantArchiveFrom ? new Date(`${assistantArchiveFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: assistantArchiveTo ? new Date(`${assistantArchiveTo}T23:59:59.999+08:00`).toISOString() : undefined,
    revalidationStatus: assistantArchiveRevalidation || undefined,
    offset: 0,
    limit: 30
  }), [assistantArchiveQuery, assistantArchiveFrom, assistantArchiveTo, assistantArchiveRevalidation])
  const assistantAnswerReviewOptions = useMemo(() => ({
    status: assistantAnswerReviewStatus,
    reviewState: assistantAnswerReviewState,
    query: assistantAnswerReviewQuery || undefined,
    from: assistantAnswerReviewFrom
      ? new Date(`${assistantAnswerReviewFrom}T00:00:00+08:00`).toISOString()
      : undefined,
    to: assistantAnswerReviewTo
      ? new Date(`${assistantAnswerReviewTo}T23:59:59.999+08:00`).toISOString()
      : undefined,
    offset: 0,
    limit: 30
  }), [
    assistantAnswerReviewStatus,
    assistantAnswerReviewState,
    assistantAnswerReviewQuery,
    assistantAnswerReviewFrom,
    assistantAnswerReviewTo
  ])
  const taskOwnershipOptions = useMemo(() => ({
    classification: taskOwnershipClassification || undefined,
    priority: taskOwnershipPriority || undefined,
    query: taskOwnershipQuery || undefined,
    from: taskOwnershipFrom ? new Date(`${taskOwnershipFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: taskOwnershipTo ? new Date(`${taskOwnershipTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [
    taskOwnershipClassification, taskOwnershipPriority, taskOwnershipQuery,
    taskOwnershipFrom, taskOwnershipTo
  ])
  const taskFeedbackOptions = useMemo(() => ({
    status: taskFeedbackStatus,
    decision: taskFeedbackDecision,
    query: taskFeedbackQuery || undefined,
    from: taskFeedbackFrom ? new Date(`${taskFeedbackFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: taskFeedbackTo ? new Date(`${taskFeedbackTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [taskFeedbackStatus, taskFeedbackDecision, taskFeedbackQuery, taskFeedbackFrom, taskFeedbackTo])
  const memoryDeletionOptions = useMemo(() => ({
    kind: memoryDeletionKind,
    reason: memoryDeletionReason,
    query: memoryDeletionQuery || undefined,
    from: memoryDeletionFrom ? new Date(`${memoryDeletionFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: memoryDeletionTo ? new Date(`${memoryDeletionTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [
    memoryDeletionKind, memoryDeletionReason, memoryDeletionQuery,
    memoryDeletionFrom, memoryDeletionTo
  ])
  const mergeArchiveOptions = useMemo(() => ({
    status: mergeArchiveStatus,
    query: mergeArchiveQuery || undefined,
    from: mergeArchiveFrom ? new Date(`${mergeArchiveFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: mergeArchiveTo ? new Date(`${mergeArchiveTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 40,
    offset: 0
  }), [
    mergeArchiveStatus, mergeArchiveQuery, mergeArchiveFrom, mergeArchiveTo
  ])
  const ingestionArchiveOptions = useMemo(() => ({
    status: ingestionArchiveStatus,
    query: ingestionArchiveQuery || undefined,
    from: ingestionArchiveFrom ? new Date(`${ingestionArchiveFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: ingestionArchiveTo ? new Date(`${ingestionArchiveTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 30,
    offset: 0
  }), [
    ingestionArchiveStatus, ingestionArchiveQuery, ingestionArchiveFrom, ingestionArchiveTo
  ])

  const load = useCallback(async () => {
    const request = dashboardLoadGate.current.begin()
    const [nextStatus, nextDashboard, nextDataSources] = await Promise.all([
      window.electronAPI.aiAssistant.status(),
      window.electronAPI.aiAssistant.dashboard(),
      window.electronAPI.aiAssistant.getDataSources()
    ])
    if (!dashboardLoadGate.current.isCurrent(request)) return
    setStatus(nextStatus)
    setDashboard(nextDashboard)
    setDataSources(nextDataSources)
  }, [])

  useEffect(() => {
    void load()
    void window.electronAPI.aiAssistant.getMemoryDiagnostics().then(setMemoryDiagnostics).catch(() => {})
    void window.electronAPI.aiAssistant.getDataSources().then(setDataSources).catch(() => {})
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!memorySessionPickerOpen) return
    const request = memorySessionPickerGate.current.begin()
    const timer = window.setTimeout(() => {
      setMemorySessionPickerLoading(true)
      void window.electronAPI.aiAssistant.getConversationSources({
        query: memorySessionQuery.trim() || undefined,
        enabled: 'all',
        limit: 20,
        offset: 0
      }).then(result => {
        if (!memorySessionPickerGate.current.isCurrent(request)) return
        setMemorySessionOptions(result.items)
        setMemorySessionOptionTotal(result.total)
      }).catch(error => {
        if (!memorySessionPickerGate.current.isCurrent(request)) return
        setMemorySessionOptions([])
        setMemorySessionOptionTotal(0)
        setMessage(error?.message || String(error))
      }).finally(() => {
        if (memorySessionPickerGate.current.isCurrent(request)) {
          setMemorySessionPickerLoading(false)
        }
      })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [memorySessionPickerOpen, memorySessionQuery])

  useEffect(() => {
    const request = claimArchiveGate.current.begin()
    setClaimLoadingMore(false)
    setClaimArchive(current => ({ ...current, items: [], loading: true }))
    void window.electronAPI.aiAssistant.getClaimArchive(claimArchiveOptions).then(result => {
      if (!claimArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        window.setTimeout(() => {
          if (claimArchiveGate.current.isCurrent(request)) setClaimArchiveRefreshKey(value => value + 1)
        }, 250)
        return
      }
      setClaimArchive({ ...result, loading: false })
    }).catch(() => {
      if (!claimArchiveGate.current.isCurrent(request)) return
      setClaimArchive({ items: [], total: 0, hasMore: false, loading: false })
    })
    return () => {
      if (claimArchiveGate.current.isCurrent(request)) claimArchiveGate.current.invalidate()
    }
  }, [claimArchiveOptions, dashboard?.memoryRevision, claimArchiveRefreshKey])

  useEffect(() => {
    const request = eventTimelineGate.current.begin()
    setEventLoadingMore(false)
    setEventTimeline(current => ({ ...current, items: [] }))
    void window.electronAPI.aiAssistant.getEventTimeline(eventTimelineOptions).then(result => {
      if (!eventTimelineGate.current.isCurrent(request)) return
      if (result.stale) {
        window.setTimeout(() => {
          if (eventTimelineGate.current.isCurrent(request)) setEventTimelineRefreshKey(value => value + 1)
        }, 250)
        return
      }
      setEventTimeline(result)
    }).catch(() => {
      if (eventTimelineGate.current.isCurrent(request)) {
        setEventTimeline({ items: [], total: 0, hasMore: false })
      }
    })
    return () => {
      if (eventTimelineGate.current.isCurrent(request)) eventTimelineGate.current.invalidate()
    }
  }, [eventTimelineOptions, dashboard?.memoryRevision, eventTimelineRefreshKey])

  useEffect(() => {
    const request = resourceArchiveGate.current.begin()
    setResourceLoadingMore(false)
    setSelectedResourceDossier(null)
    setResourceArchive((current: any) => ({ ...current, items: [], status: 'loading' }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getResourceArchive(resourceArchiveOptions).then(result => {
        if (!resourceArchiveGate.current.isCurrent(request)) return
        if (result.stale) {
          setResourceRefreshKey(value => value + 1)
          return
        }
        setResourceArchive({ ...result, status: 'ready' })
      }).catch((error: any) => {
        if (!resourceArchiveGate.current.isCurrent(request)) return
        setResourceArchive({
          items: [], total: 0, hasMore: false, revision: '', status: 'error',
          error: error?.message || String(error)
        })
      })
    }, resourceQuery.trim() ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      if (resourceArchiveGate.current.isCurrent(request)) resourceArchiveGate.current.invalidate()
    }
  }, [resourceArchiveOptions, dashboard?.resourceArchive?.revision, resourceRefreshKey])

  useEffect(() => {
    if (!resourceTrashOpen) return
    const request = resourceTrashGate.current.begin()
    setResourceTrashLoadingMore(false)
    setResourceTrashArchive((current: any) => ({ ...current, items: [], status: 'loading' }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getResourceTrashArchive({
        query: resourceTrashQuery.trim() || undefined,
        limit: 40,
        offset: 0
      }).then(result => {
        if (!resourceTrashGate.current.isCurrent(request)) return
        if (result.stale) {
          setResourceRefreshKey(value => value + 1)
          return
        }
        setResourceTrashArchive({ ...result, status: 'ready' })
      }).catch((error: any) => {
        if (!resourceTrashGate.current.isCurrent(request)) return
        setResourceTrashArchive({
          items: [], total: 0, hasMore: false, revision: '', status: 'error',
          error: error?.message || String(error)
        })
      })
    }, resourceTrashQuery.trim() ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      if (resourceTrashGate.current.isCurrent(request)) resourceTrashGate.current.invalidate()
    }
  }, [
    resourceTrashOpen, resourceTrashQuery, dashboard?.resourceArchive?.revision, resourceRefreshKey
  ])

  useEffect(() => {
    if (!editingTask?.id) {
      setTaskDependencyCandidates({ items: [], total: 0, revision: '', loading: false })
      return
    }
    const request = taskDependencyGate.current.begin()
    setTaskDependencyCandidates((current: any) => ({ ...current, loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getTaskDependencyCandidates({
        query: taskDependencyQuery.trim() || undefined,
        selectedIds: editingTask.dependsOnIds || [],
        excludeId: editingTask.id,
        limit: 20
      }).then(result => {
        if (!taskDependencyGate.current.isCurrent(request)) return
        if (result.stale) return
        setTaskDependencyCandidates({ ...result, loading: false })
      }).catch(() => {
        if (!taskDependencyGate.current.isCurrent(request)) return
        setTaskDependencyCandidates({ items: [], total: 0, revision: '', loading: false })
      })
    }, taskDependencyQuery.trim() ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (taskDependencyGate.current.isCurrent(request)) taskDependencyGate.current.invalidate()
    }
  }, [
    editingTask?.id,
    (editingTask?.dependsOnIds || []).join('\u0000'),
    taskDependencyQuery,
    dashboard?.taskRevision
  ])

  useEffect(() => {
    setTaskDependencyQuery('')
  }, [editingTask?.id])

  useEffect(() => {
    const request = projectDirectoryGate.current.begin()
    setProjectDirectoryLoadingMore(false)
    setProjectDirectory((current: any) => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getProjectDirectory(projectDirectoryOptions).then(result => {
        if (!projectDirectoryGate.current.isCurrent(request)) return
        if (result.stale) {
          setProjectDirectoryRefreshKey(value => value + 1)
          return
        }
        setProjectDirectory({ ...result, loading: false })
      }).catch(() => {
        if (!projectDirectoryGate.current.isCurrent(request)) return
        setProjectDirectory({
          items: [], total: 0, hasMore: false, revision: '', loading: false
        })
      })
    }, projectQuery.trim() ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      if (projectDirectoryGate.current.isCurrent(request)) projectDirectoryGate.current.invalidate()
    }
  }, [projectDirectoryOptions, dashboard?.projectRevision, projectDirectoryRefreshKey])

  useEffect(() => {
    const request = taskWorksetGate.current.begin()
    setTaskWorksetLoadingMore(false)
    setTaskWorkset(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getActiveTaskWorkset(taskWorksetOptions).then(result => {
        if (!taskWorksetGate.current.isCurrent(request)) return
        if (result.stale) {
          setTaskWorksetRefreshKey(value => value + 1)
          return
        }
        setTaskWorkset({ ...result, loading: false })
      }).catch(() => {
        if (!taskWorksetGate.current.isCurrent(request)) return
        setTaskWorkset({ items: [], total: 0, hasMore: false, counts: {}, loading: false })
      })
    }, taskQuery.trim() ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      if (taskWorksetGate.current.isCurrent(request)) taskWorksetGate.current.invalidate()
    }
  }, [taskWorksetOptions, dashboard?.taskRevision, taskWorksetRefreshKey])

  useEffect(() => {
    if (!focusedTaskId || taskWorkset.loading ||
        !taskWorkset.items.some(task => task.id === focusedTaskId)) return
    const timer = window.setTimeout(() => {
      document.getElementById(`assistant-task-${focusedTaskId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusedTaskId, taskWorkset.loading, taskWorkset.revision, taskWorkset.items])

  useEffect(() => {
    const request = taskArchiveGate.current.begin()
    setTaskArchiveLoadingMore(false)
    setTaskArchive(current => ({ ...current, items: [], loading: true }))
    void window.electronAPI.aiAssistant.getTaskArchive(taskArchiveOptions).then(result => {
      if (!taskArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        window.setTimeout(() => {
          if (taskArchiveGate.current.isCurrent(request)) setTaskArchiveRefreshKey(value => value + 1)
        }, 250)
        return
      }
      setTaskArchive({ ...result, loading: false })
    }).catch(() => {
      if (!taskArchiveGate.current.isCurrent(request)) return
      setTaskArchive({ items: [], total: 0, hasMore: false, loading: false })
    })
    return () => {
      if (taskArchiveGate.current.isCurrent(request)) taskArchiveGate.current.invalidate()
    }
  }, [taskArchiveOptions, dashboard?.taskRevision, taskArchiveRefreshKey])

  useEffect(() => {
    const request = taskArchiveProjectGate.current.begin()
    const timer = window.setTimeout(() => {
      setTaskArchiveProjects(current => ({ ...current, loading: true }))
      void window.electronAPI.aiAssistant.getTaskArchiveProjects({
        query: taskArchiveProject.trim() || undefined,
        limit: 40,
        offset: 0
      }).then(result => {
        if (!taskArchiveProjectGate.current.isCurrent(request)) return
        if (result.stale) return
        setTaskArchiveProjects({
          items: result.items,
          total: result.total,
          loading: false
        })
      }).catch(() => {
        if (!taskArchiveProjectGate.current.isCurrent(request)) return
        setTaskArchiveProjects({ items: [], total: 0, loading: false })
      })
    }, taskArchiveProject.trim() ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (taskArchiveProjectGate.current.isCurrent(request)) taskArchiveProjectGate.current.invalidate()
    }
  }, [taskArchiveProject, dashboard?.taskRevision, taskArchiveRefreshKey])

  useEffect(() => {
    const request = assistantArchiveGate.current.begin()
    setAssistantArchiveLoadingMore(false)
    setAssistantArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getAssistantConversations(assistantArchiveOptions).then(result => {
        if (!assistantArchiveGate.current.isCurrent(request)) return
        if (result.stale) {
          window.setTimeout(() => {
            if (assistantArchiveGate.current.isCurrent(request)) {
              setAssistantArchiveRefreshKey(value => value + 1)
            }
          }, 250)
          return
        }
        setAssistantArchive({ ...result, loading: false })
      }).catch(() => {
        if (!assistantArchiveGate.current.isCurrent(request)) return
        setAssistantArchive({ items: [], total: 0, hasMore: false, loading: false })
      })
    }, assistantArchiveQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (assistantArchiveGate.current.isCurrent(request)) assistantArchiveGate.current.invalidate()
    }
  }, [assistantArchiveOptions, dashboard?.assistantArchive?.revision, assistantArchiveRefreshKey])

  useEffect(() => {
    if (!assistantAnswerReviewsOpen) {
      assistantAnswerReviewsGate.current.invalidate()
      return
    }
    const request = assistantAnswerReviewsGate.current.begin()
    setAssistantAnswerReviewsLoadingMore(false)
    setAssistantAnswerReviews((current: any) => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getAssistantAnswerReviews(assistantAnswerReviewOptions)
        .then(result => {
          if (!assistantAnswerReviewsGate.current.isCurrent(request)) return
          if (result.stale) {
            window.setTimeout(() => {
              if (assistantAnswerReviewsGate.current.isCurrent(request)) {
                setAssistantAnswerReviewRevision(value => value + 1)
              }
            }, 250)
            return
          }
          setAssistantAnswerReviews({ ...result, loading: false })
        }).catch(() => {
          if (!assistantAnswerReviewsGate.current.isCurrent(request)) return
          setAssistantAnswerReviews({
            items: [], total: 0, hasMore: false, loading: false,
            counts: { attention: 0, invalid: 0, needs_review: 0, current: 0 }
          })
        })
    }, assistantAnswerReviewQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (assistantAnswerReviewsGate.current.isCurrent(request)) {
        assistantAnswerReviewsGate.current.invalidate()
      }
    }
  }, [
    assistantAnswerReviewsOpen,
    assistantAnswerReviewOptions,
    assistantAnswerReviewRevision,
    dashboard?.assistantArchive?.revision
  ])

  useEffect(() => {
    const request = taskOwnershipGate.current.begin()
    setTaskOwnershipLoadingMore(false)
    setTaskOwnershipReviews(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getTaskOwnershipReviews(taskOwnershipOptions).then(result => {
        if (!taskOwnershipGate.current.isCurrent(request)) return
        if (result.stale) {
          window.setTimeout(() => {
            if (taskOwnershipGate.current.isCurrent(request)) setTaskOwnershipRefreshKey(value => value + 1)
          }, 250)
          return
        }
        setTaskOwnershipReviews({ ...result, loading: false })
      }).catch(() => {
        if (!taskOwnershipGate.current.isCurrent(request)) return
        setTaskOwnershipReviews({ items: [], total: 0, hasMore: false, counts: {}, loading: false })
      })
    }, taskOwnershipQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (taskOwnershipGate.current.isCurrent(request)) taskOwnershipGate.current.invalidate()
    }
  }, [taskOwnershipOptions, dashboard?.taskOwnershipReviews?.revision, taskOwnershipRefreshKey])

  useEffect(() => {
    const request = taskFeedbackArchiveGate.current.begin()
    setTaskFeedbackLoadingMore(false)
    setTaskFeedbackArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getTaskReviewDecisionPage(taskFeedbackOptions).then(result => {
        if (!taskFeedbackArchiveGate.current.isCurrent(request)) return
        if (result.stale) {
          window.setTimeout(() => {
            if (taskFeedbackArchiveGate.current.isCurrent(request)) setTaskFeedbackRefreshKey(value => value + 1)
          }, 250)
          return
        }
        setTaskFeedbackArchive({ ...result, loading: false })
      }).catch(() => {
        if (!taskFeedbackArchiveGate.current.isCurrent(request)) return
        setTaskFeedbackArchive({
          items: [], total: 0, hasMore: false,
          counts: { active: 0, revoked: 0, all: 0 }, loading: false
        })
      })
    }, taskFeedbackQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (taskFeedbackArchiveGate.current.isCurrent(request)) taskFeedbackArchiveGate.current.invalidate()
    }
  }, [taskFeedbackOptions, dashboard?.taskReviewFeedback?.archive?.revision, taskFeedbackRefreshKey])

  useEffect(() => {
    if (!showDiagnostics) {
      memoryDeletionArchiveGate.current.invalidate()
      return
    }
    const request = memoryDeletionArchiveGate.current.begin()
    setMemoryDeletionLoadingMore(false)
    setMemoryDeletionArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getMemoryDeletionAuditPage(memoryDeletionOptions).then(result => {
        if (!memoryDeletionArchiveGate.current.isCurrent(request)) return
        if (result.stale) {
          window.setTimeout(() => {
            if (memoryDeletionArchiveGate.current.isCurrent(request)) {
              setMemoryDeletionArchiveRefreshKey(value => value + 1)
            }
          }, 250)
          return
        }
        setMemoryDeletionArchive({ ...result, loading: false })
      }).catch(() => {
        if (!memoryDeletionArchiveGate.current.isCurrent(request)) return
        setMemoryDeletionArchive({ items: [], total: 0, hasMore: false, counts: {}, loading: false })
      })
    }, memoryDeletionQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (memoryDeletionArchiveGate.current.isCurrent(request)) {
        memoryDeletionArchiveGate.current.invalidate()
      }
    }
  }, [
    showDiagnostics, memoryDeletionOptions,
    dashboard?.memoryDeletionArchive?.revision, memoryDeletionArchiveRefreshKey
  ])

  useEffect(() => {
    if (!showDiagnostics || !memoryDiagnostics) {
      ingestionArchiveGate.current.invalidate()
      return
    }
    const request = ingestionArchiveGate.current.begin()
    setIngestionArchiveLoadingMore(false)
    setIngestionArchive(current => ({ ...current, items: [], loading: true }))
    setIngestionDossier(null)
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getIngestionRunPage(ingestionArchiveOptions).then(page => {
        if (!ingestionArchiveGate.current.isCurrent(request)) return
        if (page.stale) {
          window.setTimeout(() => {
            if (ingestionArchiveGate.current.isCurrent(request)) {
              setIngestionArchiveRefreshKey(value => value + 1)
            }
          }, 250)
          return
        }
        setIngestionArchive({ ...page, loading: false })
      }).catch(() => {
        if (!ingestionArchiveGate.current.isCurrent(request)) return
        setIngestionArchive({ items: [], total: 0, hasMore: false, counts: {}, loading: false })
      })
    }, ingestionArchiveQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (ingestionArchiveGate.current.isCurrent(request)) ingestionArchiveGate.current.invalidate()
    }
  }, [
    showDiagnostics, memoryDiagnostics?.ingestionArchive?.revision,
    ingestionArchiveOptions, ingestionArchiveRefreshKey
  ])

  useEffect(() => {
    const query = memoryQuery.trim()
    const request = memorySearchGate.current.begin()
    setMemoryResults([])
    setMemorySearchFeedback([])
    setMemoryLoadingMore(false)
    if (!query && !hasMemoryScope) {
      setMemorySearchState({ status: 'idle', query: '' })
      return
    }
    setMemorySearchState({ status: 'waiting', query })
    const timer = window.setTimeout(() => {
      if (!memorySearchGate.current.isCurrent(request)) return
      setMemorySearchState({ status: 'searching', query })
      void window.electronAPI.aiAssistant.searchMemoryPage(query, memorySearchOptions, { offset: 0, limit: 40 }).then(page => {
        if (!memorySearchGate.current.isCurrent(request)) return
        if (page.entityScopeStale) {
          setMemoryEntitySelection(null)
          setMemoryEntityFilter('')
          setMemorySearchState({ status: 'idle', query: '' })
          setMessage('所选实体已经变化、合并或不再可信，请重新选择实体范围。')
          return
        }
        if (page.stale) {
          setMemorySearchState({ status: 'waiting', query })
          window.setTimeout(() => {
            if (memorySearchGate.current.isCurrent(request)) {
              setMemorySearchRefreshKey(value => value + 1)
            }
          }, 400)
          return
        }
        setMemoryResults(page.results)
        setMemorySearchFeedback(page.feedback || [])
        setMemorySearchState({
          status: 'ready',
          query,
          total: page.total,
          hasMore: page.hasMore,
          truncated: page.truncated,
          scopeCandidates: page.scopeCandidates,
          revision: page.revision,
          nextOffset: Number(page.offset || 0) + page.results.length
        })
      }).catch(error => {
        if (!memorySearchGate.current.isCurrent(request)) return
        setMemorySearchState({ status: 'error', query, error: error?.message || String(error) })
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      if (memorySearchGate.current.isCurrent(request)) memorySearchGate.current.invalidate()
    }
  }, [memoryQuery, memorySearchOptions, hasMemoryScope, memorySearchRefreshKey])

  useEffect(() => {
    if (!memoryFeedbackArchiveOpen) {
      memoryFeedbackArchiveGate.current.invalidate()
      return
    }
    const request = memoryFeedbackArchiveGate.current.begin()
    setMemoryFeedbackArchiveLoadingMore(false)
    setMemoryFeedbackArchive((current: any) => ({
      ...current,
      items: [],
      total: 0,
      hasMore: false,
      status: 'loading',
      error: undefined
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getMemorySearchFeedbackArchive(memoryFeedbackArchiveOptions)
        .then(page => {
          if (!memoryFeedbackArchiveGate.current.isCurrent(request)) return
          if (page.stale) {
            window.setTimeout(() => {
              if (memoryFeedbackArchiveGate.current.isCurrent(request)) {
                setMemoryFeedbackArchiveRefreshKey(value => value + 1)
              }
            }, 250)
            return
          }
          setMemoryFeedbackArchive({ ...page, status: 'ready' })
        })
        .catch(error => {
          if (!memoryFeedbackArchiveGate.current.isCurrent(request)) return
          setMemoryFeedbackArchive({
            items: [],
            total: 0,
            hasMore: false,
            counts: {},
            status: 'error',
            error: error?.message || String(error)
          })
        })
    }, memoryFeedbackArchiveQuery.trim() ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (memoryFeedbackArchiveGate.current.isCurrent(request)) memoryFeedbackArchiveGate.current.invalidate()
    }
  }, [memoryFeedbackArchiveOpen, memoryFeedbackArchiveOptions, memoryFeedbackArchiveRefreshKey])

  useEffect(() => {
    const request = reviewPageGate.current.begin()
    setReviewLoadingMore(false)
    setReviewPage(current => ({ ...current, items: [], total: 0, hasMore: false, status: 'loading', error: undefined }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getGraphReviewPage({
        status: reviewStatusFilter,
        kind: reviewKindFilter || undefined,
        query: reviewQuery.trim() || undefined,
        offset: 0,
        limit: 40
      }).then(page => {
        if (!reviewPageGate.current.isCurrent(request)) return
        if (page.stale) {
          window.setTimeout(() => {
            if (reviewPageGate.current.isCurrent(request)) setReviewRefreshKey(value => value + 1)
          }, 250)
          return
        }
        setReviewPage({ ...page, status: 'ready' })
      }).catch(error => {
        if (!reviewPageGate.current.isCurrent(request)) return
        setReviewPage(current => ({
          ...current,
          items: [],
          total: 0,
          hasMore: false,
          status: 'error',
          error: error?.message || String(error)
        }))
      })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      if (reviewPageGate.current.isCurrent(request)) reviewPageGate.current.invalidate()
    }
  }, [reviewStatusFilter, reviewKindFilter, reviewQuery, reviewRefreshKey, dashboard?.graphReviewRevision])

  useEffect(() => {
    const request = mergeArchiveGate.current.begin()
    setMergeArchiveLoadingMore(false)
    setMergeArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getMergeHistoryPage(mergeArchiveOptions).then(page => {
        if (!mergeArchiveGate.current.isCurrent(request)) return
        if (page.stale) {
          window.setTimeout(() => {
            if (mergeArchiveGate.current.isCurrent(request)) {
              setMergeArchiveRefreshKey(value => value + 1)
            }
          }, 250)
          return
        }
        setMergeArchive({ ...page, loading: false })
      }).catch(() => {
        if (!mergeArchiveGate.current.isCurrent(request)) return
        setMergeArchive({
          items: [], total: 0, hasMore: false,
          counts: { active: 0, reverted: 0, all: 0 }, loading: false
        })
      })
    }, mergeArchiveQuery ? 200 : 0)
    return () => {
      window.clearTimeout(timer)
      if (mergeArchiveGate.current.isCurrent(request)) mergeArchiveGate.current.invalidate()
    }
  }, [mergeArchiveOptions, dashboard?.mergeHistoryArchive?.revision, mergeArchiveRefreshKey])

  useEffect(() => {
    const request = graphWorkspaceGate.current.begin()
    entityTaskGate.current.invalidate()
    entityAuditGate.current.invalidate()
    setEntityTaskLoadingMore(false)
    setEntityAuditLoadingMore('')
    setGraphWorkspace((current: any) => ({
      ...current,
      viewport: {
        entities: [], relations: [], levels: {},
        mode: selectedEntityId ? 'focus' : graphQuery.trim() ? 'search' : 'overview',
        totalAvailable: 0, truncated: 0, totalRelationsAvailable: 0,
        truncatedRelations: 0, matchingSeeds: 0, maxNodes: graphNodeLimit
      },
      focus: null,
      status: 'loading',
      error: undefined
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getGraphWorkspace({
        query: graphQuery.trim() || undefined,
        relationType: graphRelationType || undefined,
        relationStatus: graphRelationStatus || undefined,
        focusEntityId: selectedEntityId || undefined,
        depth: graphFocusDepth,
        maxNodes: graphNodeLimit,
        revision: graphWorkspace.revision || undefined
      }).then(workspace => {
        if (!graphWorkspaceGate.current.isCurrent(request)) return
        if (workspace.stale) {
          setGraphWorkspace((current: any) => ({
            ...current,
            revision: workspace.revision,
            status: 'loading'
          }))
          setGraphWorkspaceRefreshKey(value => value + 1)
          return
        }
        setGraphWorkspace({ ...workspace, status: 'ready' })
      }).catch(error => {
        if (!graphWorkspaceGate.current.isCurrent(request)) return
        setGraphWorkspace((current: any) => ({
          ...current,
          status: 'error',
          error: error?.message || String(error)
        }))
      })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      if (graphWorkspaceGate.current.isCurrent(request)) graphWorkspaceGate.current.invalidate()
    }
  }, [
    graphQuery, graphRelationType, graphRelationStatus, selectedEntityId, graphFocusDepth, graphNodeLimit,
    dashboard?.graphRevision, dashboard?.projectRevision, graphWorkspaceRefreshKey
  ])

  useEffect(() => {
    const request = entityClaimGate.current.begin()
    setEntityDossierLoadingMore(current => ({ ...current, claims: false }))
    if (!showEntityDossier || !selectedEntityId) {
      setEntityDossierPages((current: any) => ({
        ...current,
        claims: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' }
      }))
      return () => {
        if (entityClaimGate.current.isCurrent(request)) entityClaimGate.current.invalidate()
      }
    }
    setEntityDossierPages((current: any) => ({
      ...current,
      claims: { items: [], total: 0, hasMore: false, revision: '', status: 'loading' }
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getClaimArchive({
        entityId: selectedEntityId,
        predicate: entityClaimQuery.trim() || undefined,
        status: entityClaimStatus === 'all' ? undefined : entityClaimStatus,
        sourceId: entityClaimSource === 'all' ? undefined : entityClaimSource,
        from: entityClaimFrom ? new Date(`${entityClaimFrom}T00:00:00+08:00`).toISOString() : undefined,
        to: entityClaimTo ? new Date(`${entityClaimTo}T23:59:59.999+08:00`).toISOString() : undefined,
        limit: 40,
        offset: 0
      }).then(claims => {
        if (!entityClaimGate.current.isCurrent(request)) return
        if (claims.stale) {
          window.setTimeout(() => {
            if (entityClaimGate.current.isCurrent(request)) {
              refreshEntityDossierSection('claims')
            }
          }, 250)
          return
        }
        setEntityDossierPages((current: any) => ({
          ...current, claims: { ...claims, status: 'ready' }
        }))
      }).catch(error => {
        if (!entityClaimGate.current.isCurrent(request)) return
        setEntityDossierPages((current: any) => ({
          ...current,
          claims: {
            items: [], total: 0, hasMore: false, revision: '',
            status: 'error', error: error?.message || String(error)
          }
        }))
      })
    }, entityClaimQuery.trim() ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (entityClaimGate.current.isCurrent(request)) entityClaimGate.current.invalidate()
    }
  }, [
    showEntityDossier, selectedEntityId, dashboard?.memoryRevision, entityDossierRefreshKeys.claims,
    entityClaimQuery, entityClaimStatus, entityClaimSource, entityClaimFrom, entityClaimTo
  ])

  useEffect(() => {
    const request = entityRelationGate.current.begin()
    setEntityDossierLoadingMore(current => ({ ...current, relations: false }))
    if (!showEntityDossier || !selectedEntityId) {
      setEntityDossierPages((current: any) => ({
        ...current,
        relations: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' }
      }))
      return () => {
        if (entityRelationGate.current.isCurrent(request)) entityRelationGate.current.invalidate()
      }
    }
    setEntityDossierPages((current: any) => ({
      ...current,
      relations: { items: [], total: 0, hasMore: false, revision: '', status: 'loading' }
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getEntityRelationPage({
        entityId: selectedEntityId,
        query: entityRelationQuery.trim() || undefined,
        direction: entityRelationDirection,
        status: entityRelationStatus,
        sourceId: entityRelationSource === 'all' ? undefined : entityRelationSource,
        limit: 40,
        offset: 0
      }).then(relations => {
        if (!entityRelationGate.current.isCurrent(request)) return
        if (relations.stale) {
          window.setTimeout(() => {
            if (entityRelationGate.current.isCurrent(request)) {
              refreshEntityDossierSection('relations')
            }
          }, 250)
          return
        }
        setEntityDossierPages((current: any) => ({
          ...current, relations: { ...relations, status: 'ready' }
        }))
      }).catch(error => {
        if (!entityRelationGate.current.isCurrent(request)) return
        setEntityDossierPages((current: any) => ({
          ...current,
          relations: {
            items: [], total: 0, hasMore: false, revision: '',
            status: 'error', error: error?.message || String(error)
          }
        }))
      })
    }, entityRelationQuery.trim() ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (entityRelationGate.current.isCurrent(request)) entityRelationGate.current.invalidate()
    }
  }, [
    showEntityDossier, selectedEntityId, dashboard?.memoryRevision,
    dashboard?.graphReviewRevision, entityDossierRefreshKeys.relations,
    entityRelationQuery, entityRelationDirection, entityRelationStatus, entityRelationSource
  ])

  useEffect(() => {
    const request = entityEventGate.current.begin()
    setEntityDossierLoadingMore(current => ({ ...current, events: false }))
    if (!showEntityDossier || !selectedEntityId) {
      setEntityDossierPages((current: any) => ({
        ...current,
        events: { items: [], total: 0, hasMore: false, revision: '', status: 'idle' }
      }))
      return () => {
        if (entityEventGate.current.isCurrent(request)) entityEventGate.current.invalidate()
      }
    }
    setEntityDossierPages((current: any) => ({
      ...current,
      events: { items: [], total: 0, hasMore: false, revision: '', status: 'loading' }
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getEventTimeline({
        entityId: selectedEntityId,
        query: entityEventQuery.trim() || undefined,
        status: entityEventStatus === 'all' ? undefined : entityEventStatus,
        sourceId: entityEventSource === 'all' ? undefined : entityEventSource,
        from: entityEventFrom ? new Date(`${entityEventFrom}T00:00:00+08:00`).toISOString() : undefined,
        to: entityEventTo ? new Date(`${entityEventTo}T23:59:59.999+08:00`).toISOString() : undefined,
        limit: 40,
        offset: 0
      }).then(events => {
        if (!entityEventGate.current.isCurrent(request)) return
        if (events.stale) {
          window.setTimeout(() => {
            if (entityEventGate.current.isCurrent(request)) {
              refreshEntityDossierSection('events')
            }
          }, 250)
          return
        }
        setEntityDossierPages((current: any) => ({
          ...current, events: { ...events, status: 'ready' }
        }))
      }).catch(error => {
        if (!entityEventGate.current.isCurrent(request)) return
        setEntityDossierPages((current: any) => ({
          ...current,
          events: {
            items: [], total: 0, hasMore: false, revision: '',
            status: 'error', error: error?.message || String(error)
          }
        }))
      })
    }, entityEventQuery.trim() ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (entityEventGate.current.isCurrent(request)) entityEventGate.current.invalidate()
    }
  }, [
    showEntityDossier, selectedEntityId, dashboard?.memoryRevision, entityDossierRefreshKeys.events,
    entityEventQuery, entityEventStatus, entityEventSource, entityEventFrom, entityEventTo
  ])

  useEffect(() => {
    const request = entityEvidenceGate.current.begin()
    setEntityEvidenceLoadingMore(false)
    if (!showEntityDossier || !selectedEntityId) {
      setEntityEvidencePage({
        items: [], total: 0, hasMore: false, revision: '', status: 'idle'
      })
      return () => {
        if (entityEvidenceGate.current.isCurrent(request)) entityEvidenceGate.current.invalidate()
      }
    }
    setEntityEvidencePage((current: any) => ({
      ...current, items: [], total: 0, hasMore: false, status: 'loading'
    }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getEntityEvidencePage({
        entityId: selectedEntityId,
        query: entityEvidenceQuery.trim() || undefined,
        sourceId: entityEvidenceSource || undefined,
        limit: 40,
        offset: 0
      }).then(page => {
        if (!entityEvidenceGate.current.isCurrent(request)) return
        setEntityEvidencePage({ ...page, status: 'ready' })
      }).catch(error => {
        if (!entityEvidenceGate.current.isCurrent(request)) return
        setEntityEvidencePage({
          items: [], total: 0, hasMore: false, revision: '',
          status: 'error', error: error?.message || String(error)
        })
      })
    }, entityEvidenceQuery ? 180 : 0)
    return () => {
      window.clearTimeout(timer)
      if (entityEvidenceGate.current.isCurrent(request)) entityEvidenceGate.current.invalidate()
    }
  }, [
    showEntityDossier, selectedEntityId, entityEvidenceQuery, entityEvidenceSource,
    dashboard?.memoryRevision, dashboard?.graphReviewRevision, entityEvidenceRefreshKey
  ])

  useEffect(() => {
    const request = projectWorkspaceGate.current.begin()
    projectTaskGate.current.invalidate()
    projectRiskGate.current.invalidate()
    setProjectTaskLoadingMore(false)
    setProjectRiskLoadingMore(false)
    if (!selectedProjectId) {
      setProjectWorkspace({ project: null, status: 'idle' })
      return () => {
        if (projectWorkspaceGate.current.isCurrent(request)) projectWorkspaceGate.current.invalidate()
      }
    }
    setProjectWorkspace({ project: null, status: 'loading' })
    void window.electronAPI.aiAssistant.getProjectWorkspace(selectedProjectId).then(workspace => {
      if (!projectWorkspaceGate.current.isCurrent(request)) return
      setProjectWorkspace({ ...workspace, status: 'ready' })
    }).catch(error => {
      if (!projectWorkspaceGate.current.isCurrent(request)) return
      setProjectWorkspace({
        project: null,
        status: 'error',
        error: error?.message || String(error)
      })
    })
    return () => {
      if (projectWorkspaceGate.current.isCurrent(request)) projectWorkspaceGate.current.invalidate()
    }
  }, [selectedProjectId, projectWorkspaceRefreshKey, dashboard?.projectRevision])

  useEffect(() => {
    const request = projectMemoryGate.current.begin()
    const projectEntityId = String(projectWorkspace.project?.entityId || '')
    if (projectWorkspace.status !== 'ready' || !projectEntityId) {
      setProjectMemoryLoadingMore('')
      setProjectMemoryPages({
        claims: { items: [], total: 0, hasMore: false, revision: '' },
        events: { items: [], total: 0, hasMore: false, revision: '' },
        status: projectWorkspace.status === 'ready' ? 'derived' : 'idle'
      })
      return () => {
        if (projectMemoryGate.current.isCurrent(request)) projectMemoryGate.current.invalidate()
      }
    }
    setProjectMemoryLoadingMore('')
    setProjectMemoryPages({
      claims: { items: [], total: 0, hasMore: false, revision: '' },
      events: { items: [], total: 0, hasMore: false, revision: '' },
      status: 'loading'
    })
    void Promise.all([
      window.electronAPI.aiAssistant.getClaimArchive({
        entityId: projectEntityId, limit: 40, offset: 0
      }),
      window.electronAPI.aiAssistant.getEventTimeline({
        entityId: projectEntityId, limit: 40, offset: 0
      })
    ]).then(([claims, events]) => {
      if (!projectMemoryGate.current.isCurrent(request)) return
      setProjectMemoryPages({ claims, events, status: 'ready' })
    }).catch(error => {
      if (!projectMemoryGate.current.isCurrent(request)) return
      setProjectMemoryPages((current: any) => ({
        ...current, status: 'error', error: error?.message || String(error)
      }))
    })
    return () => {
      if (projectMemoryGate.current.isCurrent(request)) projectMemoryGate.current.invalidate()
    }
  }, [
    projectWorkspace.status, projectWorkspace.project?.entityId,
    dashboard?.memoryRevision, projectMemoryRefreshKey
  ])

  useEffect(() => {
    const request = taskWorkspaceGate.current.begin()
    if (!selectedTaskId) {
      setTaskWorkspace({ task: null, history: [], status: 'idle' })
      return () => {
        if (taskWorkspaceGate.current.isCurrent(request)) taskWorkspaceGate.current.invalidate()
      }
    }
    setTaskWorkspace({ task: null, history: [], status: 'loading' })
    void window.electronAPI.aiAssistant.getTaskWorkspace(selectedTaskId).then(workspace => {
      if (!taskWorkspaceGate.current.isCurrent(request)) return
      if (!workspace) {
        setTaskWorkspace({ task: null, history: [], status: 'error', error: '该待办已不存在' })
        return
      }
      setTaskWorkspace({ ...workspace, status: 'ready' })
    }).catch(error => {
      if (!taskWorkspaceGate.current.isCurrent(request)) return
      setTaskWorkspace({
        task: null,
        history: [],
        status: 'error',
        error: error?.message || String(error)
      })
    })
    return () => {
      if (taskWorkspaceGate.current.isCurrent(request)) taskWorkspaceGate.current.invalidate()
    }
  }, [selectedTaskId, taskWorkspaceRefreshKey, dashboard?.taskRevision])

  useEffect(() => () => {
    memoryConversationGate.current.invalidate()
  }, [])

  const briefing = dashboard?.briefing
  const weeklyBriefing = dashboard?.weeklyBriefing
  const projectInsights: any[] = projectDirectory.items || []
  const selectedProject = projectWorkspace.status === 'ready' &&
    projectWorkspace.project?.id === selectedProjectId ? projectWorkspace.project : null
  const projectDossierClaims = selectedProject?.entityId
    ? projectMemoryPages.claims?.items || []
    : selectedProject?.claims || []
  const projectDossierEvents = selectedProject?.entityId
    ? projectMemoryPages.events?.items || []
    : [...(selectedProject?.decisions || []), ...(selectedProject?.milestones || [])]
  const tasks: Task[] = taskWorkset.items
  const taskReviewQueue: Task[] = taskOwnershipReviews.items
  const taskReminders: any[] = dashboard?.taskReminders || []
  const reminderPreferences = dashboard?.reminderPreferences
  const taskReviewFeedback = dashboard?.taskReviewFeedback || { mine: 0, rejected: 0, suppressed: 0, reconciled: 0, recent: [] }
  const displayedTasks = tasks
  const taskCalendar = useMemo(() => buildTaskCalendar(displayedTasks, calendarMonth), [displayedTasks, calendarMonth])
  const selectedCalendarDay = taskCalendar.days.find(day => day.date === selectedCalendarDate)
  const updateReminderPreference = async (reminder: any, action: 'helpful' | 'snooze' | 'mute_kind' | 'restore_kind') => {
    await window.electronAPI.aiAssistant.updateReminderPreference({
      reminderId: reminder.id,
      taskId: reminder.taskId,
      kind: reminder.kind,
      action
    })
    setMessage(action === 'helpful' ? '已记录：这条提醒有用。' : action === 'snooze' ? '已推迟 24 小时。' : '提醒偏好已更新。')
    await load()
  }
  const moveCalendarMonth = (offset: number) => {
    const [year, month] = calendarMonth.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1 + offset, 1))
    const next = date.toISOString().slice(0, 7)
    setCalendarMonth(next)
    setSelectedCalendarDate(`${next}-01`)
  }
  const claimEntitiesTrusted = (claim: any) => claim?.entities_trusted === true
  const eventEntitiesTrusted = (event: any) => event?.entities_trusted === true
  const graphViewport = useMemo(() => ({
    ...(graphWorkspace.viewport || {}),
    levels: new Map<string, number>(Object.entries(graphWorkspace.viewport?.levels || {})
      .map(([id, level]) => [id, Number(level)]))
  }), [graphWorkspace.viewport])
  const graphEntities = graphViewport.entities
  const graphRelations = graphViewport.relations
  const graphPositions = useMemo(() => new Map(graphEntities.map((entity: any, index: number) => {
    if (graphViewport.mode === 'focus' && entity.id === selectedEntityId) return [entity.id, { x: 250, y: 170 }]
    const angle = (Math.PI * 2 * index) / Math.max(1, graphEntities.length) - Math.PI / 2
    const level = graphViewport.levels.get(entity.id) || 1
    const ring = graphViewport.mode === 'focus' ? 70 + (level - 1) * 65 + (index % 2) * 18 : 105 + (index % 3) * 35
    return [entity.id, { x: 250 + Math.cos(angle) * ring, y: 170 + Math.sin(angle) * ring }]
  })), [graphEntities, graphViewport, selectedEntityId])
  const selectedEntity = graphWorkspace.focus?.entity ||
    graphEntities.find((entity: any) => entity.id === selectedEntityId)
  const selectedEntityNames: Record<string, string> = graphWorkspace.focus?.entityNames || {}
  const selectedEntityInsight = graphWorkspace.focus?.insight
  const relationPredicates: string[] = graphWorkspace.predicates || []
  const pendingReviewCount = reviewPage.counts.pending
  const resolvedReviewCount = reviewPage.counts.resolved
  const visibleReviews = reviewPage.items
  const groupedMemoryResults = useMemo(() => groupMemorySearchResults(memoryResults), [memoryResults])
  const assistantConversations: any[] = assistantArchive.items
  const identityDisambiguation = dashboard?.identityDisambiguation
  const ingestionStatus = dashboard?.ingestionStatus
  const ingestionCounts = Object.fromEntries((ingestionStatus?.batches || []).map((item: any) => [item.status, Number(item.count || 0)]))
  const visibleClaims = claimArchive.items
  const visibleEvents = eventTimeline.items || []
  const visibleResources = resourceArchive.items || []
  const loadMoreClaims = async () => {
    if (claimLoadingMore || !claimArchive.hasMore) return
    const request = claimArchiveGate.current.begin()
    setClaimLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getClaimArchive({
        ...claimArchiveOptions,
        offset: visibleClaims.length,
        limit: 100,
        revision: claimArchive.revision
      })
      if (!claimArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('事实档案在加载期间已有更新，已自动从第一页刷新')
        setClaimArchiveRefreshKey(value => value + 1)
        return
      }
      setClaimArchive(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))]
      }))
    } catch (error: any) {
      if (claimArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (claimArchiveGate.current.isCurrent(request)) setClaimLoadingMore(false)
    }
  }
  const loadMoreEvents = async () => {
    if (eventLoadingMore || !eventTimeline.hasMore) return
    const request = eventTimelineGate.current.begin()
    setEventLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getEventTimeline({
        ...eventTimelineOptions,
        offset: visibleEvents.length,
        limit: 100,
        revision: eventTimeline.revision
      })
      if (!eventTimelineGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('事件时间线在加载期间已有更新，已自动从第一页刷新')
        setEventTimelineRefreshKey(value => value + 1)
        return
      }
      setEventTimeline(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))]
      }))
    } catch (error: any) {
      if (eventTimelineGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (eventTimelineGate.current.isCurrent(request)) setEventLoadingMore(false)
    }
  }
  const loadMemoryItemAudit = async (
    kind: 'claim' | 'event',
    itemId: string,
    loadMore = false
  ) => {
    const key = `${kind}:${itemId}`
    if (memoryItemAuditLoading === key) return
    const current = memoryItemAudits[key]
    if (loadMore && !current?.hasMore) return
    const request = Symbol(key)
    memoryItemAuditRequests.current[key] = request
    setMemoryItemAuditLoading(key)
    try {
      const readPage = (offset: number, revision = '') =>
        window.electronAPI.aiAssistant.getMemoryItemAuditPage(kind, itemId, {
          limit: 40,
          offset,
          revision
        })
      let resetToLatest = false
      let page = await readPage(loadMore ? current.items.length : 0, loadMore ? current.revision : '')
      if (memoryItemAuditRequests.current[key] !== request) return
      if (page.stale) {
        resetToLatest = true
        setMessage('这条记忆的审计历史在浏览期间已有变化，已从最新第一页重新载入。')
        page = await readPage(0)
        if (memoryItemAuditRequests.current[key] !== request) return
      }
      setMemoryItemAudits(existing => setBoundedAuditCache(existing, key, {
          ...page,
          items: loadMore && !resetToLatest
            ? [...(existing[key]?.items || []), ...page.items.filter((item: any) =>
                !(existing[key]?.items || []).some((known: any) => known.id === item.id))]
            : page.items,
          status: 'ready'
        }))
    } catch (error: any) {
      if (memoryItemAuditRequests.current[key] !== request) return
      setMemoryItemAudits(existing => setBoundedAuditCache(existing, key, {
          ...(existing[key] || {}),
          status: 'error',
          error: error?.message || String(error)
        }))
    } finally {
      if (memoryItemAuditRequests.current[key] === request) {
        delete memoryItemAuditRequests.current[key]
        setMemoryItemAuditLoading('')
      }
    }
  }
  const loadMoreResources = async () => {
    if (resourceLoadingMore || !resourceArchive.hasMore) return
    const request = resourceArchiveGate.current.begin()
    setResourceLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getResourceArchive({
        ...resourceArchiveOptions,
        offset: visibleResources.length,
        revision: resourceArchive.revision
      })
      if (!resourceArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('资源库在加载期间已有更新，已自动从第一页刷新')
        setResourceRefreshKey(value => value + 1)
        return
      }
      setResourceArchive((current: any) => ({
        ...result,
        status: 'ready',
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))]
      }))
    } catch (error: any) {
      if (resourceArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (resourceArchiveGate.current.isCurrent(request)) setResourceLoadingMore(false)
    }
  }
  const openResourceDossier = async (resource: any) => {
    if (selectedResourceDossier?.id === resource.id) {
      resourceDossierGate.current.invalidate()
      setSelectedResourceDossier(null)
      return
    }
    const request = resourceDossierGate.current.begin()
    setSelectedResourceDossier({ id: resource.id, status: 'loading' })
    try {
      const result = await window.electronAPI.aiAssistant.getResourceDossier(
        resource.id,
        resourceArchive.revision
      )
      if (!resourceDossierGate.current.isCurrent(request)) return
      if (result?.stale) {
        setMessage('资源内容在展示后已有变化，已刷新资源目录')
        setSelectedResourceDossier(null)
        setResourceRefreshKey(value => value + 1)
        return
      }
      if (!result) {
        setSelectedResourceDossier(null)
        setResourceRefreshKey(value => value + 1)
        return
      }
      setSelectedResourceDossier({ ...result, status: 'ready' })
    } catch (error: any) {
      if (resourceDossierGate.current.isCurrent(request)) {
        setSelectedResourceDossier({ id: resource.id, status: 'error' })
        setMessage(error?.message || String(error))
      }
    }
  }
  const loadMoreResourceTrash = async () => {
    if (resourceTrashLoadingMore || !resourceTrashArchive.hasMore) return
    const request = resourceTrashGate.current.begin()
    setResourceTrashLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getResourceTrashArchive({
        query: resourceTrashQuery.trim() || undefined,
        limit: 40,
        offset: resourceTrashArchive.items.length,
        revision: resourceTrashArchive.revision
      })
      if (!resourceTrashGate.current.isCurrent(request)) return
      if (result.stale) {
        setResourceRefreshKey(value => value + 1)
        return
      }
      setResourceTrashArchive((current: any) => ({
        ...result,
        status: 'ready',
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))]
      }))
    } catch (error: any) {
      if (resourceTrashGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (resourceTrashGate.current.isCurrent(request)) setResourceTrashLoadingMore(false)
    }
  }
  const resourceTrash = resourceTrashArchive.items || []
  const selectedEntityClaims = graphWorkspace.focus?.claims || []
  const selectedEntityEvents = graphWorkspace.focus?.events || []
  const selectedEntityRelations = graphWorkspace.focus?.relations || []
  const dossierClaims = entityDossierPages.claims?.items || []
  const dossierRelations = entityDossierPages.relations?.items || []
  const dossierEvents = entityDossierPages.events?.items || []
  const selectedEntityRelationHistory = graphWorkspace.focus?.relationHistory || []
  const selectedEntityCorrections = graphWorkspace.focus?.entityCorrections || []
  const selectedEntityRelationCorrections = graphWorkspace.focus?.relationCorrections || []
  const selectedEntityProfileCorrections = graphWorkspace.focus?.entityProfileCorrections || []
  const selectedEntityTasks: Task[] = graphWorkspace.focus?.tasks || []

  const syncNow = async () => {
    setSyncing(true)
    setMessage('')
    try {
      const result = await window.electronAPI.aiAssistant.sync()
      setMessage(result.cancelled
        ? result.message
        : result.success === false || result.partial
          ? `本轮已保存成功部分，但仍需重试：${result.message || result.documentSourceError || result.calendarSourceError || result.mailSourceError || '仍有来源或分页等待补齐'}`
          : `补齐完成：${result.newMessageCount} 条新消息，${result.newTaskCount} 个新待办`)
      await load()
      setReviewRefreshKey(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setSyncing(false)
    }
  }

  const cancelSync = async () => {
    const result = await window.electronAPI.aiAssistant.cancelSync()
    setMessage(result.message)
    await load()
  }

  const openSettings = async () => {
    setSettings(await window.electronAPI.aiAssistant.getSettings())
    setShowSettings(true)
  }

  const saveSettings = async () => {
    await window.electronAPI.aiAssistant.setSettings(settings)
    setShowSettings(false)
    await load()
    setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
  }

  const toggleTask = async (task: Task) => {
    try {
      await window.electronAPI.aiAssistant.updateTask(task.id, {
        status: task.status === 'done' ? 'todo' : 'done'
      }, task.mutationToken)
      await load()
      if (selectedProjectId) setProjectWorkspaceRefreshKey(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
      await load()
      setTaskWorkspaceRefreshKey(value => value + 1)
      if (selectedProjectId) setProjectWorkspaceRefreshKey(value => value + 1)
    }
  }

  const restoreArchivedTask = async (task: Task) => {
    try {
      await window.electronAPI.aiAssistant.updateTask(task.id, { status: 'todo' }, task.mutationToken)
      setSelectedTaskId('')
      await load()
      if (task.project && selectedProjectId === task.project) {
        setProjectWorkspaceRefreshKey(value => value + 1)
      }
    } catch (error: any) {
      setMessage(error?.message || String(error))
      setTaskArchiveRefreshKey(value => value + 1)
      setTaskWorkspaceRefreshKey(value => value + 1)
      await load()
    }
  }

  const loadMoreTaskArchive = async () => {
    if (taskArchiveLoadingMore || !taskArchive.hasMore) return
    const request = taskArchiveGate.current.begin()
    setTaskArchiveLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getTaskArchive({
        ...taskArchiveOptions,
        offset: taskArchive.items.length,
        limit: 40,
        revision: taskArchive.revision
      })
      if (!taskArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('历史任务在加载期间已有变化，已自动从第一页刷新')
        setTaskArchiveRefreshKey(value => value + 1)
        return
      }
      setTaskArchive(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: Task) =>
          !current.items.some(known => known.id === item.id))],
        loading: false
      }))
    } catch (error: any) {
      if (taskArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (taskArchiveGate.current.isCurrent(request)) setTaskArchiveLoadingMore(false)
    }
  }

  const loadMoreTaskOwnershipReviews = async () => {
    if (taskOwnershipLoadingMore || !taskOwnershipReviews.hasMore) return
    const request = taskOwnershipGate.current.begin()
    setTaskOwnershipLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getTaskOwnershipReviews({
        ...taskOwnershipOptions,
        offset: taskOwnershipReviews.items.length,
        limit: 40,
        revision: taskOwnershipReviews.revision
      })
      if (!taskOwnershipGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('任务归属待确认列表已有变化，已自动从第一页刷新')
        setTaskOwnershipRefreshKey(value => value + 1)
        return
      }
      setTaskOwnershipReviews(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: Task) =>
          !current.items.some(known => known.id === item.id))],
        loading: false
      }))
    } catch (error: any) {
      if (taskOwnershipGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (taskOwnershipGate.current.isCurrent(request)) setTaskOwnershipLoadingMore(false)
    }
  }

  const loadMoreTaskFeedback = async () => {
    if (taskFeedbackLoadingMore || !taskFeedbackArchive.hasMore) return
    const request = taskFeedbackArchiveGate.current.begin()
    setTaskFeedbackLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getTaskReviewDecisionPage({
        ...taskFeedbackOptions,
        offset: taskFeedbackArchive.items.length,
        limit: 40,
        revision: taskFeedbackArchive.revision
      })
      if (!taskFeedbackArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('任务归属决策档案已有变化，已自动从第一页刷新')
        setTaskFeedbackRefreshKey(value => value + 1)
        return
      }
      setTaskFeedbackArchive(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some(known => known.evidence_fingerprint === item.evidence_fingerprint))],
        loading: false
      }))
    } catch (error: any) {
      if (taskFeedbackArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (taskFeedbackArchiveGate.current.isCurrent(request)) setTaskFeedbackLoadingMore(false)
    }
  }

  const loadMoreMemoryDeletionAudit = async () => {
    if (memoryDeletionLoadingMore || !memoryDeletionArchive.hasMore) return
    const request = memoryDeletionArchiveGate.current.begin()
    setMemoryDeletionLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getMemoryDeletionAuditPage({
        ...memoryDeletionOptions,
        offset: memoryDeletionArchive.items.length,
        limit: 40,
        revision: memoryDeletionArchive.revision
      })
      if (!memoryDeletionArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('删除与不重要清理档案已有变化，已自动从第一页刷新')
        setMemoryDeletionArchiveRefreshKey(value => value + 1)
        return
      }
      setMemoryDeletionArchive(current => ({
        ...result,
        items: [
          ...current.items,
          ...result.items.filter((item: any) =>
            !current.items.some((known: any) => known.id === item.id))
        ],
        loading: false
      }))
    } catch (error: any) {
      if (memoryDeletionArchiveGate.current.isCurrent(request)) {
        setMessage(error?.message || String(error))
      }
    } finally {
      if (memoryDeletionArchiveGate.current.isCurrent(request)) {
        setMemoryDeletionLoadingMore(false)
      }
    }
  }

  const loadMoreIngestionRuns = async () => {
    if (ingestionArchiveLoadingMore || !ingestionArchive.hasMore) return
    const request = ingestionArchiveGate.current.begin()
    setIngestionArchiveLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getIngestionRunPage({
        ...ingestionArchiveOptions,
        offset: ingestionArchive.items.length,
        limit: 30,
        revision: ingestionArchive.revision
      })
      if (!ingestionArchiveGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('增量运行档案已有变化，已自动从第一页刷新')
        setIngestionArchiveRefreshKey(value => value + 1)
        return
      }
      setIngestionArchive(current => ({
        ...page,
        items: [
          ...current.items,
          ...page.items.filter((item: any) =>
            !current.items.some((known: any) => known.id === item.id))
        ],
        loading: false
      }))
    } catch (error: any) {
      if (ingestionArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (ingestionArchiveGate.current.isCurrent(request)) setIngestionArchiveLoadingMore(false)
    }
  }

  const loadIngestionDossier = async (runId: string): Promise<void> => {
    const request = ingestionDossierGate.current.begin()
    setIngestionDossier({ id: runId, loading: true })
    try {
      const dossier = await window.electronAPI.aiAssistant.getIngestionRunDossier(
        runId,
        { batchOffset: 0, batchLimit: 40 }
      )
      if (!ingestionDossierGate.current.isCurrent(request)) return
      if (dossier?.stale) {
        window.setTimeout(() => {
          if (ingestionDossierGate.current.isCurrent(request)) {
            void loadIngestionDossier(runId)
          }
        }, 250)
        return
      }
      setIngestionDossier(dossier)
    } catch (error: any) {
      if (ingestionDossierGate.current.isCurrent(request)) {
        setIngestionDossier({ id: runId, error: error?.message || String(error) })
      }
    }
  }

  const openIngestionDossier = async (runId: string) => {
    if (ingestionDossier?.id === runId) {
      ingestionDossierGate.current.invalidate()
      setIngestionDossier(null)
      return
    }
    await loadIngestionDossier(runId)
  }

  const loadMoreIngestionBatches = async () => {
    if (!ingestionDossier?.id || !ingestionDossier.batchHasMore ||
      ingestionBatchesLoadingMore) return
    const request = ingestionDossierGate.current.begin()
    setIngestionBatchesLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getIngestionRunDossier(
        ingestionDossier.id,
        {
          batchOffset: ingestionDossier.batches?.length || 0,
          batchLimit: 40,
          revision: ingestionDossier.revision
        }
      )
      if (!page || !ingestionDossierGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('该运行的批次明细已有变化，已自动重新载入')
        void loadIngestionDossier(ingestionDossier.id)
        return
      }
      setIngestionDossier((current: any) => ({
        ...current,
        ...page,
        batches: [
          ...(current.batches || []),
          ...page.batches.filter((batch: any) =>
            !(current.batches || []).some((known: any) =>
              known.batch_index === batch.batch_index))
        ]
      }))
    } catch (error: any) {
      if (ingestionDossierGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (ingestionDossierGate.current.isCurrent(request)) setIngestionBatchesLoadingMore(false)
    }
  }

  const loadIngestionRecoveryQueue = async (): Promise<void> => {
    const request = ingestionRecoveryGate.current.begin()
    setIngestionRecoveryLoadingMore(false)
    setIngestionRecoveryQueue({ items: [], total: 0, hasMore: false, loading: true })
    try {
      const page = await window.electronAPI.aiAssistant
        .getIngestionRecoveryPage({ limit: 30 })
      if (!ingestionRecoveryGate.current.isCurrent(request)) return
      if (page.stale) {
        window.setTimeout(() => {
          if (ingestionRecoveryGate.current.isCurrent(request)) {
            void loadIngestionRecoveryQueue()
          }
        }, 250)
        return
      }
      setIngestionRecoveryQueue({ ...page, loading: false })
    } catch (error: any) {
      if (!ingestionRecoveryGate.current.isCurrent(request)) return
      setIngestionRecoveryQueue({
        items: [], total: 0, hasMore: false, loading: false,
        error: error?.message || String(error)
      })
    }
  }

  const toggleIngestionRecoveryQueue = async () => {
    if (ingestionRecoveryQueue) {
      ingestionRecoveryGate.current.invalidate()
      setIngestionRecoveryQueue(null)
      return
    }
    await loadIngestionRecoveryQueue()
  }

  const loadMoreIngestionRecoveryQueue = async () => {
    if (!ingestionRecoveryQueue?.hasMore || ingestionRecoveryLoadingMore) return
    const request = ingestionRecoveryGate.current.begin()
    setIngestionRecoveryLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getIngestionRecoveryPage({
        offset: ingestionRecoveryQueue.items?.length || 0,
        limit: 30,
        revision: ingestionRecoveryQueue.revision
      })
      if (!ingestionRecoveryGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('恢复队列已有变化，已自动从第一页刷新')
        await loadIngestionRecoveryQueue()
        return
      }
      setIngestionRecoveryQueue((current: any) => ({
        ...page,
        items: [...(current?.items || []), ...(page.items || [])]
      }))
    } catch (error: any) {
      if (ingestionRecoveryGate.current.isCurrent(request)) {
        setMessage(error?.message || String(error))
      }
    } finally {
      if (ingestionRecoveryGate.current.isCurrent(request)) {
        setIngestionRecoveryLoadingMore(false)
      }
    }
  }

  const retryPreparedIngestion = async () => {
    if (ingestionRecoveryRetrying) return
    setIngestionRecoveryRetrying(true)
    try {
      const result = await window.electronAPI.aiAssistant.retryPreparedIngestion()
      setMessage(`恢复重试完成：尝试 ${result.attempted} 批，成功 ${result.recovered} 批，` +
        `失败 ${result.failed} 批，仍待处理 ${result.remaining} 批。`)
      await loadIngestionRecoveryQueue()
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setIngestionRecoveryRetrying(false)
    }
  }

  const openTaskFeedbackDossier = async (evidenceFingerprint: string) => {
    const request = taskFeedbackDossierGate.current.begin()
    setTaskFeedbackDossier({ evidence_fingerprint: evidenceFingerprint, loading: true })
    try {
      const dossier = await window.electronAPI.aiAssistant.getTaskReviewDecisionDossier(
        evidenceFingerprint,
        { historyOffset: 0, historyLimit: 50 }
      )
      if (!taskFeedbackDossierGate.current.isCurrent(request)) return
      if (dossier?.stale) {
        window.setTimeout(() => {
          if (taskFeedbackDossierGate.current.isCurrent(request)) {
            void openTaskFeedbackDossier(evidenceFingerprint)
          }
        }, 250)
        return
      }
      setTaskFeedbackDossier(dossier)
    } catch (error: any) {
      if (taskFeedbackDossierGate.current.isCurrent(request)) {
        setTaskFeedbackDossier({
          evidence_fingerprint: evidenceFingerprint,
          error: error?.message || String(error)
        })
      }
    }
  }

  const loadMoreTaskFeedbackHistory = async () => {
    if (!taskFeedbackDossier?.evidence_fingerprint || !taskFeedbackDossier.historyHasMore ||
        taskFeedbackHistoryLoadingMore) return
    const request = taskFeedbackDossierGate.current.begin()
    setTaskFeedbackHistoryLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getTaskReviewDecisionDossier(
        taskFeedbackDossier.evidence_fingerprint,
        {
          historyOffset: taskFeedbackDossier.history?.length || 0,
          historyLimit: 50,
          revision: taskFeedbackDossier.revision
        }
      )
      if (!page || !taskFeedbackDossierGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('任务归属动作历史已有变化，已重新载入最新详情。')
        void openTaskFeedbackDossier(taskFeedbackDossier.evidence_fingerprint)
        return
      }
      setTaskFeedbackDossier((current: any) => ({
        ...current,
        ...page,
        history: [
          ...(current.history || []),
          ...page.history.filter((item: any) =>
            !(current.history || []).some((known: any) => known.id === item.id))
        ]
      }))
    } catch (error: any) {
      if (taskFeedbackDossierGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (taskFeedbackDossierGate.current.isCurrent(request)) setTaskFeedbackHistoryLoadingMore(false)
    }
  }

  const loadMoreEntityDossierSection = async (kind: 'claims' | 'relations' | 'events') => {
    const currentPage = entityDossierPages[kind]
    if (!selectedEntityId || entityDossierLoadingMore[kind] || !currentPage?.hasMore) return
    const gate = kind === 'claims'
      ? entityClaimGate.current
      : kind === 'relations'
        ? entityRelationGate.current
        : entityEventGate.current
    const request = gate.begin()
    setEntityDossierLoadingMore(current => ({ ...current, [kind]: true }))
    try {
      const options = {
        entityId: selectedEntityId,
        limit: 40,
        offset: currentPage.items.length,
        revision: currentPage.revision
      }
      const page = kind === 'claims'
        ? await window.electronAPI.aiAssistant.getClaimArchive({
            ...options,
            predicate: entityClaimQuery.trim() || undefined,
            status: entityClaimStatus === 'all' ? undefined : entityClaimStatus,
            sourceId: entityClaimSource === 'all' ? undefined : entityClaimSource,
            from: entityClaimFrom ? new Date(`${entityClaimFrom}T00:00:00+08:00`).toISOString() : undefined,
            to: entityClaimTo ? new Date(`${entityClaimTo}T23:59:59.999+08:00`).toISOString() : undefined
          })
        : kind === 'relations'
          ? await window.electronAPI.aiAssistant.getEntityRelationPage({
              ...options,
              query: entityRelationQuery.trim() || undefined,
              direction: entityRelationDirection,
              status: entityRelationStatus,
              sourceId: entityRelationSource === 'all' ? undefined : entityRelationSource
            })
          : await window.electronAPI.aiAssistant.getEventTimeline({
              ...options,
              query: entityEventQuery.trim() || undefined,
              status: entityEventStatus === 'all' ? undefined : entityEventStatus,
              sourceId: entityEventSource === 'all' ? undefined : entityEventSource,
              from: entityEventFrom ? new Date(`${entityEventFrom}T00:00:00+08:00`).toISOString() : undefined,
              to: entityEventTo ? new Date(`${entityEventTo}T23:59:59.999+08:00`).toISOString() : undefined
            })
      if (!gate.isCurrent(request)) return
      if (page.stale) {
        setMessage('人物档案在浏览期间已有更新，已从最新第一页重新载入。')
        refreshEntityDossierSection(kind)
        return
      }
      setEntityDossierPages((current: any) => ({
        ...current,
        [kind]: {
          ...page,
          items: [
            ...(current[kind]?.items || []),
            ...page.items.filter((item: any) =>
              !(current[kind]?.items || []).some((known: any) => known.id === item.id))
          ]
        }
      }))
    } catch (error: any) {
      if (gate.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (gate.isCurrent(request)) {
        setEntityDossierLoadingMore(current => ({ ...current, [kind]: false }))
      }
    }
  }

  const loadMoreEntityEvidence = async () => {
    if (!selectedEntityId || entityEvidenceLoadingMore || !entityEvidencePage.hasMore) return
    const request = entityEvidenceGate.current.begin()
    setEntityEvidenceLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getEntityEvidencePage({
        entityId: selectedEntityId,
        query: entityEvidenceQuery.trim() || undefined,
        sourceId: entityEvidenceSource || undefined,
        limit: 40,
        offset: entityEvidencePage.items.length,
        revision: entityEvidencePage.revision
      })
      if (!entityEvidenceGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('人物相关原文在浏览期间已有变化，已从最新第一页重新载入。')
        setEntityEvidenceRefreshKey(value => value + 1)
        return
      }
      setEntityEvidencePage((current: any) => ({
        ...page,
        status: 'ready',
        items: [
          ...current.items,
          ...page.items.filter((item: any) => !current.items.some((known: any) =>
            evidenceArchiveIdentity(known) === evidenceArchiveIdentity(item)))
        ]
      }))
    } catch (error: any) {
      if (entityEvidenceGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (entityEvidenceGate.current.isCurrent(request)) setEntityEvidenceLoadingMore(false)
    }
  }

  const loadMoreEntityTasks = async () => {
    const focus = graphWorkspace.focus
    if (!selectedEntityId || entityTaskLoadingMore || !focus?.taskHasMore) return
    const request = entityTaskGate.current.begin()
    setEntityTaskLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getEntityTaskPage(
        selectedEntityId,
        {
          limit: 40,
          offset: focus.tasks?.length || 0,
          revision: focus.taskRevision
        }
      )
      if (!entityTaskGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('人物关联任务在浏览期间已有变化，已重新载入最新人物档案。')
        setGraphWorkspaceRefreshKey(value => value + 1)
        return
      }
      setGraphWorkspace((current: any) => ({
        ...current,
        focus: {
          ...current.focus,
          tasks: [
            ...(current.focus?.tasks || []),
            ...page.items.filter((item: any) =>
              !(current.focus?.tasks || []).some((known: any) => known.id === item.id))
          ],
          taskTotal: page.total,
          taskHasMore: page.hasMore,
          tasksTruncated: page.hasMore,
          taskRevision: page.revision
        }
      }))
    } catch (error: any) {
      if (entityTaskGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (entityTaskGate.current.isCurrent(request)) setEntityTaskLoadingMore(false)
    }
  }

  const loadMoreEntityAudit = async (
    field: 'relationHistory' | 'entityCorrections' | 'relationCorrections' | 'entityProfileCorrections',
    kind: 'relation_history' | 'name_correction' | 'relation_correction' | 'profile_correction'
  ) => {
    const focus = graphWorkspace.focus
    const pageMeta = focus?.auditPages?.[field]
    if (!selectedEntityId || entityAuditLoadingMore || !pageMeta?.hasMore) return
    const request = entityAuditGate.current.begin()
    setEntityAuditLoadingMore(field)
    try {
      const page = await window.electronAPI.aiAssistant.getEntityAuditPage(
        selectedEntityId,
        {
          kind,
          limit: 40,
          offset: focus[field]?.length || 0,
          revision: pageMeta.revision
        }
      )
      if (!entityAuditGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('人物变化历史在浏览期间已有更新，已重新载入最新人物档案。')
        setGraphWorkspaceRefreshKey(value => value + 1)
        return
      }
      setGraphWorkspace((current: any) => ({
        ...current,
        focus: {
          ...current.focus,
          [field]: [
            ...(current.focus?.[field] || []),
            ...page.items.filter((item: any) =>
              !(current.focus?.[field] || []).some((known: any) => known.id === item.id))
          ],
          auditPages: {
            ...(current.focus?.auditPages || {}),
            [field]: {
              total: page.total,
              hasMore: page.hasMore,
              revision: page.revision,
              stale: false
            }
          }
        }
      }))
    } catch (error: any) {
      if (entityAuditGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (entityAuditGate.current.isCurrent(request)) setEntityAuditLoadingMore('')
    }
  }

  const loadMoreProjectMemorySection = async (kind: 'claims' | 'events') => {
    const projectEntityId = String(projectWorkspace.project?.entityId || '')
    const currentPage = projectMemoryPages[kind]
    if (!projectEntityId || projectMemoryLoadingMore || !currentPage?.hasMore) return
    const request = projectMemoryGate.current.begin()
    setProjectMemoryLoadingMore(kind)
    try {
      const options = {
        entityId: projectEntityId,
        limit: 40,
        offset: currentPage.items.length,
        revision: currentPage.revision
      }
      const page = kind === 'claims'
        ? await window.electronAPI.aiAssistant.getClaimArchive(options)
        : await window.electronAPI.aiAssistant.getEventTimeline(options)
      if (!projectMemoryGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('项目事实或事件在浏览期间已有更新，已从最新第一页重新载入。')
        setProjectMemoryRefreshKey(value => value + 1)
        return
      }
      setProjectMemoryPages((current: any) => ({
        ...current,
        [kind]: {
          ...page,
          items: [
            ...(current[kind]?.items || []),
            ...page.items.filter((item: any) =>
              !(current[kind]?.items || []).some((known: any) => known.id === item.id))
          ]
        }
      }))
    } catch (error: any) {
      if (projectMemoryGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (projectMemoryGate.current.isCurrent(request)) setProjectMemoryLoadingMore('')
    }
  }

  const loadMoreProjectTasks = async () => {
    const project = projectWorkspace.project
    if (!selectedProjectId || projectTaskLoadingMore || !project?.taskHasMore) return
    const request = projectTaskGate.current.begin()
    setProjectTaskLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getProjectTaskPage(
        selectedProjectId,
        {
          limit: 40,
          offset: project.tasks?.length || 0,
          revision: project.taskRevision
        }
      )
      if (!projectTaskGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('项目任务在浏览期间已有更新，已重新载入最新项目档案。')
        setProjectWorkspaceRefreshKey(value => value + 1)
        return
      }
      setProjectWorkspace((current: any) => ({
        ...current,
        project: {
          ...current.project,
          tasks: [
            ...(current.project?.tasks || []),
            ...page.items.filter((item: any) =>
              !(current.project?.tasks || []).some((known: any) => known.id === item.id))
          ],
          taskTotal: page.total,
          taskHasMore: page.hasMore,
          taskRevision: page.revision
        }
      }))
    } catch (error: any) {
      if (projectTaskGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (projectTaskGate.current.isCurrent(request)) setProjectTaskLoadingMore(false)
    }
  }

  const loadMoreProjectRisks = async () => {
    const project = projectWorkspace.project
    if (!selectedProjectId || projectRiskLoadingMore || !project?.riskHasMore) return
    const request = projectRiskGate.current.begin()
    setProjectRiskLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getProjectRiskPage(
        selectedProjectId,
        {
          limit: 40,
          offset: project.risks?.length || 0,
          revision: project.riskRevision
        }
      )
      if (!projectRiskGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('项目风险在浏览期间已有变化，已重新载入最新项目档案。')
        setProjectWorkspaceRefreshKey(value => value + 1)
        return
      }
      setProjectWorkspace((current: any) => ({
        ...current,
        project: {
          ...current.project,
          risks: [
            ...(current.project?.risks || []),
            ...page.items.filter((item: any) =>
              !(current.project?.risks || []).some((known: any) =>
                `${known.taskId}:${known.kind}` === `${item.taskId}:${item.kind}`))
          ],
          riskTotal: page.total,
          riskHasMore: page.hasMore,
          riskRevision: page.revision
        }
      }))
    } catch (error: any) {
      if (projectRiskGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (projectRiskGate.current.isCurrent(request)) setProjectRiskLoadingMore(false)
    }
  }

  const saveTask = async () => {
    if (!editingTask?.id || !String(editingTask.title || '').trim()) return
    try {
      await window.electronAPI.aiAssistant.updateTask(editingTask.id, {
        title: editingTask.title,
        detail: editingTask.detail,
        owner: editingTask.owner,
        collaborators: String(editingTask.collaboratorsText || '').split(/[,，、\n]/).map(value => value.trim()).filter(Boolean),
        project: editingTask.project,
        dependsOnIds: editingTask.dependsOnIds,
        taskKind: editingTask.taskKind,
        due: editingTask.due,
        priority: editingTask.priority,
        status: editingTask.status
      }, editingTask.mutationToken)
      setEditingTask(null)
      await load()
    } catch (error: any) {
      setEditingTask(null)
      setMessage(error?.message || String(error))
      await load()
      setTaskWorkspaceRefreshKey(value => value + 1)
    }
  }

  const completeVisibleTasks = async () => {
    const targets = displayedTasks.filter(task => !['done', 'cancelled'].includes(task.status))
    try {
      await window.electronAPI.aiAssistant.updateTasks(targets.map(task => ({
        id: task.id,
        patch: { status: 'done', reason: 'bulk_complete_visible' },
        mutationToken: task.mutationToken
      })))
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
      await load()
    }
  }

  const loadMoreActiveTasks = async () => {
    if (taskWorksetLoadingMore || !taskWorkset.hasMore) return
    setTaskWorksetLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getActiveTaskWorkset({
        ...taskWorksetOptions,
        offset: taskWorkset.items.length,
        revision: taskWorkset.revision
      })
      if (result.stale) {
        setTaskWorksetRefreshKey(value => value + 1)
        return
      }
      setTaskWorkset(current => ({
        ...result,
        items: [...current.items, ...result.items]
      }))
    } finally {
      setTaskWorksetLoadingMore(false)
    }
  }

  const loadMoreProjects = async () => {
    if (projectDirectoryLoadingMore || !projectDirectory.hasMore) return
    setProjectDirectoryLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getProjectDirectory({
        ...projectDirectoryOptions,
        offset: projectDirectory.items.length,
        revision: projectDirectory.revision
      })
      if (result.stale) {
        setProjectDirectoryRefreshKey(value => value + 1)
        return
      }
      setProjectDirectory((current: any) => ({
        ...result,
        loading: false,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))]
      }))
    } finally {
      setProjectDirectoryLoadingMore(false)
    }
  }

  const findGraphPath = async () => {
    if (!pathFromId || !pathToId) return
    const fromRevision = String(pathFromSelection?.directoryRevision || '')
    const toRevision = String(pathToSelection?.directoryRevision || '')
    if (!fromRevision || fromRevision !== toRevision) {
      setMessage('选择起点和终点期间可信实体目录发生了变化，请重新选择两端。')
      setPathFromId('')
      setPathToId('')
      setPathFromSelection(null)
      setPathToSelection(null)
      return
    }
    try {
      const [path, common] = await Promise.all([
        window.electronAPI.aiAssistant.findGraphPath(pathFromId, pathToId, 6, fromRevision),
        window.electronAPI.aiAssistant.findCommonNeighbors(pathFromId, pathToId, fromRevision)
      ])
      setGraphPath(path)
      setGraphCommonNeighbors(common)
    } catch (error: any) {
      setMessage(error?.message || String(error))
      setPathFromId('')
      setPathToId('')
      setPathFromSelection(null)
      setPathToSelection(null)
      setGraphPath(null)
      setGraphCommonNeighbors(null)
    }
  }

  const backupMemory = async () => {
    if (backingUpMemory) return
    setBackingUpMemory(true)
    try {
      const result = await window.electronAPI.aiAssistant.createMemoryBackup()
      setMessage(`个人记忆备份完成：${result.path}`)
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setBackingUpMemory(false)
    }
  }

  const openMemoryRestoreDialog = async (backup: any) => {
    if (restoringMemory || !backup?.path || !backup?.hasState) return
    const requestId = memoryRestoreGate.current.begin()
    setMemoryRestoreConfirmation('')
    setMemoryRestoreDialog({ backup, status: 'loading' })
    try {
      const preview = await window.electronAPI.aiAssistant.inspectMemoryBackup(backup.path)
      if (!memoryRestoreGate.current.isCurrent(requestId)) return
      setMemoryRestoreDialog({ backup, preview, status: 'ready' })
    } catch (error: any) {
      if (!memoryRestoreGate.current.isCurrent(requestId)) return
      setMemoryRestoreDialog({
        backup,
        status: 'error',
        error: error?.message || String(error)
      })
    }
  }

  const closeMemoryRestoreDialog = () => {
    if (restoringMemory) return
    memoryRestoreGate.current.invalidate()
    setMemoryRestoreDialog(null)
    setMemoryRestoreConfirmation('')
  }

  const restoreMemory = async () => {
    const path = memoryRestoreDialog?.preview?.path
    if (
      restoringMemory
      || memoryRestoreDialog?.status !== 'ready'
      || !path
      || memoryRestoreConfirmation !== '恢复快照'
    ) return
    memoryRestoreGate.current.invalidate()
    setRestoringMemory(true)
    setMemoryRestoreDialog((current: any) => current ? { ...current, status: 'restoring', error: '' } : current)
    try {
      await window.electronAPI.aiAssistant.restoreMemoryBackup(path, {
        previewToken: memoryRestoreDialog.preview.previewToken,
        confirmation: memoryRestoreConfirmation
      })
      setMessage('个人记忆已恢复；恢复前的安全快照已保留。')
      setMemoryRestoreDialog(null)
      setMemoryRestoreConfirmation('')
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
      await load()
    } catch (error: any) {
      const message = error?.message || String(error)
      setMessage(message)
      setMemoryRestoreDialog((current: any) => current ? { ...current, status: 'error', error: message } : current)
    } finally {
      setRestoringMemory(false)
    }
  }

  const openExportMemoryBundle = () => {
    setMigrationPassphrase('')
    setMigrationPassphraseConfirmation('')
    setMigrationDialog({ mode: 'export' })
  }

  const exportMemoryBundle = async () => {
    if (migratingMemory) return
    if (migrationPassphrase.normalize('NFKC').length < 12) {
      setMessage('迁移口令至少需要 12 个字符。')
      return
    }
    if (migrationPassphraseConfirmation !== migrationPassphrase) {
      setMessage('两次输入的迁移口令不一致。')
      return
    }
    const selected = await window.electronAPI.dialog.saveFile({
      title: '导出个人记忆迁移包',
      defaultPath: `WeFlow-个人记忆-${new Date().toISOString().slice(0, 10)}.weflow-memory`,
      filters: [{ name: 'WeFlow 个人记忆', extensions: ['weflow-memory'] }]
    })
    if (selected.canceled || !selected.filePath) return
    setMigratingMemory(true)
    try {
      const result = await window.electronAPI.aiAssistant.exportMemoryBundle(selected.filePath, migrationPassphrase)
      setMigrationDialog(null)
      setMigrationPassphrase('')
      setMigrationPassphraseConfirmation('')
      setMessage(`口令保护的便携迁移包已校验并导出：${result.path}`)
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setMigratingMemory(false)
    }
  }

  const openImportMemoryBundle = async () => {
    if (migratingMemory || restoringMemory) return
    const selected = await window.electronAPI.dialog.openFile({
      title: '选择个人记忆迁移包',
      properties: ['openFile'],
      filters: [{ name: 'WeFlow 个人记忆', extensions: ['weflow-memory'] }]
    })
    const bundlePath = selected.filePaths?.[0]
    if (selected.canceled || !bundlePath) return
    setMigrationPassphrase('')
    setMigrationPassphraseConfirmation('')
    setMigrationImportConfirmation('')
    setMigrationDialog({ mode: 'import', bundlePath, status: 'unlock' })
  }

  const importMemoryBundle = async () => {
    const bundlePath = migrationDialog?.bundlePath
    if (!bundlePath || migratingMemory || restoringMemory) return
    setMigratingMemory(true)
    try {
      if (migrationDialog.status !== 'preview' || !migrationDialog.inspected?.previewToken) {
        const inspected = await window.electronAPI.aiAssistant.inspectMemoryBundle(bundlePath, migrationPassphrase)
        setMigrationImportConfirmation('')
        setMigrationDialog((current: any) => ({
          ...current,
          status: 'preview',
          inspected,
          error: undefined
        }))
      } else {
        if (migrationImportConfirmation !== '导入并替换') return
        await window.electronAPI.aiAssistant.importMemoryBundle(bundlePath, migrationPassphrase, {
          previewToken: migrationDialog.inspected.previewToken,
          confirmation: migrationImportConfirmation
        })
        setMigrationDialog(null)
        setMigrationPassphrase('')
        setMigrationImportConfirmation('')
        setMessage('个人记忆迁移完成；导入前的安全快照已保留。')
        setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
        await load()
      }
    } catch (error: any) {
      setMigrationDialog((current: any) => ({
        ...current,
        status: 'error',
        error: error?.message || String(error)
      }))
    } finally {
      setMigratingMemory(false)
    }
  }

  const closeMigrationDialog = () => {
    if (migratingMemory) return
    setMigrationDialog(null)
    setMigrationPassphrase('')
    setMigrationPassphraseConfirmation('')
    setMigrationImportConfirmation('')
  }

  const indexMemoryVectors = async () => {
    if (indexingVectors) return
    setIndexingVectors(true)
    try {
      const result = await window.electronAPI.aiAssistant.indexMemoryVectors()
      setMessage(`本地语义索引完成：${result.indexed} 条新增，累计 ${result.total - result.pending}/${result.total} 条。`)
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setIndexingVectors(false)
    }
  }

  const decideReview = async (
    id: string,
    decision: 'confirmed' | 'rejected',
    options?: {
      expectedRevision?: string
      mergeTargetEntityId?: string
      correctedCanonicalName?: string
      correctedSummaryText?: string
      correctedAliasText?: string
      relationCorrection?: { subjectId?: string; predicate?: string; objectId?: string }
    }
  ) => {
    try {
      await window.electronAPI.aiAssistant.updateGraphReview(id, decision, {
        ...options,
        expectedRevision: String(reviewPage.revision || '')
      })
      setMergeTargets(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setEntityNameEdits(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setRelationEdits(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setProfileEdits(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
      await load()
      setReviewRefreshKey(value => value + 1)
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('审阅队列在展示后发生了变化')) {
        reviewPageGate.current.invalidate()
        setReviewRefreshKey(value => value + 1)
      }
    }
  }

  const decideTaskReview = async (id: string, decision: 'mine' | 'rejected') => {
    try {
      await window.electronAPI.aiAssistant.updateTaskReview(
        id,
        decision,
        String(taskOwnershipReviews.revision || '')
      )
      await load()
      setTaskOwnershipRefreshKey(value => value + 1)
      setTaskFeedbackRefreshKey(value => value + 1)
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('待办归属记录在展示后发生了变化')) {
        taskOwnershipGate.current.invalidate()
        setTaskOwnershipRefreshKey(value => value + 1)
        setTaskFeedbackRefreshKey(value => value + 1)
      }
    }
  }

  const revertTaskReview = async (evidenceFingerprint: string) => {
    try {
      const expectedRevision = taskFeedbackDossier?.evidence_fingerprint === evidenceFingerprint
        ? taskFeedbackDossier.revision
        : taskFeedbackArchive.revision
      await window.electronAPI.aiAssistant.revertTaskReview(
        evidenceFingerprint,
        String(expectedRevision || '')
      )
      if (taskFeedbackDossier?.evidence_fingerprint === evidenceFingerprint) {
        taskFeedbackDossierGate.current.invalidate()
        setTaskFeedbackDossier(null)
      }
      await load()
      setTaskOwnershipRefreshKey(value => value + 1)
      setTaskFeedbackRefreshKey(value => value + 1)
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('待办归属记录在展示后发生了变化')) {
        taskOwnershipGate.current.invalidate()
        taskFeedbackArchiveGate.current.invalidate()
        taskFeedbackDossierGate.current.invalidate()
        setTaskFeedbackDossier(null)
        setTaskOwnershipRefreshKey(value => value + 1)
        setTaskFeedbackRefreshKey(value => value + 1)
      }
    }
  }

  const revertMerge = async (id: number) => {
    const request = mergeRevertGate.current.begin()
    setMergeRevertConfirmation('')
    setMergeRevertDialog({ mergeId: id, status: 'loading' })
    try {
      const preview = await window.electronAPI.aiAssistant.previewRevertMerge(
        id,
        String(mergeArchive.revision || '')
      )
      if (!mergeRevertGate.current.isCurrent(request)) return
      setMergeRevertDialog(preview
        ? { mergeId: id, preview, status: preview.safe ? 'ready' : 'blocked' }
        : { mergeId: id, status: 'error', error: '该合并不存在或已经撤销' })
    } catch (error: any) {
      if (!mergeRevertGate.current.isCurrent(request)) return
      const errorMessage = error?.message || String(error)
      setMergeRevertDialog({ mergeId: id, status: 'error', error: errorMessage })
      if (errorMessage.includes('身份合并档案在展示后发生了变化')) {
        mergeArchiveGate.current.invalidate()
        setMergeArchiveRefreshKey(value => value + 1)
      }
    }
  }

  const closeMergeRevertDialog = () => {
    if (mergeRevertDialog?.status === 'reverting') return
    mergeRevertGate.current.invalidate()
    setMergeRevertDialog(null)
    setMergeRevertConfirmation('')
  }

  const confirmRevertMerge = async () => {
    if (mergeRevertDialog?.status !== 'ready' ||
      mergeRevertConfirmation !== '撤销合并' ||
      !mergeRevertDialog.preview?.previewToken) return
    const request = mergeRevertGate.current.begin()
    setMergeRevertDialog((current: any) => ({ ...current, status: 'reverting', error: undefined }))
    try {
      await window.electronAPI.aiAssistant.revertMerge(mergeRevertDialog.mergeId, {
        previewToken: mergeRevertDialog.preview.previewToken,
        confirmation: mergeRevertConfirmation
      })
      if (!mergeRevertGate.current.isCurrent(request)) return
      mergeRevertGate.current.invalidate()
      setMergeRevertDialog(null)
      setMergeRevertConfirmation('')
      setMessage('身份合并已安全撤销；合并前的两个身份和相关关系已恢复。')
      await load()
      setReviewRefreshKey(value => value + 1)
      setMergeArchiveRefreshKey(value => value + 1)
    } catch (error: any) {
      if (!mergeRevertGate.current.isCurrent(request)) return
      const errorMessage = error?.message || String(error)
      setMergeRevertDialog((current: any) => ({
        ...current,
        status: 'error',
        error: errorMessage
      }))
      if (errorMessage.includes('已经变化') || errorMessage.includes('确认已失效')) {
        mergeArchiveGate.current.invalidate()
        setMergeArchiveRefreshKey(value => value + 1)
      }
    }
  }

  const loadMoreMergeHistory = async () => {
    if (mergeArchiveLoadingMore || !mergeArchive.hasMore) return
    const request = mergeArchiveGate.current.begin()
    setMergeArchiveLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getMergeHistoryPage({
        ...mergeArchiveOptions,
        offset: mergeArchive.items.length,
        limit: 40,
        revision: mergeArchive.revision
      })
      if (!mergeArchiveGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('身份合并档案已有变化，已自动从第一页刷新')
        setMergeArchiveRefreshKey(value => value + 1)
        return
      }
      setMergeArchive(current => ({
        ...page,
        items: [
          ...current.items,
          ...page.items.filter((item: any) =>
            !current.items.some((known: any) => known.id === item.id))
        ],
        loading: false
      }))
    } catch (error: any) {
      if (mergeArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (mergeArchiveGate.current.isCurrent(request)) setMergeArchiveLoadingMore(false)
    }
  }

  const loadMoreReviews = async () => {
    if (reviewLoadingMore || !reviewPage.hasMore) return
    const request = reviewPageGate.current.begin()
    setReviewLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getGraphReviewPage({
        status: reviewStatusFilter,
        kind: reviewKindFilter || undefined,
        query: reviewQuery.trim() || undefined,
        offset: reviewPage.items.length,
        limit: 40,
        revision: reviewPage.revision
      })
      if (!reviewPageGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('审阅队列在加载期间已有变化，已自动从第一页刷新')
        setReviewRefreshKey(value => value + 1)
        return
      }
      setReviewPage(current => ({
        ...current,
        ...page,
        items: [...current.items, ...page.items.filter((item: any) =>
          !current.items.some((existing: any) => existing.id === item.id))],
        status: 'ready'
      }))
    } catch (error: any) {
      if (reviewPageGate.current.isCurrent(request)) {
        setReviewPage(current => ({ ...current, status: 'error', error: error?.message || String(error) }))
      }
    } finally {
      if (reviewPageGate.current.isCurrent(request)) setReviewLoadingMore(false)
    }
  }

  const updateMemoryStatus = async (kind: 'claim' | 'event', id: string, nextStatus: 'confirmed' | 'rejected') => {
    const expectedRevision = kind === 'claim' ? claimArchive.revision : eventTimeline.revision
    try {
      await window.electronAPI.aiAssistant.updateMemoryItemStatus(
        kind,
        id,
        nextStatus,
        String(expectedRevision || '')
      )
      await load()
      setClaimArchiveRefreshKey(value => value + 1)
      setEventTimelineRefreshKey(value => value + 1)
      if (memoryItemAudits[`${kind}:${id}`]) void loadMemoryItemAudit(kind, id)
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('事实与事件档案在展示后发生了变化')) {
        claimArchiveGate.current.invalidate()
        eventTimelineGate.current.invalidate()
        setEditingClaim(null)
        setEditingEvent(null)
        setClaimArchiveRefreshKey(value => value + 1)
        setEventTimelineRefreshKey(value => value + 1)
      }
    }
  }

  const permanentlyDeleteMemoryItem = async (
    kind: 'claim' | 'event' | 'relation',
    item: { id?: string; sourceId?: string; title?: string; predicate?: string }
  ) => {
    const id = String(item.id || item.sourceId || '')
    if (!id) return
    const request = memoryDeletionGate.current.begin()
    setMemoryDeletionConfirmation('')
    setMemoryDeletionDialog({
      kind,
      id,
      reason: 'manual_delete',
      label: String(item.title || item.predicate || ''),
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryItem(
        kind, id, 'manual_delete'
      )
      if (!memoryDeletionGate.current.isCurrent(request)) return
      if (!preview) {
        setMemoryDeletionDialog({
          kind, reason: 'manual_delete',
          id,
          label: String(item.title || item.predicate || ''),
          status: 'error',
          error: '该条记忆不存在或已经被删除。'
        })
        return
      }
      setMemoryDeletionDialog({
        kind, id, reason: 'manual_delete', label: preview.label, preview, status: 'ready'
      })
    } catch (error: any) {
      if (!memoryDeletionGate.current.isCurrent(request)) return
      setMemoryDeletionDialog({
        kind, reason: 'manual_delete',
        id,
        label: String(item.title || item.predicate || ''),
        status: 'error',
        error: error?.message || String(error)
      })
    }
  }

  const closeMemoryDeletionDialog = () => {
    memoryDeletionGate.current.invalidate()
    setMemoryDeletionDialog(null)
    setMemoryDeletionConfirmation('')
  }

  const confirmPermanentMemoryDeletion = async () => {
    if (!memoryDeletionDialog || memoryDeletionDialog.status !== 'ready') return
    const expected = memoryDeletionDialog.reason === 'not_important'
      ? '标记不重要' : '永久删除'
    if (memoryDeletionConfirmation !== expected) return
    const { kind, id, reason, preview } = memoryDeletionDialog
    setMemoryDeletionDialog((current: any) => ({ ...current, status: 'deleting', error: undefined }))
    try {
      const result = reason === 'not_important'
        ? await window.electronAPI.aiAssistant.ignoreMemoryItem(kind, id, {
            previewToken: preview.previewToken,
            confirmation: memoryDeletionConfirmation
          })
        : await window.electronAPI.aiAssistant.deleteMemoryItem(kind, id, {
            previewToken: preview.previewToken,
            confirmation: memoryDeletionConfirmation
          })
      const kindLabel = kind === 'claim' ? '事实' : kind === 'event' ? '事件' : '关系'
      setMessage(reason === 'not_important'
        ? `已标记为不重要并清理${kindLabel}；抑制指纹 ${result.fingerprint} 已保存。`
        : `已永久删除${kindLabel}；抑制指纹 ${result.fingerprint} 已保存。`)
      setEditingClaim((current: any) => current?.id === id ? null : current)
      setEditingEvent((current: any) => current?.id === id ? null : current)
      if (memoryAnswer?.citations?.some((citation: any) => citation.documentId === `${kind}:${id}`)) setMemoryAnswer(null)
      closeMemoryDeletionDialog()
      await load()
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setMemoryDeletionDialog((current: any) => ({
        ...current,
        status: 'error',
        error: error?.message || String(error)
      }))
    }
  }

  const ignoreMemoryItem = async (
    kind: 'claim' | 'event',
    item: { id?: string; title?: string; predicate?: string }
  ) => {
    const id = String(item.id || '')
    if (!id) return
    const kindLabel = kind === 'claim' ? '事实' : '事件'
    const label = String(item.predicate || item.title || kindLabel)
    const request = memoryDeletionGate.current.begin()
    setMemoryDeletionConfirmation('')
    setMemoryDeletionDialog({
      kind,
      id,
      reason: 'not_important',
      label,
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryItem(
        kind, id, 'not_important'
      )
      if (!memoryDeletionGate.current.isCurrent(request)) return
      if (!preview) {
        setMemoryDeletionDialog({
          kind,
          id,
          reason: 'not_important',
          label,
          status: 'error',
          error: `该${kindLabel}不存在或已经被清理。`
        })
        return
      }
      setMemoryDeletionDialog({
        kind,
        id,
        reason: 'not_important',
        label: preview.label,
        preview,
        status: 'ready'
      })
    } catch (error: any) {
      if (memoryDeletionGate.current.isCurrent(request)) {
        setMemoryDeletionDialog({
          kind,
          id,
          reason: 'not_important',
          label,
          status: 'error',
          error: error?.message || String(error)
        })
      }
    }
  }

  const deleteMemoryResource = async (resource: any) => {
    const request = resourceDeletionGate.current.begin()
    setResourceDeletionConfirmation('')
    setResourceDeletionDialog({
      action: 'delete',
      resourceId: resource.id,
      title: resource.title || '未命名资源',
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryResource(resource.id)
      if (!resourceDeletionGate.current.isCurrent(request)) return
      setResourceDeletionDialog(preview
        ? { action: 'delete', resourceId: resource.id, title: preview.title, preview, status: 'ready' }
        : { action: 'delete', resourceId: resource.id, title: resource.title, status: 'error',
          error: '该资源不存在或已经进入回收站' })
    } catch (error: any) {
      if (resourceDeletionGate.current.isCurrent(request)) {
        setResourceDeletionDialog({
          action: 'delete',
          resourceId: resource.id,
          title: resource.title,
          status: 'error',
          error: error?.message || String(error)
        })
      }
    }
  }

  const restoreMemoryResource = async (resource: any) => {
    try {
      const result = await window.electronAPI.aiAssistant.restoreMemoryResource(resource.id)
      setMessage(result?.success ? `已恢复资源：${resource.title || '未命名资源'}` : '资源恢复失败')
      await load()
      setResourceRefreshKey(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const purgeMemoryResourceTrash = async (resource: any) => {
    const request = resourceDeletionGate.current.begin()
    setResourceDeletionConfirmation('')
    setResourceDeletionDialog({
      action: 'purge',
      resourceId: resource.id,
      title: resource.title || '未命名资源',
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewPurgeMemoryResourceTrash(resource.id)
      if (!resourceDeletionGate.current.isCurrent(request)) return
      setResourceDeletionDialog(preview
        ? { action: 'purge', resourceId: resource.id, title: preview.title, preview, status: 'ready' }
        : { action: 'purge', resourceId: resource.id, title: resource.title, status: 'error',
          error: '该资源回收站快照不存在或已经清除' })
    } catch (error: any) {
      if (resourceDeletionGate.current.isCurrent(request)) {
        setResourceDeletionDialog({
          action: 'purge',
          resourceId: resource.id,
          title: resource.title,
          status: 'error',
          error: error?.message || String(error)
        })
      }
    }
  }

  const closeResourceDeletionDialog = () => {
    if (resourceDeletionDialog?.status === 'deleting') return
    resourceDeletionGate.current.invalidate()
    setResourceDeletionDialog(null)
    setResourceDeletionConfirmation('')
  }

  const confirmResourceDeletion = async () => {
    if (!resourceDeletionDialog?.preview || resourceDeletionDialog.status !== 'ready') return
    const expected = resourceDeletionDialog.action === 'purge' ? '永久删除资源' : '移入回收站'
    if (resourceDeletionConfirmation !== expected) return
    const { action, resourceId, preview } = resourceDeletionDialog
    setResourceDeletionDialog((current: any) => ({ ...current, status: 'deleting', error: undefined }))
    try {
      if (action === 'purge') {
        await window.electronAPI.aiAssistant.purgeMemoryResourceTrash(resourceId, {
          previewToken: preview.previewToken,
          confirmation: resourceDeletionConfirmation
        })
        setMessage(`已永久删除资源快照：${preview.title}`)
      } else {
        await window.electronAPI.aiAssistant.deleteMemoryResource(resourceId, {
          previewToken: preview.previewToken,
          confirmation: resourceDeletionConfirmation
        })
        setMessage(`已从个人记忆删除并保留回收站快照：${preview.title}`)
      }
      resourceDeletionGate.current.invalidate()
      setResourceDeletionDialog(null)
      setResourceDeletionConfirmation('')
      await load()
      setSelectedResourceDossier(null)
      setResourceRefreshKey(value => value + 1)
    } catch (error: any) {
      setResourceDeletionDialog((current: any) => ({
        ...current,
        status: 'error',
        error: error?.message || String(error)
      }))
    }
  }

  const saveClaimCorrection = async () => {
    if (!editingClaim?.id || !String(editingClaim.value || '').trim()) return
    const correctedClaimId = editingClaim.id
    try {
      await window.electronAPI.aiAssistant.correctClaim(editingClaim.id, {
        value: editingClaim.value,
        validFrom: editingClaim.validFrom,
        validTo: editingClaim.validTo
      }, String(editingClaim.expectedRevision || ''))
      setEditingClaim(null)
      setMessage('事实纠正已确认并写入版本审计；后续重抽取只会追加证据。')
      await load()
      setClaimArchiveRefreshKey(value => value + 1)
      setEventTimelineRefreshKey(value => value + 1)
      if (memoryItemAudits[`claim:${correctedClaimId}`]) {
        void loadMemoryItemAudit('claim', correctedClaimId)
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('事实与事件档案在展示后发生了变化')) {
        claimArchiveGate.current.invalidate()
        eventTimelineGate.current.invalidate()
        setEditingClaim(null)
        setClaimArchiveRefreshKey(value => value + 1)
        setEventTimelineRefreshKey(value => value + 1)
      }
    }
  }

  const beginEventCorrection = (event: any) => {
    setEditingEvent({
      id: event.id,
      title: event.title || '',
      eventType: event.event_type || 'event',
      description: event.description || '',
      startAt: isoToShanghaiInput(event.start_at),
      endAt: isoToShanghaiInput(event.end_at),
      location: event.location || '',
      expectedRevision: String(event.structuredMemoryRevision || eventTimeline.revision || '')
    })
    window.setTimeout(() =>
      document.getElementById(`memory-event-${event.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const saveEventCorrection = async () => {
    if (!editingEvent?.id || !String(editingEvent.title || '').trim()) return
    const correctedEventId = editingEvent.id
    try {
      await window.electronAPI.aiAssistant.correctEvent(editingEvent.id, {
        title: editingEvent.title,
        eventType: editingEvent.eventType,
        description: editingEvent.description,
        startAt: shanghaiInputToIso(editingEvent.startAt),
        endAt: shanghaiInputToIso(editingEvent.endAt),
        location: editingEvent.location
      }, String(editingEvent.expectedRevision || ''))
      setEditingEvent(null)
      setMessage('事件纠正已确认并写入版本审计；后续重抽取只会追加证据。')
      await load()
      setClaimArchiveRefreshKey(value => value + 1)
      setEventTimelineRefreshKey(value => value + 1)
      if (memoryItemAudits[`event:${correctedEventId}`]) {
        void loadMemoryItemAudit('event', correctedEventId)
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      setMessage(errorMessage)
      if (errorMessage.includes('事实与事件档案在展示后发生了变化')) {
        claimArchiveGate.current.invalidate()
        eventTimelineGate.current.invalidate()
        setEditingEvent(null)
        setClaimArchiveRefreshKey(value => value + 1)
        setEventTimelineRefreshKey(value => value + 1)
      }
    }
  }

  const askMemory = async () => {
    const question = memoryQuestion.trim()
    if (!question || askingMemory) return
    setAskingMemory(true)
    const request = memoryConversationGate.current.begin()
    try {
      const answer = await window.electronAPI.aiAssistant.askMemory(question, memoryConversationId || undefined, memorySearchOptions)
      if (!memoryConversationGate.current.isCurrent(request)) return
      setMemoryAnswer({ ...answer, question })
      setMemoryConversationId(answer.conversationId)
      const conversation = await window.electronAPI.aiAssistant.getAssistantConversation(answer.conversationId)
      if (conversation?.stale) void openMemoryConversation(answer.conversationId)
      else setMemoryConversation(conversation)
      setMemoryQuestion('')
      await load()
    } catch (error: any) {
      if (memoryConversationGate.current.isCurrent(request)) {
        const errorMessage = error?.message || String(error)
        if (errorMessage.includes('所选实体')) {
          setMemoryEntitySelection(null)
          setMemoryEntityFilter('')
        }
        setMemoryAnswer({ answer: errorMessage, citations: [], uncertainty: '' })
      }
    } finally {
      setAskingMemory(false)
    }
  }

  const selectMemoryEntityScope = async (entityId: string, fallbackName = '') => {
    const result = await window.electronAPI.aiAssistant.getTrustedEntityDirectory({
      query: entityId,
      limit: 20,
      offset: 0
    })
    const entity = result.items.find((item: any) => item.id === entityId)
    if (!entity) {
      setMessage('该实体已经变化、合并或不再可信，请重新选择。')
      return
    }
    setMemoryEntitySelection({ ...entity, directoryRevision: result.revision })
    setMemoryEntityFilter(entity.id)
  }

  const loadMoreMemoryResults = async () => {
    if (memoryLoadingMore || !memorySearchState.hasMore) return
    const query = memoryQuery.trim()
    const request = memorySearchGate.current.begin()
    setMemoryLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.searchMemoryPage(
        query,
        memorySearchOptions,
        {
          offset: Number(memorySearchState.nextOffset ?? memoryResults.length),
          limit: 40,
          revision: memorySearchState.revision
        }
      )
      if (!memorySearchGate.current.isCurrent(request)) return
      if (page.entityScopeStale) {
        setMemoryEntitySelection(null)
        setMemoryEntityFilter('')
        setMessage('所选实体在翻页期间发生变化，已清除该范围，请重新选择。')
        return
      }
      if (page.stale) {
        setMessage('检索索引在翻页期间发生变化，已从第一页重新生成结果，避免遗漏或重复。')
        setMemorySearchRefreshKey(value => value + 1)
        return
      }
      setMemoryResults(current => {
        const merged = new Map(current.map(item => [item.id, item]))
        for (const item of page.results) merged.set(item.id, item)
        return [...merged.values()]
      })
      setMemorySearchFeedback(page.feedback || [])
      setMemorySearchState({
        status: 'ready',
        query,
        total: page.total,
        hasMore: page.hasMore,
        truncated: page.truncated,
        scopeCandidates: page.scopeCandidates,
        revision: page.revision,
        nextOffset: Number(page.offset || 0) + page.results.length
      })
    } catch (error: any) {
      if (memorySearchGate.current.isCurrent(request)) {
        setMemorySearchState(current => ({ ...current, status: 'error', error: error?.message || String(error) }))
      }
    } finally {
      if (memorySearchGate.current.isCurrent(request)) setMemoryLoadingMore(false)
    }
  }

  const updateMemorySearchFeedback = async (
    documentId: string,
    action: 'helpful' | 'not_relevant' | 'cleared',
    context?: { query?: string; options?: any }
  ) => {
    const query = context?.query ?? memoryQuery.trim()
    const options = context?.options ?? memorySearchOptions
    const saveKey = `${documentId}:${action}`
    setMemorySearchFeedbackSaving(saveKey)
    try {
      const result = await window.electronAPI.aiAssistant.updateMemorySearchFeedback({
        query,
        options,
        documentId,
        action
      })
      if (!context) setMemorySearchFeedback(result.feedback || [])
      if (context) {
        const nextFeedback = action === 'cleared' ? '' : action
        setMemoryAnswer((current: any) => current ? {
          ...current,
          citations: (current.citations || []).map((citation: any) =>
            citation.documentId === documentId
              ? { ...citation, relevanceFeedback: nextFeedback }
              : citation)
        } : current)
        const targetConversationId = memoryConversationId
        if (targetConversationId) {
          const refreshed = await window.electronAPI.aiAssistant.getAssistantConversation(targetConversationId)
          if (refreshed?.stale) void openMemoryConversation(targetConversationId)
          else setMemoryConversation((current: any) =>
            current?.id === targetConversationId ? refreshed : current)
        }
      }
      setMessage(action === 'helpful'
        ? '已记录为有用；只会提升同一查询和范围内的排序。'
        : action === 'not_relevant'
          ? '已记录为无关；不会全局删除或拒绝这条记忆。'
          : '已撤销这条检索反馈。')
      setMemorySearchRefreshKey(value => value + 1)
      setMemoryFeedbackArchiveRefreshKey(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setMemorySearchFeedbackSaving('')
    }
  }

  const loadMoreMemoryFeedbackArchive = async () => {
    if (memoryFeedbackArchiveLoadingMore || !memoryFeedbackArchive.hasMore) return
    const request = memoryFeedbackArchiveGate.current.begin()
    setMemoryFeedbackArchiveLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getMemorySearchFeedbackArchive({
        ...memoryFeedbackArchiveOptions,
        offset: memoryFeedbackArchive.items.length,
        revision: memoryFeedbackArchive.revision
      })
      if (!memoryFeedbackArchiveGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('检索反馈档案在翻页期间发生变化，已重新载入最新内容。')
        setMemoryFeedbackArchiveRefreshKey(value => value + 1)
        return
      }
      setMemoryFeedbackArchive((current: any) => ({
        ...page,
        items: [...current.items, ...page.items],
        status: 'ready'
      }))
    } catch (error: any) {
      if (memoryFeedbackArchiveGate.current.isCurrent(request)) {
        setMemoryFeedbackArchive((current: any) => ({
          ...current,
          status: 'error',
          error: error?.message || String(error)
        }))
      }
    } finally {
      if (memoryFeedbackArchiveGate.current.isCurrent(request)) setMemoryFeedbackArchiveLoadingMore(false)
    }
  }

  const openMemoryFeedbackDeletion = async (id?: number) => {
    const request = memoryFeedbackDeleteGate.current.begin()
    const filters = id
      ? { id }
      : {
          action: memoryFeedbackArchiveAction || undefined,
          query: memoryFeedbackArchiveQuery.trim() || undefined,
          from: memoryFeedbackArchiveFrom || undefined,
          to: memoryFeedbackArchiveTo || undefined,
          all: !memoryFeedbackArchiveAction && !memoryFeedbackArchiveQuery.trim() &&
            !memoryFeedbackArchiveFrom && !memoryFeedbackArchiveTo
        }
    setMemoryFeedbackDeleteConfirmation('')
    setMemoryFeedbackDeleteDialog({ status: 'loading', filters, single: Boolean(id) })
    try {
      const preview = await window.electronAPI.aiAssistant.deleteMemorySearchFeedback({
        ...filters,
        preview: true
      })
      if (!memoryFeedbackDeleteGate.current.isCurrent(request)) return
      setMemoryFeedbackDeleteDialog({ status: 'ready', filters, preview, single: Boolean(id) })
    } catch (error: any) {
      if (!memoryFeedbackDeleteGate.current.isCurrent(request)) return
      setMemoryFeedbackDeleteDialog({
        status: 'error',
        filters,
        single: Boolean(id),
        error: error?.message || String(error)
      })
    }
  }

  const closeMemoryFeedbackDeletion = () => {
    if (memoryFeedbackDeleteDialog?.status === 'deleting') return
    memoryFeedbackDeleteGate.current.invalidate()
    setMemoryFeedbackDeleteDialog(null)
    setMemoryFeedbackDeleteConfirmation('')
  }

  const confirmMemoryFeedbackDeletion = async () => {
    if (!memoryFeedbackDeleteDialog || memoryFeedbackDeleteConfirmation !== '永久删除检索反馈') return
    const request = memoryFeedbackDeleteGate.current.begin()
    setMemoryFeedbackDeleteDialog((current: any) => ({ ...current, status: 'deleting' }))
    try {
      const result = await window.electronAPI.aiAssistant.deleteMemorySearchFeedback({
        ...memoryFeedbackDeleteDialog.filters,
        preview: false,
        revision: memoryFeedbackDeleteDialog.preview?.revision,
        confirmation: memoryFeedbackDeleteConfirmation
      })
      if (!memoryFeedbackDeleteGate.current.isCurrent(request)) return
      setMemoryFeedbackDeleteDialog(null)
      setMemoryFeedbackDeleteConfirmation('')
      setMemorySearchRefreshKey(value => value + 1)
      setMemoryFeedbackArchiveRefreshKey(value => value + 1)
      const targetConversationId = memoryConversationId
      if (targetConversationId) {
        const refreshed = await window.electronAPI.aiAssistant.getAssistantConversation(targetConversationId)
        if (refreshed?.stale) void openMemoryConversation(targetConversationId)
        else setMemoryConversation((current: any) =>
          current?.id === targetConversationId ? refreshed : current)
        setMemoryAnswer((current: any) => {
          if (!current) return current
          const matching = [...(refreshed?.messages || [])].reverse().find((message: any) =>
            message.role === 'assistant' && message.content === current.answer)
          return matching ? { ...current, citations: matching.citations || [] } : current
        })
      }
      setMessage(`已永久删除 ${result.deletedRows || 0} 条检索反馈；${result.affectedChains || 0} 组排序偏好已清除。`)
    } catch (error: any) {
      if (!memoryFeedbackDeleteGate.current.isCurrent(request)) return
      const errorMessage = error?.message || String(error)
      if (errorMessage.includes('重新预览')) {
        setMemoryFeedbackArchiveRefreshKey(value => value + 1)
      }
      setMemoryFeedbackDeleteDialog((current: any) => ({
        ...current,
        status: 'error',
        error: errorMessage
      }))
    }
  }

  const openMemoryEvidenceArchive = async (
    documentType: string,
    sourceId: string,
    title: string,
    filters: MemoryEvidenceArchiveFilters = EMPTY_MEMORY_EVIDENCE_FILTERS
  ) => {
    const request = memoryEvidenceArchiveGate.current.begin()
    setMemoryEvidenceLoadingMore(false)
    setMemoryEvidenceFilters(filters)
    setMemoryEvidenceArchive({
      documentType,
      sourceId,
      title,
      items: [],
      total: 0,
      unfilteredTotal: 0,
      hasMore: false,
      filters,
      status: 'loading'
    })
    try {
      const page = await window.electronAPI.aiAssistant.getMemoryEvidencePage(
        documentType,
        sourceId,
        {
          offset: 0,
          limit: 40,
          query: filters.query,
          source: filters.source,
          session: filters.session,
          sender: filters.sender,
          role: filters.role,
          fromTimestamp: memoryEvidenceTimestamp(filters.from),
          toTimestamp: memoryEvidenceTimestamp(filters.to, true)
        }
      )
      if (!memoryEvidenceArchiveGate.current.isCurrent(request)) return
      if (page.stale) {
        window.setTimeout(() => {
          if (memoryEvidenceArchiveGate.current.isCurrent(request)) {
            void openMemoryEvidenceArchive(documentType, sourceId, title, filters)
          }
        }, 250)
        return
      }
      setMemoryEvidenceArchive({
        documentType,
        sourceId,
        title,
        items: page.items,
        total: page.total,
        unfilteredTotal: page.unfilteredTotal,
        hasMore: page.hasMore,
        filters,
        revision: page.revision,
        status: 'ready'
      })
    } catch (error: any) {
      if (!memoryEvidenceArchiveGate.current.isCurrent(request)) return
      setMemoryEvidenceArchive({
        documentType,
        sourceId,
        title,
        items: [],
        total: 0,
        unfilteredTotal: 0,
        hasMore: false,
        filters,
        status: 'error',
        error: error?.message || String(error)
      })
    }
  }

  const closeMemoryEvidenceArchive = () => {
    memoryEvidenceArchiveGate.current.invalidate()
    setMemoryEvidenceLoadingMore(false)
    setMemoryEvidenceArchive(null)
  }

  const loadMoreMemoryEvidence = async () => {
    const archive = memoryEvidenceArchive
    if (!archive || archive.status !== 'ready' || !archive.hasMore || memoryEvidenceLoadingMore) return
    const request = memoryEvidenceArchiveGate.current.begin()
    setMemoryEvidenceLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getMemoryEvidencePage(
        archive.documentType,
        archive.sourceId,
        {
          offset: archive.items.length,
          limit: 40,
          revision: archive.revision,
          query: archive.filters.query,
          source: archive.filters.source,
          session: archive.filters.session,
          sender: archive.filters.sender,
          role: archive.filters.role,
          fromTimestamp: memoryEvidenceTimestamp(archive.filters.from),
          toTimestamp: memoryEvidenceTimestamp(archive.filters.to, true)
        }
      )
      if (!memoryEvidenceArchiveGate.current.isCurrent(request)) return
      if (page.stale) {
        setMessage('原文证据在翻页期间发生变化，已重新载入最新证据。')
        void openMemoryEvidenceArchive(
          archive.documentType,
          archive.sourceId,
          archive.title,
          archive.filters
        )
        return
      }
      setMemoryEvidenceArchive(current => {
        if (!current || current.documentType !== archive.documentType || current.sourceId !== archive.sourceId) return current
        const seen = new Set(current.items.map(evidenceArchiveIdentity))
        const additions = page.items.filter(item => {
          const key = evidenceArchiveIdentity(item)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return {
          ...current,
          items: [...current.items, ...additions],
          total: page.total,
          hasMore: page.hasMore,
          revision: page.revision
        }
      })
    } catch (error: any) {
      if (memoryEvidenceArchiveGate.current.isCurrent(request)) {
        setMemoryEvidenceArchive(current => current
          ? { ...current, status: 'error', error: error?.message || String(error) }
          : current)
      }
    } finally {
      if (memoryEvidenceArchiveGate.current.isCurrent(request)) setMemoryEvidenceLoadingMore(false)
    }
  }

  const openMemoryConversation = useCallback(async (id: string, anchorMessageId = '') => {
    const request = memoryConversationGate.current.begin()
    const conversation = await window.electronAPI.aiAssistant.getAssistantConversation(id, {
      offset: 0,
      limit: 40,
      anchorMessageId
    })
    if (!conversation || !memoryConversationGate.current.isCurrent(request)) return
    if (conversation.stale) {
      window.setTimeout(() => {
        if (memoryConversationGate.current.isCurrent(request)) {
          void openMemoryConversation(id, anchorMessageId)
        }
      }, 250)
      return
    }
    setMemoryConversationId(id)
    setMemoryConversation(conversation)
    const messages = conversation.messages || []
    const assistantIndex = messages.map((item: any) => item.role).lastIndexOf('assistant')
    if (assistantIndex >= 0) {
      const assistant = messages[assistantIndex]
      const question = [...messages.slice(0, assistantIndex)].reverse().find((item: any) => item.role === 'user')
      setMemoryAnswer({
        conversationId: id,
        assistantMessageId: assistant.id,
        question: question?.content || conversation.title,
        answer: assistant.content,
        citations: assistant.citations || [],
        groundingAudit: assistant.groundingAudit,
        groundingRevalidation: assistant.groundingRevalidation,
        groundedStatements: String(assistant.content || '').split(/\n{2,}/)
          .map((text: string, statementIndex: number) => ({
            text,
            citationIds: assistant.groundingAudit?.statementCitations?.[statementIndex] || []
          })),
        uncertainty: ''
      })
    } else {
      setMemoryAnswer(null)
    }
  }, [])

  const loadMoreAssistantConversations = async () => {
    if (assistantArchiveLoadingMore || !assistantArchive.hasMore) return
    const request = assistantArchiveGate.current.begin()
    setAssistantArchiveLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getAssistantConversations({
        ...assistantArchiveOptions,
        offset: assistantArchive.items.length,
        limit: 30,
        revision: assistantArchive.revision
      })
      if (!assistantArchiveGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('问答会话档案已有变化，已自动从第一页刷新')
        setAssistantArchiveRefreshKey(value => value + 1)
        return
      }
      setAssistantArchive(current => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.id === item.id))],
        loading: false
      }))
    } catch (error: any) {
      if (assistantArchiveGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (assistantArchiveGate.current.isCurrent(request)) setAssistantArchiveLoadingMore(false)
    }
  }

  const loadMoreAssistantAnswerReviews = async () => {
    if (assistantAnswerReviewsLoadingMore || !assistantAnswerReviews.hasMore) return
    const request = assistantAnswerReviewsGate.current.begin()
    setAssistantAnswerReviewsLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getAssistantAnswerReviews({
        ...assistantAnswerReviewOptions,
        offset: assistantAnswerReviews.items.length,
        limit: 30,
        revision: assistantAnswerReviews.revision
      })
      if (!assistantAnswerReviewsGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('逐回答核验档案已有变化，已自动从第一页刷新')
        setAssistantAnswerReviewRevision(value => value + 1)
        return
      }
      setAssistantAnswerReviews((current: any) => ({
        ...result,
        items: [...current.items, ...result.items.filter((item: any) =>
          !current.items.some((known: any) => known.message_id === item.message_id))],
        loading: false
      }))
    } catch (error: any) {
      if (assistantAnswerReviewsGate.current.isCurrent(request)) {
        setMessage(error?.message || String(error))
      }
    } finally {
      if (assistantAnswerReviewsGate.current.isCurrent(request)) {
        setAssistantAnswerReviewsLoadingMore(false)
      }
    }
  }

  const reviewAssistantAnswer = async (
    messageId: string,
    action: 'acknowledged' | 'reopened'
  ) => {
    if (assistantAnswerReviewSaving) return
    setAssistantAnswerReviewSaving(messageId)
    try {
      await window.electronAPI.aiAssistant.reviewAssistantAnswer(messageId, action)
      setAssistantAnswerReviewHistories(current => {
        const next = { ...current }
        delete next[messageId]
        return next
      })
      setMessage(action === 'acknowledged'
        ? '已知晓这条历史回答的证据变化；它仍保留在已处理档案中。'
        : '已将这条历史回答重新加入待处理队列。')
      setAssistantAnswerReviewRevision(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setAssistantAnswerReviewSaving('')
    }
  }

  const loadAssistantAnswerReviewHistory = async (messageId: string): Promise<void> => {
    setAssistantAnswerReviewHistories(current => ({
      ...current,
      [messageId]: { items: [], total: 0, hasMore: false, loading: true }
    }))
    try {
      const page = await window.electronAPI.aiAssistant
        .getAssistantAnswerReviewDecisions(messageId, { limit: 20 })
      if (page.stale) {
        window.setTimeout(() => void loadAssistantAnswerReviewHistory(messageId), 250)
        return
      }
      setAssistantAnswerReviewHistories(current => ({
        ...current,
        [messageId]: { ...page, loading: false }
      }))
    } catch (error) {
      setAssistantAnswerReviewHistories(current => ({
        ...current,
        [messageId]: {
          items: [], total: 0, hasMore: false, loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }))
    }
  }

  const toggleAssistantAnswerReviewHistory = async (messageId: string) => {
    if (assistantAnswerReviewHistories[messageId]) {
      setAssistantAnswerReviewHistories(current => {
        const next = { ...current }
        delete next[messageId]
        return next
      })
      return
    }
    await loadAssistantAnswerReviewHistory(messageId)
  }

  const loadMoreAssistantAnswerReviewHistory = async (messageId: string) => {
    const history = assistantAnswerReviewHistories[messageId]
    if (!history || history.loading || !history.hasMore) return
    setAssistantAnswerReviewHistories(current => ({
      ...current,
      [messageId]: { ...current[messageId], loading: true }
    }))
    try {
      const page = await window.electronAPI.aiAssistant.getAssistantAnswerReviewDecisions(
        messageId,
        { offset: history.items.length, limit: 20, revision: history.revision }
      )
      if (page.stale) {
        setMessage('这条回答的处理记录已有变化，已自动重新载入')
        await loadAssistantAnswerReviewHistory(messageId)
        return
      }
      setAssistantAnswerReviewHistories(current => ({
        ...current,
        [messageId]: {
          ...page,
          items: [...(current[messageId]?.items || []), ...(page.items || [])],
          loading: false
        }
      }))
    } catch (error) {
      setAssistantAnswerReviewHistories(current => ({
        ...current,
        [messageId]: {
          ...current[messageId],
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }))
    }
  }

  const loadOlderAssistantMessages = async () => {
    if (!memoryConversationId || !memoryConversation?.hasOlder || assistantMessagesLoadingMore) return
    const request = memoryConversationGate.current.begin()
    setAssistantMessagesLoadingMore(true)
    try {
      const older = await window.electronAPI.aiAssistant.getAssistantConversation(memoryConversationId, {
        offset: memoryConversation.messages?.length || 0,
        limit: 40,
        revision: memoryConversation.revision
      })
      if (!older || !memoryConversationGate.current.isCurrent(request)) return
      if (older.stale) {
        setMessage('当前问答的消息或证据状态已有变化，已自动重新载入')
        void openMemoryConversation(memoryConversationId)
        return
      }
      setMemoryConversation((current: any) => {
        if (!current || current.id !== older.id) return current
        const known = new Set((current.messages || []).map((item: any) => item.id))
        return {
          ...current,
          ...older,
          messages: [
            ...older.messages.filter((item: any) => !known.has(item.id)),
            ...(current.messages || [])
          ]
        }
      })
    } catch (error: any) {
      if (memoryConversationGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (memoryConversationGate.current.isCurrent(request)) setAssistantMessagesLoadingMore(false)
    }
  }

  useEffect(() => {
    if (memoryConversationId !== null || !assistantConversations.length) return
    void openMemoryConversation(assistantConversations[0].id)
  }, [assistantConversations, memoryConversationId, openMemoryConversation])

  const startNewMemoryConversation = () => {
    memoryConversationGate.current.invalidate()
    setMemoryConversationId('')
    setMemoryConversation(null)
    setMemoryAnswer(null)
    setMemoryQuestion('')
  }

  const deleteMemoryConversation = async (targetConversationId?: string) => {
    const conversationId = String(targetConversationId || memoryConversationId || '')
    if (!conversationId) return
    const request = conversationDeletionGate.current.begin()
    setConversationDeletionConfirmation('')
    setConversationDeletionDialog({
      conversationId,
      title: memoryConversation?.title || '',
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteAssistantConversation(conversationId)
      if (!conversationDeletionGate.current.isCurrent(request)) return
      setConversationDeletionDialog({
        conversationId,
        title: preview.title,
        preview,
        status: 'ready'
      })
    } catch (error: any) {
      if (!conversationDeletionGate.current.isCurrent(request)) return
      setConversationDeletionDialog({
        conversationId,
        title: memoryConversation?.title || '',
        status: 'error',
        error: error?.message || String(error)
      })
    }
  }

  const closeConversationDeletionDialog = () => {
    conversationDeletionGate.current.invalidate()
    setConversationDeletionDialog(null)
    setConversationDeletionConfirmation('')
  }

  const confirmConversationDeletion = async () => {
    if (!conversationDeletionDialog?.preview ||
      conversationDeletionDialog.status !== 'ready' ||
      conversationDeletionConfirmation !== '删除对话') return
    const request = conversationDeletionGate.current.begin()
    const { conversationId, preview } = conversationDeletionDialog
    setConversationDeletionDialog((current: any) => ({
      ...current,
      status: 'deleting',
      error: undefined
    }))
    try {
      await window.electronAPI.aiAssistant.deleteAssistantConversation(conversationId, {
        previewToken: preview.previewToken,
        confirmation: conversationDeletionConfirmation
      })
      if (!conversationDeletionGate.current.isCurrent(request)) return
      closeConversationDeletionDialog()
      if (memoryConversationId === conversationId) startNewMemoryConversation()
      setMessage('已删除这段本地问答历史；引用的原始记忆没有被删除。')
      await load()
    } catch (error: any) {
      if (!conversationDeletionGate.current.isCurrent(request)) return
      setConversationDeletionDialog((current: any) => ({
        ...current,
        status: 'error',
        error: error?.message || String(error)
      }))
    }
  }

  const createTaskFromMemory = async () => {
    if (!memoryAnswer?.answer || creatingMemoryTask) return
    setCreatingMemoryTask(true)
    try {
      const task = await window.electronAPI.aiAssistant.createTaskFromMemory({
        title: memoryAnswer.question || String(memoryAnswer.answer).split(/[。！？\n]/)[0],
        detail: memoryAnswer.answer,
        assistantMessageId: memoryAnswer.assistantMessageId,
        priority: 'medium'
      })
      setMemoryAnswer((current: any) => ({ ...current, createdTaskId: task.id }))
      setMessage(`已生成待办：${task.title}`)
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setCreatingMemoryTask(false)
    }
  }

  const reviewMemoryCitation = async (citation: any, decision: 'confirmed' | 'rejected') => {
    if (!['relation', 'claim', 'event'].includes(citation.type) || !citation.sourceId) return
    try {
      await window.electronAPI.aiAssistant.reviewMemoryDocument(citation.type, citation.sourceId, decision, {
        assistantMessageId: memoryAnswer?.assistantMessageId,
        documentId: citation.documentId,
        reviewToken: citation.reviewToken
      })
      setMemoryAnswer((current: any) => ({
        ...current,
        citations: (current?.citations || []).map((item: any) =>
          item.documentId === citation.documentId ? { ...item, status: decision } : item)
      }))
      const assistantMessageId = String(memoryAnswer?.assistantMessageId || '')
      const conversationId = String(memoryAnswer?.conversationId || memoryConversationId || '')
      if (assistantMessageId && conversationId) {
        const refreshed = await window.electronAPI.aiAssistant.getAssistantConversation(conversationId, {
          anchorMessageId: assistantMessageId
        })
        const answerMessage = refreshed?.messages?.find((item: any) => item.id === assistantMessageId)
        if (answerMessage) {
          setMemoryAnswer((current: any) => ({
            ...current,
            citations: answerMessage.citations || current?.citations || [],
            groundingRevalidation: answerMessage.groundingRevalidation
          }))
        }
      }
      setMessage(decision === 'confirmed' ? '已人工确认这条记忆' : '已标记为不准确')
      await load()
    } catch (error: any) {
      const assistantMessageId = String(memoryAnswer?.assistantMessageId || '')
      const conversationId = String(memoryAnswer?.conversationId || memoryConversationId || '')
      if (assistantMessageId && conversationId) {
        const refreshed = await window.electronAPI.aiAssistant.getAssistantConversation(conversationId, {
          anchorMessageId: assistantMessageId
        }).catch(() => null)
        const answerMessage = refreshed?.messages?.find((item: any) => item.id === assistantMessageId)
        if (answerMessage) {
          setMemoryAnswer((current: any) => ({
            ...current,
            citations: answerMessage.citations || current?.citations || [],
            groundingRevalidation: answerMessage.groundingRevalidation
          }))
        }
      }
      setMessage(error?.message || String(error))
    }
  }

  const openClaimCorrection = (citation: any) => {
    const claim = visibleClaims.find((item: any) => item.id === citation.sourceId)
    if (!claim) {
      setMemoryQuery(citation.title)
      setMemoryTypeFilter('claim')
      setMessage('已定位该事实；它当前不在可见事实列表中，可能已被拒绝或归档。')
      return
    }
    setEditingClaim({
      id: claim.id,
      value: claim.object_entity_name || claim.object_value || '',
      validFrom: claim.valid_from || '',
      validTo: claim.valid_to || '',
      expectedRevision: String(claimArchive.revision || '')
    })
    window.setTimeout(() => document.getElementById(`memory-claim-${claim.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const openEventCorrection = async (citation: any) => {
    const event = await window.electronAPI.aiAssistant.getMemoryEvent(citation.sourceId)
    if (!event) {
      setMessage('该事件不存在或已经被删除。')
      return
    }
    setEventSourceFilter('')
    setEventStatusFilter('')
    setEventFrom('')
    setEventTo('')
    beginEventCorrection(event)
  }

  const openSources = async () => {
    setSourceQuery('')
    setSourceTypeFilter('all')
    setSourceEnabledFilter('all')
    setShowSources(true)
  }

  const loadConversationSources = useCallback(async (offset = 0, append = false) => {
    const request = sourceDirectoryGate.current.begin()
    setSourceLoading(true)
    try {
      const result = await window.electronAPI.aiAssistant.getConversationSources({
        query: sourceQuery || undefined,
        type: sourceTypeFilter,
        enabled: sourceEnabledFilter,
        offset,
        limit: 50,
        expectedRevision: append ? sourceDirectory.revision : undefined
      })
      if (!sourceDirectoryGate.current.isCurrent(request)) return
      if (result.stale) {
        setMessage('会话目录在翻页时发生变化，已从第一页刷新。')
        const refreshed = await window.electronAPI.aiAssistant.getConversationSources({
          query: sourceQuery || undefined,
          type: sourceTypeFilter,
          enabled: sourceEnabledFilter,
          offset: 0,
          limit: 50
        })
        if (!sourceDirectoryGate.current.isCurrent(request)) return
        setSourceDirectory(refreshed)
      } else {
        setSourceDirectory((current: any) => ({
          ...result,
          items: append ? [...current.items, ...result.items] : result.items
        }))
      }
    } catch (error: any) {
      if (sourceDirectoryGate.current.isCurrent(request)) setMessage(error?.message || String(error))
    } finally {
      if (sourceDirectoryGate.current.isCurrent(request)) setSourceLoading(false)
    }
  }, [
    sourceDirectory.revision,
    sourceEnabledFilter,
    sourceQuery,
    sourceTypeFilter
  ])

  useEffect(() => {
    if (!showSources) return
    const timer = window.setTimeout(() => void loadConversationSources(0, false), 250)
    return () => window.clearTimeout(timer)
  }, [showSources, sourceQuery, sourceTypeFilter, sourceEnabledFilter])

  const forgetSelectedEntity = async () => {
    if (!selectedEntity || forgettingEntityId) return
    const entityId = selectedEntity.id
    const request = entityForgetGate.current.begin()
    setEntityForgetConfirmation('')
    setEntityForgetDialog({
      entityId,
      canonicalName: selectedEntity.canonicalName,
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewForgetEntity(entityId)
      if (!entityForgetGate.current.isCurrent(request)) return
      if (!preview) {
        setEntityForgetDialog({
          entityId,
          canonicalName: selectedEntity.canonicalName,
          status: 'error',
          error: '该人物不存在或已经被遗忘'
        })
        return
      }
      setEntityForgetDialog({ entityId, canonicalName: preview.canonicalName, preview, status: 'ready' })
    } catch (error: any) {
      if (entityForgetGate.current.isCurrent(request)) {
        setEntityForgetDialog({
          entityId,
          canonicalName: selectedEntity.canonicalName,
          status: 'error',
          error: error?.message || String(error)
        })
      }
    }
  }

  const closeEntityForgetDialog = () => {
    if (entityForgetDialog?.status === 'deleting') return
    entityForgetGate.current.invalidate()
    setEntityForgetDialog(null)
    setEntityForgetConfirmation('')
  }

  const confirmForgetSelectedEntity = async () => {
    if (!entityForgetDialog?.preview || entityForgetDialog.status !== 'ready' ||
      entityForgetConfirmation !== entityForgetDialog.preview.canonicalName) return
    const { entityId, preview } = entityForgetDialog
    setForgettingEntityId(entityId)
    setEntityForgetDialog((current: any) => ({ ...current, status: 'deleting', error: undefined }))
    try {
      const result = await window.electronAPI.aiAssistant.forgetEntity(entityId, {
        previewToken: preview.previewToken,
        confirmation: entityForgetConfirmation
      })
      setSelectedEntityId('')
      setMessage(`已彻底遗忘 ${result.canonicalName}：删除 ${result.removed.searchDocuments} 个记忆索引`)
      entityForgetGate.current.invalidate()
      setEntityForgetDialog(null)
      setEntityForgetConfirmation('')
      await load()
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setEntityForgetDialog((current: any) => ({
        ...current,
        status: 'error',
        error: error?.message || String(error)
      }))
    } finally {
      setForgettingEntityId('')
    }
  }

  const toggleSource = async (source: any) => {
    try {
      await window.electronAPI.aiAssistant.setConversationSource({
        sessionId: source.sessionId,
        enabled: !source.enabled,
        mutationToken: source.mutationToken
      })
      await loadConversationSources(0, false)
    } catch (error: any) {
      setMessage(error?.message || String(error))
      await loadConversationSources(0, false)
    }
  }

  const setSourceType = async (type: 'group' | 'private', enabled: boolean) => {
    try {
      const result = await window.electronAPI.aiAssistant.setConversationSourcesBulk({
        type,
        enabled,
        expectedRevision: sourceDirectory.revision
      })
      setMessage(`已更新 ${result.updated} 个${type === 'group' ? '群聊' : '私聊'}来源。`)
      await loadConversationSources(0, false)
    } catch (error: any) {
      setMessage(error?.message || String(error))
      await loadConversationSources(0, false)
    }
  }

  const toggleDataSource = async (source: any) => {
    try {
      const updated = await window.electronAPI.aiAssistant.setDataSourceEnabled(source.id, !source.enabled)
      setDataSources(current => current.map(item => item.id === source.id ? updated : item))
      setStatus(await window.electronAPI.aiAssistant.status())
      setMessage(`${source.displayName}数据源已${updated.enabled ? '开启' : '暂停'}。`)
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const configureDocumentSource = async () => {
    const selected = await window.electronAPI.dialog.openFile({
      title: '选择要持续索引的本机文档目录',
      properties: ['openDirectory', 'createDirectory']
    })
    const folderPath = selected.filePaths?.[0]
    if (selected.canceled || !folderPath) return
    try {
      const updated = await window.electronAPI.aiAssistant.configureDataSource('documents', { folderPath })
      setDataSources(current => current.map(item => item.id === 'documents' ? updated : item))
      setMessage('本机文档目录已连接；下次立即补齐或自动整理时开始增量索引。')
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const configureCalendarSource = async (source: any) => {
    setCalendarConnecting(true)
    setMailPicker(null)
    try {
      let authorization = String(source.authorization || '')
      if (!['fullAccess', 'authorized'].includes(authorization)) {
        const result = await window.electronAPI.aiAssistant.requestCalendarAccess()
        authorization = result.authorization
        if (!result.granted) {
          throw new Error(
            authorization === 'denied'
              ? '日历权限已被拒绝。请在“系统设置 → 隐私与安全性 → 日历”中允许 WeFlow 升级版，然后重试。'
              : '未获得日历读取权限；没有任何日历数据被读取。'
          )
        }
      }
      const calendars = await window.electronAPI.aiAssistant.listCalendars()
      const configuredIds = Array.isArray(source.config?.calendarIds)
        ? source.config.calendarIds.map(String)
        : []
      setCalendarPicker({
        calendars,
        selectedIds: configuredIds.filter((id: string) => calendars.some(calendar => calendar.id === id))
      })
      setDataSources(await window.electronAPI.aiAssistant.getDataSources())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setCalendarConnecting(false)
    }
  }

  const saveCalendarSelection = async () => {
    if (!calendarPicker?.selectedIds.length) {
      setMessage('请至少选择一个要索引的日历。')
      return
    }
    setCalendarConnecting(true)
    try {
      await window.electronAPI.aiAssistant.configureDataSource('calendar', {
        calendarIds: calendarPicker.selectedIds
      })
      setDataSources(await window.electronAPI.aiAssistant.getDataSources())
      setCalendarPicker(null)
      setMessage('所选日历已连接；只会在本机增量索引事件，不会自动生成待办。')
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setCalendarConnecting(false)
    }
  }

  const configureMailSource = async (source: any) => {
    setMailConnecting(true)
    setCalendarPicker(null)
    try {
      let authorization = String(source.authorization || '')
      if (authorization !== 'authorized') {
        const result = await window.electronAPI.aiAssistant.requestMailAccess()
        authorization = result.authorization
        if (!result.granted) {
          throw new Error(
            '未获得 macOS Mail 只读自动化权限。请在“系统设置 → 隐私与安全性 → 自动化”中允许 WeFlow 升级版邮件连接器控制 Mail，然后重试。'
          )
        }
      }
      const mailboxes = await window.electronAPI.aiAssistant.listMailboxes()
      const configuredIds = Array.isArray(source.config?.mailboxIds)
        ? source.config.mailboxIds.map(String)
        : []
      setMailPicker({
        mailboxes,
        selectedIds: configuredIds.filter((id: string) => mailboxes.some(mailbox => mailbox.id === id)),
        allowModelAnalysis: Boolean(source.config?.allowModelAnalysis)
      })
      setDataSources(await window.electronAPI.aiAssistant.getDataSources())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setMailConnecting(false)
    }
  }

  const saveMailSelection = async () => {
    if (!mailPicker?.selectedIds.length) {
      setMessage('请至少选择一个要索引的 Mail 邮箱。')
      return
    }
    setMailConnecting(true)
    try {
      await window.electronAPI.aiAssistant.configureDataSource('mail', {
        mailboxIds: mailPicker.selectedIds,
        allowModelAnalysis: mailPicker.allowModelAnalysis
      })
      setDataSources(await window.electronAPI.aiAssistant.getDataSources())
      setMailPicker(null)
      setMessage('所选 Mail 邮箱已连接；邮件正文只进入本机检索，不会默认发送给模型或生成待办。')
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setMailConnecting(false)
    }
  }

  return (
    <div className="ai-assistant-page native">
      <div className="ai-assistant-toolbar">
        <div className="ai-assistant-title">
          <span className="ai-assistant-title-icon"><Bot size={18} /></span>
          <div><strong>AI 行动助理</strong><span>从聊天中持续发现重要信息与待办</span></div>
        </div>
        <div className="ai-assistant-service-meta">
          <span className={`service-dot ${status?.cursor?.lastError ? '' : 'online'}`} />
          <span>{syncing || status?.syncing ? '正在补齐消息' : status?.cursor?.lastError ? '等待自动重试' : '增量服务正常'}</span>
          <span className="service-divider" />
          <ShieldCheck size={13} /><span>Key 已加密存储</span>
          <button type="button" onClick={() => setShowDataSources(true)} aria-label="数据源连接器" title="管理数据源连接器"><Network size={14} /></button>
          <button type="button" onClick={openSources} aria-label="信息来源" title="管理分析信息来源"><Filter size={14} /></button>
          <button type="button" onClick={openSettings} aria-label="AI 助理设置"><Settings2 size={14} /></button>
        </div>
      </div>

      <div className="ai-assistant-content">
        <header className="assistant-hero-header">
          <div>
            <p className="assistant-kicker">INCREMENTAL INTELLIGENCE</p>
            <h1>把聊天，变成下一步行动。</h1>
            <p className="assistant-subtitle">
              {status?.cursor?.lastMessageTimestamp
                ? `已持续处理至 ${new Date(status.cursor.lastMessageTimestamp * 1000).toLocaleString('zh-CN')}`
                : '首次运行将读取最近三天，此后按时间戳持续补齐。'}
            </p>
          </div>
          <div className="assistant-sync-actions">
            <button className="assistant-sync-button" onClick={syncNow} disabled={syncing || status?.syncing || !status?.configured}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} />
              {syncing ? '正在理解消息…' : status?.cursor?.lastError ? '继续补齐' : '立即补齐'}
            </button>
            {(syncing || status?.syncing) && <button className="assistant-cancel-sync" onClick={() => void cancelSync()} disabled={status?.cancelling}>
              {status?.cancelling ? '正在安全暂停…' : '当前批次后暂停'}
            </button>}
          </div>
        </header>

        {!status?.configured && (
          <section className="assistant-setup-banner">
            <Sparkles size={18} />
            <div><strong>还差最后一步</strong><span>设置 DeepSeek API Key 后，AI 助理即可开始工作。</span></div>
            <button onClick={openSettings}>现在设置</button>
          </section>
        )}

        {message && <div className={`assistant-message ${message.includes('完成') ? 'success' : ''}`}>{message}</div>}
        {ingestionStatus && (
          <div className={`assistant-ingestion-status ${ingestionStatus.status}`}>
            <strong>最近一次记忆处理：{ingestionStatus.status === 'completed' ? '全部完成' : ingestionStatus.status === 'partial' ? '部分完成，等待重试' : ingestionStatus.status === 'running' ? '正在处理' : '处理失败'}</strong>
            <span>{Number(ingestionStatus.message_count || 0)} 条已完成 · {ingestionCounts.completed || 0} 个成功批次{ingestionCounts.running ? ` · ${ingestionCounts.running} 个处理中` : ''}{ingestionCounts.failed ? ` · ${ingestionCounts.failed} 个待重试批次` : ''}</span>
            {ingestionStatus.usage && <small>
              {ingestionStatus.usage.model || ingestionStatus.model} · {ingestionStatus.usage.prompt_version || ingestionStatus.prompt_version}
              {ingestionStatus.usage.schema_version ? ` / ${ingestionStatus.usage.schema_version}` : ''}
              {' · '}Token {Number(ingestionStatus.usage.input_tokens || 0).toLocaleString()} 入 / {Number(ingestionStatus.usage.output_tokens || 0).toLocaleString()} 出
              {' · '}{(Number(ingestionStatus.usage.duration_ms || 0) / 1000).toFixed(1)} 秒
            </small>}
            {ingestionStatus.messageLedger && <small>
              持久消息去重账本 {Number(ingestionStatus.messageLedger.total || 0).toLocaleString()} 条
              {' · '}不受 20,000 条热缓存上限影响
            </small>}
            {ingestionStatus.commitHealth?.payloadCompaction && <small>
              已提交恢复日志只保留运行、批次、来源和时间审计；
              已净化 {Number(ingestionStatus.commitHealth.payloadCompaction.compactedRows || 0)
                .toLocaleString()} 条旧载荷，
              释放约 {formatBytes(Number(
                ingestionStatus.commitHealth.payloadCompaction.releasedBytes || 0
              ))}，当前重复敏感载荷 {formatBytes(Number(
                ingestionStatus.commitHealth.payloadCompaction.retainedBytes || 0
              ))}。
            </small>}
            {status?.cursor?.payloadPolicy?.durableKeys === 'main_process_only' && <small>
              增量断点仅保留在加密主进程：
              热缓存键 {Number(status.cursor.privateStateCounts?.recentMessageKeys || 0).toLocaleString()} 条
              {' · '}会话水位 {Number(status.cursor.privateStateCounts?.sessionCursors || 0).toLocaleString()} 个
              {' · '}分页续传 {Number(status.cursor.privateStateCounts?.continuationOffsets || 0).toLocaleString()} 个；
              界面只接收计数和运行状态。
            </small>}
            {Number(ingestionStatus.commitHealth?.prepared || 0) > 0 && <>
              <small>
                检测到 {Number(ingestionStatus.commitHealth.prepared)} 个已保存但尚未完成应用的批次，
                其中微信 {Number(ingestionStatus.commitHealth.preparedWechat || 0)} 个、
                文档 {Number(ingestionStatus.commitHealth.preparedDocuments || 0)} 个；
                {Number(ingestionStatus.commitHealth.unattempted || 0) > 0
                  ? ` ${Number(ingestionStatus.commitHealth.unattempted)} 个尚未尝试的批次会在本次运行后台分段继续，`
                  : ' 所有保留批次都已经尝试过，'}
                不会重新请求模型；失败项可立即重试。
              </small>
              <div className="assistant-ingestion-recovery-actions">
                <button onClick={() => void toggleIngestionRecoveryQueue()}>
                  {ingestionRecoveryQueue ? '收起恢复队列' : '查看恢复队列'}
                </button>
                <button className="primary" disabled={ingestionRecoveryRetrying || syncing || status?.syncing}
                  onClick={() => void retryPreparedIngestion()}>
                  {ingestionRecoveryRetrying ? '正在恢复…' : '立即重试恢复'}
                </button>
              </div>
              {ingestionRecoveryQueue && <div className="assistant-ingestion-recovery-queue">
                {ingestionRecoveryQueue.loading && <em>正在读取脱敏恢复目录…</em>}
                {ingestionRecoveryQueue.error &&
                  <p className="assistant-diagnostics-error">{ingestionRecoveryQueue.error}</p>}
                {(ingestionRecoveryQueue.items || []).map((commit: any) => <article
                  key={commit.commit_id}>
                  <b>{commit.source_kind === 'document' ? '文档' : '微信'}批次 #{commit.batch_index}</b>
                  <span>{new Date(commit.prepared_at).toLocaleString('zh-CN')} ·
                    已尝试恢复 {Number(commit.recovery_attempts || 0)} 次</span>
                  <small>运行 {commit.run_id} · 恢复 ID {commit.commit_id}</small>
                  {commit.last_error && <p>{commit.last_error}</p>}
                </article>)}
                {!ingestionRecoveryQueue.loading && !ingestionRecoveryQueue.items?.length &&
                  <em>恢复队列已经清空。</em>}
                {ingestionRecoveryQueue.hasMore && <button
                  disabled={ingestionRecoveryLoadingMore}
                  onClick={() => void loadMoreIngestionRecoveryQueue()}>
                  {ingestionRecoveryLoadingMore ? '正在加载…' : '加载更多恢复批次'}
                </button>}
              </div>}
            </>}
            {Number(ingestionStatus.commitHealth?.recoveryFailures || 0) > 0 && <small>
              其中 {Number(ingestionStatus.commitHealth.recoveryFailures)} 个批次曾恢复失败，原始恢复载荷仍保留。
            </small>}
            {ingestionStatus.recovered_at && <small>
              检测到上次运行被退出打断：已保留 {Number(ingestionStatus.recovered_batch_count || 0)} 个成功批次，
              {Number(ingestionStatus.interrupted_batch_count || 0)} 个在途批次将按 checkpoint 重试。
            </small>}
            {Number(status?.cursor?.pendingSessionRetryCount || 0) > 0 && <small>
              仍有 {Number(status.cursor.pendingSessionRetryCount)} 个微信会话读取失败；
              每个会话的失败前起点已经独立保存，下次会从原位置继续，不会被全局时间戳跳过。
            </small>}
            {Number(status?.cursor?.pendingSessionBacklogCount || 0) > 0 && <small>
              仍有 {Number(status.cursor.pendingSessionBacklogCount)} 个高流量微信会话超过本轮安全分页上限；
              下一页位置已经保存，继续补齐会从该位置向后读取，不会重复停在最新 10,000 条。
              {status.cursor.backlogRetry?.paused
                ? ' 自动接力已因安全暂停停止，下次手动、启动或每日运行会继续。'
                : status.cursor.backlogRetry?.nextAttemptAt
                  ? ` 将于 ${new Date(status.cursor.backlogRetry.nextAttemptAt).toLocaleString('zh-CN', { hour12: false })} 自动接力${Number(status.cursor.backlogRetry.failureCount || 0) > 0 ? `（连续失败 ${Number(status.cursor.backlogRetry.failureCount)} 次，已退避）` : ''}。`
                  : ''}
            </small>}
            {ingestionStatus.error && <small>{ingestionStatus.error}</small>}
          </div>
        )}
        {status?.cursor?.lastScheduledError && (
          <div className="assistant-ingestion-status partial">
            <strong>今日定时整理尚未确认完成，将继续重试</strong>
            <span>
              已尝试 {Number(status.cursor.scheduledRetryCount || 0).toLocaleString()} 次
              {status.cursor.lastScheduledAttemptAt
                ? ` · 最近尝试 ${new Date(status.cursor.lastScheduledAttemptAt).toLocaleString('zh-CN', { hour12: false })}`
                : ''}
            </span>
            <small>{status.cursor.lastScheduledError}</small>
            <small>
              当微信分页、模型批次或任一已启用连接器仍为部分完成/失败时，不会写入“今日已完成”；
              {status.cursor.nextScheduledRetryAt
                ? ` 最早于 ${new Date(status.cursor.nextScheduledRetryAt).toLocaleString('zh-CN', { hour12: false })} 自动重试。`
                : ' 服务会在下一轮调度继续。'}
              {' '}连续失败会按 15、30、60 分钟逐级退避，最长 6 小时；手动或启动补齐完整成功后会立即结清。
            </small>
          </div>
        )}
        {status?.cursor?.systemWake?.lastResumeAt && (
          <div className="assistant-ingestion-status completed">
            <strong>电脑唤醒后的增量补齐已检查</strong>
            <span>
              最近唤醒 {new Date(status.cursor.systemWake.lastResumeAt).toLocaleString('zh-CN', { hour12: false })}
              {' · '}累计 {Number(status.cursor.systemWake.resumeCount || 0).toLocaleString()} 次
            </span>
            <small>{schedulerCatchupResultLabel(status.cursor.systemWake.lastCatchupResult)}</small>
            {status.cursor.systemWake.retry?.pendingSince && <small>
              唤醒补齐仍待完成：已失败
              {' '}{Number(status.cursor.systemWake.retry.failureCount || 0).toLocaleString()} 次
              {status.cursor.systemWake.retry.nextAttemptAt
                ? ` · 最早于 ${new Date(status.cursor.systemWake.retry.nextAttemptAt)
                    .toLocaleString('zh-CN', { hour12: false })} 自动重试`
                : ' · 下一次调度自动重试'}
              {status.cursor.systemWake.retry.lastError
                ? ` · ${status.cursor.systemWake.retry.lastError}` : ''}
            </small>}
            {Number(status.cursor.systemWake.lastGapMs || 0) > 150_000 && <small>
              本次检测到定时器中断约
              {Math.round(Number(status.cursor.systemWake.lastGapMs) / 60_000).toLocaleString()} 分钟；
              唤醒检查仍复用原有 checkpoint、去重账本和失败退避，不会从“当天”或最新消息重新开始。
            </small>}
          </div>
        )}
        {memoryDiagnostics && (
          <section className={`assistant-memory-health ${memoryDiagnostics.healthy ? 'healthy' : 'unhealthy'}`}>
            <div>
              <ShieldCheck size={16} />
              <span><strong>个人记忆库{memoryDiagnostics.healthy ? '健康' : '需要检查'}</strong>
                <small>{memoryDiagnostics.integrity === 'ok' ? 'SQLite 一致性检查通过' : memoryDiagnostics.integrity}
                  {' · '}{(Number(memoryDiagnostics.databaseBytes || 0) / 1024 / 1024).toFixed(1)} MB
                  {' · '}{memoryDiagnostics.backups?.length || 0} 个本地快照
                  {memoryDiagnostics.automaticBackup?.lastBackupAt
                    ? ` · 自动快照 ${new Date(memoryDiagnostics.automaticBackup.lastBackupAt).toLocaleString('zh-CN', { hour12: false })}`
                    : ' · 自动快照等待首次完整同步'}
                  {memoryDiagnostics.embeddings ? ` · 语义索引 ${memoryDiagnostics.embeddings.indexed}/${memoryDiagnostics.embeddings.total}（${memoryDiagnostics.embeddings.ann?.active ? 'ANN' : '精确'}）` : ''}
                  {memoryDiagnostics.ocr ? ` · OCR ${memoryDiagnostics.ocr.chinese ? '中文可用' : '未就绪'}` : ''}
                  {memoryDiagnostics.imageSemantics ? ` · 图片视觉 ${memoryDiagnostics.imageSemantics.available ? '本地可用' : '未就绪'}` : ''}
                  {memoryDiagnostics.stateStorage ? ` · 状态文件${memoryDiagnostics.stateStorage.recovered ? '已从备份恢复' : '耐久写入正常'}` : ''}
                  {memoryDiagnostics.structuredEvidenceMigration?.version
                    ? ` · 证据去重 ${Number(memoryDiagnostics.structuredEvidenceMigration.duplicatesRemoved || 0).toLocaleString()} 条 / 恢复发送者 ${Number(memoryDiagnostics.structuredEvidenceMigration.sendersRecovered || 0).toLocaleString()} 条 / 来源回填 ${Number(memoryDiagnostics.structuredEvidenceMigration.sourceRowsBackfilledTotal || 0).toLocaleString()} 条 / 来源身份${memoryDiagnostics.structuredEvidenceMigration.sourceIdentity === true ? '正常' : '待迁移'} / 约束${memoryDiagnostics.structuredEvidenceMigration.constraintsHealthy === false ? '异常' : '正常'}`
                    : ''}
                  {memoryDiagnostics.structuredEvidenceReferences?.version
                    ? ` · 引用${memoryDiagnostics.referentialIntegrityHealthy ? '完整' : '异常'} / 清理孤儿 ${Number(memoryDiagnostics.structuredEvidenceReferences.orphansRemovedTotal || 0).toLocaleString()} 条`
                    : ''}
                  {memoryDiagnostics.genericSearchEvidenceIdentity?.version
                    ? ` · 通用证据${memoryDiagnostics.genericSearchEvidenceIdentityHealthy ? '身份与引用完整' : '约束异常'} / 迁移 ${Number(memoryDiagnostics.genericSearchEvidenceIdentity.migrationsTotal || 0).toLocaleString()} / 清理孤儿 ${Number(memoryDiagnostics.genericSearchEvidenceIdentity.orphanRowsRemovedTotal || 0).toLocaleString()}`
                    : ''}
                  {memoryDiagnostics.structuredSearchIndex?.version
                    ? ` · 检索索引${memoryDiagnostics.structuredSearchIndexHealthy ? '一致' : '异常'} / 缺失 ${Number(memoryDiagnostics.structuredSearchIndex.missingDocumentsRebuiltTotal || 0).toLocaleString()} / 正文 ${Number(memoryDiagnostics.structuredSearchIndex.structuredDocumentsRepairedTotal || 0).toLocaleString()} / FTS ${Number(memoryDiagnostics.structuredSearchIndex.ftsPayloadsRebuiltTotal || 0).toLocaleString()} / ANN 孤儿 ${Number(memoryDiagnostics.structuredSearchIndex.orphanAnnRowsRemovedTotal || 0).toLocaleString()} / 元数据 ${Number(memoryDiagnostics.structuredSearchIndex.metadataDocumentsRepairedTotal || 0).toLocaleString()} / 实体 ${Number(memoryDiagnostics.structuredSearchIndex.entityDocumentsRepairedTotal || 0).toLocaleString()} / 资源 ${Number(memoryDiagnostics.structuredSearchIndex.resourceDocumentsRepairedTotal || 0).toLocaleString()}`
                    : ''}
                  {memoryDiagnostics.taskSearchIndex?.version
                    ? ` · 待办检索${memoryDiagnostics.taskSearchIndexHealthy ? '一致' : '异常'} / 自愈 ${Number(memoryDiagnostics.taskSearchIndex.repairedDerivedDocumentsTotal || 0).toLocaleString()}`
                    : ''}
                </small>
              </span>
            </div>
            <div className="assistant-memory-health-actions">
              <button onClick={() => setShowDiagnostics(true)}>完整诊断</button>
              <button onClick={() => void backupMemory()} disabled={backingUpMemory || restoringMemory || !memoryDiagnostics.healthy}>
                {backingUpMemory ? '正在验证并备份…' : '立即备份个人记忆'}
              </button>
              <button onClick={openExportMemoryBundle} disabled={migratingMemory || !memoryDiagnostics.healthy}>
                {migratingMemory ? '正在处理迁移包…' : '导出到其他电脑'}
              </button>
              <button onClick={() => void openImportMemoryBundle()} disabled={migratingMemory || restoringMemory}>导入迁移包</button>
              {memoryDiagnostics.embeddings?.pending > 0 && <button onClick={() => void indexMemoryVectors()} disabled={indexingVectors}>
                {indexingVectors ? '正在本地生成向量…' : '补齐语义索引'}
              </button>}
              {!!memoryDiagnostics.backups?.length && <details>
                <summary>恢复历史快照</summary>
                <div>
                  {memoryDiagnostics.backups.slice(0, 5).map((backup: any) => <button key={backup.path}
                    disabled={restoringMemory || !backup.hasState}
                    title={backup.hasState ? '恢复数据库、图谱、任务和增量游标' : '旧快照缺少完整状态文件'}
                    onClick={() => void openMemoryRestoreDialog(backup)}>
                    {new Date(backup.createdAt).toLocaleString('zh-CN')}{backup.hasState ? '' : '（仅数据库）'}
                  </button>)}
                </div>
              </details>}
            </div>
          </section>
        )}
        {memoryDiagnostics?.automaticBackup?.lastError && (
          <section className="assistant-ingestion-status partial">
            <strong>自动记忆快照暂未完成</strong>
            <span>
              最近尝试 {memoryDiagnostics.automaticBackup.lastAttemptAt
                ? new Date(memoryDiagnostics.automaticBackup.lastAttemptAt).toLocaleString('zh-CN', { hour12: false })
                : '未知'}
            </span>
            <small>{memoryDiagnostics.automaticBackup.lastError}</small>
            <small>完整同步成功后会自动重试，每次失败至少间隔 60 分钟；同步结果本身不受影响，也不会误记为已经备份。</small>
          </section>
        )}
        {memoryDiagnostics?.appRecovery?.recoveredFromInterruption && (
          <section className="assistant-recovery-banner">
            <RefreshCw size={15} />
            <span><strong>已从上次异常中恢复</strong>
              <small>{memoryDiagnostics.appRecovery.recoveryMessage}；未完成的增量批次会沿 checkpoint 继续。</small>
            </span>
            <button onClick={() => setShowDiagnostics(true)}>查看运行记录</button>
          </section>
        )}
        {dashboard?.qualityBaseline && <section className={`assistant-quality-baseline ${dashboard.qualityBaseline.failures?.length ? 'warning' : ''}`}>
          <div><ShieldCheck size={15} /><span><strong>任务归属质量基线 · {dashboard.qualityBaseline.version}</strong>
            <small>{dashboard.qualityBaseline.samples} 个匿名化合成样本 · 精确率 {Math.round(dashboard.qualityBaseline.minePrecision * 100)}% · 召回率 {Math.round(dashboard.qualityBaseline.mineRecall * 100)}% · 全字段准确率 {Math.round(dashboard.qualityBaseline.exactAccuracy * 100)}%</small>
          </span></div>
          <span>{dashboard.qualityBaseline.failures?.length ? `${dashboard.qualityBaseline.failures.length} 个样本未通过` : '全部通过'}</span>
        </section>}
        {dashboard?.notificationDelivery && <section className={`assistant-notification-delivery ${dashboard.notificationDelivery.lastError ? 'warning' : ''}`}>
          <div><Clock3 size={14} /><span><strong>通知投递 · {dashboard.notificationDelivery.quiet ? '静默中' : '可发送'}</strong>
            <small>静默 {dashboard.notificationDelivery.quietStart}–{dashboard.notificationDelivery.quietEnd} · 已成功去重投递 {dashboard.notificationDelivery.sent} 条</small>
          </span></div>
          <span>{dashboard.notificationDelivery.pending
            ? `${dashboard.notificationDelivery.pending} 条等待静默结束或下次启动`
            : '没有待发通知'}</span>
          {dashboard.notificationDelivery.lastError && <small>{dashboard.notificationDelivery.lastError}</small>}
        </section>}

        <section className="assistant-briefing-card">
          <div className="assistant-briefing-copy">
            <div className="assistant-briefing-tabs">
              <button className={briefingPeriod === 'latest' ? 'active' : ''} onClick={() => setBriefingPeriod('latest')}>最新增量</button>
              <button className={briefingPeriod === 'week' ? 'active' : ''} onClick={() => setBriefingPeriod('week')}>本周汇总</button>
            </div>
            {briefingPeriod === 'latest' ? <>
              <h2>{briefing?.headline || '等待第一次增量整理'}</h2>
              <p>{briefing?.summary || '服务会在启动时自动补齐，也会在每天设定时间整理新增消息。'}</p>
              <small>派生简报只保留最近 {dashboard?.briefingStorage?.retentionDays || 90} 天；事实、事件、任务和原文证据长期保留，不受影响。</small>
              {briefing?.summary && <details className="assistant-query-plan">
                <summary>{briefing.summaryVerified ? `查看摘要原文（${briefing.summaryEvidence?.length || 0}）` : '历史摘要 · 生成时尚未保存逐条引用'}</summary>
                {briefing.summaryVerified
                  ? <div>{(briefing.summaryEvidence || []).map((item: any) => <span key={item.evidenceKey}>
                    {item.sessionName} · {item.sender}：“{item.excerpt}”
                  </span>)}</div>
                  : <small>该摘要可以作为历史阅读材料，但不会作为新的可信事实或问答证据。</small>}
              </details>}
            </> : <>
              <h2>{weeklyBriefing?.daysWithUpdates || 0} 天有新增信息，{weeklyBriefing?.activeTaskCount || 0} 项仍在推进</h2>
              <p>{(weeklyBriefing?.summaries || []).map((item: any) => {
                const text = item.summary || item.headline
                return text && item.summary && !item.verified ? `【历史未验证摘要】${text}` : text
              }).filter(Boolean).slice(0, 3).join(' ') || '本周尚无可汇总的新增信息。'}</p>
            </>}
          </div>
          <div className="assistant-stat">
            <strong>{briefingPeriod === 'latest' ? briefing?.messageCount || 0 : weeklyBriefing?.messageCount || 0}</strong>
            <span>{briefingPeriod === 'latest' ? '条本次新增消息' : '条本周新增消息'}</span>
            <small>{briefingPeriod === 'latest'
              ? `${dashboard?.memoryStats?.claims || 0} 条事实 · ${dashboard?.memoryStats?.events || 0} 个事件 · ${dashboard?.memoryStats?.resources || 0} 个资源`
              : `${weeklyBriefing?.highPriorityTaskCount || 0} 项高优先级 · ${weeklyBriefing?.waitingTaskCount || 0} 项等待中`}</small>
          </div>
        </section>

        <div className="assistant-grid">
          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">ACTION ITEMS</span><h3>持续待办池</h3></div>
              <span className="assistant-count">{taskWorkset.total} 项符合当前范围</span>
            </div>
            {Number(dashboard?.taskMutationCommits?.prepared || 0) > 0 && <div className="assistant-error">
              <strong>任务写入恢复现场仍待处理</strong>
              <span>
                {Number(dashboard.taskMutationCommits.prepared)} 组任务变更尚未确定性收敛；
                系统已保留 SQLCipher 恢复载荷，不会猜测覆盖当前任务。
              </span>
            </div>}
            {!!dashboard?.taskMutationCommits?.startupRecovery?.attempted && <small className="assistant-evidence">
              本次启动核验 {Number(dashboard.taskMutationCommits.startupRecovery.attempted)} 组中断任务变更：
              完成 {Number(dashboard.taskMutationCommits.startupRecovery.applied)}、
              放弃 {Number(dashboard.taskMutationCommits.startupRecovery.abandoned)}、
              冲突 {Number(dashboard.taskMutationCommits.startupRecovery.conflicts)}。
            </small>}
            <div className="assistant-task-filters">
              <select disabled={!!focusedTaskId} value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value as any)}>
                <option value="all">全部进行中状态</option><option value="todo">待处理</option><option value="doing">进行中</option><option value="waiting">等待中</option>
              </select>
              <select disabled={!!focusedTaskId} value={taskPriorityFilter} onChange={event => setTaskPriorityFilter(event.target.value as any)}>
                <option value="all">全部优先级</option><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option>
              </select>
              <select disabled={!!focusedTaskId} value={taskKindFilter} onChange={event => setTaskKindFilter(event.target.value as any)}>
                <option value="all">全部类型</option><option value="action">自己执行</option><option value="delegated">已委派</option><option value="waiting">等待他人</option>
              </select>
              <input disabled={!!focusedTaskId} value={taskQuery} onChange={event => setTaskQuery(event.target.value)} placeholder="搜索进行中待办" />
              <div className="assistant-task-view-toggle">
                <button className={taskView === 'list' ? 'active' : ''} onClick={() => setTaskView('list')}>列表</button>
                <button className={taskView === 'calendar' ? 'active' : ''} onClick={() => setTaskView('calendar')}><CalendarDays size={11} /> 月历</button>
              </div>
              <button disabled={!displayedTasks.length} onClick={() => void completeVisibleTasks()}>完成已加载筛选</button>
              {focusedTaskId && <button onClick={() => setFocusedTaskId('')}>返回原筛选</button>}
            </div>
            {focusedTaskId && <small className="assistant-evidence">
              正在精确定位提醒对应的任务；此时暂不应用原来的状态、优先级、类型和关键词筛选。
            </small>}
            {dashboard?.taskPayloadPolicy?.activeDirectory === 'paginated_on_demand' && <small className="assistant-evidence">
              进行中待办按当前筛选从 SQLCipher 分页读取（已加载 {tasks.length} / {taskWorkset.total}）；
              已完成和已取消任务进入下方档案。原文证据和修改历史仅在展开单条任务时读取。
            </small>}
            {(!!taskReminders.length || reminderPreferences?.mutedKinds?.length) && <div className="assistant-task-reminders">
              {taskReminders.slice(0, 8).map(reminder => <article key={reminder.id} className={reminder.severity}>
                <button className="assistant-reminder-main"
                  onClick={() => {
                    setTaskView('list')
                    setFocusedTaskId(reminder.taskId)
                  }}>
                  <strong>{reminder.kind === 'overdue' ? '已逾期' : reminder.kind === 'due_soon' ? '即将到期' : reminder.kind === 'blocked' ? '存在依赖' : '等待过久'} · {reminder.title}</strong>
                  <span>{reminder.reason}</span>
                </button>
                <div className="assistant-reminder-feedback">
                  <button onClick={() => void updateReminderPreference(reminder, 'helpful')}>有用</button>
                  <button onClick={() => void updateReminderPreference(reminder, 'snooze')}>24 小时后</button>
                  <button onClick={() => void updateReminderPreference(reminder, 'mute_kind')}>关闭此类</button>
                </div>
              </article>)}
              {!!reminderPreferences?.mutedKinds?.length && <details className="assistant-muted-reminders">
                <summary>已关闭 {reminderPreferences.mutedKinds.length} 类提醒 · 共隐藏 {reminderPreferences.suppressed || 0} 条</summary>
                <div>{reminderPreferences.mutedKinds.map((kind: string) => <button key={kind} onClick={() => void updateReminderPreference(
                  { id: '', taskId: '', kind }, 'restore_kind'
                )}>恢复“{kind === 'overdue' ? '逾期' : kind === 'due_soon' ? '临期' : kind === 'blocked' ? '依赖阻塞' : '等待过久'}”提醒</button>)}</div>
              </details>}
              {Number(reminderPreferences?.visibleTotal || 0) > Number(reminderPreferences?.payloadLimit || 32) &&
                <small>提醒按紧迫度展示前 {reminderPreferences.payloadLimit} / {reminderPreferences.visibleTotal} 条。</small>}
            </div>}
            {taskView === 'calendar' && <div className="assistant-task-calendar">
              <header><button onClick={() => moveCalendarMonth(-1)}>‹</button><strong>{calendarMonth}</strong><button onClick={() => moveCalendarMonth(1)}>›</button></header>
              <div className="assistant-calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
              <div className="assistant-calendar-grid">
                {taskCalendar.days.map(day => <button key={day.date} className={`${day.inMonth ? '' : 'outside'} ${day.isToday ? 'today' : ''} ${selectedCalendarDate === day.date ? 'selected' : ''}`}
                  onClick={() => setSelectedCalendarDate(day.date)}>
                  <b>{day.day}</b>
                  <div>{day.tasks.slice(0, 3).map(task => <span className={`${task.priority} ${task.status}`} key={task.id}>{task.title}</span>)}</div>
                  {day.tasks.length > 3 && <small>+{day.tasks.length - 3}</small>}
                </button>)}
              </div>
              <div className="assistant-calendar-detail">
                <h4>{selectedCalendarDate} <small>{selectedCalendarDay?.tasks.length || 0} 项</small></h4>
                {(selectedCalendarDay?.tasks || []).map(task => <button key={task.id} onClick={() => {
                  setEditingTask({
                    ...task, owner: task.owner || '我', collaboratorsText: (task.collaborators || []).join('、'),
                    project: task.project || '', dependsOnIds: task.dependsOnIds || [], taskKind: task.taskKind || 'action',
                    detail: task.detail || '', due: task.due || ''
                  })
                  setTaskView('list')
                }}><b>{task.title}</b><span>{task.status} · {task.priority}</span></button>)}
                {!(selectedCalendarDay?.tasks.length) && <em>当天没有当前筛选范围内的任务</em>}
                {!!taskCalendar.overdue.length && <details><summary>逾期未完成 · {taskCalendar.overdue.length}</summary>
                  {taskCalendar.overdue.map(task => <small key={task.id}>{task.due} · {task.title}</small>)}</details>}
                {!!taskCalendar.unscheduled.length && <details><summary>未排期 · {taskCalendar.unscheduled.length}</summary>
                  {taskCalendar.unscheduled.map(task => <small key={task.id}>{task.title}</small>)}</details>}
              </div>
            </div>}
            {taskView === 'list' && <div className="assistant-task-list">
              {taskWorkset.loading && <div className="assistant-empty">正在读取当前行动工作集…</div>}
              {!taskWorkset.loading && displayedTasks.length === 0 && <div className="assistant-empty">当前筛选没有待办</div>}
              {displayedTasks.map(task => (
                <article id={`assistant-task-${task.id}`} className={`assistant-task ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                  <button className="assistant-check" onClick={() => void toggleTask(task)} aria-label={task.status === 'done' ? '恢复待办' : '完成待办'}>
                    {task.status === 'done' && <Check size={13} />}
                  </button>
                  <div>
                    {editingTask?.id === task.id ? <div className="assistant-task-editor">
                      <input value={editingTask.title} onChange={event => setEditingTask({ ...editingTask, title: event.target.value })} placeholder="待办标题" />
                      <textarea value={editingTask.detail} onChange={event => setEditingTask({ ...editingTask, detail: event.target.value })} placeholder="补充说明" />
                      <div>
                        <input value={editingTask.owner} onChange={event => setEditingTask({ ...editingTask, owner: event.target.value })} placeholder="负责人" />
                        <input value={editingTask.collaboratorsText} onChange={event => setEditingTask({ ...editingTask, collaboratorsText: event.target.value })} placeholder="协作者（逗号分隔）" />
                        <input value={editingTask.project} onChange={event => setEditingTask({ ...editingTask, project: event.target.value })} placeholder="所属项目" />
                        <input value={editingTask.due} onChange={event => setEditingTask({ ...editingTask, due: event.target.value })} placeholder="截止时间" />
                        <select value={editingTask.taskKind || 'action'} onChange={event => setEditingTask({ ...editingTask, taskKind: event.target.value })}>
                          <option value="action">自己执行</option><option value="delegated">已委派</option><option value="waiting">等待他人</option>
                        </select>
                        <select value={editingTask.priority} onChange={event => setEditingTask({ ...editingTask, priority: event.target.value })}>
                          <option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option>
                        </select>
                        <select value={editingTask.status} onChange={event => setEditingTask({ ...editingTask, status: event.target.value })}>
                          <option value="todo">待处理</option><option value="doing">进行中</option><option value="waiting">等待中</option><option value="done">已完成</option><option value="cancelled">已取消</option>
                        </select>
                      </div>
                      <div className="assistant-task-dependencies">
                        <span>依赖其他待办</span>
                        <input value={taskDependencyQuery}
                          onChange={event => setTaskDependencyQuery(event.target.value)}
                          placeholder="搜索全部任务标题、项目或负责人" />
                        <div className="assistant-task-dependency-options">
                          {taskDependencyCandidates.items.map((candidate: any) => {
                            const checked = (editingTask.dependsOnIds || []).includes(candidate.id)
                            return <label key={candidate.id}>
                              <input type="checkbox" checked={checked} onChange={() => setEditingTask({
                                ...editingTask,
                                dependsOnIds: checked
                                  ? (editingTask.dependsOnIds || []).filter((id: string) => id !== candidate.id)
                                  : [...(editingTask.dependsOnIds || []), candidate.id]
                              })} />
                              <span><b>{candidate.title}</b><small>
                                {candidate.status} · {candidate.priority}
                                {candidate.project ? ` · ${candidate.project}` : ''}
                              </small></span>
                            </label>
                          })}
                          {taskDependencyCandidates.loading && <small>正在搜索全部任务…</small>}
                          {!taskDependencyCandidates.loading && !taskDependencyCandidates.items.length &&
                            <small>没有匹配的可依赖任务。</small>}
                        </div>
                        <small>
                          已选择 {(editingTask.dependsOnIds || []).length} 项；
                          当前搜索匹配 {taskDependencyCandidates.total || 0} 项，优先显示前 20 项。
                        </small>
                      </div>
                      <div className="assistant-task-editor-actions"><button onClick={() => setEditingTask(null)}>取消</button><button className="primary" onClick={() => void saveTask()}>保存</button></div>
                    </div> : <>
                      <strong>{task.title}</strong>
                      {task.detail && <p>{task.detail}</p>}
                    </>}
                    <div className="assistant-tags">
                      {task.classification === 'uncertain' && <span>待确认归属</span>}
                      <span>{task.taskKind === 'delegated' ? '已委派' : task.taskKind === 'waiting' ? '等待他人' : '自己执行'}</span>
                      {task.owner && <span>负责人 {task.owner}</span>}
                      {!!task.collaborators?.length && <span>协作 {task.collaborators.join('、')}</span>}
                      {task.project && <span>项目 {task.project}</span>}
                      {!!task.dependsOnIds?.length && <span>依赖 {task.dependsOnIds.length} 项</span>}
                      {task.source && <span>来自 {task.source}</span>}
                      {task.due && <span><Clock3 size={10} /> {task.due}</span>}
                      <span>{Math.round(task.confidence * 100)}% 可信</span>
                    </div>
                    {task.assignmentEvidence && <small className="assistant-evidence">归属依据：{task.assignmentEvidence}</small>}
                    {task.ownershipPolicyReason && <small className="assistant-evidence">策略判断：{task.ownershipPolicyReason}</small>}
                    {editingTask?.id !== task.id && <div className="assistant-task-actions">
                      <button onClick={() => setEditingTask({
                        ...task,
                        owner: task.owner || '我',
                        collaboratorsText: (task.collaborators || []).join('、'),
                        project: task.project || '',
                        dependsOnIds: task.dependsOnIds || [],
                        taskKind: task.taskKind || 'action',
                        detail: task.detail || '',
                        due: task.due || ''
                      })}>编辑待办</button>
                      <button onClick={() => setSelectedTaskId(current => current === task.id ? '' : task.id)}>
                        {selectedTaskId === task.id ? '收起原文与历史' : `查看原文与历史${Number((task as any).evidenceTotal || 0) ? `（${(task as any).evidenceTotal}）` : ''}`}
                      </button>
                    </div>}
                    {selectedTaskId === task.id && <div className="assistant-task-history">
                      {taskWorkspace.status === 'loading' && <small>正在读取这条待办的原文与审计历史…</small>}
                      {taskWorkspace.status === 'error' && <>
                        <small className="assistant-error">{taskWorkspace.error || '读取失败'}</small>
                        <button onClick={() => setTaskWorkspaceRefreshKey(value => value + 1)}>重试</button>
                      </>}
                      {taskWorkspace.status === 'ready' && taskWorkspace.task?.id === task.id && <>
                        <EvidenceRows
                          evidence={taskWorkspace.task.evidence}
                          total={taskWorkspace.task.evidenceTotal}
                          onOpenArchive={() => void openMemoryEvidenceArchive(
                            'task', taskWorkspace.task.id, taskWorkspace.task.title
                          )}
                        />
                        {!!taskWorkspace.history?.length && <details open>
                          <summary>状态历史（{taskWorkspace.historyTotal || taskWorkspace.history.length}）</summary>
                          <div className="assistant-task-history">
                            {taskWorkspace.history.map((item: any) => <small key={item.id}>
                              {new Date(item.created_at).toLocaleString('zh-CN')} · {item.field}：{taskHistoryValue(item.before_value)} → {taskHistoryValue(item.after_value)}
                            </small>)}
                            {Number(taskWorkspace.historyTotal || 0) > taskWorkspace.history.length &&
                              <small>当前显示最近 {taskWorkspace.history.length} / {taskWorkspace.historyTotal} 条。</small>}
                          </div>
                        </details>}
                        {!taskWorkspace.task.evidence?.length && !taskWorkspace.history?.length &&
                          <small>这条待办目前没有可展示的原文或修改历史。</small>}
                      </>}
                    </div>}
                  </div>
                  <i className={`priority ${task.priority}`} />
                </article>
              ))}
            </div>}
            {taskWorkset.hasMore && <button disabled={taskWorksetLoadingMore} onClick={() => void loadMoreActiveTasks()}>
              {taskWorksetLoadingMore ? '正在加载…' : `加载更多（已显示 ${tasks.length} / ${taskWorkset.total}）`}
            </button>}
            {taskView === 'calendar' && taskWorkset.hasMore && <small className="assistant-evidence">
              月历当前仅覆盖已加载的 {tasks.length} 项；继续加载可扩展月历与依赖候选。
            </small>}
          </section>

          <aside className="assistant-panel assistant-signals">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">SIGNALS</span><h3>值得留意</h3></div></div>
            {(briefing?.highlightItems?.length ? briefing.highlightItems : (briefing?.highlights || []).map((text: string) => ({ text, evidence: [], legacy: true })))
              .map((highlight: any, index: number) => (
              <div className="assistant-highlight" key={`${index}-${highlight.text}`}>
                <Sparkles size={13} /><span>{highlight.text}
                  <small>{highlight.legacy ? '历史重点 · 未保存逐条引用' : `${highlight.evidence.length} 条原文依据`}</small>
                  {!!highlight.evidence?.length && <details><summary>查看原文</summary>
                    {highlight.evidence.map((item: any) => <i key={item.evidenceKey}>{item.sessionName} · {item.sender}：“{item.excerpt}”</i>)}
                  </details>}
                </span>
              </div>
            ))}
            {!(briefing?.highlights?.length) && <div className="assistant-empty">暂无重要动态</div>}
            {status?.cursor?.lastError && <div className="assistant-error"><strong>上次同步未完成</strong><span>{status.cursor.lastError}</span></div>}
          </aside>
        </div>

        <section className="assistant-panel assistant-project-portfolio">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">TASK ARCHIVE</span><h3>已关闭任务档案</h3></div>
            <span className="assistant-count">{taskArchive.total} 项</span>
          </div>
          <div className="assistant-memory-scope assistant-event-scope">
            <select value={taskArchiveStatus} onChange={event => setTaskArchiveStatus(event.target.value as any)}>
              <option value="all">已完成与已取消</option>
              <option value="done">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
            <select value={taskArchivePriority} onChange={event => setTaskArchivePriority(event.target.value)}>
              <option value="">所有优先级</option>
              <option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option>
            </select>
            <input value={taskArchiveProject} onChange={event => setTaskArchiveProject(event.target.value)}
              list="task-archive-project-directory" placeholder="搜索项目（支持部分名称）" />
            <datalist id="task-archive-project-directory">
              {taskArchiveProjects.items.map(item =>
                <option key={`task-archive-project-${item.project}`} value={item.project}>
                  {item.taskTotal} 个已关闭任务
                </option>)}
            </datalist>
            <input value={taskArchiveQuery} onChange={event => setTaskArchiveQuery(event.target.value)}
              placeholder="搜索标题、负责人、协作者或说明" />
            <label><span>关闭/更新从</span><input type="date" value={taskArchiveFrom} onChange={event => setTaskArchiveFrom(event.target.value)} /></label>
            <label><span>到</span><input type="date" value={taskArchiveTo} onChange={event => setTaskArchiveTo(event.target.value)} /></label>
            {(taskArchiveStatus !== 'all' || taskArchivePriority || taskArchiveProject || taskArchiveQuery || taskArchiveFrom || taskArchiveTo) &&
              <button onClick={() => {
                setTaskArchiveStatus('all'); setTaskArchivePriority(''); setTaskArchiveProject('')
                setTaskArchiveQuery(''); setTaskArchiveFrom(''); setTaskArchiveTo('')
              }}>清除范围</button>}
          </div>
          <small className="assistant-evidence">
            历史任务从本机 SQLCipher 目录按需分页读取，不参与 15 秒首页轮询；项目目录可搜索全部
            {taskArchiveProjects.total} 个匹配项目{taskArchiveProjects.loading ? '（检索中）' : ''}，不再截断前 500 个。
            恢复后会重新进入当前行动工作集。
          </small>
          <div className="assistant-memory-list">
            {taskArchive.items.map(task => <article className="assistant-memory-item" key={`task-archive-${task.id}`}>
              <div className="assistant-memory-item-head">
                <strong>{task.title}</strong>
                <span className={task.status}>{task.status === 'done' ? '已完成' : '已取消'}</span>
              </div>
              {task.detail && <p>{task.detail}</p>}
              <small>{task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN') : '时间未知'}
                {task.project ? ` · 项目 ${task.project}` : ''}
                {task.due ? ` · 原截止 ${task.due}` : ''}
                {` · ${task.priority === 'high' ? '高' : task.priority === 'low' ? '低' : '中'}优先级`}
              </small>
              <div className="assistant-memory-actions">
                <button onClick={() => setSelectedTaskId(current => current === task.id ? '' : task.id)}>
                  {selectedTaskId === task.id ? '收起原文与历史' : `查看原文与历史（${Number((task as any).evidenceTotal || 0)}）`}
                </button>
                <button className="primary" onClick={() => void restoreArchivedTask(task)}>恢复到待处理</button>
              </div>
              {selectedTaskId === task.id && <div className="assistant-task-history">
                {taskWorkspace.status === 'loading' && <small>正在读取任务原文与审计历史…</small>}
                {taskWorkspace.status === 'error' && <small className="assistant-error">{taskWorkspace.error || '读取失败'}</small>}
                {taskWorkspace.status === 'ready' && taskWorkspace.task?.id === task.id && <>
                  <EvidenceRows evidence={taskWorkspace.task.evidence} total={taskWorkspace.task.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'task', taskWorkspace.task.id, taskWorkspace.task.title
                    )} />
                  {!!taskWorkspace.history?.length && <details open>
                    <summary>修改历史（{taskWorkspace.historyTotal || taskWorkspace.history.length}）</summary>
                    <div className="assistant-task-history">
                      {taskWorkspace.history.map((item: any) => <small key={`archive-history-${item.id}`}>
                        {new Date(item.created_at).toLocaleString('zh-CN')} · {item.field}：{taskHistoryValue(item.before_value)} → {taskHistoryValue(item.after_value)}
                      </small>)}
                    </div>
                  </details>}
                </>}
              </div>}
            </article>)}
            {!taskArchive.items.length && <div className="assistant-empty">
              {taskArchive.loading ? '正在读取任务档案…' : '当前范围没有已完成或已取消任务。'}
            </div>}
          </div>
          {taskArchive.hasMore && <div className="assistant-timeline-more">
            <button disabled={taskArchiveLoadingMore} onClick={() => void loadMoreTaskArchive()}>
              {taskArchiveLoadingMore ? '正在加载…' : `加载更多（已显示 ${taskArchive.items.length}/${taskArchive.total}）`}
            </button>
          </div>}
        </section>

        <section className="assistant-panel assistant-project-portfolio">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">PROJECT INTELLIGENCE</span><h3>项目驾驶舱</h3></div>
            <span className="assistant-count">{projectDirectory.total} 个匹配项目</span>
          </div>
          <div className="assistant-task-filters">
            <input value={projectQuery} onChange={event => setProjectQuery(event.target.value)}
              placeholder="搜索项目名称或摘要" />
            <select value={projectPhase} onChange={event => setProjectPhase(event.target.value)}>
              <option value="">全部阶段</option>
              <option value="active">推进中</option>
              <option value="planned">已规划</option>
              <option value="completed">已完成</option>
              <option value="discovery">发现阶段</option>
            </select>
          </div>
          {dashboard?.projectDirectory?.directory === 'paginated_on_demand' && <small className="assistant-evidence">
            项目目录按搜索和阶段从本机服务分页读取（已加载 {projectInsights.length} / {projectDirectory.total}）；
            任务、事件、候选与原文证据会在点击项目后按需读取。
          </small>}
          {projectDirectory.loading && <div className="assistant-empty">正在读取项目目录…</div>}
          {projectInsights.length ? <div className="assistant-project-grid">
            {projectInsights.map(project => <button key={project.id} onClick={() => setSelectedProjectId(project.id)}>
              <div><strong>{project.name}</strong><span>{project.phase === 'completed' ? '已完成' : project.phase === 'active' ? '推进中' : project.phase === 'planned' ? '已规划' : '发现阶段'}</span></div>
              <p>{project.summary || (project.inferred ? '从待办项目字段识别，等待更多图谱证据。' : '等待更多项目证据补充。')}</p>
              <div className="assistant-project-progress"><i style={{ width: `${project.progress}%` }} /><span>{project.progress}%</span></div>
              <small>{project.activeTaskCount} 项进行中 · {project.memberCount} 位已确认参与者 · {project.riskCount} 个风险
                {project.pendingReviewTotal ? ` · ${project.pendingReviewTotal} 条候选待确认` : ''}
              </small>
            </button>)}
          </div> : !projectDirectory.loading && <div className="assistant-empty">
            {projectQuery || projectPhase
              ? '当前筛选没有项目。'
              : '当聊天中识别到项目实体或待办归属项目后，这里会自动形成项目进度、风险、里程碑和决策视图。'}
          </div>}
          {projectDirectory.hasMore && <button disabled={projectDirectoryLoadingMore}
            onClick={() => void loadMoreProjects()}>
            {projectDirectoryLoadingMore
              ? '正在加载…'
              : `加载更多（已显示 ${projectInsights.length} / ${projectDirectory.total}）`}
          </button>}
        </section>

        {(taskOwnershipReviews.total > 0 || taskReviewFeedback.mine || taskReviewFeedback.rejected ||
          taskReviewFeedback.archive?.total) && (
          <section className="assistant-panel assistant-review-section">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">ASSIGNEE REVIEW</span><h3>待确认归属</h3></div>
              <span className="assistant-count">{taskOwnershipReviews.total} 项不会计入你的待办</span>
            </div>
            <div className="assistant-task-feedback-summary">
              <span><b>{Number(taskReviewFeedback.mine || 0)}</b><small>已确认为我的</small></span>
              <span><b>{Number(taskReviewFeedback.rejected || 0)}</b><small>已标记不是我的</small></span>
              <span><b>{Number(taskReviewFeedback.suppressed || 0)}</b><small>重复候选已拦截</small></span>
              <span><b>{Number(taskReviewFeedback.reconciled || 0)}</b><small>启动状态已修复</small></span>
              <p>
                反馈只绑定原始证据，不按相似文字猜测。相同证据不会反复询问；出现新证据时仍会重新判断。
                {taskReviewFeedback.reconciliation?.lastRunAt && ` 本次启动核对 ${taskReviewFeedback.reconciliation.checked} 条判断，修复 ${Number(taskReviewFeedback.reconciliation.removed || 0) + Number(taskReviewFeedback.reconciliation.confirmed || 0) + Number(taskReviewFeedback.reconciliation.restored || 0)} 项状态。`}
              </p>
            </div>
            <div className="assistant-task-filters">
              <select value={taskOwnershipClassification}
                onChange={event => setTaskOwnershipClassification(event.target.value)}>
                <option value="">全部待确认类型</option>
                <option value="uncertain">归属不确定</option>
                <option value="others">模型认为属于他人</option>
              </select>
              <select value={taskOwnershipPriority}
                onChange={event => setTaskOwnershipPriority(event.target.value)}>
                <option value="">全部优先级</option>
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
              <input value={taskOwnershipQuery} onChange={event => setTaskOwnershipQuery(event.target.value)}
                placeholder="搜索标题、说明、来源或归属依据" />
              <label>从<input type="date" value={taskOwnershipFrom}
                onChange={event => setTaskOwnershipFrom(event.target.value)} /></label>
              <label>到<input type="date" value={taskOwnershipTo}
                onChange={event => setTaskOwnershipTo(event.target.value)} /></label>
            </div>
            {dashboard?.taskOwnershipReviews?.directory === 'paginated_on_demand' && <small className="assistant-evidence">
              候选按需从 SQLCipher 分页读取；原文只在点击单条后加载，不进入首页轮询。
              当前全库：不确定 {taskOwnershipReviews.counts.uncertain || 0} · 属于他人 {taskOwnershipReviews.counts.others || 0}。
            </small>}
            {taskReviewQueue.map(task => (
              <article className="assistant-review-item" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  {task.detail && <p>{task.detail}</p>}
                  <small>{task.assignmentEvidence || '缺少足够的归属证据'}{task.source ? ` · 来自 ${task.source}` : ''}</small>
                </div>
                <div>
                  <button onClick={() => setSelectedTaskId(task.id)}>查看原文</button>
                  <button onClick={() => void decideTaskReview(task.id, 'rejected')}>不是我的</button>
                  <button className="primary" onClick={() => void decideTaskReview(task.id, 'mine')}>归为我的待办</button>
                </div>
              </article>
            ))}
            {taskOwnershipReviews.loading && <div className="assistant-empty">正在读取待确认归属…</div>}
            {!taskOwnershipReviews.loading && !taskReviewQueue.length && <div className="assistant-empty">
              当前筛选下没有待确认归属。
            </div>}
            {taskOwnershipReviews.hasMore && <button onClick={() => void loadMoreTaskOwnershipReviews()}
              disabled={taskOwnershipLoadingMore}>
              {taskOwnershipLoadingMore ? '正在加载下一页…' : '加载更多待确认归属'}
            </button>}
            {!!taskReviewFeedback.archive?.total && <details className="assistant-task-feedback-history">
              <summary>完整归属反馈档案 · {taskFeedbackArchive.total} 条匹配 / {taskReviewFeedback.archive.total} 条全部</summary>
              <div className="assistant-task-filters">
                <select value={taskFeedbackStatus}
                  onChange={event => setTaskFeedbackStatus(event.target.value as any)}>
                  <option value="all">全部状态</option>
                  <option value="active">当前有效</option>
                  <option value="revoked">已经撤销</option>
                </select>
                <select value={taskFeedbackDecision}
                  onChange={event => setTaskFeedbackDecision(event.target.value as any)}>
                  <option value="all">全部判断</option>
                  <option value="mine">确认为我的</option>
                  <option value="rejected">不是我的</option>
                </select>
                <input value={taskFeedbackQuery} onChange={event => setTaskFeedbackQuery(event.target.value)}
                  placeholder="搜索任务标题或来源" />
                <label>从<input type="date" value={taskFeedbackFrom}
                  onChange={event => setTaskFeedbackFrom(event.target.value)} /></label>
                <label>到<input type="date" value={taskFeedbackTo}
                  onChange={event => setTaskFeedbackTo(event.target.value)} /></label>
              </div>
              <small>
                当前有效 {taskFeedbackArchive.counts.active || 0} · 已撤销 {taskFeedbackArchive.counts.revoked || 0}。
                目录不含任务快照或原文，点击单条后才从 SQLCipher 读取。
              </small>
              {taskFeedbackArchive.items.map((item: any) => <div key={item.evidence_fingerprint}>
                <small>
                  {new Date(item.updated_at).toLocaleString('zh-CN')} · {!item.active ? '已撤销' : item.decision === 'mine' ? '确认为我的' : '不是我的'} · {item.title || '未命名事项'}
                  {item.source ? ` · ${item.source}` : ''}
                  {item.active && item.suppression_count ? ` · 已拦截 ${item.suppression_count} 次重复抽取` : ''}
                </small>
                <button onClick={() => void openTaskFeedbackDossier(item.evidence_fingerprint)}>原文与审计</button>
                {item.canRevert && <button onClick={() => void revertTaskReview(item.evidence_fingerprint)}>撤销反馈</button>}
              </div>)}
              {taskFeedbackArchive.loading && <small>正在读取归属反馈档案…</small>}
              {!taskFeedbackArchive.loading && !taskFeedbackArchive.items.length && <small>当前筛选下没有反馈记录。</small>}
              {taskFeedbackArchive.hasMore && <button onClick={() => void loadMoreTaskFeedback()}
                disabled={taskFeedbackLoadingMore}>
                {taskFeedbackLoadingMore ? '正在加载…' : '加载更多反馈'}
              </button>}
            </details>}
            {taskFeedbackDossier && <section className="assistant-task-feedback-dossier">
              <header>
                <strong>{taskFeedbackDossier.title || '归属反馈详情'}</strong>
                <button onClick={() => {
                  taskFeedbackDossierGate.current.invalidate()
                  setTaskFeedbackDossier(null)
                }}>关闭</button>
              </header>
              {taskFeedbackDossier.loading && <small>正在按需读取原文和动作历史…</small>}
              {taskFeedbackDossier.error && <small>{taskFeedbackDossier.error}</small>}
              {!taskFeedbackDossier.loading && !taskFeedbackDossier.error && <>
                <p>
                  {taskFeedbackDossier.active
                    ? taskFeedbackDossier.decision === 'mine' ? '当前判断：是我的待办' : '当前判断：不是我的待办'
                    : '当前判断已经撤销'}
                  {taskFeedbackDossier.source ? ` · 来源 ${taskFeedbackDossier.source}` : ''}
                </p>
                <div className="assistant-evidence-stack">
                  <EvidenceRows evidence={taskFeedbackDossier.evidence || []}
                    total={taskFeedbackDossier.evidenceTotal} roleLabels />
                </div>
                <div>
                  <strong>动作历史 · {taskFeedbackDossier.history?.length || 0} / {taskFeedbackDossier.historyTotal || 0}</strong>
                  {(taskFeedbackDossier.history || []).map((item: any) => <small key={item.id}>
                    {new Date(item.created_at).toLocaleString('zh-CN')} · {
                      item.action === 'mine' ? '确认为我的'
                        : item.action === 'rejected' ? '不是我的'
                          : '撤销反馈'
                    }{item.snapshotAvailable ? ' · 保存了可恢复快照' : ''}
                  </small>)}
                  {taskFeedbackDossier.historyHasMore && <button
                    onClick={() => void loadMoreTaskFeedbackHistory()}
                    disabled={taskFeedbackHistoryLoadingMore}>
                    {taskFeedbackHistoryLoadingMore ? '正在加载…' : '加载更早动作'}
                  </button>}
                </div>
                {taskFeedbackDossier.canRevert && <button
                  onClick={() => void revertTaskReview(taskFeedbackDossier.evidence_fingerprint)}>
                  撤销这条反馈
                </button>}
              </>}
            </section>}
          </section>
        )}

        <section className="assistant-panel assistant-memory-search">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">MEMORY SEARCH</span><h3><Search size={16} /> 搜索个人记忆</h3></div>
          </div>
          <div className="assistant-graph-toolbar">
            <input value={memoryQuery} onChange={event => setMemoryQuery(event.target.value)} placeholder="搜索人物、事实、事件、关系或项目" />
          </div>
          <div className="assistant-memory-scope">
            <TrustedEntityPicker
              value={memoryEntityFilter}
              selected={memoryEntitySelection}
              placeholder="搜索全部可信实体…"
              ariaLabel="实体检索范围"
              onSelect={entity => {
                setMemoryEntitySelection(entity)
                setMemoryEntityFilter(entity.id)
              }}
              onClear={() => {
                setMemoryEntitySelection(null)
                setMemoryEntityFilter('')
              }}
              onError={setMessage} />
            <div className="assistant-memory-session-picker"
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setMemorySessionPickerOpen(false)
                }
              }}>
              <div>
                <input
                  value={memorySessionQuery}
                  onFocus={() => setMemorySessionPickerOpen(true)}
                  onChange={event => {
                    setMemorySessionQuery(event.target.value)
                    setMemorySessionSelection(null)
                    setMemorySessionFilter('')
                    setMemorySessionPickerOpen(true)
                  }}
                  placeholder="搜索全部会话…"
                  aria-label="搜索会话检索范围" />
                {(memorySessionQuery || memorySessionFilter) && <button
                  type="button"
                  aria-label="清除会话范围"
                  onClick={() => {
                    setMemorySessionQuery('')
                    setMemorySessionSelection(null)
                    setMemorySessionFilter('')
                    setMemorySessionPickerOpen(false)
                  }}>×</button>}
              </div>
              {memorySessionSelection && <small className="assistant-memory-session-selected">
                已选：{memorySessionSelection.type === 'group' ? '群聊' : '私聊'} · {memorySessionSelection.sessionId}
                {!memorySessionSelection.enabled ? ' · 当前已停止新分析' : ''}
                {!memorySessionSelection.legacyNameFallbackSafe
                  ? ` · 有 ${memorySessionSelection.displayNameCollisionCount} 个同名会话，仅按 ID 精确检索`
                  : ''}
              </small>}
              {memorySessionPickerOpen && <div className="assistant-memory-session-options">
                {memorySessionOptions.map((source: any) => <button
                  type="button"
                  key={source.sessionId}
                  onClick={() => {
                    setMemorySessionSelection(source)
                    setMemorySessionFilter(source.sessionId)
                    setMemorySessionQuery(source.displayName)
                    setMemorySessionPickerOpen(false)
                  }}>
                  <strong>{source.displayName}</strong>
                  <small>{source.type === 'group' ? '群聊' : '私聊'} · {source.sessionId}
                    {!source.enabled ? ' · 已停止新分析' : ''}
                    {source.displayNameCollisionCount > 1
                      ? ` · ${source.displayNameCollisionCount} 个同名`
                      : ''}
                  </small>
                </button>)}
                {!memorySessionPickerLoading && !memorySessionOptions.length && <span>没有匹配会话</span>}
                {memorySessionPickerLoading && <span>正在搜索全部会话…</span>}
                {!memorySessionPickerLoading && memorySessionOptionTotal > memorySessionOptions.length && <span>
                  匹配 {memorySessionOptionTotal} 个，继续输入名称或 ID 缩小范围
                </span>}
              </div>}
            </div>
            <select value={memorySourceFilter} onChange={event => setMemorySourceFilter(event.target.value)}>
              <option value="">所有数据来源</option>
              <option value="wechat">微信</option>
              <option value="documents">本机文档</option>
              <option value="calendar">macOS 日历</option>
              <option value="mail">macOS Mail</option>
              <option value="legacy">历史来源未知</option>
            </select>
            <select value={memoryTypeFilter} onChange={event => setMemoryTypeFilter(event.target.value)}>
              <option value="">所有记忆类型</option>
              <option value="entity">实体</option><option value="relation">关系</option><option value="claim">事实</option>
              <option value="event">事件</option><option value="task">待办</option><option value="resource">资源</option>
            </select>
            <label><span>从</span><input type="date" value={memoryFrom} onChange={event => setMemoryFrom(event.target.value)} /></label>
            <label><span>至</span><input type="date" value={memoryTo} onChange={event => setMemoryTo(event.target.value)} /></label>
            {(memoryEntityFilter || memorySessionFilter || memorySourceFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
              <button onClick={() => {
                setMemoryEntityFilter('')
                setMemoryEntitySelection(null)
                setMemorySessionFilter('')
                setMemorySessionSelection(null)
                setMemorySessionQuery('')
                setMemorySessionPickerOpen(false)
                setMemorySourceFilter('')
                setMemoryTypeFilter('')
                setMemoryFrom('')
                setMemoryTo('')
              }}>清除范围</button>}
          </div>
          {(memoryEntityFilter || memorySessionFilter || memorySourceFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
            <small className="assistant-scope-note">当前范围在全文/向量召回之前生效，范围外内容不会参与排序或发送给模型。
              {memorySearchState.scopeCandidates !== null && memorySearchState.scopeCandidates !== undefined &&
                ` · 当前候选 ${Number(memorySearchState.scopeCandidates || 0).toLocaleString()} 条`}
            </small>}
          {(!!memoryQuery.trim() || hasMemoryScope) && <div className="assistant-search-results">
            {['waiting', 'searching'].includes(memorySearchState.status) &&
              <div className="assistant-search-status">正在{memorySearchState.query ? `检索“${memorySearchState.query}”` : '浏览当前范围'}… 当前区域只会接受这次请求的结果。</div>}
            {memorySearchState.status === 'ready' &&
              <div className="assistant-search-status ready">
                {memorySearchState.query ? `“${memorySearchState.query}”` : '当前范围'} · 已显示 {memoryResults.length} / {Number(memorySearchState.total || 0)} 条
                {memorySearchState.truncated ? ' · 排序池已达 500 条上限' : ''}
              </div>}
            {memorySearchState.status === 'error' &&
              <div className="assistant-search-status error">“{memorySearchState.query}”检索失败：{memorySearchState.error}</div>}
            {memorySearchFeedback.length > 0 && <details className="assistant-search-feedback-ledger">
              <summary>本查询的相关性反馈（{memorySearchFeedback.length}）</summary>
              <small>反馈只影响完全相同的查询与当前人物、会话、来源、类型和时间范围；原记忆及其可信状态不会改变。</small>
              <div className="assistant-search-feedback-list">
                {memorySearchFeedback.map((feedback: any) => <div key={feedback.id}>
                  <span>{feedback.action === 'helpful' ? '有用' : '无关'} · {feedback.documentTitle || feedback.documentId}</span>
                  <small>{feedback.documentType || '记忆'} · {new Date(feedback.createdAt).toLocaleString('zh-CN')}</small>
                  <button
                    disabled={Boolean(memorySearchFeedbackSaving)}
                    onClick={() => void updateMemorySearchFeedback(feedback.documentId, 'cleared')}>
                    {memorySearchFeedbackSaving === `${feedback.documentId}:cleared` ? '正在撤销…' : '撤销'}
                  </button>
                </div>)}
              </div>
            </details>}
            {groupedMemoryResults.map(group => <section className="assistant-search-result-group" key={group.type}>
              <div className="assistant-search-result-group-heading">
                <strong>{group.label}</strong><span>{group.results.length} 条</span>
              </div>
              <div className="assistant-search-result-grid">{group.results.map(result => {
              const resultStatus = ['claim', 'relation', 'event'].includes(result.document_type)
                ? result.metadata?.status
                : ''
              const statusLabel = resultStatus === 'confirmed' ? '已确认'
                : resultStatus === 'candidate' ? '待确认'
                  : resultStatus === 'cancelled' ? '已取消'
                    : '原始资料'
              const evidence: MemoryEvidence[] = (result.evidence || []).map(normalizeMemoryEvidence)
              const evidenceTotal = Math.max(evidence.length, Number(result.evidenceTotal || 0))
              return <article key={result.id}>
              <span>{MEMORY_TYPE_LABELS[result.document_type] || result.document_type}
                {result.match_source ? ` · ${result.match_source}匹配` : ''}
                {result.match_reason === 'pinyin_entity' ? ' · 拼音命中' : result.match_reason === 'fuzzy_entity' ? ' · 名称近似召回' : result.match_reason === 'entity_alias_or_account' ? ' · 别名/微信 ID 命中' : ''}
                {result.semantic_score ? ` · ${Math.round(result.semantic_score * 100)}%` : ''}
                {result.semantic_search_mode === 'ann' ? ' · ANN 召回' : result.semantic_search_mode === 'exact' ? ' · 精确向量召回' : ''}
              </span>
              <small className={`assistant-memory-trust ${resultStatus || 'source'}`}>{statusLabel}{resultStatus === 'candidate' ? ' · 不能作为已确认事实回答' : resultStatus === 'cancelled' ? ' · 仅作历史记录' : ''}</small>
              <strong>{result.title}</strong><p>{result.search_text}</p>
              <div className="assistant-search-feedback-actions">
                <button
                  className={result.relevance_feedback === 'helpful' ? 'active' : ''}
                  disabled={Boolean(memorySearchFeedbackSaving)}
                  onClick={() => void updateMemorySearchFeedback(result.id, 'helpful')}>
                  {memorySearchFeedbackSaving === `${result.id}:helpful` ? '记录中…' : '有用'}
                </button>
                <button
                  className={result.relevance_feedback === 'not_relevant' ? 'active' : ''}
                  disabled={Boolean(memorySearchFeedbackSaving)}
                  onClick={() => void updateMemorySearchFeedback(result.id, 'not_relevant')}>
                  {memorySearchFeedbackSaving === `${result.id}:not_relevant` ? '记录中…' : '与本次检索无关'}
                </button>
                {result.relevance_feedback && <button
                  disabled={Boolean(memorySearchFeedbackSaving)}
                  onClick={() => void updateMemorySearchFeedback(result.id, 'cleared')}>撤销反馈</button>}
                {result.relevance_feedback && <small>
                  已按你的反馈{result.relevance_feedback === 'helpful' ? '保守提升' : '保守降低'}本查询排序
                </small>}
              </div>
              <details className="assistant-search-evidence">
                <summary>{evidence.length
                  ? evidenceTotal > evidence.length
                    ? `核验原始证据（最近 ${evidence.length} / 共 ${evidenceTotal} 条）`
                    : `核验原始证据（${evidenceTotal} 条）`
                  : '暂无可展开的原始证据'}</summary>
                {evidence.length
                  ? <div>{evidence.map((item, index) => {
                    const localMessageId = evidenceLocalMessageId(item)
                    return <blockquote key={`${item.sourceId}-${item.sessionId}-${item.messageId}-${index}`}>
                      <header>
                        <span>{memoryEvidenceSourceLabel(item)} · {item.sender || '原文'}{item.timestamp ? ` · ${new Date(item.timestamp * 1000).toLocaleString('zh-CN')}` : ''}</span>
                        {item.sessionId && localMessageId && <button onClick={() =>
                          void window.electronAPI.window.openChatHistoryWindow(item.sessionId, localMessageId)}>打开原消息</button>}
                      </header>
                      <p>“{item.excerpt || '原文摘录为空'}”</p>
                      {item.role && item.role !== 'support' && <small>{
                        item.role === 'direct' ? '直接证据' : item.role === 'indirect' ? '间接证据' : item.role === 'contradiction' ? '反证' : item.role
                      }</small>}
                    </blockquote>
                  })}
                    {evidenceTotal > evidence.length &&
                      <p className="assistant-evidence-limit-note">当前显示最近 {evidence.length} 条，共有 {evidenceTotal} 条去重原文证据；可结合来源、人物和时间范围继续检索。</p>}
                    <button className="assistant-open-evidence-archive" onClick={() =>
                      void openMemoryEvidenceArchive(result.document_type, result.source_id, result.title)}>
                      查看完整证据档案
                    </button>
                  </div>
                  : <p>该结果只能作为检索线索，不能单独支撑事实结论。</p>}
              </details>
            </article>})}</div>
            </section>)}
            {memorySearchState.status === 'ready' && !memoryResults.length && <div className="assistant-empty">没有找到相关记忆。</div>}
            {memorySearchState.status === 'ready' && memorySearchState.hasMore &&
              <button className="assistant-search-load-more" onClick={() => void loadMoreMemoryResults()} disabled={memoryLoadingMore}>
                {memoryLoadingMore ? '正在加载下一页…' : '加载更多结果'}
              </button>}
          </div>}
          <details
            className="assistant-search-feedback-archive"
            open={memoryFeedbackArchiveOpen}
            onToggle={event => setMemoryFeedbackArchiveOpen(event.currentTarget.open)}>
            <summary>检索反馈历史档案</summary>
            {memoryFeedbackArchiveOpen && <>
              <small>这里保留每次设置、改判和撤销；目录按需从本机 SQLCipher 加载，不进入模型上下文。</small>
              <div className="assistant-search-feedback-archive-filters">
                <input
                  value={memoryFeedbackArchiveQuery}
                  onChange={event => setMemoryFeedbackArchiveQuery(event.target.value)}
                  placeholder="搜索原查询、结果标题或记忆 ID"
                />
                <select value={memoryFeedbackArchiveAction} onChange={event =>
                  setMemoryFeedbackArchiveAction(event.target.value as 'helpful' | 'not_relevant' | 'cleared' | '')}>
                  <option value="">全部动作</option>
                  <option value="helpful">设为有用</option>
                  <option value="not_relevant">设为无关</option>
                  <option value="cleared">撤销反馈</option>
                </select>
                <input type="date" value={memoryFeedbackArchiveFrom} onChange={event => setMemoryFeedbackArchiveFrom(event.target.value)} />
                <input type="date" value={memoryFeedbackArchiveTo} onChange={event => setMemoryFeedbackArchiveTo(event.target.value)} />
              </div>
              <div className="assistant-search-feedback-archive-status">
                {memoryFeedbackArchive.status === 'loading'
                  ? '正在读取反馈档案…'
                  : memoryFeedbackArchive.status === 'error'
                    ? `读取失败：${memoryFeedbackArchive.error || '未知错误'}`
                    : `已显示 ${memoryFeedbackArchive.items.length} / ${memoryFeedbackArchive.total} 条 · 有用 ${Number(memoryFeedbackArchive.counts?.helpful || 0)} · 无关 ${Number(memoryFeedbackArchive.counts?.not_relevant || 0)} · 撤销 ${Number(memoryFeedbackArchive.counts?.cleared || 0)}`}
              </div>
              {memoryFeedbackArchive.status === 'ready' && memoryFeedbackArchive.total > 0 &&
                <div className="assistant-search-feedback-archive-purge">
                  <span>检索词和范围属于本机敏感历史，可按当前筛选永久清理。</span>
                  <button className="danger" onClick={() => void openMemoryFeedbackDeletion()}>
                    {memoryFeedbackArchiveAction || memoryFeedbackArchiveQuery.trim() ||
                    memoryFeedbackArchiveFrom || memoryFeedbackArchiveTo
                      ? '永久清理当前筛选'
                      : '永久清理全部反馈'}
                  </button>
                </div>}
              <div className="assistant-search-feedback-archive-list">
                {(memoryFeedbackArchive.items || []).map((item: any) => {
                  const scope = item.scope || {}
                  const scopeLabels = [
                    scope.entityId ? `人物 ${scope.entityId}` : '',
                    scope.sessionId ? `会话 ${scope.sessionId}` : '',
                    (scope.sourceIds || []).length ? `来源 ${(scope.sourceIds || []).join('、')}` : '',
                    (scope.documentTypes || []).length ? `类型 ${(scope.documentTypes || []).join('、')}` : '',
                    scope.from || scope.to ? `时间 ${scope.from || '不限'} → ${scope.to || '不限'}` : ''
                  ].filter(Boolean)
                  const actionLabel = item.action === 'helpful' ? '设为有用'
                    : item.action === 'not_relevant' ? '设为无关'
                      : '撤销反馈'
                  return <article key={item.id}>
                    <header>
                      <span>{actionLabel} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                      <small>{item.isCurrent
                        ? item.currentAction === 'cleared' ? '当前无有效反馈' : '当前有效'
                        : `历史动作 · 当前${item.currentAction === 'helpful' ? '有用' : item.currentAction === 'not_relevant' ? '无关' : '已撤销'}`}</small>
                    </header>
                    <strong>{item.documentTitle || item.documentId}</strong>
                    <p>查询：“{item.queryText || '范围浏览'}”</p>
                    <small>{scopeLabels.length ? scopeLabels.join(' · ') : '全部范围'} · {item.documentType || '记忆'}</small>
                    <div>
                      {item.isCurrent && item.action !== 'cleared' && <button
                        disabled={Boolean(memorySearchFeedbackSaving)}
                        onClick={() => void updateMemorySearchFeedback(item.documentId, 'cleared', {
                          query: item.queryText,
                          options: scope
                        })}>撤销当前反馈</button>}
                      {!item.isCurrent && item.action !== 'cleared' && <button
                        disabled={Boolean(memorySearchFeedbackSaving)}
                        onClick={() => void updateMemorySearchFeedback(item.documentId, item.action, {
                          query: item.queryText,
                          options: scope
                        })}>重新设为{item.action === 'helpful' ? '有用' : '无关'}</button>}
                      <button className="danger" onClick={() => void openMemoryFeedbackDeletion(item.id)}>
                        永久删除这组反馈
                      </button>
                    </div>
                  </article>
                })}
              </div>
              {memoryFeedbackArchive.status === 'ready' && !memoryFeedbackArchive.items.length &&
                <div className="assistant-empty">当前筛选下没有检索反馈。</div>}
              {memoryFeedbackArchive.hasMore && <button
                className="assistant-search-load-more"
                disabled={memoryFeedbackArchiveLoadingMore}
                onClick={() => void loadMoreMemoryFeedbackArchive()}>
                {memoryFeedbackArchiveLoadingMore ? '正在加载…' : '加载更多反馈'}
              </button>}
            </>}
          </details>
        </section>

        <section className="assistant-panel assistant-memory-chat">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">EVIDENCE Q&A</span><h3><Bot size={16} /> 向个人记忆提问</h3></div>
            <button onClick={startNewMemoryConversation}>新对话</button>
          </div>
          <details className="assistant-answer-review-archive"
            open={assistantAnswerReviewsOpen}
            onToggle={event => setAssistantAnswerReviewsOpen(event.currentTarget.open)}>
            <summary>
              历史回答核验队列
              {Number(dashboard?.assistantArchive?.answerDependencies?.messages || 0) > 0 &&
                <small>逐回答检查，不遗漏同一会话里的多条变化</small>}
            </summary>
            {assistantAnswerReviewsOpen && <>
              <div className="assistant-answer-review-filters">
                <select value={assistantAnswerReviewState}
                  onChange={event => setAssistantAnswerReviewState(event.target.value)}>
                  <option value="pending">待处理</option>
                  <option value="resolved">已知晓</option>
                  <option value="all">全部审阅状态</option>
                </select>
                <select value={assistantAnswerReviewStatus}
                  onChange={event => setAssistantAnswerReviewStatus(event.target.value)}>
                  <option value="attention">需要处理</option>
                  <option value="invalid">已失去支持</option>
                  <option value="needs_review">旧版待核验</option>
                  <option value="current">当前有效</option>
                  <option value="all">全部有依赖回答</option>
                </select>
                <input value={assistantAnswerReviewQuery}
                  onChange={event => setAssistantAnswerReviewQuery(event.target.value)}
                  placeholder="搜索问题、回答或会话标题" />
                <input type="date" value={assistantAnswerReviewFrom}
                  onChange={event => setAssistantAnswerReviewFrom(event.target.value)} />
                <input type="date" value={assistantAnswerReviewTo}
                  onChange={event => setAssistantAnswerReviewTo(event.target.value)} />
              </div>
              <small>
                待处理 {Number(assistantAnswerReviews.counts?.pending || 0)} ·
                已知晓 {Number(assistantAnswerReviews.counts?.resolved || 0)} ·
                需要处理总计 {Number(assistantAnswerReviews.counts?.attention || 0)} ·
                已失去支持 {Number(assistantAnswerReviews.counts?.invalid || 0)} ·
                旧版待核验 {Number(assistantAnswerReviews.counts?.needs_review || 0)} ·
                当前有效 {Number(assistantAnswerReviews.counts?.current || 0)}
              </small>
              <div className="assistant-answer-review-list">
                {(assistantAnswerReviews.items || []).map((item: any) => <article key={item.message_id}>
                  <header>
                    <b>{item.revalidation_status === 'invalid' ? '⚠ 已失去支持'
                      : item.revalidation_status === 'needs_review' ? '△ 需要重新核验' : '✓ 当前有效'}</b>
                    <span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
                  </header>
                  <strong>{item.question_preview || item.conversation_title}</strong>
                  <p>{item.answer_preview}</p>
                  <small>
                    {item.conversation_title} · 支持 {Number(item.supported_statements || 0)} /
                    共 {Number(item.total_statements || 0)} 条陈述
                    {Number(item.invalid_statements || 0)
                      ? ` · 失效 ${Number(item.invalid_statements)}`
                      : ''}
                    {Number(item.unknown_statements || 0)
                      ? ` · 指纹未知 ${Number(item.unknown_statements)}`
                      : ''}
                  </small>
                  <div>
                    <button onClick={() => void openMemoryConversation(
                      item.conversation_id,
                      item.message_id
                    )}>打开这一轮并核验</button>
                    {Number(item.review_decision_count || 0) > 0 && <button
                      onClick={() => void toggleAssistantAnswerReviewHistory(item.message_id)}>
                      {assistantAnswerReviewHistories[item.message_id] ? '收起处理记录' :
                        `处理记录 ${Number(item.review_decision_count)}`}
                    </button>}
                    {item.review_state === 'resolved'
                      ? <button disabled={assistantAnswerReviewSaving === item.message_id}
                        onClick={() => void reviewAssistantAnswer(item.message_id, 'reopened')}>
                        重新加入待处理
                      </button>
                      : item.revalidation_status !== 'current' && <button
                        disabled={assistantAnswerReviewSaving === item.message_id}
                        onClick={() => void reviewAssistantAnswer(item.message_id, 'acknowledged')}>
                        {assistantAnswerReviewSaving === item.message_id ? '保存中…' : '已知晓，仅保留历史'}
                      </button>}
                  </div>
                  {assistantAnswerReviewHistories[item.message_id] && <section
                    className="assistant-answer-review-history">
                    {(assistantAnswerReviewHistories[item.message_id].items || []).map((decision: any) =>
                      <div key={decision.id}>
                        <span>{decision.action === 'acknowledged'
                          ? '已知晓，仅保留历史' : '重新加入待处理'}</span>
                        <time>{new Date(decision.created_at).toLocaleString('zh-CN')}</time>
                        {decision.is_latest ? <em>最近动作</em> : null}
                      </div>)}
                    {assistantAnswerReviewHistories[item.message_id].error &&
                      <small>{assistantAnswerReviewHistories[item.message_id].error}</small>}
                    {assistantAnswerReviewHistories[item.message_id].loading &&
                      <small>正在读取处理记录…</small>}
                    {assistantAnswerReviewHistories[item.message_id].hasMore &&
                      !assistantAnswerReviewHistories[item.message_id].loading && <button
                        onClick={() => void loadMoreAssistantAnswerReviewHistory(item.message_id)}>
                        加载更早记录
                      </button>}
                  </section>}
                </article>)}
              </div>
              {assistantAnswerReviews.loading && <div className="assistant-empty">正在读取逐回答核验档案…</div>}
              {!assistantAnswerReviews.loading && !assistantAnswerReviews.items?.length &&
                <div className="assistant-empty">当前筛选下没有回答。</div>}
              {assistantAnswerReviews.hasMore && <button
                className="assistant-search-load-more"
                disabled={assistantAnswerReviewsLoadingMore}
                onClick={() => void loadMoreAssistantAnswerReviews()}>
                {assistantAnswerReviewsLoadingMore ? '正在加载…' : '加载更多回答'}
              </button>}
            </>}
          </details>
          <div className="assistant-conversation-layout">
            <aside className="assistant-conversation-list">
              <strong>本机历史 · {assistantArchive.total}</strong>
              <input
                value={assistantArchiveQuery}
                onChange={event => setAssistantArchiveQuery(event.target.value)}
                placeholder="搜索问题或回答"
              />
              <select value={assistantArchiveRevalidation}
                onChange={event => setAssistantArchiveRevalidation(event.target.value)}>
                <option value="">全部核验状态</option>
                <option value="invalid">已失去证据支持</option>
                <option value="needs_review">需要重新核验</option>
                <option value="current">当前证据有效</option>
                <option value="not_applicable">无事实陈述/旧版无依赖</option>
              </select>
              <div className="assistant-conversation-date-filter">
                <label>从<input type="date" value={assistantArchiveFrom}
                  onChange={event => setAssistantArchiveFrom(event.target.value)} /></label>
                <label>到<input type="date" value={assistantArchiveTo}
                  onChange={event => setAssistantArchiveTo(event.target.value)} /></label>
              </div>
              {dashboard?.assistantArchive?.directory === 'paginated_on_demand' && <small>
                会话和消息按需从 SQLCipher 读取，不进入首页轮询载荷。
              </small>}
              {dashboard?.assistantArchive?.citationStorage?.policy === 'reference_only_authoritative_hydration' && <small>
                引用只保存记忆身份，原文打开历史时从权威记忆按需读取；
                已净化 {Number(dashboard.assistantArchive.citationStorage.citationsCompacted || 0)} 条旧引用，
                释放约 {(Number(dashboard.assistantArchive.citationStorage.bytesReclaimed || 0) / 1024).toFixed(1)} KB。
              </small>}
              {dashboard?.assistantArchive?.exchangeIntegrity?.policy === 'atomic_exchange_v1' && <small>
                每次问题与回答由 SQLCipher 单事务提交；已配对
                {' '}{Number(dashboard.assistantArchive.exchangeIntegrity.pairedExchanges || 0).toLocaleString()} 个完整回合。
                {!!Number(dashboard.assistantArchive.exchangeIntegrity.unmatchedMessages || 0) &&
                  ` 检测到 ${Number(dashboard.assistantArchive.exchangeIntegrity.unmatchedMessages).toLocaleString()} 条旧版未配对消息，仅保留为历史，不会冒充完整回合。`}
              </small>}
              {dashboard?.assistantArchive?.answerDependencies?.policy === 'statement_dependency_index_v1' && <small>
                已建立 {Number(dashboard.assistantArchive.answerDependencies.statements || 0).toLocaleString()} 条陈述、
                {Number(dashboard.assistantArchive.answerDependencies.dependencies || 0).toLocaleString()} 项轻量引用依赖；
                目录核验不加载回答正文或原文。
              </small>}
              {assistantConversations.map(conversation => <button
                className={memoryConversationId === conversation.id ? 'active' : ''}
                key={conversation.id}
                onClick={() => void openMemoryConversation(
                  conversation.id,
                  conversation.revalidation_target_message_id || ''
                )}>
                <b>{conversation.title}</b>
                <span>{Number(conversation.message_count || 0)} 条消息 · {new Date(conversation.updated_at).toLocaleString('zh-CN')}</span>
                <small>{conversation.revalidation_status === 'invalid'
                  ? `⚠ 已失去支持 · ${Number(conversation.revalidation_invalid_statements || 0)} 条陈述`
                  : conversation.revalidation_status === 'needs_review'
                    ? `△ 需要复核 · ${Number(conversation.revalidation_unknown_statements || 0)} 条旧陈述`
                    : conversation.revalidation_status === 'current'
                      ? `✓ 当前有效 · ${Number(conversation.revalidation_supported_statements || 0)} 条陈述`
                      : '无事实陈述或旧版未建立依赖'}</small>
                <small>{conversation.preview}</small>
              </button>)}
              {assistantArchive.loading && <small>正在读取本机问答档案…</small>}
              {!assistantArchive.loading && !assistantConversations.length && <small>
                {assistantArchiveQuery || assistantArchiveFrom || assistantArchiveTo || assistantArchiveRevalidation
                  ? '没有符合筛选条件的问答记录。'
                  : '还没有本地问答记录。'}
              </small>}
              {assistantArchive.hasMore && <button onClick={() => void loadMoreAssistantConversations()}
                disabled={assistantArchiveLoadingMore}>
                {assistantArchiveLoadingMore ? '正在加载…' : '加载更早会话'}
              </button>}
            </aside>
            <div className="assistant-conversation-thread">
              {memoryConversation?.anchorFound && memoryConversation?.hasNewer && <small>
                已直接定位到需要核验的回答；这段会话还有 {Number(memoryConversation.offset || 0)} 条更新消息未显示。
                <button onClick={() => void openMemoryConversation(memoryConversation.id)}>返回最新消息</button>
              </small>}
              {memoryConversation?.hasOlder && <button onClick={() => void loadOlderAssistantMessages()}
                disabled={assistantMessagesLoadingMore}>
                {assistantMessagesLoadingMore
                  ? '正在读取更早消息…'
                  : `加载更早消息（当前 ${memoryConversation.messages?.length || 0} / ${memoryConversation.total || 0}）`}
              </button>}
              {memoryConversation?.messages?.map((item: any) => <article className={item.role} key={item.id}>
                <span>{item.role === 'user' ? '你' : 'AI 助理'} · {new Date(item.created_at).toLocaleString('zh-CN')}</span>
                <p>{item.content}</p>
                {item.role === 'assistant' && !!item.citations?.length && <button onClick={() => {
                  const messages = memoryConversation.messages || []
                  const index = messages.findIndex((message: any) => message.id === item.id)
                  const question = [...messages.slice(0, index)].reverse().find((message: any) => message.role === 'user')
                  setMemoryAnswer({
                    conversationId: memoryConversation.id,
                    assistantMessageId: item.id,
                    question: question?.content || memoryConversation.title,
                    answer: item.content,
                    citations: item.citations,
                    groundingAudit: item.groundingAudit,
                    groundingRevalidation: item.groundingRevalidation,
                    groundedStatements: String(item.content || '').split(/\n{2,}/)
                      .map((text: string, statementIndex: number) => ({
                        text,
                        citationIds: item.groundingAudit?.statementCitations?.[statementIndex] || []
                      })),
                    uncertainty: ''
                  })
                }}>查看 {item.citations.length} 条引用</button>}
                {item.role === 'assistant' && item.groundingAudit?.version === 'statement-citations-v1' && <small>
                  逐条证据门禁：接受 {Number(item.groundingAudit.acceptedStatements || 0)} 条
                  {Number(item.groundingAudit.rejectedStatements || 0)
                    ? `，拦截 ${Number(item.groundingAudit.rejectedStatements)} 条无合格引用陈述`
                    : ''}
                </small>}
                {item.role === 'assistant' && item.groundingRevalidation?.status !== 'current' && <small>
                  {item.groundingRevalidation?.status === 'invalid'
                    ? `历史结论已失去当前证据支持（${Number(item.groundingRevalidation.invalidStatements || 0)} 条）`
                    : `历史结论需要重新核验（变化/未知 ${Number(item.groundingRevalidation.invalidStatements || 0) + Number(item.groundingRevalidation.unknownStatements || 0)} 条）`}
                </small>}
              </article>)}
              {!memoryConversation && <div className="assistant-empty">新对话会在首次回答后加密保存；重启后可以从左侧继续。</div>}
            </div>
          </div>
          {memoryConversationId && <div className="assistant-conversation-controls">
            <small>后续追问会携带最近 8 条对话帮助理解指代；历史回答不能作为事实证据，结论仍须重新引用本次检索原文。</small>
            <button className="danger" onClick={() => void deleteMemoryConversation()}>删除这段历史</button>
          </div>}
          <div className="assistant-memory-question">
            <input value={memoryQuestion} onChange={event => setMemoryQuestion(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter') void askMemory()
            }} placeholder="例如：我和 Onyx Devs Lab 是什么关系？" />
            <button className="primary" onClick={() => void askMemory()} disabled={askingMemory || !memoryQuestion.trim()}>{askingMemory ? '正在检索…' : '提问'}</button>
          </div>
          {memoryAnswer && <div className="assistant-memory-answer">
            <p>{memoryAnswer.answer}</p>
            {!!memoryAnswer.groundedStatements?.length && <div className="assistant-grounded-statements">
              {memoryAnswer.groundedStatements.map((statement: any, statementIndex: number) => <article
                key={`${statementIndex}-${statement.text}`}>
                <span>{statement.text}</span>
                {memoryAnswer.groundingRevalidation?.statements?.[statementIndex]?.status !== 'current' && <small>
                  {memoryAnswer.groundingRevalidation?.statements?.[statementIndex]?.status === 'invalid'
                    ? '⚠ 这条历史陈述引用的记忆已经变化、失效或被删除，请重新提问。'
                    : '△ 这条旧陈述生成时尚未保存内容指纹，当前只能核验来源仍存在，不能证明内容未变化。'}
                </small>}
                <small>
                  依据：{(statement.citationIds || []).map((documentId: string) => {
                    const citationIndex = (memoryAnswer.citations || [])
                      .findIndex((citation: any) => citation.documentId === documentId)
                    const citation = (memoryAnswer.citations || [])[citationIndex]
                    return citation
                      ? `[${citationIndex + 1}] ${citation.title}`
                      : documentId
                  }).join(' · ') || '无合格引用'}
                </small>
              </article>)}
            </div>}
            {memoryAnswer.groundingAudit?.version === 'statement-citations-v1' && <small>
              可信回答门禁：{Number(memoryAnswer.groundingAudit.acceptedStatements || 0)} 条陈述逐条通过原文引用核验；
              {Number(memoryAnswer.groundingAudit.rejectedStatements || 0)
                ? ` 已拦截 ${Number(memoryAnswer.groundingAudit.rejectedStatements)} 条无合格引用陈述。`
                : ' 没有发现无合格引用陈述。'}
              {' '}聊天、邮件和文档内容均按不可信数据隔离，不会被当作模型指令执行。
            </small>}
            {memoryAnswer.groundingRevalidation?.status === 'current' && <small className="assistant-grounding-current">
              当前重新核验：{Number(memoryAnswer.groundingRevalidation.supportedStatements || 0)} 条陈述的权威内容指纹和可信资格均未变化。
            </small>}
            {memoryAnswer.groundingRevalidation?.status === 'needs_review' && <small className="assistant-grounding-warning">
              这段历史回答需要重新核验：{Number(memoryAnswer.groundingRevalidation.invalidStatements || 0)} 条已失去支持，
              {Number(memoryAnswer.groundingRevalidation.unknownStatements || 0)} 条旧记录缺少回答时内容指纹。建议用原问题重新提问。
            </small>}
            {memoryAnswer.groundingRevalidation?.status === 'invalid' && <small className="assistant-grounding-invalid">
              这段历史回答已没有当前有效证据支持，仅作为历史文本保留；请勿据此行动，建议重新提问。
            </small>}
            {memoryAnswer.uncertainty && <small>不确定性：{memoryAnswer.uncertainty}</small>}
            {!!memoryAnswer.sensitiveRedaction?.total && <small>
              本次发送前已本地脱敏 {memoryAnswer.sensitiveRedaction.total} 处：
              {Object.entries(memoryAnswer.sensitiveRedaction.counts || {}).map(([type, count]) => `${type} ${count}`).join('、')}
            </small>}
            {!!memoryAnswer.queryPlan?.explanation?.length && <details className="assistant-query-plan">
              <summary>查看本次查询规划</summary>
              <div>{memoryAnswer.queryPlan.explanation.map((item: string) => <span key={item}>{item}</span>)}</div>
            </details>}
            <div className="assistant-memory-answer-actions">
              {memoryAnswer.groundingRevalidation && memoryAnswer.groundingRevalidation.status !== 'current' &&
                <button onClick={() => setMemoryQuestion(String(memoryAnswer.question || ''))}>
                  <RefreshCw size={13} /> 用原问题重新提问
                </button>}
              <button onClick={() => void createTaskFromMemory()} disabled={
                creatingMemoryTask ||
                Boolean(memoryAnswer.createdTaskId) ||
                (memoryAnswer.groundingRevalidation && memoryAnswer.groundingRevalidation.status !== 'current')
              }>
                <Check size={13} /> {memoryAnswer.createdTaskId ? '已生成待办' : creatingMemoryTask ? '正在生成…' : '生成待办'}
              </button>
            </div>
            {!!memoryAnswer.citations?.length && <div className="assistant-citations">
              {memoryAnswer.citations.map((citation: any) => <article key={citation.documentId}>
                <button className="assistant-citation-locate" onClick={() => {
                  setMemoryQuery(citation.title)
                  setMemoryTypeFilter(citation.type)
                }}>定位到检索</button>
                <strong>{citation.title}</strong><span>{citation.type} · {citation.trustLabel || (citation.status === 'confirmed' ? '已确认' : '原始资料')}</span><p>{citation.content}</p>
                {citation.citationUnavailable && <small className="assistant-evidence-limit-note">
                  引用指向的权威记忆已删除或不再存在；历史回答仍保留，但不会展示旧原文副本。
                </small>}
                {citation.citationHydration === 'authoritative_scope_unknown' && !citation.citationUnavailable &&
                  <small className="assistant-evidence-limit-note">
                    此旧回答未保存当轮检索范围；当前展示的是权威记忆中的最新证据，不冒充回答生成时的证据快照。
                  </small>}
                {citation.answerTimeTitle && citation.answerTimeTitle !== citation.title &&
                  <small className="assistant-evidence-limit-note">
                    回答生成时标题：“{citation.answerTimeTitle}”；当前权威标题已更新。
                  </small>}
                {citation.citationContentChanged && <small className="assistant-evidence-limit-note">
                  回答生成后，这条权威记忆的结构化内容已经被纠正或更新；它不再自动支持旧回答中的原陈述。
                </small>}
                {citation.citationFreshness === 'ineligible' && <small className="assistant-evidence-limit-note">
                  这条记忆当前已被拒绝、取消或缺少合格原文，不能继续支持历史事实结论。
                </small>}
                {Number(citation.evidenceTotal || 0) > (citation.evidence || []).length &&
                  <small className="assistant-evidence-limit-note">
                    本次回答核验了最近 {(citation.evidence || []).length} / 共 {Number(citation.evidenceTotal)} 条去重原文证据
                  </small>}
                {(citation.evidence || []).map((rawEvidence: any, index: number) => {
                  const evidence = normalizeMemoryEvidence(rawEvidence)
                  const localMessageId = evidenceLocalMessageId(evidence)
                  return <small className="assistant-citation-evidence" key={`${evidence.sourceId}-${evidence.sessionId}-${evidence.messageId}-${index}`}>
                    <span>{memoryEvidenceSourceLabel(evidence)} · {evidence.sender || '原文'}{evidence.timestamp ? ` · ${new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}` : ''}：“{evidence.excerpt}”</span>
                    {evidence.sessionId && localMessageId && <button onClick={() =>
                      void window.electronAPI.window.openChatHistoryWindow(evidence.sessionId, localMessageId)}>打开原消息</button>}
                  </small>
                })}
                {!!citation.evidence?.length && !!citation.sourceId && <button className="assistant-open-evidence-archive" onClick={() =>
                  void openMemoryEvidenceArchive(citation.type, citation.sourceId, citation.title)}>
                  查看完整证据档案
                </button>}
                {citation.feedbackContext && !citation.citationUnavailable && <div className="assistant-citation-feedback">
                  <small>这项判断只影响生成本回答时的同一问题和检索范围，不改变记忆真实性。</small>
                  <button
                    className={citation.relevanceFeedback === 'helpful' ? 'active' : ''}
                    disabled={Boolean(memorySearchFeedbackSaving)}
                    onClick={() => void updateMemorySearchFeedback(citation.documentId, 'helpful', citation.feedbackContext)}>
                    {memorySearchFeedbackSaving === `${citation.documentId}:helpful` ? '记录中…' : '这条引用有帮助'}
                  </button>
                  <button
                    className={citation.relevanceFeedback === 'not_relevant' ? 'active' : ''}
                    disabled={Boolean(memorySearchFeedbackSaving)}
                    onClick={() => void updateMemorySearchFeedback(citation.documentId, 'not_relevant', citation.feedbackContext)}>
                    {memorySearchFeedbackSaving === `${citation.documentId}:not_relevant` ? '记录中…' : '这条引用不相关'}
                  </button>
                  {citation.relevanceFeedback && <button
                    disabled={Boolean(memorySearchFeedbackSaving)}
                    onClick={() => void updateMemorySearchFeedback(citation.documentId, 'cleared', citation.feedbackContext)}>
                    撤销引用反馈
                  </button>}
                </div>}
                {!citation.feedbackContext && <small className="assistant-evidence-limit-note">
                  此历史回答生成于引用反馈功能上线前，未保存当轮检索范围。
                </small>}
                {!citation.citationUnavailable && ['relation', 'claim', 'event'].includes(citation.type) && <div className="assistant-citation-actions">
                  {citation.type === 'claim' && <button onClick={() => openClaimCorrection(citation)}>纠正事实</button>}
                  {citation.type === 'event' && <button onClick={() => void openEventCorrection(citation)}>纠正事件</button>}
                  {citation.status !== 'confirmed' && <button className="primary" onClick={() => void reviewMemoryCitation(citation, 'confirmed')}>确认</button>}
                  {citation.status !== 'rejected' && <button onClick={() => void reviewMemoryCitation(citation, 'rejected')}>不准确</button>}
                  <button className="danger" onClick={() => void permanentlyDeleteMemoryItem(citation.type, citation)}>永久删除</button>
                </div>}
              </article>)}
            </div>}
          </div>}
        </section>

        <div className="assistant-memory-feed">
          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">STRUCTURED CLAIMS</span><h3><BookOpen size={16} /> 持续积累的事实</h3></div>
              <span className="assistant-count">{claimArchive.total} 条</span>
            </div>
            <div className="assistant-memory-scope assistant-event-scope">
              <TrustedEntityPicker
                value={claimEntityFilter}
                selected={claimEntitySelection}
                placeholder="搜索人物或实体范围…"
                ariaLabel="事实档案实体范围"
                onSelect={entity => {
                  setClaimEntitySelection(entity)
                  setClaimEntityFilter(entity.id)
                }}
                onClear={() => {
                  setClaimEntitySelection(null)
                  setClaimEntityFilter('')
                }}
                onError={setMessage} />
              <select value={claimSourceFilter} onChange={event => setClaimSourceFilter(event.target.value)}>
                <option value="">所有来源</option>
                <option value="wechat">微信</option>
                <option value="documents">本机文档</option>
                <option value="calendar">macOS 日历</option>
                <option value="mail">Mail</option>
                <option value="legacy">历史未知来源</option>
              </select>
              <select value={claimStatusFilter} onChange={event => setClaimStatusFilter(event.target.value)}>
                <option value="">有效事实</option>
                <option value="candidate">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="rejected">已标记不准确</option>
              </select>
              <input value={claimPredicateFilter} onChange={event => setClaimPredicateFilter(event.target.value)}
                placeholder="搜索谓词、事实值或关键词" />
              <label><span>有效期从</span><input type="date" value={claimFrom} onChange={event => setClaimFrom(event.target.value)} /></label>
              <label><span>到</span><input type="date" value={claimTo} onChange={event => setClaimTo(event.target.value)} /></label>
              {(claimEntityFilter || claimSourceFilter || claimStatusFilter || claimPredicateFilter || claimFrom || claimTo) &&
                <button onClick={() => {
                  setClaimEntityFilter(''); setClaimEntitySelection(null); setClaimSourceFilter(''); setClaimStatusFilter('')
                  setClaimPredicateFilter(''); setClaimFrom(''); setClaimTo('')
                }}>清除范围</button>}
            </div>
            {dashboard?.memoryFeedPayloadPolicy?.claims === 'paginated_on_demand' && <small className="assistant-evidence">
              当前范围直接从本机 SQLCipher 档案分页读取；显示真实总数，早期事实不会因首页载荷边界而消失。
            </small>}
            <div className="assistant-memory-list">
              {visibleClaims.map((claim: any) => <article className="assistant-memory-item" id={`memory-claim-${claim.id}`} key={claim.id}>
                <div className="assistant-memory-item-head">
                  <strong>{claim.subject_name || '未知主体'} · {claim.predicate}</strong>
                  <span className={claim.status}>{claim.status === 'confirmed' ? '已确认' : claim.status === 'rejected' ? '不准确' : '待确认'}</span>
                </div>
                {editingClaim?.id === claim.id ? <div className="assistant-claim-editor">
                  <input value={editingClaim.value} onChange={event => setEditingClaim({ ...editingClaim, value: event.target.value })} placeholder="正确的事实值" />
                  <input value={editingClaim.validFrom} onChange={event => setEditingClaim({ ...editingClaim, validFrom: event.target.value })} placeholder="生效时间（可选）" />
                  <input value={editingClaim.validTo} onChange={event => setEditingClaim({ ...editingClaim, validTo: event.target.value })} placeholder="失效时间（可选）" />
                </div> : <p>{claim.polarity === 'negative' ? '否定：' : ''}{claim.object_entity_name || claim.object_value || '未记录值'}</p>}
                <small>来源：{claim.source_nature === 'self_statement' ? '本人明确陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : claim.source_nature === 'human_confirmation' ? '人工纠正确认' : '模型推断'} · {Math.round(Number(claim.confidence || 0) * 100)}% 可信{claim.conflict_group ? ' · 与其他事实冲突' : ''}</small>
                <small>原始载体：{memorySourceLabels(claim)}
                  {!!claim.correction_count && ` · 人工纠正 ${claim.correction_count} 次${claim.corrected_at ? `（最近 ${new Date(claim.corrected_at).toLocaleString('zh-CN')}）` : ''}`}
                </small>
                {!!claim.review_count && <small>
                  可信状态记录 {claim.review_count} 次 · 最近 {claim.reviewed_at ? new Date(claim.reviewed_at).toLocaleString('zh-CN') : '时间未知'}；
                  {Number(claim.protected_review_count || 0) > 0
                    ? ` 其中 ${claim.protected_review_count} 次决定受重抽取保护，模型只能追加原文。`
                    : ' 当前仅有系统临时调整，不会冻结后续模型更新。'}
                </small>}
                {Number(claim.review_count || 0) + Number(claim.correction_count || 0) > 0 &&
                  <details className="assistant-evidence-details" onToggle={event => {
                    if (event.currentTarget.open && !memoryItemAudits[`claim:${claim.id}`]) {
                      void loadMemoryItemAudit('claim', claim.id)
                    }
                  }}>
                    <summary>
                      查看完整可信审计（{Number(claim.review_count || 0) + Number(claim.correction_count || 0)} 条）
                    </summary>
                    {memoryItemAudits[`claim:${claim.id}`]?.status === 'error' &&
                      <small>审计读取失败：{memoryItemAudits[`claim:${claim.id}`].error}</small>}
                    {memoryItemAudits[`claim:${claim.id}`]?.items &&
                      <MemoryItemAuditRows kind="claim" items={memoryItemAudits[`claim:${claim.id}`].items} />}
                    {memoryItemAuditLoading === `claim:${claim.id}` &&
                      <small>正在读取 SQLCipher 审计账本…</small>}
                    {memoryItemAudits[`claim:${claim.id}`]?.hasMore && <button
                      disabled={memoryItemAuditLoading === `claim:${claim.id}`}
                      onClick={() => void loadMemoryItemAudit('claim', claim.id, true)}>
                      加载更多（已显示 {memoryItemAudits[`claim:${claim.id}`].items.length} /
                      {memoryItemAudits[`claim:${claim.id}`].total}）
                    </button>}
                  </details>}
                {!claimEntitiesTrusted(claim) && <small>涉及的实体尚未确认；请先在图谱候选区确认实体，之后才能确认或纠正此事实。</small>}
                {claim.polarity === 'negative' && <small>该条是对“{claim.predicate}”的明确否定陈述，仍需结合反证人工确认。</small>}
                {(claim.valid_from || claim.valid_to) && <small>有效期：{claim.valid_from || '未知'} — {claim.valid_to || '至今'}</small>}
                <div className="assistant-evidence-stack">
                  <EvidenceRows evidence={claim.evidence} total={claim.evidence_count} roleLabels
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'claim', claim.id, `${claim.subject_name || '未知主体'} · ${claim.predicate}`
                    )} />
                </div>
                <div className="assistant-memory-actions">
                  {editingClaim?.id === claim.id
                    ? <><button onClick={() => setEditingClaim(null)}>取消</button><button className="primary" onClick={() => void saveClaimCorrection()}>保存纠正</button></>
                    : <button disabled={!claimEntitiesTrusted(claim)} title={!claimEntitiesTrusted(claim) ? '请先确认事实涉及的实体' : ''} onClick={() => setEditingClaim({
                      id: claim.id,
                      value: claim.object_entity_name || claim.object_value || '',
                      validFrom: claim.valid_from || '',
                      validTo: claim.valid_to || '',
                      expectedRevision: String(claimArchive.revision || '')
                    })}>纠正</button>}
                  {claim.status !== 'rejected' &&
                    <button onClick={() => void updateMemoryStatus('claim', claim.id, 'rejected')}>不准确</button>}
                  <button onClick={() => void ignoreMemoryItem('claim', claim)}>不重要</button>
                  {claim.status !== 'confirmed' && <button className="primary" disabled={!claimEntitiesTrusted(claim)} title={!claimEntitiesTrusted(claim) ? '请先确认事实涉及的实体' : ''} onClick={() => void updateMemoryStatus('claim', claim.id, 'confirmed')}>{claim.status === 'rejected' ? '恢复并确认' : '确认事实'}</button>}
                  <button className="danger" onClick={() => void permanentlyDeleteMemoryItem('claim', claim)}>永久删除</button>
                </div>
              </article>)}
              {!visibleClaims.length && <div className="assistant-empty">
                {claimArchive.loading ? '正在读取事实档案…' : '当前范围没有事实；后续增量消息会形成带原文证据的记录。'}
              </div>}
            </div>
            {claimArchive.hasMore && <div className="assistant-timeline-more">
              <button disabled={claimLoadingMore} onClick={() => void loadMoreClaims()}>
                {claimLoadingMore ? '正在加载…' : `加载更多（已显示 ${visibleClaims.length}/${claimArchive.total}）`}
              </button>
            </div>}
          </section>

          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">EVENT TIMELINE</span><h3><CalendarDays size={16} /> 事件时间线</h3></div>
              <span className="assistant-count">{eventTimeline.total} 项</span>
            </div>
            <div className="assistant-memory-scope assistant-event-scope">
              <select value={eventSourceFilter} onChange={event => setEventSourceFilter(event.target.value)}>
                <option value="">所有来源</option>
                <option value="wechat">微信</option>
                <option value="documents">本机文档</option>
                <option value="calendar">macOS 日历</option>
                <option value="mail">Mail</option>
                <option value="legacy">历史未知来源</option>
              </select>
              <select value={eventStatusFilter} onChange={event => setEventStatusFilter(event.target.value)}>
                <option value="">所有状态</option>
                <option value="candidate">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="rejected">不准确</option>
                <option value="cancelled">已取消</option>
              </select>
              <label><span>从</span><input type="date" value={eventFrom} onChange={event => setEventFrom(event.target.value)} /></label>
              <label><span>至</span><input type="date" value={eventTo} onChange={event => setEventTo(event.target.value)} /></label>
              {(eventSourceFilter || eventStatusFilter || eventFrom || eventTo) &&
                <button onClick={() => { setEventSourceFilter(''); setEventStatusFilter(''); setEventFrom(''); setEventTo('') }}>清除范围</button>}
            </div>
            <div className="assistant-memory-list">
              {editingEvent && !visibleEvents.some((event: any) => event.id === editingEvent.id) &&
                <article className="assistant-memory-item" id={`memory-event-${editingEvent.id}`}>
                  <div className="assistant-memory-item-head"><strong>正在纠正历史事件</strong><span className="confirmed">人工编辑</span></div>
                  <div className="assistant-event-editor">
                    <input value={editingEvent.title} onChange={event => setEditingEvent({ ...editingEvent, title: event.target.value })} placeholder="事件标题" />
                    <input value={editingEvent.eventType} onChange={event => setEditingEvent({ ...editingEvent, eventType: event.target.value })} placeholder="事件类型" />
                    <textarea value={editingEvent.description} onChange={event => setEditingEvent({ ...editingEvent, description: event.target.value })} placeholder="事件说明" />
                    <input type="datetime-local" value={editingEvent.startAt} onChange={event => setEditingEvent({ ...editingEvent, startAt: event.target.value })} />
                    <input type="datetime-local" value={editingEvent.endAt} onChange={event => setEditingEvent({ ...editingEvent, endAt: event.target.value })} />
                    <input value={editingEvent.location} onChange={event => setEditingEvent({ ...editingEvent, location: event.target.value })} placeholder="地点" />
                  </div>
                  <div className="assistant-memory-actions"><button onClick={() => setEditingEvent(null)}>取消</button><button className="primary" onClick={() => void saveEventCorrection()}>保存并确认</button></div>
                </article>}
              {visibleEvents.map((event: any) => <article className="assistant-memory-item" id={`memory-event-${event.id}`} key={event.id}>
                <div className="assistant-memory-item-head">
                  <strong>{event.title}</strong>
                  <span className={event.status}>{event.status === 'confirmed' ? '已确认' : event.status === 'cancelled' ? '已取消' : '待确认'}</span>
                </div>
                {editingEvent?.id === event.id ? <div className="assistant-event-editor">
                  <input value={editingEvent.title} onChange={input => setEditingEvent({ ...editingEvent, title: input.target.value })} placeholder="事件标题" />
                  <input value={editingEvent.eventType} onChange={input => setEditingEvent({ ...editingEvent, eventType: input.target.value })} placeholder="事件类型" />
                  <textarea value={editingEvent.description} onChange={input => setEditingEvent({ ...editingEvent, description: input.target.value })} placeholder="事件说明" />
                  <input type="datetime-local" value={editingEvent.startAt} onChange={input => setEditingEvent({ ...editingEvent, startAt: input.target.value })} />
                  <input type="datetime-local" value={editingEvent.endAt} onChange={input => setEditingEvent({ ...editingEvent, endAt: input.target.value })} />
                  <input value={editingEvent.location} onChange={input => setEditingEvent({ ...editingEvent, location: input.target.value })} placeholder="地点" />
                </div> : <>
                  {event.description && <p>{event.description}</p>}
                  <small>{event.start_at || '时间待确认'}{event.end_at ? ` — ${event.end_at}` : ''}{event.location ? ` · ${event.location}` : ''}</small>
                </>}
                <small>来源：{memorySourceLabels(event)}</small>
                {!!event.correction_count && <small>人工纠正 {event.correction_count} 次{event.corrected_at ? ` · 最近 ${new Date(event.corrected_at).toLocaleString('zh-CN')}` : ''}；后续自动抽取不会覆盖。</small>}
                {!!event.review_count && <small>
                  可信状态记录 {event.review_count} 次 · 最近 {event.reviewed_at ? new Date(event.reviewed_at).toLocaleString('zh-CN') : '时间未知'}；
                  {Number(event.protected_review_count || 0) > 0
                    ? ` 其中 ${event.protected_review_count} 次决定受重抽取保护，模型只能追加原文。`
                    : ' 当前仅有系统临时调整，不会冻结后续模型更新。'}
                </small>}
                {Number(event.review_count || 0) + Number(event.correction_count || 0) > 0 &&
                  <details className="assistant-evidence-details" onToggle={toggle => {
                    if (toggle.currentTarget.open && !memoryItemAudits[`event:${event.id}`]) {
                      void loadMemoryItemAudit('event', event.id)
                    }
                  }}>
                    <summary>
                      查看完整可信审计（{Number(event.review_count || 0) + Number(event.correction_count || 0)} 条）
                    </summary>
                    {memoryItemAudits[`event:${event.id}`]?.status === 'error' &&
                      <small>审计读取失败：{memoryItemAudits[`event:${event.id}`].error}</small>}
                    {memoryItemAudits[`event:${event.id}`]?.items &&
                      <MemoryItemAuditRows kind="event" items={memoryItemAudits[`event:${event.id}`].items} />}
                    {memoryItemAuditLoading === `event:${event.id}` &&
                      <small>正在读取 SQLCipher 审计账本…</small>}
                    {memoryItemAudits[`event:${event.id}`]?.hasMore && <button
                      disabled={memoryItemAuditLoading === `event:${event.id}`}
                      onClick={() => void loadMemoryItemAudit('event', event.id, true)}>
                      加载更多（已显示 {memoryItemAudits[`event:${event.id}`].items.length} /
                      {memoryItemAudits[`event:${event.id}`].total}）
                    </button>}
                  </details>}
                {!!event.participants?.length && <small>参与者：{event.participants.map((item: any) => `${item.canonical_name}（${item.role}）`).join('、')}</small>}
                {!eventEntitiesTrusted(event) && <small>存在尚未确认的参与实体；请先在图谱候选区确认实体，之后才能确认或纠正此事件。</small>}
                <div className="assistant-evidence-stack">
                  <EvidenceRows evidence={event.evidence} total={event.evidence_count}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'event', event.id, event.title || '事件原文'
                    )} />
                </div>
                <div className="assistant-memory-actions">
                  {editingEvent?.id === event.id
                    ? <><button onClick={() => setEditingEvent(null)}>取消</button><button className="primary" onClick={() => void saveEventCorrection()}>保存并确认</button></>
                    : <button disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => beginEventCorrection(event)}>纠正</button>}
                  {event.status !== 'rejected' && <button onClick={() => void updateMemoryStatus('event', event.id, 'rejected')}>不准确</button>}
                  <button onClick={() => void ignoreMemoryItem('event', event)}>不重要</button>
                  {event.status !== 'confirmed' && <button className="primary" disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => void updateMemoryStatus('event', event.id, 'confirmed')}>{event.status === 'rejected' ? '恢复并确认' : '确认事件'}</button>}
                  <button className="danger" onClick={() => void permanentlyDeleteMemoryItem('event', event)}>永久删除</button>
                </div>
              </article>)}
              {!visibleEvents.length && <div className="assistant-empty">会议、决定、交付和承诺等事件会显示在这里。</div>}
            </div>
            {eventTimeline.hasMore && <div className="assistant-timeline-more">
              <button disabled={eventLoadingMore} onClick={() => void loadMoreEvents()}>
                {eventLoadingMore ? '正在加载…' : `加载更多（已显示 ${visibleEvents.length}/${eventTimeline.total}）`}
              </button>
            </div>}
          </section>

          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">MESSAGE RESOURCES</span><h3><Paperclip size={16} /> 消息资源库</h3></div>
              <span className="assistant-count">{visibleResources.length} / {resourceArchive.total || 0} 项</span>
            </div>
            <div className="assistant-memory-scope">
              <input value={resourceQuery} onChange={event => setResourceQuery(event.target.value)}
                placeholder="搜索标题、文件名、链接或正文" />
              <select value={resourceTypeFilter} onChange={event => setResourceTypeFilter(event.target.value)}>
                <option value="">全部类型</option>
                <option value="link">链接</option><option value="file">文件</option>
                <option value="chat-history">转发记录</option><option value="mini-program">小程序</option>
                <option value="image">图片 OCR</option><option value="voice">语音转写</option>
                <option value="document">本机文档</option>
              </select>
              <select value={resourceSourceFilter} onChange={event => setResourceSourceFilter(
                event.target.value as '' | 'wechat' | 'documents' | 'calendar' | 'mail' | 'legacy'
              )}>
                <option value="">全部来源</option><option value="wechat">微信</option>
                <option value="documents">本机文档</option><option value="calendar">macOS 日历</option>
                <option value="mail">Mail</option><option value="legacy">历史未知来源</option>
              </select>
              <label><span>从</span><input type="date" value={resourceFrom} onChange={event => setResourceFrom(event.target.value)} /></label>
              <label><span>至</span><input type="date" value={resourceTo} onChange={event => setResourceTo(event.target.value)} /></label>
              {(resourceQuery || resourceTypeFilter || resourceSourceFilter || resourceFrom || resourceTo) &&
                <button onClick={() => {
                  setResourceQuery(''); setResourceTypeFilter(''); setResourceSourceFilter('')
                  setResourceFrom(''); setResourceTo('')
                }}>清除范围</button>}
            </div>
            {dashboard?.memoryFeedPayloadPolicy?.resources === 'paginated_on_demand' &&
              <small className="assistant-evidence">
                首页不再周期传输资源正文、附件结构或原文；目录分页读取，单条详情仅在展开时从 SQLCipher 水合。
              </small>}
            {!!dashboard?.attachmentStructureMigration?.total && <div className="assistant-query-plan">
              历史附件结构化：{dashboard.attachmentStructureMigration.completed || 0}
              {' / '}{dashboard.attachmentStructureMigration.total} 已完成
              {!!dashboard.attachmentStructureMigration.pending && ` · ${dashboard.attachmentStructureMigration.pending} 个将在后续同步中继续`}
              {!!dashboard.attachmentStructureMigration.deferred && ` · ${dashboard.attachmentStructureMigration.deferred} 个正在退避等待`}
            </div>}
            {!!dashboard?.imageSemanticMigration?.total && <div className="assistant-query-plan">
              历史图片视觉理解：{dashboard.imageSemanticMigration.completed || 0}
              {' / '}{dashboard.imageSemanticMigration.total} 已完成
              {!!dashboard.imageSemanticMigration.pending && ` · ${dashboard.imageSemanticMigration.pending} 张将在后续同步中继续`}
              {!!dashboard.imageSemanticMigration.deferred && ` · ${dashboard.imageSemanticMigration.deferred} 张正在退避等待`}
            </div>}
            <div className="assistant-memory-list">
              {visibleResources.map((directoryResource: any) => {
                const resource = selectedResourceDossier?.id === directoryResource.id &&
                  selectedResourceDossier.status === 'ready'
                  ? selectedResourceDossier
                  : directoryResource
                return <article className="assistant-memory-item" key={resource.id}>
                <div className="assistant-memory-item-head">
                  <strong>{resource.title}</strong>
                  <span>{resource.resource_type === 'link' ? '链接' : resource.resource_type === 'file' ? '文件' : resource.resource_type === 'chat-history' ? '转发记录' : resource.resource_type === 'mini-program' ? '小程序' : resource.resource_type === 'image' ? '图片 OCR' : resource.resource_type === 'voice' ? '语音转写' : resource.resource_type}</span>
                </div>
                <small>原始载体：{memorySourceLabels(resource)}</small>
                {resource.content && <p>{resource.content}</p>}
                {(resource.file_name || resource.url) && <small>{resource.file_name ? `${resource.file_name}${resource.file_ext ? ` · ${resource.file_ext}` : ''}` : resource.url}</small>}
                {resource.resource_type === 'file' && <small>
                  正文索引：{resource.metadata?.attachmentIndexStatus === 'indexed'
                    ? `已完成${resource.metadata?.attachmentFormat ? `（${resource.metadata.attachmentFormat}）` : ''}`
                    : resource.metadata?.attachmentIndexStatus === 'not_found' ? '未在本机找到原文件'
                      : resource.metadata?.attachmentIndexStatus === 'too_large' ? '文件超过本地解析上限'
                        : resource.metadata?.attachmentIndexStatus === 'unsupported' ? '该格式暂不支持'
                          : resource.metadata?.attachmentIndexStatus === 'ocr_required' ? '扫描版 PDF，等待逐页 OCR'
                            : resource.metadata?.attachmentIndexStatus === 'dependency_missing' ? '本机缺少 PDF 文本组件'
                          : resource.metadata?.attachmentIndexStatus === 'empty' ? '未提取到可读正文'
                            : resource.metadata?.attachmentIndexStatus === 'failed' ? '解析失败' : '等待增量解析'}
                </small>}
                {resource.metadata?.attachmentFormat === '.pdf-ocr' && <small>
                  扫描 PDF：已 OCR {resource.metadata.attachmentPdfOcrPages || 0}
                  {resource.metadata.attachmentPdfTotalPages ? ` / ${resource.metadata.attachmentPdfTotalPages}` : ''} 页
                  {resource.metadata.attachmentPdfOcrTruncated ? ' · 其余页面将在后续增强中处理' : ''}
                </small>}
                {resource.metadata?.attachmentStructure?.kind === 'spreadsheet' && <div className="assistant-evidence-stack">
                  <small>
                    表格结构：已读取 {resource.metadata.attachmentStructure.indexedSheetCount || 0}
                    {resource.metadata.attachmentStructure.sheetCount
                      ? ` / ${resource.metadata.attachmentStructure.sheetCount}` : ''} 个工作表
                    · {resource.metadata.attachmentStructure.indexedCells || 0} 个单元格
                    · {resource.metadata.attachmentStructure.chartCount || 0} 个图表
                    {resource.metadata.attachmentStructure.truncated ? ' · 已按本地安全预算截断' : ''}
                  </small>
                  {(resource.metadata.attachmentStructure.sheets || []).slice(0, 8).map((sheet: any) =>
                    <small key={sheet.name}>
                      {sheet.name}：{sheet.indexedRows || 0} 行 · {sheet.columnCount || 0} 列
                      {!!sheet.headers?.length && ` · 字段 ${sheet.headers.slice(0, 8).join('、')}`}
                      {!!sheet.chartCount && ` · ${sheet.chartCount} 个图表`}
                      {sheet.truncated ? ' · 部分索引' : ''}
                    </small>)}
                  {(resource.metadata.attachmentStructure.sheets || []).flatMap((sheet: any) => sheet.charts || []).slice(0, 8)
                    .map((chart: any) => <small key={`sheet-chart-${chart.index}`}>
                      图表 {chart.index}{chart.title ? `《${chart.title}》` : ''}：{chart.seriesCount || 0} 个系列 · {chart.pointCount || 0} 个数据点
                      {!!chart.series?.length && ` · ${chart.series.slice(0, 4).map((series: any) => series.name).join('、')}`}
                    </small>)}
                </div>}
                {resource.metadata?.attachmentStructure?.kind === 'document' && <div className="assistant-evidence-stack">
                  <small>
                    文档结构：{resource.metadata.attachmentStructure.paragraphCount || 0} 段
                    · {resource.metadata.attachmentStructure.headingCount || 0} 个标题
                    · {resource.metadata.attachmentStructure.listItemCount || 0} 个列表项
                    · {resource.metadata.attachmentStructure.tableCount || 0} 个表格
                    · {resource.metadata.attachmentStructure.chartCount || 0} 个图表
                    {resource.metadata.attachmentStructure.truncated ? ' · 已按本地安全预算截断' : ''}
                  </small>
                  {!!resource.metadata.attachmentStructure.headings?.length && <small>
                    标题大纲：{resource.metadata.attachmentStructure.headings.slice(0, 10)
                      .map((heading: any) => `${'·'.repeat(Math.max(1, Number(heading.level || 1)))} ${heading.text}`).join('　')}
                  </small>}
                  {(resource.metadata.attachmentStructure.tables || []).slice(0, 5).map((table: any) =>
                    <small key={table.index}>
                      {table.layout === 'key-value' ? '字段表' : '表格'} {table.index}：{table.rowCount || 0} 行 · {table.columnCount || 0} 列
                      {!!table.headers?.length && ` · 字段 ${table.headers.slice(0, 8).join('、')}`}
                    </small>)}
                  {(resource.metadata.attachmentStructure.charts || []).slice(0, 8).map((chart: any) =>
                    <small key={`doc-chart-${chart.index}`}>
                      图表 {chart.index}{chart.title ? `《${chart.title}》` : ''}：{chart.seriesCount || 0} 个系列 · {chart.pointCount || 0} 个数据点
                      {!!chart.series?.length && ` · ${chart.series.slice(0, 4).map((series: any) => series.name).join('、')}`}
                    </small>)}
                </div>}
                {resource.metadata?.attachmentStructure?.kind === 'presentation' && <div className="assistant-evidence-stack">
                  <small>
                    演示结构：已读取 {resource.metadata.attachmentStructure.indexedSlideCount || 0}
                    {resource.metadata.attachmentStructure.slideCount
                      ? ` / ${resource.metadata.attachmentStructure.slideCount}` : ''} 页
                    · {resource.metadata.attachmentStructure.textBlockCount || 0} 个文本块
                    · {resource.metadata.attachmentStructure.tableCount || 0} 个表格
                    · {resource.metadata.attachmentStructure.chartCount || 0} 个图表
                    {resource.metadata.attachmentStructure.truncated ? ' · 已按本地安全预算截断' : ''}
                  </small>
                  {(resource.metadata.attachmentStructure.slides || []).filter((slide: any) => slide.title).slice(0, 10)
                    .map((slide: any) => <small key={slide.number}>
                      第 {slide.number} 页{slide.titleSource === 'layout-inference' ? '推断标题' : '标题'}：{slide.title}
                      {slide.titleSource === 'layout-inference' ? ` · ${Math.round(Number(slide.titleConfidence || 0) * 100)}% 可信` : ''}
                    </small>)}
                  {(resource.metadata.attachmentStructure.slides || []).flatMap((slide: any) => slide.charts || []).slice(0, 8)
                    .map((chart: any) => <small key={`slide-chart-${chart.index}`}>
                      图表 {chart.index}{chart.title ? `《${chart.title}》` : ''}：{chart.seriesCount || 0} 个系列 · {chart.pointCount || 0} 个数据点
                      {!!chart.series?.length && ` · ${chart.series.slice(0, 4).map((series: any) => series.name).join('、')}`}
                    </small>)}
                </div>}
                {resource.metadata?.attachmentStructure?.kind === 'pdf' && <div className="assistant-evidence-stack">
                  <small>
                    PDF 版面：已读取 {resource.metadata.attachmentStructure.indexedPageCount || 0}
                    {resource.metadata.attachmentStructure.pageCount
                      ? ` / ${resource.metadata.attachmentStructure.pageCount}` : ''} 页
                    · {resource.metadata.attachmentStructure.blockCount || 0} 个文本块
                    · {resource.metadata.attachmentStructure.multiColumnPageCount || 0} 页检测为多栏
                    {resource.metadata.attachmentStructure.truncated ? ' · 已按本地安全预算截断' : ''}
                  </small>
                  {(resource.metadata.attachmentStructure.pages || []).slice(0, 12).map((page: any) =>
                    <small key={page.number}>
                      第 {page.number} 页：{page.columnCount === 2 ? '双栏，按左栏→右栏读取' : '单栏，从上到下读取'}
                      {' · '}{page.blockCount || 0} 个区块
                      {page.columnCount === 2 ? ` · ${Math.round(Number(page.columnConfidence || 0) * 100)}% 版面可信` : ''}
                    </small>)}
                </div>}
                {resource.resource_type === 'image' && resource.metadata?.ocrStructure && <div className="assistant-evidence-stack">
                  <small>
                    截图结构：{resource.metadata.ocrStructure.kind === 'chat' ? '聊天记录'
                      : resource.metadata.ocrStructure.kind === 'table' ? '表格'
                        : resource.metadata.ocrStructure.kind === 'form' ? '表单/字段'
                          : '普通文档'} · {Math.round(Number(resource.metadata.ocrStructure.confidence || 0) * 100)}% 可信
                  </small>
                  {!!resource.metadata.ocrStructure.keyValues?.length && <small>
                    关键字段：{resource.metadata.ocrStructure.keyValues.slice(0, 8).map((item: any) => `${item.key}＝${item.value}`).join('；')}
                  </small>}
                  {!!resource.metadata.ocrStructure.dates?.length && <small>日期：{resource.metadata.ocrStructure.dates.join('、')}</small>}
                  {!!resource.metadata.ocrStructure.amounts?.length && <small>金额：{resource.metadata.ocrStructure.amounts.join('、')}</small>}
                  {!!resource.metadata.ocrStructure.urls?.length && <small>链接：{resource.metadata.ocrStructure.urls.join('、')}</small>}
                </div>}
                {resource.resource_type === 'image' && resource.metadata?.visualSource && <div className="assistant-evidence-stack">
                  <small>图片视觉：Apple Vision 本地候选 · 未经人工确认，不单独作为事实证据</small>
                  {!!resource.metadata.visualLabels?.length && <small>
                    可能包含：{resource.metadata.visualLabels.slice(0, 8).map((label: any) =>
                      `${label.displayName || label.identifier} ${Math.round(Number(label.confidence || 0) * 100)}%`).join('；')}
                  </small>}
                </div>}
                {resource.resource_type === 'link' && <small>
                  网页快照：{resource.metadata?.webSnapshotStatus === 'indexed' ? '已安全索引'
                    : resource.metadata?.webSnapshotStatus === 'unsafe_url' ? '因内网/危险地址已拒绝'
                      : resource.metadata?.webSnapshotStatus === 'not_html' ? '不是可索引网页'
                        : resource.metadata?.webSnapshotStatus === 'too_large' ? '响应超过大小上限'
                          : resource.metadata?.webSnapshotStatus === 'timeout' ? '访问超时'
                            : resource.metadata?.webSnapshotStatus === 'failed' ? '抓取失败'
                              : '未启用或等待增量抓取'}
                </small>}
                {resource.metadata?.webSnapshotDescription && <small>网页摘要：{resource.metadata.webSnapshotDescription}</small>}
                {resource.metadata?.sessionName && <small>来自：{resource.metadata.sessionName}{resource.metadata.senderName ? ` · ${resource.metadata.senderName}` : ''}</small>}
                <div className="assistant-evidence-stack">
                  {(resource.evidence || []).map((evidence: any) =>
                    <small key={`${evidence.message_id}-${evidence.timestamp}`}>原消息 · {new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}：“{evidence.excerpt}”</small>)}
                </div>
                <div className="assistant-memory-actions">
                  <button onClick={() => void openResourceDossier(directoryResource)}>
                    {selectedResourceDossier?.id === resource.id
                      ? selectedResourceDossier.status === 'loading' ? '正在读取…' : '收起详情'
                      : '查看详情'}
                  </button>
                  <button onClick={() => void deleteMemoryResource(resource)}>从记忆删除</button>
                </div>
              </article>})}
              {resourceArchive.status === 'loading' && <div className="assistant-empty">正在读取资源目录…</div>}
              {resourceArchive.status === 'error' && <div className="assistant-empty">资源目录读取失败：{resourceArchive.error}</div>}
              {resourceArchive.status === 'ready' && !visibleResources.length &&
                <div className="assistant-empty">链接、文件、转发记录、小程序、图片 OCR 和语音转写会在增量整理时沉淀到这里。</div>}
            </div>
            {resourceArchive.hasMore && <div className="assistant-timeline-more">
              <button disabled={resourceLoadingMore} onClick={() => void loadMoreResources()}>
                {resourceLoadingMore ? '正在加载…' : `加载更多（已显示 ${visibleResources.length}/${resourceArchive.total}）`}
              </button>
            </div>}
            {!!Number(dashboard?.resourceArchive?.trash || 0) && <details className="assistant-query-plan"
              open={resourceTrashOpen} onToggle={event => setResourceTrashOpen(event.currentTarget.open)}>
              <summary>资源回收站（{dashboard.resourceArchive.trash}）</summary>
              <input value={resourceTrashQuery} onChange={event => setResourceTrashQuery(event.target.value)}
                placeholder="搜索已删除资源标题、文件名或 ID" />
              <div className="assistant-memory-list">
                {resourceTrash.map((resource: any) => <article className="assistant-memory-item" key={resource.id}>
                  <div className="assistant-memory-item-head">
                    <strong>{resource.title}</strong>
                    <span>{resource.resourceType}</span>
                  </div>
                  <small>删除于 {new Date(resource.deletedAt).toLocaleString('zh-CN')}</small>
                  <div className="assistant-memory-actions">
                    <button onClick={() => void purgeMemoryResourceTrash(resource)}>永久删除</button>
                    <button className="primary" onClick={() => void restoreMemoryResource(resource)}>恢复资源</button>
                  </div>
                </article>)}
                {resourceTrashArchive.status === 'loading' && <div className="assistant-empty">正在读取回收站目录…</div>}
                {resourceTrashArchive.status === 'ready' && !resourceTrash.length &&
                  <div className="assistant-empty">当前筛选没有已删除资源。</div>}
              </div>
              {resourceTrashArchive.hasMore && <button disabled={resourceTrashLoadingMore}
                onClick={() => void loadMoreResourceTrash()}>
                {resourceTrashLoadingMore ? '正在加载…' :
                  `加载更多（已显示 ${resourceTrash.length}/${resourceTrashArchive.total}）`}
              </button>}
            </details>}
          </section>
        </div>

        <section className="assistant-panel assistant-memory">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">PERSONAL MEMORY GRAPH</span><h3><Network size={16} /> 持续生长的个人知识图谱</h3></div>
            <span className="assistant-count">{Number(graphWorkspace.summary?.entities || dashboard?.graphSummary?.entities || 0)} 个实体 · {Number(graphWorkspace.summary?.relations || dashboard?.graphSummary?.relations || 0)} 条关系</span>
          </div>
          <div className="assistant-graph-toolbar">
            <input value={graphQuery} onChange={event => setGraphQuery(event.target.value)} placeholder="搜索人物、别名、组织或项目" />
            <select value={graphRelationType} onChange={event => setGraphRelationType(event.target.value)}>
              <option value="">全部关系类型</option>
              {relationPredicates.map(predicate => <option key={predicate} value={predicate}>{predicate}</option>)}
            </select>
            <select value={graphRelationStatus} onChange={event => setGraphRelationStatus(event.target.value)}>
              <option value="">全部可信状态</option><option value="confirmed">已确认</option><option value="candidate">待确认</option>
            </select>
            {(selectedEntityId || graphQuery) && <select value={graphFocusDepth} onChange={event => setGraphFocusDepth(Number(event.target.value))}>
              <option value={1}>展开 1 跳邻居</option><option value={2}>展开 2 跳邻居</option><option value={3}>展开 3 跳邻居</option>
            </select>}
            <select value={graphNodeLimit} onChange={event => setGraphNodeLimit(Number(event.target.value))}
              aria-label="图谱画布节点上限">
              <option value={60}>画布上限 60 节点</option>
              <option value={120}>画布上限 120 节点</option>
              <option value={200}>画布上限 200 节点</option>
              <option value={300}>画布上限 300 节点</option>
            </select>
            {selectedEntityId && <button onClick={() => setSelectedEntityId('')}>退出人物聚焦</button>}
          </div>
          <div className="assistant-graph-viewport-note">
            <span>{graphViewport.mode === 'focus' ? `正聚焦 ${selectedEntity?.canonicalName || '选中实体'}`
              : graphViewport.mode === 'search' ? `搜索命中并展开 ${graphFocusDepth} 跳关系`
                : '默认优先展示连接度最高的实体'}</span>
            <small>当前画布 {graphEntities.length} / {Number(graphViewport.totalAvailable || 0)} 个相关节点
              · {graphRelations.length} / {Number(graphViewport.totalRelationsAvailable || 0)} 条相关边
              {graphViewport.truncated ? ` · 另有 ${graphViewport.truncated} 个节点未展开` : ''}
            </small>
            {!!graphViewport.truncated && graphNodeLimit < 300 && <button
              onClick={() => setGraphNodeLimit(current => current < 120 ? 120 : current < 200 ? 200 : 300)}>
              展开更多节点
            </button>}
            {dashboard?.graphPayloadPolicy?.entityProfiles === 'on_demand' && <small>
              首页不再周期加载全量身份目录；画布、选择器、审阅卡片和人物档案均按当前范围读取。
            </small>}
          </div>
          {identityDisambiguation && <div className="assistant-identity-status">
            <span><strong>{identityDisambiguation.mode === 'full' ? '全图身份巡检' : '增量身份消歧'}</strong>
              <small>{identityDisambiguation.reason}</small></span>
            <span><b>{identityDisambiguation.lastCandidateCount || 0}</b><small>上次新增候选</small></span>
            <span><b>{identityDisambiguation.lastRunAt ? new Date(identityDisambiguation.lastRunAt).toLocaleString('zh-CN') : '尚未运行'}</b><small>最近消歧</small></span>
          </div>}
          <div className="assistant-path-finder">
            <TrustedEntityPicker
              value={pathFromId}
              selected={pathFromSelection}
              placeholder="搜索路径起点…"
              ariaLabel="关系路径起点"
              onSelect={entity => {
                setPathFromSelection(entity)
                setPathFromId(entity.id)
                setGraphPath(null)
                setGraphCommonNeighbors(null)
              }}
              onClear={() => {
                setPathFromSelection(null)
                setPathFromId('')
                setGraphPath(null)
                setGraphCommonNeighbors(null)
              }}
              onError={setMessage} />
            <span>→</span>
            <TrustedEntityPicker
              value={pathToId}
              selected={pathToSelection}
              placeholder="搜索路径终点…"
              ariaLabel="关系路径终点"
              onSelect={entity => {
                setPathToSelection(entity)
                setPathToId(entity.id)
                setGraphPath(null)
                setGraphCommonNeighbors(null)
              }}
              onClear={() => {
                setPathToSelection(null)
                setPathToId('')
                setGraphPath(null)
                setGraphCommonNeighbors(null)
              }}
              onError={setMessage} />
            <button onClick={() => void findGraphPath()} disabled={!pathFromId || !pathToId}>查找关系路径</button>
          </div>
          {graphPath && <div className={`assistant-path-result ${graphPath.found ? '' : 'missing'}`}>
            {graphPath.found ? <>
              <div className="assistant-path-chain">{graphPath.entities.map((entity: any, index: number) => <span key={entity.id}>
                <button onClick={() => setSelectedEntityId(entity.id)}>{entity.canonicalName}</button>
                {graphPath.steps[index] && <i>{graphPath.steps[index].forward ? graphPath.steps[index].predicate : `被${graphPath.steps[index].predicate}`} →</i>}
              </span>)}</div>
              {!!graphPath.steps?.length && <details className="assistant-path-evidence">
                <summary>核验这条路径的原文证据</summary>
                {graphPath.steps.map((step: any, index: number) => <section key={step.relationId}>
                  <strong>{graphPath.entities[index]?.canonicalName} {step.forward ? step.predicate : `被${step.predicate}`} {graphPath.entities[index + 1]?.canonicalName}</strong>
                  <EvidenceRows evidence={step.evidence} total={step.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'relation', step.relationId,
                      `${graphPath.entities[index]?.canonicalName || '实体'} · ${step.predicate} · ${graphPath.entities[index + 1]?.canonicalName || '实体'}`
                    )} />
                </section>)}
              </details>}
            </> : <p>在 6 层关系内没有找到路径。候选关系被保留，已拒绝关系不会参与计算。</p>}
          </div>}
          {graphCommonNeighbors && <div className="assistant-common-neighbors">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">COMMON CONNECTIONS</span><h3>共同联系人与实体</h3></div><span className="assistant-count">{graphCommonNeighbors.common.length} 个</span></div>
            {graphCommonNeighbors.common.map((item: any) => <article key={item.entity.id}>
              <button onClick={() => setSelectedEntityId(item.entity.id)}>{item.entity.canonicalName}</button>
              <div>
                {item.leftEdges.map((edge: any) => <div className="assistant-common-edge" key={`left-${edge.relationId}`}>
                  {graphCommonNeighbors.from?.canonicalName} {edge.forward ? edge.predicate : `被${edge.predicate}`} {item.entity.canonicalName}
                  <small>{edge.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(edge.confidence || 0) * 100)}%</small>
                  <details><summary>原文证据 {edge.evidenceTotal || 0} 条</summary><EvidenceRows
                    evidence={edge.evidence} total={edge.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'relation', edge.relationId,
                      `${graphCommonNeighbors.from?.canonicalName || '实体'} · ${edge.predicate} · ${item.entity.canonicalName}`
                    )} /></details>
                </div>)}
                {item.rightEdges.map((edge: any) => <div className="assistant-common-edge" key={`right-${edge.relationId}`}>
                  {graphCommonNeighbors.to?.canonicalName} {edge.forward ? edge.predicate : `被${edge.predicate}`} {item.entity.canonicalName}
                  <small>{edge.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(edge.confidence || 0) * 100)}%</small>
                  <details><summary>原文证据 {edge.evidenceTotal || 0} 条</summary><EvidenceRows
                    evidence={edge.evidence} total={edge.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'relation', edge.relationId,
                      `${graphCommonNeighbors.to?.canonicalName || '实体'} · ${edge.predicate} · ${item.entity.canonicalName}`
                    )} /></details>
                </div>)}
              </div>
            </article>)}
            {!graphCommonNeighbors.common.length && <div className="assistant-empty">当前图谱中没有共同的一跳联系人或实体。</div>}
          </div>}
          {graphWorkspace.status === 'loading' ? <div className="assistant-empty">正在从本机图谱构建当前语义视口…</div>
          : graphWorkspace.status === 'error' ? <div className="assistant-empty">图谱视口读取失败：{graphWorkspace.error}</div>
          : graphEntities.length ? (
            <div className="assistant-graph-layout">
              <svg className="assistant-graph-canvas" viewBox="0 0 500 340" role="img" aria-label="个人知识关系图">
                {graphRelations.map((relation: any) => {
                  const from = graphPositions.get(relation.subjectId) as any
                  const to = graphPositions.get(relation.objectId) as any
                  return <g key={relation.id}>
                    <title>{relation.predicate} · {relation.status === 'confirmed' ? '已确认' : '待确认'}</title>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={relation.status === 'candidate' ? 'candidate' : ''} />
                    {graphRelations.length <= 120 &&
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{relation.predicate}</text>}
                  </g>
                })}
                {graphEntities.map((entity: any) => {
                  const point = graphPositions.get(entity.id) as any
                  return <g key={entity.id} className={`graph-node ${entity.trustStatus || 'legacy_unverified'} ${selectedEntityId === entity.id ? 'selected' : ''}`} onClick={() => setSelectedEntityId(entity.id)}>
                    <title>{entity.canonicalName} · {entity.type}</title>
                    <circle cx={point.x} cy={point.y}
                      r={graphEntities.length > 120 ? (selectedEntityId === entity.id ? 12 : 7) : entity.type === 'person' ? 18 : 14} />
                    {(graphEntities.length <= 120 || selectedEntityId === entity.id) &&
                      <text x={point.x} y={point.y + (graphEntities.length > 120 ? 22 : 32)}
                        textAnchor="middle">{entity.canonicalName.slice(0, 12)}</text>}
                  </g>
                })}
              </svg>
              <aside className="assistant-graph-detail">
                {selectedEntity ? <>
                  <span>{selectedEntity.type}</span>
                  <h4>{selectedEntity.canonicalName}</h4>
                  <small>实体状态：{selectedEntity.trustStatus === 'confirmed' ? '已确认' : selectedEntity.trustStatus === 'candidate' ? '待确认（不参与可信检索）' : selectedEntity.trustStatus === 'legacy_unverified' ? '历史未验证（不参与可信检索）' : '已拒绝'}</small>
                  <p>{selectedEntity.summary || '等待更多证据补充'}</p>
                  <small>摘要状态：{selectedEntity.summaryStatus === 'confirmed' ? '已确认' : selectedEntity.summaryStatus === 'legacy_unverified' ? '历史未验证（不参与可信检索）' : '尚无已确认摘要'}</small>
                  <small>别名：{selectedEntity.aliases?.join('、') || '无'}</small>
                  <small>微信：{selectedEntity.accountIds?.join('、') || '未关联'}</small>
                  <small>邮箱：{selectedEntity.externalIdentities?.filter((identity: any) => identity.platform === 'email').map((identity: any) => identity.accountId).join('、') || '未关联'}</small>
                  <small>关联原文：{Number(graphWorkspace.focus?.evidenceTotal || 0)} 条</small>
                  <button className="assistant-open-dossier" onClick={() => setShowEntityDossier(true)}>打开完整档案</button>
                  <button className="assistant-forget-entity" onClick={() => void forgetSelectedEntity()} disabled={forgettingEntityId === selectedEntity.id}>
                    {forgettingEntityId === selectedEntity.id ? '正在彻底清理…' : '彻底遗忘此实体'}
                  </button>
                  {selectedEntityInsight && <div className="assistant-relationship-metrics">
                    <div><strong>{selectedEntityInsight.strength}</strong><span>关系强度 · {selectedEntityInsight.strengthLabel}</span></div>
                    <div><strong>{selectedEntityInsight.evidenceCount}</strong><span>去重证据</span></div>
                    <div><strong>{selectedEntityInsight.openTaskCount}</strong><span>关联待办</span></div>
                    <div><strong>{selectedEntityInsight.pendingCommitmentCount}</strong><span>待确认承诺</span></div>
                    {selectedEntityInsight.lastContactAt && <small>最近互动证据：{new Date(selectedEntityInsight.lastContactAt * 1000).toLocaleString('zh-CN')}</small>}
                    <details><summary>强度计算依据</summary>{selectedEntityInsight.explanation.map((item: string) => <small key={item}>{item}</small>)}</details>
                  </div>}
                  <div className="assistant-entity-dossier">
                    <strong>结构化事实 · {selectedEntityClaims.length}</strong>
                    {selectedEntityClaims.slice(0, 6).map((claim: any) =>
                      <button key={claim.id} onClick={() => setMemoryQuery(`${selectedEntity.canonicalName} ${claim.predicate}`)}>
                        <b>{claim.predicate}</b><span>{claim.object_entity_name || claim.object_value || '待确认'}</span>
                      </button>)}
                    {!selectedEntityClaims.length && <em>尚无事实</em>}
                    <strong>关系 · {Number(graphWorkspace.focus?.relationTotal ?? selectedEntityRelations.length)}
                      {Number(graphWorkspace.focus?.relationTotal || 0) > selectedEntityRelations.length
                        ? `（预览 ${selectedEntityRelations.length}）`
                        : ''}
                    </strong>
                    {selectedEntityRelations.slice(0, 6).map((relation: any) => {
                      const outgoing = relation.subjectId === selectedEntity.id
                      const neighborId = outgoing ? relation.objectId : relation.subjectId
                      return <button key={relation.id} onClick={() => setSelectedEntityId(neighborId)}>
                        <b>{outgoing ? relation.predicate : `被${relation.predicate}`}</b>
                        <span>{selectedEntityNames[neighborId] || neighborId}</span>
                      </button>
                    })}
                    {!selectedEntityRelations.length && <em>尚无关系</em>}
                    <strong>关系变化 · {selectedEntityRelationHistory.length}</strong>
                    {selectedEntityRelationHistory.slice(0, 8).map((item: any) =>
                      <div className="assistant-relation-history" key={item.id}>
                        <b>{item.subject_name || item.subject_id} — {item.predicate} → {item.object_name || item.object_id}</b>
                        <span>{item.change_type === 'created' ? '首次发现' : item.change_type === 'status_changed' ? '可信状态变化' : '证据与置信度更新'} · {item.status === 'confirmed' ? '已确认' : item.status === 'rejected' ? '已拒绝' : '待确认'}</span>
                        <small>{new Date(item.created_at).toLocaleString('zh-CN')} · {Math.round(Number(item.confidence || 0) * 100)}%</small>
                      </div>)}
                    {!selectedEntityRelationHistory.length && <em>尚无关系变化记录</em>}
                    <strong>相关事件 · {selectedEntityEvents.length}</strong>
                    {selectedEntityEvents.slice(0, 5).map((event: any) =>
                      <button key={event.id} onClick={() => setMemoryQuery(event.title)}>
                        <b>{event.start_at || '时间待确认'}</b><span>{event.title}</span>
                      </button>)}
                    {!selectedEntityEvents.length && <em>尚无事件</em>}
                  </div>
                </> : <p>点击节点查看身份、别名、账号、关系、事实和历史事件。</p>}
              </aside>
            </div>
          ) : <div className="assistant-empty">下一次同步会从新增消息开始建立人物、组织、项目和关系证据。</div>}
          <div className="assistant-review-section">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">REVIEW LEDGER</span><h3>身份与关系审阅</h3></div><span className="assistant-count">{pendingReviewCount} 待处理 · {resolvedReviewCount} 已处理</span></div>
            {dashboard?.graphReviewStorage?.statePolicy === 'pending_only' && <small className="assistant-evidence">
              加密运行状态只保留 {dashboard.graphReviewStorage.pending || 0} 条待处理工作；已处理历史由 SQLCipher 审阅账本分页保存，可在重启后继续筛选查看。
              {dashboard.graphReviewStorage.archivedThisRun
                ? ` 本次启动已迁移 ${dashboard.graphReviewStorage.archivedThisRun} 条历史、移除 ${dashboard.graphReviewStorage.archivedEvidenceThisRun || 0} 份重复原文副本。`
                : ''}
              {dashboard.graphReviewStorage.recoveredFromSqlThisStart
                ? ` 检测到上次退出发生在 SQLCipher 提交与状态文件写入之间，已从权威数据库恢复 ${dashboard.graphReviewStorage.recoveredEntities || 0} 个实体、${dashboard.graphReviewStorage.recoveredRelations || 0} 条关系和 ${dashboard.graphReviewStorage.recoveredPendingReviews || 0} 个待处理候选。`
                : ' 图谱跨存储提交点一致。'}
            </small>}
            <div className="assistant-review-filters">
              <div>
                <button className={reviewStatusFilter === 'pending' ? 'active' : ''} onClick={() => setReviewStatusFilter('pending')}>待处理 {pendingReviewCount}</button>
                <button className={reviewStatusFilter === 'resolved' ? 'active' : ''} onClick={() => setReviewStatusFilter('resolved')}>已处理 {resolvedReviewCount}</button>
                <button className={reviewStatusFilter === 'all' ? 'active' : ''} onClick={() => setReviewStatusFilter('all')}>全部 {reviewPage.counts.all}</button>
              </div>
              <select value={reviewKindFilter} onChange={event => setReviewKindFilter(event.target.value)}>
                <option value="">全部类型</option>
                <option value="entity_creation">实体存在与名称</option>
                <option value="entity_summary">实体摘要</option>
                <option value="entity_alias">实体别名</option>
                <option value="relation">有向关系</option>
                <option value="possible_duplicate">身份合并</option>
              </select>
              <input value={reviewQuery} placeholder="搜索名称、原文、建议或处理原因" onChange={event => setReviewQuery(event.target.value)} />
            </div>
            {visibleReviews.map((review: any) => <article className={`assistant-review-item ${review.status !== 'pending' ? 'resolved' : ''}`} key={review.id}>
              {(() => {
                const isPending = review.status === 'pending'
                const relation = review.kind === 'relation' ? review.relation : null
                const relationCorrectionAudit = review.kind === 'relation' ? review.relationCorrection : null
                const reviewEntities: any[] = review.relatedEntities || []
                const reviewEntity = (id: string) => reviewEntities.find(item => item.id === id)
                const subject = relation ? reviewEntity(relation.subjectId) : null
                const object = relation ? reviewEntity(relation.objectId) : null
                const relationEdit = relation
                  ? relationEdits[review.id] || {
                      subjectId: relation.subjectId,
                      predicate: relation.predicate,
                      objectId: relation.objectId
                    }
                  : null
                const correctedRelationSubject = relationEdit
                  ? relationEdit.subjectEntity?.id === relationEdit.subjectId
                    ? relationEdit.subjectEntity
                    : reviewEntity(relationEdit.subjectId)
                  : null
                const correctedRelationObject = relationEdit
                  ? relationEdit.objectEntity?.id === relationEdit.objectId
                    ? relationEdit.objectEntity
                    : reviewEntity(relationEdit.objectId)
                  : null
                const relationInvalidReason = !relationEdit
                  ? ''
                  : !relationEdit.subjectId || !relationEdit.predicate.trim() || !relationEdit.objectId
                    ? '主语、谓词和宾语均不能为空'
                    : relationEdit.subjectId === relationEdit.objectId
                      ? '主语和宾语不能是同一个实体'
                      : correctedRelationSubject?.trustStatus !== 'confirmed' || correctedRelationObject?.trustStatus !== 'confirmed'
                        ? '请先确认关系两端的实体'
                        : /[\u0000-\u001f\u007f]/.test(relationEdit.predicate)
                          ? '谓词不能包含控制字符'
                          : ''
                const duplicateEntities = review.kind === 'possible_duplicate'
                  ? [review.leftEntityId, review.rightEntityId]
                    .map((entityId: string) => reviewEntity(entityId))
                  : []
                const selectedMergeTargetId = mergeTargets[review.id] || ''
                const selectedMergeTarget = duplicateEntities.find((entity: any) => entity?.id === selectedMergeTargetId)
                const selectedMergeSource = duplicateEntities.find((entity: any) => entity?.id && entity.id !== selectedMergeTargetId)
                const correctedEntityName = String(entityNameEdits[review.id] ?? review.entityCanonicalName ?? '').trim()
                const correctedEntityNameLower = correctedEntityName.toLocaleLowerCase('zh-CN')
                const entityNameInvalidReason = review.kind !== 'entity_creation'
                  ? ''
                  : !correctedEntityName
                    ? '规范名不能为空'
                    : /[\u0000-\u001f\u007f]/.test(String(entityNameEdits[review.id] ?? review.entityCanonicalName ?? ''))
                      ? '规范名不能包含控制字符'
                      : new Set(['我', '你', '用户', '群友', '对方', '某人', '未知', 'unknown', 'user']).has(correctedEntityNameLower)
                        ? '不能使用“我、你、用户、群友”等占位词作为规范名'
                        : ''
                const sameNameEntities = review.kind === 'entity_creation' && correctedEntityName
                  ? (review.sameNameEntities || []).filter((entity: any) =>
                      String(entity.canonicalName || '').trim().toLocaleLowerCase('zh-CN') ===
                      correctedEntityName.toLocaleLowerCase('zh-CN'))
                  : []
                const profileEditValue = review.kind === 'entity_summary'
                  ? String(profileEdits[review.id] ?? review.summaryText ?? '')
                  : review.kind === 'entity_alias'
                    ? String(profileEdits[review.id] ?? review.aliasText ?? '')
                    : ''
                const compactProfileEditValue = profileEditValue.replace(/\s+/g, ' ').trim()
                const profileInvalidReason = review.kind === 'entity_summary'
                  ? !compactProfileEditValue
                    ? '确认摘要不能为空'
                    : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(profileEditValue)
                      ? '摘要不能包含控制字符'
                      : ''
                  : review.kind === 'entity_alias'
                    ? !compactProfileEditValue
                      ? '确认别名不能为空'
                      : /[\u0000-\u001f\u007f]/.test(profileEditValue)
                        ? '别名不能包含控制字符'
                        : new Set(['我', '你', '用户', '群友', '对方', '某人', '未知', 'unknown', 'user']).has(compactProfileEditValue.toLocaleLowerCase('zh-CN').replace(/\s+/g, ''))
                          ? '不能使用占位词作为实体别名'
                          : ''
                    : ''
                return <><div><strong>{review.kind === 'possible_duplicate' ? `可能是同一个人：${review.title}` : review.title}</strong>
                {review.kind === 'possible_duplicate' && isPending && <div className="assistant-identity-pair">
                  {[review.leftEntityId, review.rightEntityId].map((entityId: string) => {
                    const entity = reviewEntity(entityId)
                    const selected = selectedMergeTargetId === entityId
                    return <button type="button" disabled={!isPending} className={selected ? 'selected' : ''} key={entityId}
                      onClick={() => setMergeTargets(current => ({ ...current, [review.id]: entityId }))}>
                      <span>{selected ? '✓ 将保留此身份' : '选择保留此身份'}</span>
                      <b>{entity?.canonicalName || '未知人物'}</b><small>{
                      entity?.externalIdentities?.map((identity: any) => identity.accountId).join('、') ||
                      entity?.aliases?.join('、') || entity?.accountIds?.join('、') || '暂无别名或账号'
                    }</small></button>
                  })}
                </div>}
                {review.kind === 'possible_duplicate' && isPending && <div className={`assistant-merge-preview${selectedMergeTarget ? ' ready' : ''}`}>
                  {selectedMergeTarget
                    ? <><b>合并预览：</b><span>{selectedMergeSource?.canonicalName || '被合并身份'} → {selectedMergeTarget.canonicalName || '保留身份'}</span><small>右侧身份会消失；保留身份的名称和档案作为主记录，账号、别名、证据、关系和事件会迁入。之后仍可从合并历史撤销。</small></>
                    : <><b>请先选择保留哪一个身份</b><small>系统不会再替你默认决定合并方向。</small></>}
                </div>}
                {review.kind === 'possible_duplicate' && <div className="assistant-review-note">
                  <b>候选来源：</b>{review.candidateSource === 'llm_suggestion' ? '模型基于上下文建议' : '确定性身份规则'}
                  {(review.candidateSignals || []).map((signal: any, index: number) =>
                    <div key={`${signal.source}-${index}`}><small>{signal.label}：“{signal.value}”</small></div>)}
                  <div><small>拒绝后会记为负样本；两边身份信息未变化前不会再次出现。</small></div>
                </div>}
                {relation && <div className="assistant-review-note">
                  <div><b>模型原始方向：</b>{relationCorrectionAudit
                    ? `${reviewEntity(relationCorrectionAudit.before_subject_id)?.canonicalName || relationCorrectionAudit.before_subject_id} — ${relationCorrectionAudit.before_predicate} → ${reviewEntity(relationCorrectionAudit.before_object_id)?.canonicalName || relationCorrectionAudit.before_object_id}`
                    : relation.directionExplanation || (
                    relation.predicate === '服务对象'
                      ? `${object?.canonicalName || '宾语'}向${subject?.canonicalName || '主语'}提供服务；${subject?.canonicalName || '主语'}是${object?.canonicalName || '宾语'}的服务对象。`
                      : `从“${subject?.canonicalName || '主语'}”指向“${object?.canonicalName || '宾语'}”：${subject?.canonicalName || '主语'} ${relation.predicate} ${object?.canonicalName || '宾语'}。`
                  )}</div>
                  {relationEdit && <div className="assistant-relation-correction">
                    <div className="assistant-relation-entity-field"><span>主语</span>
                      <TrustedEntityPicker
                        value={relationEdit.subjectId}
                        selected={correctedRelationSubject}
                        placeholder="搜索确认实体作为主语…"
                        ariaLabel="关系主语"
                        disabled={!isPending}
                        onSelect={entity => setRelationEdits(current => ({
                          ...current,
                          [review.id]: { ...relationEdit, subjectId: entity.id, subjectEntity: entity }
                        }))}
                        onClear={() => setRelationEdits(current => ({
                          ...current,
                          [review.id]: { ...relationEdit, subjectId: '', subjectEntity: undefined }
                        }))}
                        onError={setMessage} />
                    </div>
                    <label><span>有向谓词</span><input disabled={!isPending} value={relationEdit.predicate} maxLength={100} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, predicate: event.target.value } }))} /></label>
                    <div className="assistant-relation-entity-field"><span>宾语</span>
                      <TrustedEntityPicker
                        value={relationEdit.objectId}
                        selected={correctedRelationObject}
                        placeholder="搜索确认实体作为宾语…"
                        ariaLabel="关系宾语"
                        disabled={!isPending}
                        onSelect={entity => setRelationEdits(current => ({
                          ...current,
                          [review.id]: { ...relationEdit, objectId: entity.id, objectEntity: entity }
                        }))}
                        onClear={() => setRelationEdits(current => ({
                          ...current,
                          [review.id]: { ...relationEdit, objectId: '', objectEntity: undefined }
                        }))}
                        onError={setMessage} />
                    </div>
                    <button type="button" disabled={!isPending} onClick={() => setRelationEdits(current => ({
                      ...current,
                      [review.id]: {
                        ...relationEdit,
                        subjectId: relationEdit.objectId,
                        objectId: relationEdit.subjectId,
                        subjectEntity: correctedRelationObject,
                        objectEntity: correctedRelationSubject
                      }
                    }))}>交换主语与宾语</button>
                  </div>}
                  {relationEdit && <div className={`assistant-relation-preview${relationInvalidReason ? ' invalid' : ''}`}>
                    <b>{isPending ? '确认后方向：' : '人工最终方向：'}</b>
                    <span>{correctedRelationSubject?.canonicalName || '主语待选择'} — {relationEdit.predicate || '谓词待填写'} → {correctedRelationObject?.canonicalName || '宾语待选择'}</span>
                    {relationInvalidReason
                      ? <small>{relationInvalidReason}</small>
                      : <small>修改会重算关系 ID、迁移原文证据并保留旧值→新值审计；不会静默丢失证据。</small>}
                  </div>}
                  {(relation.evidence || []).map((evidence: any) => <div key={evidence.messageId}><small>证据：“{evidence.excerpt}”</small></div>)}
                </div>}
                {review.kind === 'entity_summary' && <div className="assistant-review-note">
                  {review.previousSummary && <div><b>当前摘要：</b><span>{review.previousSummary}</span></div>}
                  <div><b>模型建议：</b><span>{review.originalSummaryText || review.summaryText}</span></div>
                  {!isPending && review.originalSummaryText && <div><b>人工最终值：</b><span>{review.summaryText}</span></div>}
                  {isPending && <label className="assistant-profile-correction">
                    <span>确认写入的摘要</span>
                    <textarea value={profileEditValue} maxLength={800} rows={4}
                      onChange={event => setProfileEdits(current => ({ ...current, [review.id]: event.target.value }))} />
                    <small>可在不丢失原文证据的前提下修改措辞或纠正事实；模型建议和人工最终值都会进入审计。</small>
                    {profileInvalidReason && <small className="error">{profileInvalidReason}</small>}
                  </label>}
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会写入档案和可信检索；拒绝不会修改现有摘要。</small></div>
                </div>}
                {review.kind === 'entity_alias' && <div className="assistant-review-note">
                  <div><b>模型建议别名：</b><span>{review.originalAliasText || review.aliasText}</span></div>
                  {!isPending && review.originalAliasText && <div><b>人工最终值：</b><span>{review.aliasText}</span></div>}
                  {isPending && <label className="assistant-profile-correction">
                    <span>确认写入的别名</span>
                    <input value={profileEditValue} maxLength={100}
                      onChange={event => setProfileEdits(current => ({ ...current, [review.id]: event.target.value }))} />
                    <small>错误建议可以直接改成正确别名；占位词、规范名和已经存在的别名会由后端再次拦截。</small>
                    {profileInvalidReason && <small className="error">{profileInvalidReason}</small>}
                  </label>}
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会参与身份消歧、合并建议和统一检索。</small></div>
                </div>}
                {review.kind === 'entity_creation' && <div className="assistant-review-note">
                  <div><b>模型识别名称：</b><span>{review.originalEntityCanonicalName || review.entityCanonicalName} · {review.entityType}</span></div>
                  {!isPending && review.originalEntityCanonicalName && <div><b>人工最终名称：</b><span>{review.entityCanonicalName}</span></div>}
                  {isPending && <label className="assistant-entity-name-correction">
                    <span>确认使用的规范名</span>
                    <input
                      value={entityNameEdits[review.id] ?? review.entityCanonicalName ?? ''}
                      maxLength={100}
                      onChange={event => setEntityNameEdits(current => ({ ...current, [review.id]: event.target.value }))}
                    />
                    <small>名字不准确时请先修正；原值、新值和确认时间都会保留在人物档案中。错误旧名不会自动变成别名。</small>
                    {entityNameInvalidReason && <small className="error">{entityNameInvalidReason}</small>}
                  </label>}
                  {isPending && sameNameEntities.length > 0 && <div className="assistant-name-collision">
                    <b>发现 {Number(review.sameNameEntityTotal || sameNameEntities.length)} 个同名实体：</b>
                    <span>{sameNameEntities.map((entity: any) => entity.canonicalName).join('、')}</span>
                    {Number(review.sameNameEntityTotal || 0) > sameNameEntities.length &&
                      <small>当前仅显示前 {sameNameEntities.length} 个身份提示。</small>}
                    <small>本次确认仍会建立独立实体，不会因同名自动合并；人物会另行进入“可能是同一人”审阅。</small>
                  </div>}
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会进入统一检索、RAG 查询规划、图路径和确定性派生视图。</small></div>
                  {review.legacyReview && !(review.evidence || []).length && <div><small>⚠ 此旧版实体没有可恢复的关联原文，请仅在你能确认身份时通过。</small></div>}
                </div>}
                {review.status !== 'pending' && <div className={`assistant-review-resolution ${review.status}`}>
                  <b>{review.status === 'confirmed' ? '已确认' : '已拒绝'}</b>
                  <span>{review.resolutionReason || (review.resolutionActor === 'system' ? '由系统规则处理' : '历史处理原因未记录')}</span>
                  <small>{review.resolutionActor === 'system' ? '系统自动处理' : '人工处理'} · {review.resolvedAt ? new Date(review.resolvedAt).toLocaleString('zh-CN') : '旧版记录，处理时间未知'}</small>
                </div>}
                <p>{review.detail}</p><small>{Math.round(review.confidence * 100)}% 可信 · {
                  review.kind === 'possible_duplicate'
                    ? '确认后合并身份'
                    : review.kind === 'entity_summary'
                      ? '确认后写入可信摘要'
                      : review.kind === 'entity_alias'
                        ? '确认后写入身份别名'
                        : review.kind === 'entity_creation'
                          ? '确认后启用可信实体'
                      : '确认后写入关系'
                }</small></div>
              {isPending && <div className="assistant-review-actions"><button onClick={() => void decideReview(review.id, 'rejected')}>拒绝</button><button className="primary" disabled={(review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId || !selectedMergeTargetId)) || Boolean(entityNameInvalidReason) || Boolean(relationInvalidReason) || Boolean(profileInvalidReason)} title={review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId) ? '候选信息不完整，暂不能合并' : review.kind === 'possible_duplicate' && !selectedMergeTargetId ? '请先选择合并后保留的身份' : entityNameInvalidReason || relationInvalidReason || profileInvalidReason} onClick={() => void decideReview(review.id, 'confirmed', review.kind === 'possible_duplicate' ? { mergeTargetEntityId: selectedMergeTargetId } : review.kind === 'entity_creation' ? { correctedCanonicalName: entityNameEdits[review.id] ?? review.entityCanonicalName ?? '' } : review.kind === 'relation' && relationEdit ? { relationCorrection: {
                subjectId: relationEdit.subjectId,
                predicate: relationEdit.predicate,
                objectId: relationEdit.objectId
              } } : review.kind === 'entity_summary' ? { correctedSummaryText: profileEditValue } : review.kind === 'entity_alias' ? { correctedAliasText: profileEditValue } : undefined)}>{review.kind === 'relation' ? '确认修正后方向' : review.kind === 'possible_duplicate' ? '按此方向合并' : review.kind === 'entity_creation' ? '确认名称并启用' : review.kind === 'entity_summary' || review.kind === 'entity_alias' ? '确认人工最终值' : '确认'}</button></div>}</>
              })()}
            </article>)}
            {reviewPage.status === 'loading' && <div className="assistant-empty">正在读取符合条件的审阅记录…</div>}
            {reviewPage.status === 'error' && <div className="assistant-empty">审阅记录读取失败：{reviewPage.error}</div>}
            {reviewPage.status === 'ready' && !visibleReviews.length && <div className="assistant-empty">{reviewStatusFilter === 'pending' ? '当前没有符合筛选条件的待处理候选。' : '当前没有符合筛选条件的审阅历史。'}</div>}
            {reviewPage.status === 'ready' && visibleReviews.length > 0 && <div className="assistant-review-page-status">
              <small>已加载 {visibleReviews.length} / {reviewPage.total} 条符合条件的记录；筛选和排序由本机后端执行。</small>
              {reviewPage.hasMore && <button type="button" disabled={reviewLoadingMore} onClick={() => void loadMoreReviews()}>
                {reviewLoadingMore ? '正在加载…' : '加载更多审阅记录'}
              </button>}
            </div>}
            {(dashboard?.mergeHistoryArchive?.total > 0 || mergeArchive.loading) && <div className="assistant-merge-archive">
              <div className="assistant-section-heading">
                <div><span className="assistant-eyebrow">MERGE HISTORY</span><h3>身份合并完整档案</h3></div>
                <span className="assistant-count">
                  {mergeArchive.counts.active} 有效 · {mergeArchive.counts.reverted} 已撤销
                </span>
              </div>
              <small className="assistant-evidence">
                全部合并由本机 SQLCipher 分页读取；撤销快照只在主进程按需使用，不会发送到界面。
                启动恢复可信身份会读取全部 {dashboard?.mergeHistoryArchive?.active || 0} 个有效合并，不受当前页面数量限制。
              </small>
              <div className="assistant-task-filters">
                <select value={mergeArchiveStatus}
                  onChange={event => setMergeArchiveStatus(event.target.value as typeof mergeArchiveStatus)}>
                  <option value="all">全部状态</option>
                  <option value="active">仍然有效</option>
                  <option value="reverted">已经撤销</option>
                </select>
                <input value={mergeArchiveQuery}
                  onChange={event => setMergeArchiveQuery(event.target.value)}
                  placeholder="搜索双方名称或实体 ID" />
                <label><span>操作从</span><input type="date" value={mergeArchiveFrom}
                  onChange={event => setMergeArchiveFrom(event.target.value)} /></label>
                <label><span>到</span><input type="date" value={mergeArchiveTo}
                  onChange={event => setMergeArchiveTo(event.target.value)} /></label>
                {(mergeArchiveStatus !== 'all' || mergeArchiveQuery || mergeArchiveFrom || mergeArchiveTo) &&
                  <button onClick={() => {
                    setMergeArchiveStatus('all'); setMergeArchiveQuery('')
                    setMergeArchiveFrom(''); setMergeArchiveTo('')
                  }}>清除范围</button>}
              </div>
              {mergeArchive.items.map((merge: any) =>
                <article className={`assistant-review-item ${merge.reverted_at ? 'resolved' : ''}`}
                  key={`merge-${merge.id}`}>
                  <div>
                    <strong>{merge.reverted_at ? '已撤销身份合并' : '有效身份合并'}</strong>
                    <p>{merge.source_name || merge.source_entity_id} → {merge.target_name || merge.target_entity_id}</p>
                    <small>
                      被合并 → 保留 · 合并于 {new Date(merge.created_at).toLocaleString('zh-CN')}
                      {merge.reverted_at ? ` · 撤销于 ${new Date(merge.reverted_at).toLocaleString('zh-CN')}` : ''}
                    </small>
                  </div>
                  {!merge.reverted_at && <div>
                    <button onClick={() => void revertMerge(Number(merge.id))}>撤销合并</button>
                  </div>}
                </article>)}
              {!mergeArchive.items.length && <div className="assistant-empty">
                {mergeArchive.loading ? '正在读取完整身份合并档案…' : '当前范围没有身份合并记录。'}
              </div>}
              {mergeArchive.hasMore && <div className="assistant-review-page-status">
                <small>已加载 {mergeArchive.items.length} / {mergeArchive.total} 条合并记录。</small>
                <button type="button" disabled={mergeArchiveLoadingMore}
                  onClick={() => void loadMoreMergeHistory()}>
                  {mergeArchiveLoadingMore ? '正在加载…' : '加载更多合并记录'}
                </button>
              </div>}
            </div>}
          </div>
        </section>
      </div>

      {memoryEvidenceArchive && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-evidence-archive-modal" role="dialog" aria-modal="true"
            aria-labelledby="memory-evidence-archive-title">
            <div className="assistant-modal-title">
              <div>
                <span className="assistant-eyebrow">FULL EVIDENCE ARCHIVE</span>
                <h2 id="memory-evidence-archive-title">{memoryEvidenceArchive.title}</h2>
                <p>
                  {MEMORY_TYPE_LABELS[memoryEvidenceArchive.documentType] || memoryEvidenceArchive.documentType}
                  {' · '}按时间从新到旧读取 SQLCipher 中的完整去重证据历史。
                </p>
              </div>
              <button aria-label="关闭完整证据档案" onClick={closeMemoryEvidenceArchive}><X size={18} /></button>
            </div>
            <div className="assistant-evidence-archive-status">
              {memoryEvidenceArchive.status === 'loading'
                ? '正在读取完整证据档案…'
                : memoryEvidenceArchive.status === 'error'
                  ? `读取失败：${memoryEvidenceArchive.error || '未知错误'}`
                  : memoryEvidenceArchive.total === memoryEvidenceArchive.unfilteredTotal
                    ? `已加载 ${memoryEvidenceArchive.items.length} / ${memoryEvidenceArchive.total} 条`
                    : `已加载 ${memoryEvidenceArchive.items.length} / 匹配 ${memoryEvidenceArchive.total} 条（全部 ${memoryEvidenceArchive.unfilteredTotal} 条）`}
            </div>
            <form className="assistant-evidence-archive-filters" onSubmit={event => {
              event.preventDefault()
              void openMemoryEvidenceArchive(
                memoryEvidenceArchive.documentType,
                memoryEvidenceArchive.sourceId,
                memoryEvidenceArchive.title,
                memoryEvidenceFilters
              )
            }}>
              <label>
                <span>原文关键词</span>
                <input value={memoryEvidenceFilters.query} maxLength={500}
                  placeholder="摘录、消息 ID、发送者或会话"
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    query: event.target.value
                  }))} />
              </label>
              <label>
                <span>来源</span>
                <select value={memoryEvidenceFilters.source}
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    source: event.target.value
                  }))}>
                  <option value="">全部来源</option>
                  <option value="wechat">微信</option>
                  <option value="documents">本机文档</option>
                  <option value="calendar">日历</option>
                  <option value="mail">邮件</option>
                  <option value="legacy">历史来源未知</option>
                </select>
              </label>
              <label>
                <span>证据性质</span>
                <select value={memoryEvidenceFilters.role}
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    role: event.target.value as MemoryEvidenceArchiveFilters['role']
                  }))}>
                  <option value="">全部性质</option>
                  <option value="direct">直接证据</option>
                  <option value="indirect">间接证据</option>
                  <option value="contradiction">反证</option>
                  <option value="support">历史支持证据</option>
                  <option value="original">未分类原文</option>
                </select>
              </label>
              <label>
                <span>会话 ID</span>
                <input value={memoryEvidenceFilters.session} maxLength={500}
                  placeholder="支持片段匹配"
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    session: event.target.value
                  }))} />
              </label>
              <label>
                <span>发送者</span>
                <input value={memoryEvidenceFilters.sender} maxLength={200}
                  placeholder="姓名或备注片段"
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    sender: event.target.value
                  }))} />
              </label>
              <label>
                <span>开始时间（上海）</span>
                <input type="datetime-local" value={memoryEvidenceFilters.from}
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    from: event.target.value
                  }))} />
              </label>
              <label>
                <span>结束时间（上海）</span>
                <input type="datetime-local" value={memoryEvidenceFilters.to}
                  onChange={event => setMemoryEvidenceFilters(current => ({
                    ...current,
                    to: event.target.value
                  }))} />
              </label>
              <div className="assistant-evidence-archive-filter-actions">
                <button type="button" onClick={() => {
                  setMemoryEvidenceFilters(EMPTY_MEMORY_EVIDENCE_FILTERS)
                  void openMemoryEvidenceArchive(
                    memoryEvidenceArchive.documentType,
                    memoryEvidenceArchive.sourceId,
                    memoryEvidenceArchive.title,
                    EMPTY_MEMORY_EVIDENCE_FILTERS
                  )
                }}>清除筛选</button>
                <button className="primary" type="submit"
                  disabled={memoryEvidenceArchive.status === 'loading'}>应用筛选</button>
              </div>
            </form>
            <div className="assistant-evidence-archive-list">
              {memoryEvidenceArchive.items.map((rawEvidence, index) => {
                const evidence = normalizeMemoryEvidence(rawEvidence)
                const localMessageId = evidenceLocalMessageId(evidence)
                const role = evidence.role === 'indirect' ? '间接证据'
                  : evidence.role === 'contradiction' ? '反证'
                    : evidence.role === 'direct' ? '直接证据' : '原文'
                return <article key={`${evidence.sourceId}-${evidence.sessionId}-${evidence.messageId}-${index}`}>
                  <header>
                    <span>{role} · {memoryEvidenceSourceLabel(evidence)} · {evidence.sender || '发送者未标注'} · {evidenceTime(evidence.timestamp)}</span>
                    {evidence.sessionId && localMessageId && <button onClick={() =>
                      void window.electronAPI.window.openChatHistoryWindow(evidence.sessionId, localMessageId)}>
                      打开原消息
                    </button>}
                  </header>
                  <p>“{evidence.excerpt || '原文摘录为空'}”</p>
                </article>
              })}
              {memoryEvidenceArchive.status === 'ready' && !memoryEvidenceArchive.items.length &&
                <div className="assistant-empty">
                  {memoryEvidenceArchive.unfilteredTotal
                    ? '当前筛选没有匹配原文；可以清除条件查看完整证据。'
                    : '该记忆当前没有可展示的原文证据。'}
                </div>}
            </div>
            <div className="assistant-modal-actions">
              <button onClick={closeMemoryEvidenceArchive}>关闭</button>
              {memoryEvidenceArchive.status === 'error' && <button className="primary" onClick={() =>
                void openMemoryEvidenceArchive(
                  memoryEvidenceArchive.documentType,
                  memoryEvidenceArchive.sourceId,
                  memoryEvidenceArchive.title,
                  memoryEvidenceArchive.filters
                )}>重试</button>}
              {memoryEvidenceArchive.status === 'ready' && memoryEvidenceArchive.hasMore &&
                <button className="primary" disabled={memoryEvidenceLoadingMore}
                  onClick={() => void loadMoreMemoryEvidence()}>
                  {memoryEvidenceLoadingMore ? '正在加载…' : '加载更早证据'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {showEntityDossier && selectedEntity && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-entity-dossier-modal">
            <header>
              <div>
                <span className="assistant-eyebrow">{selectedEntity.type.toUpperCase()} DOSSIER</span>
                <h2>{selectedEntity.canonicalName}</h2>
                <small>{selectedEntity.trustStatus === 'confirmed' ? '已确认实体' : selectedEntity.trustStatus === 'candidate' ? '待确认实体，不参与可信检索' : selectedEntity.trustStatus === 'legacy_unverified' ? '历史未验证实体，不参与可信检索' : '已拒绝实体'}</small>
                <p>{selectedEntity.summary || '等待更多可靠证据补充人物摘要。'}</p>
                <small>{selectedEntity.summaryStatus === 'confirmed' ? '已确认摘要' : selectedEntity.summaryStatus === 'legacy_unverified' ? '历史未验证摘要，不参与可信检索' : '尚无已确认摘要'}</small>
              </div>
              <button aria-label="关闭人物档案" onClick={() => setShowEntityDossier(false)}><X size={18} /></button>
            </header>
            <div className="assistant-dossier-identity">
              <span><small>别名</small><b>{selectedEntity.aliases?.join('、') || '暂无'}</b></span>
              <span><small>微信身份锚点</small><b>{selectedEntity.accountIds?.join('、') || '尚未关联'}</b></span>
              <span><small>邮箱身份锚点</small><b>{selectedEntity.externalIdentities?.filter((identity: any) => identity.platform === 'email').map((identity: any) => identity.accountId).join('、') || '尚未关联'}</b></span>
              <span><small>关联原文档案</small><b>{Number(entityEvidencePage.unfilteredTotal || 0)} 条</b></span>
              <span><small>身份版本</small><b>v{selectedEntity.identityVersion || 1}</b></span>
            </div>
            {selectedEntityInsight && <div className="assistant-dossier-metrics">
              <span><b>{selectedEntityInsight.strength}</b><small>关系强度 · {selectedEntityInsight.strengthLabel}</small></span>
              <span><b>{selectedEntityInsight.evidenceCount}</b><small>去重证据</small></span>
              <span><b>{selectedEntityTasks.filter(task => !['done', 'cancelled'].includes(task.status)).length}</b><small>进行中事项</small></span>
              <span><b>{selectedEntityInsight.pendingCommitmentCount}</b><small>待确认承诺</small></span>
            </div>}
            <div className="assistant-dossier-grid">
              <section>
                <h3>结构化事实 <small>{Number(entityDossierPages.claims?.total || 0)}</small></h3>
                <div className="assistant-inline-filters assistant-inline-filters-wide">
                  <input value={entityClaimQuery} onChange={event => setEntityClaimQuery(event.target.value)}
                    placeholder="搜索属性、值或对象" />
                  <select value={entityClaimStatus} onChange={event => setEntityClaimStatus(event.target.value as any)}>
                    <option value="all">有效状态</option><option value="confirmed">已确认</option>
                    <option value="candidate">待确认</option><option value="rejected">已拒绝</option>
                  </select>
                  <select value={entityClaimSource} onChange={event => setEntityClaimSource(event.target.value as any)}>
                    <option value="all">全部来源</option><option value="wechat">微信</option>
                    <option value="documents">本机文档</option><option value="calendar">日历</option>
                    <option value="mail">Mail</option><option value="legacy">历史未知来源</option>
                  </select>
                  <input aria-label="事实有效期从" title="事实有效期从" type="date"
                    value={entityClaimFrom} onChange={event => setEntityClaimFrom(event.target.value)} />
                  <input aria-label="事实有效期到" title="事实有效期到" type="date"
                    value={entityClaimTo} onChange={event => setEntityClaimTo(event.target.value)} />
                </div>
                {entityDossierPages.claims?.status === 'loading' && <em>正在检索事实…</em>}
                {entityDossierPages.claims?.status === 'error' && <em>
                  事实读取失败：{entityDossierPages.claims.error}
                  <button onClick={() => refreshEntityDossierSection('claims')}>重试</button>
                </em>}
                {dossierClaims.map((claim: any) => <article key={claim.id}>
                  <div><b>{claim.polarity === 'negative' ? '并非 ' : ''}{claim.predicate}</b><span>{claim.object_entity_name || claim.object_value || '待确认'}</span></div>
                  <small>{claim.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(claim.confidence || 0) * 100)}% · {claim.source_nature === 'self_statement' ? '本人陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : '模型推断'} · {memorySourceLabels(claim)}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={claim.evidence}
                    total={claim.evidence_count} roleLabels onOpenArchive={() =>
                      void openMemoryEvidenceArchive(
                        'claim', claim.id, `${selectedEntity?.canonicalName || '人物'} · ${claim.predicate}`
                      )} /></div>
                </article>)}
                {entityDossierPages.claims?.status === 'ready' && !dossierClaims.length && <em>当前范围内没有结构化事实</em>}
                {entityDossierPages.claims?.hasMore && <button
                  disabled={!!entityDossierLoadingMore.claims}
                  onClick={() => void loadMoreEntityDossierSection('claims')}>
                  {entityDossierLoadingMore.claims
                    ? '正在加载…'
                    : `加载更多事实（已显示 ${dossierClaims.length} / ${entityDossierPages.claims.total}）`}
                </button>}
              </section>
              <section>
                <h3>关系与证据 <small>{Number(entityDossierPages.relations?.total || 0)}</small></h3>
                <div className="assistant-inline-filters">
                  <input value={entityRelationQuery}
                    onChange={event => setEntityRelationQuery(event.target.value)}
                    placeholder="搜索关系类型或关联实体" />
                  <select value={entityRelationDirection}
                    onChange={event => setEntityRelationDirection(event.target.value as any)}>
                    <option value="all">全部方向</option>
                    <option value="outgoing">由我指向</option>
                    <option value="incoming">指向我</option>
                  </select>
                  <select value={entityRelationStatus}
                    onChange={event => setEntityRelationStatus(event.target.value as any)}>
                    <option value="all">全部状态</option>
                    <option value="confirmed">已确认</option>
                    <option value="candidate">待确认</option>
                  </select>
                  <select value={entityRelationSource}
                    onChange={event => setEntityRelationSource(event.target.value as any)}>
                    <option value="all">全部来源</option><option value="wechat">微信</option>
                    <option value="documents">本机文档</option><option value="calendar">日历</option>
                    <option value="mail">Mail</option><option value="legacy">历史未知来源</option>
                  </select>
                </div>
                {entityDossierPages.relations?.status === 'loading' && <em>正在检索关系…</em>}
                {entityDossierPages.relations?.status === 'error' && <em>
                  关系读取失败：{entityDossierPages.relations.error}
                  <button onClick={() => refreshEntityDossierSection('relations')}>重试</button>
                </em>}
                {dossierRelations.map((relation: any) => {
                  const outgoing = relation.subjectId === selectedEntity.id
                  const neighborId = outgoing ? relation.objectId : relation.subjectId
                  const neighborName = outgoing ? relation.object_name : relation.subject_name
                  return <article key={relation.id}>
                    <button className="assistant-dossier-link" onClick={() => setSelectedEntityId(neighborId)}>
                      <b>{outgoing ? relation.predicate : `被${relation.predicate}`}</b><span>{neighborName || selectedEntityNames[neighborId] || neighborId}</span>
                    </button>
                    <small>{relation.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(relation.confidence || 0) * 100)}% · {memorySourceLabels(relation)}</small>
                    <div className="assistant-evidence-stack"><EvidenceRows evidence={relation.evidence}
                      total={relation.evidenceTotal} onOpenArchive={() =>
                        void openMemoryEvidenceArchive(
                          'relation', relation.id,
                          `${relation.subject_name || relation.subjectId} · ${relation.predicate} · ${relation.object_name || relation.objectId}`
                        )} /></div>
                    <button className="assistant-dossier-task-action danger" onClick={() => void permanentlyDeleteMemoryItem('relation', relation)}>永久删除关系</button>
                  </article>
                })}
                {entityDossierPages.relations?.status === 'ready' && !dossierRelations.length && <em>当前范围内没有关系</em>}
                {entityDossierPages.relations?.hasMore && <button
                  disabled={!!entityDossierLoadingMore.relations}
                  onClick={() => void loadMoreEntityDossierSection('relations')}>
                  {entityDossierLoadingMore.relations
                    ? '正在加载…'
                    : `加载更多关系（已显示 ${dossierRelations.length} / ${entityDossierPages.relations.total}）`}
                </button>}
              </section>
              <section>
                <h3>事件时间线 <small>{Number(entityDossierPages.events?.total || 0)}</small></h3>
                <div className="assistant-inline-filters assistant-inline-filters-wide">
                  <input value={entityEventQuery} onChange={event => setEntityEventQuery(event.target.value)}
                    placeholder="搜索标题、说明、类型或地点" />
                  <select value={entityEventStatus} onChange={event => setEntityEventStatus(event.target.value as any)}>
                    <option value="all">有效状态</option><option value="confirmed">已确认</option>
                    <option value="candidate">待确认</option><option value="cancelled">已取消</option>
                    <option value="rejected">已拒绝</option>
                  </select>
                  <select value={entityEventSource} onChange={event => setEntityEventSource(event.target.value as any)}>
                    <option value="all">全部来源</option><option value="wechat">微信</option>
                    <option value="documents">本机文档</option><option value="calendar">日历</option>
                    <option value="mail">Mail</option><option value="legacy">历史未知来源</option>
                  </select>
                  <input aria-label="事件时间从" title="事件时间从" type="date"
                    value={entityEventFrom} onChange={event => setEntityEventFrom(event.target.value)} />
                  <input aria-label="事件时间到" title="事件时间到" type="date"
                    value={entityEventTo} onChange={event => setEntityEventTo(event.target.value)} />
                </div>
                {entityDossierPages.events?.status === 'loading' && <em>正在检索事件…</em>}
                {entityDossierPages.events?.status === 'error' && <em>
                  事件读取失败：{entityDossierPages.events.error}
                  <button onClick={() => refreshEntityDossierSection('events')}>重试</button>
                </em>}
                {dossierEvents.map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.start_at || '时间待确认'}</span></div>
                  {event.description && <p>{event.description}</p>}
                  <small>{event.event_type} · {event.status === 'confirmed' ? '已确认' : '待确认'} · {event.location || '地点未记录'} · {memorySourceLabels(event)}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={event.evidence}
                    total={event.evidence_count} onOpenArchive={() =>
                      void openMemoryEvidenceArchive('event', event.id, event.title || '事件原文')} /></div>
                </article>)}
                {entityDossierPages.events?.status === 'ready' && !dossierEvents.length && <em>当前范围内没有相关事件</em>}
                {entityDossierPages.events?.hasMore && <button
                  disabled={!!entityDossierLoadingMore.events}
                  onClick={() => void loadMoreEntityDossierSection('events')}>
                  {entityDossierLoadingMore.events
                    ? '正在加载…'
                    : `加载更多事件（已显示 ${dossierEvents.length} / ${entityDossierPages.events.total}）`}
                </button>}
              </section>
              <section>
                <h3>关联事项 <small>{Number(graphWorkspace.focus?.taskTotal ?? selectedEntityTasks.length)}</small></h3>
                {selectedEntityTasks.map(task => <article key={task.id}>
                  <div>
                    <b>{task.title}</b><span>{task.status}</span>
                  </div>
                  <small>{task.taskKind || 'action'} · {task.owner || '负责人待确认'} · {task.due || '无截止时间'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={task.evidence}
                    total={(task as any).evidenceTotal} onOpenArchive={() =>
                      void openMemoryEvidenceArchive('task', task.id, task.title)} /></div>
                  {!['cancelled'].includes(task.status) && <button className="assistant-dossier-task-action" onClick={() => void toggleTask(task)}>
                    {task.status === 'done' ? '恢复为待处理' : '标记完成'}
                  </button>}
                </article>)}
                {!selectedEntityTasks.length && <em>尚无关联事项</em>}
                {graphWorkspace.focus?.taskHasMore && <button
                  disabled={entityTaskLoadingMore}
                  onClick={() => void loadMoreEntityTasks()}>
                  {entityTaskLoadingMore
                    ? '正在加载…'
                    : `加载更多关联事项（已显示 ${selectedEntityTasks.length} / ${graphWorkspace.focus.taskTotal}）`}
                </button>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>人物相关原文档案 <small>{Number(entityEvidencePage.total || 0)} / {Number(entityEvidencePage.unfilteredTotal || 0)}</small></h3>
                <p>汇总人物首次出现、身份锚点，以及事实、关系和事件中与此实体直接关联的去重原文。</p>
                <div className="assistant-inline-filters">
                  <input value={entityEvidenceQuery}
                    onChange={event => setEntityEvidenceQuery(event.target.value)}
                    placeholder="搜索发送者、原文或会话 ID" />
                  <select value={entityEvidenceSource}
                    onChange={event => setEntityEvidenceSource(event.target.value)}>
                    <option value="">全部来源</option>
                    <option value="wechat">微信</option>
                    <option value="documents">本机文档</option>
                    <option value="calendar">日历</option>
                    <option value="mail">邮件</option>
                    <option value="legacy">历史来源未知</option>
                  </select>
                </div>
                {entityEvidencePage.status === 'loading' && <em>正在读取相关原文…</em>}
                {entityEvidencePage.status === 'error' && <div className="assistant-empty">
                  相关原文读取失败：{entityEvidencePage.error}
                  <button onClick={() => setEntityEvidenceRefreshKey(value => value + 1)}>重试</button>
                </div>}
                {entityEvidencePage.items.map((evidence: any) => <article
                  key={evidenceArchiveIdentity(evidence)}>
                  <small>用于：{(evidence.memoryKinds || []).map((kind: string) =>
                    kind === 'identity' ? '身份识别' : kind === 'claim' ? '事实'
                      : kind === 'relation' ? '关系' : '事件').join('、') || '结构化记忆'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={[evidence]} /></div>
                </article>)}
                {entityEvidencePage.status === 'ready' && !entityEvidencePage.items.length &&
                  <em>{entityEvidencePage.unfilteredTotal ? '当前筛选没有匹配原文' : '尚无相关结构化原文'}</em>}
                {entityEvidencePage.hasMore && <button disabled={entityEvidenceLoadingMore}
                  onClick={() => void loadMoreEntityEvidence()}>
                  {entityEvidenceLoadingMore
                    ? '正在加载…'
                    : `加载更多原文（已显示 ${entityEvidencePage.items.length} / ${entityEvidencePage.total}）`}
                </button>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>关系变化历史 <small>{graphWorkspace.focus?.auditPages?.relationHistory?.total ?? selectedEntityRelationHistory.length}</small></h3>
                {selectedEntityRelationHistory.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.subject_name || item.subject_id} — {item.predicate} → {item.object_name || item.object_id}</b>
                    <span>{item.change_type === 'created' ? '首次发现' : item.change_type === 'status_changed' ? '可信状态变化' : '证据更新'}</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · {item.status} · {Math.round(Number(item.confidence || 0) * 100)}%</small>
                </article>)}
                {!selectedEntityRelationHistory.length && <em>尚无关系变化历史</em>}
                {graphWorkspace.focus?.auditPages?.relationHistory?.hasMore && <button
                  disabled={!!entityAuditLoadingMore}
                  onClick={() => void loadMoreEntityAudit('relationHistory', 'relation_history')}>
                  {entityAuditLoadingMore === 'relationHistory'
                    ? '正在加载…'
                    : `加载更多关系变化（已显示 ${selectedEntityRelationHistory.length} / ${graphWorkspace.focus.auditPages.relationHistory.total}）`}
                </button>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>身份名称修正 <small>{graphWorkspace.focus?.auditPages?.entityCorrections?.total ?? selectedEntityCorrections.length}</small></h3>
                {selectedEntityCorrections.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.before_name} → {item.after_name}</b><span>人工确认实体时修正</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原错误名称未写入可信别名</small>
                </article>)}
                {!selectedEntityCorrections.length && <em>尚无名称修正记录</em>}
                {graphWorkspace.focus?.auditPages?.entityCorrections?.hasMore && <button
                  disabled={!!entityAuditLoadingMore}
                  onClick={() => void loadMoreEntityAudit('entityCorrections', 'name_correction')}>
                  {entityAuditLoadingMore === 'entityCorrections'
                    ? '正在加载…'
                    : `加载更多名称修正（已显示 ${selectedEntityCorrections.length} / ${graphWorkspace.focus.auditPages.entityCorrections.total}）`}
                </button>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>关系人工修正 <small>{graphWorkspace.focus?.auditPages?.relationCorrections?.total ?? selectedEntityRelationCorrections.length}</small></h3>
                {selectedEntityRelationCorrections.map((item: any) => {
                  const entityName = (id: string, fallback = '') => fallback || selectedEntityNames[id] || id
                  return <article key={item.id} className="assistant-dossier-history-row">
                    <div><b>{entityName(item.before_subject_id, item.before_subject_name)} — {item.before_predicate} → {entityName(item.before_object_id, item.before_object_name)}</b><span>修正为</span></div>
                    <div><b>{entityName(item.after_subject_id, item.after_subject_name)} — {item.after_predicate} → {entityName(item.after_object_id, item.after_object_name)}</b></div>
                    <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原文证据已迁移至修正后关系</small>
                  </article>
                })}
                {!selectedEntityRelationCorrections.length && <em>尚无关系人工修正记录</em>}
                {graphWorkspace.focus?.auditPages?.relationCorrections?.hasMore && <button
                  disabled={!!entityAuditLoadingMore}
                  onClick={() => void loadMoreEntityAudit('relationCorrections', 'relation_correction')}>
                  {entityAuditLoadingMore === 'relationCorrections'
                    ? '正在加载…'
                    : `加载更多关系修正（已显示 ${selectedEntityRelationCorrections.length} / ${graphWorkspace.focus.auditPages.relationCorrections.total}）`}
                </button>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>档案字段人工修正 <small>{graphWorkspace.focus?.auditPages?.entityProfileCorrections?.total ?? selectedEntityProfileCorrections.length}</small></h3>
                {selectedEntityProfileCorrections.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.field === 'summary' ? '实体摘要' : '实体别名'}</b><span>模型建议：“{item.suggested_value}”</span></div>
                  <div><b>人工最终值</b><span>“{item.final_value}”</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原文证据仍绑定原候选</small>
                </article>)}
                {!selectedEntityProfileCorrections.length && <em>尚无摘要或别名修正记录</em>}
                {graphWorkspace.focus?.auditPages?.entityProfileCorrections?.hasMore && <button
                  disabled={!!entityAuditLoadingMore}
                  onClick={() => void loadMoreEntityAudit('entityProfileCorrections', 'profile_correction')}>
                  {entityAuditLoadingMore === 'entityProfileCorrections'
                    ? '正在加载…'
                    : `加载更多档案字段修正（已显示 ${selectedEntityProfileCorrections.length} / ${graphWorkspace.focus.auditPages.entityProfileCorrections.total}）`}
                </button>}
              </section>
            </div>
            <footer>
              <button onClick={() => {
                setMemoryEntityFilter(selectedEntity.id)
                setMemoryQuery(selectedEntity.canonicalName)
                setShowEntityDossier(false)
              }}>在统一记忆中检索此实体</button>
              <button className="primary" onClick={() => setShowEntityDossier(false)}>完成</button>
            </footer>
          </div>
        </div>
      )}

      {selectedProjectId && projectWorkspace.status === 'loading' && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-project-modal assistant-project-state">
            <header><div><span className="assistant-eyebrow">PROJECT DOSSIER</span><h2>正在加载项目档案…</h2></div>
              <button aria-label="关闭项目详情" onClick={() => setSelectedProjectId('')}><X size={18} /></button></header>
            <div className="assistant-empty">正在本机聚合任务、可信关系、事实、事件和有界原文证据。</div>
          </div>
        </div>
      )}

      {selectedProjectId && projectWorkspace.status === 'error' && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-project-modal assistant-project-state">
            <header><div><span className="assistant-eyebrow">PROJECT DOSSIER</span><h2>项目档案读取失败</h2></div>
              <button aria-label="关闭项目详情" onClick={() => setSelectedProjectId('')}><X size={18} /></button></header>
            <div className="assistant-empty">{projectWorkspace.error}</div>
            <footer><button onClick={() => setProjectWorkspaceRefreshKey(value => value + 1)}>重试</button></footer>
          </div>
        </div>
      )}

      {selectedProject && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-project-modal">
            <header>
              <div><span className="assistant-eyebrow">PROJECT DOSSIER</span><h2>{selectedProject.name}</h2>
                <p>{selectedProject.summary || '这是由结构化记忆自动聚合的项目视图，所有结论均来自下方任务、事件、关系和原文证据。'}</p></div>
              <button aria-label="关闭项目详情" onClick={() => setSelectedProjectId('')}><X size={18} /></button>
            </header>
            <div className="assistant-dossier-metrics">
              <span><b>{selectedProject.progress}%</b><small>任务完成度</small></span>
              <span><b>{selectedProject.activeTaskCount}</b><small>进行中任务</small></span>
              <span><b>{selectedProject.riskTotal ?? selectedProject.risks.length}</b><small>可解释风险</small></span>
              <span><b>{Number(selectedProject.claimTotal || 0)}</b><small>项目事实</small></span>
              <span><b>{Number(selectedProject.eventTotal || 0)}</b><small>相关事件</small></span>
              <span><b>{selectedProject.evidenceTotal ?? selectedProject.evidence.length}</b><small>去重证据</small></span>
              <span><b>{selectedProject.pendingReview?.total || 0}</b><small>候选待确认</small></span>
            </div>
            {selectedProject.entityId && projectMemoryPages.status === 'loading' && <div className="assistant-query-plan">
              正在从 SQLCipher 按项目实体读取完整事实和事件档案…
            </div>}
            {selectedProject.entityId && projectMemoryPages.status === 'error' && <div className="assistant-query-plan">
              项目事实与事件读取失败：{projectMemoryPages.error}
              <button onClick={() => setProjectMemoryRefreshKey(value => value + 1)}>重试</button>
            </div>}
            {!selectedProject.entityId && <div className="assistant-query-plan">
              这是尚未形成可信项目实体的派生项目；当前仅展示由明确任务项目字段和保守名称规则聚合的内容，
              不会用模糊名称跨项目分页，以免把同名项目混在一起。
            </div>}
            <div className="assistant-dossier-grid">
              <section>
                <h3>参与者 <small>{selectedProject.members.length}</small></h3>
                {selectedProject.members.map((member: any) => <button className="assistant-project-member" key={member.id} onClick={() => {
                  setSelectedEntityId(member.id); setSelectedProjectId(''); setShowEntityDossier(true)
                }}>{member.name}</button>)}
                {!selectedProject.members.length && <em>尚未从项目关系中确认参与者</em>}
              </section>
              <section>
                <h3>风险与阻塞 <small>{selectedProject.riskTotal ?? selectedProject.risks.length}</small></h3>
                {selectedProject.risks.map((risk: any, index: number) => <article key={`${risk.taskId}-${risk.kind}-${index}`} className={`assistant-project-risk ${risk.severity}`}>
                  <div><b>{risk.title}</b><span>{risk.kind}</span></div><small>{risk.detail}</small>
                </article>)}
                {!selectedProject.risks.length && <em>当前没有确定性规则识别出的风险</em>}
                {selectedProject.riskHasMore && <button
                  disabled={projectRiskLoadingMore}
                  onClick={() => void loadMoreProjectRisks()}>
                  {projectRiskLoadingMore
                    ? '正在加载…'
                    : `加载更多风险（已显示 ${selectedProject.risks.length} / ${selectedProject.riskTotal}）`}
                </button>}
              </section>
              <section>
                <h3>项目任务 <small>{selectedProject.taskTotal ?? selectedProject.tasks.length}</small></h3>
                {selectedProject.tasks.map((task: Task) => <article key={task.id}>
                  <div><b>{task.title}</b><span>{task.status}</span></div>
                  <small>{task.owner || '负责人待确认'} · {task.due || '无截止时间'} · {task.priority}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows
                    evidence={(task.evidence || []).slice(-2)} total={(task as any).evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive('task', task.id, task.title)} /></div>
                  {task.status !== 'cancelled' && <button className="assistant-dossier-task-action" onClick={() => void toggleTask(task)}>{task.status === 'done' ? '恢复待处理' : '标记完成'}</button>}
                </article>)}
                {!selectedProject.tasks.length && <em>尚无归入项目的任务</em>}
                {selectedProject.taskHasMore && <button
                  disabled={projectTaskLoadingMore}
                  onClick={() => void loadMoreProjectTasks()}>
                  {projectTaskLoadingMore
                    ? '正在加载…'
                    : `加载更多任务（已显示 ${selectedProject.tasks.length} / ${selectedProject.taskTotal}）`}
                </button>}
              </section>
              <section>
                <h3>项目事实 <small>{selectedProject.entityId
                  ? Number(projectMemoryPages.claims?.total || 0)
                  : projectDossierClaims.length}</small></h3>
                {projectDossierClaims.map((claim: any) => <article key={claim.id}>
                  <div><b>{claim.polarity === 'negative' ? '并非 ' : ''}{claim.predicate}</b>
                    <span>{claim.object_entity_name || claim.object_value || '值待确认'}</span></div>
                  <small>{claim.status === 'confirmed' ? '已确认' : '待确认'} ·
                    {Math.round(Number(claim.confidence || 0) * 100)}% ·
                    {claim.source_nature === 'self_statement' ? '本人陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : '模型推断'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={claim.evidence}
                    total={claim.evidence_count || claim.evidenceTotal} roleLabels
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'claim', claim.id, `${selectedProject.name || '项目'} · ${claim.predicate}`
                    )} /></div>
                </article>)}
                {projectMemoryPages.status !== 'loading' && !projectDossierClaims.length && <em>尚无项目事实</em>}
                {selectedProject.entityId && projectMemoryPages.claims?.hasMore && <button
                  disabled={!!projectMemoryLoadingMore}
                  onClick={() => void loadMoreProjectMemorySection('claims')}>
                  {projectMemoryLoadingMore === 'claims'
                    ? '正在加载…'
                    : `加载更多事实（已显示 ${projectDossierClaims.length} / ${projectMemoryPages.claims.total}）`}
                </button>}
              </section>
              <section>
                <h3>完整项目事件 <small>{selectedProject.entityId
                  ? Number(projectMemoryPages.events?.total || 0)
                  : projectDossierEvents.length}</small></h3>
                {projectDossierEvents.map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.start_at || '时间待确认'}</span></div>
                  {event.description && <p>{event.description}</p>}
                  <small>{event.event_type || 'other'} ·
                    {event.status === 'confirmed' ? '已确认' : event.status === 'cancelled' ? '已取消' : '待确认'} ·
                    {event.location || '地点未记录'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={event.evidence}
                    total={event.evidence_count || event.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'event', event.id, event.title || '项目事件原文'
                    )} /></div>
                </article>)}
                {projectMemoryPages.status !== 'loading' && !projectDossierEvents.length && <em>尚无相关事件</em>}
                {selectedProject.entityId && projectMemoryPages.events?.hasMore && <button
                  disabled={!!projectMemoryLoadingMore}
                  onClick={() => void loadMoreProjectMemorySection('events')}>
                  {projectMemoryLoadingMore === 'events'
                    ? '正在加载…'
                    : `加载更多事件（已显示 ${projectDossierEvents.length} / ${projectMemoryPages.events.total}）`}
                </button>}
              </section>
              <section>
                <h3>关键里程碑与决策 <small>{selectedProject.milestones.length + selectedProject.decisions.length}</small></h3>
                {[...selectedProject.decisions, ...selectedProject.milestones].map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.event_type}</span></div>
                  <small>{event.start_at || '时间待确认'} · {event.status === 'confirmed' ? '已确认' : '待确认'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows
                    evidence={(event.evidence || []).slice(-2)} total={event.evidenceTotal}
                    onOpenArchive={() => void openMemoryEvidenceArchive(
                      'event', event.id, event.title || '里程碑原文'
                    )} /></div>
                </article>)}
                {!selectedProject.milestones.length && !selectedProject.decisions.length && <em>尚无里程碑或决策事件</em>}
              </section>
              {!!selectedProject.pendingReview?.total && <section>
                <h3>候选线索 <small>{selectedProject.pendingReview.total}</small></h3>
                <small className="assistant-evidence">以下内容尚未确认，不参与成员、里程碑、决策或项目事实的确定性统计。</small>
                {Number(selectedProject.pendingReview.authoritativeMemoryTotal || 0) >
                  Number(selectedProject.pendingReview.loadedMemoryTotal || 0) &&
                  <small className="assistant-evidence">
                    当前展示最近 {selectedProject.pendingReview.loadedMemoryTotal} /
                    {selectedProject.pendingReview.authoritativeMemoryTotal} 条项目事实与事件候选；
                    完整候选可在事实档案和事件时间线继续筛选。
                  </small>}
                {selectedProject.pendingReview.relations.map((relation: any) => <article key={relation.id}>
                  <strong>待确认关系 · {relation.predicate}</strong>
                  <small>{Math.round(Number(relation.confidence || 0) * 100)}% 可信</small>
                </article>)}
                {[...selectedProject.pendingReview.decisions, ...selectedProject.pendingReview.milestones].map((event: any) => <article key={event.id}>
                  <strong>待确认{event.event_type === 'decision' ? '决策' : '里程碑'} · {event.title}</strong>
                  <small>{event.start_at || '时间待确认'} · 不计入已确认项目时间线</small>
                </article>)}
                {selectedProject.pendingReview.claims.map((claim: any) => <article key={claim.id}>
                  <strong>待确认事实 · {claim.predicate}</strong>
                  <small>{claim.object_value || '值待确认'}</small>
                </article>)}
              </section>}
              <section className="assistant-dossier-wide">
                <h3>最近原文证据 <small>{selectedProject.evidenceTotal ?? selectedProject.evidence.length}</small></h3>
                <div className="assistant-evidence-stack"><EvidenceRows evidence={selectedProject.evidence?.slice(-12)} total={selectedProject.evidenceTotal} /></div>
              </section>
            </div>
            <footer>
              {selectedProject.entityId && <button onClick={() => {
                void selectMemoryEntityScope(selectedProject.entityId, selectedProject.name).then(() => {
                  setMemoryQuery(selectedProject.name)
                  setSelectedProjectId('')
                })
              }}>在统一记忆中检索</button>}
              <button className="primary" onClick={() => setSelectedProjectId('')}>完成</button>
            </footer>
          </div>
        </div>
      )}

      {showDiagnostics && memoryDiagnostics && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-diagnostics-modal">
            <header><div><span className="assistant-eyebrow">SYSTEM DIAGNOSTICS</span><h2>个人记忆运行诊断</h2>
              <p>最近 20 次增量运行、每个模型批次、失败原因、Token、耗时和成本估算。</p></div>
              <button aria-label="关闭诊断" onClick={() => setShowDiagnostics(false)}><X size={18} /></button>
            </header>
            <div className="assistant-dossier-metrics">
              <span><b>{memoryDiagnostics.ingestionSummary?.runs || 0}</b><small>全部运行</small></span>
              <span><b>{memoryDiagnostics.ingestionSummary?.failedBatches || 0}</b><small>失败批次</small></span>
              <span><b>{Number(memoryDiagnostics.ingestionSummary?.inputTokens || 0).toLocaleString()}</b><small>输入 Token</small></span>
              <span><b>{Number(memoryDiagnostics.ingestionSummary?.outputTokens || 0).toLocaleString()}</b><small>输出 Token</small></span>
            </div>
            <div className="assistant-diagnostics-summary">
              <span>总耗时 <b>{(Number(memoryDiagnostics.ingestionSummary?.durationMs || 0) / 1000).toFixed(1)} 秒</b></span>
              <span>处理消息 <b>{Number(memoryDiagnostics.ingestionSummary?.messages || 0).toLocaleString()} 条</b></span>
              <span>估算成本 <b>{memoryDiagnostics.ingestionSummary?.costConfigured
                ? `¥${Number(memoryDiagnostics.ingestionSummary.estimatedCost || 0).toFixed(4)}`
                : '未配置费率'}</b></span>
              <span>运行结果 <b>{memoryDiagnostics.ingestionSummary?.completedRuns || 0} 完成 / {memoryDiagnostics.ingestionSummary?.partialRuns || 0} 部分 / {memoryDiagnostics.ingestionSummary?.failedRuns || 0} 失败</b></span>
            </div>
            {memoryDiagnostics.structuredEvidenceMigration?.version && <div className="assistant-recovery-audit healthy">
              <header><ShieldCheck size={15} /><span><b>结构化证据身份迁移</b>
                <small>事实、事件和关系按“结构 ID＋来源＋会话＋原消息”建立唯一约束；旧记录的来源与发送者只做可验证回填，不进行猜测。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>证据行 <b>
                  {Number(memoryDiagnostics.structuredEvidenceMigration.evidenceBefore || 0).toLocaleString()}
                  {' → '}
                  {Number(memoryDiagnostics.structuredEvidenceMigration.evidenceAfter || 0).toLocaleString()}
                </b></span>
                <span>移除重复 <b>{Number(memoryDiagnostics.structuredEvidenceMigration.duplicatesRemoved || 0).toLocaleString()}</b></span>
                <span>有发送者 <b>
                  {Number(memoryDiagnostics.structuredEvidenceMigration.sendersBefore || 0).toLocaleString()}
                  {' → '}
                  {Number(memoryDiagnostics.structuredEvidenceMigration.sendersAfter || 0).toLocaleString()}
                </b></span>
                <span>来源回填 <b>{Number(memoryDiagnostics.structuredEvidenceMigration.sourceRowsBackfilledTotal || 0).toLocaleString()}</b></span>
                <span>来源身份 <b>{memoryDiagnostics.structuredEvidenceMigration.sourceIdentity === true ? '正常' : '待迁移'}</b></span>
                <span>唯一约束 <b>{memoryDiagnostics.structuredEvidenceMigration.constraintsHealthy === false ? '异常' : '正常'}</b></span>
                <span>启动自愈 <b>{Number(memoryDiagnostics.structuredEvidenceMigration.constraintDriftRepairs || 0).toLocaleString()}</b> 次</span>
                <span>迁移时间 <b>{memoryDiagnostics.structuredEvidenceMigration.migratedAt
                  ? new Date(memoryDiagnostics.structuredEvidenceMigration.migratedAt).toLocaleString('zh-CN')
                  : '未知'}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.structuredEvidenceReferences?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.referentialIntegrityHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>结构化证据引用完整性</b>
                <small>关系或事件删除时同步删除其原文证据；每次启动独立扫描历史孤儿引用，不依赖普通 SQLite 文件完整性检查。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.referentialIntegrityHealthy ? '完整' : '需要检查'}</b></span>
                <span>外键异常 <b>{Number(memoryDiagnostics.foreignKeyViolations || 0).toLocaleString()}</b></span>
                <span>累计清理孤儿 <b>{Number(memoryDiagnostics.structuredEvidenceReferences.orphansRemovedTotal || 0).toLocaleString()}</b></span>
                <span>删除保护修复 <b>{Number(memoryDiagnostics.structuredEvidenceReferences.triggerRepairs || 0).toLocaleString()}</b> 次</span>
                <span>本次检查 <b>{memoryDiagnostics.structuredEvidenceReferences.checkedAt
                  ? new Date(memoryDiagnostics.structuredEvidenceReferences.checkedAt).toLocaleString('zh-CN')
                  : '未知'}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.genericSearchEvidenceIdentity?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.genericSearchEvidenceIdentityHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>通用搜索证据身份与引用完整性</b>
                <small>资源、待办等证据以“文档＋来源＋会话＋消息”作为唯一身份，并由 SQLCipher 级联外键和自愈删除保护共同防止孤儿原文；会话消息索引也会在启动时核验。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.genericSearchEvidenceIdentityHealthy ? '约束正常' : '需要检查'}</b></span>
                <span>来源身份 <b>{memoryDiagnostics.genericSearchEvidenceIdentity.sourceIdentity ? '已持久化' : '缺失'}</b></span>
                <span>级联外键 <b>{memoryDiagnostics.genericSearchEvidenceIdentity.foreignKeyCascade ? '正常' : '缺失'}</b></span>
                <span>消息定位索引 <b>{memoryDiagnostics.genericSearchEvidenceIdentity.lookupIndexHealthy ? '正常' : '缺失'}</b></span>
                <span>本次检查行数 <b>{Number(memoryDiagnostics.genericSearchEvidenceIdentity.rowsAfter || 0).toLocaleString()}</b></span>
                <span>累计迁移 <b>{Number(memoryDiagnostics.genericSearchEvidenceIdentity.migrationsTotal || 0).toLocaleString()}</b> 次</span>
                <span>来源回填 <b>{Number(memoryDiagnostics.genericSearchEvidenceIdentity.sourceRowsBackfilledTotal || 0).toLocaleString()}</b></span>
                <span>累计去重 <b>{Number(memoryDiagnostics.genericSearchEvidenceIdentity.duplicatesRemovedTotal || 0).toLocaleString()}</b></span>
                <span>累计清理孤儿 <b>{Number(memoryDiagnostics.genericSearchEvidenceIdentity.orphanRowsRemovedTotal || 0).toLocaleString()}</b></span>
                <span>本次检查 <b>{memoryDiagnostics.genericSearchEvidenceIdentity.checkedAt
                  ? new Date(memoryDiagnostics.genericSearchEvidenceIdentity.checkedAt).toLocaleString('zh-CN')
                  : '未知'}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.structuredSearchIndex?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.structuredSearchIndexHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><Search size={15} /><span><b>记忆本体与检索索引对账</b>
                <small>事实、关系、事件和资源与全文/向量文档双向核对：删除幽灵结果，重建存在但搜不到的记忆；原文仍从保留证据角色的权威表读取。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.structuredSearchIndexHealthy ? '一致' : '需要检查'}</b></span>
                <span>累计删除幽灵 <b>{Number(memoryDiagnostics.structuredSearchIndex.ghostRowsRemovedTotal || 0).toLocaleString()}</b></span>
                <span>累计重建缺失 <b>{Number(memoryDiagnostics.structuredSearchIndex.missingDocumentsRebuiltTotal || 0).toLocaleString()}</b></span>
                <span>累计修复权威正文 <b>{Number(memoryDiagnostics.structuredSearchIndex.structuredDocumentsRepairedTotal || 0).toLocaleString()}</b></span>
                <span>累计修复 FTS <b>{Number(memoryDiagnostics.structuredSearchIndex.ftsPayloadsRebuiltTotal || 0).toLocaleString()}</b></span>
                <span>累计清理 ANN 孤儿 <b>{Number(memoryDiagnostics.structuredSearchIndex.orphanAnnRowsRemovedTotal || 0).toLocaleString()}</b></span>
                <span>累计修复可信元数据 <b>{Number(memoryDiagnostics.structuredSearchIndex.metadataDocumentsRepairedTotal || 0).toLocaleString()}</b></span>
                <span>累计修复资源文档 <b>{Number(memoryDiagnostics.structuredSearchIndex.resourceDocumentsRepairedTotal || 0).toLocaleString()}</b></span>
                <span>累计修复实体文档 <b>{Number(memoryDiagnostics.structuredSearchIndex.entityDocumentsRepairedTotal || 0).toLocaleString()}</b></span>
                <span>删除保护修复 <b>{Number(memoryDiagnostics.structuredSearchIndex.triggerRepairs || 0).toLocaleString()}</b> 次</span>
                <span>本次检查 <b>{memoryDiagnostics.structuredSearchIndex.checkedAt
                  ? new Date(memoryDiagnostics.structuredSearchIndex.checkedAt).toLocaleString('zh-CN')
                  : '未知'}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.memorySearchRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.memorySearchRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><Search size={15} /><span><b>检索分页一致性保护</b>
                <small>搜索文档、原文证据、相关性反馈和向量索引任一发生变化都会推进加密数据库 revision；翻页期间若版本变化，旧页会被拒绝并自动从第一页重新检索，避免混合新旧排序。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.memorySearchRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.memorySearchRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.memorySearchRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.memorySearchRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.memorySearchFeedbackArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.memorySearchFeedbackArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>检索反馈档案分页与删除保护</b>
                <small>有用、无关、撤销和永久清理会推进独立 SQLCipher revision；旧分页会自动重载，删除确认若不再对应刚才预览的范围则必须重新预览，避免误删新增判断。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.memorySearchFeedbackArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.memorySearchFeedbackArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.memorySearchFeedbackArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.memorySearchFeedbackArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.memoryDeletionAuditRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.memoryDeletionAuditRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>删除与不重要清理档案分页保护</b>
                <small>每次永久删除、不重要清理或审计维护都会推进独立 SQLCipher revision；后台新增记录时旧分页会被拒绝并自动回到最新第一页，避免数据自主权账本漏项或重复。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.memoryDeletionAuditRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.memoryDeletionAuditRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.memoryDeletionAuditRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.memoryDeletionAuditRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.memoryEvidenceArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.memoryEvidenceArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>完整原文证据分页一致性保护</b>
                <small>通用证据与事实、事件、关系的权威原文共享 SQLCipher revision；增量补证据、发送者修复、反证加入或记忆删除发生时，旧证据页会被拒绝并自动从最新第一页重载。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.memoryEvidenceArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.memoryEvidenceArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.memoryEvidenceArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.memoryEvidenceArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.structuredMemoryRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.structuredMemoryRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>事实与事件审阅分页保护</b>
                <small>事实、事件、原文证据、参与者、人物名称、纠正和人工决定共享单调 revision；后台抽取或人工修改发生在翻页期间时，旧页会被拒绝并自动刷新，避免档案漏项或重复。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.structuredMemoryRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.structuredMemoryRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.structuredMemoryRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.structuredMemoryRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.resourceArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.resourceArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>资源库与回收站分页保护</b>
                <small>资源正文、原文证据和回收站快照共享 SQLCipher revision；后台解析、补充原文、删除或恢复发生时，旧目录和已展开详情会被拒绝，不会拼接不同时态。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.resourceArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.resourceArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.resourceArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.resourceArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.graphReviewRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.graphReviewRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>图谱审阅分页一致性保护</b>
                <small>候选队列、实体、关系和关系纠正共享数据库 revision；后台新增候选、确认/拒绝、关系纠正或身份合并发生在翻页期间时，旧页会被拒绝并自动回到最新第一页。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.graphReviewRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.graphReviewRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.graphReviewRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.graphReviewRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.taskArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.taskArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>历史任务分页一致性保护</b>
                <small>任务目录、任务原文证据和修改历史共享数据库 revision；状态恢复、证据补齐或人工编辑发生在翻页期间时，旧页会被拒绝并自动刷新，避免历史行动重复、漏项或显示过期计数。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.taskArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.taskArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.taskArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.taskArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.taskOwnershipReviewRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.taskOwnershipReviewRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>任务归属审阅分页一致性保护</b>
                <small>待确认任务、原文证据、任务历史、归属决定和撤销记录共享数据库 revision；候选目录、完整决策档案及单条动作历史在确认、拒绝、撤销或后台重抽取后都会拒绝旧页并自动刷新。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.taskOwnershipReviewRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.taskOwnershipReviewRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.taskOwnershipReviewRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.taskOwnershipReviewRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.identityMergeArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.identityMergeArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>身份合并档案分页一致性保护</b>
                <small>每次身份合并、撤销或实体遗忘清理都会推进 SQLCipher revision；翻页期间档案发生变化时，旧页会被拒绝并自动刷新，避免显示已经失效的“可撤销”状态。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.identityMergeArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.identityMergeArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.identityMergeArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.identityMergeArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.ingestionArchiveRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.ingestionArchiveRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>增量运行与批次分页一致性保护</b>
                <small>运行状态和批次开始、完成、失败、恢复都会推进共享 SQLCipher revision；同步进行中查看全历史或批次明细时，旧分页会被拒绝并自动重新载入，避免混合不同处理时态。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.ingestionArchiveRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.ingestionArchiveRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.ingestionArchiveRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.ingestionArchiveRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.ingestionRecoveryRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.ingestionRecoveryRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>断电恢复队列分页一致性保护</b>
                <small>prepared 批次新增、恢复失败重排、成功提交或清理都会推进独立 SQLCipher revision；自动恢复和手动重试期间，旧分页会被拒绝并重新读取，避免重复或遗漏待恢复批次。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.ingestionRecoveryRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.ingestionRecoveryRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.ingestionRecoveryRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.ingestionRecoveryRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.assistantHistoryRevision?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.assistantHistoryRevisionHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><ShieldCheck size={15} /><span><b>可信问答历史分页一致性保护</b>
                <small>会话、消息、逐陈述依赖、人工核验决定及当前检索证据共享 SQLCipher revision；新问答或证据纠正、拒绝、删除发生时，旧会话页、消息页和核验页都会被拒绝并自动重载。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.assistantHistoryRevisionHealthy ? '保护正常' : '需要检查'}</b></span>
                <span>当前 revision <b>{String(memoryDiagnostics.assistantHistoryRevision.revision || '0')}</b></span>
                <span>变更触发器 <b>{Number(memoryDiagnostics.assistantHistoryRevision.installedTriggers || 0).toLocaleString()} / {Number(memoryDiagnostics.assistantHistoryRevision.expectedTriggers || 0).toLocaleString()}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.taskSearchIndex?.version && <div className={`assistant-recovery-audit ${memoryDiagnostics.taskSearchIndexHealthy ? 'healthy' : 'unhealthy'}`}>
              <header><Search size={15} /><span><b>待办目录与检索派生数据对账</b>
                <small>每次同步以加密待办目录和当前任务证据为权威，核验搜索正文、范围元数据与证据数量；断电留下的半写入结果会在启动同步时事务化重建。</small>
              </span></header>
              <div className="assistant-recovery-current">
                <span>当前状态 <b>{memoryDiagnostics.taskSearchIndexHealthy ? '一致' : '需要检查'}</b></span>
                <span>权威待办 <b>{Number(memoryDiagnostics.taskSearchIndex.authoritativeTasks || 0).toLocaleString()}</b></span>
                <span>累计修复派生文档 <b>{Number(memoryDiagnostics.taskSearchIndex.repairedDerivedDocumentsTotal || 0).toLocaleString()}</b></span>
                <span>其中缺失文档 <b>{Number(memoryDiagnostics.taskSearchIndex.repairedMissingDocumentsTotal || 0).toLocaleString()}</b></span>
                <span>证据集合修复 <b>{Number(memoryDiagnostics.taskSearchIndex.repairedEvidenceSetsTotal || 0).toLocaleString()}</b></span>
                <span>最近核对 <b>{memoryDiagnostics.taskSearchIndex.checkedAt
                  ? new Date(memoryDiagnostics.taskSearchIndex.checkedAt).toLocaleString('zh-CN')
                  : '未知'}</b></span>
              </div>
            </div>}
            {memoryDiagnostics.embeddings?.ann && <div className={`assistant-ann-audit ${memoryDiagnostics.embeddings.ann.active ? 'active' : 'exact'}`}>
              <div><Network size={15} /><span><b>本地语义检索 · {memoryDiagnostics.embeddings.ann.active ? 'ANN 多探针索引' : '精确向量扫描'}</b>
                <small>{memoryDiagnostics.embeddings.ann.active
                  ? '数据规模达到阈值，先用本机近邻索引召回候选，再计算真实余弦分数。'
                  : `当前 ${Number(memoryDiagnostics.embeddings.ann.eligible || 0).toLocaleString()} 条有效向量；达到 ${Number(memoryDiagnostics.embeddings.ann.minimumDocuments || 2000).toLocaleString()} 条后自动切换 ANN。`}</small>
              </span></div>
              <div>
                <span>覆盖 <b>{Math.round(Number(memoryDiagnostics.embeddings.ann.coverage || 0) * 100)}%</b></span>
                <span>索引 <b>{Number(memoryDiagnostics.embeddings.ann.indexed || 0).toLocaleString()} / {Number(memoryDiagnostics.embeddings.ann.eligible || 0).toLocaleString()}</b></span>
                <span>版本 <b>{memoryDiagnostics.embeddings.ann.version || 'lsh-v1'}</b></span>
                <span>最近构建 <b>{memoryDiagnostics.embeddings.ann.lastBuiltAt
                  ? new Date(memoryDiagnostics.embeddings.ann.lastBuiltAt).toLocaleString('zh-CN') : '尚未需要'}</b></span>
              </div>
              <small>索引可由加密库中的原始向量完全重建；版本、覆盖率或候选量不满足要求时自动回退精确扫描。</small>
            </div>}
            {memoryDiagnostics.privacy && <div className={`assistant-privacy-audit ${memoryDiagnostics.privacy.secure && memoryDiagnostics.privacy.stateMode === '600' && memoryDiagnostics.stateStorage?.encrypted && sensitiveCachesSecure ? 'secure' : 'warning'}`}>
              <div><ShieldCheck size={15} /><span><b>本机隐私与权限审计</b>
                <small>数据库 {memoryDiagnostics.privacy.databaseMode || '未知'} · 状态 {memoryDiagnostics.privacy.stateMode || '未知'} / 副本 {memoryDiagnostics.privacy.stateBackupMode || '尚未生成'} · 备份目录 {memoryDiagnostics.privacy.backupDirectoryMode || '尚未创建'}</small>
              </span></div>
              <div><span>API Key：{memoryDiagnostics.privacy.apiKeyStorage}</span>
                <span>个人记忆库：{memoryDiagnostics.privacy.databaseEncryption?.enabled &&
                  memoryDiagnostics.privacy.databaseEncryption?.cipher === 'sqlcipher' &&
                  !memoryDiagnostics.privacy.databaseEncryption?.plaintextHeader
                  ? `SQLCipher 已加密${memoryDiagnostics.privacy.databaseEncryption?.migratedThisStart ? '（本次启动完成迁移）' : ''}`
                  : '未验证加密'}</span>
                <span>任务与图谱状态：{memoryDiagnostics.stateStorage?.encrypted
                  ? `AES-256-GCM 已加密${memoryDiagnostics.stateStorage?.migratedPlaintext ? '（本次启动完成明文迁移）' : ''}`
                  : '未验证加密'}</span>
                <span>OCR 缓存：{!sensitiveCaches?.ocr?.exists ? '尚未生成'
                  : sensitiveCaches.ocr.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.ocr.entries || 0).toLocaleString()} 条${sensitiveCaches.ocr.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>图片语义缓存：{!sensitiveCaches?.imageSemantics?.exists ? '尚未生成'
                  : sensitiveCaches.imageSemantics.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.imageSemantics.entries || 0).toLocaleString()} 条${sensitiveCaches.imageSemantics.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>语音转写缓存：{!sensitiveCaches?.voiceTranscripts?.exists ? '尚未生成'
                  : sensitiveCaches.voiceTranscripts.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.voiceTranscripts.entries || 0).toLocaleString()} 条${sensitiveCaches.voiceTranscripts.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>联系人显示缓存：{!sensitiveCaches?.contacts?.exists ? '尚未生成'
                  : sensitiveCaches.contacts.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.contacts.entries || 0).toLocaleString()} 条${sensitiveCaches.contacts.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>会话统计缓存：{!sensitiveCaches?.sessionStats?.exists ? '尚未生成'
                  : sensitiveCaches.sessionStats.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.sessionStats.entries || 0).toLocaleString()} 条${sensitiveCaches.sessionStats.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>群内本人消息计数：{!sensitiveCaches?.groupMyMessageCounts?.exists ? '尚未生成'
                  : sensitiveCaches.groupMyMessageCounts.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.groupMyMessageCounts.entries || 0).toLocaleString()} 条${sensitiveCaches.groupMyMessageCounts.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>界面缓存映射：{!sensitiveCaches?.cacheMaps?.exists ? '尚未生成'
                  : sensitiveCaches.cacheMaps.encrypted ? `AES-256-GCM · ${Number(sensitiveCaches.cacheMaps.entries || 0).toLocaleString()} 组${sensitiveCaches.cacheMaps.migratedPlaintext ? '（本次迁移）' : ''}` : '未验证加密'}</span>
                <span>数据接口：{memoryDiagnostics.privacy.httpBinding}</span>
                <span>敏感运行日志：{memoryDiagnostics.privacy.sensitiveLogRetention?.enabled
                  ? `显式开启 · ${(Number(memoryDiagnostics.privacy.sensitiveLogRetention.currentBytes || 0) / 1024).toFixed(0)} KB / 最多 ${(Number(memoryDiagnostics.privacy.sensitiveLogRetention.maxBytes || 0) / 1024 / 1024).toFixed(0)} MB`
                  : memoryDiagnostics.privacy.sensitiveLogRetention?.currentBytes === 0 ? '默认关闭 · 历史明细已清空' : '默认关闭 · 等待下次启动清理'}</span>
                <span>模型外发脱敏：{memoryDiagnostics.privacy.sensitiveRedactionLevel === 'strict' ? '严格'
                  : memoryDiagnostics.privacy.sensitiveRedactionLevel === 'credentials' ? '仅凭证' : '标准'}</span></div>
              {memoryDiagnostics.privacy.sensitiveLogRetention && <small>
                本次启动清理 {(Number(memoryDiagnostics.privacy.sensitiveLogRetention.bytesRemovedThisStart || 0) / 1024).toFixed(1)} KB，
                累计清理 {(Number(memoryDiagnostics.privacy.sensitiveLogRetention.bytesRemovedTotal || 0) / 1024).toFixed(1)} KB；
                日志文件权限 {memoryDiagnostics.privacy.sensitiveLogRetention.mode || '尚未创建'}。只有在设置中显式开启诊断日志时才保留最近片段。
              </small>}
              {!sensitiveCachesSecure && <small className="assistant-diagnostics-error">
                至少一个本地识别缓存未通过加密、权限或可写性校验；认证失败时系统会保留现场并停止覆盖，请先备份后检查完整诊断。
              </small>}
            </div>}
            {memoryDiagnostics.conversationSourceMutationCommits && <div className={`assistant-recovery-audit ${Number(memoryDiagnostics.conversationSourceMutationCommits.prepared || 0) ? 'warning' : 'healthy'}`}>
              <header><RefreshCw size={15} /><span><b>来源开关跨存储提交</b>
                <small>先准备 SQLCipher 恢复载荷，再原子写入加密游标状态，最后事务提交来源策略。</small></span></header>
              <div>
                <span>待恢复 <b>{Number(memoryDiagnostics.conversationSourceMutationCommits.prepared || 0)}</b></span>
                <span>已提交 <b>{Number(memoryDiagnostics.conversationSourceMutationCommits.committed || 0)}</b></span>
                <span>已放弃 <b>{Number(memoryDiagnostics.conversationSourceMutationCommits.abandoned || 0)}</b></span>
                <span>恢复失败 <b>{Number(memoryDiagnostics.conversationSourceMutationCommits.recoveryFailures || 0)}</b></span>
                <span>保留载荷 <b>{Number(memoryDiagnostics.conversationSourceMutationCommits.retainedPayloadBytes || 0).toLocaleString()} B</b></span>
              </div>
              {!!memoryDiagnostics.conversationSourceMutationCommits.startupRecovery?.attempted && <small>
                本次启动核验 {Number(memoryDiagnostics.conversationSourceMutationCommits.startupRecovery.attempted)} 组：
                完成 {Number(memoryDiagnostics.conversationSourceMutationCommits.startupRecovery.applied)}，
                放弃 {Number(memoryDiagnostics.conversationSourceMutationCommits.startupRecovery.abandoned)}，
                冲突 {Number(memoryDiagnostics.conversationSourceMutationCommits.startupRecovery.conflicts)}。
              </small>}
            </div>}
            {memoryDiagnostics.appRecovery && <div className={`assistant-recovery-audit ${memoryDiagnostics.appRecovery.recoveredFromInterruption ? 'warning' : 'healthy'}`}>
              <header><RefreshCw size={15} /><span><b>应用运行与恢复</b>
                <small>{memoryDiagnostics.appRecovery.recoveryMessage}</small></span></header>
              <div className="assistant-recovery-current">
                <span>本次启动 <b>{memoryDiagnostics.appRecovery.current?.startedAt
                  ? new Date(memoryDiagnostics.appRecovery.current.startedAt).toLocaleString('zh-CN') : '未记录'}</b></span>
                <span>阶段 <b>{memoryDiagnostics.appRecovery.current?.stage || '未知'}</b></span>
                <span>上次退出 <b>{memoryDiagnostics.appRecovery.previous?.cleanExit ? '正常' : memoryDiagnostics.appRecovery.previous?.exitReason || '无记录'}</b></span>
                {memoryDiagnostics.stateStorage && <span>状态文件 <b>{memoryDiagnostics.stateStorage.source === 'backup'
                  ? '已从良好副本恢复'
                  : memoryDiagnostics.stateStorage.source === 'primary' ? '主副本正常' : '首次初始化'}</b></span>}
              </div>
              {memoryDiagnostics.stateStorage?.recovered && <p className="assistant-diagnostics-error">
                检测到主状态文件不可用，已验证最近良好副本并{memoryDiagnostics.stateStorage.repairedPrimary ? '自动修复主文件' : '以内存恢复运行'}。
              </p>}
              <details>
                <summary>最近运行记录（{memoryDiagnostics.appRecovery.history?.length || 0}）</summary>
                <div>
                  {(memoryDiagnostics.appRecovery.history || []).map((run: any) => <article key={run.id}>
                    <span><b>{new Date(run.startedAt).toLocaleString('zh-CN')}</b><small>{run.version} · {run.cleanExit ? '正常结束' : '异常中断'} · {run.exitReason || '未知原因'}</small></span>
                    <span>{run.incidents?.length || 0} 个异常事件</span>
                    {(run.incidents || []).map((incident: any, index: number) =>
                      <p key={`${run.id}-${index}`}>{new Date(incident.at).toLocaleTimeString('zh-CN')} · {incident.kind} · {incident.detail}</p>)}
                  </article>)}
                  {!memoryDiagnostics.appRecovery.history?.length && <em>首次记录，尚无历史会话。</em>}
                </div>
              </details>
            </div>}
            <div className="assistant-deletion-audit">
              <header>
                <ShieldCheck size={15} />
                <span>
                  <b>删除与不重要审计</b>
                  <small>
                    {memoryDeletionArchive.total} 条匹配 · 全部 {Number(memoryDeletionArchive.counts?.all || dashboard?.memoryDeletionArchive?.total || 0)} 条。
                    只保留不可逆指纹和影响计数，不保留被清理正文。
                  </small>
                </span>
              </header>
              <div className="assistant-task-filters">
                <select value={memoryDeletionKind}
                  onChange={event => setMemoryDeletionKind(event.target.value as typeof memoryDeletionKind)}>
                  <option value="all">所有记忆类型</option>
                  <option value="claim">事实</option>
                  <option value="event">事件</option>
                  <option value="relation">关系</option>
                </select>
                <select value={memoryDeletionReason}
                  onChange={event => setMemoryDeletionReason(event.target.value as typeof memoryDeletionReason)}>
                  <option value="all">所有清理原因</option>
                  <option value="not_important">不重要清理</option>
                  <option value="manual_delete">永久删除</option>
                </select>
                <input value={memoryDeletionQuery}
                  onChange={event => setMemoryDeletionQuery(event.target.value)}
                  placeholder="搜索不可逆指纹" />
                <label><span>清理从</span><input type="date" value={memoryDeletionFrom}
                  onChange={event => setMemoryDeletionFrom(event.target.value)} /></label>
                <label><span>到</span><input type="date" value={memoryDeletionTo}
                  onChange={event => setMemoryDeletionTo(event.target.value)} /></label>
                {(memoryDeletionKind !== 'all' || memoryDeletionReason !== 'all' || memoryDeletionQuery ||
                  memoryDeletionFrom || memoryDeletionTo) && <button onClick={() => {
                  setMemoryDeletionKind('all'); setMemoryDeletionReason('all'); setMemoryDeletionQuery('')
                  setMemoryDeletionFrom(''); setMemoryDeletionTo('')
                }}>清除范围</button>}
              </div>
              {memoryDeletionArchive.items.map((entry: any) => <article key={entry.id}>
                <span><b>{entry.item_kind === 'claim' ? '事实' : entry.item_kind === 'event' ? '事件' : '关系'} · {entry.item_fingerprint}</b>
                  <small>{entry.reason === 'not_important' ? '不重要清理' : '永久删除'} · {new Date(entry.created_at).toLocaleString('zh-CN')}</small></span>
                <span>证据 {entry.impact?.evidence || 0} · 关联 {entry.impact?.related || 0} · 索引 {entry.impact?.searchDocuments || 0} · 问答 {entry.impact?.assistantMessages || 0}</span>
              </article>)}
              {!memoryDeletionArchive.items.length && <div className="assistant-empty">
                {memoryDeletionArchive.loading ? '正在读取完整删除审计…' : '当前范围没有删除或不重要清理记录。'}
              </div>}
              {memoryDeletionArchive.hasMore && <div className="assistant-timeline-more">
                <button disabled={memoryDeletionLoadingMore}
                  onClick={() => void loadMoreMemoryDeletionAudit()}>
                  {memoryDeletionLoadingMore
                    ? '正在加载…'
                    : `加载更多（已显示 ${memoryDeletionArchive.items.length}/${memoryDeletionArchive.total}）`}
                </button>
              </div>}
            </div>
            <div className="assistant-diagnostics-runs">
              <div className="assistant-task-filters">
                <select value={ingestionArchiveStatus}
                  onChange={event => setIngestionArchiveStatus(event.target.value as typeof ingestionArchiveStatus)}>
                  <option value="all">所有运行结果</option>
                  <option value="running">仍在运行</option>
                  <option value="completed">已完成</option>
                  <option value="partial">部分完成</option>
                  <option value="failed">失败</option>
                </select>
                <input value={ingestionArchiveQuery}
                  onChange={event => setIngestionArchiveQuery(event.target.value)}
                  placeholder="搜索运行 ID、模型、Prompt 或错误" />
                <label><span>开始从</span><input type="date" value={ingestionArchiveFrom}
                  onChange={event => setIngestionArchiveFrom(event.target.value)} /></label>
                <label><span>到</span><input type="date" value={ingestionArchiveTo}
                  onChange={event => setIngestionArchiveTo(event.target.value)} /></label>
                {(ingestionArchiveStatus !== 'all' || ingestionArchiveQuery ||
                  ingestionArchiveFrom || ingestionArchiveTo) && <button onClick={() => {
                  setIngestionArchiveStatus('all'); setIngestionArchiveQuery('')
                  setIngestionArchiveFrom(''); setIngestionArchiveTo('')
                }}>清除范围</button>}
              </div>
              <small className="assistant-evidence">
                {ingestionArchive.total} 条匹配 · 全部 {ingestionArchive.counts.all || memoryDiagnostics.ingestionArchive?.total || 0} 次运行。
                目录不携带批次上下文；点击后才按每页 40 批读取完整证据门禁、脱敏和可信上下文审计。
              </small>
              {ingestionArchive.items.map((run: any) => <article className="assistant-ingestion-run" key={run.id}>
                <div>
                  <b>{new Date(run.started_at).toLocaleString('zh-CN')}</b>
                  <span className={run.status}>{run.status} · {run.message_count} 条 · {run.batch_count} 批
                    {run.failed_batch_count ? ` · ${run.failed_batch_count} 批失败` : ''}
                    {' · '}{(Number(run.duration_ms || 0) / 1000).toFixed(1)} 秒
                  </span>
                </div>
                <small>{run.model || '模型待记录'} · {run.prompt_version || 'Prompt 版本待记录'} · Token {Number(run.input_tokens || 0).toLocaleString()} 入 / {Number(run.output_tokens || 0).toLocaleString()} 出</small>
                {run.recovered_at && <p>
                  上次退出时未结束，已于 {new Date(run.recovered_at).toLocaleString('zh-CN')} 对账：
                  保留 {Number(run.recovered_batch_count || 0)} 个成功批次，
                  {Number(run.interrupted_batch_count || 0)} 个在途批次等待 checkpoint 重试。
                </p>}
                {run.error && <p className="assistant-diagnostics-error">{run.error}</p>}
                <button onClick={() => void openIngestionDossier(run.id)}>
                  {ingestionDossier?.id === run.id ? '收起批次详情' : `查看批次详情（${run.batch_count}）`}
                </button>
                {ingestionDossier?.id === run.id && <div className="assistant-ingestion-dossier">
                  {ingestionDossier.loading && <em>正在读取批次审计…</em>}
                  {ingestionDossier.error && <p className="assistant-diagnostics-error">{ingestionDossier.error}</p>}
                  {(ingestionDossier.batches || []).map((batch: any) =>
                    <IngestionBatchAudit key={`${run.id}-${batch.batch_index}`} batch={batch} run={run} />)}
                  {!ingestionDossier.loading && !ingestionDossier.error &&
                    !ingestionDossier.batches?.length && <em>该次运行没有创建模型批次</em>}
                  {ingestionDossier.batchHasMore && <button disabled={ingestionBatchesLoadingMore}
                    onClick={() => void loadMoreIngestionBatches()}>
                    {ingestionBatchesLoadingMore
                      ? '正在加载…'
                      : `加载更多批次（已显示 ${ingestionDossier.batches?.length || 0}/${ingestionDossier.batchTotal}）`}
                  </button>}
                </div>}
              </article>)}
              {!ingestionArchive.items.length && <div className="assistant-empty">
                {ingestionArchive.loading ? '正在读取运行档案…' : '当前范围没有增量运行记录。'}
              </div>}
              {ingestionArchive.hasMore && <div className="assistant-review-page-status">
                <small>已加载 {ingestionArchive.items.length} / {ingestionArchive.total} 次运行。</small>
                <button disabled={ingestionArchiveLoadingMore} onClick={() => void loadMoreIngestionRuns()}>
                  {ingestionArchiveLoadingMore ? '正在加载…' : '加载更多运行'}
                </button>
              </div>}
            </div>
            <footer><button onClick={() => void window.electronAPI.aiAssistant.getMemoryDiagnostics().then(setMemoryDiagnostics)}>刷新</button>
              <button className="primary" onClick={() => setShowDiagnostics(false)}>完成</button></footer>
          </div>
        </div>
      )}

      {memoryFeedbackDeleteDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="memory-feedback-delete-title">
            <div className="assistant-modal-title"><div>
              <h2 id="memory-feedback-delete-title">永久删除检索反馈</h2>
              <p>删除的是本机相关性学习记录，不会删除事实、事件、关系、任务或原文。</p>
            </div><button aria-label="关闭检索反馈删除确认"
              disabled={memoryFeedbackDeleteDialog.status === 'deleting'}
              onClick={closeMemoryFeedbackDeletion}><X size={16} /></button></div>
            {memoryFeedbackDeleteDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对清理范围…</strong>
                <small>将整组删除相关历史，避免旧判断在删除最新动作后重新生效。</small></span>
            </div>}
            {memoryFeedbackDeleteDialog.status === 'error' && <div className="assistant-error">
              <strong>无法清理检索反馈</strong><span>{memoryFeedbackDeleteDialog.error || '未知错误'}</span>
            </div>}
            {(memoryFeedbackDeleteDialog.status === 'ready' || memoryFeedbackDeleteDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{memoryFeedbackDeleteDialog.single ? '这一组检索偏好' : '当前筛选命中的检索偏好'}</strong>
                <p>
                  当前筛选命中 {memoryFeedbackDeleteDialog.preview?.matchingRows || 0} 条动作；
                  为防止更早的“有用/无关”判断意外复活，将完整清理
                  {' '}{memoryFeedbackDeleteDialog.preview?.affectedChains || 0} 组偏好、
                  共 {memoryFeedbackDeleteDialog.preview?.rowsToDelete || 0} 条历史；
                  其中 {memoryFeedbackDeleteDialog.preview?.removesCurrentDecisions || 0} 组当前排序判断会失效。
                </p>
              </div>
              <label><span>输入“永久删除检索反馈”确认</span><input autoFocus
                value={memoryFeedbackDeleteConfirmation}
                disabled={memoryFeedbackDeleteDialog.status === 'deleting'}
                onChange={event => setMemoryFeedbackDeleteConfirmation(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && memoryFeedbackDeleteConfirmation === '永久删除检索反馈') {
                    void confirmMemoryFeedbackDeletion()
                  }
                }}
                placeholder="永久删除检索反馈" /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={memoryFeedbackDeleteDialog.status === 'deleting'}
                onClick={closeMemoryFeedbackDeletion}>取消</button>
              {(memoryFeedbackDeleteDialog.status === 'ready' || memoryFeedbackDeleteDialog.status === 'deleting') &&
                <button className="danger"
                  disabled={memoryFeedbackDeleteConfirmation !== '永久删除检索反馈' ||
                    memoryFeedbackDeleteDialog.status === 'deleting' ||
                    !memoryFeedbackDeleteDialog.preview?.rowsToDelete}
                  onClick={() => void confirmMemoryFeedbackDeletion()}>
                  {memoryFeedbackDeleteDialog.status === 'deleting' ? '正在清理…' : '确认永久删除'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {mergeRevertDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="merge-revert-title">
            <div className="assistant-modal-title"><div>
              <h2 id="merge-revert-title">撤销身份合并</h2>
              <p>恢复合并前的两个身份、相关关系、事件参与者和审阅候选；不会覆盖无关图谱。</p>
            </div><button aria-label="关闭身份合并撤销确认"
              disabled={mergeRevertDialog.status === 'reverting'}
              onClick={closeMergeRevertDialog}><X size={16} /></button></div>
            {mergeRevertDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对合并后的相关变化…</strong>
                <small>如果相关身份、关系、事件或审阅已经继续变化，系统会保守拒绝撤销。</small></span>
            </div>}
            {(mergeRevertDialog.status === 'error' || mergeRevertDialog.status === 'blocked') &&
              <div className="assistant-error">
                <strong>{mergeRevertDialog.status === 'blocked'
                  ? '当前不能安全自动撤销'
                  : '身份合并撤销失败'}</strong>
                <span>{mergeRevertDialog.error || mergeRevertDialog.preview?.reason || '未知错误'}</span>
                {(String(mergeRevertDialog.error || '').includes('变化') ||
                  String(mergeRevertDialog.error || '').includes('失效')) &&
                  <button onClick={() => {
                    const mergeId = mergeRevertDialog.mergeId
                    closeMergeRevertDialog()
                    void revertMerge(mergeId)
                  }}>重新核对当前范围</button>}
              </div>}
            {(mergeRevertDialog.status === 'ready' || mergeRevertDialog.status === 'reverting') && <>
              <div className="assistant-delete-preview">
                <strong>{mergeRevertDialog.preview.sourceName} → {mergeRevertDialog.preview.targetName}</strong>
                <p>
                  将恢复被合并身份，并精确还原 {mergeRevertDialog.preview.counts.relations} 条相关关系、
                  {mergeRevertDialog.preview.counts.eventParticipants} 条事件参与记录和
                  {mergeRevertDialog.preview.counts.reviews} 条相关审阅候选。
                  其他人物和关系保持当前状态。
                </p>
              </div>
              <label><span>输入“撤销合并”确认</span>
                <input autoFocus value={mergeRevertConfirmation}
                  disabled={mergeRevertDialog.status === 'reverting'}
                  onChange={event => setMergeRevertConfirmation(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && mergeRevertConfirmation === '撤销合并') {
                      void confirmRevertMerge()
                    }
                  }}
                  placeholder="撤销合并" /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={mergeRevertDialog.status === 'reverting'}
                onClick={closeMergeRevertDialog}>取消</button>
              {(mergeRevertDialog.status === 'ready' || mergeRevertDialog.status === 'reverting') &&
                <button className="danger"
                  disabled={mergeRevertDialog.status === 'reverting' ||
                    mergeRevertConfirmation !== '撤销合并'}
                  onClick={() => void confirmRevertMerge()}>
                  {mergeRevertDialog.status === 'reverting' ? '正在安全撤销…' : '确认撤销合并'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {conversationDeletionDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="conversation-delete-title">
            <div className="assistant-modal-title"><div>
              <h2 id="conversation-delete-title">删除本地问答历史</h2>
              <p>只删除这段对话和随回答保存的引用记录，不会删除事实、事件、关系或原始资料。</p>
            </div><button aria-label="关闭问答历史删除确认"
              disabled={conversationDeletionDialog.status === 'deleting'}
              onClick={closeConversationDeletionDialog}><X size={16} /></button></div>
            {conversationDeletionDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对对话范围…</strong>
                <small>只读取本机加密记忆库，不会上传数据。</small></span>
            </div>}
            {conversationDeletionDialog.status === 'error' && <div className="assistant-error">
              <strong>无法删除问答历史</strong>
              <span>{conversationDeletionDialog.error || '未知错误'}</span>
              {String(conversationDeletionDialog.error || '').includes('预览后发生了变化') &&
                <button onClick={() => {
                  const conversationId = conversationDeletionDialog.conversationId
                  closeConversationDeletionDialog()
                  void deleteMemoryConversation(conversationId)
                }}>重新核对范围</button>}
            </div>}
            {(conversationDeletionDialog.status === 'ready' ||
              conversationDeletionDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{conversationDeletionDialog.preview.title || '未命名对话'}</strong>
                <p>
                  将删除 {conversationDeletionDialog.preview.counts.messages} 条消息
                  （本人提问 {conversationDeletionDialog.preview.counts.userMessages} 条、
                  AI 回答 {conversationDeletionDialog.preview.counts.assistantMessages} 条），
                  清理 {conversationDeletionDialog.preview.counts.citations} 条展示引用、
                  {conversationDeletionDialog.preview.counts.dependencies} 条逐句证据依赖
                  和 {conversationDeletionDialog.preview.counts.reviews} 条回答审阅记录。
                </p>
              </div>
              <label><span>输入“删除对话”确认</span><input autoFocus
                value={conversationDeletionConfirmation}
                disabled={conversationDeletionDialog.status === 'deleting'}
                onChange={event => setConversationDeletionConfirmation(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && conversationDeletionConfirmation === '删除对话') {
                    void confirmConversationDeletion()
                  }
                }}
                placeholder="删除对话" /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={conversationDeletionDialog.status === 'deleting'}
                onClick={closeConversationDeletionDialog}>取消</button>
              {(conversationDeletionDialog.status === 'ready' ||
                conversationDeletionDialog.status === 'deleting') &&
                <button className="danger"
                  disabled={conversationDeletionConfirmation !== '删除对话' ||
                    conversationDeletionDialog.status === 'deleting'}
                  onClick={() => void confirmConversationDeletion()}>
                  {conversationDeletionDialog.status === 'deleting' ? '正在删除…' : '确认删除对话'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {memoryDeletionDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true" aria-labelledby="memory-delete-title">
            <div className="assistant-modal-title"><div>
              <h2 id="memory-delete-title">
                {memoryDeletionDialog.reason === 'not_important' ? '标记不重要并清理' : '永久删除'}
                {memoryDeletionDialog.kind === 'claim' ? '事实' : memoryDeletionDialog.kind === 'event' ? '事件' : '关系'}
              </h2>
              <p>{memoryDeletionDialog.reason === 'not_important'
                ? '释放正文、原文与索引空间，只保留很小的抑制指纹；同一原文今后不会再次生成。'
                : '该操作不可撤销，但会保留不含正文的抑制指纹，防止相同原文再次生成。'}</p>
            </div><button aria-label="关闭永久删除确认" disabled={memoryDeletionDialog.status === 'deleting'}
              onClick={closeMemoryDeletionDialog}><X size={16} /></button></div>
            {memoryDeletionDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对删除范围…</strong><small>只读取本机加密记忆库，不会上传数据。</small></span>
            </div>}
            {memoryDeletionDialog.status === 'error' && <div className="assistant-error">
              <strong>无法完成永久删除</strong><span>{memoryDeletionDialog.error || '未知错误'}</span>
              {String(memoryDeletionDialog.error || '').includes('预览后发生了变化') &&
                <button onClick={() => {
                  const item = {
                    id: memoryDeletionDialog.id,
                    title: memoryDeletionDialog.label
                  }
                  const reason = memoryDeletionDialog.reason
                  setMemoryDeletionDialog(null)
                  setMemoryDeletionConfirmation('')
                  void (reason === 'not_important'
                    ? ignoreMemoryItem(memoryDeletionDialog.kind, item)
                    : permanentlyDeleteMemoryItem(memoryDeletionDialog.kind, item))
                }}>重新核对范围</button>}
            </div>}
            {(memoryDeletionDialog.status === 'ready' || memoryDeletionDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{memoryDeletionDialog.preview?.label || memoryDeletionDialog.label || '未命名记忆'}</strong>
                <p>
                  将{memoryDeletionDialog.reason === 'not_important' ? '释放' : '清理'} {memoryDeletionDialog.preview?.counts?.evidence || 0} 条原文证据、
                  {memoryDeletionDialog.preview?.counts?.related || 0} 条关联记录、
                  {memoryDeletionDialog.preview?.counts?.searchDocuments || 0} 个全文/向量索引，
                  以及 {memoryDeletionDialog.preview?.counts?.assistantMessages || 0} 段引用过它的本地问答。
                </p>
              </div>
              <label><span>输入“{memoryDeletionDialog.reason === 'not_important'
                ? '标记不重要' : '永久删除'}”确认</span><input autoFocus value={memoryDeletionConfirmation}
                disabled={memoryDeletionDialog.status === 'deleting'}
                onChange={event => setMemoryDeletionConfirmation(event.target.value)}
                onKeyDown={event => {
                  const expected = memoryDeletionDialog.reason === 'not_important'
                    ? '标记不重要' : '永久删除'
                  if (event.key === 'Enter' && memoryDeletionConfirmation === expected) {
                    void confirmPermanentMemoryDeletion()
                  }
                }}
                placeholder={memoryDeletionDialog.reason === 'not_important'
                  ? '标记不重要' : '永久删除'} /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={memoryDeletionDialog.status === 'deleting'} onClick={closeMemoryDeletionDialog}>取消</button>
              {(memoryDeletionDialog.status === 'ready' || memoryDeletionDialog.status === 'deleting') &&
                <button className="danger" disabled={
                  memoryDeletionConfirmation !== (memoryDeletionDialog.reason === 'not_important'
                    ? '标记不重要' : '永久删除') ||
                  memoryDeletionDialog.status === 'deleting'}
                  onClick={() => void confirmPermanentMemoryDeletion()}>
                  {memoryDeletionDialog.status === 'deleting' ? '正在清理…'
                    : memoryDeletionDialog.reason === 'not_important'
                      ? '确认标记不重要' : '确认永久删除'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {entityForgetDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="entity-forget-title">
            <div className="assistant-modal-title"><div>
              <h2 id="entity-forget-title">彻底遗忘人物</h2>
              <p>永久删除人物及其关联记忆，不可撤销。建议先创建个人记忆快照。</p>
            </div><button aria-label="关闭彻底遗忘确认" disabled={entityForgetDialog.status === 'deleting'}
              onClick={closeEntityForgetDialog}><X size={16} /></button></div>
            {entityForgetDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对人物关联范围…</strong>
                <small>只读取本机加密记忆库，不会上传数据。</small></span>
            </div>}
            {entityForgetDialog.status === 'error' && <div className="assistant-error">
              <strong>无法完成彻底遗忘</strong><span>{entityForgetDialog.error || '未知错误'}</span>
              {String(entityForgetDialog.error || '').includes('预览后发生了变化') &&
                <button onClick={() => {
                  setEntityForgetDialog(null)
                  setEntityForgetConfirmation('')
                  void forgetSelectedEntity()
                }}>重新核对范围</button>}
            </div>}
            {(entityForgetDialog.status === 'ready' || entityForgetDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{entityForgetDialog.preview.canonicalName}</strong>
                <p>
                  将永久删除 {entityForgetDialog.preview.counts.claims} 条事实、
                  {entityForgetDialog.preview.counts.relations} 条关系、
                  {entityForgetDialog.preview.counts.events} 个事件、
                  {entityForgetDialog.preview.counts.tasks} 个关联任务，以及相关全文、向量、审计和问答记录。
                </p>
              </div>
              <label><span>输入人物名称“{entityForgetDialog.preview.canonicalName}”确认</span>
                <input autoFocus value={entityForgetConfirmation}
                  disabled={entityForgetDialog.status === 'deleting'}
                  onChange={event => setEntityForgetConfirmation(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' &&
                      entityForgetConfirmation === entityForgetDialog.preview.canonicalName) {
                      void confirmForgetSelectedEntity()
                    }
                  }}
                  placeholder={entityForgetDialog.preview.canonicalName} /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={entityForgetDialog.status === 'deleting'}
                onClick={closeEntityForgetDialog}>取消</button>
              {(entityForgetDialog.status === 'ready' || entityForgetDialog.status === 'deleting') &&
                <button className="danger"
                  disabled={entityForgetDialog.status === 'deleting' ||
                    entityForgetConfirmation !== entityForgetDialog.preview.canonicalName}
                  onClick={() => void confirmForgetSelectedEntity()}>
                  {entityForgetDialog.status === 'deleting' ? '正在彻底遗忘…' : '确认彻底遗忘'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {resourceDeletionDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="resource-delete-title">
            <div className="assistant-modal-title"><div>
              <h2 id="resource-delete-title">
                {resourceDeletionDialog.action === 'purge' ? '永久删除资源快照' : '从个人记忆删除资源'}
              </h2>
              <p>{resourceDeletionDialog.action === 'purge'
                ? '回收站快照删除后无法恢复；抑制记录仍会阻止原消息自动重建资源。'
                : '资源正文、检索索引和原文引用将退出记忆；回收站快照可供手动恢复。'}</p>
            </div><button aria-label="关闭资源删除确认"
              disabled={resourceDeletionDialog.status === 'deleting'}
              onClick={closeResourceDeletionDialog}><X size={16} /></button></div>
            {resourceDeletionDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对资源范围…</strong>
                <small>只读取本机加密记忆库，不会上传数据。</small></span>
            </div>}
            {resourceDeletionDialog.status === 'error' && <div className="assistant-error">
              <strong>无法处理资源</strong><span>{resourceDeletionDialog.error || '未知错误'}</span>
              {String(resourceDeletionDialog.error || '').includes('预览后发生了变化') &&
                <button onClick={() => {
                  const resource = {
                    id: resourceDeletionDialog.resourceId,
                    title: resourceDeletionDialog.title
                  }
                  setResourceDeletionDialog(null)
                  setResourceDeletionConfirmation('')
                  void (resourceDeletionDialog.action === 'purge'
                    ? purgeMemoryResourceTrash(resource)
                    : deleteMemoryResource(resource))
                }}>重新核对范围</button>}
            </div>}
            {(resourceDeletionDialog.status === 'ready' ||
              resourceDeletionDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{resourceDeletionDialog.preview.title}</strong>
                <p>{resourceDeletionDialog.action === 'purge'
                  ? `快照包含 ${resourceDeletionDialog.preview.counts.evidence} 条原文证据；永久清除后不能再从回收站恢复。`
                  : `将移除 ${resourceDeletionDialog.preview.counts.evidence} 条原文证据和 ${resourceDeletionDialog.preview.counts.searchDocuments} 个全文/向量索引，并创建可恢复快照。`}
                </p>
              </div>
              <label><span>输入“{resourceDeletionDialog.action === 'purge'
                ? '永久删除资源' : '移入回收站'}”确认</span>
                <input autoFocus value={resourceDeletionConfirmation}
                  disabled={resourceDeletionDialog.status === 'deleting'}
                  onChange={event => setResourceDeletionConfirmation(event.target.value)}
                  onKeyDown={event => {
                    const expected = resourceDeletionDialog.action === 'purge'
                      ? '永久删除资源' : '移入回收站'
                    if (event.key === 'Enter' && resourceDeletionConfirmation === expected) {
                      void confirmResourceDeletion()
                    }
                  }}
                  placeholder={resourceDeletionDialog.action === 'purge'
                    ? '永久删除资源' : '移入回收站'} /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={resourceDeletionDialog.status === 'deleting'}
                onClick={closeResourceDeletionDialog}>取消</button>
              {(resourceDeletionDialog.status === 'ready' ||
                resourceDeletionDialog.status === 'deleting') &&
                <button className="danger"
                  disabled={resourceDeletionDialog.status === 'deleting' ||
                    resourceDeletionConfirmation !== (resourceDeletionDialog.action === 'purge'
                      ? '永久删除资源' : '移入回收站')}
                  onClick={() => void confirmResourceDeletion()}>
                  {resourceDeletionDialog.status === 'deleting'
                    ? '正在处理…'
                    : resourceDeletionDialog.action === 'purge'
                      ? '确认永久删除' : '确认移入回收站'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {memoryRestoreDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true" aria-labelledby="memory-restore-title">
            <div className="assistant-modal-title"><div>
              <h2 id="memory-restore-title">恢复个人记忆快照</h2>
              <p>恢复前会先创建一份当前数据库与加密状态的联合安全快照；失败时自动回滚。</p>
            </div><button aria-label="关闭快照恢复确认" disabled={restoringMemory}
              onClick={closeMemoryRestoreDialog}><X size={16} /></button></div>
            {memoryRestoreDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在只读验证快照…</strong><small>核对 SQLCipher 完整性、加密状态和内容规模，不会修改当前记忆。</small></span>
            </div>}
            {memoryRestoreDialog.status === 'error' && <div className="assistant-error">
              <strong>快照验证或恢复失败</strong><span>{memoryRestoreDialog.error || '未知错误'}</span>
            </div>}
            {(memoryRestoreDialog.status === 'ready' || memoryRestoreDialog.status === 'restoring') && <>
              <div className="assistant-delete-preview">
                <strong>{new Date(memoryRestoreDialog.preview.createdAt).toLocaleString('zh-CN', { hour12: false })} 的联合快照</strong>
                <p>
                  SQLCipher {memoryRestoreDialog.preview.integrity === 'ok' ? '完整性通过' : '异常'}
                  {' · '}{memoryRestoreDialog.preview.encrypted ? '数据库与状态均已加密' : '加密状态异常'}
                  {' · '}{(Number(memoryRestoreDialog.preview.bytes || 0) / 1024 / 1024).toFixed(1)} MB
                </p>
                <p>
                  {Number(memoryRestoreDialog.preview.counts?.tasks || 0).toLocaleString()} 条任务、
                  {Number(memoryRestoreDialog.preview.counts?.entities || 0).toLocaleString()} 个实体、
                  {Number(memoryRestoreDialog.preview.counts?.graphRelations || 0).toLocaleString()} 条图关系、
                  {Number(memoryRestoreDialog.preview.counts?.claims || 0).toLocaleString()} 条事实、
                  {Number(memoryRestoreDialog.preview.counts?.events || 0).toLocaleString()} 个事件、
                  {Number(memoryRestoreDialog.preview.counts?.pendingReviews || 0).toLocaleString()} 个待审候选。
                </p>
                <p>
                  当前记忆库将被整体替换：现有
                  {' '}{Number(memoryRestoreDialog.preview.currentStateSummary?.tasks || 0).toLocaleString()} 条任务、
                  {Number(memoryRestoreDialog.preview.currentStateSummary?.entities || 0).toLocaleString()} 个实体、
                  {Number(memoryRestoreDialog.preview.currentStateSummary?.relations || 0).toLocaleString()} 条关系、
                  {Number(memoryRestoreDialog.preview.currentStateSummary?.claims || 0).toLocaleString()} 条事实、
                  {Number(memoryRestoreDialog.preview.currentStateSummary?.events || 0).toLocaleString()} 个事件和
                  {Number(memoryRestoreDialog.preview.currentStateSummary?.evidence || 0).toLocaleString()} 条证据。
                  确认后如果任一侧继续变化，本次操作会被拒绝并要求重新核对。
                </p>
                <p>
                  最近完整同步：
                  {memoryRestoreDialog.preview.lastSyncAt
                    ? new Date(memoryRestoreDialog.preview.lastSyncAt).toLocaleString('zh-CN', { hour12: false })
                    : '快照中尚无记录'}
                  {Number(memoryRestoreDialog.preview.cursor?.pendingSessionRetryCount || 0) > 0
                    ? ` · ${Number(memoryRestoreDialog.preview.cursor.pendingSessionRetryCount)} 个会话等待重试`
                    : ''}
                  {Number(memoryRestoreDialog.preview.cursor?.pendingSessionBacklogCount || 0) > 0
                    ? ` · ${Number(memoryRestoreDialog.preview.cursor.pendingSessionBacklogCount)} 个会话仍有分页积压`
                    : ''}
                </p>
              </div>
              <label><span>输入“恢复快照”确认</span><input autoFocus value={memoryRestoreConfirmation}
                disabled={memoryRestoreDialog.status === 'restoring'}
                onChange={event => setMemoryRestoreConfirmation(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && memoryRestoreConfirmation === '恢复快照') {
                    void restoreMemory()
                  }
                }}
                placeholder="恢复快照" /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={restoringMemory} onClick={closeMemoryRestoreDialog}>取消</button>
              {memoryRestoreDialog.status === 'error' && <button disabled={restoringMemory}
                onClick={() => void openMemoryRestoreDialog(memoryRestoreDialog.backup)}>重新验证</button>}
              {(memoryRestoreDialog.status === 'ready' || memoryRestoreDialog.status === 'restoring') &&
                <button className="danger"
                  disabled={memoryRestoreConfirmation !== '恢复快照' || restoringMemory}
                  onClick={() => void restoreMemory()}>
                  {restoringMemory ? '正在创建安全点并恢复…' : '确认恢复此快照'}
                </button>}
            </div>
          </div>
        </div>
      )}

      {showSettings && settings && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal">
            <div className="assistant-modal-title"><div><h2>AI 助理设置</h2><p>敏感 Key 由 Electron safeStorage 加密保存。</p></div><button onClick={() => setShowSettings(false)}><X size={16} /></button></div>
            <label><span>DeepSeek API Key</span><input type="password" placeholder={settings.configured ? '已安全保存；留空表示不修改' : 'sk-...'} onChange={event => setSettings({ ...settings, apiKey: event.target.value })} /></label>
            <label><span>API 地址</span><input value={settings.baseUrl} onChange={event => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
            <label><span>模型</span><input value={settings.model} onChange={event => setSettings({ ...settings, model: event.target.value })} /></label>
            <label><span>我的姓名</span><input value={settings.ownerName || ''} placeholder="用于判断群聊任务是否指向你" onChange={event => setSettings({ ...settings, ownerName: event.target.value })} /></label>
            <label><span>我的常用称呼</span><input value={settings.ownerAliases || ''} placeholder="昵称、群昵称，用逗号分隔" onChange={event => setSettings({ ...settings, ownerAliases: event.target.value })} /></label>
            <label><span>我的背景信息</span><textarea value={settings.ownerBackground || ''} placeholder="公司、职位、负责项目等，帮助理解聊天上下文" onChange={event => setSettings({ ...settings, ownerBackground: event.target.value })} /></label>
            <label><span>发送给模型前的敏感信息脱敏</span><select value={settings.sensitiveRedactionLevel || 'standard'} onChange={event => setSettings({ ...settings, sensitiveRedactionLevel: event.target.value })}>
              <option value="credentials">仅凭证：API Key、密码、访问令牌</option>
              <option value="standard">标准：再隐藏邮箱、手机号、身份证、银行卡</option>
              <option value="strict">严格：再隐藏 IP 地址和链接凭证</option>
            </select></label>
            <small className="assistant-settings-note">只改变发送给 DeepSeek 的副本；本机原始微信数据与证据不会被改写。同一敏感值会映射为同一占位符，保留上下文关联。</small>
            <label><span>每日整理时间</span><input type="time" value={settings.scheduleTime} onChange={event => setSettings({ ...settings, scheduleTime: event.target.value })} /></label>
            <div className="assistant-settings-inline">
              <label><span>静默开始</span><input type="time" value={settings.quietStart || '22:00'} onChange={event => setSettings({ ...settings, quietStart: event.target.value })} /></label>
              <label><span>静默结束</span><input type="time" value={settings.quietEnd || '08:00'} onChange={event => setSettings({ ...settings, quietEnd: event.target.value })} /></label>
            </div>
            <small className="assistant-settings-note">静默时段仍会继续补齐并生成简报，只是不发送系统通知。</small>
            <div className="assistant-settings-inline">
              <label><span>输入费率（元/百万 Token）</span><input type="number" min="0" step="0.01" value={settings.inputCostPerMillion ?? 0} onChange={event => setSettings({ ...settings, inputCostPerMillion: Number(event.target.value) })} /></label>
              <label><span>输出费率（元/百万 Token）</span><input type="number" min="0" step="0.01" value={settings.outputCostPerMillion ?? 0} onChange={event => setSettings({ ...settings, outputCostPerMillion: Number(event.target.value) })} /></label>
            </div>
            <small className="assistant-settings-note">DeepSeek 费率可能调整，成本只按你填写的当前费率本地估算。</small>
            <label className="assistant-toggle"><input type="checkbox" checked={Boolean(settings.transcribeVoice)} onChange={event => setSettings({ ...settings, transcribeVoice: event.target.checked })} /><span>增量整理时本地转写语音（每次最多 12 条，需已安装 SenseVoice 模型）</span></label>
            <label className="assistant-toggle"><input type="checkbox" checked={Boolean(settings.ocrImages)} onChange={event => setSettings({ ...settings, ocrImages: event.target.checked })} /><span>增量整理时本地识别图片文字（每次最多 8 张，需本机 Tesseract 中文模型）</span></label>
            <label className="assistant-toggle"><input type="checkbox" checked={Boolean(settings.analyzeImages)} onChange={event => setSettings({ ...settings, analyzeImages: event.target.checked })} /><span>用 macOS Apple Vision 本地提取图片场景候选（每次最多 4 张，不上传原图）</span></label>
            <label className="assistant-toggle"><input type="checkbox" checked={Boolean(settings.indexWebLinks)} onChange={event => setSettings({ ...settings, indexWebLinks: event.target.checked })} /><span>安全抓取公开网页正文（每次最多 4 个；拒绝内网地址，默认关闭）</span></label>
            <label><span>资源回收站保留</span><select value={Number(settings.resourceTrashRetentionDays || 0)} onChange={event => setSettings({ ...settings, resourceTrashRetentionDays: Number(event.target.value) })}>
              <option value={0}>永不自动清空</option><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option>
            </select></label>
            <small className="assistant-settings-note">到期只清除回收站快照；删除抑制仍保留，原消息不会让资源复活。</small>
            <label className="assistant-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /><span>启用启动补齐与每日自动整理</span></label>
            <div className="assistant-modal-actions"><button onClick={() => setShowSettings(false)}>取消</button><button className="primary" onClick={saveSettings}>保存设置</button></div>
          </div>
        </div>
      )}

      {migrationDialog && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal assistant-delete-modal">
            <div className="assistant-modal-title"><div>
              <h2>{migrationDialog.mode === 'export' ? '创建便携迁移包'
                : migrationDialog.status === 'preview' ? '核对并导入个人记忆'
                  : '解锁便携迁移包'}</h2>
              <p>{migrationDialog.mode === 'export'
                ? '数据库、图谱、任务和增量游标会用迁移口令整体加密。口令不会保存，也无法找回。'
                : migrationDialog.status === 'preview'
                  ? '这会替换当前全部个人记忆；执行前会再次验证同一迁移包和当前数据，并自动创建安全快照。'
                  : '输入原设备导出时设置的口令。导入前会验证密文、文件哈希和数据库一致性。'}</p>
            </div><button aria-label="关闭迁移向导" disabled={migratingMemory}
              onClick={closeMigrationDialog}><X size={16} /></button></div>
            {migrationDialog.status === 'error' && <div className="assistant-error">
              <strong>无法导入个人记忆</strong><span>{migrationDialog.error || '未知错误'}</span>
              <button onClick={() => {
                setMigrationImportConfirmation('')
                setMigrationDialog((current: any) => ({ ...current, status: 'unlock', error: undefined, inspected: undefined }))
              }}>重新验证迁移包</button>
            </div>}
            {(migrationDialog.mode === 'export' || migrationDialog.status === 'unlock' || !migrationDialog.status) &&
              <label><span>迁移口令</span><input type="password" autoFocus value={migrationPassphrase}
                placeholder={migrationDialog.mode === 'export' ? '至少 12 个字符' : '旧版同机迁移包可留空'}
                onChange={event => setMigrationPassphrase(event.target.value)} /></label>}
            {migrationDialog.mode === 'export' && <label><span>再次输入</span><input type="password"
              value={migrationPassphraseConfirmation}
              onChange={event => setMigrationPassphraseConfirmation(event.target.value)} /></label>}
            {migrationDialog.status === 'preview' && migrationDialog.inspected && <>
              <div className="assistant-delete-preview">
                <strong>迁移包校验通过 · {migrationDialog.inspected.portable ? '口令便携包' : '旧版同机包'}</strong>
                <p>
                  创建于 {new Date(migrationDialog.inspected.manifest.createdAt).toLocaleString('zh-CN')}；
                  将导入 {migrationDialog.inspected.stateSummary.entities} 个实体、
                  {migrationDialog.inspected.stateSummary.relations} 条关系、
                  {migrationDialog.inspected.stateSummary.tasks} 项任务。
                </p>
                <p>
                  当前本机有 {migrationDialog.inspected.currentStateSummary.entities} 个实体、
                  {migrationDialog.inspected.currentStateSummary.relations} 条关系、
                  {migrationDialog.inspected.currentStateSummary.claims} 条事实、
                  {migrationDialog.inspected.currentStateSummary.events} 个事件、
                  {migrationDialog.inspected.currentStateSummary.tasks} 项任务；它们会被整体替换并先保存为安全快照。
                </p>
              </div>
              <label><span>输入“导入并替换”确认</span><input autoFocus
                value={migrationImportConfirmation}
                disabled={migratingMemory}
                onChange={event => setMigrationImportConfirmation(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && migrationImportConfirmation === '导入并替换') {
                    void importMemoryBundle()
                  }
                }}
                placeholder="导入并替换" /></label>
            </>}
            {migrationDialog.status !== 'preview' && <small className="assistant-settings-note">
                采用 scrypt 派生密钥和 AES-256-GCM 认证加密；目标电脑导入后会自动换成自己的 macOS 钥匙串密钥。
              </small>}
            <div className="assistant-modal-actions">
              <button disabled={migratingMemory} onClick={closeMigrationDialog}>取消</button>
              {migrationDialog.status !== 'error' && <button
                className={migrationDialog.status === 'preview' ? 'danger' : 'primary'}
                disabled={migratingMemory || (migrationDialog.status === 'preview' &&
                  migrationImportConfirmation !== '导入并替换')}
                onClick={() => void (migrationDialog.mode === 'export' ? exportMemoryBundle() : importMemoryBundle())}>
                {migratingMemory
                  ? migrationDialog.status === 'preview' ? '正在创建安全点并导入…' : '正在验证…'
                  : migrationDialog.mode === 'export' ? '选择位置并导出'
                    : migrationDialog.status === 'preview' ? '确认导入并替换' : '验证并预览'}
              </button>}
            </div>
          </div>
        </div>
      )}

      {showSources && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal assistant-source-modal">
            <div className="assistant-modal-title"><div><h2>信息来源</h2><p>关闭后消息不会发送给模型，也不会进入待办和知识图谱。</p></div><button onClick={() => setShowSources(false)}><X size={16} /></button></div>
            {Number(dashboard?.conversationSourceMutationCommits?.prepared || 0) > 0 && <div className="assistant-error">
              <strong>来源开关恢复现场仍待处理</strong>
              <span>{Number(dashboard.conversationSourceMutationCommits.prepared)} 组变更的游标状态不明确；
                SQLCipher 已保留恢复载荷，系统不会猜测覆盖。</span>
            </div>}
            {!!dashboard?.conversationSourceMutationCommits?.startupRecovery?.attempted && <small className="assistant-evidence">
              本次启动核验 {Number(dashboard.conversationSourceMutationCommits.startupRecovery.attempted)} 组中断来源变更：
              完成 {Number(dashboard.conversationSourceMutationCommits.startupRecovery.applied)}、
              放弃 {Number(dashboard.conversationSourceMutationCommits.startupRecovery.abandoned)}、
              冲突 {Number(dashboard.conversationSourceMutationCommits.startupRecovery.conflicts)}。
            </small>}
            <div className="assistant-source-actions">
              <button onClick={() => void setSourceType('group', false)}>关闭全部群聊</button>
              <button onClick={() => void setSourceType('group', true)}>开启全部群聊</button>
              <button onClick={() => void setSourceType('private', true)}>开启全部私聊</button>
            </div>
            <input className="assistant-source-search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="搜索群聊或联系人" />
            <div className="assistant-source-filters">
              <select value={sourceTypeFilter} onChange={event => setSourceTypeFilter(event.target.value as any)}>
                <option value="all">全部类型</option><option value="group">群聊</option><option value="private">私聊</option>
              </select>
              <select value={sourceEnabledFilter} onChange={event => setSourceEnabledFilter(event.target.value as any)}>
                <option value="all">全部状态</option><option value="enabled">参与分析</option><option value="disabled">停止分析</option>
              </select>
              <span>群聊 {sourceDirectory.counts.groupEnabled}/{sourceDirectory.counts.group} · 私聊 {sourceDirectory.counts.privateEnabled}/{sourceDirectory.counts.private}</span>
            </div>
            <div className="assistant-source-list">
              {sourceDirectory.items.map((source: any) => (
                <label className="assistant-source-row" key={source.sessionId}>
                  <span><strong>{source.displayName}</strong><small>{source.type === 'group' ? '群聊' : '私聊'} · {source.enabled ? '参与分析' : '已停止分析'}</small></span>
                  <input type="checkbox" checked={source.enabled} disabled={sourceLoading} onChange={() => void toggleSource(source)} />
                </label>
              ))}
              {!sourceLoading && !sourceDirectory.items.length && <div className="assistant-source-empty">没有匹配的信息来源</div>}
              {sourceDirectory.hasMore && <button
                className="assistant-source-more"
                disabled={sourceLoading}
                onClick={() => void loadConversationSources(sourceDirectory.items.length, true)}>
                {sourceLoading ? '加载中…' : '加载更多'}
              </button>}
            </div>
            <div className="assistant-source-footer">
              <span>显示 {sourceDirectory.items.length}/{sourceDirectory.total} · 全部 {sourceDirectory.counts.enabled} 个来源已开启</span>
              <button className="primary" onClick={() => setShowSources(false)}>完成</button>
            </div>
          </div>
        </div>
      )}

      {showDataSources && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal assistant-source-modal">
            <div className="assistant-modal-title"><div><h2>数据源连接器</h2>
              <p>每个连接器拥有独立状态和 checkpoint；只有消费成功后才推进断点。</p>
            </div><button onClick={() => setShowDataSources(false)}><X size={16} /></button></div>
            <div className="assistant-source-list">
              {dataSources.map(source => (
                <label className="assistant-source-row" key={source.id}>
                  <span><strong>{source.displayName}</strong>
                    <small>{source.description}</small>
                    <small>
                      {source.localOnly ? '仅本机' : '需要单独授权'}
                      {' · '}{source.available ? source.status === 'running' ? '正在同步' : source.status === 'error' ? '需要重试' : source.lastSuccessAt ? `最近成功 ${new Date(source.lastSuccessAt).toLocaleString('zh-CN')}` : '已就绪' : '连接器待接入'}
                    </small>
                    <small>{(source.capabilities || []).map((capability: string) => ({
                      incremental: '增量断点', 'original-evidence': '原文证据', tasks: '待办',
                      claims: '事实', events: '事件', attachments: '附件'
                    } as Record<string, string>)[capability] || capability).join(' · ')}</small>
                    {source.id === 'documents' && source.analysis && <small>
                      结构化抽取：{source.analysis.completed}/{source.analysis.total} 已完成
                      {source.analysis.pending ? ` · ${source.analysis.pending} 个待处理` : ''}
                      {source.analysis.deferred ? ` · ${source.analysis.deferred} 个退避等待` : ''}
                      {source.analysis.failed ? ` · ${source.analysis.failed} 个最近失败` : ''}
                    </small>}
                    {source.id === 'calendar' && <small>
                      权限：{({
                        fullAccess: '已授权读取', authorized: '已授权读取',
                        notDetermined: '尚未请求', denied: '已拒绝',
                        restricted: '受系统限制', writeOnly: '仅写入（无法索引）',
                        unavailable: 'helper 不可用'
                      } as Record<string, string>)[source.authorization] || source.authorization || '未知'}
                      {' · '}{source.selectedCalendarCount || 0} 个日历已选择
                    </small>}
                    {source.id === 'mail' && <small>
                      权限：{({
                        authorized: '已授权只读访问',
                        notAuthorized: '尚未授权或已拒绝',
                        mailNotRunning: 'Mail 当前未运行',
                        unavailable: 'helper 不可用',
                        unknown: '状态未知'
                      } as Record<string, string>)[source.authorization] || source.authorization || '未知'}
                      {' · '}{source.selectedMailboxCount || 0} 个邮箱已选择
                      {' · '}{source.config?.allowModelAnalysis ? '已允许进入 DeepSeek 问答上下文' : '正文仅本机'}
                    </small>}
                    {source.lastError && <small className="assistant-error">{source.lastError}</small>}
                    {source.id === 'documents' && <button type="button" onClick={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      void configureDocumentSource()
                    }}>{source.config?.folderPath ? '更换文档目录' : '选择文档目录'}</button>}
                    {source.id === 'calendar' && source.available && <button type="button" disabled={calendarConnecting}
                      onClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        void configureCalendarSource(source)
                      }}>
                      {calendarConnecting ? '正在连接…' : source.selectedCalendarCount ? '更改所选日历' : '授权并选择日历'}
                    </button>}
                    {source.id === 'mail' && source.available && <button type="button" disabled={mailConnecting}
                      onClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        void configureMailSource(source)
                      }}>
                      {mailConnecting ? '正在连接…' : source.selectedMailboxCount ? '更改所选邮箱' : '授权并选择邮箱'}
                    </button>}
                  </span>
                  <input type="checkbox" checked={Boolean(source.enabled)}
                    disabled={!source.available ||
                      (source.id === 'calendar' && !source.selectedCalendarCount) ||
                      (source.id === 'mail' && !source.selectedMailboxCount)}
                    title={!source.available
                      ? '该连接器尚未安装'
                      : source.id === 'calendar' && !source.selectedCalendarCount
                        ? '请先授权并选择日历'
                        : source.id === 'mail' && !source.selectedMailboxCount
                          ? '请先授权并选择邮箱'
                          : '开启或暂停该数据源'}
                    onChange={() => void toggleDataSource(source)} />
                </label>
              ))}
            </div>
            {calendarPicker && <div className="assistant-calendar-picker">
              <div><strong>选择允许本机索引的日历</strong>
                <small>未选择的日历不会读取；事件按独立 checkpoint 增量保存，并保留来源证据。</small></div>
              <div className="assistant-calendar-list">
                {calendarPicker.calendars.map(calendar => (
                  <label key={calendar.id}>
                    <input type="checkbox" checked={calendarPicker.selectedIds.includes(calendar.id)}
                      onChange={() => setCalendarPicker(current => current ? {
                        ...current,
                        selectedIds: current.selectedIds.includes(calendar.id)
                          ? current.selectedIds.filter(id => id !== calendar.id)
                          : [...current.selectedIds, calendar.id]
                      } : current)} />
                    <span><strong>{calendar.title}</strong><small>{calendar.source}</small></span>
                  </label>
                ))}
              </div>
              <div className="assistant-calendar-actions">
                <button onClick={() => setCalendarPicker(null)}>取消</button>
                <button className="primary" disabled={calendarConnecting || !calendarPicker.selectedIds.length}
                  onClick={() => void saveCalendarSelection()}>保存选择</button>
              </div>
            </div>}
            {mailPicker && <div className="assistant-calendar-picker">
              <div><strong>选择允许本机索引的 Mail 邮箱</strong>
                <small>未选择的邮箱不会读取；正文仅进入本机加密资源库和统一检索，不会默认发送给 DeepSeek。</small></div>
              <div className="assistant-calendar-list">
                {mailPicker.mailboxes.map(mailbox => (
                  <label key={mailbox.id}>
                    <input type="checkbox" checked={mailPicker.selectedIds.includes(mailbox.id)}
                      onChange={() => setMailPicker(current => current ? {
                        ...current,
                        selectedIds: current.selectedIds.includes(mailbox.id)
                          ? current.selectedIds.filter(id => id !== mailbox.id)
                          : [...current.selectedIds, mailbox.id]
                      } : current)} />
                    <span><strong>{mailbox.path.join(' / ')}</strong><small>{mailbox.accountName}</small></span>
                  </label>
                ))}
              </div>
              <label className="assistant-mail-model-toggle">
                <input type="checkbox" checked={mailPicker.allowModelAnalysis}
                  onChange={event => setMailPicker(current => current ? {
                    ...current,
                    allowModelAnalysis: event.target.checked
                  } : current)} />
                <span><strong>允许邮件片段进入 DeepSeek 问答上下文</strong>
                  <small>默认关闭。开启后，仅命中你问题的邮件片段会按当前脱敏策略发送；仍不会自动生成待办。</small></span>
              </label>
              <div className="assistant-calendar-actions">
                <button onClick={() => setMailPicker(null)}>取消</button>
                <button className="primary" disabled={mailConnecting || !mailPicker.selectedIds.length}
                  onClick={() => void saveMailSelection()}>保存选择</button>
              </div>
            </div>}
            <div className="assistant-source-footer"><span>{dataSources.filter(source => source.enabled).length} 个连接器已开启</span>
              <button className="primary" onClick={() => setShowDataSources(false)}>完成</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiAssistantPage
