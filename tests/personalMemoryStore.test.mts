import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersonalMemoryStore } from '../electron/services/personalMemoryStore.ts'
import { filterMemorySearchResults } from '../electron/services/memorySearchFilters.ts'
import { buildMemoryQueryPlan } from '../electron/services/memoryQueryPlanner.ts'
import { applyReminderPreferences, buildTaskReminders, findMatchingTask } from '../electron/services/taskIntelligence.ts'
import { buildEntityInsights } from '../electron/services/relationshipInsights.ts'
import {
  classifyTaskAssignment,
  evaluateTaskAssignmentPolicy,
  TASK_ASSIGNMENT_GOLDEN_SAMPLES
} from '../electron/services/taskAssignmentPolicy.ts'
import {
  assessIdentityPair,
  buildNameBuckets,
  getFullIdentityScanSchedule,
  identityPairKey,
  isNegativeDecisionCurrent
} from '../electron/services/identityDisambiguation.ts'
import { editDistance, fuzzyEntityScore } from '../electron/services/fuzzyEntitySearch.ts'
import { buildWeeklyBriefing, isQuietTime } from '../electron/services/briefingIntelligence.ts'
import { enqueueUniqueNotification, markNotificationAttempt } from '../electron/services/notificationOutbox.ts'
import { findCommonGraphNeighbors } from '../electron/services/graphCommonNeighbors.ts'
import { buildProjectInsights } from '../electron/services/projectInsights.ts'
import { buildTaskCalendar, extractTaskDueDate } from '../src/utils/taskCalendar.ts'
import { summarizeIngestionRuns } from '../electron/services/ingestionDiagnostics.ts'

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

test('identity candidates explain their source and preserve current negative decisions', () => {
  const left = { id: 'a', type: 'person', canonicalName: '同名用户', aliases: ['小同'], accountIds: ['wx-a'], identityVersion: 2 }
  const right = { id: 'b', type: 'person', canonicalName: '另一名称', aliases: ['小同'], accountIds: ['wx-b'], identityVersion: 4 }
  const assessment = assessIdentityPair(left, right)
  assert.equal(assessment.eligible, true)
  assert.equal(assessment.signals[0].source, 'alias_overlap')
  assert.equal(identityPairKey('b', 'a'), 'a|b')
  assert.equal(isNegativeDecisionCurrent({
    decision: 'different', left_version: 2, right_version: 4
  }, left, right), true)
  assert.equal(isNegativeDecisionCurrent({
    decision: 'different', left_version: 1, right_version: 4
  }, left, right), false)
})

test('relationship history keeps creation and later review state instead of overwriting it', () => withStore(store => {
  const entities = [
    { id: 'person-a', type: 'person', canonicalName: '人物甲', aliases: [], accountIds: [] },
    { id: 'org-b', type: 'organization', canonicalName: '组织乙', aliases: [], accountIds: [] }
  ]
  const relation = {
    id: 'relation-history',
    subjectId: 'person-a',
    predicate: '服务对象',
    objectId: 'org-b',
    confidence: 0.7,
    status: 'candidate',
    evidence: [],
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z'
  }
  store.syncGraph({ entities, relations: [relation], reviewQueue: [] })
  store.syncGraph({
    entities,
    relations: [{ ...relation, status: 'confirmed', confidence: 0.9, updatedAt: '2026-07-30T00:00:00.000Z' }],
    reviewQueue: []
  })
  const history = store.listRelationHistory('person-a')
  assert.deepEqual(history.map(item => item.change_type), ['status_changed', 'created'])
  assert.deepEqual(history.map(item => item.status), ['confirmed', 'candidate'])
}))

