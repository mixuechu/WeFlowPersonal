import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { PersonalMemoryStore } from '../electron/services/personalMemoryStore.ts'
import { filterMemorySearchResults, paginateMemoryResults } from '../electron/services/memorySearchFilters.ts'
import { buildContextualMemoryQuestion, buildMemoryQueryPlan } from '../electron/services/memoryQueryPlanner.ts'
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
import { groundBriefingDigest } from '../electron/services/briefingEvidencePolicy.ts'
import {
  structuredEvidenceKey,
  validateStructuredDigestEvidence
} from '../electron/services/structuredEvidencePolicy.ts'
import { planExtractedEntityResolution } from '../electron/services/entityResolutionPolicy.ts'
import {
  buildEntitySummaryCandidate,
  canApplyEntitySummaryCandidate,
  planEntitySummaryConfirmation
} from '../electron/services/entitySummaryPolicy.ts'
import {
  buildEntityAliasCandidates,
  canApplyEntityAliasCandidate,
  planEntityAliasConfirmation
} from '../electron/services/entityAliasPolicy.ts'
import {
  buildEntityCreationReview,
  buildLegacyEntityReview,
  canConfirmEntityCreation,
  inferLegacyEntityTrustStatus,
  isTrustedEntity,
  planEntityCreationConfirmation
} from '../electron/services/entityTrustPolicy.ts'
import { planEntityMerge } from '../electron/services/entityMergeDirection.ts'
import {
  applyRelationConfirmation,
  planRelationConfirmation,
  relationSemanticId
} from '../electron/services/relationCorrectionPolicy.ts'
import { enqueueUniqueNotification, markNotificationAttempt } from '../electron/services/notificationOutbox.ts'
import { GRAPH_QUERY_EVIDENCE_LIMIT, findCommonGraphNeighbors } from '../electron/services/graphCommonNeighbors.ts'
import { buildProjectDirectory, buildProjectInsight, buildProjectInsights } from '../electron/services/projectInsights.ts'
import { MEMORY_CARD_EVIDENCE_LIMIT, PROJECT_EVIDENCE_LIMIT } from '../shared/evidencePayload.ts'
import {
  buildTaskDirectoryItem,
  buildTaskDossier,
  TASK_HISTORY_LIMIT
} from '../shared/taskPayload.ts'
import { buildCursorStatusPayload, CURSOR_STATUS_PAYLOAD_VERSION } from '../shared/cursorPayload.ts'
import {
  BRIEFING_RETENTION_DAYS,
  compactBriefings
} from '../shared/briefingRetention.ts'
import { compactGraphReviewWorkset } from '../shared/graphReviewStorage.ts'
import { buildTaskCalendar, extractTaskDueDate } from '../src/utils/taskCalendar.ts'
import { filterGraphReviews, paginateGraphReviews } from '../src/utils/graphReviewFilters.ts'
import { summarizeIngestionRuns } from '../electron/services/ingestionDiagnostics.ts'
import { attachLocalImageOcr, attachLocalVoiceTranscript, recoverMessageSemantics } from '../electron/services/messageSemanticRecovery.ts'
import { sanitizeDiagnosticText } from '../electron/services/diagnosticRedaction.ts'
import { computeAnnSignatures, listMultiProbeSignatures } from '../electron/services/localAnnIndex.ts'
import {
  buildExtractionContextAudit,
  EXTRACTION_CONTEXT_AUDIT_VERSION,
  EXTRACTION_MEMORY_CONTEXT_VERSION,
  selectTrustedExtractionEntities
} from '../electron/services/extractionMemoryContext.ts'

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

test('derived briefings stay bounded without duplicating durable task evidence', () => {
  const briefings: Record<string, any> = {}
  for (let day = 1; day <= 365; day += 1) {
    const date = `2025-${String(Math.floor((day - 1) / 31) + 1).padStart(2, '0')}-${String(((day - 1) % 31) + 1).padStart(2, '0')}`
    briefings[date] = {
      date,
      headline: `简报 ${day}`,
      summary: `第 ${day} 天`,
      messageCount: day,
      tasks: Array.from({ length: 100 }, (_, index) => ({
        id: `task-${day}-${index}`,
        evidence: [{ excerpt: `不应留在简报中的长原文-${day}-${index}-${'x'.repeat(500)}` }]
      }))
    }
  }

  const originalBytes = Buffer.byteLength(JSON.stringify(briefings))
  const compacted = compactBriefings(briefings)
  const dates = Object.keys(compacted.briefings).sort().reverse()

  assert.equal(dates.length, BRIEFING_RETENTION_DAYS)
  assert.equal(compacted.removedDays, 365 - BRIEFING_RETENTION_DAYS)
  assert.equal(compacted.strippedTaskSnapshots, 365)
  assert.equal(compacted.strippedTaskCount, 36_500)
  assert.equal(dates[0], '2025-12-24')
  assert.ok(Object.values(compacted.briefings).every(item => !Object.prototype.hasOwnProperty.call(item, 'tasks')))
  assert.ok(!JSON.stringify(compacted.briefings).includes('不应留在简报中的长原文'))
  assert.ok(Buffer.byteLength(JSON.stringify(compacted.briefings)) < originalBytes / 100)
  assert.equal(
    buildWeeklyBriefing(compacted.briefings, [], new Date('2025-12-24T12:00:00+08:00')).daysWithUpdates,
    7
  )
})

test('entity merge direction must explicitly preserve one candidate', () => {
  const entities = [
    { id: 'left', type: 'person', canonicalName: '左边身份' },
    { id: 'right', type: 'person', canonicalName: '右边身份' }
  ]
  assert.throws(
    () => planEntityMerge({ leftEntityId: 'left', rightEntityId: 'right' }, entities),
    /请选择合并后要保留的身份/
  )
  const preserveLeft = planEntityMerge(
    { leftEntityId: 'left', rightEntityId: 'right' },
    entities,
    'left'
  )
  assert.equal(preserveLeft.source.id, 'right')
  assert.equal(preserveLeft.target.id, 'left')
  assert.throws(
    () => planEntityMerge({ leftEntityId: 'left', rightEntityId: 'right' }, entities, 'other'),
    /不属于当前合并候选/
  )
})

test('entity creation review accepts a corrected canonical name but rejects placeholders', () => {
  const review = {
    id: 'review-1',
    kind: 'entity_creation',
    entityId: 'entity-1',
    entityCanonicalName: '错误名字'
  }
  const entity = {
    id: 'entity-1',
    canonicalName: '错误名字',
    trustStatus: 'candidate'
  }
  assert.deepEqual(planEntityCreationConfirmation(review, entity, '正确名字'), {
    beforeName: '错误名字',
    canonicalName: '正确名字',
    changed: true
  })
  assert.throws(
    () => planEntityCreationConfirmation(review, entity, '用户'),
    /占位词/
  )
  assert.throws(
    () => planEntityCreationConfirmation(review, entity, '   '),
    /不能为空/
  )
  assert.throws(
    () => planEntityCreationConfirmation(review, { ...entity, canonicalName: '后来修改的名字' }, '正确名字'),
    /候选已过期/
  )
})

test('entity name corrections are persisted as an auditable history', () => {
  withStore(store => {
    store.recordEntityCorrection('entity-1', 'review-1', '错误名字', '正确名字')
    store.recordEntityCorrection('entity-1', 'review-1', '正确名字', '正确名字')
    const rows = store.listEntityCorrections('entity-1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].before_name, '错误名字')
    assert.equal(rows[0].after_name, '正确名字')
    assert.equal(rows[0].reason, 'review_correction')
  })
})

test('entity summary and alias candidates accept human final values without bypassing stale guards', () => {
  const entity = {
    id: 'entity-1',
    canonicalName: '张三',
    aliases: [],
    summary: '当前摘要'
  }
  const summaryReview = {
    kind: 'entity_summary',
    entityId: 'entity-1',
    previousSummary: '当前摘要',
    summaryText: '模型建议摘要'
  }
  assert.deepEqual(planEntitySummaryConfirmation(summaryReview, entity, '人工纠正摘要'), {
    suggestedValue: '模型建议摘要',
    finalValue: '人工纠正摘要',
    changed: true
  })
  assert.throws(
    () => planEntitySummaryConfirmation(summaryReview, { ...entity, summary: '后来摘要' }, '人工纠正摘要'),
    /候选已过期/
  )
  const aliasReview = {
    kind: 'entity_alias',
    entityId: 'entity-1',
    entityCanonicalName: '张三',
    aliasText: '模型错别名'
  }
  assert.deepEqual(planEntityAliasConfirmation(aliasReview, entity, '老张'), {
    suggestedValue: '模型错别名',
    finalValue: '老张',
    changed: true
  })
  assert.throws(() => planEntityAliasConfirmation(aliasReview, entity, '用户'), /占位词/)
  assert.throws(() => planEntityAliasConfirmation(aliasReview, entity, '张三'), /规范名相同/)
  assert.throws(
    () => planEntityAliasConfirmation(aliasReview, { ...entity, canonicalName: '后来名称' }, '老张'),
    /候选已失效/
  )
})

test('entity profile corrections persist model suggestion and human final value', () => {
  withStore(store => {
    store.recordEntityProfileCorrection('entity-1', 'summary-review', 'summary', '模型摘要', '人工摘要')
    store.recordEntityProfileCorrection('entity-1', 'alias-review', 'alias', '错误别名', '正确别名')
    store.recordEntityProfileCorrection('entity-1', 'same-review', 'alias', '相同', '相同')
    const rows = store.listEntityProfileCorrections('entity-1')
    assert.equal(rows.length, 2)
    assert.deepEqual(new Set(rows.map((row: any) => row.field)), new Set(['summary', 'alias']))
    assert.equal(rows.find((row: any) => row.field === 'summary')?.final_value, '人工摘要')
    assert.equal(rows.find((row: any) => row.field === 'alias')?.suggested_value, '错误别名')
  })
})

test('review ledger persists resolution time, actor and reason', () => {
  withStore(store => {
    store.syncGraph({
      entities: [],
      relations: [],
      reviewQueue: [{
        id: 'review-resolved',
        kind: 'entity_alias',
        title: '别名候选',
        detail: '候选说明',
        confidence: 0.8,
        status: 'rejected',
        createdAt: '2026-07-30T00:00:00.000Z',
        resolvedAt: '2026-07-30T01:00:00.000Z',
        resolutionActor: 'system',
        resolutionReason: '关联实体已被拒绝'
      }]
    } as any)
    const [row] = store.listReviewLedger()
    assert.equal(row.status, 'rejected')
    assert.equal(row.resolved_at, '2026-07-30T01:00:00.000Z')
    assert.equal(row.payload.resolutionActor, 'system')
    assert.equal(row.payload.resolutionReason, '关联实体已被拒绝')
  })
})

test('resolved graph reviews leave encrypted state but remain paginated in SQLCipher', () => {
  withStore(store => {
    const reviews = [
      ...Array.from({ length: 2_500 }, (_, index) => ({
        id: `resolved-${String(index).padStart(4, '0')}`,
        kind: index % 2 ? 'relation' : 'entity_alias',
        title: index === 1_777 ? '需要长期检索的特殊候选' : `历史候选 ${index}`,
        detail: `处理说明 ${index}`,
        confidence: 0.8,
        status: index % 3 ? 'confirmed' : 'rejected',
        createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        resolvedAt: new Date(1_710_000_000_000 + index * 1_000).toISOString(),
        evidence: [{ excerpt: `不应继续复制进状态文件的原文 ${index} ${'x'.repeat(300)}` }]
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `pending-${index}`,
        kind: 'entity_creation',
        title: `待处理 ${index}`,
        detail: '',
        confidence: 0.7,
        status: 'pending',
        createdAt: new Date(1_720_000_000_000 + index * 1_000).toISOString()
      }))
    ]
    store.syncGraph({ entities: [], relations: [], reviewQueue: reviews } as any)

    const compacted = compactGraphReviewWorkset(reviews)
    assert.equal(compacted.pending.length, 3)
    assert.equal(compacted.resolved.length, 2_500)
    assert.ok(Buffer.byteLength(JSON.stringify(compacted.pending)) <
      Buffer.byteLength(JSON.stringify(reviews)) / 100)

    store.syncGraph({ entities: [], relations: [], reviewQueue: compacted.pending } as any)
    const firstPage = store.listReviewLedgerPage({ status: 'resolved', offset: 0, limit: 40 })
    const secondPage = store.listReviewLedgerPage({ status: 'resolved', offset: 40, limit: 40 })
    assert.equal(firstPage.total, 2_500)
    assert.equal(firstPage.counts.pending, 3)
    assert.equal(firstPage.counts.resolved, 2_500)
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 80)
    assert.ok(firstPage.items.every(item => item.status !== 'pending'))
    assert.equal(store.listReviewLedgerPage({
      status: 'all',
      query: '特殊候选',
      limit: 40
    }).items[0]?.id, 'resolved-1777')
    assert.equal(store.listReviewLedgerPage({
      status: 'pending',
      kind: 'entity_creation',
      query: '待处理',
      limit: 2
    }).hasMore, true)
    store.syncGraph({
      entities: [],
      relations: [],
      reviewQueue: compacted.pending.slice(0, 2)
    } as any)
    assert.equal(store.listReviewLedgerPage({ status: 'pending' }).total, 2)
    assert.equal(store.listReviewLedgerPage({ status: 'resolved' }).total, 2_500)
  })
})

test('SQLCipher review ledger remains available after process-style reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-review-restart-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncGraph({
      entities: [],
      relations: [],
      reviewQueue: [{
        id: 'restart-resolved',
        kind: 'possible_duplicate',
        title: '重启后仍可审阅',
        detail: '持久记录',
        confidence: 0.9,
        status: 'confirmed',
        createdAt: '2026-07-30T00:00:00.000Z',
        resolvedAt: '2026-07-30T01:00:00.000Z',
        evidence: [{ excerpt: '持久原文' }]
      }]
    } as any)
    first.close()

    second.initialize(databasePath, key)
    const page = second.listReviewLedgerPage({ status: 'resolved', query: '持久原文' })
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.id, 'restart-resolved')
    assert.equal(page.items[0]?.evidence[0]?.excerpt, '持久原文')
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('review ledger filters pending and resolved decisions by kind, evidence and time', () => {
  const reviews = [
    {
      id: 'pending-relation',
      kind: 'relation',
      status: 'pending',
      title: '甲方服务乙方',
      createdAt: '2026-07-30T01:00:00.000Z',
      evidence: [{ sender: '张三', excerpt: '项目原文' }]
    },
    {
      id: 'confirmed-alias',
      kind: 'entity_alias',
      status: 'confirmed',
      title: '别名候选',
      resolutionReason: '用户确认候选',
      createdAt: '2026-07-29T00:00:00.000Z',
      resolvedAt: '2026-07-30T03:00:00.000Z'
    },
    {
      id: 'rejected-relation',
      kind: 'relation',
      status: 'rejected',
      title: '错误关系',
      resolutionReason: '关联实体已被拒绝',
      createdAt: '2026-07-29T00:00:00.000Z',
      resolvedAt: '2026-07-30T02:00:00.000Z'
    }
  ]
  assert.deepEqual(
    filterGraphReviews(reviews, { status: 'pending', kind: 'relation', query: '项目原文' }).map(item => item.id),
    ['pending-relation']
  )
  assert.deepEqual(
    filterGraphReviews(reviews, { status: 'resolved', query: '拒绝' }).map(item => item.id),
    ['rejected-relation']
  )
  assert.deepEqual(
    filterGraphReviews(reviews, { status: 'resolved' }).map(item => item.id),
    ['confirmed-alias', 'rejected-relation']
  )
})

