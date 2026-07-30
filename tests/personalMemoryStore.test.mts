import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
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
  buildGraphIdentitySuggestions,
  buildNameBuckets,
  getFullIdentityScanSchedule,
  identityPairKey,
  isNegativeDecisionCurrent
} from '../electron/services/identityDisambiguation.ts'
import { editDistance, entityPinyinTerms, fuzzyEntityScore, pinyinEntityScore } from '../electron/services/fuzzyEntitySearch.ts'
import { buildWeeklyBriefing, isQuietTime } from '../electron/services/briefingIntelligence.ts'
import { enqueueUniqueNotification, markNotificationAttempt } from '../electron/services/notificationOutbox.ts'
import { findCommonGraphNeighbors } from '../electron/services/graphCommonNeighbors.ts'
import { buildProjectInsights } from '../electron/services/projectInsights.ts'
import { buildTaskCalendar, extractTaskDueDate } from '../src/utils/taskCalendar.ts'
import { summarizeIngestionRuns } from '../electron/services/ingestionDiagnostics.ts'
import { attachLocalImageOcr, attachLocalVoiceTranscript, recoverMessageSemantics } from '../electron/services/messageSemanticRecovery.ts'
import { sanitizeDiagnosticText } from '../electron/services/diagnosticRedaction.ts'

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

test('identity disambiguation recalls multi-account candidates from graph and local vectors', () => withStore(store => {
  const entities = [
    { id: 'person-a', type: 'person', canonicalName: '开发者甲' },
    { id: 'person-b', type: 'person', canonicalName: '产品经理乙' },
    { id: 'person-c', type: 'person', canonicalName: '无关人物' },
    { id: 'org-1', type: 'organization', canonicalName: '组织一' },
    { id: 'project-1', type: 'project', canonicalName: '项目一' }
  ]
  const relations = [
    { subjectId: 'person-a', objectId: 'org-1', status: 'confirmed' },
    { subjectId: 'person-a', objectId: 'project-1', status: 'confirmed' },
    { subjectId: 'person-b', objectId: 'org-1', status: 'confirmed' },
    { subjectId: 'person-b', objectId: 'project-1', status: 'candidate' }
  ]
  const graph = buildGraphIdentitySuggestions(entities, relations)
  assert.equal(graph.length, 1)
  assert.equal(graph[0].source, 'graph_neighbors')
  assert.equal(graph[0].value, '2 个')

  store.syncGraph({ entities, relations: [], reviewQueue: [] })
  store.saveEmbedding('entity:person-a', 'identity-test', [1, 0])
  store.saveEmbedding('entity:person-b', 'identity-test', [0.9, Math.sqrt(0.19)])
  store.saveEmbedding('entity:person-c', 'identity-test', [0, 1])
  const vectorPairs = store.listSimilarEntityPairs('identity-test', 0.88)
  assert.deepEqual(vectorPairs.map(pair => [pair.leftId, pair.rightId]), [['person-a', 'person-b']])
  assert.ok(vectorPairs[0].score >= 0.9)
}))

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
  const homophone = store.searchText('邢爱泥')
  assert.equal(homophone[0].source_id, 'person-search')
  assert.equal(homophone[0].match_reason, 'pinyin_entity')
  const fuzzy = store.searchText('邢爱娃')
  assert.equal(fuzzy[0].source_id, 'person-search')
  assert.equal(fuzzy[0].match_reason, 'fuzzy_entity')
  assert.equal(editDistance('邢爱妮', '邢爱娃'), 1)
  assert.ok(fuzzyEntityScore('wxid-onyx-contact', ['wxid_onyx_contact']) !== null)
  assert.equal(fuzzyEntityScore('完全无关', ['邢爱妮']), null)
  assert.deepEqual(entityPinyinTerms('邢爱妮'), ['xingaini', 'xan'])
  assert.equal(pinyinEntityScore('xingaini', ['邢爱妮']), 0)
  assert.equal(pinyinEntityScore('xan', ['邢爱妮']), 0)
  const pinyinResult = store.searchText('xan')
  assert.equal(pinyinResult[0].source_id, 'person-search')
  assert.equal(pinyinResult[0].match_reason, 'pinyin_entity')
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