test('large identity graphs switch to a weekly indexed full scan', () => {
  const now = new Date('2026-07-30T12:00:00.000Z')
  assert.equal(getFullIdentityScanSchedule(499, null, now).mode, 'incremental')
  assert.equal(getFullIdentityScanSchedule(500, null, now).due, true)
  assert.equal(getFullIdentityScanSchedule(500, '2026-07-29T12:00:00.000Z', now).due, false)
  assert.equal(getFullIdentityScanSchedule(500, '2026-07-20T12:00:00.000Z', now).due, true)
  const buckets = buildNameBuckets([
    { id: 'a', type: 'person', canonicalName: '甲', aliases: ['共同别名'] },
    { id: 'b', type: 'person', canonicalName: '乙', aliases: ['共同别名'] },
    { id: 'org', type: 'organization', canonicalName: '共同别名' }
  ])
  assert.deepEqual(buckets.get('共同别名'), ['a', 'b'])
})

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
    owner: '李卓',
    collaborators: ['同事甲'],
    project: '升级版演示',
    dependsOnIds: ['task-prerequisite'],
    taskKind: 'delegated',
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
  assert.deepEqual(JSON.parse(result.metadata_json), {
    status: 'todo',
    priority: 'high',
    classification: 'mine',
    owner: '李卓',
    collaborators: ['同事甲'],
    project: '升级版演示',
    dependsOnIds: ['task-prerequisite'],
    taskKind: 'delegated',
    ownershipPolicyReason: ''
  })
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

test('entity search indexes WeChat IDs and tolerates one-character name errors', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'person-search',
      type: 'person',
      canonicalName: '邢爱妮',
      aliases: ['爱妮'],
      accountIds: ['wxid_onyx_contact']
    }],
    relations: [],
    reviewQueue: []
  })
  assert.equal(store.searchText('wxid_onyx_contact')[0].source_id, 'person-search')
  const fuzzy = store.searchText('邢爱泥')
  assert.equal(fuzzy[0].source_id, 'person-search')
  assert.equal(fuzzy[0].match_reason, 'fuzzy_entity')
  assert.equal(editDistance('邢爱妮', '邢爱泥'), 1)
  assert.ok(fuzzyEntityScore('wxid-onyx-contact', ['wxid_onyx_contact']) !== null)
  assert.equal(fuzzyEntityScore('完全无关', ['邢爱妮']), null)
}))

test('weekly briefing aggregates Shanghai dates and quiet hours cross midnight', () => {
  assert.equal(isQuietTime('23:30', '22:00', '08:00'), true)
  assert.equal(isQuietTime('07:59', '22:00', '08:00'), true)
  assert.equal(isQuietTime('12:00', '22:00', '08:00'), false)
  assert.equal(isQuietTime('12:00', '09:00', '18:00'), true)
  const briefing = buildWeeklyBriefing({
    '2026-07-30': { messageCount: 8, highlights: ['完成演示'], summary: '完成产品演示。' },
    '2026-07-27': { messageCount: 5, highlights: ['客户反馈'], summary: '收到客户反馈。' },
    '2026-07-20': { messageCount: 99, highlights: ['过期内容'], summary: '不应进入本周。' }
  }, [{
    id: 'task-high', status: 'todo', priority: 'high'
  }, {
    id: 'task-waiting', status: 'waiting', priority: 'medium', taskKind: 'waiting'
  }, {
    id: 'task-done', status: 'done', priority: 'high'
  }], new Date('2026-07-30T12:00:00+08:00'))
  assert.equal(briefing.messageCount, 13)
  assert.equal(briefing.daysWithUpdates, 2)
  assert.equal(briefing.activeTaskCount, 2)
  assert.equal(briefing.waitingTaskCount, 1)
  assert.equal(briefing.highPriorityTaskCount, 1)
  assert.deepEqual(briefing.highlights, ['完成演示', '客户反馈'])
})

test('notification outbox persists unique work until a successful delivery', () => {
  const outbox = { pending: [], sentKeys: [] } as any
  const notification = { key: 'task-reminders:2026-07-30', title: '需要留意', content: '两项待办', createdAt: '2026-07-30T12:00:00Z' }
  assert.equal(enqueueUniqueNotification(outbox, notification), true)
  assert.equal(enqueueUniqueNotification(outbox, notification), false)
  markNotificationAttempt(outbox, notification.key, { success: false, error: 'temporary failure' })
  assert.equal(outbox.pending[0].attempts, 1)
  assert.equal(outbox.pending[0].lastError, 'temporary failure')
  markNotificationAttempt(outbox, notification.key, { success: true })
  assert.equal(outbox.pending.length, 0)
  assert.deepEqual(outbox.sentKeys, [notification.key])
  assert.equal(enqueueUniqueNotification(outbox, notification), false)
})