test('review ledger pagination keeps stable boundaries and scoped counts', () => {
  const reviews = Array.from({ length: 95 }, (_, index) => ({
    id: `review-${String(index).padStart(3, '0')}`,
    kind: index % 3 === 0 ? 'relation' : 'entity_alias',
    status: index % 4 === 0 ? 'pending' : index % 2 === 0 ? 'rejected' : 'confirmed',
    title: index < 70 ? `目标候选 ${index}` : `其他候选 ${index}`,
    createdAt: index % 2 === 0 ? '2026-07-30T01:00:00.000Z' : '2026-07-30T02:00:00.000Z'
  }))
  const first = paginateGraphReviews(reviews, {
    status: 'all',
    query: '目标候选',
    offset: 0,
    limit: 40
  })
  const second = paginateGraphReviews(reviews, {
    status: 'all',
    query: '目标候选',
    offset: 40,
    limit: 40
  })
  assert.equal(first.total, 70)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.equal(second.items.length, 30)
  assert.equal(second.hasMore, false)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 70)
  assert.deepEqual(first.counts, {
    pending: reviews.slice(0, 70).filter(item => item.status === 'pending').length,
    resolved: reviews.slice(0, 70).filter(item => item.status !== 'pending').length,
    all: 70
  })
  assert.deepEqual(
    paginateGraphReviews(reviews, {
      status: 'resolved',
      kind: 'relation',
      query: '目标候选',
      offset: 0,
      limit: 1000
    }).items.map(item => item.id),
    filterGraphReviews(reviews, {
      status: 'resolved',
      kind: 'relation',
      query: '目标候选'
    }).map(item => item.id)
  )
})

test('relation confirmation can atomically correct direction and predicate', () => {
  const entities = [
    { id: 'a', canonicalName: '甲方', trustStatus: 'confirmed' },
    { id: 'b', canonicalName: '乙方', trustStatus: 'confirmed' },
    { id: 'candidate', canonicalName: '候选实体', trustStatus: 'candidate' }
  ]
  const relation = {
    id: relationSemanticId('a', '服务对象', 'b'),
    subjectId: 'a',
    predicate: '服务对象',
    objectId: 'b'
  }
  const review = { kind: 'relation', relationId: relation.id }
  const plan = planRelationConfirmation({
    review,
    relation,
    entities,
    correction: { subjectId: 'b', predicate: '服务于', objectId: 'a' }
  })
  assert.equal(plan.changed, true)
  assert.equal(plan.after.id, relationSemanticId('b', '服务于', 'a'))
  assert.equal(plan.after.directionExplanation, '从“乙方”指向“甲方”：乙方 服务于 甲方。')
  assert.throws(
    () => planRelationConfirmation({
      review,
      relation,
      entities,
      correction: { subjectId: 'a', predicate: '相关', objectId: 'a' }
    }),
    /不能是同一个实体/
  )
  assert.throws(
    () => planRelationConfirmation({
      review,
      relation,
      entities,
      correction: { subjectId: 'candidate', predicate: '服务于', objectId: 'a' }
    }),
    /先确认关系两端/
  )
  assert.throws(
    () => planRelationConfirmation({
      review,
      relation: { ...relation, status: 'rejected' },
      entities
    }),
    /已拒绝的关系/
  )
})

test('relation corrections preserve before and after direction in audit history', () => {
  withStore(store => {
    const before = { id: 'before', subjectId: 'a', predicate: '服务对象', objectId: 'b' }
    const after = { id: 'after', subjectId: 'b', predicate: '服务于', objectId: 'a' }
    store.recordRelationCorrection('review-1', before, after)
    store.recordRelationCorrection('review-2', after, after)
    const rows = store.listRelationCorrections('a')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].before_predicate, '服务对象')
    assert.equal(rows[0].after_predicate, '服务于')
    assert.equal(rows[0].after_subject_id, 'b')
  })
})

test('relation correction merges into an existing semantic edge without losing evidence', () => {
  const entities = [
    { id: 'a', canonicalName: '甲方', trustStatus: 'confirmed' },
    { id: 'b', canonicalName: '乙方', trustStatus: 'confirmed' }
  ]
  const source = {
    id: relationSemanticId('a', '错误方向', 'b'),
    subjectId: 'a',
    predicate: '错误方向',
    objectId: 'b',
    evidence: [{ messageId: 'source-evidence' }, { messageId: 'shared-evidence' }],
    confidence: 0.7,
    status: 'candidate'
  }
  const existing = {
    id: relationSemanticId('b', '服务于', 'a'),
    subjectId: 'b',
    predicate: '服务于',
    objectId: 'a',
    evidence: [{ messageId: 'existing-evidence' }, { messageId: 'shared-evidence' }],
    confidence: 0.8,
    status: 'candidate'
  }
  const plan = planRelationConfirmation({
    review: { kind: 'relation', relationId: source.id },
    relation: source,
    entities,
    correction: { subjectId: 'b', predicate: '服务于', objectId: 'a' }
  })
  const result = applyRelationConfirmation({
    relations: [source, existing],
    sourceRelationId: source.id,
    plan,
    now: '2026-07-30T00:00:00.000Z'
  })
  assert.equal(result.mergedIntoExisting, true)
  assert.equal(result.relations.length, 1)
  assert.equal(result.confirmedRelation.status, 'confirmed')
  assert.equal(result.confirmedRelation.confidence, 0.8)
  assert.deepEqual(
    result.confirmedRelation.evidence.map((item: any) => item.messageId).sort(),
    ['existing-evidence', 'shared-evidence', 'source-evidence']
  )
})

test('identity merge archive is fully pageable, private and restores every active target after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-merge-audit-archive-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    for (let index = 0; index < 2_500; index += 1) {
      const mergeId = first.recordMerge(`source-${index}`, `target-${index}`, {
        source: {
          id: `source-${index}`,
          canonicalName: `被合并人物 ${String(index).padStart(4, '0')}`,
          privateEvidence: `不应离开主进程的合并快照 ${index} ${'x'.repeat(300)}`
        },
        target: {
          id: `target-${index}`,
          canonicalName: `保留人物 ${String(index).padStart(4, '0')}`
        },
        graph: { relations: [{ excerpt: '快照原文不得进入目录' }] }
      })
      if (index % 5 === 0) first.markMergeReverted(mergeId)
    }
    const database = (first as any).db
    database.prepare(`
      UPDATE merge_history SET source_name='',target_name=''
      WHERE source_entity_id='source-2499'
    `).run()

    const firstPage = first.listMergeHistoryPage({ limit: 40 })
    const secondPage = first.listMergeHistoryPage({ limit: 40, offset: 40 })
    assert.equal(firstPage.total, 2_500)
    assert.deepEqual(firstPage.counts, { active: 2_000, reverted: 500, all: 2_500 })
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 80)
    assert.equal(JSON.stringify(firstPage.items).includes('snapshot_json'), false)
    assert.equal(JSON.stringify(firstPage.items).includes('不应离开主进程'), false)
    assert.equal(JSON.stringify(firstPage.items).includes('快照原文'), false)
    assert.equal(first.listActiveMergeTargetIds().length, 2_000)
    assert.equal(first.listActiveMergeTargetIds().includes('target-2499'), true)

    const scoped = first.listMergeHistoryPage({
      status: 'active',
      query: '保留人物 012',
      limit: 100
    })
    assert.ok(scoped.items.length > 0)
    assert.equal(scoped.items.every(item =>
      !item.reverted_at && String(item.target_name).includes('保留人物 012')
    ), true)
    const reverted = first.listMergeHistoryPage({ status: 'reverted', limit: 100 })
    assert.equal(reverted.items.every(item => item.reverted_at && item.canRevert === false), true)
    assert.deepEqual(first.getMergeHistoryArchiveStats(), {
      total: 2_500,
      active: 2_000,
      reverted: 500,
      latestId: 2_500,
      latestActivityAt: first.getMergeHistoryArchiveStats().latestActivityAt
    })
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const legacyNames = reopened.listMergeHistoryPage({
        status: 'active',
        query: '保留人物 2499',
        limit: 10
      })
      assert.equal(legacyNames.items.length, 1)
      assert.equal(legacyNames.items[0].source_name, '被合并人物 2499')
      assert.equal(legacyNames.items[0].target_name, '保留人物 2499')
      assert.equal(reopened.listActiveMergeTargetIds().length, 2_000)
      const lastPage = reopened.listMergeHistoryPage({ offset: 2_480, limit: 40 })
      assert.equal(lastPage.items.length, 20)
      assert.equal(lastPage.hasMore, false)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

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

test('event timeline filters cross-source evidence, status and time with stable pagination', () => withStore(store => {
  const makeEvent = (id: string, sourceSession: string, startAt: string, status: string) => ({
    id,
    eventType: sourceSession.includes('calendar') ? 'calendar' : 'meeting',
    title: `事件 ${id}`,
    description: `证据 ${id}`,
    startAt,
    endAt: '',
    location: '',
    confidence: 1,
    status,
    searchText: `事件 ${id}`,
    createdAt: startAt,
    evidence: [{
      messageId: `message-${id}`,
      sessionId: sourceSession,
      timestamp: Math.floor(Date.parse(startAt) / 1000),
      excerpt: `证据 ${id}`,
      role: 'direct'
    }]
  })
  store.upsertEvents([
    makeEvent('wechat-event', 'wechat-session', '2026-07-28T10:00:00.000Z', 'candidate'),
    makeEvent('document-event', 'data-source:documents', '2026-07-29T10:00:00.000Z', 'candidate'),
    makeEvent('calendar-event', 'data-source:calendar:work', '2026-07-30T10:00:00.000Z', 'confirmed'),
    makeEvent('cancelled-event', 'data-source:calendar:work', '2026-07-31T10:00:00.000Z', 'cancelled'),
    makeEvent('rejected-event', 'data-source:calendar:work', '2026-08-01T10:00:00.000Z', 'rejected')
  ])

  const calendar = store.listEventTimeline({ sourceId: 'calendar', limit: 1 })
  assert.equal(calendar.total, 2)
  assert.equal(calendar.items[0].id, 'cancelled-event')
  assert.equal(calendar.items[0].source_id, 'calendar')
  assert.equal(calendar.hasMore, true)
  assert.equal(calendar.items[0].evidence[0].session_id, 'data-source:calendar:work')

  const confirmed = store.listEventTimeline({
    status: 'confirmed',
    from: '2026-07-30T00:00:00.000Z',
    to: '2026-07-30T23:59:59.999Z'
  })
  assert.deepEqual(confirmed.items.map(item => item.id), ['calendar-event'])
  assert.equal(store.listEventTimeline({ sourceId: 'documents' }).items[0].id, 'document-event')
  assert.equal(store.listEventTimeline({ sourceId: 'wechat' }).items[0].id, 'wechat-event')

  const manyEvidence = Array.from({ length: 25 }, (_, index) => ({
    messageId: `wechat:timeline:${index + 1}`,
    sessionId: 'timeline-session',
    timestamp: 1_700_000_000 + index,
    excerpt: `时间线证据 ${index + 1}`,
    role: 'direct'
  }))
  store.upsertEvents([{
    ...makeEvent('bounded-timeline-event', 'timeline-session', '2026-07-27T10:00:00.000Z', 'candidate'),
    evidence: manyEvidence
  }])
  const bounded = store.listEventTimeline({ sourceId: 'wechat' }).items
    .find(item => item.id === 'bounded-timeline-event')
  assert.equal(bounded.evidence_count, 25)
  assert.equal(bounded.evidence.length, 20)
  assert.equal(bounded.evidence.at(-1).message_id, 'wechat:timeline:25')
}))

test('calendar participant identities persist as email anchors and event merges are reversible', () => withStore(store => {
  const source = {
    id: 'email-person',
    type: 'person',
    canonicalName: 'Hun',
    aliases: [],
    accountIds: [],
    externalIdentities: [{
      platform: 'email', accountId: 'hun@example.test', displayName: 'Hun', confidence: 1
    }],
    summary: '日历参与者',
    summaryStatus: 'confirmed',
    trustStatus: 'confirmed',
    confidence: 0.95,
    evidenceMessageIds: ['calendar-message'],
    identityVersion: 1
  }
  const target = {
    id: 'wechat-person',
    type: 'person',
    canonicalName: 'Hun',
    aliases: [],
    accountIds: ['wxid_hun'],
    externalIdentities: [],
    summary: '微信实体',
    summaryStatus: 'confirmed',
    trustStatus: 'confirmed',
    confidence: 1,
    evidenceMessageIds: ['wechat-message'],
    identityVersion: 1
  }
  store.syncGraph({ entities: [source, target], relations: [], reviewQueue: [] })
  store.upsertEvents([{
    id: 'calendar-event-with-person',
    eventType: 'calendar',
    title: '产品评审',
    description: '',
    startAt: '2026-07-30T10:00:00.000Z',
    confidence: 1,
    status: 'confirmed',
    searchText: '产品评审 Hun',
    participants: [{ entityId: source.id, role: 'required' }],
    evidence: [{
      messageId: 'calendar-message',
      sessionId: 'data-source:calendar:work',
      timestamp: 1_753_869_600,
      excerpt: '产品评审',
      role: 'direct'
    }]
  }])
  assert.equal(store.searchText('hun@example.test', 10)[0]?.source_id, source.id)
  const sourceParticipants = store.listEntityEventParticipants(source.id)
  const targetParticipants = store.listEntityEventParticipants(target.id)
  store.mergeEntityEventParticipants(source.id, target.id)
  assert.equal(store.listEntityEventParticipants(source.id).length, 0)
  assert.deepEqual(store.listEntityEventParticipants(target.id), [{
    eventId: 'calendar-event-with-person', role: 'required'
  }])
  store.restoreMergedEventParticipants(source.id, target.id, sourceParticipants, targetParticipants)
  assert.deepEqual(store.listEntityEventParticipants(source.id), sourceParticipants)
  assert.deepEqual(store.listEntityEventParticipants(target.id), targetParticipants)
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

  store.syncGraph({ entities: entities.map(entity => ({ ...entity, trustStatus: 'confirmed' })), relations: [], reviewQueue: [] })
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

test('multi-year fact archive is fully pageable and filters before ranking', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'fact-owner',
      type: 'person',
      canonicalName: '事实档案主人',
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  } as any)
  const claims = Array.from({ length: 1_200 }, (_, index) => {
    const year = 2020 + (index % 6)
    return {
      id: `archive-claim-${String(index).padStart(4, '0')}`,
      subjectId: 'fact-owner',
      predicate: index === 777 ? '特殊长期关键词' : `履历字段${String(index).padStart(4, '0')}`,
      objectValue: `事实值 ${index}`,
      confidence: 0.9,
      status: index % 4 === 0 ? 'rejected' : index % 4 === 1 ? 'candidate' : 'confirmed',
      sourceNature: index % 3 === 0 ? 'self_statement' : 'other_statement',
      validFrom: `${year}-01-01`,
      validTo: `${year + 1}-12-31`,
      searchText: `事实档案主人 履历字段 ${index}`,
      evidence: [{
        messageId: `archive-message-${index}`,
        sessionId: index % 2 === 0 ? `data-source:documents:file-${index}` : 'wechat-session',
        timestamp: 1_700_000_000 + index,
        excerpt: `事实原文 ${index}`
      }]
    }
  })
  store.upsertClaims(claims)

  const first = store.listClaimArchive({ limit: 100 })
  const second = store.listClaimArchive({ offset: 100, limit: 100 })
  assert.equal(first.total, 900)
  assert.equal(first.items.length, 100)
  assert.equal(second.items.length, 100)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.ok(first.items.every(item => item.status !== 'rejected'))
  assert.ok(first.items.every(item => item.evidence_count === 1 && item.evidence.length === 1))
  assert.equal(store.listClaimArchive({
    status: 'rejected',
    entityId: 'fact-owner',
    limit: 100
  }).total, 300)
  assert.equal(store.listClaimArchive({
    sourceId: 'documents',
    limit: 100
  }).total, 300)
  assert.equal(store.listClaimArchive({
    predicate: '特殊长期关键词',
    status: 'candidate'
  }).items[0]?.id, 'archive-claim-0777')
  const overlapping = store.listClaimArchive({
    from: '2024-06-01T00:00:00.000Z',
    to: '2024-06-30T23:59:59.999Z',
    limit: 100
  })
  assert.ok(overlapping.total > 0)
  assert.ok(overlapping.items.every(item =>
    String(item.valid_to) >= '2024-06-01' && String(item.valid_from) <= '2024-06-30'))
}))

