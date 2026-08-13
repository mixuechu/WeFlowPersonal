export type TaskReminder = {
  id: string
  taskId: string
  kind: 'overdue' | 'due_soon' | 'waiting_stale' | 'blocked'
  severity: 'high' | 'medium'
  title: string
  reason: string
}

export type ReminderPreferences = {
  mutedKinds: TaskReminder['kind'][]
  snoozedUntil: Record<string, string>
  history: Array<{
    reminderId: string
    taskId: string
    kind: TaskReminder['kind']
    action: 'helpful' | 'snooze' | 'mute_kind' | 'restore_kind'
    createdAt: string
  }>
}

export function normalizeReminderPreferences(value: any): ReminderPreferences {
  const kinds = new Set<TaskReminder['kind']>(['overdue', 'due_soon', 'waiting_stale', 'blocked'])
  return {
    mutedKinds: [...new Set((Array.isArray(value?.mutedKinds) ? value.mutedKinds : [])
      .filter((kind: any): kind is TaskReminder['kind'] => kinds.has(kind)))],
    snoozedUntil: value?.snoozedUntil && typeof value.snoozedUntil === 'object'
      ? Object.fromEntries(Object.entries(value.snoozedUntil).filter(([, until]) => Number.isFinite(Date.parse(String(until)))))
      : {},
    history: (Array.isArray(value?.history) ? value.history : []).slice(-200)
  }
}

export function applyReminderPreferences(
  reminders: TaskReminder[],
  input: ReminderPreferences,
  now = new Date()
): { visible: TaskReminder[]; suppressed: number } {
  const preferences = normalizeReminderPreferences(input)
  const muted = new Set(preferences.mutedKinds)
  const current = now.getTime()
  const visible = reminders.filter(reminder => {
    if (muted.has(reminder.kind)) return false
    const until = Date.parse(preferences.snoozedUntil[reminder.id] || '')
    return !Number.isFinite(until) || until <= current
  })
  return { visible, suppressed: reminders.length - visible.length }
}

export function assertReminderPreferenceMutation(
  reminders: TaskReminder[],
  input: {
    reminderId?: string
    taskId?: string
    kind?: TaskReminder['kind']
    action?: ReminderPreferences['history'][number]['action']
    expectedRevision?: string
  },
  currentRevision: string
): void {
  if (!input.expectedRevision || input.expectedRevision !== currentRevision) {
    throw new Error('提醒列表在展示后发生了变化，请刷新后重新操作')
  }
  if (input.action === 'restore_kind') return
  const reminder = reminders.find(item =>
    item.id === String(input.reminderId || '') &&
    item.taskId === String(input.taskId || '') &&
    item.kind === input.kind)
  if (!reminder) {
    throw new Error('这条提醒已变化或不再需要处理，请刷新后重新操作')
  }
}

function normalizedTitle(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\s，。！？、,.!?:：；;（）()[\]【】]/g, '')
}

export function findMatchingTask(candidate: any, existing: any[]): any | null {
  const evidenceIds = new Set((candidate.sourceMessageIds || []).map(String))
  if (evidenceIds.size) {
    const evidenceMatch = existing.find(task => (task.sourceMessageIds || []).some((id: any) => evidenceIds.has(String(id))))
    if (evidenceMatch) return evidenceMatch
  }
  const title = normalizedTitle(candidate.title)
  const source = String(candidate.source || '').trim().toLowerCase()
  return existing.find(task =>
    normalizedTitle(task.title) === title &&
    String(task.source || '').trim().toLowerCase() === source
  ) || null
}

function dueTimestamp(value: unknown): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999+08:00` : text
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function buildTaskReminders(tasks: any[], now = new Date()): TaskReminder[] {
  const current = now.getTime()
  const byId = new Map(tasks.map(task => [task.id, task]))
  const reminders: TaskReminder[] = []
  for (const task of tasks) {
    if (['done', 'cancelled'].includes(task.status)) continue
    const due = dueTimestamp(task.due)
    if (due !== null && due < current) {
      reminders.push({
        id: `overdue:${task.id}`, taskId: task.id, kind: 'overdue', severity: 'high',
        title: task.title, reason: `截止时间 ${task.due} 已经过期，任务仍为“${task.status}”`
      })
    } else if (due !== null && due - current <= 48 * 60 * 60 * 1000) {
      reminders.push({
        id: `due_soon:${task.id}`, taskId: task.id, kind: 'due_soon', severity: 'medium',
        title: task.title, reason: `将在 48 小时内到期：${task.due}`
      })
    }
    const waitingSince = Date.parse(String(task.updatedAt || task.createdAt || ''))
    if ((task.status === 'waiting' || task.taskKind === 'waiting' || task.taskKind === 'delegated') &&
        Number.isFinite(waitingSince) && current - waitingSince >= 3 * 86_400_000) {
      reminders.push({
        id: `waiting_stale:${task.id}`, taskId: task.id, kind: 'waiting_stale', severity: 'medium',
        title: task.title, reason: `已等待 ${Math.floor((current - waitingSince) / 86_400_000)} 天，没有新的状态变化`
      })
    }
    const blockers = (task.dependsOnIds || []).map((id: string) => byId.get(id))
      .filter((dependency: any) => dependency && !['done', 'cancelled'].includes(dependency.status))
    if (blockers.length) {
      reminders.push({
        id: `blocked:${task.id}`, taskId: task.id, kind: 'blocked', severity: 'medium',
        title: task.title, reason: `仍依赖 ${blockers.length} 项未完成任务：${blockers.slice(0, 2).map((item: any) => item.title).join('、')}`
      })
    }
  }
  return reminders.sort((left, right) => {
    const severity = left.severity === right.severity ? 0 : left.severity === 'high' ? -1 : 1
    return severity || left.id.localeCompare(right.id)
  })
}

export function paginateTaskReminders(
  reminders: TaskReminder[],
  options: {
    offset?: number
    limit?: number
    revision: string
    expectedRevision?: string
  }
): {
  items: TaskReminder[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
  revision: string
  stale: boolean
} {
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 8)))
  const revision = String(options.revision || '0')
  const expectedRevision = String(options.expectedRevision || '')
  if (offset > 0 && expectedRevision !== revision) {
    return { items: [], offset, limit, total: reminders.length, hasMore: false, revision, stale: true }
  }
  const items = reminders.slice(offset, offset + limit)
  return {
    items,
    offset,
    limit,
    total: reminders.length,
    hasMore: offset + items.length < reminders.length,
    revision,
    stale: false
  }
}
