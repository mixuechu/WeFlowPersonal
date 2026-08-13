import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTaskArchiveScopeToken } from '../electron/services/taskArchiveScope.ts'

test('task archive scope token binds every effective archive filter', () => {
  const base = buildTaskArchiveScopeToken({
    status: 'done', priority: 'high', project: '  Onyx ', query: '  交付 ',
    from: '2026-08-01T00:00:00.000+08:00', to: '2026-08-12T23:59:59.999+08:00'
  })
  assert.equal(base, buildTaskArchiveScopeToken({
    status: 'done', priority: 'high', project: 'onyx', query: '交付',
    from: '2026-08-01T00:00:00.000+08:00', to: '2026-08-12T23:59:59.999+08:00'
  }))
  for (const changed of [
    { status: 'cancelled' }, { priority: 'low' }, { project: '别的项目' },
    { query: '验收' }, { from: '2026-08-02T00:00:00.000+08:00' },
    { to: '2026-08-11T23:59:59.999+08:00' }
  ]) {
    assert.notEqual(base, buildTaskArchiveScopeToken({
      status: 'done', priority: 'high', project: 'Onyx', query: '交付',
      from: '2026-08-01T00:00:00.000+08:00', to: '2026-08-12T23:59:59.999+08:00',
      ...changed
    }))
  }
})

test('task archive scope token normalizes ineffective values', () => {
  assert.equal(
    buildTaskArchiveScopeToken({ status: 'unexpected', priority: 'urgent', from: 'invalid' }),
    buildTaskArchiveScopeToken({ status: 'all' })
  )
})