test('entity dossier memory is scoped before its bounded result limit', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'dossier-person', type: 'person', canonicalName: '档案人物', trustStatus: 'confirmed' },
      { id: 'other-person', type: 'person', canonicalName: '其他人物', trustStatus: 'confirmed' }
    ],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([
    {
      id: 'dossier-claim',
      subjectId: 'dossier-person',
      predicate: '负责',
      objectValue: '产品演示',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '档案人物负责产品演示',
      evidence: evidence('dossier-claim-message', '负责产品演示')
    },
    {
      id: 'other-claim',
      subjectId: 'other-person',
      predicate: '负责',
      objectValue: '无关工作',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '其他人物负责无关工作',
      evidence: evidence('other-claim-message', '负责无关工作')
    }
  ])
  store.upsertEvents([
    {
      id: 'dossier-event',
      eventType: 'meeting',
      title: '档案会议',
      startAt: '2026-07-30T10:00:00.000Z',
      confidence: 0.9,
      status: 'candidate',
      searchText: '档案人物参加档案会议',
      participants: [{ entityId: 'dossier-person', role: 'participant' }],
      evidence: evidence('dossier-event-message', '参加档案会议')
    },
    {
      id: 'other-event',
      eventType: 'meeting',
      title: '其他会议',
      startAt: '2026-07-30T11:00:00.000Z',
      confidence: 0.9,
      status: 'candidate',
      searchText: '其他人物参加其他会议',
      participants: [{ entityId: 'other-person', role: 'participant' }],
      evidence: evidence('other-event-message', '参加其他会议')
    }
  ])
  const dossier = store.getEntityMemory('dossier-person', 1)
  assert.deepEqual(dossier.claims.map(item => item.id), ['dossier-claim'])
  assert.deepEqual(dossier.events.map(item => item.id), ['dossier-event'])
  assert.equal(dossier.claimTotal, 1)
  assert.equal(dossier.eventTotal, 1)
  assert.equal(dossier.claims[0].evidence[0].message_id, 'dossier-claim-message')
  assert.equal(dossier.events[0].participants[0].entity_id, 'dossier-person')
}))

test('memory cards expose evidence totals but bound their latest evidence payload', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'bounded-person', type: 'person', canonicalName: '证据人物', trustStatus: 'confirmed' }],
    relations: [],
    reviewQueue: []
  })
  const manyEvidence = Array.from({ length: 25 }, (_, index) => ({
    messageId: `wechat:bounded-session:${index + 1}`,
    sessionId: 'bounded-session',
    timestamp: 1_700_000_000 + index,
    excerpt: `证据 ${index + 1}`,
    role: 'direct'
  }))
  store.upsertClaims([{
    id: 'bounded-claim',
    subjectId: 'bounded-person',
    predicate: '负责',
    objectValue: '证据边界',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '证据人物负责证据边界',
    evidence: manyEvidence
  }])

  const feedClaim = store.getMemoryFeed().claims.find(item => item.id === 'bounded-claim')
  assert.equal(feedClaim.evidence_count, 25)
  assert.equal(feedClaim.evidence.length, 20)
  assert.deepEqual(feedClaim.evidence.map((item: any) => item.message_id), manyEvidence.slice(5).map(item => item.messageId))

  const dossierClaim = store.getEntityMemory('bounded-person').claims[0]
  assert.equal(dossierClaim.evidence_count, 25)
  assert.equal(dossierClaim.evidence.length, 20)
  assert.equal(dossierClaim.evidence.at(-1).message_id, 'wechat:bounded-session:25')

  const searchPayload = store.getDocumentEvidencePayload('claim', 'bounded-claim')
  assert.equal(searchPayload.evidenceTotal, 25)
  assert.equal(searchPayload.evidence.length, MEMORY_CARD_EVIDENCE_LIMIT)
  assert.deepEqual(
    searchPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(-MEMORY_CARD_EVIDENCE_LIMIT).map(item => item.messageId)
  )
  assert.deepEqual(store.getDocumentEvidence('claim', 'bounded-claim'), searchPayload.evidence)

  ;(store as any).db.prepare(
    'DELETE FROM search_document_evidence WHERE document_id=?'
  ).run('claim:bounded-claim')
  const fallbackPayload = store.getDocumentEvidencePayload('claim', 'bounded-claim')
  assert.equal(fallbackPayload.evidenceTotal, 25)
  assert.deepEqual(
    fallbackPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(-MEMORY_CARD_EVIDENCE_LIMIT).map(item => item.messageId)
  )
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
      trustStatus: 'confirmed',
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