test('message semantic recovery preserves quoted authorship and card media types', () => {
  const reply = recoverMessageSemantics({
    localType: 49,
    content: '这个我晚点回复',
    replyToMessageId: 'message-original',
    quote: { sender: '客户甲', content: '你来确认交付时间', platformMessageId: 'message-original' }
  })
  assert.equal(reply.semanticType, 'quote')
  assert.equal(reply.replyToMessageId, 'message-original')
  assert.equal(reply.quotedSender, '客户甲')
  assert.match(reply.content, /这个我晚点回复 \[引用上下文｜客户甲：你来确认交付时间\]/)
  assert.equal(recoverMessageSemantics({ localType: 49, content: '[聊天记录] 项目讨论' }).semanticType, 'forward')
  assert.equal(recoverMessageSemantics({ localType: 49, content: '[小程序] 日程助手' }).semanticType, 'miniapp')
  assert.equal(recoverMessageSemantics({ localType: 47, content: '[表情]' }).semanticType, 'emoji')
  assert.equal(attachLocalVoiceTranscript('[语音]', '明天下午三点开会'), '[语音·本地转写] 明天下午三点开会')
  assert.equal(attachLocalVoiceTranscript('[语音]', ''), '[语音]')
  assert.equal(attachLocalImageOcr('[图片]', '报价有效期三天'), '[图片·本地OCR] 报价有效期三天')
})

