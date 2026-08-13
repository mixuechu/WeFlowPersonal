import crypto from 'crypto'

export interface TaskArchiveScopeOptions {
  status?: string
  priority?: string
  project?: string
  query?: string
  from?: string
  to?: string
}

const normalizeText = (value: unknown): string =>
  String(value || '').trim().toLocaleLowerCase('zh-CN')

const normalizeDateBoundary = (value: unknown): string => {
  const text = String(value || '').trim()
  return text && Number.isFinite(Date.parse(text)) ? text : ''
}

export function buildTaskArchiveScopeToken(options: TaskArchiveScopeOptions = {}): string {
  const status = options.status === 'done' || options.status === 'cancelled'
    ? options.status
    : 'all'
  const priority = ['high', 'medium', 'low'].includes(String(options.priority || ''))
    ? String(options.priority)
    : ''
  return crypto.createHash('sha256').update(JSON.stringify([
    'task-archive-scope-v1',
    status,
    priority,
    normalizeText(options.project),
    normalizeText(options.query),
    normalizeDateBoundary(options.from),
    normalizeDateBoundary(options.to)
  ])).digest('hex')
}