test('only confirmed entity summaries enter trusted entity search', () => withStore(store => {
  const base = {
    id: 'person-summary-search',
    type: 'person',
    canonicalName: '摘要审阅对象',
    aliases: [],
    accountIds: [],
    summary: '独特候选线索火星罗盘',
    confidence: 0.8,
    trustStatus: 'confirmed'
  }
  store.syncGraph({
    entities: [{ ...base, summaryStatus: 'legacy_unverified' }],
    relations: [],
    reviewQueue: []
  })
  assert.equal(store.searchText('火星罗盘').some(result => result.source_id === base.id), false)

  store.syncGraph({
    entities: [{ ...base, summaryStatus: 'confirmed' }],
    relations: [],
    reviewQueue: []
  })
  assert.equal(store.searchText('火星罗盘').some(result => result.source_id === base.id), true)
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
  assert.equal(briefing.summaries[0].verified, false)
})

test('briefing prose requires exact core-message evidence keys', () => {
  const batch = [{
    sourceId: 'wechat',
    sessionId: 'session-a',
    sessionName: '项目群',
    id: 'message-core',
    timestamp: 1_775_000_000,
    direction: '对方发送',
    senderName: '负责人甲',
    content: '客户已确认周五演示。',
    analysisScope: 'core'
  }, {
    sourceId: 'wechat',
    sessionId: 'session-a',
    sessionName: '项目群',
    id: 'message-context',
    timestamp: 1_774_999_900,
    direction: '对方发送',
    senderName: '负责人乙',
    content: '仅用于分片上下文。',
    analysisScope: 'context'
  }]
  const grounded = groundBriefingDigest({
    summary: '周五演示已经确认。',
    summaryEvidenceKeys: ['wechat:session-a:message-core', 'wechat:session-a:invented'],
    highlights: [{
      text: '客户确认周五演示',
      sourceEvidenceKeys: ['wechat:session-a:message-core']
    }, {
      text: '上下文也算新增重点',
      sourceEvidenceKeys: ['wechat:session-a:message-context']
    }, '旧版无引用重点']
  }, batch)
  assert.equal(grounded.summary, '周五演示已经确认。')
  assert.deepEqual(grounded.summaryEvidence.map(item => item.messageId), ['message-core'])
  assert.deepEqual(grounded.highlights.map(item => item.text), ['客户确认周五演示'])
  assert.equal(grounded.rejectedHighlightCount, 2)
  assert.match(grounded.highlights[0].evidence[0].excerpt, /周五演示/)

  const ungrounded = groundBriefingDigest({
    summary: '模型自行生成的结论',
    summaryEvidenceKeys: ['wechat:session-a:message-context'],
    highlights: []
  }, batch)
  assert.equal(ungrounded.summary, '')
  assert.equal(ungrounded.rejectedSummary, true)
})

test('all structured extraction rejects forged, context and cross-session evidence', () => {
  const coreA = {
    sourceId: 'wechat', sessionId: 'session-a', id: 'same-local-id',
    content: '张三负责项目甲。', analysisScope: 'core'
  }
  const coreB = {
    sourceId: 'wechat', sessionId: 'session-b', id: 'same-local-id',
    content: '李四负责项目乙。', analysisScope: 'core'
  }
  const context = {
    sourceId: 'wechat', sessionId: 'session-a', id: 'context-only',
    content: '上下文中的旧任务。', analysisScope: 'context'
  }
  assert.notEqual(structuredEvidenceKey(coreA), structuredEvidenceKey(coreB))
  const validKey = structuredEvidenceKey(coreA)
  const invalidCases = [
    'wechat:session-b:missing',
    structuredEvidenceKey(context),
    'same-local-id'
  ]
  const validated = validateStructuredDigestEvidence({
    tasks: [
      { title: '处理项目甲', sourceEvidenceKeys: [validKey] },
      ...invalidCases.map((key, index) => ({ title: `错误任务${index}`, sourceEvidenceKeys: [key] }))
    ],
    entities: [{ tempId: 'person-a', canonicalName: '张三', evidenceKeys: [validKey] }],
    relations: [{ subjectTempId: 'person-a', objectTempId: 'project-a', evidenceKeys: [structuredEvidenceKey(coreB)] }],
    claims: [{ subjectTempId: 'person-a', predicate: '负责', evidenceKeys: [structuredEvidenceKey(context)] }],
    events: [{ title: '项目启动', evidenceKeys: ['forged:key'] }],
    possibleDuplicates: [{ leftTempId: 'person-a', rightExistingName: '张三旧号', evidenceKeys: [validKey] }]
  }, [coreA, coreB, context])

  assert.deepEqual(validated.digest.tasks.map((item: any) => item.title), ['处理项目甲'])
  assert.equal(validated.digest.tasks[0].__evidenceMessages[0], coreA)
  assert.equal(validated.digest.entities.length, 1)
  assert.equal(validated.digest.relations.length, 1)
  assert.equal(validated.digest.relations[0].__evidenceMessages[0], coreB)
  assert.equal(validated.digest.claims.length, 0)
  assert.equal(validated.digest.events.length, 0)
  assert.equal(validated.digest.possibleDuplicates.length, 1)
  assert.deepEqual(validated.rejected, {
    tasks: 3,
    entities: 0,
    relations: 0,
    claims: 1,
    events: 1,
    possibleDuplicates: 0
  })
})

test('extracted people reuse only evidence-verified account anchors, never names alone', () => {
  const existing = [{
    id: 'person-existing',
    type: 'person',
    canonicalName: '张三',
    aliases: ['老张'],
    accountIds: ['wxid_zhang']
  }, {
    id: 'org-existing',
    type: 'organization',
    canonicalName: '示例公司',
    aliases: [],
    accountIds: []
  }]
  const senderEvidence = [{
    sessionId: 'session-a',
    senderIdentity: {
      wxid: 'wxid_zhang',
      contactRemark: '张三',
      wechatNickname: 'Zhang',
      displayName: '张三',
      alias: '老张'
    }
  }]
  const sameNameOnly = planExtractedEntityResolution({
    type: 'person',
    canonicalName: '张三',
    confidence: 0.99,
    accountIds: [],
    __evidenceMessages: senderEvidence
  }, existing)
  assert.equal(sameNameOnly.existing, null)
  assert.equal(sameNameOnly.resolution, 'create_candidate')
  assert.deepEqual(sameNameOnly.sameNameCandidates.map(item => item.id), ['person-existing'])

  const verified = planExtractedEntityResolution({
    type: 'person',
    canonicalName: '张三',
    aliases: ['老张', '虚构别名'],
    accountIds: ['wxid_zhang', 'wxid_forged'],
    __evidenceMessages: senderEvidence
  }, existing)
  assert.equal(verified.existing?.id, 'person-existing')
  assert.deepEqual(verified.verifiedAccountIds, ['wxid_zhang'])
  assert.deepEqual(verified.rejectedAccountIds, ['wxid_forged'])
  assert.deepEqual(verified.verifiedAliases, ['老张'])
  assert.deepEqual(verified.candidateAliases, ['虚构别名'])

  const nameMismatch = planExtractedEntityResolution({
    type: 'person',
    canonicalName: '李四',
    accountIds: ['wxid_zhang'],
    __evidenceMessages: senderEvidence
  }, existing)
  assert.equal(nameMismatch.existing, null)
  assert.deepEqual(nameMismatch.verifiedAccountIds, [])
  assert.deepEqual(nameMismatch.rejectedAccountIds, ['wxid_zhang'])

  const crossSenderAlias = planExtractedEntityResolution({
    type: 'person',
    canonicalName: '张三',
    aliases: ['李四'],
    accountIds: ['wxid_other'],
    __evidenceMessages: [{
      senderIdentity: {
        wxid: 'wxid_other',
        displayName: '李四'
      }
    }]
  }, existing)
  assert.deepEqual(crossSenderAlias.verifiedAccountIds, [])
  assert.deepEqual(crossSenderAlias.verifiedAliases, [])
  assert.deepEqual(crossSenderAlias.candidateAliases, ['李四'])

  const organization = planExtractedEntityResolution({
    type: 'organization',
    canonicalName: '示例公司',
    confidence: 0.95,
    accountIds: [],
    __evidenceMessages: senderEvidence
  }, existing)
  assert.equal(organization.existing?.id, 'org-existing')
  assert.equal(organization.resolution, 'non_person_exact_name')
})

test('unverified aliases remain evidence-backed review candidates', () => {
  const entity = {
    id: 'person-a',
    canonicalName: '张三',
    aliases: ['老张']
  }
  const candidates = buildEntityAliasCandidates({
    entity,
    aliases: ['老张', '三哥', '三哥'],
    evidenceMessages: [{
      sessionId: 'session-a',
      timestamp: 1720000000,
      sender: '李四',
      content: '三哥说这个项目周五完成。'
    }],
    evidenceKeys: ['wechat:session-a:message-a'],
    confidence: 0.76,
    createdAt: '2026-07-30T12:00:00.000Z'
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, 'entity_alias')
  assert.equal(candidates[0].aliasText, '三哥')
  assert.equal(candidates[0].status, 'pending')
  assert.match(candidates[0].evidence[0].excerpt, /三哥/)
  assert.equal(canApplyEntityAliasCandidate(candidates[0], entity), true)
  assert.equal(canApplyEntityAliasCandidate(candidates[0], {
    ...entity,
    canonicalName: '已改名实体'
  }), false)

  assert.deepEqual(buildEntityAliasCandidates({
    entity,
    aliases: ['三哥'],
    evidenceMessages: [],
    evidenceKeys: [],
    confidence: 0.8,
    createdAt: '2026-07-30T12:00:00.000Z'
  }), [])
})

test('unanchored entities remain evidence-backed candidates outside trusted search', () => withStore(store => {
  const entity = {
    id: 'candidate-person',
    type: 'person',
    canonicalName: '候选火星人物',
    aliases: [],
    accountIds: [],
    externalIdentities: [],
    trustStatus: 'candidate',
    confidence: 0.79
  }
  const review = buildEntityCreationReview({
    entity,
    evidenceMessages: [{
      sessionId: 'session-a',
      timestamp: 1720000000,
      sender: '李四',
      content: '候选火星人物说周五交付。'
    }],
    evidenceKeys: ['wechat:session-a:message-a'],
    createdAt: '2026-07-30T12:00:00.000Z'
  })
  assert.ok(review)
  assert.equal(review.kind, 'entity_creation')
  assert.equal(review.status, 'pending')
  assert.equal(review.evidence[0].messageId, 'wechat:session-a:message-a')
  assert.equal(canConfirmEntityCreation(review, entity), true)
  assert.equal(canConfirmEntityCreation(review, { ...entity, canonicalName: '名字已变化' }), false)
  assert.equal(isTrustedEntity(entity), false)
  assert.equal(inferLegacyEntityTrustStatus({ accountIds: ['wxid_stable'] }), 'confirmed')
  assert.equal(inferLegacyEntityTrustStatus({ accountIds: [], externalIdentities: [] }), 'legacy_unverified')

  store.syncGraph({ entities: [entity], relations: [], reviewQueue: [review] })
  assert.equal(store.searchText('候选火星人物').length, 0)
  store.syncGraph({
    entities: [{ ...entity, trustStatus: 'confirmed' }],
    relations: [],
    reviewQueue: [{ ...review, status: 'confirmed' }]
  })
  assert.equal(store.searchText('候选火星人物')[0]?.source_id, entity.id)
}))

test('legacy unverified entities receive actionable reviews with recovered evidence', () => {
  const entity = {
    id: 'legacy-person',
    type: 'person',
    canonicalName: '旧版人物',
    trustStatus: 'legacy_unverified',
    confidence: 0.67
  }
  const review = buildLegacyEntityReview({
    entity,
    evidence: [{
      message_id: 'wechat:legacy-session:legacy-message',
      session_id: 'legacy-session',
      timestamp: 1710000000,
      excerpt: '旧版人物确认参加项目。'
    }],
    createdAt: '2026-07-30T12:00:00.000Z'
  })
  assert.ok(review)
  assert.equal(review.kind, 'entity_creation')
  assert.equal(review.legacyReview, true)
  assert.equal(review.evidence[0].messageId, 'wechat:legacy-session:legacy-message')
  assert.equal(canConfirmEntityCreation(review, entity), true)

  const withoutEvidence = buildLegacyEntityReview({
    entity,
    evidence: [],
    createdAt: '2026-07-30T12:00:00.000Z'
  })
  assert.ok(withoutEvidence)
  assert.equal(withoutEvidence.evidence.length, 0)
  assert.match(withoutEvidence.detail, /无法恢复/)
})

test('graph sync removes stale aliases and identities from trusted lookup', () => withStore(store => {
  const base = {
    id: 'identity-replacement',
    type: 'person',
    canonicalName: '身份替换对象',
    trustStatus: 'confirmed'
  }
  store.syncGraph({
    entities: [{
      ...base,
      aliases: ['绝版旧别名'],
      accountIds: ['legacy_account_zeta_777'],
      externalIdentities: []
    }],
    relations: [],
    reviewQueue: []
  })
  assert.equal(store.searchText('绝版旧别名')[0]?.source_id, base.id)
  store.syncGraph({
    entities: [{
      ...base,
      aliases: ['全新别名'],
      accountIds: ['brand_new_account_omega_999'],
      externalIdentities: []
    }],
    relations: [],
    reviewQueue: []
  })
  assert.equal(store.searchText('绝版旧别名').some(item => item.source_id === base.id), false)
  assert.equal(store.searchText('legacy_account_zeta_777').some(item => item.source_id === base.id), false)
  assert.equal(store.searchText('全新别名')[0]?.source_id, base.id)
  assert.equal(store.searchText('brand_new_account_omega_999')[0]?.source_id, base.id)
}))

test('entity summaries remain evidence-backed candidates until non-stale confirmation', () => {
  const candidate = buildEntitySummaryCandidate({
    entityId: 'person-a',
    entityName: '张三',
    previousSummary: '旧摘要',
    summary: '张三正在负责新产品演示。',
    confidence: 0.88,
    evidenceMessages: [{
      sessionId: 'session-a',
      timestamp: 1720000000,
      sender: '张三',
      content: '新产品演示这块我来负责。'
    }],
    evidenceKeys: ['wechat:session-a:message-a'],
    identityVersion: 2,
    createdAt: '2026-07-30T12:00:00.000Z'
  })
  assert.ok(candidate)
  assert.equal(candidate.kind, 'entity_summary')
  assert.equal(candidate.status, 'pending')
  assert.equal(candidate.previousSummary, '旧摘要')
  assert.equal(candidate.summaryText, '张三正在负责新产品演示。')
  assert.equal(candidate.evidence[0].messageId, 'wechat:session-a:message-a')
  assert.match(candidate.evidence[0].excerpt, /我来负责/)
  assert.equal(canApplyEntitySummaryCandidate(candidate, {
    id: 'person-a',
    summary: '旧摘要'
  }), true)
  assert.equal(canApplyEntitySummaryCandidate(candidate, {
    id: 'person-a',
    summary: '用户刚刚手动确认的另一版摘要'
  }), false)

  assert.equal(buildEntitySummaryCandidate({
    entityId: 'person-a',
    entityName: '张三',
    previousSummary: '',
    summary: '没有证据的摘要',
    confidence: 0.9,
    evidenceMessages: [],
    evidenceKeys: [],
    identityVersion: 1,
    createdAt: '2026-07-30T12:00:00.000Z'
  }), null)
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

test('common-neighbor graph evidence is newest-first bounded with a truthful total', () => {
  const evidence = Array.from({ length: GRAPH_QUERY_EVIDENCE_LIMIT + 3 }, (_, index) => ({
    messageId: `wechat:graph:${index + 1}`,
    sessionId: 'graph',
    timestamp: index + 1,
    excerpt: `证据 ${index + 1}`
  }))
  const [result] = findCommonGraphNeighbors('left', 'right', [
    { id: 'left' }, { id: 'right' }, { id: 'common' }
  ], [
    { id: 'left-common', subjectId: 'left', objectId: 'common', predicate: '参与', status: 'confirmed', evidence },
    { id: 'right-common', subjectId: 'right', objectId: 'common', predicate: '参与', status: 'confirmed', evidence: [] }
  ])
  assert.equal(result.leftEdges[0].evidenceTotal, GRAPH_QUERY_EVIDENCE_LIMIT + 3)
  assert.equal(result.leftEdges[0].evidence.length, GRAPH_QUERY_EVIDENCE_LIMIT)
  assert.equal(result.leftEdges[0].evidence.at(-1).messageId, `wechat:graph:${GRAPH_QUERY_EVIDENCE_LIMIT + 3}`)
})

test('project intelligence aggregates members, progress, risks, decisions and evidence', () => {
  const projects = buildProjectInsights({
    entities: [
      { id: 'project-demo', type: 'project', canonicalName: '升级版演示', aliases: ['演示项目'], summary: '客户演示项目', trustStatus: 'confirmed' },
      { id: 'person-owner', type: 'person', canonicalName: '负责人甲', aliases: [], trustStatus: 'confirmed' }
    ],
    relations: [{
      id: 'member-relation', subjectId: 'person-owner', objectId: 'project-demo', predicate: '负责', status: 'confirmed', confidence: 0.9,
      evidence: [{ messageId: 'message-member', timestamp: 1_775_000_000, excerpt: '负责人甲负责升级版演示' }]
    }],
    claims: [],
    events: [{
      id: 'decision-project', event_type: 'decision', title: '决定周五演示', description: '', status: 'confirmed', start_at: '2026-07-31',
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
  assert.equal(project.milestones.length, 0)
  assert.equal(project.evidence.length, 3)
  assert.equal(project.evidenceTotal, 3)
  assert.equal(project.taskTotal, 3)
  assert.equal(project.pendingReview.milestones[0].id, 'delivery-project')
  assert.equal(project.pendingReview.total, 1)
})

test('project dossiers bound task and aggregate evidence without hiding totals', () => {
  const relationEvidence = Array.from({ length: PROJECT_EVIDENCE_LIMIT + 10 }, (_, index) => ({
    messageId: `wechat:project:${index + 1}`,
    sessionId: 'project',
    timestamp: index + 1,
    excerpt: `项目关系证据 ${index + 1}`
  }))
  const taskEvidence = Array.from({ length: MEMORY_CARD_EVIDENCE_LIMIT + 5 }, (_, index) => ({
    messageId: `wechat:task:${index + 1}`,
    sessionId: 'task',
    timestamp: 100 + index,
    excerpt: `任务证据 ${index + 1}`
  }))
  const [project] = buildProjectInsights({
    entities: [
      { id: 'bounded-project', type: 'project', canonicalName: '有界项目', aliases: [], trustStatus: 'confirmed' },
      { id: 'bounded-person', type: 'person', canonicalName: '项目成员', aliases: [], trustStatus: 'confirmed' }
    ],
    relations: [{
      id: 'bounded-project-relation',
      subjectId: 'bounded-person',
      objectId: 'bounded-project',
      predicate: '参与',
      status: 'confirmed',
      confidence: 1,
      evidence: relationEvidence
    }],
    claims: [],
    events: [],
    tasks: [{
      id: 'bounded-project-task',
      title: '处理有界项目',
      project: '有界项目',
      status: 'todo',
      priority: 'medium',
      evidence: taskEvidence
    }]
  })
  assert.equal(project.evidenceTotal, relationEvidence.length + taskEvidence.length)
  assert.equal(project.evidence.length, PROJECT_EVIDENCE_LIMIT)
  assert.equal(project.tasks[0].evidenceTotal, taskEvidence.length)
  assert.equal(project.tasks[0].evidence.length, MEMORY_CARD_EVIDENCE_LIMIT)
  assert.equal(project.tasks[0].evidence.at(-1).messageId, `wechat:task:${taskEvidence.length}`)
})

test('project dashboard is a light directory and dossiers are selected on demand', () => {
  const entities = Array.from({ length: 100 }, (_, index) => ({
    id: `project-${index}`,
    type: 'project',
    canonicalName: `规模项目 ${index}`,
    aliases: [],
    summary: `项目摘要 ${index}`,
    trustStatus: 'confirmed'
  }))
  const tasks = entities.map((entity, index) => ({
    id: `task-${index}`,
    title: `处理 ${entity.canonicalName}`,
    project: entity.canonicalName,
    status: index % 2 ? 'doing' : 'done',
    priority: 'medium',
    evidence: Array.from({ length: 100 }, (_, evidenceIndex) => ({
      messageId: `wechat:project-${index}:${evidenceIndex}`,
      sessionId: `project-${index}`,
      timestamp: evidenceIndex,
      excerpt: `不应进入目录的长证据 ${index} ${evidenceIndex} ${'证据'.repeat(200)}`
    }))
  }))
  const input = { entities, relations: [], claims: [], events: [], tasks }
  const directory = buildProjectDirectory(input)
  const serialized = JSON.stringify(directory)
  assert.equal(directory.length, 100)
  assert.equal(directory[0].tasks, undefined)
  assert.equal(directory[0].evidence, undefined)
  assert.equal(serialized.includes('不应进入目录的长证据'), false)
  assert.ok(Buffer.byteLength(serialized) < 40_000)
  const fullPayloadBytes = Buffer.byteLength(JSON.stringify(buildProjectInsights(input)))
  assert.ok(Buffer.byteLength(serialized) < fullPayloadBytes * 0.05)

  const dossier = buildProjectInsight(input, 'project-42')
  assert.equal(dossier.id, 'project-42')
  assert.equal(dossier.tasks.length, 1)
  assert.equal(dossier.tasks[0].evidenceTotal, 100)
  assert.equal(buildProjectInsight(input, 'missing-project'), null)
})

test('task dashboard keeps structure but loads evidence and audit history on demand', () => {
  const longEvidence = Array.from({ length: 250 }, (_, index) => ({
    messageId: `wechat:task-scale:${index}`,
    sessionId: 'task-scale',
    timestamp: index,
    sender: '项目群',
    excerpt: `只应进入按需档案的任务证据 ${index} ${'原文'.repeat(200)}`
  }))
  const fullTask = {
    id: 'task-scale',
    title: '完成规模测试',
    detail: '结构化字段仍用于筛选、月历和编辑',
    owner: '我',
    project: 'Personal OS',
    due: '2026-08-01',
    priority: 'high',
    status: 'doing',
    confidence: 0.9,
    sourceMessageIds: longEvidence.map(item => item.messageId),
    evidence: longEvidence
  }
  const directory = buildTaskDirectoryItem(fullTask)
  assert.equal(directory.id, fullTask.id)
  assert.equal(directory.project, fullTask.project)
  assert.equal(directory.evidenceTotal, longEvidence.length)
  assert.equal(directory.evidence, undefined)
  assert.equal(directory.sourceMessageIds, undefined)
  assert.equal(JSON.stringify(directory).includes('只应进入按需档案'), false)
  assert.ok(Buffer.byteLength(JSON.stringify(directory)) < Buffer.byteLength(JSON.stringify(fullTask)) * 0.02)

  const history = Array.from({ length: TASK_HISTORY_LIMIT + 25 }, (_, index) => ({
    id: index + 1,
    task_id: fullTask.id,
    field: 'status',
    created_at: new Date(1_700_000_000_000 + index * 1000).toISOString()
  })).reverse()
  const dossier = buildTaskDossier(fullTask, history, history.length)
  assert.equal(dossier.task.evidence.length, MEMORY_CARD_EVIDENCE_LIMIT)
  assert.equal(dossier.task.evidenceTotal, longEvidence.length)
  assert.equal(dossier.history.length, TASK_HISTORY_LIMIT)
  assert.equal(dossier.historyTotal, history.length)
  assert.equal(dossier.payloadPolicy.loadedOnDemand, true)
})

test('closed task archive stays fully pageable without copying evidence into its directory', () => withStore(store => {
  const tasks = Array.from({ length: 1_000 }, (_, index) => ({
    id: `archive-task-${String(index).padStart(4, '0')}`,
    title: index === 778 ? '特殊历史任务关键词' : `多年任务 ${index}`,
    detail: `任务说明 ${index}`,
    owner: '我',
    collaborators: [`协作者 ${index % 7}`],
    project: `项目 ${index % 10}`,
    taskKind: index % 3 === 0 ? 'waiting' : 'action',
    due: `202${index % 6}-12-31`,
    priority: ['high', 'medium', 'low'][index % 3],
    confidence: 0.9,
    classification: 'mine',
    status: ['todo', 'doing', 'waiting', 'done', 'cancelled'][index % 5],
    createdAt: new Date(1_500_000_000_000 + index * 10_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + index * 10_000).toISOString(),
    evidence: [{
      messageId: `archive-task-message-${index}`,
      sessionId: 'archive-task-session',
      timestamp: 1_700_000_000 + index,
      sender: '项目群',
      excerpt: `不应复制进任务目录的长原文 ${index} ${'x'.repeat(500)}`
    }]
  }))
  store.syncTasks(tasks)
  store.recordTaskChanges(
    tasks[778].id,
    { status: 'doing' },
    { status: 'done' },
    'archive-scale-test',
    tasks[778].evidence
  )

  const first = store.listTaskArchive({ limit: 100 })
  const second = store.listTaskArchive({ offset: 100, limit: 100 })
  assert.equal(first.total, 400)
  assert.equal(first.items.length, 100)
  assert.equal(second.items.length, 100)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.ok(first.items.every(item => ['done', 'cancelled'].includes(item.status)))
  assert.ok(first.items.every(item => item.evidenceTotal === 1))
  assert.equal(JSON.stringify(first.items).includes('不应复制进任务目录的长原文'), false)
  assert.equal(store.listTaskArchive({ status: 'done' }).total, 200)
  assert.equal(store.listTaskArchive({ status: 'cancelled' }).total, 200)
  assert.equal(store.listTaskArchive({ project: '项目 3' }).total, 100)
  const special = store.listTaskArchive({ query: '特殊历史任务关键词' })
  assert.equal(special.items[0]?.id, 'archive-task-0778')
  assert.equal(special.items[0]?.historyTotal, 1)

  const withNewEvidence = tasks.map(task => task.id === 'archive-task-0778'
    ? {
        ...task,
        evidence: [...task.evidence, {
          messageId: 'archive-task-message-0778-followup',
          sessionId: 'archive-task-session',
          timestamp: 1_800_000_000,
          sender: '项目群',
          excerpt: '仅证据变化也必须增量刷新'
        }]
      }
    : task)
  store.syncTasks(withNewEvidence)
  assert.equal(
    store.listTaskArchive({ query: '特殊历史任务关键词' }).items[0]?.evidenceTotal,
    2
  )

  store.syncTasks(withNewEvidence.map(task => task.id === 'archive-task-0778'
    ? { ...task, status: 'todo', updatedAt: '2026-07-31T00:00:00.000Z' }
    : task))
  assert.equal(store.listTaskArchive({ query: '特殊历史任务关键词' }).total, 0)
  assert.equal(store.listTaskArchive().total, 399)
}))

test('task archive survives a SQLCipher process-style reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-archive-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncTasks([{
      id: 'closed-after-restart',
      title: '跨重启历史任务',
      detail: '数据库重新打开后仍然可见',
      priority: 'high',
      confidence: 1,
      classification: 'mine',
      status: 'done',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      evidence: evidence('closed-after-restart-message', '完成了跨重启任务')
    }])
    first.close()
    second.initialize(databasePath, key)
    const page = second.listTaskArchive({ query: '跨重启历史任务' })
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.id, 'closed-after-restart')
    assert.equal(page.items[0]?.evidenceTotal, 1)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('task ownership reviews stay pageable and leave evidence in on-demand dossiers', () => withStore(store => {
  const tasks = Array.from({ length: 1_500 }, (_, index) => ({
    id: `ownership-task-${String(index).padStart(4, '0')}`,
    title: index === 997 ? '唯一归属候选关键词' : `归属候选 ${index}`,
    detail: `归属说明 ${index}`,
    owner: index % 3 === 0 ? '我' : `群成员 ${index % 20}`,
    source: `来源群 ${index % 12}`,
    sourceSessionId: `ownership-session-${index % 12}`,
    assignmentEvidence: `归属判断依据 ${index}`,
    priority: ['high', 'medium', 'low'][index % 3],
    confidence: 0.7,
    classification: ['mine', 'uncertain', 'others'][index % 3],
    status: 'todo',
    createdAt: new Date(1_500_000_000_000 + index * 10_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + index * 10_000).toISOString(),
    evidence: [{
      messageId: `ownership-message-${index}`,
      sessionId: `ownership-session-${index % 12}`,
      timestamp: 1_700_000_000 + index,
      sender: `群成员 ${index % 20}`,
      excerpt: `只能按需读取的归属原文 ${index} ${'x'.repeat(500)}`
    }]
  }))
  store.syncTasks(tasks)

  const first = store.listTaskOwnershipReviews({ limit: 100 })
  const second = store.listTaskOwnershipReviews({ offset: 100, limit: 100 })
  assert.equal(first.total, 1_000)
  assert.equal(first.items.length, 100)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.deepEqual(first.counts, { others: 500, uncertain: 500 })
  assert.ok(first.items.every(item => item.classification !== 'mine' && item.evidenceTotal === 1))
  assert.equal(JSON.stringify(first.items).includes('只能按需读取的归属原文'), false)
  assert.equal(store.listTaskOwnershipReviews({ classification: 'uncertain' }).total, 500)
  assert.equal(store.listTaskOwnershipReviews({ classification: 'others' }).total, 500)
  assert.equal(store.listTaskOwnershipReviews({ priority: 'medium' }).total, 500)
  const special = store.listTaskOwnershipReviews({ query: '唯一归属候选关键词' })
  assert.equal(special.total, 1)
  assert.equal(special.items[0]?.id, 'ownership-task-0997')
  assert.deepEqual(Object.keys(store.getTaskOwnershipReviewStats()).sort(), [
    'latestClassification', 'latestId', 'latestUpdatedAt', 'total'
  ])

  store.syncTasks(tasks.map(task => task.id === 'ownership-task-0997'
    ? { ...task, classification: 'mine', updatedAt: '2026-07-31T00:00:00.000Z' }
    : task))
  assert.equal(store.listTaskOwnershipReviews({ query: '唯一归属候选关键词' }).total, 0)
  assert.equal(store.getTaskOwnershipReviewStats().total, 999)
}))

test('task ownership review pages survive a SQLCipher process-style reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-ownership-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncTasks([{
      id: 'ownership-after-restart',
      title: '跨重启归属候选',
      detail: '数据库重新打开后仍然等待确认',
      priority: 'high',
      confidence: 0.7,
      classification: 'uncertain',
      status: 'todo',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      evidence: evidence('ownership-after-restart-message', '这件事可能需要你处理')
    }])
    first.close()
    second.initialize(databasePath, key)
    const page = second.listTaskOwnershipReviews({ query: '跨重启归属候选' })
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.evidenceTotal, 1)
    assert.equal(second.getTaskOwnershipReviewStats().total, 1)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('renderer cursor status exposes counts but keeps durable keys and session maps private', () => {
  const cursor = {
    lastMessageTimestamp: 1_800_000_000,
    recentMessageIds: Array.from({ length: 20_000 }, (_, index) => `private-message-key-${index}`),
    sessionCursors: Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [
      `private-session-${index}`, 1_700_000_000 + index
    ])),
    sessionOffsets: Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [
      `private-backlog-${index}`, index % 2 ? index : 0
    ])),
    lastSuccessfulRunAt: '2026-07-31T00:00:00.000Z',
    lastAttemptAt: '2026-07-31T00:01:00.000Z',
    lastError: null,
    pendingSessionRetryCount: 3,
    pendingSessionBacklogCount: 1_000,
    backlogRetry: {
      nextAttemptAt: '2026-07-31T00:15:00.000Z',
      failureCount: 2,
      paused: false,
      lastProgressAt: '2026-07-31T00:00:00.000Z'
    }
  }
  const payload = buildCursorStatusPayload(cursor)
  const serialized = JSON.stringify(payload)
  assert.equal(payload.payloadPolicy.version, CURSOR_STATUS_PAYLOAD_VERSION)
  assert.equal(payload.privateStateCounts.recentMessageKeys, 20_000)
  assert.equal(payload.privateStateCounts.sessionCursors, 10_000)
  assert.equal(payload.privateStateCounts.continuationOffsets, 1_000)
  assert.equal(payload.recentMessageIds, undefined)
  assert.equal(payload.sessionCursors, undefined)
  assert.equal(payload.sessionOffsets, undefined)
  assert.equal(serialized.includes('private-message-key'), false)
  assert.equal(serialized.includes('private-session'), false)
  assert.ok(Buffer.byteLength(serialized) < 2_000)
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
  assert.deepEqual(
    (({ total, indexed, pending, model: currentModel }) => ({ total, indexed, pending, model: currentModel }))(store.getEmbeddingStats(model)),
    { total: 1, indexed: 1, pending: 0, model }
  )
  assert.equal(store.getEmbeddingStats(model).ann.mode, 'exact')
  assert.equal(store.searchVector([0.9, 0.1], model)[0].source_id, 'task-vector')

  store.syncTasks([task])
  assert.equal(store.listEmbeddingCandidates(model).length, 0)
  store.syncTasks([{ ...task, detail: '整理产品介绍与报价材料' }])
  assert.equal(store.listEmbeddingCandidates(model).length, 1)
  assert.equal(store.getEmbeddingStats(model).pending, 1)
}))