test('common-neighbor graph query keeps relation direction, status and evidence', () => {
  const entities = [
    { id: 'left', canonicalName: '人物甲' },
    { id: 'right', canonicalName: '人物乙' },
    { id: 'common', canonicalName: '共同项目' },
    { id: 'rejected-only', canonicalName: '错误实体' }
  ]
  const relations = [{
    id: 'left-common', subjectId: 'left', objectId: 'common', predicate: '参与', status: 'confirmed', confidence: 0.9,
    evidence: [{ messageId: 'evidence-left' }]
  }, {
    id: 'common-right', subjectId: 'common', objectId: 'right', predicate: '服务', status: 'candidate', confidence: 0.7,
    evidence: [{ messageId: 'evidence-right' }]
  }, {
    id: 'left-rejected', subjectId: 'left', objectId: 'rejected-only', predicate: '认识', status: 'rejected', confidence: 1
  }, {
    id: 'right-rejected', subjectId: 'right', objectId: 'rejected-only', predicate: '认识', status: 'confirmed', confidence: 1
  }]
  const [result] = findCommonGraphNeighbors('left', 'right', entities, relations)
  assert.equal(result.entity.id, 'common')
  assert.equal(result.leftEdges[0].forward, true)
  assert.equal(result.rightEdges[0].forward, false)
  assert.equal(result.rightEdges[0].status, 'candidate')
  assert.equal(result.leftEdges[0].evidence[0].messageId, 'evidence-left')
})

test('project intelligence aggregates members, progress, risks, decisions and evidence', () => {
  const projects = buildProjectInsights({
    entities: [
      { id: 'project-demo', type: 'project', canonicalName: '升级版演示', aliases: ['演示项目'], summary: '客户演示项目' },
      { id: 'person-owner', type: 'person', canonicalName: '负责人甲', aliases: [] }
    ],
    relations: [{
      id: 'member-relation', subjectId: 'person-owner', objectId: 'project-demo', predicate: '负责', status: 'confirmed', confidence: 0.9,
      evidence: [{ messageId: 'message-member', timestamp: 1_775_000_000, excerpt: '负责人甲负责升级版演示' }]
    }],
    claims: [],
    events: [{
      id: 'decision-project', event_type: 'decision', title: '决定周五演示', description: '', status: 'candidate', start_at: '2026-07-31',
      participants: [{ entity_id: 'project-demo' }],
      evidence: [{ message_id: 'message-decision', timestamp: 1_775_000_100, excerpt: '决定周五演示' }]
    }, {
      id: 'delivery-project', event_type: 'delivery', title: '交付演示包', description: '升级版演示交付', status: 'candidate',
      participants: [], evidence: [{ message_id: 'message-delivery', timestamp: 1_775_000_200, excerpt: '交付升级版演示包' }]
    }],
    tasks: [{
      id: 'task-overdue', title: '准备演示', project: '演示项目', status: 'doing', priority: 'high', due: '2026-07-29',
      evidence: [{ messageId: 'message-task', timestamp: 1_775_000_300, excerpt: '准备演示' }]
    }, {
      id: 'task-waiting', title: '等待反馈', project: '升级版演示', status: 'waiting', taskKind: 'waiting', priority: 'medium'
    }, {
      id: 'task-done', title: '整理需求', project: '升级版演示', status: 'done', priority: 'medium'
    }],
    now: new Date('2026-07-30T12:00:00+08:00')
  })
  const [project] = projects
  assert.equal(project.name, '升级版演示')
  assert.equal(project.members[0].name, '负责人甲')
  assert.equal(project.progress, 33)
  assert.equal(project.phase, 'active')
  assert.ok(project.risks.some((risk: any) => risk.kind === 'overdue'))
  assert.ok(project.risks.some((risk: any) => risk.kind === 'waiting'))
  assert.equal(project.decisions[0].id, 'decision-project')
  assert.equal(project.milestones[0].id, 'delivery-project')
  assert.equal(project.evidence.length, 4)
})