test('diagnostic errors redact local identifiers, credentials and home paths', () => {
  const sanitized = sanitizeDiagnosticText(
    'Bearer secret-token sk-testsecret123456 wxid_private123 /Users/mimimi/data user@example.com?token=abcdef'
  )
  assert.doesNotMatch(sanitized, /secret-token|sk-testsecret|wxid_private|\/Users\/mimimi|user@example\.com|token=abcdef/)
  assert.match(sanitized, /Bearer \[已隐藏\]/)
  assert.match(sanitized, /\/Users\/\[本机用户\]/)
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
    durationMs: 2500,
    sensitiveRedaction: { level: 'standard', total: 2, counts: { 手机号: 1, 邮箱: 1 } }
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
  assert.deepEqual(runs[0].batches[0].sensitiveRedaction, {
    level: 'standard', total: 2, counts: { 手机号: 1, 邮箱: 1 }
  })
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

test('message resources remain idempotent, searchable and traceable to original evidence', () => withStore(store => {
  const resource = {
    id: 'resource-link-1',
    resourceType: 'link',
    title: '项目验收说明',
    url: 'https://example.com/acceptance',
    content: '报价有效期三天，周五前完成验收。',
    metadata: {
      sessionId: 'session-1',
      sessionName: '项目推进群',
      senderName: '老张',
      appMsgKind: 'link'
    },
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    evidence: [{
      messageId: 'message-resource-1',
      sessionId: 'session-1',
      timestamp: 1_775_000_000,
      sender: '老张',
      excerpt: '项目验收说明，报价有效期三天'
    }]
  }
  store.upsertResources([resource])
  store.upsertResources([{ ...resource, content: `${resource.content} 请查看链接。`, updatedAt: '2026-07-30T02:00:00.000Z' }])

  const feed = store.getMemoryFeed()
  assert.equal(feed.resources.length, 1)
  assert.equal(feed.resources[0].content.includes('请查看链接'), true)
  assert.equal(feed.resources[0].evidence[0].message_id, 'message-resource-1')
  assert.equal(store.getMemoryStats().resources, 1)
  const results = store.searchText('报价有效期')
  assert.ok(results.some(item => item.id === 'resource:resource-link-1'))
  assert.equal(store.getDocumentEvidence('resource', 'resource-link-1')[0].sender, '老张')
  const deleted = store.deleteResource('resource-link-1')
  assert.equal(deleted.success, true)
  assert.equal(deleted.suppressed, true)
  assert.equal(store.getMemoryFeed().resources.length, 0)
  assert.equal(store.searchText('报价有效期').some(item => item.id === 'resource:resource-link-1'), false)
  assert.deepEqual(store.getDocumentEvidence('resource', 'resource-link-1'), [])
  store.upsertResources([resource])
  assert.equal(store.getMemoryStats().resources, 0)
  assert.equal(store.listResourceTrash()[0].title, '项目验收说明')
  assert.equal(store.restoreResource('resource-link-1').success, true)
  assert.equal(store.getMemoryStats().resources, 1)
  assert.ok(store.searchText('报价有效期').some(item => item.id === 'resource:resource-link-1'))
  assert.equal(store.getDocumentEvidence('resource', 'resource-link-1')[0].message_id, 'message-resource-1')
  assert.deepEqual(store.listResourceTrash(), [])
  store.deleteResource('resource-link-1')
  assert.equal(store.purgeResourceTrash('resource-link-1').purged, 1)
  assert.equal(store.restoreResource('resource-link-1').success, false)
  store.upsertResources([resource])
  assert.equal(store.getMemoryStats().resources, 0)
}))

test('resource trash retention is opt-in and expires snapshots without lifting suppressions', () => withStore(store => {
  const resource = {
    id: 'resource-retention',
    resourceType: 'file',
    title: '临时附件',
    content: '等待删除',
    metadata: {},
    evidence: []
  }
  store.upsertResources([resource])
  store.deleteResource(resource.id)
  assert.equal(store.purgeExpiredResourceTrash(0).purged, 0)
  assert.equal(store.listResourceTrash().length, 1)
  const future = new Date(Date.now() + 8 * 86_400_000)
  assert.equal(store.purgeExpiredResourceTrash(7, future).purged, 1)
  assert.equal(store.restoreResource(resource.id).success, false)
  store.upsertResources([resource])
  assert.equal(store.getMemoryStats().resources, 0)
}))

test('long scanned PDF resources resume by persisted page cursor and invalidate stale vectors', () => withStore(store => {
  store.upsertResources([{
    id: 'resource-pdf-resume',
    resourceType: 'file',
    title: '扫描合同.pdf',
    fileName: '扫描合同.pdf',
    fileExt: '.pdf',
    content: '[第 1 页] 合同首页',
    metadata: {
      attachmentFormat: '.pdf-ocr',
      attachmentLocalPath: '/tmp/scanned-contract.pdf',
      attachmentPdfOcrPages: 3,
      attachmentPdfTotalPages: 9,
      attachmentPdfOcrTruncated: true,
      attachmentPdfOcrNextPage: 4
    },
    evidence: [{
      messageId: 'message-pdf-resume',
      sessionId: 'session-pdf',
      timestamp: 1_775_000_000,
      sender: '项目群',
      excerpt: '扫描合同.pdf'
    }]
  }])
  const pending = store.listPendingPdfOcrResources(1)
  assert.equal(pending[0].metadata.attachmentPdfOcrNextPage, 4)
  store.saveEmbedding('resource:resource-pdf-resume', 'test-vector', [1, 0])
  assert.equal(store.getEmbeddingStats('test-vector').pending, 0)
  store.appendResourceContent('resource-pdf-resume', '[第 4 页] 付款条件为验收后七日内', {
    attachmentPdfOcrPages: 6,
    attachmentPdfOcrNextPage: 7,
    attachmentPdfOcrTruncated: true
  })
  assert.ok(store.searchText('付款条件').some(item => item.id === 'resource:resource-pdf-resume'))
  assert.equal(store.getDocumentEvidence('resource', 'resource-pdf-resume')[0].message_id, 'message-pdf-resume')
  assert.equal(store.getEmbeddingStats('test-vector').pending, 1)
  assert.equal(store.listPendingPdfOcrResources(1)[0].metadata.attachmentPdfOcrNextPage, 7)
}))

test('Office and PDF attachment structure migration is resumable, deferred and invalidates stale vectors', () => withStore(store => {
  const parserVersion = 'attachment-layout-v3'
  store.upsertResources([{
    id: 'resource-doc-migrate',
    resourceType: 'file',
    title: '历史项目计划.docx',
    fileName: '历史项目计划.docx',
    fileExt: '.docx',
    content: '旧正文',
    metadata: {
      attachmentFormat: '.docx',
      attachmentLocalPath: '/tmp/history-plan.docx'
    },
    evidence: []
  }])
  assert.equal(store.getAttachmentStructureMigrationStats(parserVersion).pending, 1)
  assert.equal(store.listPendingAttachmentStructureResources(parserVersion, 1)[0].id, 'resource-doc-migrate')
  store.saveEmbedding('resource:resource-doc-migrate', 'test-vector', [1, 0])
  store.replaceResourceContent('resource-doc-migrate', '新版结构正文', {
    attachmentStructure: {
      kind: 'document',
      paragraphCount: 2,
      headingCount: 1,
      listItemCount: 0,
      tableCount: 0,
      headerFooterCount: 0,
      truncated: false,
      headings: [{ level: 1, text: '项目计划' }],
      tables: []
    },
    attachmentStructureParserVersion: parserVersion,
    attachmentStructureMigrationStatus: 'completed'
  })
  assert.equal(store.listPendingAttachmentStructureResources(parserVersion, 1).length, 0)
  assert.equal(store.getAttachmentStructureMigrationStats(parserVersion).completed, 1)
  assert.ok(store.searchText('新版结构正文').some(item => item.id === 'resource:resource-doc-migrate'))
  assert.equal(store.getEmbeddingStats('test-vector').pending, 1)
  store.upsertResources([{
    id: 'resource-doc-migrate',
    resourceType: 'file',
    title: '历史项目计划.docx',
    fileExt: '.docx',
    content: '新版结构正文',
    metadata: { attachmentFormat: '.docx', attachmentLocalPath: '/tmp/history-plan.docx' },
    evidence: []
  }])
  assert.equal(store.getMemoryFeed().resources.find(item => item.id === 'resource-doc-migrate')?.metadata?.attachmentStructure?.kind, 'document')
  assert.equal(store.getAttachmentStructureMigrationStats(parserVersion).completed, 1)

  store.upsertResources([{
    id: 'resource-pdf-layout-migrate',
    resourceType: 'file',
    title: '历史双栏报告.pdf',
    fileExt: '.pdf',
    content: '旧 PDF 正文',
    metadata: {
      attachmentFormat: '.pdf',
      attachmentLocalPath: '/tmp/history-report.pdf'
    },
    evidence: []
  }])
  assert.equal(store.listPendingAttachmentStructureResources(parserVersion, 10)
    .some(item => item.id === 'resource-pdf-layout-migrate'), true)
  store.replaceResourceContent('resource-pdf-layout-migrate', '新版 PDF 阅读顺序', {
    attachmentStructure: {
      kind: 'pdf',
      pageCount: 1,
      indexedPageCount: 1,
      blockCount: 4,
      multiColumnPageCount: 1,
      readingOrder: 'bbox-layout',
      truncated: false,
      pages: [{ number: 1, width: 612, height: 792, columnCount: 2, columnConfidence: 0.8, blockCount: 4 }]
    },
    attachmentStructureParserVersion: parserVersion,
    attachmentStructureMigrationStatus: 'completed'
  })
  assert.equal(store.getAttachmentStructureMigrationStats(parserVersion).completed, 2)

  store.upsertResources([{
    id: 'resource-ppt-deferred',
    resourceType: 'file',
    title: '旧汇报.pptx',
    fileExt: '.pptx',
    content: '等待迁移',
    metadata: {
      attachmentFormat: '.pptx',
      attachmentLocalPath: '/tmp/missing-deck.pptx',
      attachmentStructureMigrationNextAt: '2099-01-01T00:00:00.000Z'
    },
    evidence: []
  }])
  assert.equal(store.getAttachmentStructureMigrationStats(parserVersion).deferred, 1)
  assert.equal(store.listPendingAttachmentStructureResources(parserVersion, 10).length, 0)
}))

test('historical image semantics resume by model version and invalidate stale vectors', () => withStore(store => {
  const modelVersion = 'apple-vision-classify-v1'
  store.upsertResources([{
    id: 'resource-image-vision',
    resourceType: 'image',
    title: '历史图片',
    content: '图片消息',
    metadata: {
      mediaLocalPath: '/tmp/history-image.png',
      ocrSource: 'tesseract-local'
    },
    evidence: []
  }])
  assert.equal(store.getImageSemanticMigrationStats(modelVersion).pending, 1)
  assert.equal(store.listPendingImageSemanticResources(modelVersion, 1)[0].id, 'resource-image-vision')
  store.saveEmbedding('resource:resource-image-vision', 'test-vector', [1, 0])
  store.replaceResourceContent(
    'resource-image-vision',
    '图片消息\n[图片视觉·Apple Vision 本地候选｜未经人工确认] 可能包含：文档 81%',
    {
      visualSource: 'apple-vision-local',
      visualLabels: [{ identifier: 'document', displayName: '文档', confidence: 0.81 }],
      visualModelVersion: modelVersion,
      visualMigrationStatus: 'completed'
    }
  )
  assert.equal(store.getImageSemanticMigrationStats(modelVersion).completed, 1)
  assert.equal(store.listPendingImageSemanticResources(modelVersion, 1).length, 0)
  assert.ok(store.searchText('Apple Vision').some(item => item.id === 'resource:resource-image-vision'))
  assert.equal(store.getEmbeddingStats('test-vector').pending, 1)
}))

test('permanent structured-memory deletion is audited and suppresses identical re-extraction', () => withStore(store => {
  const entities = [
    { id: 'person-delete', type: 'person', canonicalName: '待删除人物', aliases: [], accountIds: [] },
    { id: 'org-delete', type: 'organization', canonicalName: '待删除组织', aliases: [], accountIds: [] }
  ]
  const relation = {
    id: 'relation-delete', subjectId: 'person-delete', predicate: '任职于', objectId: 'org-delete',
    confidence: 0.91, status: 'candidate',
    evidence: evidence('message-relation-delete', '待删除人物任职于待删除组织')
  }
  const claim = {
    id: 'claim-delete', subjectId: 'person-delete', predicate: '所在城市', objectValue: '敏感城市原文',
    confidence: 0.92, status: 'candidate', sourceNature: 'self_statement',
    searchText: '待删除人物 所在城市 敏感城市原文',
    evidence: evidence('message-claim-delete', '我住在敏感城市原文')
  }
  const event = {
    id: 'event-delete', eventType: 'meeting', title: '敏感会议原文', description: '不可保留的事件正文',
    confidence: 0.9, status: 'candidate', searchText: '敏感会议原文 不可保留的事件正文',
    participants: [{ entityId: 'person-delete', role: '参与者' }],
    evidence: evidence('message-event-delete', '明天召开敏感会议原文')
  }
  const review = {
    id: 'review_rel_relation-delete', kind: 'relation', relationId: relation.id, title: '关系候选',
    detail: '', confidence: 0.91, status: 'pending'
  }
  store.syncGraph({ entities, relations: [relation], reviewQueue: [review] })
  store.upsertClaims([claim])
  store.upsertEvents([event])
  store.saveEmbedding(`claim:${claim.id}`, 'test-vector', [1, 0])
  store.saveEmbedding(`event:${event.id}`, 'test-vector', [0, 1])
  store.saveEmbedding(`relation:${relation.id}`, 'test-vector', [0.5, 0.5])
  store.saveAssistantExchange('敏感问题', '敏感答案', [{
    documentId: `claim:${claim.id}`, type: 'claim', sourceId: claim.id,
    title: claim.predicate, content: claim.searchText, evidence: claim.evidence
  }])

  assert.deepEqual(store.previewDeleteMemoryItem('claim', claim.id)?.counts, {
    evidence: 1, related: 0, searchDocuments: 1, assistantMessages: 1
  })
  assert.equal(store.deleteMemoryItem('claim', claim.id).suppressed, true)
  assert.equal(store.deleteMemoryItem('event', event.id).suppressed, true)
  assert.equal(store.deleteMemoryItem('relation', relation.id).suppressed, true)
  assert.equal(store.getMemoryFeed().claims.length, 0)
  assert.equal(store.getMemoryFeed().events.length, 0)
  assert.equal(store.searchText('敏感').length, 0)
  assert.equal(store.getRecentAssistantExchanges().length, 0)
  assert.equal(store.getEmbeddingStats('test-vector').indexed, 0)

  store.syncGraph({ entities, relations: [relation], reviewQueue: [review] })
  store.upsertClaims([claim])
  store.upsertEvents([event])
  store.syncGraph({ entities, relations: [{ ...relation, id: 'relation-rephrased' }], reviewQueue: [] })
  store.upsertClaims([{ ...claim, id: 'claim-rephrased', objectValue: '换一种模型措辞' }])
  store.upsertEvents([{ ...event, id: 'event-rephrased', title: '换一种会议措辞' }])
  assert.equal(store.getMemoryFeed().claims.length, 0)
  assert.equal(store.getMemoryFeed().events.length, 0)
  assert.equal(store.searchText('任职于').some(item => item.id === `relation:${relation.id}`), false)
  assert.equal(store.listRelationHistory('person-delete').length, 0)

  const audit = store.listMemoryDeletionAudit()
  assert.equal(audit.length, 3)
  assert.equal(audit.every(item => /^[a-f0-9]{20}$/.test(item.item_fingerprint)), true)
  assert.equal(JSON.stringify(audit).includes('敏感'), false)
  assert.equal(store.getDiagnostics().integrity, 'ok')
}))

test('personal memory migrates atomically to SQLCipher and keeps encrypted backups restorable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-cipher-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const plaintext = new PersonalMemoryStore()
  const encrypted = new PersonalMemoryStore()
  try {
    plaintext.initialize(databasePath)
    plaintext.syncGraph({
      entities: [{ id: 'cipher-person', type: 'person', canonicalName: '加密测试人物', aliases: [], accountIds: [] }],
      relations: [],
      reviewQueue: []
    })
    const legacyPlaintextBackup = plaintext.createBackup()
    const legacyBundleDatabaseBytes = readFileSync(legacyPlaintextBackup.path)
    plaintext.close()
    assert.equal(readFileSync(databasePath).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')
    assert.equal(readFileSync(legacyPlaintextBackup.path).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')

    encrypted.initialize(databasePath, key)
    const diagnostics = encrypted.getDiagnostics()
    assert.equal(diagnostics.integrity, 'ok')
    assert.deepEqual(diagnostics.encryption, {
      enabled: true,
      cipher: 'sqlcipher',
      plaintextHeader: false,
      migratedThisStart: true
    })
    assert.match(encrypted.getEncryptionMetadata().keyFingerprint, /^[a-f0-9]{24}$/)
    assert.ok(encrypted.searchText('加密测试人物').some(item => item.id === 'entity:cipher-person'))
    assert.notEqual(readFileSync(databasePath).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')
    assert.equal(existsSync(`${databasePath}.plaintext-migration-backup`), false)
    assert.equal(existsSync(`${databasePath}.encrypting`), false)
    assert.equal(existsSync(`${databasePath}.encrypting-wal`), false)
    assert.equal(existsSync(`${databasePath}.encrypting-shm`), false)
    assert.notEqual(readFileSync(legacyPlaintextBackup.path).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')
    const importedLegacy = encrypted.registerImportedBackup(legacyBundleDatabaseBytes, JSON.stringify({ version: 3 }))
    assert.notEqual(readFileSync(importedLegacy.path).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')

    const backup = encrypted.createBackup()
    assert.notEqual(readFileSync(backup.path).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')
    encrypted.upsertClaims([{
      id: 'cipher-temporary-claim',
      subjectId: 'cipher-person',
      predicate: '临时字段',
      objectValue: '恢复时应消失',
      confidence: 1,
      status: 'confirmed',
      sourceNature: 'human_confirmation',
      searchText: '恢复时应消失',
      evidence: []
    }])
    assert.equal(encrypted.getMemoryFeed().claims.length, 1)
    encrypted.restoreBackup(backup.path)
    assert.equal(encrypted.getMemoryFeed().claims.length, 0)
    encrypted.close()

    const wrongKeyStore = new PersonalMemoryStore()
    assert.throws(() => wrongKeyStore.initialize(databasePath, randomBytes(32)))
    wrongKeyStore.close()
    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath, key)
    assert.equal(reopened.getDiagnostics().encryption.migratedThisStart, false)
    assert.ok(reopened.searchText('加密测试人物').length)
    reopened.close()
  } finally {
    plaintext.close()
    encrypted.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('portable import rekeys a foreign SQLCipher database for the current device', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-portable-rekey-test-'))
  const sourcePath = join(directory, 'source-device', 'memory.sqlite')
  const targetPath = join(directory, 'target-device', 'memory.sqlite')
  const sourceKey = randomBytes(32)
  const targetKey = randomBytes(32)
  const source = new PersonalMemoryStore()
  const target = new PersonalMemoryStore()
  try {
    source.initialize(sourcePath, sourceKey)
    source.syncGraph({
      entities: [{ id: 'portable-person', type: 'person', canonicalName: '跨设备人物', aliases: [], accountIds: [] }],
      relations: [],
      reviewQueue: []
    })
    const sourceBackup = source.createBackup()
    const sourceBytes = readFileSync(sourceBackup.path)

    target.initialize(targetPath, targetKey)
    const imported = target.registerImportedBackup(sourceBytes, JSON.stringify({ version: 3 }), sourceKey)
    assert.notEqual(readFileSync(imported.path).subarray(0, 16).toString('utf8'), 'SQLite format 3\0')
    target.restoreBackup(imported.path)
    assert.ok(target.searchText('跨设备人物').some(item => item.id === 'entity:portable-person'))

    const wrongDevice = new PersonalMemoryStore()
    assert.throws(() => wrongDevice.initialize(imported.path, sourceKey))
    wrongDevice.close()
  } finally {
    source.close()
    target.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('data source registry persists enablement, capability and independent run health', () => withStore(store => {
  store.registerDataSources([
    {
      id: 'wechat', kind: 'chat', displayName: '微信', description: '本机微信',
      available: true, localOnly: true, capabilities: ['incremental', 'original-evidence']
    },
    {
      id: 'calendar', kind: 'calendar', displayName: '日历', description: '待接入',
      available: false, localOnly: false, capabilities: ['incremental', 'events']
    }
  ])
  assert.equal(store.listDataSources().find(item => item.id === 'wechat')?.enabled, true)
  assert.throws(() => store.setDataSourceEnabled('calendar', true), /尚未安装/)

  store.setDataSourceEnabled('wechat', false)
  store.updateDataSourceRun('wechat', {
    status: 'healthy',
    checkpoint: 'cursor-42',
    attemptedAt: '2026-07-30T00:00:00.000Z',
    succeededAt: '2026-07-30T00:00:01.000Z'
  })
  const source = store.listDataSources().find(item => item.id === 'wechat')
  assert.equal(source.enabled, false)
  assert.equal(source.checkpoint, 'cursor-42')
  assert.equal(source.status, 'healthy')
  assert.deepEqual(source.capabilities, ['incremental', 'original-evidence'])

  store.updateDataSourceRun('wechat', { status: 'running', attemptedAt: '2026-07-30T00:01:00.000Z' })
  store.registerDataSources([
    {
      id: 'wechat', kind: 'chat', displayName: '微信', description: '本机微信',
      available: true, localOnly: true, capabilities: ['incremental', 'original-evidence']
    }
  ])
  const recovered = store.listDataSources().find(item => item.id === 'wechat')
  assert.equal(recovered.status, 'error')
  assert.equal(recovered.checkpoint, 'cursor-42')
  assert.match(recovered.lastError, /原 checkpoint 重试/)
  store.setDataSourceAvailability('wechat', true)
  const availabilityRefreshed = store.listDataSources().find(item => item.id === 'wechat')
  assert.equal(availabilityRefreshed.status, 'error')
  assert.match(availabilityRefreshed.lastError, /原 checkpoint 重试/)

  const configured = store.configureDataSource('calendar', { calendarIds: ['work'] }, true)
  assert.equal(configured.available, true)
  assert.equal(configured.enabled, true)
  assert.deepEqual(configured.config, { calendarIds: ['work'] })
  assert.equal(configured.checkpoint, '')
}))

test('document structured analysis has an independent content-version checkpoint and retry window', () => withStore(store => {
  const now = new Date('2026-07-30T00:00:00.000Z')
  store.upsertResources([{
    id: 'local-document:analysis-test',
    resourceType: 'document',
    title: '项目方案.md',
    fileName: '项目方案.md',
    fileExt: '.md',
    content: '负责人：李金石',
    metadata: {
      sourceId: 'documents',
      contentHash: 'hash-v1',
      scopeName: '测试目录'
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    evidence: [{
      messageId: 'doc-evidence-v1',
      sessionId: 'data-source:documents',
      timestamp: Math.floor(now.getTime() / 1000),
      sender: '本机文档连接器',
      excerpt: '负责人：李金石'
    }]
  }])
  assert.deepEqual(store.getDocumentAnalysisStats('document-analysis-v1', now), {
    total: 1, completed: 0, pending: 1, deferred: 0, failed: 0
  })
  const pending = store.listPendingDocumentAnalysis('document-analysis-v1', 2, now)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].evidence[0].message_id, 'doc-evidence-v1')

  store.replaceResourceContent('local-document:analysis-test', '负责人：李金石', {
    documentAnalysisStatus: 'completed',
    documentAnalysisVersion: 'document-analysis-v1',
    documentAnalysisContentHash: 'hash-v1'
  })
  assert.equal(store.getDocumentAnalysisStats('document-analysis-v1', now).completed, 1)

  store.replaceResourceContent('local-document:analysis-test', '负责人：李金石', {
    contentHash: 'hash-v2',
    documentAnalysisStatus: 'failed',
    documentAnalysisNextAt: '2026-08-01T00:00:00.000Z'
  })
  assert.deepEqual(store.getDocumentAnalysisStats('document-analysis-v1', now), {
    total: 1, completed: 0, pending: 0, deferred: 1, failed: 1
  })
  assert.equal(store.listPendingDocumentAnalysis('document-analysis-v1', 2, now).length, 0)
}))