test('local ANN index is deterministic, persistent, invalidated safely and falls back to exact search', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-ann-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const model = 'test-ann:8d'
  const createTasks = () => Array.from({ length: 40 }, (_, index) => ({
    id: `ann-task-${index}`,
    title: `ANN 测试任务 ${index}`,
    detail: `近邻簇 ${index}`,
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }))
  const vectorFor = (index: number) => {
    const vector = [1, (index + 1) / 10_000, 0.04, 0.03, 0.02, 0.01, 0.005, 0.002]
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return vector.map(value => value / norm)
  }
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncTasks(createTasks())
    for (let index = 0; index < 40; index += 1) {
      first.saveEmbedding(`task:ann-task-${index}`, model, vectorFor(index))
    }
    const build = first.ensureApproximateVectorIndex(model, { minimumDocuments: 20 })
    assert.equal(build.rebuilt, true)
    assert.equal(build.indexed, 40)
    assert.equal(build.coverage, 1)
    const results = first.searchVector(vectorFor(18), model, 5, {
      minimumDocuments: 20,
      minimumCandidates: 10
    })
    assert.equal(results[0].source_id, 'ann-task-18')
    assert.equal(results[0].semantic_search_mode, 'ann')
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const persisted = reopened.ensureApproximateVectorIndex(model, { minimumDocuments: 20 })
    assert.equal(persisted.rebuilt, false)
    assert.equal(persisted.indexed, 40)
    reopened.syncTasks(createTasks().map(task =>
      task.id === 'ann-task-18' ? { ...task, detail: '内容变化使旧向量和 ANN 条目失效' } : task))
    const stale = reopened.getApproximateVectorIndexStats(model, 8)
    assert.equal(stale.indexed, 39)
    assert.equal(stale.eligible, 39)
    assert.equal(stale.coverage, 1)
    reopened.saveEmbedding('task:ann-task-18', model, vectorFor(18))
    const incomplete = reopened.getApproximateVectorIndexStats(model, 8)
    assert.equal(incomplete.indexed, 39)
    assert.equal(incomplete.eligible, 40)
    assert.equal(incomplete.coverage, 39 / 40)
    const fallback = reopened.searchVector(vectorFor(17), model, 5, {
      minimumDocuments: 20,
      minimumCandidates: 10
    })
    assert.equal(fallback[0].semantic_search_mode, 'exact')
    const rebuilt = reopened.ensureApproximateVectorIndex(model, { minimumDocuments: 20 })
    assert.equal(rebuilt.rebuilt, true)
    assert.equal(rebuilt.indexed, 40)
    assert.equal(rebuilt.coverage, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ANN signatures and one-bit probes are deterministic and bounded', () => {
  const vector = [0.5, -0.5, 0.25, 0.125]
  const first = computeAnnSignatures(vector, 'ann-signature-test', 4, 8)
  assert.deepEqual(first, computeAnnSignatures(vector, 'ann-signature-test', 4, 8))
  assert.equal(first.length, 4)
  const probes = listMultiProbeSignatures(first[0], 8)
  assert.equal(probes.length, 9)
  assert.equal(new Set(probes).size, 9)
})

test('local ANN keeps clustered semantic recall while reducing the exact candidate set', () => withStore(store => {
  const model = 'test-ann-recall:32d'
  const documents = Array.from({ length: 300 }, (_, index) => ({
    id: `ann-recall-${index}`,
    title: `召回样本 ${index}`,
    detail: `聚类 ${Math.floor(index / 10)}`,
    priority: 'low',
    status: 'todo',
    classification: 'mine'
  }))
  const normalized = (values: number[]) => {
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
    return values.map(value => value / norm)
  }
  const vectorFor = (index: number) => {
    const cluster = Math.floor(index / 10)
    return normalized(Array.from({ length: 32 }, (_, dimension) => {
      const base = Math.sin((cluster + 1) * (dimension + 1) * 0.37)
      const noise = Math.sin((index + 3) * (dimension + 5) * 0.11) * 0.015
      return base + noise
    }))
  }
  store.syncTasks(documents)
  documents.forEach((document, index) =>
    store.saveEmbedding(`task:${document.id}`, model, vectorFor(index)))
  store.ensureApproximateVectorIndex(model, { minimumDocuments: 100 })
  const query = vectorFor(124)
  const exact = store.searchVector(query, model, 10, { minimumDocuments: 1_000 })
  const approximate = store.searchVector(query, model, 10, {
    minimumDocuments: 100,
    minimumCandidates: 30
  })
  assert.equal(approximate[0].semantic_search_mode, 'ann')
  const exactIds = new Set(exact.map(item => item.id))
  const overlap = approximate.filter(item => exactIds.has(item.id)).length
  assert.ok(overlap >= 8, `expected ANN recall@10 >= 0.8, received ${overlap / 10}`)
}))

test('memory scope filters apply entity, session, date and document type together', () => {
  const inRange = Math.floor(Date.parse('2026-07-28T12:00:00+08:00') / 1000)
  const items = [{
    id: 'relation-1',
    document_type: 'relation',
    source_id: 'relation-1',
    title: '服务对象',
    search_text: '邢爱妮 服务对象 Onyx Devs Lab',
    metadata: { subjectId: 'person-xing', objectId: 'org-onyx', status: 'confirmed' },
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
  }, {
    id: 'rejected-relation',
    document_type: 'relation',
    source_id: 'rejected-relation',
    title: '错误关系',
    search_text: 'Onyx 错误关系',
    metadata: { subjectId: 'person-xing', objectId: 'org-onyx', status: 'rejected' },
    evidence: [{ session_id: 'session-onyx', timestamp: inRange }]
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

test('retrieval scope is applied before lexical and vector top-k ranking', () => withStore(store => {
  const timestamp = Math.floor(Date.parse('2026-07-30T02:00:00.000Z') / 1000)
  const tasks = Array.from({ length: 350 }, (_, index) => ({
    id: `crowded-${index}`,
    title: `共同关键词 共同关键词 共同关键词 全局任务 ${index}`,
    detail: '共同关键词用于制造超过 Top-300 的高相关全库匹配',
    priority: 'low',
    status: 'todo',
    classification: 'mine',
    sourceSessionId: 'session-global',
    evidence: [{ messageId: `global-${index}`, timestamp, sender: '全局', excerpt: '共同关键词' }]
  }))
  tasks.push({
    id: 'scoped-target',
    title: '共同关键词 范围内唯一目标',
    detail: '只能通过召回前范围约束可靠找回',
    priority: 'high',
    status: 'todo',
    classification: 'mine',
    sourceSessionId: 'session-target',
    evidence: [{ messageId: 'target-message', timestamp, sender: '目标', excerpt: '共同关键词 范围内证据' }]
  })
  store.syncTasks(tasks)
  const scope = store.listScopedSearchDocumentIds({
    sessionId: 'session-target',
    from: '2026-07-30',
    to: '2026-07-30',
    documentTypes: ['task']
  })
  assert.deepEqual([...scope || []], ['task:scoped-target'])
  assert.equal(store.searchText('共同关键词', 300).some(item => item.id === 'task:scoped-target'), false)
  assert.deepEqual(store.searchText('共同关键词', 40, scope).map(item => item.id), ['task:scoped-target'])
  assert.deepEqual(store.listSearchDocumentsInScope(scope!, 40).map(item => item.id), ['task:scoped-target'])

  const model = 'scoped-retrieval:2d'
  tasks.forEach((task, index) =>
    store.saveEmbedding(`task:${task.id}`, model, task.id === 'scoped-target' ? [0, 1] : [1, index / 10_000]))
  const globalVector = store.searchVector([1, 0], model, 300)
  assert.equal(globalVector.some(item => item.id === 'task:scoped-target'), false)
  const scopedVector = store.searchVector([1, 0], model, 40, { allowedIds: scope })
  assert.deepEqual(scopedVector.map(item => item.id), ['task:scoped-target'])
  assert.equal(scopedVector[0].semantic_search_mode, 'exact')
}))

test('memory result pages are stable, bounded and report remaining ranked candidates', () => {
  const ranked = Array.from({ length: 95 }, (_, index) => ({ id: `result-${index}` }))
  const first = paginateMemoryResults(ranked, 0, 40)
  const second = paginateMemoryResults(ranked, 40, 40)
  const final = paginateMemoryResults(ranked, 80, 40)
  assert.deepEqual(first.results.map(item => item.id), ranked.slice(0, 40).map(item => item.id))
  assert.deepEqual(second.results.map(item => item.id), ranked.slice(40, 80).map(item => item.id))
  assert.deepEqual(final.results.map(item => item.id), ranked.slice(80).map(item => item.id))
  assert.equal(first.total, 95)
  assert.equal(first.hasMore, true)
  assert.equal(final.hasMore, false)
  assert.equal(final.truncated, false)

  const capped = paginateMemoryResults(Array.from({ length: 520 }, (_, id) => ({ id })), 480, 40)
  assert.equal(capped.total, 500)
  assert.equal(capped.truncated, true)
  assert.equal(capped.hasMore, false)
})

test('database retrieval scope covers entity links, relation type and evidence time', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'scope-person', type: 'person', canonicalName: '范围人物', aliases: ['范围别名'], accountIds: [], trustStatus: 'confirmed' },
      { id: 'scope-org', type: 'organization', canonicalName: '范围组织', aliases: [], accountIds: [], trustStatus: 'confirmed' }
    ],
    relations: [{
      id: 'scope-relation',
      subjectId: 'scope-person',
      predicate: '服务对象',
      objectId: 'scope-org',
      confidence: 0.9,
      status: 'confirmed',
      evidence: [{ messageId: 'scope-relation-message', sessionId: 'scope-session', timestamp: 1_754_000_000, excerpt: '为范围组织提供服务' }]
    }],
    reviewQueue: []
  })
  store.upsertEvents([{
    id: 'scope-event',
    eventType: 'meeting',
    title: '范围会议',
    description: '',
    startAt: '2025-08-01T10:00:00.000Z',
    confidence: 0.8,
    status: 'candidate',
    searchText: '范围人物参加范围会议',
    participants: [{ entityId: 'scope-person', role: 'participant' }],
    evidence: [{ messageId: 'scope-event-message', sessionId: 'scope-session', timestamp: 1_754_040_000, excerpt: '参加范围会议' }]
  }])
  const entityScope = store.listScopedSearchDocumentIds({
    entityId: 'scope-person',
    entityTerms: ['范围人物', '范围别名']
  })
  assert.ok(entityScope?.has('entity:scope-person'))
  assert.ok(entityScope?.has('relation:scope-relation'))
  assert.ok(entityScope?.has('event:scope-event'))
  const relationScope = store.listScopedSearchDocumentIds({
    documentTypes: ['relation'],
    relationTypes: ['服务对象']
  })
  assert.deepEqual([...relationScope || []], ['relation:scope-relation'])
  const dateScope = store.listScopedSearchDocumentIds({
    from: '2025-08-01',
    to: '2025-08-01'
  })
  assert.ok(dateScope?.has('event:scope-event'))
}))

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
  const contextual = buildContextualMemoryQuestion('那他后来怎么说？', [
    { role: 'user', content: 'Onyx 的负责人是谁？' },
    { role: 'assistant', content: '根据证据，负责人是某人。' }
  ])
  assert.equal(contextual.usedHistory, true)
  assert.match(contextual.query, /Onyx 的负责人是谁/)
  const standalone = buildContextualMemoryQuestion('最近三天有哪些待办？', [
    { role: 'user', content: 'Onyx 的负责人是谁？' }
  ])
  assert.equal(standalone.usedHistory, false)
  assert.equal(standalone.query, '最近三天有哪些待办？')
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

