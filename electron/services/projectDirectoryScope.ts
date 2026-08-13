import crypto from 'crypto'

export interface ProjectDirectoryScopeOptions {
  query?: string
  phase?: string
  today?: string
}

export function computeProjectDirectoryScopeToken(options: ProjectDirectoryScopeOptions = {}): string {
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN').slice(0, 500)
  const phase = ['discovery', 'planned', 'active', 'completed'].includes(String(options.phase || ''))
    ? String(options.phase)
    : ''
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(options.today || ''))
    ? String(options.today)
    : ''
  return crypto.createHash('sha256').update(JSON.stringify([
    'project-directory-scope-v1', query, phase, today
  ])).digest('hex')
}
