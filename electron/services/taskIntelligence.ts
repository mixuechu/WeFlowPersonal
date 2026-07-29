export type TaskReminder = {
  id: string
  taskId: string
  kind: 'overdue' | 'due_soon' | 'waiting_stale' | 'blocked'
  severity: 'high' | 'medium'
  title: string
  reason: string
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
  return reminders.sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'high' ? -1 : 1))
}