test('assistant conversations persist ordered turns, citations and deletion across reloads', () => withStore(store => {
  const conversationId = store.saveAssistantExchange('第一问', '第一答', [{
    documentId: 'claim:one',
    title: '证据一'
  }])
  store.saveAssistantExchange('第二问', '第二答', [{
    documentId: 'event:two',
    title: '证据二'
  }], conversationId)
  store.saveAssistantExchange('第三问', '第三答', [], conversationId)

  const summaries = store.listAssistantConversations()
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].id, conversationId)
  assert.equal(summaries[0].title, '第一问')
  assert.equal(summaries[0].message_count, 6)
  assert.equal(summaries[0].preview, '第三答')

  const conversation = store.getAssistantConversation(conversationId, 4)
  assert.deepEqual(conversation.messages.map((message: any) => [message.role, message.content]), [
    ['user', '第二问'],
    ['assistant', '第二答'],
    ['user', '第三问'],
    ['assistant', '第三答']
  ])
  assert.equal(conversation.messages[1].citations[0].documentId, 'event:two')

  assert.equal(store.deleteAssistantConversation(conversationId), true)
  assert.equal(store.getAssistantConversation(conversationId), null)
  assert.equal(store.listAssistantConversations().length, 0)
}))

test('assistant archive paginates years of conversations and complete long threads', () => withStore(store => {
  const conversationIds: string[] = []
  for (let index = 0; index < 600; index += 1) {
    const id = store.saveAssistantExchange(
      `历史问题 ${index}`,
      index === 347 ? '包含唯一检索暗号 月光档案' : `历史回答 ${index}`,
      []
    )
    conversationIds.push(id)
    const year = 2020 + Math.floor(index / 100)
    const timestamp = `${year}-${String((index % 12) + 1).padStart(2, '0')}-15T04:00:00.000Z`
    ;(store as any).db.prepare(`
      UPDATE assistant_conversations SET created_at=?,updated_at=? WHERE id=?
    `).run(timestamp, timestamp, id)
  }

  const first = store.listAssistantConversationsPage({ limit: 40 })
  const second = store.listAssistantConversationsPage({ limit: 40, offset: 40 })
  const stats = store.getAssistantArchiveStats()
  assert.deepEqual(Object.keys(stats).sort(), ['latestId', 'latestMessageCount', 'latestUpdatedAt', 'total'])
  assert.equal(stats.total, 600)
  assert.equal(first.total, 600)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 80)
  assert.ok(Date.parse(first.items[0].updated_at) >= Date.parse(first.items[39].updated_at))

  const query = store.listAssistantConversationsPage({ query: '月光档案', limit: 40 })
  assert.equal(query.total, 1)
  assert.equal(query.items[0].id, conversationIds[347])
  const range = store.listAssistantConversationsPage({
    from: '2023-01-01T00:00:00.000Z',
    to: '2023-12-31T23:59:59.999Z',
    limit: 100
  })
  assert.equal(range.total, 100)

  const longConversation = store.saveAssistantExchange('长对话第 0 问', '长对话第 0 答', [])
  for (let index = 1; index < 125; index += 1) {
    store.saveAssistantExchange(`长对话第 ${index} 问`, `长对话第 ${index} 答`, [], longConversation)
  }
  const pages = Array.from({ length: 7 }, (_, index) =>
    store.getAssistantConversation(longConversation, { offset: index * 40, limit: 40 }))
  const messages = pages.flatMap(page => page.messages)
  assert.equal(pages[0].total, 250)
  assert.equal(pages[0].hasOlder, true)
  assert.equal(pages[6].hasOlder, false)
  assert.equal(messages.length, 250)
  assert.equal(new Set(messages.map(message => message.id)).size, 250)
  assert.deepEqual(pages[0].messages.slice(-2).map((message: any) => message.content), ['长对话第 124 问', '长对话第 124 答'])
}))

test('assistant archive and message pagination survive a SQLCipher process-style reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-assistant-archive-reopen-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const conversationId = first.saveAssistantExchange('重启前问题', '重启前回答', [])
    for (let index = 1; index < 30; index += 1) {
      first.saveAssistantExchange(`重启问题 ${index}`, `重启回答 ${index}`, [], conversationId)
    }
    first.close()

    second.initialize(databasePath, key)
    const archive = second.listAssistantConversationsPage({ query: '重启前问题', limit: 10 })
    assert.equal(archive.total, 1)
    assert.equal(archive.items[0].message_count, 60)
    const latest = second.getAssistantConversation(conversationId, { offset: 0, limit: 20 })
    const older = second.getAssistantConversation(conversationId, { offset: 20, limit: 40 })
    assert.equal(latest.hasOlder, true)
    assert.equal(older.hasOlder, false)
    assert.equal(new Set([...latest.messages, ...older.messages].map((message: any) => message.id)).size, 60)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('human claim correction survives repeated extraction while new evidence is retained', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'person-corrected', type: 'person', canonicalName: '纠正对象', aliases: [], accountIds: [] }],
    relations: [],
    reviewQueue: []
  })
  const extracted = {
    id: 'claim-corrected',
    subjectId: 'person-corrected',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.72,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '纠正对象 所在城市 上海',
    evidence: evidence('message-corrected-1', '听说现在住在上海')
  }
  store.upsertClaims([extracted])
  store.correctClaim('claim-corrected', { value: '北京', validFrom: '2026-07-01' })
  store.upsertClaims([{
    ...extracted,
    confidence: 0.98,
    searchText: '模型再次认为纠正对象在上海',
    evidence: evidence('message-corrected-2', '旧消息再次被模型处理')
  }])
  const claim = store.getMemoryFeed().claims.find(item => item.id === 'claim-corrected')
  assert.equal(claim.object_value, '北京')
  assert.equal(claim.status, 'confirmed')
  assert.equal(claim.source_nature, 'human_confirmation')
  assert.equal(claim.correction_count, 1)
  assert.deepEqual(claim.evidence.map((item: any) => item.message_id),
    ['message-corrected-1', 'message-corrected-2'])
  const search = store.searchText('北京').find(item => item.id === 'claim:claim-corrected')
  assert.ok(search)
  assert.equal(JSON.parse(search.metadata_json).status, 'confirmed')
}))

test('human event correction is audited, searchable and protected from repeated extraction', () => withStore(store => {
  const extracted = {
    id: 'event-corrected',
    eventType: 'meeting',
    title: '错误的会议',
    description: '模型原始说明',
    startAt: '2026-07-30T01:00:00.000Z',
    endAt: '2026-07-30T02:00:00.000Z',
    location: '旧地点',
    confidence: 0.7,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: '错误的会议 模型原始说明 旧地点',
    evidence: evidence('event-message-1', '会议原文')
  }
  store.upsertEvents([extracted])
  const corrected = store.correctEvent('event-corrected', {
    title: '客户方案评审',
    eventType: 'review',
    description: '确认第二版方案与报价',
    startAt: '2026-07-31T06:00:00.000Z',
    endAt: '2026-07-31T07:30:00.000Z',
    location: '上海会议室'
  })
  assert.equal(corrected.status, 'confirmed')
  assert.equal(corrected.source_nature, 'human_confirmation')
  assert.equal(corrected.correction_count, 1)
  store.saveEmbedding('event:event-corrected', 'event-correction-vector', [1, 0])
  store.upsertEvents([{
    ...extracted,
    confidence: 0.99,
    title: '模型再次输出的错误会议',
    evidence: evidence('event-message-2', '重新抽取追加的证据')
  }])
  const event = store.getEvent('event-corrected')
  assert.equal(event.title, '客户方案评审')
  assert.equal(event.event_type, 'review')
  assert.equal(event.location, '上海会议室')
  assert.equal(event.status, 'confirmed')
  assert.equal(event.source_nature, 'human_confirmation')
  assert.equal(event.correction_count, 1)
  assert.deepEqual(event.evidence.map((item: any) => item.message_id), ['event-message-1', 'event-message-2'])
  assert.ok(store.searchText('报价').some(item => item.id === 'event:event-corrected'))
  assert.equal(store.getEmbeddingStats('event-correction-vector').pending, 0)
  const timeline = store.listEventTimeline()
  assert.equal(timeline.items[0].corrected_at !== null, true)
  store.upsertEvents([{ ...extracted, status: 'cancelled', evidence: evidence('event-message-cancelled', '来源事件已取消') }])
  assert.equal(store.getEvent('event-corrected').status, 'cancelled')
  assert.equal(store.getEvent('event-corrected').title, '客户方案评审')
  assert.equal(JSON.parse(store.searchText('报价')[0].metadata_json).status, 'cancelled')
  assert.throws(() => store.correctEvent('event-corrected', {
    title: '非法时间',
    startAt: '2026-08-01T10:00:00.000Z',
    endAt: '2026-08-01T09:00:00.000Z'
  }), /结束时间不能早于开始时间/)
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

test('trusted extraction context excludes candidates and keeps same-name confirmed identities distinct', () => {
  const entities = [
    {
      id: 'person-zhang-a',
      type: 'person',
      canonicalName: '张伟',
      aliases: ['张老师'],
      accountIds: ['wxid_zhang_a'],
      trustStatus: 'confirmed'
    },
    {
      id: 'person-zhang-b',
      type: 'person',
      canonicalName: '张伟',
      aliases: ['产品张伟'],
      accountIds: ['wxid_zhang_b'],
      trustStatus: 'confirmed'
    },
    {
      id: 'person-zhang-candidate',
      type: 'person',
      canonicalName: '张伟',
      aliases: ['候选张伟'],
      accountIds: ['wxid_zhang_candidate'],
      trustStatus: 'candidate'
    }
  ]
  const selected = selectTrustedExtractionEntities({
    messages: [{
      content: '张伟和产品张伟都参加，张老师负责现场确认',
      sessionName: '项目群',
      senderIdentity: { wxid: 'wxid_zhang_a' }
    }],
    entities,
    relations: [],
    limit: 24
  })
  assert.equal(EXTRACTION_MEMORY_CONTEXT_VERSION, 'trusted-extraction-context-v1')
  assert.deepEqual(new Set(selected.entities.map(entity => entity.id)),
    new Set(['person-zhang-a', 'person-zhang-b']))
  assert.equal(selected.entities.some(entity => entity.id === 'person-zhang-candidate'), false)
  assert.equal(selected.directEntityIds.length, 2)
})

test('trusted extraction context anchors senders, expands only confirmed one-hop relations and stays bounded', () => {
  const entities = [
    {
      id: 'sender',
      type: 'person',
      canonicalName: '发送者',
      accountIds: ['wxid_sender'],
      trustStatus: 'confirmed'
    },
    {
      id: 'confirmed-project',
      type: 'project',
      canonicalName: '可信项目',
      trustStatus: 'confirmed'
    },
    {
      id: 'candidate-project',
      type: 'project',
      canonicalName: '候选项目',
      trustStatus: 'confirmed'
    },
    {
      id: 'two-hop-org',
      type: 'organization',
      canonicalName: '二跳组织',
      trustStatus: 'confirmed'
    },
    ...Array.from({ length: 60 }, (_, index) => ({
      id: `match-${String(index).padStart(2, '0')}`,
      type: 'person',
      canonicalName: `测试成员${String(index).padStart(2, '0')}`,
      aliases: ['共同别名'],
      trustStatus: 'confirmed',
      updatedAt: `2026-07-31T00:${String(index).padStart(2, '0')}:00.000Z`
    }))
  ]
  const selected = selectTrustedExtractionEntities({
    messages: [{
      content: '请确认',
      senderIdentity: { wxid: 'wxid_sender' }
    }],
    entities,
    relations: [
      {
        id: 'confirmed-edge',
        subjectId: 'sender',
        predicate: '负责',
        objectId: 'confirmed-project',
        status: 'confirmed'
      },
      {
        id: 'candidate-edge',
        subjectId: 'sender',
        predicate: '可能负责',
        objectId: 'candidate-project',
        status: 'candidate'
      },
      {
        id: 'two-hop-edge',
        subjectId: 'confirmed-project',
        predicate: '属于',
        objectId: 'two-hop-org',
        status: 'confirmed'
      }
    ],
    limit: 24
  })
  assert.ok(selected.entities.length <= 24)
  assert.ok(selected.directEntityIds.includes('sender'))
  assert.ok(selected.entities.some(entity => entity.id === 'confirmed-project'))
  assert.equal(selected.entities.some(entity => entity.id === 'candidate-project'), false)
  assert.equal(selected.entities.some(entity => entity.id === 'two-hop-org'), false)
  assert.deepEqual(selected.relations.map(relation => relation.id), ['confirmed-edge'])
  assert.deepEqual(selected.reasons['confirmed-project'], ['可信关系一跳邻居'])
  const bounded = selectTrustedExtractionEntities({
    messages: [{ content: '共同别名请确认' }],
    entities,
    relations: [],
    limit: 24
  })
  assert.equal(bounded.entities.length, 24)
})

test('trusted extraction memory returns only confirmed bounded claims and events', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'context-person', type: 'person', canonicalName: '上下文人物', trustStatus: 'confirmed' },
      { id: 'context-project', type: 'project', canonicalName: '上下文项目', trustStatus: 'confirmed' }
    ],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([
    {
      id: 'confirmed-context-claim',
      subjectId: 'context-person',
      predicate: '负责',
      objectEntityId: 'context-project',
      confidence: 1,
      status: 'confirmed',
      sourceNature: 'human_confirmation',
      searchText: '上下文人物负责上下文项目',
      evidence: evidence('confirmed-context-claim-message', '确认负责上下文项目')
    },
    {
      id: 'candidate-context-claim',
      subjectId: 'context-person',
      predicate: '所在城市',
      objectValue: '上海',
      confidence: 0.7,
      status: 'candidate',
      sourceNature: 'inference',
      searchText: '上下文人物所在城市上海',
      evidence: evidence('candidate-context-claim-message', '可能在上海')
    }
  ])
  store.upsertEvents([
    {
      id: 'confirmed-context-event',
      eventType: 'meeting',
      title: '确认会议',
      confidence: 1,
      status: 'confirmed',
      sourceNature: 'human_confirmation',
      searchText: '上下文人物参加确认会议',
      participants: [{ entityId: 'context-person', role: 'participant' }],
      evidence: evidence('confirmed-context-event-message', '确认参加会议')
    },
    {
      id: 'candidate-context-event',
      eventType: 'meeting',
      title: '候选会议',
      confidence: 0.7,
      status: 'candidate',
      sourceNature: 'inference',
      searchText: '上下文人物可能参加候选会议',
      participants: [{ entityId: 'context-person', role: 'participant' }],
      evidence: evidence('candidate-context-event-message', '可能参加会议')
    }
  ])
  const context = store.getTrustedExtractionMemory(['context-person'], {
    claimLimit: 1,
    eventLimit: 1
  })
  assert.deepEqual(context.claims.map(claim => claim.id), ['confirmed-context-claim'])
  assert.deepEqual(context.events.map(event => event.id), ['confirmed-context-event'])
  assert.equal(context.claimTotal, 1)
  assert.equal(context.eventTotal, 1)
  assert.deepEqual(context.events[0].participants.map((participant: any) => participant.entity_id),
    ['context-person'])
}))

test('extraction context audit is bounded, fingerprinted and never copies chat content', () => {
  const privateChatMarker = '这段私密聊天原文绝不能进入审计清单'
  const audit = buildExtractionContextAudit({
    inputFingerprint: 'A'.repeat(64),
    messages: [
      { analysisScope: 'core', content: privateChatMarker },
      { analysisScope: 'core', content: '第二条正文' },
      { analysisScope: 'context', content: '重叠正文' }
    ],
    entities: Array.from({ length: 40 }, (_, index) => ({
      id: `entity-${index}`,
      type: 'person',
      canonicalName: `人物${index}${'名'.repeat(300)}`,
      selectionReasons: ['当前发送者身份锚点', '正文或会话出现规范名', '额外原因一', '额外原因二', '超额原因']
    })),
    relations: Array.from({ length: 60 }, (_, index) => ({
      id: `relation-${index}`,
      subjectName: `人物${index}`,
      predicate: '负责',
      objectName: `项目${index}`
    })),
    claims: Array.from({ length: 60 }, (_, index) => ({
      id: `claim-${index}`,
      subject_name: `人物${index}`,
      predicate: '负责',
      object_value: `事项${index}${'值'.repeat(400)}`,
      polarity: index % 2 ? 'negative' : 'positive'
    })),
    events: Array.from({ length: 40 }, (_, index) => ({
      id: `event-${index}`,
      event_type: 'meeting',
      title: `会议${index}`,
      start_at: '2026-07-31T09:00:00.000Z'
    })),
    totals: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`metric-${index}`, index]))
  })
  assert.equal(audit.version, EXTRACTION_CONTEXT_AUDIT_VERSION)
  assert.equal(audit.contextVersion, EXTRACTION_MEMORY_CONTEXT_VERSION)
  assert.equal(audit.inputFingerprint, 'a'.repeat(64))
  assert.deepEqual(audit.messageScope, { core: 2, context: 1 })
  assert.equal(audit.entities.length, 24)
  assert.equal(audit.relations.length, 40)
  assert.equal(audit.claims.length, 36)
  assert.equal(audit.events.length, 16)
  assert.equal(Object.keys(audit.totals).length, 16)
  assert.ok(audit.entities[0].name.length <= 160)
  assert.ok(audit.entities[0].reasons.length <= 4)
  assert.ok(audit.claims[0].value.length <= 240)
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(privateChatMarker))
  assert.equal(buildExtractionContextAudit({
    inputFingerprint: 'not-a-fingerprint',
    messages: [],
    entities: [],
    relations: [],
    claims: [],
    events: [],
    totals: {}
  }).inputFingerprint, '')
})

