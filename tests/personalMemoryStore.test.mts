import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersonalMemoryStore } from '../electron/services/personalMemoryStore.ts'

function withStore(run: (store: PersonalMemoryStore) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-test-'))
  const store = new PersonalMemoryStore()
  try {
    store.initialize(join(directory, 'memory.sqlite'))
    run(store)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

const evidence = (messageId: string, excerpt: string) => [{
  messageId,
  sessionId: 'session-1',
  timestamp: 1_700_000_000,
  excerpt,
  role: 'support'
}]

test('conflicting current claims coexist as review candidates', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'person-1',
      type: 'person',
      canonicalName: '测试用户',
      summary: '',
      confidence: 1,
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-1',
    subjectId: 'person-1',
    predicate: '所在城市',
    objectValue: '深圳',
    confidence: 0.95,
    status: 'confirmed',
    sourceNature: 'other_statement',
    searchText: '测试用户 所在城市 深圳',
    evidence: evidence('message-1', '我现在住在深圳')
  }])
  store.upsertClaims([{
    id: 'claim-2',
    subjectId: 'person-1',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.9,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '测试用户 所在城市 上海',
    evidence: evidence('message-2', '我现在住在上海')
  }])

  const claims = store.getMemoryFeed().claims
  assert.equal(claims.length, 2)
  assert.ok(claims.every(claim => claim.status === 'candidate'))
  assert.ok(claims.every(claim => String(claim.conflict_group).startsWith('conflict_')))
  assert.deepEqual(new Set(claims.map(claim => claim.evidence[0].evidence_role)), new Set(['direct', 'indirect']))
}))

test('task search keeps original message evidence', () => withStore(store => {
  store.syncTasks([{
    id: 'task-1',
    title: '确认客户更新时间',
    detail: '需要回复客户',
    source: '项目群',
    priority: 'high',
    status: 'todo',
    classification: 'mine',
    evidence: [{
      messageId: 'message-task-1',
      timestamp: 1_700_000_001,
      sender: '客户甲',
      excerpt: '麻烦你确认一下几点更新'
    }]
  }])

  const [result] = store.searchText('确认客户更新时间')
  assert.equal(result.document_type, 'task')
  assert.deepEqual(store.getDocumentEvidence('task', 'task-1').map(item => ({ ...item })), [{
    message_id: 'message-task-1',
    session_id: '项目群',
    timestamp: 1_700_000_001,
    sender: '客户甲',
    excerpt: '麻烦你确认一下几点更新'
  }])
}))

test('Chinese substring search falls back when the exact FTS phrase misses', () => withStore(store => {
  store.syncTasks([{
    id: 'task-2',
    title: '整理项目交付计划',
    detail: '准备本周交付清单',
    source: '项目群',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }])

  const results = store.searchText('项目交付')
  assert.ok(results.some(result => result.source_id === 'task-2'))
}))

test('verified memory backup is created only from a healthy database', () => withStore(store => {
  store.syncTasks([{
    id: 'task-backup',
    title: '验证个人记忆备份',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }])

  const before = store.getDiagnostics()
  assert.equal(before.healthy, true)
  assert.equal(before.integrity, 'ok')
  const backup = store.createBackup()
  assert.equal(backup.success, true)
  assert.ok(backup.bytes > 0)
  assert.equal(existsSync(backup.path), true)
  store.syncTasks([{
    id: 'task-after-backup',
    title: '这条记录不应出现在恢复后的快照中',
    priority: 'low',
    status: 'todo',
    classification: 'mine'
  }])
  assert.equal(store.searchText('不应出现在恢复后的快照中').length, 1)
  const restored = store.restoreBackup(backup.path)
  assert.equal(restored.success, true)
  assert.equal(store.searchText('不应出现在恢复后的快照中').length, 0)
  const after = store.getDiagnostics()
  assert.equal(after.backups.length, 2)
  assert.ok(after.backups.some((item: any) => item.path === backup.path))
}))
