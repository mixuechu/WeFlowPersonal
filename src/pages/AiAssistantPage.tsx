import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Bot, CalendarDays, Check, Clock3, Filter, Network, Paperclip, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { buildTaskCalendar, shanghaiToday } from '../utils/taskCalendar'
import type { ReviewStatusFilter } from '../utils/graphReviewFilters'
import { evidenceLocalMessageId, groupMemorySearchResults, memoryEvidenceSourceLabel, MEMORY_TYPE_LABELS, normalizeMemoryEvidence, type MemoryEvidence } from '../utils/memorySearchPresentation'
import { LatestRequestGate } from '../utils/latestRequestGate'
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
  evidence?: Array<{ messageId: string; timestamp: number; sender: string; excerpt: string }>
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

function EvidenceRows({
  evidence: rawEvidence,
  total,
  roleLabels = false
}: {
  evidence?: any[]
  total?: number
  roleLabels?: boolean
}) {
  const evidence = (rawEvidence || []).map(normalizeMemoryEvidence)
  if (!evidence.length) return <small className="assistant-evidence-empty">尚无可展示的原文证据</small>
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
      当前显示最近 {evidence.length} / {total} 条；完整历史可在统一检索中查看。
    </small>}
  </>
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
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [graphWorkspace, setGraphWorkspace] = useState<any>({
    viewport: { entities: [], relations: [], levels: {}, mode: 'overview', totalAvailable: 0, truncated: 0 },
    summary: { entities: 0, relations: 0 },
    predicates: [],
    focus: null,
    status: 'idle'
  })
  const graphWorkspaceGate = useRef(new LatestRequestGate())
  const [showEntityDossier, setShowEntityDossier] = useState(false)
  const [briefingPeriod, setBriefingPeriod] = useState<'latest' | 'week'>('latest')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectWorkspace, setProjectWorkspace] = useState<any>({ project: null, status: 'idle' })
  const [projectWorkspaceRefreshKey, setProjectWorkspaceRefreshKey] = useState(0)
  const projectWorkspaceGate = useRef(new LatestRequestGate())
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [taskWorkspace, setTaskWorkspace] = useState<any>({ task: null, history: [], status: 'idle' })
  const [taskWorkspaceRefreshKey, setTaskWorkspaceRefreshKey] = useState(0)
  const taskWorkspaceGate = useRef(new LatestRequestGate())
  const [forgettingEntityId, setForgettingEntityId] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showDataSources, setShowDataSources] = useState(false)
  const [sources, setSources] = useState<any[]>([])
  const [dataSources, setDataSources] = useState<any[]>([])
  const [eventTimeline, setEventTimeline] = useState<{ items: any[]; total: number; hasMore: boolean }>({
    items: [], total: 0, hasMore: false
  })
  const [claimArchive, setClaimArchive] = useState<{ items: any[]; total: number; hasMore: boolean; loading?: boolean }>({
    items: [], total: 0, hasMore: false
  })
  const [claimLoadingMore, setClaimLoadingMore] = useState(false)
  const [eventLoadingMore, setEventLoadingMore] = useState(false)
  const [claimEntityFilter, setClaimEntityFilter] = useState('')
  const [claimSourceFilter, setClaimSourceFilter] = useState('')
  const [claimStatusFilter, setClaimStatusFilter] = useState('')
  const [claimPredicateFilter, setClaimPredicateFilter] = useState('')
  const [claimFrom, setClaimFrom] = useState('')
  const [claimTo, setClaimTo] = useState('')
  const [eventSourceFilter, setEventSourceFilter] = useState('')
  const [eventStatusFilter, setEventStatusFilter] = useState('')
  const [eventFrom, setEventFrom] = useState('')
  const [eventTo, setEventTo] = useState('')
  const dashboardLoadGate = useRef(new LatestRequestGate())
  const claimArchiveGate = useRef(new LatestRequestGate())
  const eventTimelineGate = useRef(new LatestRequestGate())
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
  }>({ status: 'idle', query: '' })
  const [memoryLoadingMore, setMemoryLoadingMore] = useState(false)
  const memorySearchGate = useRef(new LatestRequestGate())
  const [memoryEvidenceArchive, setMemoryEvidenceArchive] = useState<{
    documentType: string
    sourceId: string
    title: string
    items: any[]
    total: number
    hasMore: boolean
    status: 'loading' | 'ready' | 'error'
    error?: string
  } | null>(null)
  const [memoryEvidenceLoadingMore, setMemoryEvidenceLoadingMore] = useState(false)
  const memoryEvidenceArchiveGate = useRef(new LatestRequestGate())
  const memoryConversationGate = useRef(new LatestRequestGate())
  const [editingClaim, setEditingClaim] = useState<any>(null)
  const [editingEvent, setEditingEvent] = useState<any>(null)
  const [memoryDeletionDialog, setMemoryDeletionDialog] = useState<any>(null)
  const [memoryDeletionConfirmation, setMemoryDeletionConfirmation] = useState('')
  const memoryDeletionGate = useRef(new LatestRequestGate())
  const [memoryDeletionArchive, setMemoryDeletionArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [memoryDeletionKind, setMemoryDeletionKind] = useState<'all' | 'claim' | 'event' | 'relation'>('all')
  const [memoryDeletionReason, setMemoryDeletionReason] = useState<'all' | 'manual_delete' | 'not_important'>('all')
  const [memoryDeletionQuery, setMemoryDeletionQuery] = useState('')
  const [memoryDeletionFrom, setMemoryDeletionFrom] = useState('')
  const [memoryDeletionTo, setMemoryDeletionTo] = useState('')
  const [memoryDeletionLoadingMore, setMemoryDeletionLoadingMore] = useState(false)
  const memoryDeletionArchiveGate = useRef(new LatestRequestGate())
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | Task['status']>('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<'all' | Task['priority']>('all')
  const [taskKindFilter, setTaskKindFilter] = useState<'all' | NonNullable<Task['taskKind']>>('all')
  const [taskView, setTaskView] = useState<'list' | 'calendar'>('list')
  const [taskArchive, setTaskArchive] = useState<{
    items: Task[]
    total: number
    hasMore: boolean
    projects: string[]
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, projects: [] })
  const [taskArchiveStatus, setTaskArchiveStatus] = useState<'all' | 'done' | 'cancelled'>('all')
  const [taskArchivePriority, setTaskArchivePriority] = useState('')
  const [taskArchiveProject, setTaskArchiveProject] = useState('')
  const [taskArchiveQuery, setTaskArchiveQuery] = useState('')
  const [taskArchiveFrom, setTaskArchiveFrom] = useState('')
  const [taskArchiveTo, setTaskArchiveTo] = useState('')
  const [taskArchiveLoadingMore, setTaskArchiveLoadingMore] = useState(false)
  const taskArchiveGate = useRef(new LatestRequestGate())
  const [taskOwnershipReviews, setTaskOwnershipReviews] = useState<{
    items: Task[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [taskOwnershipClassification, setTaskOwnershipClassification] = useState('')
  const [taskOwnershipPriority, setTaskOwnershipPriority] = useState('')
  const [taskOwnershipQuery, setTaskOwnershipQuery] = useState('')
  const [taskOwnershipFrom, setTaskOwnershipFrom] = useState('')
  const [taskOwnershipTo, setTaskOwnershipTo] = useState('')
  const [taskOwnershipLoadingMore, setTaskOwnershipLoadingMore] = useState(false)
  const taskOwnershipGate = useRef(new LatestRequestGate())
  const [taskFeedbackArchive, setTaskFeedbackArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: { active: number; revoked: number; all: number }
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: { active: 0, revoked: 0, all: 0 } })
  const [taskFeedbackStatus, setTaskFeedbackStatus] = useState<'all' | 'active' | 'revoked'>('all')
  const [taskFeedbackDecision, setTaskFeedbackDecision] = useState<'all' | 'mine' | 'rejected'>('all')
  const [taskFeedbackQuery, setTaskFeedbackQuery] = useState('')
  const [taskFeedbackFrom, setTaskFeedbackFrom] = useState('')
  const [taskFeedbackTo, setTaskFeedbackTo] = useState('')
  const [taskFeedbackLoadingMore, setTaskFeedbackLoadingMore] = useState(false)
  const [taskFeedbackDossier, setTaskFeedbackDossier] = useState<any>(null)
  const [taskFeedbackHistoryLoadingMore, setTaskFeedbackHistoryLoadingMore] = useState(false)
  const taskFeedbackArchiveGate = useRef(new LatestRequestGate())
  const taskFeedbackDossierGate = useRef(new LatestRequestGate())
  const [calendarMonth, setCalendarMonth] = useState(() => shanghaiToday().slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => shanghaiToday())
  const [pathFromId, setPathFromId] = useState('')
  const [pathToId, setPathToId] = useState('')
  const [graphPath, setGraphPath] = useState<any>(null)
  const [graphCommonNeighbors, setGraphCommonNeighbors] = useState<any>(null)
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({})
  const [entityNameEdits, setEntityNameEdits] = useState<Record<string, string>>({})
  const [relationEdits, setRelationEdits] = useState<Record<string, { subjectId: string; predicate: string; objectId: string }>>({})
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({})
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>('pending')
  const [reviewKindFilter, setReviewKindFilter] = useState('')
  const [reviewQuery, setReviewQuery] = useState('')
  const [reviewPage, setReviewPage] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: { pending: number; resolved: number; all: number }
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
  const mergeArchiveGate = useRef(new LatestRequestGate())
  const [memoryDiagnostics, setMemoryDiagnostics] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [ingestionArchive, setIngestionArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    counts: Record<string, number>
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false, counts: {} })
  const [ingestionArchiveStatus, setIngestionArchiveStatus] = useState<
    'all' | 'running' | 'completed' | 'partial' | 'failed'
  >('all')
  const [ingestionArchiveQuery, setIngestionArchiveQuery] = useState('')
  const [ingestionArchiveFrom, setIngestionArchiveFrom] = useState('')
  const [ingestionArchiveTo, setIngestionArchiveTo] = useState('')
  const [ingestionArchiveLoadingMore, setIngestionArchiveLoadingMore] = useState(false)
  const [ingestionDossier, setIngestionDossier] = useState<any>(null)
  const [ingestionBatchesLoadingMore, setIngestionBatchesLoadingMore] = useState(false)
  const ingestionArchiveGate = useRef(new LatestRequestGate())
  const ingestionDossierGate = useRef(new LatestRequestGate())
  const [backingUpMemory, setBackingUpMemory] = useState(false)
  const [restoringMemory, setRestoringMemory] = useState(false)
  const [migratingMemory, setMigratingMemory] = useState(false)
  const [migrationDialog, setMigrationDialog] = useState<{ mode: 'export' | 'import'; bundlePath?: string } | null>(null)
  const [migrationPassphrase, setMigrationPassphrase] = useState('')
  const [migrationPassphraseConfirmation, setMigrationPassphraseConfirmation] = useState('')
  const [indexingVectors, setIndexingVectors] = useState(false)
  const [memoryQuestion, setMemoryQuestion] = useState('')
  const [memoryAnswer, setMemoryAnswer] = useState<any>(null)
  const [memoryConversationId, setMemoryConversationId] = useState<string | null>(null)
  const [memoryConversation, setMemoryConversation] = useState<any>(null)
  const [assistantArchive, setAssistantArchive] = useState<{
    items: any[]
    total: number
    hasMore: boolean
    loading?: boolean
  }>({ items: [], total: 0, hasMore: false })
  const [assistantArchiveQuery, setAssistantArchiveQuery] = useState('')
  const [assistantArchiveFrom, setAssistantArchiveFrom] = useState('')
  const [assistantArchiveTo, setAssistantArchiveTo] = useState('')
  const [assistantArchiveLoadingMore, setAssistantArchiveLoadingMore] = useState(false)
  const [assistantMessagesLoadingMore, setAssistantMessagesLoadingMore] = useState(false)
  const assistantArchiveGate = useRef(new LatestRequestGate())
  const [askingMemory, setAskingMemory] = useState(false)
  const [creatingMemoryTask, setCreatingMemoryTask] = useState(false)
  const [memoryEntityFilter, setMemoryEntityFilter] = useState('')
  const [memorySessionFilter, setMemorySessionFilter] = useState('')
  const [memorySourceFilter, setMemorySourceFilter] = useState('')
  const [memoryTypeFilter, setMemoryTypeFilter] = useState('')
  const [memoryFrom, setMemoryFrom] = useState('')
  const [memoryTo, setMemoryTo] = useState('')
  const memorySearchOptions = useMemo(() => ({
    entityId: memoryEntityFilter || undefined,
    sessionId: memorySessionFilter || undefined,
    sessionName: sources.find(source => source.sessionId === memorySessionFilter)?.displayName || undefined,
    sourceIds: memorySourceFilter ? [memorySourceFilter] : undefined,
    documentTypes: memoryTypeFilter ? [memoryTypeFilter] : undefined,
    from: memoryFrom || undefined,
    to: memoryTo || undefined
  }), [memoryEntityFilter, memorySessionFilter, memorySourceFilter, memoryTypeFilter, memoryFrom, memoryTo, sources])
  const hasMemoryScope = Boolean(memoryEntityFilter || memorySessionFilter || memorySourceFilter || memoryTypeFilter || memoryFrom || memoryTo)
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
  const assistantArchiveOptions = useMemo(() => ({
    query: assistantArchiveQuery || undefined,
    from: assistantArchiveFrom ? new Date(`${assistantArchiveFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: assistantArchiveTo ? new Date(`${assistantArchiveTo}T23:59:59.999+08:00`).toISOString() : undefined,
    offset: 0,
    limit: 30
  }), [assistantArchiveQuery, assistantArchiveFrom, assistantArchiveTo])
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
    void window.electronAPI.aiAssistant.getConversationSources().then(setSources).catch(() => {})
    void window.electronAPI.aiAssistant.getDataSources().then(setDataSources).catch(() => {})
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const request = claimArchiveGate.current.begin()
    setClaimLoadingMore(false)
    setClaimArchive(current => ({ ...current, items: [], loading: true }))
    void window.electronAPI.aiAssistant.getClaimArchive(claimArchiveOptions).then(result => {
      if (!claimArchiveGate.current.isCurrent(request)) return
      setClaimArchive({ ...result, loading: false })
    }).catch(() => {
      if (!claimArchiveGate.current.isCurrent(request)) return
      setClaimArchive({ items: [], total: 0, hasMore: false, loading: false })
    })
    return () => {
      if (claimArchiveGate.current.isCurrent(request)) claimArchiveGate.current.invalidate()
    }
  }, [claimArchiveOptions, dashboard?.memoryRevision])

  useEffect(() => {
    const request = eventTimelineGate.current.begin()
    setEventLoadingMore(false)
    setEventTimeline(current => ({ ...current, items: [] }))
    void window.electronAPI.aiAssistant.getEventTimeline(eventTimelineOptions).then(result => {
      if (eventTimelineGate.current.isCurrent(request)) setEventTimeline(result)
    }).catch(() => {
      if (eventTimelineGate.current.isCurrent(request)) {
        setEventTimeline({ items: [], total: 0, hasMore: false })
      }
    })
    return () => {
      if (eventTimelineGate.current.isCurrent(request)) eventTimelineGate.current.invalidate()
    }
  }, [eventTimelineOptions, dashboard?.memoryRevision])

  useEffect(() => {
    const request = taskArchiveGate.current.begin()
    setTaskArchiveLoadingMore(false)
    setTaskArchive(current => ({ ...current, items: [], loading: true }))
    void window.electronAPI.aiAssistant.getTaskArchive(taskArchiveOptions).then(result => {
      if (!taskArchiveGate.current.isCurrent(request)) return
      setTaskArchive({ ...result, loading: false })
    }).catch(() => {
      if (!taskArchiveGate.current.isCurrent(request)) return
      setTaskArchive({ items: [], total: 0, hasMore: false, projects: [], loading: false })
    })
    return () => {
      if (taskArchiveGate.current.isCurrent(request)) taskArchiveGate.current.invalidate()
    }
  }, [taskArchiveOptions, dashboard?.taskRevision])

  useEffect(() => {
    const request = assistantArchiveGate.current.begin()
    setAssistantArchiveLoadingMore(false)
    setAssistantArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getAssistantConversations(assistantArchiveOptions).then(result => {
        if (!assistantArchiveGate.current.isCurrent(request)) return
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
  }, [assistantArchiveOptions, dashboard?.assistantArchive?.revision])

  useEffect(() => {
    const request = taskOwnershipGate.current.begin()
    setTaskOwnershipLoadingMore(false)
    setTaskOwnershipReviews(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getTaskOwnershipReviews(taskOwnershipOptions).then(result => {
        if (!taskOwnershipGate.current.isCurrent(request)) return
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
  }, [taskOwnershipOptions, dashboard?.taskOwnershipReviews?.revision])

  useEffect(() => {
    const request = taskFeedbackArchiveGate.current.begin()
    setTaskFeedbackLoadingMore(false)
    setTaskFeedbackArchive(current => ({ ...current, items: [], loading: true }))
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.getTaskReviewDecisionPage(taskFeedbackOptions).then(result => {
        if (!taskFeedbackArchiveGate.current.isCurrent(request)) return
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
  }, [taskFeedbackOptions, dashboard?.taskReviewFeedback?.archive?.revision])

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
    dashboard?.memoryDeletionArchive?.revision
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
    ingestionArchiveOptions
  ])

  useEffect(() => {
    const query = memoryQuery.trim()
    const request = memorySearchGate.current.begin()
    setMemoryResults([])
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
        setMemoryResults(page.results)
        setMemorySearchState({
          status: 'ready',
          query,
          total: page.total,
          hasMore: page.hasMore,
          truncated: page.truncated,
          scopeCandidates: page.scopeCandidates
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
  }, [memoryQuery, memorySearchOptions, hasMemoryScope])

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
  }, [mergeArchiveOptions, dashboard?.mergeHistoryArchive?.revision])

  useEffect(() => {
    const request = graphWorkspaceGate.current.begin()
    setGraphWorkspace((current: any) => ({
      ...current,
      viewport: { entities: [], relations: [], levels: {}, mode: selectedEntityId ? 'focus' : graphQuery.trim() ? 'search' : 'overview', totalAvailable: 0, truncated: 0 },
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
        depth: graphFocusDepth
      }).then(workspace => {
        if (!graphWorkspaceGate.current.isCurrent(request)) return
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
  }, [graphQuery, graphRelationType, graphRelationStatus, selectedEntityId, graphFocusDepth, dashboard?.graphRevision])

  useEffect(() => {
    const request = projectWorkspaceGate.current.begin()
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
  const projectInsights: any[] = dashboard?.projectInsights || []
  const selectedProject = projectWorkspace.status === 'ready' &&
    projectWorkspace.project?.id === selectedProjectId ? projectWorkspace.project : null
  const tasks: Task[] = dashboard?.tasks || []
  const taskReviewQueue: Task[] = taskOwnershipReviews.items
  const taskReminders: any[] = dashboard?.taskReminders || []
  const reminderPreferences = dashboard?.reminderPreferences
  const taskReviewFeedback = dashboard?.taskReviewFeedback || { mine: 0, rejected: 0, suppressed: 0, reconciled: 0, recent: [] }
  const openTasks = useMemo(() => tasks.filter(task => !['done', 'cancelled'].includes(task.status)), [tasks])
  const displayedTasks = useMemo(() => tasks.filter(task =>
    (taskStatusFilter === 'all' || task.status === taskStatusFilter) &&
    (taskPriorityFilter === 'all' || task.priority === taskPriorityFilter) &&
    (taskKindFilter === 'all' || (task.taskKind || 'action') === taskKindFilter)
  ), [tasks, taskStatusFilter, taskPriorityFilter, taskKindFilter])
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
  const graph = dashboard?.graph || { entities: [], relations: [], reviewQueue: [] }
  const trustedGraphEntities = useMemo(() =>
    graph.entities.filter((entity: any) => entity.trustStatus === 'confirmed'), [graph.entities])
  const trustedGraphEntityIds = useMemo(() =>
    new Set(trustedGraphEntities.map((entity: any) => entity.id)), [trustedGraphEntities])
  const claimEntitiesTrusted = (claim: any) =>
    Boolean(claim?.subject_id && trustedGraphEntityIds.has(claim.subject_id)) &&
    (!claim?.object_entity_id || trustedGraphEntityIds.has(claim.object_entity_id))
  const eventEntitiesTrusted = (event: any) =>
    (event?.participants || []).every((participant: any) => trustedGraphEntityIds.has(participant.entity_id))
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
    graph.entities.find((entity: any) => entity.id === selectedEntityId)
  const selectedEntityInsight = graphWorkspace.focus?.insight
  const relationPredicates: string[] = graphWorkspace.predicates || []
  const pendingReviewCount = reviewPage.counts.pending
  const resolvedReviewCount = reviewPage.counts.resolved
  const visibleReviews = reviewPage.items
  const groupedMemoryResults = useMemo(() => groupMemorySearchResults(memoryResults), [memoryResults])
  const assistantConversations: any[] = assistantArchive.items
  const identityDisambiguation = dashboard?.identityDisambiguation
  const memoryFeed = dashboard?.memoryFeed || { claims: [], events: [], resources: [] }
  const ingestionStatus = dashboard?.ingestionStatus
  const ingestionCounts = Object.fromEntries((ingestionStatus?.batches || []).map((item: any) => [item.status, Number(item.count || 0)]))
  const visibleClaims = claimArchive.items
  const visibleEvents = eventTimeline.items || []
  const visibleResources = memoryFeed.resources || []
  const loadMoreClaims = async () => {
    if (claimLoadingMore || !claimArchive.hasMore) return
    const request = claimArchiveGate.current.begin()
    setClaimLoadingMore(true)
    try {
      const result = await window.electronAPI.aiAssistant.getClaimArchive({
        ...claimArchiveOptions,
        offset: visibleClaims.length,
        limit: 100
      })
      if (!claimArchiveGate.current.isCurrent(request)) return
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
        limit: 100
      })
      if (!eventTimelineGate.current.isCurrent(request)) return
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
  const resourceTrash = dashboard?.resourceTrash || []
  const selectedEntityClaims = graphWorkspace.focus?.claims || []
  const selectedEntityEvents = graphWorkspace.focus?.events || []
  const selectedEntityRelations = graphWorkspace.focus?.relations || []
  const selectedEntityRelationHistory = graphWorkspace.focus?.relationHistory || []
  const selectedEntityCorrections = graphWorkspace.focus?.entityCorrections || []
  const selectedEntityRelationCorrections = graphWorkspace.focus?.relationCorrections || []
  const selectedEntityProfileCorrections = graphWorkspace.focus?.entityProfileCorrections || []
  const selectedEntityTasks = selectedEntity
    ? tasks.filter(task => {
      const names = [
        selectedEntity.canonicalName,
        ...(selectedEntity.aliases || []),
        ...(selectedEntity.accountIds || []),
        ...(selectedEntity.externalIdentities || []).flatMap((identity: any) => [identity.accountId, identity.displayName])
      ]
        .map((value: string) => value.trim().toLowerCase()).filter(Boolean)
      const haystack = [
        task.title, task.detail, task.owner, task.project, ...(task.collaborators || []),
        ...(task.evidence || []).map(item => `${item.sender} ${item.excerpt}`)
      ].join(' ').toLowerCase()
      return names.some((name: string) => haystack.includes(name))
    })
    : []

  const syncNow = async () => {
    setSyncing(true)
    setMessage('')
    try {
      const result = await window.electronAPI.aiAssistant.sync()
      setMessage(result.cancelled
        ? result.message
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
    await window.electronAPI.aiAssistant.updateTask(task.id, {
      status: task.status === 'done' ? 'todo' : 'done'
    })
    await load()
    if (selectedProjectId) setProjectWorkspaceRefreshKey(value => value + 1)
  }

  const restoreArchivedTask = async (task: Task) => {
    await window.electronAPI.aiAssistant.updateTask(task.id, { status: 'todo' })
    setSelectedTaskId('')
    await load()
    if (task.project && selectedProjectId === task.project) {
      setProjectWorkspaceRefreshKey(value => value + 1)
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
        limit: 40
      })
      if (!taskArchiveGate.current.isCurrent(request)) return
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
        limit: 40
      })
      if (!taskOwnershipGate.current.isCurrent(request)) return
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
        limit: 40
      })
      if (!taskFeedbackArchiveGate.current.isCurrent(request)) return
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
        limit: 40
      })
      if (!memoryDeletionArchiveGate.current.isCurrent(request)) return
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
        limit: 30
      })
      if (!ingestionArchiveGate.current.isCurrent(request)) return
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

  const openIngestionDossier = async (runId: string) => {
    if (ingestionDossier?.id === runId) {
      ingestionDossierGate.current.invalidate()
      setIngestionDossier(null)
      return
    }
    const request = ingestionDossierGate.current.begin()
    setIngestionDossier({ id: runId, loading: true })
    try {
      const dossier = await window.electronAPI.aiAssistant.getIngestionRunDossier(
        runId,
        { batchOffset: 0, batchLimit: 40 }
      )
      if (ingestionDossierGate.current.isCurrent(request)) setIngestionDossier(dossier)
    } catch (error: any) {
      if (ingestionDossierGate.current.isCurrent(request)) {
        setIngestionDossier({ id: runId, error: error?.message || String(error) })
      }
    }
  }

  const loadMoreIngestionBatches = async () => {
    if (!ingestionDossier?.id || !ingestionDossier.batchHasMore ||
      ingestionBatchesLoadingMore) return
    const request = ingestionDossierGate.current.begin()
    setIngestionBatchesLoadingMore(true)
    try {
      const page = await window.electronAPI.aiAssistant.getIngestionRunDossier(
        ingestionDossier.id,
        { batchOffset: ingestionDossier.batches?.length || 0, batchLimit: 40 }
      )
      if (!page || !ingestionDossierGate.current.isCurrent(request)) return
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

  const openTaskFeedbackDossier = async (evidenceFingerprint: string) => {
    const request = taskFeedbackDossierGate.current.begin()
    setTaskFeedbackDossier({ evidence_fingerprint: evidenceFingerprint, loading: true })
    try {
      const dossier = await window.electronAPI.aiAssistant.getTaskReviewDecisionDossier(
        evidenceFingerprint,
        { historyOffset: 0, historyLimit: 50 }
      )
      if (taskFeedbackDossierGate.current.isCurrent(request)) setTaskFeedbackDossier(dossier)
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
        { historyOffset: taskFeedbackDossier.history?.length || 0, historyLimit: 50 }
      )
      if (!page || !taskFeedbackDossierGate.current.isCurrent(request)) return
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

  const saveTask = async () => {
    if (!editingTask?.id || !String(editingTask.title || '').trim()) return
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
    })
    setEditingTask(null)
    await load()
  }

  const completeVisibleTasks = async () => {
    const targets = displayedTasks.filter(task => !['done', 'cancelled'].includes(task.status))
    await Promise.all(targets.map(task => window.electronAPI.aiAssistant.updateTask(task.id, { status: 'done' })))
    await load()
  }

  const findGraphPath = async () => {
    if (!pathFromId || !pathToId) return
    const [path, common] = await Promise.all([
      window.electronAPI.aiAssistant.findGraphPath(pathFromId, pathToId, 6),
      window.electronAPI.aiAssistant.findCommonNeighbors(pathFromId, pathToId)
    ])
    setGraphPath(path)
    setGraphCommonNeighbors(common)
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

  const restoreMemory = async (backup: any) => {
    if (restoringMemory || !backup?.path || !backup?.hasState) return
    if (!window.confirm(`确定恢复到 ${new Date(backup.createdAt).toLocaleString('zh-CN')} 的个人记忆快照吗？恢复前会自动创建安全快照。`)) return
    setRestoringMemory(true)
    try {
      await window.electronAPI.aiAssistant.restoreMemoryBackup(backup.path)
      setMessage('个人记忆已恢复；恢复前的安全快照已保留。')
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
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
    setMigrationDialog({ mode: 'import', bundlePath })
  }

  const importMemoryBundle = async () => {
    const bundlePath = migrationDialog?.bundlePath
    if (!bundlePath || migratingMemory || restoringMemory) return
    setMigratingMemory(true)
    try {
      const inspected = await window.electronAPI.aiAssistant.inspectMemoryBundle(bundlePath, migrationPassphrase)
      const summary = inspected.stateSummary
      if (!window.confirm(
        `迁移包校验通过。\n创建时间：${new Date(inspected.manifest.createdAt).toLocaleString('zh-CN')}\n` +
        `包含 ${summary.entities} 个实体、${summary.relations} 条关系、${summary.tasks} 项任务。\n\n` +
        '确定导入并替换当前个人记忆吗？当前数据会先自动创建安全快照。'
      )) return
      await window.electronAPI.aiAssistant.importMemoryBundle(bundlePath, migrationPassphrase)
      setMigrationDialog(null)
      setMigrationPassphrase('')
      setMessage('个人记忆迁移完成；导入前的安全快照已保留。')
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setMigratingMemory(false)
    }
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
      mergeTargetEntityId?: string
      correctedCanonicalName?: string
      correctedSummaryText?: string
      correctedAliasText?: string
      relationCorrection?: { subjectId?: string; predicate?: string; objectId?: string }
    }
  ) => {
    try {
      await window.electronAPI.aiAssistant.updateGraphReview(id, decision, options)
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
      setMessage(error?.message || String(error))
    }
  }

  const decideTaskReview = async (id: string, decision: 'mine' | 'rejected') => {
    await window.electronAPI.aiAssistant.updateTaskReview(id, decision)
    await load()
  }

  const revertTaskReview = async (evidenceFingerprint: string) => {
    try {
      await window.electronAPI.aiAssistant.revertTaskReview(evidenceFingerprint)
      if (taskFeedbackDossier?.evidence_fingerprint === evidenceFingerprint) {
        taskFeedbackDossierGate.current.invalidate()
        setTaskFeedbackDossier(null)
      }
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const revertMerge = async (id: number) => {
    try {
      await window.electronAPI.aiAssistant.revertMerge(id)
      await load()
      setReviewRefreshKey(value => value + 1)
    } catch (error: any) {
      setMessage(error?.message || String(error))
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
        limit: 40
      })
      if (!mergeArchiveGate.current.isCurrent(request)) return
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
        limit: 40
      })
      if (!reviewPageGate.current.isCurrent(request)) return
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
    await window.electronAPI.aiAssistant.updateMemoryItemStatus(kind, id, nextStatus)
    await load()
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
      label: String(item.title || item.predicate || ''),
      status: 'loading'
    })
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryItem(kind, id)
      if (!memoryDeletionGate.current.isCurrent(request)) return
      if (!preview) {
        setMemoryDeletionDialog({
          kind,
          id,
          label: String(item.title || item.predicate || ''),
          status: 'error',
          error: '该条记忆不存在或已经被删除。'
        })
        return
      }
      setMemoryDeletionDialog({ kind, id, label: preview.label, preview, status: 'ready' })
    } catch (error: any) {
      if (!memoryDeletionGate.current.isCurrent(request)) return
      setMemoryDeletionDialog({
        kind,
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
    if (!memoryDeletionDialog || memoryDeletionDialog.status !== 'ready' ||
        memoryDeletionConfirmation !== '永久删除') return
    const { kind, id } = memoryDeletionDialog
    setMemoryDeletionDialog((current: any) => ({ ...current, status: 'deleting', error: undefined }))
    try {
      const result = await window.electronAPI.aiAssistant.deleteMemoryItem(kind, id)
      const kindLabel = kind === 'claim' ? '事实' : kind === 'event' ? '事件' : '关系'
      setMessage(`已永久删除${kindLabel}；抑制指纹 ${result.fingerprint} 已保存。`)
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
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryItem(kind, id)
      if (!preview) {
        setMessage(`该${kindLabel}已不存在。`)
        await load()
        return
      }
      const confirmed = window.confirm(
        `把这条${kindLabel}“${label}”标记为不重要？\n\n` +
        `将释放 ${preview.counts.evidence || 0} 条原文证据、${preview.counts.searchDocuments || 0} 个检索索引` +
        `${preview.counts.assistantMessages ? `，并移除 ${preview.counts.assistantMessages} 段引用过它的问答` : ''}。\n` +
        '系统只保留很小的抑制指纹，今后重跑同一原文也不会再次生成。'
      )
      if (!confirmed) return
      const result = await window.electronAPI.aiAssistant.ignoreMemoryItem(kind, id)
      setEditingClaim((current: any) => current?.id === id ? null : current)
      setEditingEvent((current: any) => current?.id === id ? null : current)
      if (memoryAnswer?.citations?.some((citation: any) => citation.documentId === `${kind}:${id}`)) setMemoryAnswer(null)
      setMessage(
        `已忽略不重要${kindLabel}；清理 ${result.removed?.evidence || 0} 条证据、` +
        `${result.removed?.searchDocuments || 0} 个索引，空间可供后续记忆复用。`
      )
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const deleteMemoryResource = async (resource: any) => {
    const confirmed = window.confirm(
      `确定从个人记忆中删除“${resource.title || '未命名资源'}”吗？\n\n` +
      '相关全文索引、向量和原消息证据引用会一并移除；以后重新整理同一条消息也不会自动恢复。'
    )
    if (!confirmed) return
    try {
      await window.electronAPI.aiAssistant.deleteMemoryResource(resource.id)
      setMessage(`已从个人记忆删除：${resource.title || '未命名资源'}`)
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const restoreMemoryResource = async (resource: any) => {
    try {
      const result = await window.electronAPI.aiAssistant.restoreMemoryResource(resource.id)
      setMessage(result?.success ? `已恢复资源：${resource.title || '未命名资源'}` : '资源恢复失败')
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const purgeMemoryResourceTrash = async (resource: any) => {
    const confirmed = window.confirm(
      `永久删除“${resource.title || '未命名资源'}”的回收站快照？\n\n` +
      '此操作无法撤销；原消息今后也不会重新生成该资源。'
    )
    if (!confirmed) return
    try {
      await window.electronAPI.aiAssistant.purgeMemoryResourceTrash(resource.id)
      setMessage(`已永久删除资源快照：${resource.title || '未命名资源'}`)
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const saveClaimCorrection = async () => {
    if (!editingClaim?.id || !String(editingClaim.value || '').trim()) return
    await window.electronAPI.aiAssistant.correctClaim(editingClaim.id, {
      value: editingClaim.value,
      validFrom: editingClaim.validFrom,
      validTo: editingClaim.validTo
    })
    setEditingClaim(null)
    await load()
  }

  const beginEventCorrection = (event: any) => {
    setEditingEvent({
      id: event.id,
      title: event.title || '',
      eventType: event.event_type || 'event',
      description: event.description || '',
      startAt: isoToShanghaiInput(event.start_at),
      endAt: isoToShanghaiInput(event.end_at),
      location: event.location || ''
    })
    window.setTimeout(() =>
      document.getElementById(`memory-event-${event.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const saveEventCorrection = async () => {
    if (!editingEvent?.id || !String(editingEvent.title || '').trim()) return
    try {
      await window.electronAPI.aiAssistant.correctEvent(editingEvent.id, {
        title: editingEvent.title,
        eventType: editingEvent.eventType,
        description: editingEvent.description,
        startAt: shanghaiInputToIso(editingEvent.startAt),
        endAt: shanghaiInputToIso(editingEvent.endAt),
        location: editingEvent.location
      })
      setEditingEvent(null)
      setMessage('事件纠正已确认并写入版本审计；后续重抽取只会追加证据。')
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
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
      setMemoryConversation(await window.electronAPI.aiAssistant.getAssistantConversation(answer.conversationId))
      setMemoryQuestion('')
      await load()
    } catch (error: any) {
      if (memoryConversationGate.current.isCurrent(request)) {
        setMemoryAnswer({ answer: error?.message || String(error), citations: [], uncertainty: '' })
      }
    } finally {
      setAskingMemory(false)
    }
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
        { offset: memoryResults.length, limit: 40 }
      )
      if (!memorySearchGate.current.isCurrent(request)) return
      setMemoryResults(current => {
        const merged = new Map(current.map(item => [item.id, item]))
        for (const item of page.results) merged.set(item.id, item)
        return [...merged.values()]
      })
      setMemorySearchState({
        status: 'ready',
        query,
        total: page.total,
        hasMore: page.hasMore,
        truncated: page.truncated,
        scopeCandidates: page.scopeCandidates
      })
    } catch (error: any) {
      if (memorySearchGate.current.isCurrent(request)) {
        setMemorySearchState(current => ({ ...current, status: 'error', error: error?.message || String(error) }))
      }
    } finally {
      if (memorySearchGate.current.isCurrent(request)) setMemoryLoadingMore(false)
    }
  }

  const openMemoryEvidenceArchive = async (documentType: string, sourceId: string, title: string) => {
    const request = memoryEvidenceArchiveGate.current.begin()
    setMemoryEvidenceLoadingMore(false)
    setMemoryEvidenceArchive({
      documentType,
      sourceId,
      title,
      items: [],
      total: 0,
      hasMore: false,
      status: 'loading'
    })
    try {
      const page = await window.electronAPI.aiAssistant.getMemoryEvidencePage(
        documentType,
        sourceId,
        { offset: 0, limit: 40 }
      )
      if (!memoryEvidenceArchiveGate.current.isCurrent(request)) return
      setMemoryEvidenceArchive({
        documentType,
        sourceId,
        title,
        items: page.items,
        total: page.total,
        hasMore: page.hasMore,
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
        hasMore: false,
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
        { offset: archive.items.length, limit: 40 }
      )
      if (!memoryEvidenceArchiveGate.current.isCurrent(request)) return
      setMemoryEvidenceArchive(current => {
        if (!current || current.documentType !== archive.documentType || current.sourceId !== archive.sourceId) return current
        const seen = new Set(current.items.map(item =>
          `${String(item.session_id || '')}\u0000${String(item.message_id || '')}`))
        const additions = page.items.filter(item => {
          const key = `${String(item.session_id || '')}\u0000${String(item.message_id || '')}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return {
          ...current,
          items: [...current.items, ...additions],
          total: page.total,
          hasMore: page.hasMore
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

  const openMemoryConversation = useCallback(async (id: string) => {
    const request = memoryConversationGate.current.begin()
    const conversation = await window.electronAPI.aiAssistant.getAssistantConversation(id, { offset: 0, limit: 40 })
    if (!conversation || !memoryConversationGate.current.isCurrent(request)) return
    setMemoryConversationId(id)
    setMemoryConversation(conversation)
    const messages = conversation.messages || []
    const assistantIndex = messages.map((item: any) => item.role).lastIndexOf('assistant')
    if (assistantIndex >= 0) {
      const assistant = messages[assistantIndex]
      const question = [...messages.slice(0, assistantIndex)].reverse().find((item: any) => item.role === 'user')
      setMemoryAnswer({
        conversationId: id,
        question: question?.content || conversation.title,
        answer: assistant.content,
        citations: assistant.citations || [],
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
        limit: 30
      })
      if (!assistantArchiveGate.current.isCurrent(request)) return
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

  const loadOlderAssistantMessages = async () => {
    if (!memoryConversationId || !memoryConversation?.hasOlder || assistantMessagesLoadingMore) return
    const request = memoryConversationGate.current.begin()
    setAssistantMessagesLoadingMore(true)
    try {
      const older = await window.electronAPI.aiAssistant.getAssistantConversation(memoryConversationId, {
        offset: memoryConversation.messages?.length || 0,
        limit: 40
      })
      if (!older || !memoryConversationGate.current.isCurrent(request)) return
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

  const deleteMemoryConversation = async () => {
    if (!memoryConversationId || !window.confirm('确定删除这段本地问答历史吗？该操作不会删除引用的原始记忆。')) return
    await window.electronAPI.aiAssistant.deleteAssistantConversation(memoryConversationId)
    startNewMemoryConversation()
    await load()
  }

  const createTaskFromMemory = async () => {
    if (!memoryAnswer?.answer || creatingMemoryTask) return
    setCreatingMemoryTask(true)
    try {
      const task = await window.electronAPI.aiAssistant.createTaskFromMemory({
        title: memoryAnswer.question || String(memoryAnswer.answer).split(/[。！？\n]/)[0],
        detail: memoryAnswer.answer,
        citations: memoryAnswer.citations,
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
    await window.electronAPI.aiAssistant.reviewMemoryDocument(citation.type, citation.sourceId, decision)
    setMemoryAnswer((current: any) => ({
      ...current,
      citations: (current?.citations || []).map((item: any) =>
        item.documentId === citation.documentId ? { ...item, status: decision } : item)
    }))
    setMessage(decision === 'confirmed' ? '已人工确认这条记忆' : '已标记为不准确')
    await load()
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
      validTo: claim.valid_to || ''
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
    setSources(await window.electronAPI.aiAssistant.getConversationSources())
    setShowSources(true)
  }

  const forgetSelectedEntity = async () => {
    if (!selectedEntity || forgettingEntityId) return
    const preview = await window.electronAPI.aiAssistant.previewForgetEntity(selectedEntity.id)
    if (!preview) return
    const confirmed = window.confirm(
      `彻底遗忘“${preview.canonicalName}”？\n\n` +
      `将永久删除 ${preview.counts.claims} 条事实、${preview.counts.relations} 条关系、` +
      `${preview.counts.events} 个事件、${preview.counts.tasks} 个关联任务，以及相关搜索向量、审计和问答记录。\n\n` +
      '此操作不可撤销。建议先在上方创建个人记忆备份。'
    )
    if (!confirmed) return
    const exactConfirmed = window.prompt(`请输入实体名称“${preview.canonicalName}”以确认彻底遗忘：`) === preview.canonicalName
    if (!exactConfirmed) {
      setMessage('名称不匹配，已取消彻底遗忘')
      return
    }
    setForgettingEntityId(selectedEntity.id)
    try {
      const result = await window.electronAPI.aiAssistant.forgetEntity(selectedEntity.id)
      setSelectedEntityId('')
      setMessage(`已彻底遗忘 ${result.canonicalName}：删除 ${result.removed.searchDocuments} 个记忆索引`)
      await load()
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
    } catch (error: any) {
      setMessage(error?.message || String(error))
    } finally {
      setForgettingEntityId('')
    }
  }

  const toggleSource = async (source: any) => {
    await window.electronAPI.aiAssistant.setConversationSource({ ...source, enabled: !source.enabled })
    setSources(current => current.map(item => item.sessionId === source.sessionId ? { ...item, enabled: !item.enabled } : item))
  }

  const setSourceType = async (type: 'group' | 'private', enabled: boolean) => {
    await window.electronAPI.aiAssistant.setConversationSourcesBulk({ type, enabled, sources })
    setSources(current => current.map(item => item.type === type ? { ...item, enabled } : item))
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
            {status?.cursor?.payloadPolicy?.durableKeys === 'main_process_only' && <small>
              增量断点仅保留在加密主进程：
              热缓存键 {Number(status.cursor.privateStateCounts?.recentMessageKeys || 0).toLocaleString()} 条
              {' · '}会话水位 {Number(status.cursor.privateStateCounts?.sessionCursors || 0).toLocaleString()} 个
              {' · '}分页续传 {Number(status.cursor.privateStateCounts?.continuationOffsets || 0).toLocaleString()} 个；
              界面只接收计数和运行状态。
            </small>}
            {Number(ingestionStatus.commitHealth?.prepared || 0) > 0 && <small>
              检测到 {Number(ingestionStatus.commitHealth.prepared)} 个已保存但尚未完成应用的批次，
              其中微信 {Number(ingestionStatus.commitHealth.preparedWechat || 0)} 个、
              文档 {Number(ingestionStatus.commitHealth.preparedDocuments || 0)} 个；
              下次启动会从加密恢复日志自动续写，不会重新请求模型。
            </small>}
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
        {memoryDiagnostics && (
          <section className={`assistant-memory-health ${memoryDiagnostics.healthy ? 'healthy' : 'unhealthy'}`}>
            <div>
              <ShieldCheck size={16} />
              <span><strong>个人记忆库{memoryDiagnostics.healthy ? '健康' : '需要检查'}</strong>
                <small>{memoryDiagnostics.integrity === 'ok' ? 'SQLite 一致性检查通过' : memoryDiagnostics.integrity}
                  {' · '}{(Number(memoryDiagnostics.databaseBytes || 0) / 1024 / 1024).toFixed(1)} MB
                  {' · '}{memoryDiagnostics.backups?.length || 0} 个本地快照
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
                    onClick={() => void restoreMemory(backup)}>
                    {new Date(backup.createdAt).toLocaleString('zh-CN')}{backup.hasState ? '' : '（仅数据库）'}
                  </button>)}
                </div>
              </details>}
            </div>
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
              <span className="assistant-count">{openTasks.length} 项未完成</span>
            </div>
            <div className="assistant-task-filters">
              <select value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value as any)}>
                <option value="all">全部进行中状态</option><option value="todo">待处理</option><option value="doing">进行中</option><option value="waiting">等待中</option>
              </select>
              <select value={taskPriorityFilter} onChange={event => setTaskPriorityFilter(event.target.value as any)}>
                <option value="all">全部优先级</option><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option>
              </select>
              <select value={taskKindFilter} onChange={event => setTaskKindFilter(event.target.value as any)}>
                <option value="all">全部类型</option><option value="action">自己执行</option><option value="delegated">已委派</option><option value="waiting">等待他人</option>
              </select>
              <div className="assistant-task-view-toggle">
                <button className={taskView === 'list' ? 'active' : ''} onClick={() => setTaskView('list')}>列表</button>
                <button className={taskView === 'calendar' ? 'active' : ''} onClick={() => setTaskView('calendar')}><CalendarDays size={11} /> 月历</button>
              </div>
              <button disabled={!displayedTasks.some(task => !['done', 'cancelled'].includes(task.status))} onClick={() => void completeVisibleTasks()}>完成当前筛选</button>
            </div>
            {dashboard?.taskPayloadPolicy?.dossier === 'on_demand' && <small className="assistant-evidence">
              首页只保留当前行动工作集；已完成和已取消任务进入下方 SQLCipher 档案。原文证据和修改历史仅在展开单条任务时读取。
            </small>}
            {(!!taskReminders.length || reminderPreferences?.mutedKinds?.length) && <div className="assistant-task-reminders">
              {taskReminders.slice(0, 8).map(reminder => <article key={reminder.id} className={reminder.severity}>
                <button className="assistant-reminder-main"
                  onClick={() => document.getElementById(`assistant-task-${reminder.taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
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
              {displayedTasks.length === 0 && <div className="assistant-empty">{tasks.length ? '当前筛选没有待办' : '暂时没有识别到明确待办'}</div>}
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
                      <label className="assistant-task-dependencies"><span>依赖其他待办</span><select multiple value={editingTask.dependsOnIds || []} onChange={event => setEditingTask({
                        ...editingTask,
                        dependsOnIds: [...event.currentTarget.selectedOptions].map(option => option.value)
                      })}>
                        {tasks.filter(item => item.id !== task.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select></label>
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
            <select value={taskArchiveProject} onChange={event => setTaskArchiveProject(event.target.value)}>
              <option value="">所有项目</option>
              {taskArchive.projects.map(project => <option key={`task-archive-project-${project}`} value={project}>{project}</option>)}
            </select>
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
            历史任务从本机 SQLCipher 目录按需分页读取，不参与 15 秒首页轮询；恢复后会重新进入当前行动工作集。
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
                  <EvidenceRows evidence={taskWorkspace.task.evidence} total={taskWorkspace.task.evidenceTotal} />
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
            <span className="assistant-count">{projectInsights.length} 个项目</span>
          </div>
          {dashboard?.projectPayloadPolicy?.dossier === 'on_demand' && <small className="assistant-evidence">
            首页只加载项目进度目录；任务、事件、候选与原文证据会在点击项目后按需读取。
          </small>}
          {projectInsights.length ? <div className="assistant-project-grid">
            {projectInsights.map(project => <button key={project.id} onClick={() => setSelectedProjectId(project.id)}>
              <div><strong>{project.name}</strong><span>{project.phase === 'completed' ? '已完成' : project.phase === 'active' ? '推进中' : project.phase === 'planned' ? '已规划' : '发现阶段'}</span></div>
              <p>{project.summary || (project.inferred ? '从待办项目字段识别，等待更多图谱证据。' : '等待更多项目证据补充。')}</p>
              <div className="assistant-project-progress"><i style={{ width: `${project.progress}%` }} /><span>{project.progress}%</span></div>
              <small>{project.activeTaskCount} 项进行中 · {project.memberCount} 位已确认参与者 · {project.riskCount} 个风险
                {project.pendingReviewTotal ? ` · ${project.pendingReviewTotal} 条候选待确认` : ''}
              </small>
            </button>)}
          </div> : <div className="assistant-empty">当聊天中识别到项目实体或待办归属项目后，这里会自动形成项目进度、风险、里程碑和决策视图。</div>}
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
            <select value={memoryEntityFilter} onChange={event => setMemoryEntityFilter(event.target.value)}>
              <option value="">所有人物与实体</option>
              {trustedGraphEntities.map((entity: any) => <option key={entity.id} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
            <select value={memorySessionFilter} onChange={event => setMemorySessionFilter(event.target.value)}>
              <option value="">所有会话</option>
              {sources.filter(source => source.enabled).map(source => <option key={source.sessionId} value={source.sessionId}>{source.displayName}</option>)}
            </select>
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
              <button onClick={() => { setMemoryEntityFilter(''); setMemorySessionFilter(''); setMemorySourceFilter(''); setMemoryTypeFilter(''); setMemoryFrom(''); setMemoryTo('') }}>清除范围</button>}
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
        </section>

        <section className="assistant-panel assistant-memory-chat">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">EVIDENCE Q&A</span><h3><Bot size={16} /> 向个人记忆提问</h3></div>
            <button onClick={startNewMemoryConversation}>新对话</button>
          </div>
          <div className="assistant-conversation-layout">
            <aside className="assistant-conversation-list">
              <strong>本机历史 · {assistantArchive.total}</strong>
              <input
                value={assistantArchiveQuery}
                onChange={event => setAssistantArchiveQuery(event.target.value)}
                placeholder="搜索问题或回答"
              />
              <div className="assistant-conversation-date-filter">
                <label>从<input type="date" value={assistantArchiveFrom}
                  onChange={event => setAssistantArchiveFrom(event.target.value)} /></label>
                <label>到<input type="date" value={assistantArchiveTo}
                  onChange={event => setAssistantArchiveTo(event.target.value)} /></label>
              </div>
              {dashboard?.assistantArchive?.directory === 'paginated_on_demand' && <small>
                会话和消息按需从 SQLCipher 读取，不进入首页轮询载荷。
              </small>}
              {assistantConversations.map(conversation => <button
                className={memoryConversationId === conversation.id ? 'active' : ''}
                key={conversation.id}
                onClick={() => void openMemoryConversation(conversation.id)}>
                <b>{conversation.title}</b>
                <span>{Number(conversation.message_count || 0)} 条消息 · {new Date(conversation.updated_at).toLocaleString('zh-CN')}</span>
                <small>{conversation.preview}</small>
              </button>)}
              {assistantArchive.loading && <small>正在读取本机问答档案…</small>}
              {!assistantArchive.loading && !assistantConversations.length && <small>
                {assistantArchiveQuery || assistantArchiveFrom || assistantArchiveTo
                  ? '没有符合筛选条件的问答记录。'
                  : '还没有本地问答记录。'}
              </small>}
              {assistantArchive.hasMore && <button onClick={() => void loadMoreAssistantConversations()}
                disabled={assistantArchiveLoadingMore}>
                {assistantArchiveLoadingMore ? '正在加载…' : '加载更早会话'}
              </button>}
            </aside>
            <div className="assistant-conversation-thread">
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
                    question: question?.content || memoryConversation.title,
                    answer: item.content,
                    citations: item.citations,
                    uncertainty: ''
                  })
                }}>查看 {item.citations.length} 条引用</button>}
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
              <button onClick={() => void createTaskFromMemory()} disabled={creatingMemoryTask || Boolean(memoryAnswer.createdTaskId)}>
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
                {['relation', 'claim', 'event'].includes(citation.type) && <div className="assistant-citation-actions">
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
              <select value={claimEntityFilter} onChange={event => setClaimEntityFilter(event.target.value)}>
                <option value="">所有人物与实体</option>
                {trustedGraphEntities.map((entity: any) =>
                  <option key={`claim-entity-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
              </select>
              <select value={claimSourceFilter} onChange={event => setClaimSourceFilter(event.target.value)}>
                <option value="">所有来源</option>
                <option value="wechat">微信</option>
                <option value="documents">本机文档</option>
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
                  setClaimEntityFilter(''); setClaimSourceFilter(''); setClaimStatusFilter('')
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
                <small>原始载体：{claim.source_id === 'documents' ? '本机文档' : '微信'}
                  {!!claim.correction_count && ` · 人工纠正 ${claim.correction_count} 次${claim.corrected_at ? `（最近 ${new Date(claim.corrected_at).toLocaleString('zh-CN')}）` : ''}`}
                </small>
                {!claimEntitiesTrusted(claim) && <small>涉及的实体尚未确认；请先在图谱候选区确认实体，之后才能确认或纠正此事实。</small>}
                {claim.polarity === 'negative' && <small>该条是对“{claim.predicate}”的明确否定陈述，仍需结合反证人工确认。</small>}
                {(claim.valid_from || claim.valid_to) && <small>有效期：{claim.valid_from || '未知'} — {claim.valid_to || '至今'}</small>}
                <div className="assistant-evidence-stack">
                  <EvidenceRows evidence={claim.evidence} total={claim.evidence_count} roleLabels />
                </div>
                <div className="assistant-memory-actions">
                  {editingClaim?.id === claim.id
                    ? <><button onClick={() => setEditingClaim(null)}>取消</button><button className="primary" onClick={() => void saveClaimCorrection()}>保存纠正</button></>
                    : <button disabled={!claimEntitiesTrusted(claim)} title={!claimEntitiesTrusted(claim) ? '请先确认事实涉及的实体' : ''} onClick={() => setEditingClaim({ id: claim.id, value: claim.object_entity_name || claim.object_value || '', validFrom: claim.valid_from || '', validTo: claim.valid_to || '' })}>纠正</button>}
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
              </select>
              <select value={eventStatusFilter} onChange={event => setEventStatusFilter(event.target.value)}>
                <option value="">所有状态</option>
                <option value="candidate">待确认</option>
                <option value="confirmed">已确认</option>
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
                <small>来源：{event.source_id === 'calendar' ? 'macOS 日历' : event.source_id === 'documents' ? '本机文档' : '微信'}</small>
                {!!event.correction_count && <small>人工纠正 {event.correction_count} 次{event.corrected_at ? ` · 最近 ${new Date(event.corrected_at).toLocaleString('zh-CN')}` : ''}；后续自动抽取不会覆盖。</small>}
                {!!event.participants?.length && <small>参与者：{event.participants.map((item: any) => `${item.canonical_name}（${item.role}）`).join('、')}</small>}
                {!eventEntitiesTrusted(event) && <small>存在尚未确认的参与实体；请先在图谱候选区确认实体，之后才能确认或纠正此事件。</small>}
                <div className="assistant-evidence-stack">
                  <EvidenceRows evidence={event.evidence} total={event.evidence_count} />
                </div>
                <div className="assistant-memory-actions">
                  {editingEvent?.id === event.id
                    ? <><button onClick={() => setEditingEvent(null)}>取消</button><button className="primary" onClick={() => void saveEventCorrection()}>保存并确认</button></>
                    : <button disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => beginEventCorrection(event)}>纠正</button>}
                  <button onClick={() => void updateMemoryStatus('event', event.id, 'rejected')}>不准确</button>
                  <button onClick={() => void ignoreMemoryItem('event', event)}>不重要</button>
                  {event.status === 'candidate' && <button className="primary" disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => void updateMemoryStatus('event', event.id, 'confirmed')}>确认事件</button>}
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
              <span className="assistant-count">{visibleResources.length} 项</span>
            </div>
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
              {visibleResources.map((resource: any) => <article className="assistant-memory-item" key={resource.id}>
                <div className="assistant-memory-item-head">
                  <strong>{resource.title}</strong>
                  <span>{resource.resource_type === 'link' ? '链接' : resource.resource_type === 'file' ? '文件' : resource.resource_type === 'chat-history' ? '转发记录' : resource.resource_type === 'mini-program' ? '小程序' : resource.resource_type === 'image' ? '图片 OCR' : resource.resource_type === 'voice' ? '语音转写' : resource.resource_type}</span>
                </div>
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
                  <button onClick={() => void deleteMemoryResource(resource)}>从记忆删除</button>
                </div>
              </article>)}
              {!visibleResources.length && <div className="assistant-empty">链接、文件、转发记录、小程序、图片 OCR 和语音转写会在增量整理时沉淀到这里。</div>}
            </div>
            {!!resourceTrash.length && <details className="assistant-query-plan">
              <summary>资源回收站（{resourceTrash.length}）</summary>
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
              </div>
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
            {selectedEntityId && <button onClick={() => setSelectedEntityId('')}>退出人物聚焦</button>}
          </div>
          <div className="assistant-graph-viewport-note">
            <span>{graphViewport.mode === 'focus' ? `正聚焦 ${selectedEntity?.canonicalName || '选中实体'}`
              : graphViewport.mode === 'search' ? `搜索命中并展开 ${graphFocusDepth} 跳关系`
                : '默认优先展示连接度最高的实体'}</span>
            <small>当前画布 {graphEntities.length} 个节点 · {graphRelations.length} 条边
              {graphViewport.truncated ? ` · 为保持流畅另有 ${graphViewport.truncated} 个相关节点未展开` : ''}
            </small>
            {dashboard?.graphPayloadPolicy?.entityProfiles === 'on_demand' && <small>
              首页只加载轻量身份目录；实体摘要、原文证据、事实、事件和关系历史会在点击人物后按需读取。
            </small>}
          </div>
          {identityDisambiguation && <div className="assistant-identity-status">
            <span><strong>{identityDisambiguation.mode === 'full' ? '全图身份巡检' : '增量身份消歧'}</strong>
              <small>{identityDisambiguation.reason}</small></span>
            <span><b>{identityDisambiguation.lastCandidateCount || 0}</b><small>上次新增候选</small></span>
            <span><b>{identityDisambiguation.lastRunAt ? new Date(identityDisambiguation.lastRunAt).toLocaleString('zh-CN') : '尚未运行'}</b><small>最近消歧</small></span>
          </div>}
          <div className="assistant-path-finder">
            <select value={pathFromId} onChange={event => { setPathFromId(event.target.value); setGraphPath(null); setGraphCommonNeighbors(null) }}>
              <option value="">选择起点</option>
              {trustedGraphEntities.map((entity: any) => <option key={`from-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
            <span>→</span>
            <select value={pathToId} onChange={event => { setPathToId(event.target.value); setGraphPath(null); setGraphCommonNeighbors(null) }}>
              <option value="">选择终点</option>
              {trustedGraphEntities.map((entity: any) => <option key={`to-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
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
                  <EvidenceRows evidence={step.evidence} total={step.evidenceTotal} />
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
                  <details><summary>原文证据 {edge.evidenceTotal || 0} 条</summary><EvidenceRows evidence={edge.evidence} total={edge.evidenceTotal} /></details>
                </div>)}
                {item.rightEdges.map((edge: any) => <div className="assistant-common-edge" key={`right-${edge.relationId}`}>
                  {graphCommonNeighbors.to?.canonicalName} {edge.forward ? edge.predicate : `被${edge.predicate}`} {item.entity.canonicalName}
                  <small>{edge.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(edge.confidence || 0) * 100)}%</small>
                  <details><summary>原文证据 {edge.evidenceTotal || 0} 条</summary><EvidenceRows evidence={edge.evidence} total={edge.evidenceTotal} /></details>
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
                  return <g key={relation.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={relation.status === 'candidate' ? 'candidate' : ''} /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{relation.predicate}</text></g>
                })}
                {graphEntities.map((entity: any) => {
                  const point = graphPositions.get(entity.id) as any
                  return <g key={entity.id} className={`graph-node ${entity.trustStatus || 'legacy_unverified'} ${selectedEntityId === entity.id ? 'selected' : ''}`} onClick={() => setSelectedEntityId(entity.id)}>
                    <circle cx={point.x} cy={point.y} r={entity.type === 'person' ? 18 : 14} />
                    <text x={point.x} y={point.y + 32} textAnchor="middle">{entity.canonicalName.slice(0, 12)}</text>
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
                  <small>证据消息：{selectedEntity.evidenceMessageIds?.length || 0} 条</small>
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
                    <strong>关系 · {selectedEntityRelations.length}</strong>
                    {selectedEntityRelations.slice(0, 6).map((relation: any) => {
                      const outgoing = relation.subjectId === selectedEntity.id
                      const neighborId = outgoing ? relation.objectId : relation.subjectId
                      const neighbor = graph.entities.find((item: any) => item.id === neighborId)
                      return <button key={relation.id} onClick={() => setSelectedEntityId(neighborId)}>
                        <b>{outgoing ? relation.predicate : `被${relation.predicate}`}</b>
                        <span>{neighbor?.canonicalName || neighborId}</span>
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
                const subject = relation ? graph.entities.find((item: any) => item.id === relation.subjectId) : null
                const object = relation ? graph.entities.find((item: any) => item.id === relation.objectId) : null
                const relationEdit = relation
                  ? relationEdits[review.id] || {
                      subjectId: relation.subjectId,
                      predicate: relation.predicate,
                      objectId: relation.objectId
                    }
                  : null
                const correctedRelationSubject = relationEdit
                  ? graph.entities.find((item: any) => item.id === relationEdit.subjectId)
                  : null
                const correctedRelationObject = relationEdit
                  ? graph.entities.find((item: any) => item.id === relationEdit.objectId)
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
                    .map((entityId: string) => graph.entities.find((item: any) => item.id === entityId))
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
                  ? graph.entities.filter((entity: any) =>
                    entity.id !== review.entityId &&
                    entity.trustStatus !== 'rejected' &&
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
                    const entity = graph.entities.find((item: any) => item.id === entityId)
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
                    ? `${graph.entities.find((entity: any) => entity.id === relationCorrectionAudit.before_subject_id)?.canonicalName || relationCorrectionAudit.before_subject_id} — ${relationCorrectionAudit.before_predicate} → ${graph.entities.find((entity: any) => entity.id === relationCorrectionAudit.before_object_id)?.canonicalName || relationCorrectionAudit.before_object_id}`
                    : relation.directionExplanation || (
                    relation.predicate === '服务对象'
                      ? `${object?.canonicalName || '宾语'}向${subject?.canonicalName || '主语'}提供服务；${subject?.canonicalName || '主语'}是${object?.canonicalName || '宾语'}的服务对象。`
                      : `从“${subject?.canonicalName || '主语'}”指向“${object?.canonicalName || '宾语'}”：${subject?.canonicalName || '主语'} ${relation.predicate} ${object?.canonicalName || '宾语'}。`
                  )}</div>
                  {relationEdit && <div className="assistant-relation-correction">
                    <label><span>主语</span><select disabled={!isPending} value={relationEdit.subjectId} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, subjectId: event.target.value } }))}>
                      {trustedGraphEntities.map((entity: any) => <option key={`relation-subject-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
                    </select></label>
                    <label><span>有向谓词</span><input disabled={!isPending} value={relationEdit.predicate} maxLength={100} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, predicate: event.target.value } }))} /></label>
                    <label><span>宾语</span><select disabled={!isPending} value={relationEdit.objectId} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, objectId: event.target.value } }))}>
                      {trustedGraphEntities.map((entity: any) => <option key={`relation-object-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
                    </select></label>
                    <button type="button" disabled={!isPending} onClick={() => setRelationEdits(current => ({
                      ...current,
                      [review.id]: { ...relationEdit, subjectId: relationEdit.objectId, objectId: relationEdit.subjectId }
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
                    <b>发现 {sameNameEntities.length} 个同名实体：</b>
                    <span>{sameNameEntities.map((entity: any) => entity.canonicalName).join('、')}</span>
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
              {isPending && <div className="assistant-review-actions"><button onClick={() => void decideReview(review.id, 'rejected')}>拒绝</button><button className="primary" disabled={(review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId || !selectedMergeTargetId)) || Boolean(entityNameInvalidReason) || Boolean(relationInvalidReason) || Boolean(profileInvalidReason)} title={review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId) ? '候选信息不完整，暂不能合并' : review.kind === 'possible_duplicate' && !selectedMergeTargetId ? '请先选择合并后保留的身份' : entityNameInvalidReason || relationInvalidReason || profileInvalidReason} onClick={() => void decideReview(review.id, 'confirmed', review.kind === 'possible_duplicate' ? { mergeTargetEntityId: selectedMergeTargetId } : review.kind === 'entity_creation' ? { correctedCanonicalName: entityNameEdits[review.id] ?? review.entityCanonicalName ?? '' } : review.kind === 'relation' && relationEdit ? { relationCorrection: relationEdit } : review.kind === 'entity_summary' ? { correctedSummaryText: profileEditValue } : review.kind === 'entity_alias' ? { correctedAliasText: profileEditValue } : undefined)}>{review.kind === 'relation' ? '确认修正后方向' : review.kind === 'possible_duplicate' ? '按此方向合并' : review.kind === 'entity_creation' ? '确认名称并启用' : review.kind === 'entity_summary' || review.kind === 'entity_alias' ? '确认人工最终值' : '确认'}</button></div>}</>
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
                  : `已加载 ${memoryEvidenceArchive.items.length} / ${memoryEvidenceArchive.total} 条`}
            </div>
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
                <div className="assistant-empty">该记忆当前没有可展示的原文证据。</div>}
            </div>
            <div className="assistant-modal-actions">
              <button onClick={closeMemoryEvidenceArchive}>关闭</button>
              {memoryEvidenceArchive.status === 'error' && <button className="primary" onClick={() =>
                void openMemoryEvidenceArchive(
                  memoryEvidenceArchive.documentType,
                  memoryEvidenceArchive.sourceId,
                  memoryEvidenceArchive.title
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
              <span><small>原文证据</small><b>{selectedEntity.evidenceMessageIds?.length || 0} 条</b></span>
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
                <h3>结构化事实 <small>{Number(graphWorkspace.focus?.claimTotal ?? selectedEntityClaims.length)}</small></h3>
                {selectedEntityClaims.map((claim: any) => <article key={claim.id}>
                  <div><b>{claim.polarity === 'negative' ? '并非 ' : ''}{claim.predicate}</b><span>{claim.object_entity_name || claim.object_value || '待确认'}</span></div>
                  <small>{claim.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(claim.confidence || 0) * 100)}% · {claim.source_nature === 'self_statement' ? '本人陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : '模型推断'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={claim.evidence} total={claim.evidence_count} roleLabels /></div>
                </article>)}
                {!selectedEntityClaims.length && <em>尚无结构化事实</em>}
                {Number(graphWorkspace.focus?.claimTotal || 0) > selectedEntityClaims.length && <em>当前档案先显示最近 {selectedEntityClaims.length} 条；可从统一记忆继续检索全部事实。</em>}
              </section>
              <section>
                <h3>关系与证据 <small>{Number(graphWorkspace.focus?.relationTotal ?? selectedEntityRelations.length)}</small></h3>
                {selectedEntityRelations.map((relation: any) => {
                  const outgoing = relation.subjectId === selectedEntity.id
                  const neighborId = outgoing ? relation.objectId : relation.subjectId
                  const neighbor = graph.entities.find((item: any) => item.id === neighborId)
                  return <article key={relation.id}>
                    <button className="assistant-dossier-link" onClick={() => setSelectedEntityId(neighborId)}>
                      <b>{outgoing ? relation.predicate : `被${relation.predicate}`}</b><span>{neighbor?.canonicalName || neighborId}</span>
                    </button>
                    <small>{relation.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(relation.confidence || 0) * 100)}%</small>
                    <div className="assistant-evidence-stack"><EvidenceRows evidence={relation.evidence} total={relation.evidenceTotal} /></div>
                    <button className="assistant-dossier-task-action danger" onClick={() => void permanentlyDeleteMemoryItem('relation', relation)}>永久删除关系</button>
                  </article>
                })}
                {!selectedEntityRelations.length && <em>尚无关系</em>}
                {Number(graphWorkspace.focus?.relationTotal || 0) > selectedEntityRelations.length && <em>当前档案先显示强度最高的 {selectedEntityRelations.length} 条关系。</em>}
              </section>
              <section>
                <h3>事件时间线 <small>{Number(graphWorkspace.focus?.eventTotal ?? selectedEntityEvents.length)}</small></h3>
                {selectedEntityEvents.map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.start_at || '时间待确认'}</span></div>
                  {event.description && <p>{event.description}</p>}
                  <small>{event.event_type} · {event.status === 'confirmed' ? '已确认' : '待确认'} · {event.location || '地点未记录'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={event.evidence} total={event.evidence_count} /></div>
                </article>)}
                {!selectedEntityEvents.length && <em>尚无相关事件</em>}
                {Number(graphWorkspace.focus?.eventTotal || 0) > selectedEntityEvents.length && <em>当前档案先显示最近 {selectedEntityEvents.length} 条；可从事件时间线继续查看全部记录。</em>}
              </section>
              <section>
                <h3>关联事项 <small>{selectedEntityTasks.length}</small></h3>
                {selectedEntityTasks.map(task => <article key={task.id}>
                  <div>
                    <b>{task.title}</b><span>{task.status}</span>
                  </div>
                  <small>{task.taskKind || 'action'} · {task.owner || '负责人待确认'} · {task.due || '无截止时间'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={task.evidence} total={(task as any).evidenceTotal} /></div>
                  {!['cancelled'].includes(task.status) && <button className="assistant-dossier-task-action" onClick={() => void toggleTask(task)}>
                    {task.status === 'done' ? '恢复为待处理' : '标记完成'}
                  </button>}
                </article>)}
                {!selectedEntityTasks.length && <em>尚无关联事项</em>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>关系变化历史 <small>{selectedEntityRelationHistory.length}</small></h3>
                {selectedEntityRelationHistory.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.subject_name || item.subject_id} — {item.predicate} → {item.object_name || item.object_id}</b>
                    <span>{item.change_type === 'created' ? '首次发现' : item.change_type === 'status_changed' ? '可信状态变化' : '证据更新'}</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · {item.status} · {Math.round(Number(item.confidence || 0) * 100)}%</small>
                </article>)}
                {!selectedEntityRelationHistory.length && <em>尚无关系变化历史</em>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>身份名称修正 <small>{selectedEntityCorrections.length}</small></h3>
                {selectedEntityCorrections.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.before_name} → {item.after_name}</b><span>人工确认实体时修正</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原错误名称未写入可信别名</small>
                </article>)}
                {!selectedEntityCorrections.length && <em>尚无名称修正记录</em>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>关系人工修正 <small>{selectedEntityRelationCorrections.length}</small></h3>
                {selectedEntityRelationCorrections.map((item: any) => {
                  const entityName = (id: string) => graph.entities.find((entity: any) => entity.id === id)?.canonicalName || id
                  return <article key={item.id} className="assistant-dossier-history-row">
                    <div><b>{entityName(item.before_subject_id)} — {item.before_predicate} → {entityName(item.before_object_id)}</b><span>修正为</span></div>
                    <div><b>{entityName(item.after_subject_id)} — {item.after_predicate} → {entityName(item.after_object_id)}</b></div>
                    <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原文证据已迁移至修正后关系</small>
                  </article>
                })}
                {!selectedEntityRelationCorrections.length && <em>尚无关系人工修正记录</em>}
              </section>
              <section className="assistant-dossier-wide">
                <h3>档案字段人工修正 <small>{selectedEntityProfileCorrections.length}</small></h3>
                {selectedEntityProfileCorrections.map((item: any) => <article key={item.id} className="assistant-dossier-history-row">
                  <div><b>{item.field === 'summary' ? '实体摘要' : '实体别名'}</b><span>模型建议：“{item.suggested_value}”</span></div>
                  <div><b>人工最终值</b><span>“{item.final_value}”</span></div>
                  <small>{new Date(item.created_at).toLocaleString('zh-CN')} · 原文证据仍绑定原候选</small>
                </article>)}
                {!selectedEntityProfileCorrections.length && <em>尚无摘要或别名修正记录</em>}
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
              <span><b>{selectedProject.risks.length}</b><small>可解释风险</small></span>
              <span><b>{selectedProject.evidenceTotal ?? selectedProject.evidence.length}</b><small>去重证据</small></span>
              <span><b>{selectedProject.pendingReview?.total || 0}</b><small>候选待确认</small></span>
            </div>
            <div className="assistant-dossier-grid">
              <section>
                <h3>参与者 <small>{selectedProject.members.length}</small></h3>
                {selectedProject.members.map((member: any) => <button className="assistant-project-member" key={member.id} onClick={() => {
                  setSelectedEntityId(member.id); setSelectedProjectId(''); setShowEntityDossier(true)
                }}>{member.name}</button>)}
                {!selectedProject.members.length && <em>尚未从项目关系中确认参与者</em>}
              </section>
              <section>
                <h3>风险与阻塞 <small>{selectedProject.risks.length}</small></h3>
                {selectedProject.risks.map((risk: any, index: number) => <article key={`${risk.taskId}-${risk.kind}-${index}`} className={`assistant-project-risk ${risk.severity}`}>
                  <div><b>{risk.title}</b><span>{risk.kind}</span></div><small>{risk.detail}</small>
                </article>)}
                {!selectedProject.risks.length && <em>当前没有确定性规则识别出的风险</em>}
              </section>
              <section>
                <h3>项目任务 <small>{selectedProject.taskTotal ?? selectedProject.tasks.length}</small></h3>
                {selectedProject.tasks.map((task: Task) => <article key={task.id}>
                  <div><b>{task.title}</b><span>{task.status}</span></div>
                  <small>{task.owner || '负责人待确认'} · {task.due || '无截止时间'} · {task.priority}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={(task.evidence || []).slice(-2)} total={(task as any).evidenceTotal} /></div>
                  {task.status !== 'cancelled' && <button className="assistant-dossier-task-action" onClick={() => void toggleTask(task)}>{task.status === 'done' ? '恢复待处理' : '标记完成'}</button>}
                </article>)}
                {!selectedProject.tasks.length && <em>尚无归入项目的任务</em>}
              </section>
              <section>
                <h3>里程碑与决策 <small>{selectedProject.milestones.length + selectedProject.decisions.length}</small></h3>
                {[...selectedProject.decisions, ...selectedProject.milestones].map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.event_type}</span></div>
                  <small>{event.start_at || '时间待确认'} · {event.status === 'confirmed' ? '已确认' : '待确认'}</small>
                  <div className="assistant-evidence-stack"><EvidenceRows evidence={(event.evidence || []).slice(-2)} total={event.evidenceTotal} /></div>
                </article>)}
                {!selectedProject.milestones.length && !selectedProject.decisions.length && <em>尚无里程碑或决策事件</em>}
              </section>
              {!!selectedProject.pendingReview?.total && <section>
                <h3>候选线索 <small>{selectedProject.pendingReview.total}</small></h3>
                <small className="assistant-evidence">以下内容尚未确认，不参与成员、里程碑、决策或项目事实的确定性统计。</small>
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
                setMemoryEntityFilter(selectedProject.entityId); setMemoryQuery(selectedProject.name); setSelectedProjectId('')
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
            {memoryDiagnostics.privacy && <div className={`assistant-privacy-audit ${memoryDiagnostics.privacy.secure && memoryDiagnostics.privacy.stateMode === '600' && memoryDiagnostics.stateStorage?.encrypted ? 'secure' : 'warning'}`}>
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
                <span>数据接口：{memoryDiagnostics.privacy.httpBinding}</span><span>诊断日志：已脱敏</span>
                <span>模型外发脱敏：{memoryDiagnostics.privacy.sensitiveRedactionLevel === 'strict' ? '严格'
                  : memoryDiagnostics.privacy.sensitiveRedactionLevel === 'credentials' ? '仅凭证' : '标准'}</span></div>
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

      {memoryDeletionDialog && (
        <div className="assistant-modal-backdrop" role="presentation">
          <div className="assistant-modal assistant-delete-modal" role="dialog" aria-modal="true" aria-labelledby="memory-delete-title">
            <div className="assistant-modal-title"><div>
              <h2 id="memory-delete-title">永久删除{memoryDeletionDialog.kind === 'claim' ? '事实' : memoryDeletionDialog.kind === 'event' ? '事件' : '关系'}</h2>
              <p>该操作不可撤销，但会保留不含正文的抑制指纹，防止相同原文再次生成。</p>
            </div><button aria-label="关闭永久删除确认" disabled={memoryDeletionDialog.status === 'deleting'}
              onClick={closeMemoryDeletionDialog}><X size={16} /></button></div>
            {memoryDeletionDialog.status === 'loading' && <div className="assistant-delete-status">
              <RefreshCw size={16} /><span><strong>正在核对删除范围…</strong><small>只读取本机加密记忆库，不会上传数据。</small></span>
            </div>}
            {memoryDeletionDialog.status === 'error' && <div className="assistant-error">
              <strong>无法完成永久删除</strong><span>{memoryDeletionDialog.error || '未知错误'}</span>
            </div>}
            {(memoryDeletionDialog.status === 'ready' || memoryDeletionDialog.status === 'deleting') && <>
              <div className="assistant-delete-preview">
                <strong>{memoryDeletionDialog.preview?.label || memoryDeletionDialog.label || '未命名记忆'}</strong>
                <p>
                  将清理 {memoryDeletionDialog.preview?.counts?.evidence || 0} 条原文证据、
                  {memoryDeletionDialog.preview?.counts?.related || 0} 条关联记录、
                  {memoryDeletionDialog.preview?.counts?.searchDocuments || 0} 个全文/向量索引，
                  以及 {memoryDeletionDialog.preview?.counts?.assistantMessages || 0} 段引用过它的本地问答。
                </p>
              </div>
              <label><span>输入“永久删除”确认</span><input autoFocus value={memoryDeletionConfirmation}
                disabled={memoryDeletionDialog.status === 'deleting'}
                onChange={event => setMemoryDeletionConfirmation(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && memoryDeletionConfirmation === '永久删除') {
                    void confirmPermanentMemoryDeletion()
                  }
                }}
                placeholder="永久删除" /></label>
            </>}
            <div className="assistant-modal-actions">
              <button disabled={memoryDeletionDialog.status === 'deleting'} onClick={closeMemoryDeletionDialog}>取消</button>
              {(memoryDeletionDialog.status === 'ready' || memoryDeletionDialog.status === 'deleting') &&
                <button className="danger" disabled={memoryDeletionConfirmation !== '永久删除' || memoryDeletionDialog.status === 'deleting'}
                  onClick={() => void confirmPermanentMemoryDeletion()}>
                  {memoryDeletionDialog.status === 'deleting' ? '正在清理…' : '确认永久删除'}
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
          <div className="assistant-modal">
            <div className="assistant-modal-title"><div>
              <h2>{migrationDialog.mode === 'export' ? '创建便携迁移包' : '解锁便携迁移包'}</h2>
              <p>{migrationDialog.mode === 'export'
                ? '数据库、图谱、任务和增量游标会用迁移口令整体加密。口令不会保存，也无法找回。'
                : '输入原设备导出时设置的口令。导入前会验证密文、文件哈希和数据库一致性，并创建本机安全快照。'}</p>
            </div><button aria-label="关闭迁移向导" onClick={() => setMigrationDialog(null)}><X size={16} /></button></div>
            <label><span>迁移口令</span><input type="password" autoFocus value={migrationPassphrase}
              placeholder={migrationDialog.mode === 'export' ? '至少 12 个字符' : '旧版同机迁移包可留空'}
              onChange={event => setMigrationPassphrase(event.target.value)} /></label>
            {migrationDialog.mode === 'export' && <label><span>再次输入</span><input type="password"
              value={migrationPassphraseConfirmation}
              onChange={event => setMigrationPassphraseConfirmation(event.target.value)} /></label>}
            <small className="assistant-settings-note">
              采用 scrypt 派生密钥和 AES-256-GCM 认证加密；目标电脑导入后会自动换成自己的 macOS 钥匙串密钥。
            </small>
            <div className="assistant-modal-actions">
              <button onClick={() => setMigrationDialog(null)}>取消</button>
              <button className="primary" disabled={migratingMemory}
                onClick={() => void (migrationDialog.mode === 'export' ? exportMemoryBundle() : importMemoryBundle())}>
                {migratingMemory ? '正在验证…' : migrationDialog.mode === 'export' ? '选择位置并导出' : '验证并预览'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSources && (
        <div className="assistant-modal-backdrop">
          <div className="assistant-modal assistant-source-modal">
            <div className="assistant-modal-title"><div><h2>信息来源</h2><p>关闭后消息不会发送给模型，也不会进入待办和知识图谱。</p></div><button onClick={() => setShowSources(false)}><X size={16} /></button></div>
            <div className="assistant-source-actions">
              <button onClick={() => void setSourceType('group', false)}>关闭全部群聊</button>
              <button onClick={() => void setSourceType('group', true)}>开启全部群聊</button>
              <button onClick={() => void setSourceType('private', true)}>开启全部私聊</button>
            </div>
            <input className="assistant-source-search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="搜索群聊或联系人" />
            <div className="assistant-source-list">
              {sources.filter(source => !sourceQuery.trim() || source.displayName.toLowerCase().includes(sourceQuery.trim().toLowerCase())).map(source => (
                <label className="assistant-source-row" key={source.sessionId}>
                  <span><strong>{source.displayName}</strong><small>{source.type === 'group' ? '群聊' : '私聊'} · {source.enabled ? '参与分析' : '已停止分析'}</small></span>
                  <input type="checkbox" checked={source.enabled} onChange={() => void toggleSource(source)} />
                </label>
              ))}
            </div>
            <div className="assistant-source-footer"><span>{sources.filter(source => source.enabled).length} 个来源已开启</span><button className="primary" onClick={() => setShowSources(false)}>完成</button></div>
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