test('task status changes are persisted as an auditable history', () => withStore(store => {
  const before = { id: 'task-history', status: 'todo', due: '2026-07-30', priority: 'medium' }
  const after = { ...before, status: 'waiting', due: '2026-08-02' }
  store.recordTaskChanges('task-history', before, after, 'manual_edit', [{ messageId: 'message-history' }])
  const history = store.listTaskHistory(['task-history'])
  assert.equal(store.countTaskHistory('task-history'), 2)
  assert.equal(store.countTaskHistory('missing-task'), 0)
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
    sensitiveRedaction: { level: 'standard', total: 2, counts: { 手机号: 1, 邮箱: 1 } },
    structuredEvidence: {
      version: 'structured-evidence-v1',
      accepted: { tasks: 2, entities: 1 },
      rejected: { tasks: 1, entities: 0 }
    },
    extractionContext: {
      version: 'extraction-context-audit-v1',
      contextVersion: 'trusted-extraction-context-v1',
      inputFingerprint: 'a'.repeat(64),
      messageScope: { core: 100, context: 40 },
      entities: [{ id: 'person-1', type: 'person', name: '人物一', reasons: ['当前发送者身份锚点'] }],
      relations: [{ id: 'relation-1', subject: '人物一', predicate: '负责', object: '项目一' }],
      claims: [{ id: 'claim-1', subject: '人物一', predicate: '负责', value: '项目一', polarity: 'positive' }],
      events: [{ id: 'event-1', type: 'meeting', title: '项目会议', startAt: '2026-07-31T09:00:00.000Z' }],
      totals: {
        selectedEntities: 4,
        directEntities: 3,
        expandedEntities: 1,
        relations: 2,
        claims: 5,
        claimMatches: 7,
        events: 2,
        eventMatches: 3
      }
    }
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
  assert.deepEqual(runs[0].batches[0].structuredEvidence, {
    version: 'structured-evidence-v1',
    accepted: { tasks: 2, entities: 1 },
    rejected: { tasks: 1, entities: 0 }
  })
  assert.deepEqual(runs[0].batches[0].extractionContext, {
    version: 'extraction-context-audit-v1',
    contextVersion: 'trusted-extraction-context-v1',
    inputFingerprint: 'a'.repeat(64),
    messageScope: { core: 100, context: 40 },
    entities: [{ id: 'person-1', type: 'person', name: '人物一', reasons: ['当前发送者身份锚点'] }],
    relations: [{ id: 'relation-1', subject: '人物一', predicate: '负责', object: '项目一' }],
    claims: [{ id: 'claim-1', subject: '人物一', predicate: '负责', value: '项目一', polarity: 'positive' }],
    events: [{ id: 'event-1', type: 'meeting', title: '项目会议', startAt: '2026-07-31T09:00:00.000Z' }],
    totals: {
      selectedEntities: 4,
      directEntities: 3,
      expandedEntities: 1,
      relations: 2,
      claims: 5,
      claimMatches: 7,
      events: 2,
      eventMatches: 3
    }
  })
  assert.deepEqual(runs[0].usage, { input_tokens: 1200, output_tokens: 300, duration_ms: 2500 })
  const summary = summarizeIngestionRuns(runs, { inputPerMillion: 1, outputPerMillion: 2 })
  assert.equal(summary.partialRuns, 1)
  assert.equal(summary.failedBatches, 1)
  assert.equal(summary.estimatedCost, 0.0018)
}))

test('ingestion run archive paginates all years and loads bounded batch audits on demand', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-ingestion-run-archive-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const database = (first as any).db
    const insertRun = database.prepare(`
      INSERT INTO ingestion_runs(
        id,started_at,finished_at,message_count,entity_count,relation_count,event_count,
        model,prompt_version,status,error
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertBatch = database.prepare(`
      INSERT INTO ingestion_batches(
        run_id,batch_index,message_count,status,attempts,error,started_at,finished_at,
        model,prompt_version,schema_version,input_tokens,output_tokens,duration_ms,
        redaction_summary_json,evidence_validation_json,extraction_context_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const statuses = ['completed', 'partial', 'failed', 'running']
    let expectedMessages = 0
    let expectedBatches = 0
    let expectedFailedBatches = 0
    database.transaction(() => {
      for (let runIndex = 0; runIndex < 1_200; runIndex += 1) {
        const startedAt = new Date(Date.UTC(2018, 0, 1 + runIndex)).toISOString()
        const status = statuses[runIndex % statuses.length]
        const messageCount = runIndex % 100
        expectedMessages += messageCount
        insertRun.run(
          `archive-run-${String(runIndex).padStart(4, '0')}`,
          startedAt,
          status === 'running' ? null : startedAt,
          messageCount,
          runIndex % 9,
          runIndex % 7,
          runIndex % 5,
          `deepseek-${runIndex % 3}`,
          `prompt-${runIndex % 4}`,
          status,
          status === 'failed' ? `可检索错误 ${runIndex}` : null
        )
        const batchCount = runIndex === 1_199 ? 125 : 3
        expectedBatches += batchCount
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
          const batchFailed = batchIndex % 17 === 0
          if (batchFailed) expectedFailedBatches += 1
          insertBatch.run(
            `archive-run-${String(runIndex).padStart(4, '0')}`,
            batchIndex,
            10,
            batchFailed ? 'failed' : 'completed',
            batchFailed ? 2 : 1,
            batchFailed ? `批次错误 ${batchIndex}` : null,
            startedAt,
            startedAt,
            `deepseek-${runIndex % 3}`,
            `prompt-${runIndex % 4}`,
            'schema-v1',
            10,
            5,
            100,
            JSON.stringify({ total: 1, marker: `redaction-${runIndex}-${batchIndex}` }),
            JSON.stringify({ version: 'evidence-v1', accepted: { tasks: 1 } }),
            JSON.stringify({
              version: 'context-v1',
              inputFingerprint: `${runIndex}-${batchIndex}`,
              entities: [{ id: 'person', name: '有界上下文' }]
            })
          )
        }
      }
    })()

    const summary = first.getIngestionArchiveSummary()
    assert.deepEqual(summary, {
      runs: 1_200,
      completedRuns: 300,
      partialRuns: 300,
      failedRuns: 300,
      runningRuns: 300,
      messages: expectedMessages,
      inputTokens: expectedBatches * 10,
      outputTokens: expectedBatches * 5,
      durationMs: expectedBatches * 100,
      failedBatches: expectedFailedBatches,
      batches: expectedBatches,
      latestRunId: summary.latestRunId,
      latestActivityAt: summary.latestActivityAt
    })
    const firstPage = first.listIngestionRunPage({ limit: 40 })
    const secondPage = first.listIngestionRunPage({ offset: 40, limit: 40 })
    assert.equal(firstPage.total, 1_200)
    assert.deepEqual(firstPage.counts, {
      running: 300, completed: 300, partial: 300, failed: 300, all: 1_200
    })
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 80)
    assert.equal(JSON.stringify(firstPage.items).includes('extraction_context_json'), false)
    assert.equal(JSON.stringify(firstPage.items).includes('有界上下文'), false)
    const failed = first.listIngestionRunPage({
      status: 'failed',
      query: '可检索错误 11',
      limit: 100
    })
    assert.ok(failed.items.length > 0)
    assert.equal(failed.items.every(item =>
      item.status === 'failed' && String(item.error).includes('可检索错误 11')
    ), true)

    const dossierFirst = first.getIngestionRunDossier('archive-run-1199', {
      batchOffset: 0,
      batchLimit: 40
    })
    const dossierSecond = first.getIngestionRunDossier('archive-run-1199', {
      batchOffset: 40,
      batchLimit: 40
    })
    assert.equal(dossierFirst.batchTotal, 125)
    assert.equal(dossierFirst.batchHasMore, true)
    assert.equal(dossierFirst.batches.length, 40)
    assert.equal(new Set([...dossierFirst.batches, ...dossierSecond.batches]
      .map((batch: any) => batch.batch_index)).size, 80)
    assert.equal(JSON.stringify(dossierFirst).includes('extraction_context_json'), false)
    assert.equal(dossierFirst.batches[0].extractionContext.entities[0].name, '有界上下文')
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const lastPage = reopened.listIngestionRunPage({ offset: 1_180, limit: 40 })
      assert.equal(lastPage.items.length, 20)
      assert.equal(lastPage.hasMore, false)
      assert.equal(reopened.getIngestionArchiveSummary().runs, 1_200)
      assert.equal(reopened.getIngestionRunDossier('archive-run-1199', {
        batchOffset: 120,
        batchLimit: 40
      }).batches.length, 5)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('prepared ingestion commits survive retries and become an auditable committed checkpoint', () => withStore(store => {
  const input = {
    commitId: 'batch-commit-test',
    runId: 'run-commit-test',
    batchIndex: 2,
    digest: { tasks: [{ title: '确认合同' }], __meta: { model: 'deepseek-test' } },
    messages: [{ id: 'message-1', sessionId: 'session-1', content: '请确认合同' }],
    checkpointKeys: ['wechat:session-1:message-1'],
    createdAt: '2026-07-30T10:00:00.000Z'
  }
  store.startIngestionRun(input.runId, 'deepseek-test', 'prompt-test')
  store.recordIngestionBatch(input.runId, input.batchIndex, input.messages.length, 'running')
  store.prepareIngestionBatchCommit(input)
  store.prepareIngestionBatchCommit(input)
  const preparedHealth = store.getIngestionCommitHealth()
  assert.equal(preparedHealth.prepared, 1)
  assert.equal(preparedHealth.preparedWechat, 1)
  assert.equal(preparedHealth.preparedDocuments, 0)
  assert.equal(preparedHealth.committed, 0)
  assert.equal(preparedHealth.recoveryFailures, 0)
  assert.match(String(preparedHealth.oldestPreparedAt), /^20/)
  const prepared = store.listPreparedIngestionBatchCommits()
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0].commitId, input.commitId)
  assert.deepEqual(prepared[0].digest, input.digest)
  assert.deepEqual(prepared[0].messages, input.messages)
  assert.deepEqual(prepared[0].checkpointKeys, input.checkpointKeys)

  store.recordIngestionBatchCommitRecoveryFailure(input.commitId, 'simulated power loss')
  assert.equal(store.getIngestionCommitHealth().recoveryFailures, 1)
  assert.equal(store.listPreparedIngestionBatchCommits()[0].recoveryAttempts, 1)

  store.finalizeIngestionBatchCommit(input.commitId, {
    model: 'deepseek-test',
    promptVersion: 'prompt-test',
    schemaVersion: 'schema-test',
    durationMs: 123
  })
  assert.deepEqual(store.listPreparedIngestionBatchCommits(), [])
  assert.deepEqual(store.getIngestionCommitHealth(), {
    prepared: 0,
    preparedWechat: 0,
    preparedDocuments: 0,
    committed: 1,
    recoveryFailures: 0,
    oldestPreparedAt: null
  })
  const status = store.getIngestionStatus()
  assert.equal(status.batches.find((row: any) => row.status === 'completed')?.count, 1)
  assert.equal(status.commitHealth.committed, 1)
  assert.deepEqual(
    [...store.getProcessedIngestionMessageKeys(input.checkpointKeys)],
    input.checkpointKeys
  )
  assert.equal(status.messageLedger.total, 1)
}))

test('durable processed-message ledger exceeds the JSON hot-cache limit and queries in bounded chunks', () => withStore(store => {
  const keys = Array.from({ length: 20_050 }, (_, index) =>
    `wechat:session-${Math.floor(index / 100)}:message-${index}`)
  assert.equal(
    store.recordProcessedIngestionMessageKeys(keys, 'bulk-ledger-test', '2026-07-31T00:00:00.000Z'),
    keys.length
  )
  assert.equal(store.recordProcessedIngestionMessageKeys(keys, 'bulk-ledger-retry'), 0)
  const query = [
    ...keys.slice(0, 405),
    ...keys.slice(9_000, 9_405),
    ...keys.slice(-405),
    'wechat:session-missing:message-missing'
  ]
  const processed = store.getProcessedIngestionMessageKeys(query)
  assert.equal(processed.size, 1_215)
  assert.equal(processed.has('wechat:session-missing:message-missing'), false)
  assert.deepEqual(store.getProcessedIngestionMessageStats(), {
    total: 20_050,
    oldestProcessedAt: '2026-07-31T00:00:00.000Z',
    latestProcessedAt: '2026-07-31T00:00:00.000Z'
  })
}))

test('document ingestion commit advances the content-version checkpoint atomically and rejects stale content', () => withStore(store => {
  const createdAt = '2026-07-30T10:00:00.000Z'
  store.upsertResources([{
    id: 'document-commit-test',
    resourceType: 'document',
    title: '项目说明',
    content: '第一版内容',
    metadata: {
      sourceId: 'documents',
      contentHash: 'hash-v1',
      scopeName: '测试目录'
    },
    createdAt,
    updatedAt: createdAt,
    evidence: [{
      messageId: 'document-message-v1',
      sessionId: 'data-source:documents',
      timestamp: 1_775_000_000,
      sender: '本机文档连接器',
      excerpt: '第一版内容'
    }]
  }])
  store.startIngestionRun('document-run-v1', 'deepseek-test', 'document-v1')
  store.recordIngestionBatch('document-run-v1', 0, 1, 'running')
  store.prepareIngestionBatchCommit({
    commitId: 'document-commit-v1',
    runId: 'document-run-v1',
    batchIndex: 0,
    digest: { claims: [] },
    messages: [{ id: 'document-message-v1' }],
    checkpointKeys: ['documents:data-source:documents:document-message-v1'],
    createdAt,
    sourceKind: 'document',
    resourceId: 'document-commit-test',
    resourceContentHash: 'hash-v1',
    completion: {
      documentAnalysisStatus: 'completed',
      documentAnalysisVersion: 'document-v1',
      documentAnalysisContentHash: 'hash-v1'
    }
  })
  assert.equal(store.listPreparedIngestionBatchCommits()[0].sourceKind, 'document')
  assert.equal(store.finalizeIngestionBatchCommit('document-commit-v1').resourceCheckpointApplied, true)
  assert.equal(store.getDocumentAnalysisStats('document-v1').completed, 1)
  assert.equal(store.getIngestionStatus().status, 'completed')
  assert.equal(store.getProcessedIngestionMessageStats().total, 0)

  store.replaceResourceContent('document-commit-test', '第二版内容', {
    contentHash: 'hash-v2',
    documentAnalysisStatus: 'pending'
  })
  store.startIngestionRun('document-run-stale', 'deepseek-test', 'document-v1')
  store.recordIngestionBatch('document-run-stale', 0, 1, 'running')
  store.prepareIngestionBatchCommit({
    commitId: 'document-commit-stale',
    runId: 'document-run-stale',
    batchIndex: 0,
    digest: { claims: [] },
    messages: [{ id: 'document-message-v1' }],
    checkpointKeys: ['documents:data-source:documents:document-message-v1'],
    createdAt,
    sourceKind: 'document',
    resourceId: 'document-commit-test',
    resourceContentHash: 'hash-v1',
    completion: {
      documentAnalysisStatus: 'completed',
      documentAnalysisVersion: 'document-v1',
      documentAnalysisContentHash: 'hash-v1'
    }
  })
  assert.equal(store.finalizeIngestionBatchCommit('document-commit-stale').resourceCheckpointApplied, false)
  assert.equal(store.getDocumentAnalysisStats('document-v1').pending, 1)
}))

