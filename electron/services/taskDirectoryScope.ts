import crypto from 'crypto'

export interface ActiveTaskWorksetScopeOptions {
  taskId?: string
  status?: string
  priority?: string
  taskKind?: string
  query?: string
}

export interface TaskCalendarScopeOptions extends Omit<ActiveTaskWorksetScopeOptions, 'taskId'> {
  month?: string
}

const normalizeText = (value: unknown): string =>
  String(value || '').trim().toLocaleLowerCase('zh-CN')

const normalizeId = (value: unknown): string => String(value || '').trim()

const normalizeStatus = (value: unknown): string =>
  ['todo', 'doing', 'waiting'].includes(String(value || '')) ? String(value) : 'all'

const normalizePriority = (value: unknown): string =>
  ['high', 'medium', 'low'].includes(String(value || '')) ? String(value) : ''

const normalizeTaskKind = (value: unknown): string =>
  ['action', 'delegated', 'waiting'].includes(String(value || '')) ? String(value) : ''

const digest = (scope: unknown[]): string =>
  crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex')

export function buildActiveTaskWorksetScopeToken(
  options: ActiveTaskWorksetScopeOptions = {}
): string {
  return digest([
    'active-task-workset-scope-v1',
    normalizeId(options.taskId),
    normalizeStatus(options.status),
    normalizePriority(options.priority),
    normalizeTaskKind(options.taskKind),
    normalizeText(options.query)
  ])
}

export function buildTaskCalendarScopeToken(options: TaskCalendarScopeOptions = {}): string {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(options.month || ''))
    ? String(options.month)
    : ''
  return digest([
    'task-calendar-scope-v1',
    month,
    normalizeStatus(options.status),
    normalizePriority(options.priority),
    normalizeTaskKind(options.taskKind),
    normalizeText(options.query)
  ])
}