test('task calendar handles leap months, Shanghai today, overdue and unscheduled work', () => {
  assert.equal(extractTaskDueDate('2028-02-29 18:00'), '2028-02-29')
  assert.equal(extractTaskDueDate('2027-02-29'), null)
  const calendar = buildTaskCalendar([{
    id: 'high', title: '高优先任务', due: '2028-02-29 18:00', priority: 'high', status: 'todo'
  }, {
    id: 'medium', title: '普通任务', due: '2028-02-29', priority: 'medium', status: 'todo'
  }, {
    id: 'overdue', title: '逾期任务', due: '2028-02-01', priority: 'low', status: 'todo'
  }, {
    id: 'done-overdue', title: '已完成旧任务', due: '2028-02-01', priority: 'high', status: 'done'
  }, {
    id: 'unscheduled', title: '未排期任务', due: '', priority: 'medium', status: 'todo'
  }], '2028-02', new Date('2028-02-29T04:00:00Z'))
  assert.equal(calendar.days.length, 42)
  assert.equal(calendar.days[0].date, '2028-01-31')
  const leapDay = calendar.days.find(day => day.date === '2028-02-29')!
  assert.equal(leapDay.isToday, true)
  assert.deepEqual(leapDay.tasks.map(task => task.id), ['high', 'medium'])
  assert.deepEqual(calendar.overdue.map(task => task.id), ['overdue'])
  assert.deepEqual(calendar.unscheduled.map(task => task.id), ['unscheduled'])
})

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
  const imported = store.registerImportedBackup(readFileSync(backup.path), JSON.stringify({ version: 3, tasks: [] }))
  assert.equal(imported.hasState, true)
  assert.equal(existsSync(`${imported.path}.state.json`), true)
  assert.ok(store.restoreBackup(imported.path).success)
}))

test('vector metadata is retained for unchanged content and invalidated after edits', () => withStore(store => {
  const model = 'test-embedding:2d'
  const task = {
    id: 'task-vector',
    title: '准备客户演示',
    detail: '整理产品介绍',
    priority: 'high',
    status: 'todo',
    classification: 'mine'
  }
  store.syncTasks([task])
  assert.equal(store.listEmbeddingCandidates(model).length, 1)
  store.saveEmbedding('task:task-vector', model, [1, 0])
  assert.deepEqual(store.getEmbeddingStats(model), { total: 1, indexed: 1, pending: 0, model })
  assert.equal(store.searchVector([0.9, 0.1], model)[0].source_id, 'task-vector')

  store.syncTasks([task])
  assert.equal(store.listEmbeddingCandidates(model).length, 0)
  store.syncTasks([{ ...task, detail: '整理产品介绍与报价材料' }])
  assert.equal(store.listEmbeddingCandidates(model).length, 1)
  assert.equal(store.getEmbeddingStats(model).pending, 1)
}))

test('memory scope filters apply entity, session, date and document type together', () => {
  const inRange = Math.floor(Date.parse('2026-07-28T12:00:00+08:00') / 1000)
  const items = [{
    id: 'relation-1',
    document_type: 'relation',
    source_id: 'relation-1',
    title: '服务对象',
    search_text: '邢爱妮 服务对象 Onyx Devs Lab',
    metadata: { subjectId: 'person-xing', objectId: 'org-onyx' },
    evidence: [{ session_id: 'session-onyx', timestamp: inRange }]
  }, {
    id: 'task-1',
    document_type: 'task',
    source_id: 'task-1',
    title: '准备 Onyx 演示',
    search_text: '准备 Onyx 演示',
    metadata: {},
    updated_at: '2026-07-29T10:00:00+08:00',
    evidence: [{ session_id: 'session-other', timestamp: inRange }]
  }, {
    id: 'entity-with-index-time-only',
    document_type: 'entity',
    source_id: 'entity-with-index-time-only',
    title: '仅有索引更新时间',
    search_text: '没有发生时间或原文证据',
    metadata: {},
    updated_at: '2026-07-29T10:00:00+08:00',
    evidence: []
  }]

  assert.deepEqual(filterMemorySearchResults(items, {
    entityId: 'org-onyx',
    entityTerms: ['Onyx Devs Lab', 'Onyx'],
    sessionId: 'session-onyx',
    from: '2026-07-28',
    to: '2026-07-28',
    documentTypes: ['relation']
  }).map(item => item.id), ['relation-1'])
  assert.deepEqual(filterMemorySearchResults(items, {
    entityId: 'org-onyx',
    entityTerms: ['Onyx']
  }).map(item => item.id), ['relation-1', 'task-1'])
  assert.deepEqual(filterMemorySearchResults(items, {
    sessionId: 'wxid-project-room',
    sessionName: 'session-other'
  }).map(item => item.id), ['task-1'])
  assert.equal(filterMemorySearchResults(items, { from: '2026-07-29' }).length, 0)
})