test('startup reconciliation closes interrupted run ledgers without losing prepared recovery payloads', () => withStore(store => {
  store.startIngestionRun('run-interrupted', 'deepseek-test', 'prompt-test')
  store.recordIngestionBatch('run-interrupted', 0, 20, 'running')
  store.recordIngestionBatch('run-interrupted', 0, 20, 'completed')
  store.recordIngestionBatch('run-interrupted', 1, 10, 'running')
  store.prepareIngestionBatchCommit({
    commitId: 'commit-still-prepared',
    runId: 'run-interrupted',
    batchIndex: 1,
    digest: { tasks: [] },
    messages: [{ id: 'message-pending' }],
    checkpointKeys: ['wechat:session:message-pending'],
    createdAt: '2026-07-31T00:00:00.000Z'
  })

  const reconciliation = store.reconcileInterruptedIngestionRuns({
    entityCount: 7,
    relationCount: 9
  })
  assert.deepEqual(reconciliation, {
    runs: 1,
    interruptedBatches: 1,
    recoveredBatches: 1,
    pendingCommits: 1
  })
  const run = store.listIngestionRuns().find(item => item.id === 'run-interrupted')
  assert.equal(run.status, 'partial')
  assert.equal(run.message_count, 20)
  assert.equal(run.entity_count, 7)
  assert.equal(run.relation_count, 9)
  assert.equal(run.recovered_batch_count, 1)
  assert.equal(run.interrupted_batch_count, 1)
  assert.match(run.error, /1 个加密批次仍等待自动恢复/)
  assert.equal(run.batches[1].status, 'failed')
  assert.equal(store.listPreparedIngestionBatchCommits().length, 1)

  assert.deepEqual(store.reconcileInterruptedIngestionRuns({
    entityCount: 99,
    relationCount: 99
  }), {
    runs: 0,
    interruptedBatches: 0,
    recoveredBatches: 0,
    pendingCommits: 0
  })
  assert.equal(store.listIngestionRuns().find(item => item.id === 'run-interrupted').entity_count, 7)
}))

test('a recovered final batch is archived as an interrupted partial run instead of permanent running', () => withStore(store => {
  store.startIngestionRun('run-replayed', 'deepseek-test', 'prompt-test')
  store.recordIngestionBatch('run-replayed', 0, 1, 'running')
  store.prepareIngestionBatchCommit({
    commitId: 'commit-replayed',
    runId: 'run-replayed',
    batchIndex: 0,
    digest: { tasks: [] },
    messages: [{ id: 'message-replayed' }],
    checkpointKeys: ['wechat:session:message-replayed'],
    createdAt: '2026-07-31T00:00:00.000Z'
  })
  store.finalizeIngestionBatchCommit('commit-replayed')
  const reconciliation = store.reconcileInterruptedIngestionRuns({
    entityCount: 2,
    relationCount: 3
  })
  assert.equal(reconciliation.runs, 1)
  assert.equal(reconciliation.recoveredBatches, 1)
  assert.equal(reconciliation.interruptedBatches, 0)
  const run = store.listIngestionRuns()[0]
  assert.equal(run.status, 'partial')
  assert.equal(run.message_count, 1)
  assert.equal(run.batches[0].status, 'completed')
  assert.match(run.error, /1 个成功批次已保存/)
}))

test('entity insight strength is explainable and deduplicates shared evidence', () => {
  const insight = buildEntityInsights({
    entities: [
      { id: 'person-a', canonicalName: '张三', aliases: ['老张'], accountIds: [], trustStatus: 'confirmed' },
      { id: 'org-a', canonicalName: '组织甲', aliases: [], accountIds: [], trustStatus: 'confirmed' },
      { id: 'project-unconfirmed', canonicalName: '候选项目', aliases: [], accountIds: [], trustStatus: 'confirmed' }
    ],
    relations: [{
      subjectId: 'person-a',
      objectId: 'org-a',
      status: 'confirmed',
      confidence: 0.9,
      evidence: [{ messageId: 'message-shared', timestamp: 1_775_000_000 }]
    }, {
      subjectId: 'person-a',
      objectId: 'project-unconfirmed',
      status: 'candidate',
      confidence: 0.95,
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
  assert.equal(insight.pendingRelationCount, 1)
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
      trustStatus: 'confirmed',
      aliases: ['测试别名'],
      accountIds: ['wxid_forget']
    }, {
      id: 'org-keep',
      type: 'organization',
      canonicalName: '保留组织',
      trustStatus: 'confirmed',
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
  store.recordTaskReviewDecision({
    evidenceFingerprint: 'evidence-forget',
    taskId: 'task-forget',
    decision: 'rejected',
    title: '回复隐私测试人',
    source: '隐私测试群',
    evidence: evidence('message-task-forget', '请回复隐私测试人'),
    task: { id: 'task-forget', title: '回复隐私测试人', classification: 'uncertain' }
  })
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
  assert.equal(store.getTaskReviewDecision('evidence-forget'), null)
  assert.equal(store.listTaskReviewHistory('evidence-forget').length, 0)
  assert.equal(store.getRecentAssistantExchanges().length, 0)
  assert.equal(store.getDiagnostics().integrity, 'ok')
  assert.ok(store.searchText('保留组织').some(item => item.id === 'entity:org-keep'))
}))

test('task ownership feedback persists evidence-scoped decisions and suppression counts', () => withStore(store => {
  const recorded = store.recordTaskReviewDecision({
    evidenceFingerprint: 'evidence-task-1',
    taskId: 'task-review-1',
    decision: 'rejected',
    title: '查一下几点更新',
    source: '项目群',
    evidence: evidence('message-task-review-1', '我让对方查一下几点更新'),
    task: {
      id: 'task-review-1',
      title: '查一下几点更新',
      status: 'todo',
      classification: 'uncertain'
    }
  })
  assert.equal(recorded.decision, 'rejected')
  assert.equal(recorded.suppression_count, 0)

  store.recordTaskReviewSuppression('evidence-task-1')
  store.recordTaskReviewSuppression('evidence-task-1')

  const decision = store.getTaskReviewDecision('evidence-task-1')
  assert.equal(decision.suppression_count, 2)
  const recent = store.listTaskReviewDecisions()
  assert.equal(recent.length, 1)
  assert.equal(recent[0].evidence[0].messageId, 'message-task-review-1')
  assert.equal(recent[0].can_restore_snapshot, true)
  assert.equal('task_json' in recent[0], false)
  assert.deepEqual(store.getTaskReviewFeedbackStats(), {
    mine: 0,
    rejected: 1,
    suppressed: 2,
    reconciled: 0
  })

  store.recordTaskReviewReconciliation('evidence-task-1')
  assert.equal(store.listActiveTaskReviewDecisions()[0].reconciliation_count, 1)
  assert.equal(store.getTaskReviewFeedbackStats().reconciled, 1)

  const reverted = store.revokeTaskReviewDecision('evidence-task-1')
  assert.equal(reverted.task.id, 'task-review-1')
  assert.equal(store.getTaskReviewDecision('evidence-task-1'), null)
  assert.equal(store.listTaskReviewDecisions()[0].active, false)
  assert.deepEqual(
    store.listTaskReviewHistory('evidence-task-1').map(item => item.action),
    ['revoked', 'rejected']
  )
  assert.deepEqual(store.getTaskReviewFeedbackStats(), {
    mine: 0,
    rejected: 0,
    suppressed: 0,
    reconciled: 0
  })
}))

test('task review audit archive paginates decisions without exposing evidence or snapshots', () => withStore(store => {
  for (let index = 0; index < 2_500; index += 1) {
    const fingerprint = `audit-fingerprint-${String(index).padStart(4, '0')}`
    store.recordTaskReviewDecision({
      evidenceFingerprint: fingerprint,
      taskId: `audit-task-${index}`,
      decision: index % 2 === 0 ? 'mine' : 'rejected',
      title: index === 1777 ? '唯一反馈审计关键词' : `反馈审计 ${index}`,
      source: `审计来源群 ${index % 10}`,
      evidence: [{
        ...evidence(`audit-message-${index}`, `不应进入审计目录的长原文 ${index} ${'x'.repeat(500)}`)[0],
        sessionId: `audit-session-${index % 10}`
      }],
      task: {
        id: `audit-task-${index}`,
        title: `包含敏感快照 ${index} ${'s'.repeat(500)}`,
        status: 'todo',
        classification: 'uncertain'
      }
    })
    if (index % 5 === 0) store.revokeTaskReviewDecision(fingerprint)
  }

  const first = store.listTaskReviewDecisionPage({ limit: 100 })
  const second = store.listTaskReviewDecisionPage({ offset: 100, limit: 100 })
  assert.equal(first.total, 2_500)
  assert.equal(first.counts.active, 2_000)
  assert.equal(first.counts.revoked, 500)
  assert.equal(first.counts.all, 2_500)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.evidence_fingerprint)).size, 200)
  assert.equal(JSON.stringify(first.items).includes('不应进入审计目录的长原文'), false)
  assert.equal(JSON.stringify(first.items).includes('包含敏感快照'), false)
  assert.ok(first.items.every(item => !('evidence' in item) && !('task_json' in item)))
  assert.equal(store.listTaskReviewDecisionPage({ status: 'active' }).total, 2_000)
  assert.equal(store.listTaskReviewDecisionPage({ status: 'revoked' }).total, 500)
  assert.equal(store.listTaskReviewDecisionPage({ decision: 'mine' }).total, 1_250)
  assert.equal(store.listTaskReviewDecisionPage({ decision: 'rejected' }).total, 1_250)
  assert.equal(store.listTaskReviewDecisionPage({ query: '唯一反馈审计关键词' }).total, 1)
  assert.deepEqual(Object.keys(store.getTaskReviewArchiveStats()).sort(), [
    'latestActive', 'latestFingerprint', 'latestUpdatedAt', 'total'
  ])

  const detailedFingerprint = 'audit-fingerprint-1777'
  for (let index = 0; index < 60; index += 1) {
    store.revokeTaskReviewDecision(detailedFingerprint)
    store.recordTaskReviewDecision({
      evidenceFingerprint: detailedFingerprint,
      taskId: 'audit-task-1777',
      decision: index % 2 === 0 ? 'mine' : 'rejected',
      title: '唯一反馈审计关键词',
      source: '审计来源群 7',
      evidence: Array.from({ length: 30 }, (_, evidenceIndex) => ({
        messageId: `audit-detail-message-${evidenceIndex}`,
        sessionId: 'audit-detail-session',
        timestamp: 1_700_000_000 + evidenceIndex,
        sender: '审计发送者',
        excerpt: `按需证据 ${evidenceIndex}`
      })),
      task: { id: 'audit-task-1777', title: '可恢复但不能泄露的任务快照' }
    })
  }
  const dossierFirst = store.getTaskReviewDecisionDossier(detailedFingerprint, {
    historyOffset: 0,
    historyLimit: 50
  })
  const dossierSecond = store.getTaskReviewDecisionDossier(detailedFingerprint, {
    historyOffset: 50,
    historyLimit: 50
  })
  assert.equal(dossierFirst.evidence.length, 20)
  assert.equal(dossierFirst.evidenceTotal, 30)
  assert.equal(dossierFirst.history.length, 50)
  assert.equal(dossierFirst.historyHasMore, true)
  assert.equal(new Set([...dossierFirst.history, ...dossierSecond.history].map(item => item.id)).size, 100)
  assert.equal(JSON.stringify(dossierFirst).includes('可恢复但不能泄露的任务快照'), false)
  assert.ok(dossierFirst.history.every((item: any) => !('task_json' in item)))
}))

test('task review audit archive survives a SQLCipher process-style reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-review-audit-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.recordTaskReviewDecision({
      evidenceFingerprint: 'audit-restart-fingerprint',
      taskId: 'audit-restart-task',
      decision: 'rejected',
      title: '跨重启反馈审计',
      source: '跨重启群',
      evidence: evidence('audit-restart-message', '跨重启仍可按需核验'),
      task: { id: 'audit-restart-task', title: '跨重启反馈审计' }
    })
    first.revokeTaskReviewDecision('audit-restart-fingerprint')
    first.close()

    second.initialize(databasePath, key)
    const page = second.listTaskReviewDecisionPage({ query: '跨重启反馈审计' })
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.active, false)
    const dossier = second.getTaskReviewDecisionDossier('audit-restart-fingerprint')
    assert.equal(dossier.evidenceTotal, 1)
    assert.deepEqual(dossier.history.map((item: any) => item.action), ['revoked', 'rejected'])
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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
  assert.equal(store.deleteMemoryItem('event', event.id, 'not_important').suppressed, true)
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
  assert.equal(audit.find(item => item.item_kind === 'event')?.reason, 'not_important')
  assert.equal(audit.every(item => /^[a-f0-9]{20}$/.test(item.item_fingerprint)), true)
  assert.equal(JSON.stringify(audit).includes('敏感'), false)
  assert.equal(store.getDiagnostics().integrity, 'ok')
}))

test('full deletion audit archive paginates safely and survives a SQLCipher reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-deletion-audit-archive-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const database = (first as any).db
    const insert = database.prepare(`
      INSERT INTO memory_deletion_audit(
        item_kind,item_fingerprint,reason,impact_json,created_at
      ) VALUES(?,?,?,?,?)
    `)
    const transaction = database.transaction(() => {
      for (let index = 0; index < 2_500; index += 1) {
        const kind = ['claim', 'event', 'relation'][index % 3]
        const reason = index % 4 === 0 ? 'not_important' : 'manual_delete'
        insert.run(
          kind,
          `archive-${String(index).padStart(5, '0')}`,
          reason,
          JSON.stringify({
            evidence: index % 7,
            related: index % 5,
            searchDocuments: 1,
            assistantMessages: index % 2,
            forbiddenContent: `不应进入目录之外的正文 ${index} ${'x'.repeat(200)}`
          }),
          new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString()
        )
      }
    })
    transaction()

    const firstPage = first.listMemoryDeletionAuditPage({ limit: 40 })
    const secondPage = first.listMemoryDeletionAuditPage({ limit: 40, offset: 40 })
    assert.equal(firstPage.total, 2_500)
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 80)
    assert.deepEqual(firstPage.counts, {
      all: 2_500,
      claim: 834,
      event: 833,
      relation: 833,
      manual_delete: 1_875,
      not_important: 625
    })
    const filtered = first.listMemoryDeletionAuditPage({
      kind: 'event',
      reason: 'not_important',
      query: 'archive-000',
      from: new Date(Date.UTC(2020, 0, 1, 0, 0)).toISOString(),
      to: new Date(Date.UTC(2020, 0, 1, 2, 0)).toISOString(),
      limit: 100
    })
    assert.ok(filtered.items.length > 0)
    assert.equal(filtered.items.every(item =>
      item.item_kind === 'event' &&
      item.reason === 'not_important' &&
      item.item_fingerprint.includes('archive-000')
    ), true)
    assert.equal(JSON.stringify(firstPage.items).includes('forbiddenContent'), false)
    assert.equal(JSON.stringify(firstPage.items).includes('不应进入目录之外的正文'), false)
    assert.equal(JSON.stringify(firstPage.items).includes('impact_json'), false)
    assert.deepEqual(first.getMemoryDeletionAuditStats(), {
      total: 2_500,
      latestId: 2_500,
      latestCreatedAt: new Date(Date.UTC(2020, 0, 1, 0, 2_499)).toISOString()
    })
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const lastPage = reopened.listMemoryDeletionAuditPage({ offset: 2_480, limit: 40 })
      assert.equal(lastPage.items.length, 20)
      assert.equal(lastPage.hasMore, false)
      assert.equal(reopened.getMemoryDeletionAuditStats().total, 2_500)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    key.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('personal memory migrates atomically to SQLCipher and keeps encrypted backups restorable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-cipher-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const plaintext = new PersonalMemoryStore()
  const encrypted = new PersonalMemoryStore()
  try {
    plaintext.initialize(databasePath)
    plaintext.syncGraph({
      entities: [{ id: 'cipher-person', type: 'person', canonicalName: '加密测试人物', aliases: [], accountIds: [], trustStatus: 'confirmed' }],
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
      entities: [{ id: 'portable-person', type: 'person', canonicalName: '跨设备人物', aliases: [], accountIds: [], trustStatus: 'confirmed' }],
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
