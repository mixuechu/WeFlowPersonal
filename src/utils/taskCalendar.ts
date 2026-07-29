export function extractTaskDueDate(value: unknown): string | null {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const candidate = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${candidate}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate
}

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now)
}

export function buildTaskCalendar(tasks: any[], month: string, now = new Date()): {
  month: string
  days: Array<{ date: string; day: number; inMonth: boolean; isToday: boolean; tasks: any[] }>
  unscheduled: any[]
  overdue: any[]
} {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : shanghaiToday(now).slice(0, 7)
  const [year, monthNumber] = safeMonth.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const gridStart = new Date(first)
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayOffset)
  const today = shanghaiToday(now)
  const tasksByDate = new Map<string, any[]>()
  const unscheduled: any[] = []
  for (const task of tasks) {
    const dueDate = extractTaskDueDate(task.due)
    if (!dueDate) {
      unscheduled.push(task)
      continue
    }
    tasksByDate.set(dueDate, [...(tasksByDate.get(dueDate) || []), task])
  }
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    return {
      date: key,
      day: date.getUTCDate(),
      inMonth: key.slice(0, 7) === safeMonth,
      isToday: key === today,
      tasks: (tasksByDate.get(key) || []).sort((left, right) => {
        const priority = { high: 0, medium: 1, low: 2 } as Record<string, number>
        return (priority[left.priority] ?? 3) - (priority[right.priority] ?? 3)
      })
    }
  })
  const overdue = tasks.filter(task => {
    const dueDate = extractTaskDueDate(task.due)
    return dueDate && dueDate < today && !['done', 'cancelled'].includes(task.status)
  })
  return { month: safeMonth, days, unscheduled, overdue }
}