test('memory query planner infers Shanghai time, entity and intent scopes', () => {
  const entities = [{
    id: 'org-onyx',
    canonicalName: 'Onyx Devs Lab',
    aliases: ['Onyx'],
    accountIds: []
  }]
  const plan = buildMemoryQueryPlan(
    '过去三天 Onyx 有什么待办需要我回复？',
    entities,
    new Date('2026-07-30T02:00:00Z')
  )
  assert.equal(plan.inferredOptions.entityId, 'org-onyx')
  assert.deepEqual(plan.inferredOptions.documentTypes, ['task'])
  assert.equal(plan.inferredOptions.from, '2026-07-28')
  assert.equal(plan.inferredOptions.to, '2026-07-30')
  assert.ok(plan.queries.includes('Onyx Devs Lab'))
  assert.ok(plan.explanation.some(item => item.includes('2026-07-28')))
  const relationPlan = buildMemoryQueryPlan('Onyx 是我的客户吗？', entities, new Date('2026-07-30T02:00:00Z'))
  assert.deepEqual(relationPlan.inferredOptions.documentTypes, ['relation'])
  assert.deepEqual(relationPlan.inferredOptions.relationTypes, ['客户'])
})

test('manual memory review updates searchable status metadata', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'person-review', type: 'person', canonicalName: '审核对象', aliases: [], accountIds: [] }],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-review',
    subjectId: 'person-review',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.7,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '审核对象 所在城市 上海',
    evidence: evidence('message-review', '听说现在住在上海')
  }])
  store.updateMemoryItemStatus('claim', 'claim-review', 'confirmed')
  const result = store.searchText('审核对象').find(item => item.id === 'claim:claim-review')
  assert.ok(result)
  assert.equal(JSON.parse(result.metadata_json).status, 'confirmed')
}))

test('negative claims preserve polarity and attach contradiction evidence both ways', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'person-polarity', type: 'person', canonicalName: '极性测试', aliases: [], accountIds: [] }],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-positive',
    subjectId: 'person-polarity',
    predicate: '任职于',
    objectValue: '示例公司',
    polarity: 'positive',
    confidence: 0.95,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '极性测试 任职于 示例公司',
    evidence: evidence('message-positive', '我在示例公司工作')
  }])
  store.upsertClaims([{
    id: 'claim-negative',
    subjectId: 'person-polarity',
    predicate: '任职于',
    objectValue: '示例公司',
    polarity: 'negative',
    confidence: 0.95,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '极性测试 并非 任职于 示例公司',
    evidence: evidence('message-negative', '我不是示例公司的员工')
  }])

  const claims = store.getMemoryFeed().claims
  const positive = claims.find(item => item.id === 'claim-positive')
  const negative = claims.find(item => item.id === 'claim-negative')
  assert.equal(positive.status, 'candidate')
  assert.equal(negative.polarity, 'negative')
  assert.ok(positive.evidence.some((item: any) => item.message_id === 'message-negative' && item.evidence_role === 'contradiction'))
  assert.ok(negative.evidence.some((item: any) => item.message_id === 'message-positive' && item.evidence_role === 'contradiction'))
  const positiveSearch = store.searchText('极性测试').find(item => item.id === 'claim:claim-positive')
  const negativeSearch = store.searchText('极性测试').find(item => item.id === 'claim:claim-negative')
  assert.equal(JSON.parse(positiveSearch.metadata_json).status, 'candidate')
  assert.equal(JSON.parse(negativeSearch.metadata_json).polarity, 'negative')
}))

test('task intelligence deduplicates by evidence and explains actionable reminders', () => {
  const existing = [{
    id: 'task-existing',
    title: '确认交付时间',
    source: '项目群',
    sourceMessageIds: ['message-shared'],
    status: 'todo'
  }]
  assert.equal(findMatchingTask({
    id: 'task-new-id',
    title: '确认最终交付时间',
    source: '项目群',
    sourceMessageIds: ['message-shared']
  }, existing)?.id, 'task-existing')

  const reminders = buildTaskReminders([{
    id: 'dependency',
    title: '准备设计稿',
    status: 'todo'
  }, {
    id: 'overdue',
    title: '提交客户方案',
    status: 'waiting',
    taskKind: 'delegated',
    due: '2026-07-20',
    updatedAt: '2026-07-20T00:00:00+08:00',
    dependsOnIds: ['dependency']
  }], new Date('2026-07-30T04:00:00Z'))
  assert.deepEqual(new Set(reminders.map(item => item.kind)), new Set(['overdue', 'waiting_stale', 'blocked']))
  assert.ok(reminders.every(item => item.reason.length > 10))
})

