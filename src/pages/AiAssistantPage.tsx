import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Bot, CalendarDays, Check, Clock3, Filter, Network, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
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
  const [showSources, setShowSources] = useState(false)
  const [sources, setSources] = useState<any[]>([])
  const [sourceQuery, setSourceQuery] = useState('')
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryResults, setMemoryResults] = useState<any[]>([])
  const [editingClaim, setEditingClaim] = useState<any>(null)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | Task['status']>('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<'all' | Task['priority']>('all')
  const [taskKindFilter, setTaskKindFilter] = useState<'all' | NonNullable<Task['taskKind']>>('all')
  const [pathFromId, setPathFromId] = useState('')
  const [pathToId, setPathToId] = useState('')
  const [graphPath, setGraphPath] = useState<any>(null)
  const [memoryDiagnostics, setMemoryDiagnostics] = useState<any>(null)
  const [backingUpMemory, setBackingUpMemory] = useState(false)
  const [restoringMemory, setRestoringMemory] = useState(false)
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

  const load = useCallback(async () => {
    const [nextStatus, nextDashboard] = await Promise.all([
      window.electronAPI.aiAssistant.status(),
      window.electronAPI.aiAssistant.dashboard()
    ])
    setStatus(nextStatus)
    setDashboard(nextDashboard)
  }, [])

  useEffect(() => {
    void load()
    void window.electronAPI.aiAssistant.getMemoryDiagnostics().then(setMemoryDiagnostics).catch(() => {})
    void window.electronAPI.aiAssistant.getConversationSources().then(setSources).catch(() => {})
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

  const briefing = dashboard?.briefing
  const tasks: Task[] = dashboard?.tasks || []
  const taskReviewQueue: Task[] = dashboard?.taskReviewQueue || []
  const taskReminders: any[] = dashboard?.taskReminders || []
  const taskHistory: any[] = dashboard?.taskHistory || []
  const openTasks = useMemo(() => tasks.filter(task => !['done', 'cancelled'].includes(task.status)), [tasks])
  const displayedTasks = useMemo(() => tasks.filter(task =>
    (taskStatusFilter === 'all' || task.status === taskStatusFilter) &&
    (taskPriorityFilter === 'all' || task.priority === taskPriorityFilter) &&
    (taskKindFilter === 'all' || (task.taskKind || 'action') === taskKindFilter)
  ), [tasks, taskStatusFilter, taskPriorityFilter, taskKindFilter])
  const graph = dashboard?.graph || { entities: [], relations: [], reviewQueue: [] }
  const graphEntities = useMemo(() => {
    const query = graphQuery.trim().toLowerCase()
    const rows = query
      ? graph.entities.filter((entity: any) => [entity.canonicalName, ...(entity.aliases || [])].some((value: string) => value.toLowerCase().includes(query)))
      : graph.entities
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
  const mergeHistory = dashboard?.mergeHistory || []
  const memoryFeed = dashboard?.memoryFeed || { claims: [], events: [] }
  const ingestionStatus = dashboard?.ingestionStatus
  const ingestionCounts = Object.fromEntries((ingestionStatus?.batches || []).map((item: any) => [item.status, Number(item.count || 0)]))
  const visibleClaims = memoryFeed.claims.filter((item: any) => item.status !== 'rejected')
  const visibleEvents = memoryFeed.events.filter((item: any) => item.status !== 'rejected')
  const selectedEntityClaims = selectedEntity
    ? visibleClaims.filter((item: any) => item.subject_id === selectedEntity.id)
    : []
  const selectedEntityEvents = selectedEntity
    ? visibleEvents.filter((item: any) => item.participants?.some((participant: any) => participant.entity_id === selectedEntity.id))
    : []
  const selectedEntityRelations = selectedEntity
    ? graph.relations.filter((item: any) =>
      item.status !== 'rejected' && (item.subjectId === selectedEntity.id || item.objectId === selectedEntity.id))
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
    setGraphPath(await window.electronAPI.aiAssistant.findGraphPath(pathFromId, pathToId, 6))
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

  const decideReview = async (id: string, decision: 'confirmed' | 'rejected') => {
    await window.electronAPI.aiAssistant.updateGraphReview(id, decision)
    await load()
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

  const openSources = async () => {
    setSources(await window.electronAPI.aiAssistant.getConversationSources())
    setShowSources(true)
  }

  const toggleSource = async (source: any) => {
    await window.electronAPI.aiAssistant.setConversationSource({ ...source, enabled: !source.enabled })
    setSources(current => current.map(item => item.sessionId === source.sessionId ? { ...item, enabled: !item.enabled } : item))
  }

  const setSourceType = async (type: 'group' | 'private', enabled: boolean) => {
    await window.electronAPI.aiAssistant.setConversationSourcesBulk({ type, enabled, sources })
    setSources(current => current.map(item => item.type === type ? { ...item, enabled } : item))
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
                  {memoryDiagnostics.embeddings ? ` · 语义索引 ${memoryDiagnostics.embeddings.indexed}/${memoryDiagnostics.embeddings.total}` : ''}
                </small>
              </span>
            </div>
            <div className="assistant-memory-health-actions">
              <button onClick={() => void backupMemory()} disabled={backingUpMemory || restoringMemory || !memoryDiagnostics.healthy}>
                {backingUpMemory ? '正在验证并备份…' : '立即备份个人记忆'}
              </button>
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

        <section className="assistant-briefing-card">
          <div className="assistant-briefing-copy">
            <span className="assistant-eyebrow">最新增量简报</span>
            <h2>{briefing?.headline || '等待第一次增量整理'}</h2>
            <p>{briefing?.summary || '服务会在启动时自动补齐，也会在每天设定时间整理新增消息。'}</p>
          </div>
          <div className="assistant-stat">
            <strong>{briefing?.messageCount || 0}</strong>
            <span>条本次新增消息</span>
            <small>{dashboard?.memoryStats?.claims || 0} 条事实 · {dashboard?.memoryStats?.events || 0} 个事件</small>
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
              <button disabled={!displayedTasks.some(task => !['done', 'cancelled'].includes(task.status))} onClick={() => void completeVisibleTasks()}>完成当前筛选</button>
            </div>
            {!!taskReminders.length && <div className="assistant-task-reminders">
              {taskReminders.slice(0, 8).map(reminder => <button key={reminder.id} className={reminder.severity}
                onClick={() => document.getElementById(`assistant-task-${reminder.taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                <strong>{reminder.kind === 'overdue' ? '已逾期' : reminder.kind === 'due_soon' ? '即将到期' : reminder.kind === 'blocked' ? '存在依赖' : '等待过久'} · {reminder.title}</strong>
                <span>{reminder.reason}</span>
              </button>)}
            </div>}
            <div className="assistant-task-list">
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
            </div>
          </section>

          <aside className="assistant-panel assistant-signals">
            <div className="assistant-section-heading"><div><span className="assistant-eyebrow">SIGNALS</span><h3>值得留意</h3></div></div>
            {(briefing?.highlights || []).map((highlight: string, index: number) => (
              <div className="assistant-highlight" key={`${index}-${highlight}`}><Sparkles size={13} /><span>{highlight}</span></div>
            ))}
            {!(briefing?.highlights?.length) && <div className="assistant-empty">暂无重要动态</div>}
            {status?.cursor?.lastError && <div className="assistant-error"><strong>上次同步未完成</strong><span>{status.cursor.lastError}</span></div>}
          </aside>
        </div>

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
              {graph.entities.map((entity: any) => <option key={entity.id} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
            <select value={memorySessionFilter} onChange={event => setMemorySessionFilter(event.target.value)}>
              <option value="">所有会话</option>
              {sources.filter(source => source.enabled).map(source => <option key={source.sessionId} value={source.sessionId}>{source.displayName}</option>)}
            </select>
            <select value={memoryTypeFilter} onChange={event => setMemoryTypeFilter(event.target.value)}>
              <option value="">所有记忆类型</option>
              <option value="entity">实体</option><option value="relation">关系</option><option value="claim">事实</option>
              <option value="event">事件</option><option value="task">待办</option>
            </select>
            <label><span>从</span><input type="date" value={memoryFrom} onChange={event => setMemoryFrom(event.target.value)} /></label>
            <label><span>至</span><input type="date" value={memoryTo} onChange={event => setMemoryTo(event.target.value)} /></label>
            {(memoryEntityFilter || memorySessionFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
              <button onClick={() => { setMemoryEntityFilter(''); setMemorySessionFilter(''); setMemoryTypeFilter(''); setMemoryFrom(''); setMemoryTo('') }}>清除范围</button>}
          </div>
          {(memoryEntityFilter || memorySessionFilter || memoryTypeFilter || memoryFrom || memoryTo) &&
            <small className="assistant-scope-note">当前范围同时应用于下方搜索和“向个人记忆提问”，范围外内容不会发送给模型。</small>}
          {!!memoryQuery.trim() && <div className="assistant-search-results">
            {memoryResults.map(result => <article key={result.id}>
              <span>{result.document_type}{result.match_source ? ` · ${result.match_source}匹配` : ''}{result.semantic_score ? ` · ${Math.round(result.semantic_score * 100)}%` : ''}</span><strong>{result.title}</strong><p>{result.search_text}</p>
            </article>)}
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
                <strong>{citation.title}</strong><span>{citation.type}</span><p>{citation.content}</p>
                {(citation.evidence || []).map((evidence: any) => <small key={evidence.message_id || evidence.messageId}>“{evidence.excerpt}”</small>)}
                {['relation', 'claim', 'event'].includes(citation.type) && <div className="assistant-citation-actions">
                  {citation.type === 'claim' && <button onClick={() => openClaimCorrection(citation)}>纠正事实</button>}
                  {citation.status !== 'confirmed' && <button className="primary" onClick={() => void reviewMemoryCitation(citation, 'confirmed')}>确认</button>}
                  {citation.status !== 'rejected' && <button onClick={() => void reviewMemoryCitation(citation, 'rejected')}>不准确</button>}
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
                {claim.polarity === 'negative' && <small>该条是对“{claim.predicate}”的明确否定陈述，仍需结合反证人工确认。</small>}
                {(claim.valid_from || claim.valid_to) && <small>有效期：{claim.valid_from || '未知'} — {claim.valid_to || '至今'}</small>}
                <div className="assistant-evidence-stack">
                  {(claim.evidence || []).map((evidence: any) =>
                    <small key={evidence.message_id}>{evidence.evidence_role === 'indirect' ? '间接证据' : evidence.evidence_role === 'contradiction' ? '反证' : '直接证据'} · {new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}：“{evidence.excerpt}”</small>)}
                </div>
                <div className="assistant-memory-actions">
                  {editingClaim?.id === claim.id
                    ? <><button onClick={() => setEditingClaim(null)}>取消</button><button className="primary" onClick={() => void saveClaimCorrection()}>保存纠正</button></>
                    : <button onClick={() => setEditingClaim({ id: claim.id, value: claim.object_entity_name || claim.object_value || '', validFrom: claim.valid_from || '', validTo: claim.valid_to || '' })}>纠正</button>}
                  <button onClick={() => void updateMemoryStatus('claim', claim.id, 'rejected')}>不准确</button>
                  {claim.status === 'candidate' && <button className="primary" onClick={() => void updateMemoryStatus('claim', claim.id, 'confirmed')}>确认事实</button>}
                </div>
              </article>)}
              {!visibleClaims.length && <div className="assistant-empty">后续增量消息会在这里形成带原文证据的个人事实。</div>}
            </div>
          </section>

          <section className="assistant-panel">
            <div className="assistant-section-heading">
              <div><span className="assistant-eyebrow">EVENT TIMELINE</span><h3><CalendarDays size={16} /> 事件时间线</h3></div>
              <span className="assistant-count">{visibleEvents.length} 项</span>
            </div>
            <div className="assistant-memory-list">
              {visibleEvents.map((event: any) => <article className="assistant-memory-item" key={event.id}>
                <div className="assistant-memory-item-head">
                  <strong>{event.title}</strong>
                  <span className={event.status}>{event.status === 'confirmed' ? '已确认' : '待确认'}</span>
                </div>
                {event.description && <p>{event.description}</p>}
                <small>{event.start_at || '时间待确认'}{event.location ? ` · ${event.location}` : ''}</small>
                {!!event.participants?.length && <small>参与者：{event.participants.map((item: any) => `${item.canonical_name}（${item.role}）`).join('、')}</small>}
                <div className="assistant-evidence-stack">
                  {(event.evidence || []).map((evidence: any) =>
                    <small key={evidence.message_id}>证据 · {new Date(evidence.timestamp * 1000).toLocaleString('zh-CN')}：“{evidence.excerpt}”</small>)}
                </div>
                <div className="assistant-memory-actions">
                  <button onClick={() => void updateMemoryStatus('event', event.id, 'rejected')}>不准确</button>
                  {event.status === 'candidate' && <button className="primary" onClick={() => void updateMemoryStatus('event', event.id, 'confirmed')}>确认事件</button>}
                </div>
              </article>)}
              {!visibleEvents.length && <div className="assistant-empty">会议、决定、交付和承诺等事件会显示在这里。</div>}
            </div>
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
          <div className="assistant-path-finder">
            <select value={pathFromId} onChange={event => { setPathFromId(event.target.value); setGraphPath(null) }}>
              <option value="">选择起点</option>
              {graph.entities.map((entity: any) => <option key={`from-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
            <span>→</span>
            <select value={pathToId} onChange={event => { setPathToId(event.target.value); setGraphPath(null) }}>
              <option value="">选择终点</option>
              {graph.entities.map((entity: any) => <option key={`to-${entity.id}`} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
            </select>
            <button onClick={() => void findGraphPath()} disabled={!pathFromId || !pathToId}>查找关系路径</button>
          </div>
          {graphPath && <div className={`assistant-path-result ${graphPath.found ? '' : 'missing'}`}>
            {graphPath.found ? graphPath.entities.map((entity: any, index: number) => <span key={entity.id}>
              <button onClick={() => setSelectedEntityId(entity.id)}>{entity.canonicalName}</button>
              {graphPath.steps[index] && <i>{graphPath.steps[index].forward ? graphPath.steps[index].predicate : `被${graphPath.steps[index].predicate}`} →</i>}
            </span>) : <p>在 6 层关系内没有找到路径。候选关系被保留，已拒绝关系不会参与计算。</p>}
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
                  return <g key={entity.id} className={`graph-node ${selectedEntityId === entity.id ? 'selected' : ''}`} onClick={() => setSelectedEntityId(entity.id)}>
                    <circle cx={point.x} cy={point.y} r={entity.type === 'person' ? 18 : 14} />
                    <text x={point.x} y={point.y + 32} textAnchor="middle">{entity.canonicalName.slice(0, 12)}</text>
                  </g>
                })}
              </svg>
              <aside className="assistant-graph-detail">
                {selectedEntity ? <>
                  <span>{selectedEntity.type}</span>
                  <h4>{selectedEntity.canonicalName}</h4>
                  <p>{selectedEntity.summary || '等待更多证据补充'}</p>
                  <small>别名：{selectedEntity.aliases?.join('、') || '无'}</small>
                  <small>账号：{selectedEntity.accountIds?.join('、') || '未关联'}</small>
                  <small>证据消息：{selectedEntity.evidenceMessageIds?.length || 0} 条</small>
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
                return <><div><strong>{review.kind === 'possible_duplicate' ? `可能是同一个人：${review.title}` : review.title}</strong>
                {review.kind === 'possible_duplicate' && <div className="assistant-identity-pair">
                  {[review.leftEntityId, review.rightEntityId].map((entityId: string) => {
                    const entity = graph.entities.find((item: any) => item.id === entityId)
                    return <span key={entityId}><b>{entity?.canonicalName || '未知人物'}</b><small>{entity?.aliases?.join('、') || entity?.accountIds?.join('、') || '暂无别名或账号'}</small></span>
                  })}
                </div>}
                {relation && <div className="assistant-review-note">
                  <b>方向说明：</b>{relation.directionExplanation || (
                    relation.predicate === '服务对象'
                      ? `${object?.canonicalName || '宾语'}向${subject?.canonicalName || '主语'}提供服务；${subject?.canonicalName || '主语'}是${object?.canonicalName || '宾语'}的服务对象。`
                      : `从“${subject?.canonicalName || '主语'}”指向“${object?.canonicalName || '宾语'}”：${subject?.canonicalName || '主语'} ${relation.predicate} ${object?.canonicalName || '宾语'}。`
                  )}
                  <div><small>主语：{subject?.canonicalName || relation.subjectId}　→　宾语：{object?.canonicalName || relation.objectId}</small></div>
                  {(relation.evidence || []).map((evidence: any) => <div key={evidence.messageId}><small>证据：“{evidence.excerpt}”</small></div>)}
                </div>}
                <p>{review.detail}</p><small>{Math.round(review.confidence * 100)}% 可信 · {review.kind === 'possible_duplicate' ? '确认后合并身份' : '确认后写入关系'}</small></div>
              <div><button onClick={() => void decideReview(review.id, 'rejected')}>拒绝</button><button className="primary" disabled={review.kind === 'possible_duplicate' && (!review.leftEntityId || !review.rightEntityId)} title={!review.leftEntityId || !review.rightEntityId ? '候选信息不完整，暂不能合并' : ''} onClick={() => void decideReview(review.id, 'confirmed')}>{review.kind === 'relation' ? '确认此方向' : '确认'}</button></div></>
              })()}
            </article>)}
            {!pendingReviews.length && <div className="assistant-empty">当前没有等待确认的身份或关系。</div>}
            {mergeHistory.length > 0 && <>
              <div className="assistant-section-heading"><div><span className="assistant-eyebrow">MERGE HISTORY</span><h3>最近身份合并</h3></div></div>
              {mergeHistory.map((merge: any) => <article className="assistant-review-item" key={`merge-${merge.id}`}>
                <div><strong>已合并身份</strong><p>{merge.source_entity_id} → {merge.target_entity_id}</p><small>{new Date(merge.created_at).toLocaleString('zh-CN')}</small></div>
                <div><button onClick={() => void revertMerge(Number(merge.id))}>撤销合并</button></div>
              </article>)}
            </>}
          </div>
        </section>
      </div>

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
            <label><span>每日整理时间</span><input type="time" value={settings.scheduleTime} onChange={event => setSettings({ ...settings, scheduleTime: event.target.value })} /></label>
            <label className="assistant-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /><span>启用启动补齐与每日自动整理</span></label>
            <div className="assistant-modal-actions"><button onClick={() => setShowSettings(false)}>取消</button><button className="primary" onClick={saveSettings}>保存设置</button></div>
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
    </div>
  )
}

export default AiAssistantPage
