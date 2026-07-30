import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Bot, CalendarDays, Check, Clock3, Filter, Network, Paperclip, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { buildTaskCalendar, shanghaiToday } from '../utils/taskCalendar'
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
  classification?: 'mine' | 'uncertain'
  assignmentEvidence?: string
  ownershipPolicyReason?: string
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
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [showEntityDossier, setShowEntityDossier] = useState(false)
  const [briefingPeriod, setBriefingPeriod] = useState<'latest' | 'week'>('latest')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [forgettingEntityId, setForgettingEntityId] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showDataSources, setShowDataSources] = useState(false)
  const [sources, setSources] = useState<any[]>([])
  const [dataSources, setDataSources] = useState<any[]>([])
  const [eventTimeline, setEventTimeline] = useState<{ items: any[]; total: number; hasMore: boolean }>({
    items: [], total: 0, hasMore: false
  })
  const [eventSourceFilter, setEventSourceFilter] = useState('')
  const [eventStatusFilter, setEventStatusFilter] = useState('')
  const [eventFrom, setEventFrom] = useState('')
  const [eventTo, setEventTo] = useState('')
  const [eventTimelineLimit, setEventTimelineLimit] = useState(100)
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
  const [editingClaim, setEditingClaim] = useState<any>(null)
  const [editingEvent, setEditingEvent] = useState<any>(null)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | Task['status']>('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<'all' | Task['priority']>('all')
  const [taskKindFilter, setTaskKindFilter] = useState<'all' | NonNullable<Task['taskKind']>>('all')
  const [taskView, setTaskView] = useState<'list' | 'calendar'>('list')
  const [calendarMonth, setCalendarMonth] = useState(() => shanghaiToday().slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => shanghaiToday())
  const [pathFromId, setPathFromId] = useState('')
  const [pathToId, setPathToId] = useState('')
  const [graphPath, setGraphPath] = useState<any>(null)
  const [graphCommonNeighbors, setGraphCommonNeighbors] = useState<any>(null)
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({})
  const [entityNameEdits, setEntityNameEdits] = useState<Record<string, string>>({})
  const [relationEdits, setRelationEdits] = useState<Record<string, { subjectId: string; predicate: string; objectId: string }>>({})
  const [memoryDiagnostics, setMemoryDiagnostics] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [backingUpMemory, setBackingUpMemory] = useState(false)
  const [restoringMemory, setRestoringMemory] = useState(false)
  const [migratingMemory, setMigratingMemory] = useState(false)
  const [migrationDialog, setMigrationDialog] = useState<{ mode: 'export' | 'import'; bundlePath?: string } | null>(null)
  const [migrationPassphrase, setMigrationPassphrase] = useState('')
  const [migrationPassphraseConfirmation, setMigrationPassphraseConfirmation] = useState('')
  const [indexingVectors, setIndexingVectors] = useState(false)
  const [memoryQuestion, setMemoryQuestion] = useState('')
  const [memoryAnswer, setMemoryAnswer] = useState<any>(null)
  const [askingMemory, setAskingMemory] = useState(false)
  const [creatingMemoryTask, setCreatingMemoryTask] = useState(false)
  const [memoryEntityFilter, setMemoryEntityFilter] = useState('')
  const [memorySessionFilter, setMemorySessionFilter] = useState('')
  const [memoryTypeFilter, setMemoryTypeFilter] = useState('')
  const [memoryFrom, setMemoryFrom] = useState('')
  const [memoryTo, setMemoryTo] = useState('')
  const memorySearchOptions = useMemo(() => ({
    entityId: memoryEntityFilter || undefined,
    sessionId: memorySessionFilter || undefined,
    sessionName: sources.find(source => source.sessionId === memorySessionFilter)?.displayName || undefined,
    documentTypes: memoryTypeFilter ? [memoryTypeFilter] : undefined,
    from: memoryFrom || undefined,
    to: memoryTo || undefined
  }), [memoryEntityFilter, memorySessionFilter, memoryTypeFilter, memoryFrom, memoryTo, sources])
  const eventTimelineOptions = useMemo(() => ({
    sourceId: eventSourceFilter || undefined,
    status: eventStatusFilter || undefined,
    from: eventFrom ? new Date(`${eventFrom}T00:00:00+08:00`).toISOString() : undefined,
    to: eventTo ? new Date(`${eventTo}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: eventTimelineLimit,
    offset: 0
  }), [eventSourceFilter, eventStatusFilter, eventFrom, eventTo, eventTimelineLimit])

  const load = useCallback(async () => {
    const [nextStatus, nextDashboard, nextDataSources, nextEventTimeline] = await Promise.all([
      window.electronAPI.aiAssistant.status(),
      window.electronAPI.aiAssistant.dashboard(),
      window.electronAPI.aiAssistant.getDataSources(),
      window.electronAPI.aiAssistant.getEventTimeline(eventTimelineOptions)
    ])
    setStatus(nextStatus)
    setDashboard(nextDashboard)
    setDataSources(nextDataSources)
    setEventTimeline(nextEventTimeline)
  }, [eventTimelineOptions])

  useEffect(() => {
    void load()
    void window.electronAPI.aiAssistant.getMemoryDiagnostics().then(setMemoryDiagnostics).catch(() => {})
    void window.electronAPI.aiAssistant.getConversationSources().then(setSources).catch(() => {})
    void window.electronAPI.aiAssistant.getDataSources().then(setDataSources).catch(() => {})
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const query = memoryQuery.trim()
    if (!query) {
      setMemoryResults([])
      return
    }
    const timer = window.setTimeout(() => {
      void window.electronAPI.aiAssistant.searchMemory(query, memorySearchOptions).then(setMemoryResults)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [memoryQuery, memorySearchOptions])

  useEffect(() => {
    setEventTimelineLimit(100)
  }, [eventSourceFilter, eventStatusFilter, eventFrom, eventTo])

  const briefing = dashboard?.briefing
  const weeklyBriefing = dashboard?.weeklyBriefing
  const projectInsights: any[] = dashboard?.projectInsights || []
  const selectedProject = projectInsights.find(project => project.id === selectedProjectId)
  const tasks: Task[] = dashboard?.tasks || []
  const taskReviewQueue: Task[] = dashboard?.taskReviewQueue || []
  const taskReminders: any[] = dashboard?.taskReminders || []
  const reminderPreferences = dashboard?.reminderPreferences
  const taskHistory: any[] = dashboard?.taskHistory || []
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
  const graphEntities = useMemo(() => {
    const query = graphQuery.trim().toLowerCase()
    const available = graph.entities.filter((entity: any) => entity.trustStatus !== 'rejected')
    const rows = query
      ? available.filter((entity: any) => [
        entity.canonicalName,
        ...(entity.aliases || []),
        ...(entity.accountIds || []),
        ...(entity.externalIdentities || []).flatMap((identity: any) => [identity.accountId, identity.displayName])
      ].some((value: string) => value.toLowerCase().includes(query)))
      : available
    return rows.slice(-60)
  }, [graph.entities, graphQuery])
  const graphEntityIds = useMemo(() => new Set(graphEntities.map((entity: any) => entity.id)), [graphEntities])
  const graphRelations = useMemo(() => graph.relations.filter((relation: any) =>
    relation.status !== 'rejected' &&
    (!graphRelationType || relation.predicate === graphRelationType) &&
    (!graphRelationStatus || relation.status === graphRelationStatus) &&
    graphEntityIds.has(relation.subjectId) && graphEntityIds.has(relation.objectId)),
  [graph.relations, graphEntityIds, graphRelationType, graphRelationStatus])
  const graphPositions = useMemo(() => new Map(graphEntities.map((entity: any, index: number) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, graphEntities.length) - Math.PI / 2
    const ring = 105 + (index % 3) * 35
    return [entity.id, { x: 250 + Math.cos(angle) * ring, y: 170 + Math.sin(angle) * ring }]
  })), [graphEntities])
  const selectedEntity = graph.entities.find((entity: any) => entity.id === selectedEntityId)
  const selectedEntityInsight = dashboard?.entityInsights?.[selectedEntityId]
  const relationPredicates = useMemo<string[]>(() => [...new Set<string>(graph.relations
    .filter((relation: any) => relation.status !== 'rejected')
    .map((relation: any) => String(relation.predicate || '')).filter(Boolean))].sort(), [graph.relations])
  const pendingReviews = graph.reviewQueue.filter((item: any) => item.status === 'pending')
  const identityDisambiguation = dashboard?.identityDisambiguation
  const mergeHistory = dashboard?.mergeHistory || []
  const entityCorrections = dashboard?.entityCorrections || []
  const relationCorrections = dashboard?.relationCorrections || []
  const memoryFeed = dashboard?.memoryFeed || { claims: [], events: [], resources: [] }
  const ingestionStatus = dashboard?.ingestionStatus
  const ingestionCounts = Object.fromEntries((ingestionStatus?.batches || []).map((item: any) => [item.status, Number(item.count || 0)]))
  const visibleClaims = memoryFeed.claims.filter((item: any) => item.status !== 'rejected')
  const feedEvents = memoryFeed.events.filter((item: any) => item.status !== 'rejected')
  const visibleEvents = eventTimeline.items || []
  const visibleResources = memoryFeed.resources || []
  const resourceTrash = dashboard?.resourceTrash || []
  const selectedEntityClaims = selectedEntity
    ? visibleClaims.filter((item: any) => item.subject_id === selectedEntity.id)
    : []
  const selectedEntityEvents = selectedEntity
    ? feedEvents.filter((item: any) => item.participants?.some((participant: any) => participant.entity_id === selectedEntity.id))
    : []
  const selectedEntityRelations = selectedEntity
    ? graph.relations.filter((item: any) =>
      item.status !== 'rejected' && (item.subjectId === selectedEntity.id || item.objectId === selectedEntity.id))
    : []
  const selectedEntityRelationHistory = selectedEntity
    ? (dashboard?.relationHistory || []).filter((item: any) =>
      item.subject_id === selectedEntity.id || item.object_id === selectedEntity.id)
    : []
  const selectedEntityCorrections = selectedEntity
    ? entityCorrections.filter((item: any) => item.entity_id === selectedEntity.id)
    : []
  const selectedEntityRelationCorrections = selectedEntity
    ? relationCorrections.filter((item: any) =>
      item.before_subject_id === selectedEntity.id ||
      item.before_object_id === selectedEntity.id ||
      item.after_subject_id === selectedEntity.id ||
      item.after_object_id === selectedEntity.id)
    : []
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
      await load()
    } catch (error: any) {
      setMessage(error?.message || String(error))
    }
  }

  const decideTaskReview = async (id: string, decision: 'mine' | 'rejected') => {
    await window.electronAPI.aiAssistant.updateTaskReview(id, decision)
    await load()
  }

  const revertMerge = async (id: number) => {
    await window.electronAPI.aiAssistant.revertMerge(id)
    await load()
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
    try {
      const preview = await window.electronAPI.aiAssistant.previewDeleteMemoryItem(kind, id)
      if (!preview) {
        setMessage('该条记忆不存在或已经被删除。')
        await load()
        return
      }
      const kindLabel = kind === 'claim' ? '事实' : kind === 'event' ? '事件' : '关系'
      const confirmed = window.confirm(
        `永久删除这条${kindLabel}“${preview.label}”？\n\n` +
        `将同时清理 ${preview.counts.evidence} 条原文证据、${preview.counts.related} 条关联记录、` +
        `${preview.counts.searchDocuments} 个全文/向量索引，以及 ${preview.counts.assistantMessages} 条引用过它的问答记录。\n\n` +
        '系统只保留不含原文的抑制指纹和删除审计；以后重新处理相同消息也不会让它复活。'
      )
      if (!confirmed) return
      const exactConfirmed = window.prompt('此操作不可撤销。请输入“永久删除”继续：') === '永久删除'
      if (!exactConfirmed) {
        setMessage('确认文字不匹配，已取消删除。')
        return
      }
      const result = await window.electronAPI.aiAssistant.deleteMemoryItem(kind, id)
      setMessage(`已永久删除${kindLabel}；抑制指纹 ${result.fingerprint} 已保存。`)
      if (memoryAnswer?.citations?.some((citation: any) => citation.documentId === `${kind}:${id}`)) setMemoryAnswer(null)
      await load()
      setMemoryDiagnostics(await window.electronAPI.aiAssistant.getMemoryDiagnostics())
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
    try {
      const answer = await window.electronAPI.aiAssistant.askMemory(question, memoryAnswer?.conversationId, memorySearchOptions)
      setMemoryAnswer({ ...answer, question })
    } catch (error: any) {
      setMemoryAnswer({ answer: error?.message || String(error), citations: [], uncertainty: '' })
    } finally {
      setAskingMemory(false)
    }
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
                <option value="all">全部状态</option><option value="todo">待处理</option><option value="doing">进行中</option><option value="waiting">等待中</option><option value="done">已完成</option><option value="cancelled">已取消</option>
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
                    {!!task.evidence?.length && <div className="assistant-evidence-stack">
                      {task.evidence.map(item => <small key={item.messageId}>{item.sender} · {new Date(item.timestamp * 1000).toLocaleString('zh-CN')}：“{item.excerpt}”</small>)}
                    </div>}
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
                      {!!taskHistory.some(item => item.task_id === task.id) && <details>
                        <summary>状态历史</summary>
                        <div className="assistant-task-history">
                          {taskHistory.filter(item => item.task_id === task.id).slice(0, 12).map(item => <small key={item.id}>
                            {new Date(item.created_at).toLocaleString('zh-CN')} · {item.field}：{taskHistoryValue(item.before_value)} → {taskHistoryValue(item.after_value)}
                          </small>)}
                        </div>
                      </details>}
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
            <div><span className="assistant-eyebrow">PROJECT INTELLIGENCE</span><h3>项目驾驶舱</h3></div>
            <span className="assistant-count">{projectInsights.length} 个项目</span>
          </div>
          {projectInsights.length ? <div className="assistant-project-grid">
            {projectInsights.map(project => <button key={project.id} onClick={() => setSelectedProjectId(project.id)}>
              <div><strong>{project.name}</strong><span>{project.phase === 'completed' ? '已完成' : project.phase === 'active' ? '推进中' : project.phase === 'planned' ? '已规划' : '发现阶段'}</span></div>
              <p>{project.summary || (project.inferred ? '从待办项目字段识别，等待更多图谱证据。' : '等待更多项目证据补充。')}</p>
              <div className="assistant-project-progress"><i style={{ width: `${project.progress}%` }} /><span>{project.progress}%</span></div>
              <small>{project.activeTaskCount} 项进行中 · {project.members.length} 位已确认参与者 · {project.risks.length} 个风险
                {project.pendingReview?.total ? ` · ${project.pendingReview.total} 条候选待确认` : ''}
              </small>
            </button>)}
          </div> : <div className="assistant-empty">当聊天中识别到项目实体或待办归属项目后，这里会自动形成项目进度、风险、里程碑和决策视图。</div>}
        </section>

        {taskReviewQueue.length > 0 && (
          <section className="assistant-panel assistant-review-section">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">ASSIGNEE REVIEW</span><h3>待确认归属</h3></div>
              <span className="assistant-count">{taskReviewQueue.length} 项不会计入你的待办</span>
            </div>
            {taskReviewQueue.map(task => (
              <article className="assistant-review-item" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  {task.detail && <p>{task.detail}</p>}
                  <small>{task.assignmentEvidence || '缺少足够的归属证据'}{task.source ? ` · 来自 ${task.source}` : ''}</small>
                </div>
                <div>
                  <button onClick={() => void decideTaskReview(task.id, 'rejected')}>不是我的</button>
                  <button className="primary" onClick={() => void decideTaskReview(task.id, 'mine')}>归为我的待办</button>
                </div>
              </article>
            ))}
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
            <select value={memoryTypeFilter} onChange={event => setMemoryTypeFilter(event.target.value)}>
              <option value="">所有记忆类型</option>
              <option value="entity">实体</option><option value="relation">关系</option><option value="claim">事实</option>
              <option value="event">事件</option><option value="task">待办</option><option value="resource">资源</option>
            </select>
            <label><span>从</span><input type="date" value={memoryFrom} onChange={event => setMemoryFrom(event.target.value)} /></label>
            <label><span>至</span><input type="date" value={memoryTo} onChange={event => setMemoryTo(event.target.value)} /></label>
            {(memoryEntityFilter || memorySessionFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
              <button onClick={() => { setMemoryEntityFilter(''); setMemorySessionFilter(''); setMemoryTypeFilter(''); setMemoryFrom(''); setMemoryTo('') }}>清除范围</button>}
          </div>
          {(memoryEntityFilter || memorySessionFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
            <small className="assistant-scope-note">当前范围在全文/向量召回之前生效，范围外内容不会参与排序或发送给模型。
              {memoryResults[0]?.retrieval_scope_applied && ` · 当前候选 ${Number(memoryResults[0].retrieval_scope_candidates || 0).toLocaleString()} 条`}
            </small>}
          {!!memoryQuery.trim() && <div className="assistant-search-results">
            {memoryResults.map(result => {
              const resultStatus = ['claim', 'relation', 'event'].includes(result.document_type)
                ? result.metadata?.status
                : ''
              const statusLabel = resultStatus === 'confirmed' ? '已确认'
                : resultStatus === 'candidate' ? '待确认'
                  : resultStatus === 'cancelled' ? '已取消'
                    : '原始资料'
              return <article key={result.id}>
              <span>{result.document_type}
                {result.match_source ? ` · ${result.match_source}匹配` : ''}
                {result.match_reason === 'pinyin_entity' ? ' · 拼音命中' : result.match_reason === 'fuzzy_entity' ? ' · 名称近似召回' : result.match_reason === 'entity_alias_or_account' ? ' · 别名/微信 ID 命中' : ''}
                {result.semantic_score ? ` · ${Math.round(result.semantic_score * 100)}%` : ''}
                {result.semantic_search_mode === 'ann' ? ' · ANN 召回' : result.semantic_search_mode === 'exact' ? ' · 精确向量召回' : ''}
              </span>
              <small className={`assistant-memory-trust ${resultStatus || 'source'}`}>{statusLabel}{resultStatus === 'candidate' ? ' · 不能作为已确认事实回答' : resultStatus === 'cancelled' ? ' · 仅作历史记录' : ''}</small>
              <strong>{result.title}</strong><p>{result.search_text}</p>
            </article>})}
            {!memoryResults.length && <div className="assistant-empty">没有找到相关记忆。</div>}
          </div>}
        </section>

        <section className="assistant-panel assistant-memory-chat">
          <div className="assistant-section-heading">
            <div><span className="assistant-eyebrow">EVIDENCE Q&A</span><h3><Bot size={16} /> 向个人记忆提问</h3></div>
          </div>
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
                {(citation.evidence || []).map((evidence: any) => <small key={evidence.message_id || evidence.messageId}>“{evidence.excerpt}”</small>)}
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
              <span className="assistant-count">{visibleClaims.length} 条</span>
            </div>
            <div className="assistant-memory-list">
              {visibleClaims.map((claim: any) => <article className="assistant-memory-item" id={`memory-claim-${claim.id}`} key={claim.id}>
                <div className="assistant-memory-item-head">
                  <strong>{claim.subject_name || '未知主体'} · {claim.predicate}</strong>
                  <span className={claim.status}>{claim.status === 'confirmed' ? '已确认' : '待确认'}</span>
                </div>
                {editingClaim?.id === claim.id ? <div className="assistant-claim-editor">
                  <input value={editingClaim.value} onChange={event => setEditingClaim({ ...editingClaim, value: event.target.value })} placeholder="正确的事实值" />
                  <input value={editingClaim.validFrom} onChange={event => setEditingClaim({ ...editingClaim, validFrom: event.target.value })} placeholder="生效时间（可选）" />
                  <input value={editingClaim.validTo} onChange={event => setEditingClaim({ ...editingClaim, validTo: event.target.value })} placeholder="失效时间（可选）" />
                </div> : <p>{claim.polarity === 'negative' ? '否定：' : ''}{claim.object_entity_name || claim.object_value || '未记录值'}</p>}
                <small>来源：{claim.source_nature === 'self_statement' ? '本人明确陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : claim.source_nature === 'human_confirmation' ? '人工纠正确认' : '模型推断'} · {Math.round(Number(claim.confidence || 0) * 100)}% 可信{claim.conflict_group ? ' · 与其他事实冲突' : ''}</small>
                {!claimEntitiesTrusted(claim) && <small>涉及的实体尚未确认；请先在图谱候选区确认实体，之后才能确认或纠正此事实。</small>}
                {claim.polarity === 'negative' && <small>该条是对“{claim.predicate}”的明确否定陈述，仍需结合反证人工确认。</small>}
                {(claim.valid_from || claim.valid_to) && <small>有效期：{claim.valid_from || '未知'} — {claim.valid_to || '至今'}</small>}
                <div className="assistant-evidence-stack">
                  {(claim.evidence || []).map((evidence: any) =>
                    <small key={evidence.message_id}>{evidence.evidence_role === 'indirect' ? '间接证据' : evidence.evidence_role === 'contradiction' ? '反证' : '直接证据'} · {new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}：“{evidence.excerpt}”</small>)}
                </div>
                <div className="assistant-memory-actions">
                  {editingClaim?.id === claim.id
                    ? <><button onClick={() => setEditingClaim(null)}>取消</button><button className="primary" onClick={() => void saveClaimCorrection()}>保存纠正</button></>
                    : <button disabled={!claimEntitiesTrusted(claim)} title={!claimEntitiesTrusted(claim) ? '请先确认事实涉及的实体' : ''} onClick={() => setEditingClaim({ id: claim.id, value: claim.object_entity_name || claim.object_value || '', validFrom: claim.valid_from || '', validTo: claim.valid_to || '' })}>纠正</button>}
                  <button onClick={() => void updateMemoryStatus('claim', claim.id, 'rejected')}>不准确</button>
                  {claim.status === 'candidate' && <button className="primary" disabled={!claimEntitiesTrusted(claim)} title={!claimEntitiesTrusted(claim) ? '请先确认事实涉及的实体' : ''} onClick={() => void updateMemoryStatus('claim', claim.id, 'confirmed')}>确认事实</button>}
                  <button className="danger" onClick={() => void permanentlyDeleteMemoryItem('claim', claim)}>永久删除</button>
                </div>
              </article>)}
              {!visibleClaims.length && <div className="assistant-empty">后续增量消息会在这里形成带原文证据的个人事实。</div>}
            </div>
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
                  {(event.evidence || []).map((evidence: any) =>
                    <small key={evidence.message_id}>证据 · {new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}：“{evidence.excerpt}”</small>)}
                </div>
                <div className="assistant-memory-actions">
                  {editingEvent?.id === event.id
                    ? <><button onClick={() => setEditingEvent(null)}>取消</button><button className="primary" onClick={() => void saveEventCorrection()}>保存并确认</button></>
                    : <button disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => beginEventCorrection(event)}>纠正</button>}
                  <button onClick={() => void updateMemoryStatus('event', event.id, 'rejected')}>不准确</button>
                  {event.status === 'candidate' && <button className="primary" disabled={!eventEntitiesTrusted(event)} title={!eventEntitiesTrusted(event) ? '请先确认事件参与实体' : ''} onClick={() => void updateMemoryStatus('event', event.id, 'confirmed')}>确认事件</button>}
                  <button className="danger" onClick={() => void permanentlyDeleteMemoryItem('event', event)}>永久删除</button>
                </div>
              </article>)}
              {!visibleEvents.length && <div className="assistant-empty">会议、决定、交付和承诺等事件会显示在这里。</div>}
            </div>
            {eventTimeline.hasMore && <div className="assistant-timeline-more">
              <button onClick={() => setEventTimelineLimit(limit => Math.min(300, limit + 100))}>
                加载更多（已显示 {visibleEvents.length}/{eventTimeline.total}）
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
            <span className="assistant-count">{graph.entities.length} 个实体 · {graph.relations.length} 条关系</span>
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
            {graphPath.found ? graphPath.entities.map((entity: any, index: number) => <span key={entity.id}>
              <button onClick={() => setSelectedEntityId(entity.id)}>{entity.canonicalName}</button>
              {graphPath.steps[index] && <i>{graphPath.steps[index].forward ? graphPath.steps[index].predicate : `被${graphPath.steps[index].predicate}`} →</i>}
            </span>) : <p>在 6 层关系内没有找到路径。候选关系被保留，已拒绝关系不会参与计算。</p>}
          </div>}
          {graphCommonNeighbors && <div className="assistant-common-neighbors">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">COMMON CONNECTIONS</span><h3>共同联系人与实体</h3></div><span className="assistant-count">{graphCommonNeighbors.common.length} 个</span></div>
            {graphCommonNeighbors.common.map((item: any) => <article key={item.entity.id}>
              <button onClick={() => setSelectedEntityId(item.entity.id)}>{item.entity.canonicalName}</button>
              <div>
                {item.leftEdges.map((edge: any) => <span key={`left-${edge.relationId}`}>
                  {graphCommonNeighbors.from?.canonicalName} {edge.forward ? edge.predicate : `被${edge.predicate}`} {item.entity.canonicalName}
                  <small>{edge.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(edge.confidence || 0) * 100)}%</small>
                </span>)}
                {item.rightEdges.map((edge: any) => <span key={`right-${edge.relationId}`}>
                  {graphCommonNeighbors.to?.canonicalName} {edge.forward ? edge.predicate : `被${edge.predicate}`} {item.entity.canonicalName}
                  <small>{edge.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(edge.confidence || 0) * 100)}%</small>
                </span>)}
              </div>
            </article>)}
            {!graphCommonNeighbors.common.length && <div className="assistant-empty">当前图谱中没有共同的一跳联系人或实体。</div>}
          </div>}
          {graphEntities.length ? (
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
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">REVIEW QUEUE</span><h3>身份与关系候选</h3></div><span className="assistant-count">{pendingReviews.length} 项</span></div>
            {pendingReviews.map((review: any) => <article className="assistant-review-item" key={review.id}>
              {(() => {
                const relation = review.kind === 'relation' ? graph.relations.find((item: any) => item.id === review.relationId) : null
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
                return <><div><strong>{review.kind === 'possible_duplicate' ? `可能是同一个人：${review.title}` : review.title}</strong>
                {review.kind === 'possible_duplicate' && <div className="assistant-identity-pair">
                  {[review.leftEntityId, review.rightEntityId].map((entityId: string) => {
                    const entity = graph.entities.find((item: any) => item.id === entityId)
                    const selected = selectedMergeTargetId === entityId
                    return <button type="button" className={selected ? 'selected' : ''} key={entityId}
                      onClick={() => setMergeTargets(current => ({ ...current, [review.id]: entityId }))}>
                      <span>{selected ? '✓ 将保留此身份' : '选择保留此身份'}</span>
                      <b>{entity?.canonicalName || '未知人物'}</b><small>{
                      entity?.externalIdentities?.map((identity: any) => identity.accountId).join('、') ||
                      entity?.aliases?.join('、') || entity?.accountIds?.join('、') || '暂无别名或账号'
                    }</small></button>
                  })}
                </div>}
                {review.kind === 'possible_duplicate' && <div className={`assistant-merge-preview${selectedMergeTarget ? ' ready' : ''}`}>
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
                  <div><b>模型原始方向：</b>{relation.directionExplanation || (
                    relation.predicate === '服务对象'
                      ? `${object?.canonicalName || '宾语'}向${subject?.canonicalName || '主语'}提供服务；${subject?.canonicalName || '主语'}是${object?.canonicalName || '宾语'}的服务对象。`
                      : `从“${subject?.canonicalName || '主语'}”指向“${object?.canonicalName || '宾语'}”：${subject?.canonicalName || '主语'} ${relation.predicate} ${object?.canonicalName || '宾语'}。`
                  )}</div>
                  {relationEdit && <div className="assistant-relation-correction">
                    <label><span>主语</span><select value={relationEdit.subjectId} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, subjectId: event.target.value } }))}>
                      {trustedGraphEntities.map((entity: any) => <option key={`relation-subject-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
                    </select></label>
                    <label><span>有向谓词</span><input value={relationEdit.predicate} maxLength={100} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, predicate: event.target.value } }))} /></label>
                    <label><span>宾语</span><select value={relationEdit.objectId} onChange={event =>
                      setRelationEdits(current => ({ ...current, [review.id]: { ...relationEdit, objectId: event.target.value } }))}>
                      {trustedGraphEntities.map((entity: any) => <option key={`relation-object-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
                    </select></label>
                    <button type="button" onClick={() => setRelationEdits(current => ({
                      ...current,
                      [review.id]: { ...relationEdit, subjectId: relationEdit.objectId, objectId: relationEdit.subjectId }
                    }))}>交换主语与宾语</button>
                  </div>}
                  {relationEdit && <div className={`assistant-relation-preview${relationInvalidReason ? ' invalid' : ''}`}>
                    <b>确认后方向：</b>
                    <span>{correctedRelationSubject?.canonicalName || '主语待选择'} — {relationEdit.predicate || '谓词待填写'} → {correctedRelationObject?.canonicalName || '宾语待选择'}</span>
                    {relationInvalidReason
                      ? <small>{relationInvalidReason}</small>
                      : <small>修改会重算关系 ID、迁移原文证据并保留旧值→新值审计；不会静默丢失证据。</small>}
                  </div>}
                  {(relation.evidence || []).map((evidence: any) => <div key={evidence.messageId}><small>证据：“{evidence.excerpt}”</small></div>)}
                </div>}
                {review.kind === 'entity_summary' && <div className="assistant-review-note">
                  {review.previousSummary && <div><b>当前摘要：</b><span>{review.previousSummary}</span></div>}
                  <div><b>建议摘要：</b><span>{review.summaryText}</span></div>
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会写入档案和可信检索；拒绝不会修改现有摘要。</small></div>
                </div>}
                {review.kind === 'entity_alias' && <div className="assistant-review-note">
                  <div><b>建议别名：</b><span>{review.aliasText}</span></div>
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会参与身份消歧、合并建议和统一检索。</small></div>
                </div>}
                {review.kind === 'entity_creation' && <div className="assistant-review-note">
                  <div><b>模型识别名称：</b><span>{review.entityCanonicalName} · {review.entityType}</span></div>
                  <label className="assistant-entity-name-correction">
                    <span>确认使用的规范名</span>
                    <input
                      value={entityNameEdits[review.id] ?? review.entityCanonicalName ?? ''}
                      maxLength={100}
                      onChange={event => setEntityNameEdits(current => ({ ...current, [review.id]: event.target.value }))}
                    />
                    <small>名字不准确时请先修正；原值、新值和确认时间都会保留在人物档案中。错误旧名不会自动变成别名。</small>
                    {entityNameInvalidReason && <small className="error">{entityNameInvalidReason}</small>}
                  </label>
                  {sameNameEntities.length > 0 && <div className="assistant-name-collision">
                    <b>发现 {sameNameEntities.length} 个同名实体：</b>
                    <span>{sameNameEntities.map((entity: any) => entity.canonicalName).join('、')}</span>
                    <small>本次确认仍会建立独立实体，不会因同名自动合并；人物会另行进入“可能是同一人”审阅。</small>
                  </div>}
                  {(review.evidence || []).map((evidence: any) =>
                    <div key={evidence.messageId}><small>{evidence.sender || '原文'}：“{evidence.excerpt}”</small></div>)}
                  <div><small>确认后才会进入统一检索、RAG 查询规划、图路径和确定性派生视图。</small></div>
                  {review.legacyReview && !(review.evidence || []).length && <div><small>⚠ 此旧版实体没有可恢复的关联原文，请仅在你能确认身份时通过。</small></div>}
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
              <div><button onClick={() => void decideReview(review.id, 'rejected')}>拒绝</button><button className="primary" disabled={(review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId || !selectedMergeTargetId)) || Boolean(entityNameInvalidReason) || Boolean(relationInvalidReason)} title={review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId) ? '候选信息不完整，暂不能合并' : review.kind === 'possible_duplicate' && !selectedMergeTargetId ? '请先选择合并后保留的身份' : entityNameInvalidReason || relationInvalidReason} onClick={() => void decideReview(review.id, 'confirmed', review.kind === 'possible_duplicate' ? { mergeTargetEntityId: selectedMergeTargetId } : review.kind === 'entity_creation' ? { correctedCanonicalName: entityNameEdits[review.id] ?? review.entityCanonicalName ?? '' } : review.kind === 'relation' && relationEdit ? { relationCorrection: relationEdit } : undefined)}>{review.kind === 'relation' ? '确认修正后方向' : review.kind === 'possible_duplicate' ? '按此方向合并' : review.kind === 'entity_creation' ? '确认名称并启用' : '确认'}</button></div></>
              })()}
            </article>)}
            {!pendingReviews.length && <div className="assistant-empty">当前没有等待确认的身份或关系。</div>}
            {mergeHistory.length > 0 && <>
              <div className="assistant-section-heading"><div><span className="assistant-eyebrow">MERGE HISTORY</span><h3>最近身份合并</h3></div></div>
              {mergeHistory.map((merge: any) => <article className="assistant-review-item" key={`merge-${merge.id}`}>
                <div><strong>已合并身份</strong><p>{merge.source_name || merge.source_entity_id} → {merge.target_name || merge.target_entity_id}</p><small>被合并 → 保留 · {new Date(merge.created_at).toLocaleString('zh-CN')}</small></div>
                <div><button onClick={() => void revertMerge(Number(merge.id))}>撤销合并</button></div>
              </article>)}
            </>}
          </div>
        </section>
      </div>

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
                <h3>结构化事实 <small>{selectedEntityClaims.length}</small></h3>
                {selectedEntityClaims.map((claim: any) => <article key={claim.id}>
                  <div><b>{claim.polarity === 'negative' ? '并非 ' : ''}{claim.predicate}</b><span>{claim.object_entity_name || claim.object_value || '待确认'}</span></div>
                  <small>{claim.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(claim.confidence || 0) * 100)}% · {claim.source_nature === 'self_statement' ? '本人陈述' : claim.source_nature === 'other_statement' ? '他人陈述' : '模型推断'}</small>
                  {(claim.evidence || []).map((evidence: any) => <blockquote key={`${claim.id}-${evidence.message_id}`}>“{evidence.excerpt}”</blockquote>)}
                </article>)}
                {!selectedEntityClaims.length && <em>尚无结构化事实</em>}
              </section>
              <section>
                <h3>关系与证据 <small>{selectedEntityRelations.length}</small></h3>
                {selectedEntityRelations.map((relation: any) => {
                  const outgoing = relation.subjectId === selectedEntity.id
                  const neighborId = outgoing ? relation.objectId : relation.subjectId
                  const neighbor = graph.entities.find((item: any) => item.id === neighborId)
                  return <article key={relation.id}>
                    <button className="assistant-dossier-link" onClick={() => setSelectedEntityId(neighborId)}>
                      <b>{outgoing ? relation.predicate : `被${relation.predicate}`}</b><span>{neighbor?.canonicalName || neighborId}</span>
                    </button>
                    <small>{relation.status === 'confirmed' ? '已确认' : '待确认'} · {Math.round(Number(relation.confidence || 0) * 100)}%</small>
                    {(relation.evidence || []).map((evidence: any) => <blockquote key={`${relation.id}-${evidence.messageId}`}>“{evidence.excerpt}”</blockquote>)}
                    <button className="assistant-dossier-task-action danger" onClick={() => void permanentlyDeleteMemoryItem('relation', relation)}>永久删除关系</button>
                  </article>
                })}
                {!selectedEntityRelations.length && <em>尚无关系</em>}
              </section>
              <section>
                <h3>事件时间线 <small>{selectedEntityEvents.length}</small></h3>
                {selectedEntityEvents.map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.start_at || '时间待确认'}</span></div>
                  {event.description && <p>{event.description}</p>}
                  <small>{event.event_type} · {event.status === 'confirmed' ? '已确认' : '待确认'} · {event.location || '地点未记录'}</small>
                  {(event.evidence || []).map((evidence: any) => <blockquote key={`${event.id}-${evidence.message_id}`}>“{evidence.excerpt}”</blockquote>)}
                </article>)}
                {!selectedEntityEvents.length && <em>尚无相关事件</em>}
              </section>
              <section>
                <h3>关联事项 <small>{selectedEntityTasks.length}</small></h3>
                {selectedEntityTasks.map(task => <article key={task.id}>
                  <div>
                    <b>{task.title}</b><span>{task.status}</span>
                  </div>
                  <small>{task.taskKind || 'action'} · {task.owner || '负责人待确认'} · {task.due || '无截止时间'}</small>
                  {(task.evidence || []).map(evidence => <blockquote key={`${task.id}-${evidence.messageId}`}>{evidence.sender}：“{evidence.excerpt}”</blockquote>)}
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
              <span><b>{selectedProject.evidence.length}</b><small>去重证据</small></span>
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
                <h3>项目任务 <small>{selectedProject.tasks.length}</small></h3>
                {selectedProject.tasks.map((task: Task) => <article key={task.id}>
                  <div><b>{task.title}</b><span>{task.status}</span></div>
                  <small>{task.owner || '负责人待确认'} · {task.due || '无截止时间'} · {task.priority}</small>
                  {(task.evidence || []).slice(0, 2).map(evidence => <blockquote key={evidence.messageId}>{evidence.sender}：“{evidence.excerpt}”</blockquote>)}
                  {task.status !== 'cancelled' && <button className="assistant-dossier-task-action" onClick={() => void toggleTask(task)}>{task.status === 'done' ? '恢复待处理' : '标记完成'}</button>}
                </article>)}
                {!selectedProject.tasks.length && <em>尚无归入项目的任务</em>}
              </section>
              <section>
                <h3>里程碑与决策 <small>{selectedProject.milestones.length + selectedProject.decisions.length}</small></h3>
                {[...selectedProject.decisions, ...selectedProject.milestones].map((event: any) => <article key={event.id}>
                  <div><b>{event.title}</b><span>{event.event_type}</span></div>
                  <small>{event.start_at || '时间待确认'} · {event.status === 'confirmed' ? '已确认' : '待确认'}</small>
                  {(event.evidence || []).slice(0, 2).map((evidence: any) => <blockquote key={evidence.message_id}>“{evidence.excerpt}”</blockquote>)}
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
                <h3>最近原文证据 <small>{selectedProject.evidence.length}</small></h3>
                {selectedProject.evidence.slice(0, 12).map((evidence: any, index: number) =>
                  <blockquote key={String(evidence.messageId || evidence.message_id || index)}>“{evidence.excerpt}”</blockquote>)}
                {!selectedProject.evidence.length && <em>等待带原文的关系、事件或任务证据</em>}
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
              <span><b>{memoryDiagnostics.ingestionSummary?.runs || 0}</b><small>近期运行</small></span>
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
            {memoryDiagnostics.privacy && <div className={`assistant-privacy-audit ${memoryDiagnostics.privacy.secure && memoryDiagnostics.privacy.stateMode === '600' ? 'secure' : 'warning'}`}>
              <div><ShieldCheck size={15} /><span><b>本机隐私与权限审计</b>
                <small>数据库 {memoryDiagnostics.privacy.databaseMode || '未知'} · 状态 {memoryDiagnostics.privacy.stateMode || '未知'} · 备份目录 {memoryDiagnostics.privacy.backupDirectoryMode || '尚未创建'}</small>
              </span></div>
              <div><span>API Key：{memoryDiagnostics.privacy.apiKeyStorage}</span>
                <span>个人记忆库：{memoryDiagnostics.privacy.databaseEncryption?.enabled &&
                  memoryDiagnostics.privacy.databaseEncryption?.cipher === 'sqlcipher' &&
                  !memoryDiagnostics.privacy.databaseEncryption?.plaintextHeader
                  ? `SQLCipher 已加密${memoryDiagnostics.privacy.databaseEncryption?.migratedThisStart ? '（本次启动完成迁移）' : ''}`
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
              </div>
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
            {!!dashboard?.memoryDeletionAudit?.length && <div className="assistant-deletion-audit">
              <header><ShieldCheck size={15} /><span><b>永久删除审计</b><small>只保留不可逆指纹和影响计数，不保留被删除正文。</small></span></header>
              {(dashboard.memoryDeletionAudit || []).slice(0, 12).map((entry: any) => <article key={entry.id}>
                <span><b>{entry.item_kind === 'claim' ? '事实' : entry.item_kind === 'event' ? '事件' : '关系'} · {entry.item_fingerprint}</b>
                  <small>{new Date(entry.created_at).toLocaleString('zh-CN')}</small></span>
                <span>证据 {entry.impact?.evidence || 0} · 关联 {entry.impact?.related || 0} · 索引 {entry.impact?.searchDocuments || 0} · 问答 {entry.impact?.assistantMessages || 0}</span>
              </article>)}
            </div>}
            <div className="assistant-diagnostics-runs">
              {(memoryDiagnostics.ingestionRuns || []).map((run: any) => <details key={run.id} open={run.status !== 'completed'}>
                <summary><span><b>{new Date(run.started_at).toLocaleString('zh-CN')}</b><small>{run.model || '模型待记录'} · {run.prompt_version || '版本待记录'}</small></span>
                  <span className={run.status}>{run.status} · {run.message_count} 条 · {(Number(run.usage?.duration_ms || 0) / 1000).toFixed(1)} 秒</span></summary>
                {run.error && <p className="assistant-diagnostics-error">{run.error}</p>}
                <div>
                  {(run.batches || []).map((batch: any) => <article key={`${run.id}-${batch.batch_index}`} className={batch.status}>
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
                    {batch.error && <p>{batch.error}</p>}
                  </article>)}
                  {!run.batches?.length && <em>该次运行没有创建模型批次</em>}
                </div>
              </details>)}
              {!memoryDiagnostics.ingestionRuns?.length && <div className="assistant-empty">尚无增量运行记录。</div>}
            </div>
            <footer><button onClick={() => void window.electronAPI.aiAssistant.getMemoryDiagnostics().then(setMemoryDiagnostics)}>刷新</button>
              <button className="primary" onClick={() => setShowDiagnostics(false)}>完成</button></footer>
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