test('reminder preferences mute kinds and temporarily snooze individual reminders', () => {
  const reminders = [
    { id: 'overdue:a', taskId: 'a', kind: 'overdue' as const, severity: 'high' as const, title: 'A', reason: 'late' },
    { id: 'blocked:b', taskId: 'b', kind: 'blocked' as const, severity: 'medium' as const, title: 'B', reason: 'blocked' },
    { id: 'due_soon:c', taskId: 'c', kind: 'due_soon' as const, severity: 'medium' as const, title: 'C', reason: 'soon' }
  ]
  const result = applyReminderPreferences(reminders, {
    mutedKinds: ['blocked'],
    snoozedUntil: { 'due_soon:c': '2026-08-01T00:00:00.000Z' },
    history: []
  }, new Date('2026-07-30T00:00:00.000Z'))
  assert.deepEqual(result.visible.map(item => item.id), ['overdue:a'])
  assert.equal(result.suppressed, 2)
})

test('task status changes are persisted as an auditable history', () => withStore(store => {
  const before = { id: 'task-history', status: 'todo', due: '2026-07-30', priority: 'medium' }
  const after = { ...before, status: 'waiting', due: '2026-08-02' }
  store.recordTaskChanges('task-history', before, after, 'manual_edit', [{ messageId: 'message-history' }])
  const history = store.listTaskHistory(['task-history'])
  assert.deepEqual(new Set(history.map(item => item.field)), new Set(['status', 'due']))
  assert.ok(history.every(item => item.reason === 'manual_edit'))
  assert.ok(history.every(item => JSON.parse(item.evidence_json)[0].messageId === 'message-history'))
}))

test('partial ingestion keeps completed checkpoints visible for safe resume', () => withStore(store => {
  store.startIngestionRun('run-resume', 'deepseek-test', 'prompt-test')
  store.recordIngestionBatch('run-resume', 0, 100, 'running')
  store.recordIngestionBatch('run-resume', 0, 100, 'completed', '', {
    model: 'deepseek-test',
    promptVersion: 'prompt-test',
    schemaVersion: 'schema-test',
    inputTokens: 1200,
    outputTokens: 300,
    durationMs: 2500
  })
  store.recordIngestionBatch('run-resume', 1, 80, 'running')
  store.recordIngestionBatch('run-resume', 1, 80, 'failed', '用户已安全暂停')
  store.finishIngestionRun('run-resume', {
    status: 'partial',
    messageCount: 100,
    entityCount: 2,
    relationCount: 1,
    error: '用户已安全暂停'
  })
  const status = store.getIngestionStatus()
  assert.equal(status.status, 'partial')
  assert.equal(status.message_count, 100)
  assert.equal(status.error, '用户已安全暂停')
  assert.deepEqual({ ...status.usage }, {
    input_tokens: 1200,
    output_tokens: 300,
    duration_ms: 2500,
    model: 'deepseek-test',
    prompt_version: 'prompt-test',
    schema_version: 'schema-test'
  })
  assert.deepEqual(Object.fromEntries(status.batches.map((item: any) => [item.status, item.count])), {
    completed: 1,
    failed: 1
  })
  const runs = store.listIngestionRuns()
  assert.equal(runs.length, 1)
  assert.equal(runs[0].batches[1].error, '用户已安全暂停')
  assert.deepEqual(runs[0].usage, { input_tokens: 1200, output_tokens: 300, duration_ms: 2500 })
  const summary = summarizeIngestionRuns(runs, { inputPerMillion: 1, outputPerMillion: 2 })
  assert.equal(summary.partialRuns, 1)
  assert.equal(summary.failedBatches, 1)
  assert.equal(summary.estimatedCost, 0.0018)
}))

test('entity insight strength is explainable and deduplicates shared evidence', () => {
  const insight = buildEntityInsights({
    entities: [{ id: 'person-a', canonicalName: '张三', aliases: ['老张'], accountIds: [] }],
    relations: [{
      subjectId: 'person-a',
      objectId: 'org-a',
      status: 'confirmed',
      confidence: 0.9,
      evidence: [{ messageId: 'message-shared', timestamp: 1_775_000_000 }]
    }],
    claims: [{
      subject_id: 'person-a',
      status: 'candidate',
      evidence: [{ message_id: 'message-shared', timestamp: 1_775_000_000 }]
    }],
    events: [{
      event_type: 'commitment',
      status: 'candidate',
      participants: [{ entity_id: 'person-a' }],
      evidence: [{ message_id: 'message-event', timestamp: 1_775_000_100 }]
    }],
    tasks: [{
      id: 'task-person',
      title: '等待老张回复',
      status: 'waiting',
      owner: '老张',
      evidence: [{ messageId: 'message-task', timestamp: 1_775_000_200 }]
    }],
    now: new Date(1_775_000_300_000)
  })['person-a']
  assert.equal(insight.evidenceCount, 3)
  assert.equal(insight.relationCount, 1)
  assert.equal(insight.openTaskCount, 1)
  assert.equal(insight.pendingCommitmentCount, 1)
  assert.equal(insight.strength, 62)
  assert.equal(insight.strengthLabel, '中')
  assert.ok(insight.explanation.some(item => item.includes('去重原文证据')))
})

test('anonymous task-assignment golden set meets the published quality baseline', () => {
  const report = evaluateTaskAssignmentPolicy()
  assert.equal(report.samples, TASK_ASSIGNMENT_GOLDEN_SAMPLES.length)
  assert.equal(report.exactAccuracy, 1)
  assert.equal(report.minePrecision, 1)
  assert.equal(report.mineRecall, 1)
  assert.deepEqual(report.failures, [])
  const delegated = classifyTaskAssignment({
    evidenceMessages: [{ direction: '我发送', content: '查一下几点更新' }],
    modelClassification: 'mine'
  })
  assert.equal(delegated.taskKind, 'delegated')
  assert.ok(delegated.rationale.includes('执行者是收件人'))
})

test('forget entity transaction removes graph, memory, search, task audit and assistant traces', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'person-forget',
      type: 'person',
      canonicalName: '隐私测试人',
      aliases: ['测试别名'],
      accountIds: ['wxid_forget']
    }, {
      id: 'org-keep',
      type: 'organization',
      canonicalName: '保留组织',
      aliases: [],
      accountIds: []
    }],
    relations: [{
      id: 'relation-forget',
      subjectId: 'person-forget',
      predicate: '任职于',
      objectId: 'org-keep',
      confidence: 0.8,
      status: 'candidate',
      evidence: evidence('message-relation-forget', '隐私测试人任职于保留组织')
    }],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-forget',
    subjectId: 'person-forget',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '隐私测试人 所在城市 上海',
    evidence: evidence('message-claim-forget', '隐私测试人住在上海')
  }])
  store.upsertEvents([{
    id: 'event-forget',
    eventType: 'meeting',
    title: '与隐私测试人开会',
    description: '',
    confidence: 0.8,
    status: 'candidate',
    searchText: '与隐私测试人开会',
    participants: [{ entityId: 'person-forget', role: '参与者' }],
    evidence: evidence('message-event-forget', '与隐私测试人开会')
  }])
  store.syncTasks([{
    id: 'task-forget',
    title: '回复隐私测试人',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }])
  store.recordTaskChanges('task-forget', {}, { status: 'todo', title: '回复隐私测试人' }, 'created')
  store.saveAssistantExchange('隐私测试人是谁', '隐私测试人住在上海', [])

  const preview = store.previewForgetEntity('person-forget')
  assert.deepEqual({
    claims: preview.claimIds.length,
    relations: preview.relationIds.length,
    events: preview.eventIds.length
  }, { claims: 1, relations: 1, events: 1 })
  const result = store.forgetEntity('person-forget', ['task-forget'])
  assert.equal(result.success, true)
  assert.equal(store.searchText('隐私测试人').length, 0)
  assert.equal(store.getMemoryFeed().claims.length, 0)
  assert.equal(store.getMemoryFeed().events.length, 0)
  assert.equal(store.listRelationHistory('person-forget').length, 0)
  assert.equal(store.listTaskHistory(['task-forget']).length, 0)
  assert.equal(store.getRecentAssistantExchanges().length, 0)
  assert.equal(store.getDiagnostics().integrity, 'ok')
  assert.ok(store.searchText('保留组织').some(item => item.id === 'entity:org-keep'))
}))
