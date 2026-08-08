import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { PersonalMemoryStore } from '../electron/services/personalMemoryStore.ts'
import {
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MANIFEST,
  LOCAL_EMBEDDING_CHUNK_OVERLAP,
  LOCAL_EMBEDDING_CHUNK_SIZE,
  LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE,
  LOCAL_EMBEDDING_MAX_CHUNKS,
  LOCAL_EMBEDDING_REVISION,
  LocalEmbeddingService,
  buildEmbeddingChunkDetails,
  buildEmbeddingChunks,
  meanNormalizedEmbeddings,
  recordModelCacheIntegrity,
  verifyModelCacheManifest
} from '../electron/services/localEmbeddingService.ts'
import {
  recordVectorIndexContinuation,
  recordVectorQueryOutcome,
  approximateVectorIndexNeedsRecovery,
  requestVectorIndexWarmup,
  runVectorIndexPass,
  safeCosineSimilarity,
  shouldPersistVectorQueryOutcome,
  validateEmbeddingBatch,
  vectorIndexRetryDelayMs,
  vectorIndexScheduleDelayMs,
  withVectorQueryDeadline
} from '../electron/services/vectorIndexingPolicy.ts'
import {
  GRAPH_RELATION_EVIDENCE_HOT_LIMIT,
  compactRelationEvidenceHotset
} from '../electron/services/graphEvidenceHotset.ts'
import {
  assertGraphReviewMutationRevision,
  runReversibleGraphMutation
} from '../electron/services/graphReviewMutationPolicy.ts'
import { assertTaskOwnershipMutationRevision } from '../electron/services/taskOwnershipMutationPolicy.ts'
import { assertStructuredMemoryMutationRevision } from '../electron/services/structuredMemoryMutationPolicy.ts'
import { buildMemorySearchFeedbackContext } from '../electron/services/memorySearchFeedback.ts'
import { filterModelEligibleMemoryResults } from '../electron/services/personalDataSources.ts'
import {
  filterMemorySearchResults,
  isMemorySearchPageRevisionStale,
  paginateMemoryResults
} from '../electron/services/memorySearchFilters.ts'
import { memorySearchReviewPresetOptions } from '../shared/memorySearchReviewPresets.ts'
import { buildContextualMemoryQuestion, buildMemoryQueryPlan } from '../electron/services/memoryQueryPlanner.ts'
import {
  applyReminderPreferences,
  assertReminderPreferenceMutation,
  buildTaskReminders,
  findMatchingTask,
  paginateTaskReminders
} from '../electron/services/taskIntelligence.ts'
import {
  buildEntityInsights,
  listEntityRelatedTasks,
  paginateEntityRelatedTasks,
  taskRelatesToEntity
} from '../electron/services/relationshipInsights.ts'
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
  buildStructuredExtractionEvidence,
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
import {
  buildNotificationDedupKey,
  deliverNotificationBatch,
  enqueueUniqueNotification,
  markNotificationAttempt,
  normalizeNotificationOutbox
} from '../electron/services/notificationOutbox.ts'
import {
  GRAPH_QUERY_EVIDENCE_LIMIT,
  findCommonGraphNeighbors,
  findScopedGraphPath
} from '../electron/services/graphCommonNeighbors.ts'
import {
  buildProjectDirectory,
  buildProjectInsight,
  buildProjectInsights,
  countProjectDirectory,
  paginateProjectDirectory,
  paginateProjectRisks,
  paginateProjectTasks
} from '../electron/services/projectInsights.ts'
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
import {
  GRAPH_COMMIT_RECOVERY_VERSION,
  recoverGraphStateFromSql,
  shouldRecoverGraphFromSql
} from '../shared/graphCommitRecovery.ts'
import { buildTaskCalendar, extractTaskDueDate } from '../src/utils/taskCalendar.ts'
import { buildEntitySidebarPresentation } from '../src/utils/entitySidebarPresentation.ts'
import { setKeyedLoadingState } from '../src/utils/keyedLoadingState.ts'
import { KeyedLatestRequestGates } from '../src/utils/keyedLatestRequestGates.ts'
import {
  memoryFeedbackOperationKey,
  setKeyedActionState
} from '../src/utils/memoryFeedbackOperation.ts'
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
import {
  EMPTY_RESUME_CATCHUP_RETRY_STATE,
  assessSchedulerWake,
  assessScheduledSyncResult,
  isResumeCatchupRetryDue,
  planResumeCatchupRetry,
  planScheduledSyncState,
  scheduledSyncRetryDelayMs,
  scheduledSyncTargetTimestamp,
  shouldRunResumeCatchup,
  shouldRunSchedulerWakeCatchup,
  shouldReconcileScheduledSync
} from '../electron/services/scheduledSyncPolicy.ts'

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

test('conversation policy batch is atomic when a later row fails', () => {
  withStore(store => {
    store.setConversationPolicy('existing', 'Existing', 'private', true)
    const database = (store as any).db
    database.exec(`
      CREATE TRIGGER reject_bad_conversation_policy
      BEFORE INSERT ON conversation_policy
      WHEN NEW.session_id = 'bad'
      BEGIN
        SELECT RAISE(ABORT, 'rejected for test');
      END;
    `)
    assert.throws(() => store.setConversationPoliciesBatch([
      { sessionId: 'first', displayName: 'First', sessionType: 'private', enabled: false },
      { sessionId: 'bad', displayName: 'Bad', sessionType: 'private', enabled: false }
    ]), /rejected for test/)
    assert.deepEqual(
      store.getConversationPolicyRecords().map(item => item.sessionId),
      ['existing']
    )
  })
})

test('prepared source mutation atomically commits policies and compacts recovery payload', () => {
  withStore(store => {
    store.prepareConversationSourceMutationCommit({
      commitId: 'source-commit-success',
      beforeTokens: { first: 'before-first', second: 'before-second' },
      afterTokens: { first: 'after-first', second: 'after-second' },
      policies: [
        { sessionId: 'first', displayName: 'First', sessionType: 'private', enabled: false },
        { sessionId: 'second@chatroom', displayName: 'Second', sessionType: 'group', enabled: true }
      ]
    })
    assert.equal(store.getConversationSourceMutationCommitHealth().prepared, 1)
    assert.deepEqual(store.getConversationPolicyRecords(), [])

    store.finalizeConversationSourceMutationCommit('source-commit-success')
    assert.deepEqual(store.getConversationPolicyRecords().map(item => [
      item.sessionId, item.sessionType, item.enabled
    ]).sort(), [
      ['first', 'private', false],
      ['second@chatroom', 'group', true]
    ])
    const health = store.getConversationSourceMutationCommitHealth()
    assert.equal(health.prepared, 0)
    assert.equal(health.committed, 1)
    assert.equal(health.retainedPayloadBytes, 0)
  })
})

test('source mutation finalize rolls every policy back and preserves prepared recovery on SQL failure', () => {
  withStore(store => {
    store.prepareConversationSourceMutationCommit({
      commitId: 'source-commit-failure',
      beforeTokens: { first: 'before-first', bad: 'before-bad' },
      afterTokens: { first: 'after-first', bad: 'after-bad' },
      policies: [
        { sessionId: 'first', displayName: `First ${'重复来源载荷'.repeat(500)}`, sessionType: 'private', enabled: false },
        { sessionId: 'bad', displayName: `Bad ${'重复来源载荷'.repeat(500)}`, sessionType: 'private', enabled: false }
      ]
    })
    const database = (store as any).db
    database.exec(`
      CREATE TRIGGER reject_bad_source_commit
      BEFORE INSERT ON conversation_policy
      WHEN NEW.session_id = 'bad'
      BEGIN
        SELECT RAISE(ABORT, 'source commit failure');
      END;
    `)
    assert.throws(
      () => store.finalizeConversationSourceMutationCommit('source-commit-failure'),
      /source commit failure/
    )
    store.recordConversationSourceMutationRecoveryFailure(
      'source-commit-failure',
      'source commit failure'
    )
    assert.deepEqual(store.getConversationPolicyRecords(), [])
    const prepared = store.listPreparedConversationSourceMutationCommits()
    assert.equal(prepared.length, 1)
    assert.equal(prepared[0].commitId, 'source-commit-failure')
    assert.equal(prepared[0].policies.length, 2)
    assert.match(prepared[0].policies[0].displayName, /重复来源载荷/)
    const physical = database.prepare(`
      SELECT before_tokens_json,after_tokens_json,policies_json,payload_codec,
        LENGTH(payload_blob) AS stored_bytes,LENGTH(payload_backup_blob) AS backup_bytes,
        payload_sha256,payload_original_bytes
      FROM conversation_source_mutation_commits WHERE commit_id='source-commit-failure'
    `).get()
    assert.deepEqual([
      physical.before_tokens_json, physical.after_tokens_json, physical.policies_json
    ], ['{}', '{}', '[]'])
    assert.equal(physical.payload_codec, 'gzip-json-v1')
    assert.equal(physical.backup_bytes, physical.stored_bytes)
    assert.match(physical.payload_sha256, /^[a-f0-9]{64}$/)
    assert.ok(physical.stored_bytes < physical.payload_original_bytes / 5)
    const health = store.getConversationSourceMutationCommitHealth()
    assert.equal(health.compressedPayloads, 1)
    assert.equal(health.redundantPayloads, 1)
    assert.ok(health.reclaimedPayloadBytes > 1_000)
    database.prepare(`
      UPDATE conversation_source_mutation_commits
      SET payload_blob=X'00' WHERE commit_id='source-commit-failure'
    `).run()
    assert.equal(
      store.listPreparedConversationSourceMutationCommits()[0].policies.length,
      2
    )
    assert.equal(
      store.getConversationSourceMutationCommitHealth().backupRecoveries,
      1
    )
    database.prepare(`
      UPDATE conversation_source_mutation_commits
      SET payload_sha256=? WHERE commit_id='source-commit-failure'
    `).run('0'.repeat(64))
    assert.equal(
      store.listPreparedConversationSourceMutationCommits()[0].policies.length,
      2
    )
    assert.equal(
      store.getConversationSourceMutationCommitHealth().backupRecoveries,
      2
    )
    assert.notEqual(
      database.prepare(`
        SELECT payload_sha256 FROM conversation_source_mutation_commits
        WHERE commit_id='source-commit-failure'
      `).get().payload_sha256,
      '0'.repeat(64)
    )
    database.exec('DROP TRIGGER reject_bad_source_commit')
    store.finalizeConversationSourceMutationCommit('source-commit-failure')
    assert.equal(store.getConversationSourceMutationCommitHealth().retainedPayloadBytes, 0)
  })
})

test('prepared cross-store mutation queues expose every fresh commit beyond failed first page', () => {
  withStore(store => {
    for (let index = 0; index < 251; index += 1) {
      const suffix = String(index).padStart(3, '0')
      store.prepareTaskMutationCommit({
        commitId: `task-recovery-${suffix}`,
        beforeTokens: { task: `before-${suffix}` },
        afterTokens: { task: `after-${suffix}` },
        changes: []
      })
      store.prepareConversationSourceMutationCommit({
        commitId: `source-recovery-${suffix}`,
        beforeTokens: { source: `before-${suffix}` },
        afterTokens: { source: `after-${suffix}` },
        policies: [{
          sessionId: `session-${suffix}`,
          displayName: `Session ${suffix}`,
          sessionType: 'private',
          enabled: false
        }]
      })
    }
    for (let index = 0; index < 101; index += 1) {
      const suffix = String(index).padStart(3, '0')
      store.recordTaskMutationRecoveryFailure(`task-recovery-${suffix}`, 'injected failure')
      store.recordConversationSourceMutationRecoveryFailure(
        `source-recovery-${suffix}`,
        'injected failure'
      )
    }

    const taskPage = store.listPreparedTaskMutationCommits(100)
    const sourcePage = store.listPreparedConversationSourceMutationCommits(100)
    assert.equal(taskPage.length, 100)
    assert.equal(sourcePage.length, 100)
    assert.ok(taskPage.every(commit => commit.recoveryAttempts === 0))
    assert.ok(taskPage.every(commit => commit.commitId >= 'task-recovery-101'))
    assert.ok(sourcePage.every(commit => commit.commitId >= 'source-recovery-101'))
    assert.equal(store.getTaskMutationCommitHealth().unattempted, 150)
    assert.equal(store.getConversationSourceMutationCommitHealth().unattempted, 150)
    assert.equal(store.listPreparedTaskMutationCommits(500).length, 251)
    assert.equal(store.listPreparedConversationSourceMutationCommits(500).length, 251)
  })
})

test('legacy failed cross-store payloads enter compressed cold storage after SQLCipher reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-cross-store-cold-payload-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.prepareTaskMutationCommit({
      commitId: 'legacy-cold-task',
      beforeTokens: { task: 'before' },
      afterTokens: { task: 'after' },
      changes: [{
        taskId: 'legacy-cold-task',
        before: { id: 'legacy-cold-task', detail: '旧任务载荷'.repeat(1_000) },
        after: { id: 'legacy-cold-task', detail: '新任务载荷'.repeat(1_000) },
        evidence: evidence('legacy-cold-message', '旧恢复原文'.repeat(1_000))
      }]
    })
    first.prepareConversationSourceMutationCommit({
      commitId: 'legacy-cold-source',
      beforeTokens: { source: 'before' },
      afterTokens: { source: 'after' },
      policies: [{
        sessionId: 'legacy-cold-session',
        displayName: '旧来源名称'.repeat(1_000),
        sessionType: 'private',
        enabled: false
      }]
    })
    ;(first as any).db.exec(`
      UPDATE task_mutation_commits SET recovery_attempts=1
        WHERE commit_id='legacy-cold-task';
      UPDATE conversation_source_mutation_commits SET recovery_attempts=1
        WHERE commit_id='legacy-cold-source';
    `)
    first.close()

    second.initialize(databasePath, key)
    const task = second.listPreparedTaskMutationCommits()[0]
    const source = second.listPreparedConversationSourceMutationCommits()[0]
    assert.equal(task.changes[0].before.detail, '旧任务载荷'.repeat(1_000))
    assert.equal(source.policies[0].displayName, '旧来源名称'.repeat(1_000))
    assert.equal(second.getTaskMutationCommitHealth().compressedPayloads, 1)
    assert.equal(second.getConversationSourceMutationCommitHealth().compressedPayloads, 1)
    assert.ok(second.getTaskMutationCommitHealth().reclaimedPayloadBytes > 10_000)
    assert.ok(second.getConversationSourceMutationCommitHealth().reclaimedPayloadBytes > 1_000)
    const physical = (second as any).db.prepare(`
      SELECT
        (SELECT payload_codec FROM task_mutation_commits
          WHERE commit_id='legacy-cold-task') AS task_codec,
        (SELECT payload_codec FROM conversation_source_mutation_commits
          WHERE commit_id='legacy-cold-source') AS source_codec
    `).get()
    assert.deepEqual(physical, {
      task_codec: 'gzip-json-v1',
      source_codec: 'gzip-json-v1'
    })
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('search relevance feedback is append-only, query-scoped and reversible after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-search-feedback-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32).toString('hex')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncGraph({
      entities: [{
        id: 'person-feedback',
        type: 'person',
        canonicalName: '反馈测试人物',
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    } as any)
    const context = buildMemorySearchFeedbackContext('测试查询', { sourceIds: ['wechat'] })
    const otherContext = buildMemorySearchFeedbackContext('另一个查询', { sourceIds: ['wechat'] })
    first.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'entity:person-feedback',
      action: 'helpful'
    })
    first.recordMemorySearchFeedback({
      queryFingerprint: otherContext.queryFingerprint,
      scopeFingerprint: otherContext.scopeFingerprint,
      queryText: otherContext.query,
      scopeJson: otherContext.scopeJson,
      documentId: 'entity:person-feedback',
      action: 'not_relevant'
    })
    assert.equal(first.listMemorySearchFeedback(context.queryFingerprint, context.scopeFingerprint)[0].action, 'helpful')
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      assert.equal(reopened.listMemorySearchFeedback(context.queryFingerprint, context.scopeFingerprint)[0].action, 'helpful')
      reopened.recordMemorySearchFeedback({
        queryFingerprint: context.queryFingerprint,
        scopeFingerprint: context.scopeFingerprint,
        queryText: context.query,
        scopeJson: context.scopeJson,
        documentId: 'entity:person-feedback',
        action: 'cleared'
      })
      assert.deepEqual(reopened.listMemorySearchFeedback(context.queryFingerprint, context.scopeFingerprint), [])
      assert.equal(reopened.listMemorySearchFeedback(otherContext.queryFingerprint, otherContext.scopeFingerprint)[0].action, 'not_relevant')
      reopened.forgetEntity('person-feedback')
      assert.deepEqual(reopened.listMemorySearchFeedback(otherContext.queryFingerprint, otherContext.scopeFingerprint), [])
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('search feedback archive paginates all history with stable action and text filters', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'person-feedback-archive',
      type: 'person',
      canonicalName: '反馈档案人物',
      trustStatus: 'confirmed'
    }],
    relations: [],
    reviewQueue: []
  } as any)
  for (let index = 0; index < 2_500; index += 1) {
    const context = buildMemorySearchFeedbackContext(`历史查询 ${index}`, {
      sourceIds: [index % 2 ? 'wechat' : 'calendar'],
      documentTypes: ['entity']
    })
    store.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'entity:person-feedback-archive',
      action: index % 3 === 0 ? 'helpful' : index % 3 === 1 ? 'not_relevant' : 'cleared'
    })
  }
  const first = store.getMemorySearchFeedbackArchive({ offset: 0, limit: 40 })
  const second = store.getMemorySearchFeedbackArchive({
    offset: 40, limit: 40, revision: first.revision
  })
  assert.equal(first.total, 2_500)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.equal(second.stale, false)
  assert.equal(new Set([...first.items, ...second.items].map((item: any) => item.id)).size, 80)
  assert.ok(first.items.every((item: any, index: number) =>
    index === 0 || first.items[index - 1].id > item.id))
  assert.equal(first.counts.helpful + first.counts.not_relevant + first.counts.cleared, 2_500)
  const helpful = store.getMemorySearchFeedbackArchive({ action: 'helpful', limit: 100 })
  assert.ok(helpful.items.every((item: any) => item.action === 'helpful'))
  const exact = store.getMemorySearchFeedbackArchive({ query: '历史查询 2499', limit: 10 })
  assert.equal(exact.total, 1)
  assert.equal(exact.items[0].queryText, '历史查询 2499')
  assert.deepEqual(exact.items[0].scope.documentTypes, ['entity'])
  const addedContext = buildMemorySearchFeedbackContext('新反馈', {})
  store.recordMemorySearchFeedback({
    queryFingerprint: addedContext.queryFingerprint,
    scopeFingerprint: addedContext.scopeFingerprint,
    queryText: '新反馈',
    scopeJson: addedContext.scopeJson,
    documentId: 'entity:person-feedback-archive',
    action: 'helpful'
  })
  const stale = store.getMemorySearchFeedbackArchive({
    offset: 40, limit: 40, revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.deepEqual(stale.items, [])
}))

test('search feedback purge previews full chains, requires confirmation and never revives older decisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-search-feedback-purge-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32).toString('hex')
  const store = new PersonalMemoryStore()
  try {
    store.initialize(databasePath, key)
    store.syncGraph({
      entities: [{
        id: 'person-feedback-purge',
        type: 'person',
        canonicalName: '反馈清理人物',
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    } as any)
    const target = buildMemorySearchFeedbackContext('敏感项目代号', { sourceIds: ['wechat'] })
    const retained = buildMemorySearchFeedbackContext('保留查询', { sourceIds: ['calendar'] })
    for (const action of ['helpful', 'not_relevant', 'cleared'] as const) {
      store.recordMemorySearchFeedback({
        queryFingerprint: target.queryFingerprint,
        scopeFingerprint: target.scopeFingerprint,
        queryText: target.query,
        scopeJson: target.scopeJson,
        documentId: 'entity:person-feedback-purge',
        action
      })
    }
    store.recordMemorySearchFeedback({
      queryFingerprint: retained.queryFingerprint,
      scopeFingerprint: retained.scopeFingerprint,
      queryText: retained.query,
      scopeJson: retained.scopeJson,
      documentId: 'entity:person-feedback-purge',
      action: 'helpful'
    })
    const targetHistory = store.getMemorySearchFeedbackArchive({ query: '敏感项目代号' })
    assert.equal(targetHistory.total, 3)
    const preview = store.deleteMemorySearchFeedback({ id: targetHistory.items[0].id })
    assert.equal(preview.matchingRows, 1)
    assert.equal(preview.affectedChains, 1)
    assert.equal(preview.rowsToDelete, 3)
    assert.equal(preview.removesCurrentDecisions, 0)
    assert.match(preview.revision, /^\d+$/)
    assert.throws(() => store.deleteMemorySearchFeedback({
      id: targetHistory.items[0].id,
      preview: false,
      revision: preview.revision,
      confirmation: '永久删除'
    }), /永久删除检索反馈/)
    assert.throws(() => store.deleteMemorySearchFeedback({
      preview: false,
      revision: preview.revision
    }), /请选择/)
    store.recordMemorySearchFeedback({
      queryFingerprint: retained.queryFingerprint,
      scopeFingerprint: retained.scopeFingerprint,
      queryText: retained.query,
      scopeJson: retained.scopeJson,
      documentId: 'entity:person-feedback-purge',
      action: 'cleared'
    })
    assert.throws(() => store.deleteMemorySearchFeedback({
      id: targetHistory.items[0].id,
      preview: false,
      revision: preview.revision,
      confirmation: '永久删除检索反馈'
    }), /重新预览/)
    const refreshedPreview = store.deleteMemorySearchFeedback({
      id: targetHistory.items[0].id
    })
    const deleted = store.deleteMemorySearchFeedback({
      id: targetHistory.items[0].id,
      preview: false,
      revision: refreshedPreview.revision,
      confirmation: '永久删除检索反馈'
    })
    assert.equal(deleted.deletedRows, 3)
    assert.deepEqual(store.listMemorySearchFeedback(target.queryFingerprint, target.scopeFingerprint), [])
    assert.equal(store.getMemorySearchFeedbackArchive({ query: '敏感项目代号' }).total, 0)
    assert.deepEqual(
      store.listMemorySearchFeedback(retained.queryFingerprint, retained.scopeFingerprint),
      []
    )
    store.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      assert.equal(reopened.getMemorySearchFeedbackArchive({}).total, 2)
      assert.equal(reopened.getMemorySearchFeedbackArchive({ query: '敏感项目代号' }).total, 0)
      const allPreview = reopened.deleteMemorySearchFeedback({ all: true })
      assert.equal(allPreview.rowsToDelete, 2)
      const allDeleted = reopened.deleteMemorySearchFeedback({
        all: true,
        preview: false,
        revision: allPreview.revision,
        confirmation: '永久删除检索反馈'
      })
      assert.equal(allDeleted.deletedRows, 2)
      assert.equal(reopened.getMemorySearchFeedbackArchive({}).total, 0)
    } finally {
      reopened.close()
    }
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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
    const secondPage = store.listReviewLedgerPage({
      status: 'resolved',
      offset: 40,
      limit: 40,
      revision: firstPage.revision
    })
    assert.equal(firstPage.total, 2_500)
    assert.equal(firstPage.counts.pending, 3)
    assert.equal(firstPage.counts.resolved, 2_500)
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(secondPage.stale, false)
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
    const exactReview = store.listReviewLedgerPage({
      status: 'resolved',
      reviewId: 'resolved-1777',
      limit: 1
    })
    assert.equal(exactReview.total, 1)
    assert.equal(exactReview.items[0]?.id, 'resolved-1777')
    assert.deepEqual(exactReview.counts, { pending: 0, resolved: 1, all: 1 })
    assert.equal(store.listReviewLedgerPage({
      status: 'pending',
      reviewId: 'resolved-1777'
    }).total, 0)
    store.syncGraph({
      entities: [],
      relations: [],
      reviewQueue: compacted.pending.slice(0, 2)
    } as any)
    const stalePage = store.listReviewLedgerPage({
      status: 'resolved',
      offset: 40,
      limit: 40,
      revision: firstPage.revision
    })
    assert.equal(stalePage.stale, true)
    assert.equal(stalePage.items.length, 0)
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

test('graph review directory bounds evidence while the complete archive stays pageable after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-review-evidence-page-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const evidenceRows = Array.from({ length: 125 }, (_, index) => ({
    sourceId: index % 2 === 0 ? 'wechat' : 'mail',
    sessionId: `review-session-${index % 5}`,
    messageId: `review-message-${index}`,
    timestamp: 1_700_100_000 + index,
    sender: `发送者 ${index}`,
    excerpt: `审阅原文 ${index}`
  }))
  const graph = {
    entities: [],
    relations: [],
    reviewQueue: [{
      id: 'large-review-evidence',
      kind: 'entity_creation',
      title: '大量原文候选',
      detail: '验证目录有界和完整档案',
      confidence: 0.8,
      status: 'pending',
      createdAt: '2026-08-04T16:00:00.000Z',
      entityId: 'large-review-entity',
      entityCanonicalName: '大量原文实体',
      entityType: 'person',
      evidence: evidenceRows
    }]
  }
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph(graph)
    const directoryPage = first.listReviewLedgerPage({ status: 'pending', limit: 40 })
    assert.equal(directoryPage.items[0].evidenceTotal, 125)
    assert.equal(directoryPage.items[0].evidence.length, 3)
    assert.deepEqual(
      directoryPage.items[0].evidence.map((item: any) => item.messageId),
      ['review-message-122', 'review-message-123', 'review-message-124']
    )
    assert.equal(JSON.stringify(directoryPage.items[0]).includes('审阅原文 0'), false)
    first.close()

    reopened.initialize(databasePath)
    const revision = reopened.getGraphReviewRevision()
    assert.equal(reopened.listGraphReviewEvidencePage({
      reviewId: 'large-review-evidence', offset: 0, limit: 40, revision: ''
    }).stale, true)
    const page1 = reopened.listGraphReviewEvidencePage({
      reviewId: 'large-review-evidence', offset: 0, limit: 40, revision
    })
    const page2 = reopened.listGraphReviewEvidencePage({
      reviewId: 'large-review-evidence', offset: 40, limit: 40, revision
    })
    const page3 = reopened.listGraphReviewEvidencePage({
      reviewId: 'large-review-evidence', offset: 80, limit: 100, revision
    })
    assert.equal(page1.total, 125)
    assert.equal(page1.items.length, 40)
    assert.equal(page2.items.length, 40)
    assert.equal(page3.items.length, 45)
    assert.equal(page3.hasMore, false)
    assert.equal(new Set([...page1.items, ...page2.items, ...page3.items]
      .map((item: any) => `${item.sourceId}:${item.sessionId}:${item.messageId}`)).size, 125)
    assert.equal(page1.items[0].messageId, 'review-message-124')
    assert.equal(page3.items.at(-1).messageId, 'review-message-0')

    ;(reopened as any).db.prepare(`
      UPDATE review_queue SET detail=detail || ' 已变化' WHERE id='large-review-evidence'
    `).run()
    const stale = reopened.listGraphReviewEvidencePage({
      reviewId: 'large-review-evidence', offset: 40, limit: 40, revision
    })
    assert.equal(stale.stale, true)
    assert.equal(stale.items.length, 0)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
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
    const before = {
      id: 'before',
      subjectId: 'a',
      predicate: '服务对象',
      objectId: 'b',
      directionExplanation: '乙方向甲方提供服务，甲方是服务对象。'
    }
    const after = {
      id: 'after',
      subjectId: 'b',
      predicate: '服务于',
      objectId: 'a',
      directionExplanation: '从乙方指向甲方：乙方服务于甲方。'
    }
    store.recordRelationCorrection('review-1', before, after)
    store.recordRelationCorrection('review-2', after, after)
    const rows = store.listRelationCorrections('a')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].before_predicate, '服务对象')
    assert.equal(rows[0].after_predicate, '服务于')
    assert.equal(rows[0].after_subject_id, 'b')
    assert.equal(rows[0].before_direction_explanation, before.directionExplanation)
    assert.equal(rows[0].after_direction_explanation, after.directionExplanation)
  })
})

test('legacy relation correction ledgers migrate and new direction explanations survive reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-relation-correction-ledger-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const migrated = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const database = (first as any).db
    database.exec(`
      DROP INDEX IF EXISTS idx_relation_corrections_before;
      DROP INDEX IF EXISTS idx_relation_corrections_after;
      ALTER TABLE relation_corrections RENAME TO relation_corrections_current;
      CREATE TABLE relation_corrections (
        id INTEGER PRIMARY KEY,
        review_id TEXT NOT NULL,
        before_relation_id TEXT NOT NULL,
        after_relation_id TEXT NOT NULL,
        before_subject_id TEXT NOT NULL,
        before_predicate TEXT NOT NULL,
        before_object_id TEXT NOT NULL,
        after_subject_id TEXT NOT NULL,
        after_predicate TEXT NOT NULL,
        after_object_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO relation_corrections(
        review_id,before_relation_id,after_relation_id,
        before_subject_id,before_predicate,before_object_id,
        after_subject_id,after_predicate,after_object_id,created_at
      ) VALUES(
        'legacy-review','legacy-before','legacy-after',
        'legacy-a','旧关系','legacy-b',
        'legacy-b','新关系','legacy-a','2026-08-05T00:00:00.000Z'
      );
      DROP TABLE relation_corrections_current;
      CREATE INDEX idx_relation_corrections_before
        ON relation_corrections(before_subject_id,before_object_id,created_at);
      CREATE INDEX idx_relation_corrections_after
        ON relation_corrections(after_subject_id,after_object_id,created_at);
    `)
    first.close()

    migrated.initialize(databasePath)
    const legacy = migrated.getRelationCorrectionByReview('legacy-review')
    assert.equal(legacy.before_direction_explanation, '')
    assert.equal(legacy.after_direction_explanation, '')
    migrated.recordRelationCorrection('new-review', {
      id: 'new-before',
      subjectId: 'new-a',
      predicate: '服务对象',
      objectId: 'new-b',
      directionExplanation: '新乙方向新甲方提供服务。'
    }, {
      id: 'new-after',
      subjectId: 'new-b',
      predicate: '服务于',
      objectId: 'new-a',
      directionExplanation: '从新乙方指向新甲方：新乙方服务于新甲方。'
    })
    migrated.close()

    reopened.initialize(databasePath)
    const current = reopened.getRelationCorrectionByReview('new-review')
    assert.equal(current.before_direction_explanation, '新乙方向新甲方提供服务。')
    assert.equal(
      current.after_direction_explanation,
      '从新乙方指向新甲方：新乙方服务于新甲方。'
    )
  } finally {
    first.close()
    migrated.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('entity audit sections paginate complete histories with one authoritative revision', () => withStore(store => {
  const neighbors = Array.from({ length: 125 }, (_, index) => ({
    id: `audit-neighbor-${index}`,
    type: 'person',
    canonicalName: `审计邻居 ${index}`,
    trustStatus: 'confirmed'
  }))
  store.syncGraph({
    entities: [{
      id: 'audit-center',
      type: 'person',
      canonicalName: '审计中心人物',
      trustStatus: 'confirmed'
    }, ...neighbors],
    relations: neighbors.map((neighbor, index) => ({
      id: `audit-relation-${index}`,
      subjectId: 'audit-center',
      predicate: '协作',
      objectId: neighbor.id,
      confidence: 0.9,
      status: 'confirmed',
      createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      evidence: []
    })),
    reviewQueue: []
  } as any)
  for (let index = 0; index < 125; index += 1) {
    store.recordEntityCorrection(
      'audit-center',
      `audit-name-review-${index}`,
      `错误名称 ${index}`,
      `审计中心人物 ${index}`
    )
    store.recordEntityProfileCorrection(
      'audit-center',
      `audit-profile-review-${index}`,
      index % 2 ? 'alias' : 'summary',
      `模型建议 ${index}`,
      `人工最终值 ${index}`
    )
    store.recordRelationCorrection(
      `audit-relation-review-${index}`,
      {
        id: `before-audit-${index}`,
        subjectId: 'audit-center',
        predicate: '错误关系',
        objectId: neighbors[index].id
      },
      {
        id: `after-audit-${index}`,
        subjectId: neighbors[index].id,
        predicate: '服务于',
        objectId: 'audit-center'
      }
    )
  }
  const kinds = [
    'relation_history',
    'name_correction',
    'relation_correction',
    'profile_correction'
  ] as const
  const firstPages = kinds.map(kind => store.listEntityAuditPage({
    entityId: 'audit-center', kind, limit: 40
  }))
  for (const [index, first] of firstPages.entries()) {
    const second = store.listEntityAuditPage({
      entityId: 'audit-center',
      kind: kinds[index],
      limit: 40,
      offset: 40,
      revision: first.revision
    })
    assert.equal(first.total, 125)
    assert.equal(first.items.length, 40)
    assert.equal(first.hasMore, true)
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 80)
  }
  const relationCorrection = firstPages[2].items[0]
  assert.match(String(relationCorrection.before_object_name), /审计邻居/)
  assert.equal(relationCorrection.after_object_name, '审计中心人物')
  assert.equal(store.listEntityAuditPage({
    entityId: 'audit-center',
    kind: 'profile_correction',
    limit: 40,
    offset: 40
  }).stale, true)

  store.recordEntityCorrection(
    'audit-center',
    'audit-concurrent-name-review',
    '并发旧名',
    '并发新名'
  )
  assert.equal(store.listEntityAuditPage({
    entityId: 'audit-center',
    kind: 'relation_history',
    limit: 40,
    offset: 40,
    revision: firstPages[0].revision
  }).stale, true)
}))

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
    evidence: [
      { sourceId: 'wechat', sessionId: 'source-session', messageId: 'source-evidence' },
      { sourceId: 'wechat', sessionId: 'source-session', messageId: 'shared-evidence' },
      { sourceId: 'wechat', sessionId: 'other-session', messageId: 'shared-evidence' }
    ],
    confidence: 0.7,
    status: 'candidate'
  }
  const existing = {
    id: relationSemanticId('b', '服务于', 'a'),
    subjectId: 'b',
    predicate: '服务于',
    objectId: 'a',
    evidence: [
      { sourceId: 'wechat', sessionId: 'target-session', messageId: 'existing-evidence' },
      { sourceId: 'wechat', sessionId: 'source-session', messageId: 'shared-evidence' }
    ],
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
    result.confirmedRelation.evidence.map((item: any) =>
      `${item.sessionId}:${item.messageId}`).sort(),
    [
      'other-session:shared-evidence',
      'source-session:shared-evidence',
      'source-session:source-evidence',
      'target-session:existing-evidence'
    ]
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
        relations: [],
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
    const secondPage = first.listMergeHistoryPage({
      limit: 40, offset: 40, revision: firstPage.revision
    })
    assert.equal(firstPage.total, 2_500)
    assert.deepEqual(firstPage.counts, { active: 2_000, reverted: 500, all: 2_500 })
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(secondPage.stale, false)
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
    database.prepare('UPDATE merge_history SET target_name=target_name WHERE id=2').run()
    const stale = first.listMergeHistoryPage({
      limit: 40, offset: 40, revision: firstPage.revision
    })
    assert.equal(stale.stale, true)
    assert.deepEqual(stale.items, [])
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
      const reopenedFirstPage = reopened.listMergeHistoryPage({ limit: 1 })
      assert.equal(reopened.listMergeHistoryPage({ offset: 1, limit: 1 }).stale, true)
      const lastPage = reopened.listMergeHistoryPage({
        offset: 2_480,
        limit: 40,
        revision: reopenedFirstPage.revision
      })
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

test('identity merge snapshots are scoped on write and legacy full-graph snapshots compact on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-merge-snapshot-scope-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const source = { id: 'source', canonicalName: '甲' }
    const target = { id: 'target', canonicalName: '乙' }
    const affected = { id: 'affected', subjectId: 'source', predicate: '认识', objectId: 'person-1' }
    const unrelated = Array.from({ length: 5_000 }, (_, index) => ({
      id: `unrelated-${index}`,
      subjectId: `left-${index}`,
      predicate: '无关',
      objectId: `right-${index}`,
      evidence: [{ messageId: `m-${index}`, excerpt: '大图关系不应留在快照' }]
    }))
    const scopedId = first.recordMerge('source', 'target', {
      source, target, relations: [affected, ...unrelated],
      sourceEventParticipants: [], targetEventParticipants: [], affectedReviews: []
    })
    const database = (first as any).db
    const scoped = JSON.parse(String(database.prepare(
      'SELECT snapshot_json FROM merge_history WHERE id=?'
    ).pluck().get(scopedId)))
    assert.equal(scoped.version, 'identity-merge-snapshot-v2')
    assert.deepEqual(scoped.relations.map((item: any) => item.id), ['affected'])

    const legacyJson = JSON.stringify({
      source: { id: 'legacy-source', canonicalName: '旧甲' },
      target: { id: 'legacy-target', canonicalName: '旧乙' },
      relations: [
        { id: 'legacy-affected', subjectId: 'legacy-target', predicate: '认识', objectId: 'person-2' },
        ...unrelated
      ],
      sourceEventParticipants: [], targetEventParticipants: [], affectedReviews: [],
      fullGraph: { private: 'legacy-extra-copy' }
    })
    database.prepare(`
      INSERT INTO merge_history(source_entity_id,target_entity_id,source_name,target_name,snapshot_json,created_at)
      VALUES('legacy-source','legacy-target','旧甲','旧乙',?,?)
    `).run(legacyJson, new Date().toISOString())
    database.prepare("DELETE FROM schema_meta WHERE key='identity_merge_snapshot_storage_v2'").run()
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath, key)
    const reopenedDatabase = (reopened as any).db
    const legacy = JSON.parse(String(reopenedDatabase.prepare(`
      SELECT snapshot_json FROM merge_history WHERE source_entity_id='legacy-source'
    `).pluck().get()))
    assert.equal(legacy.version, 'identity-merge-snapshot-v2')
    assert.deepEqual(legacy.relations.map((item: any) => item.id), ['legacy-affected'])
    assert.equal('fullGraph' in legacy, false)
    const stats = reopened.getIdentityMergeSnapshotStorageStats()
    assert.equal(stats.rows, 2)
    assert.ok(stats.migration.rowsCompacted >= 1)
    assert.ok(stats.migration.relationsRemoved >= 5_000)
    assert.ok(stats.migration.bytesReclaimed > 100_000)
    reopened.close()
  } finally {
    try { first.close() } catch {}
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
    directionExplanation: '从人物甲指向组织乙：人物甲服务于组织乙。',
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
  assert.deepEqual(
    history.map(item => item.direction_explanation),
    [relation.directionExplanation, relation.directionExplanation]
  )
  assert.deepEqual(
    history.map(item => item.direction_explanation_recorded),
    [1, 1]
  )
}))

test('relation direction authority survives reopen, empty syncs and search index repair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-relation-direction-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const entities = [
    {
      id: 'direction-person',
      type: 'person',
      canonicalName: '方向人物',
      aliases: [],
      accountIds: [],
      trustStatus: 'confirmed'
    },
    {
      id: 'direction-org',
      type: 'organization',
      canonicalName: '方向组织',
      aliases: [],
      accountIds: [],
      trustStatus: 'confirmed'
    }
  ]
  const relation = {
    id: 'direction-authority',
    subjectId: 'direction-person',
    predicate: '服务于',
    objectId: 'direction-org',
    confidence: 0.9,
    status: 'confirmed',
    directionExplanation: '',
    evidence: [],
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }
  const authoritativeExplanation = '从“方向人物”指向“方向组织”：方向人物负责海盐计划。'
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({ entities, relations: [relation], reviewQueue: [] } as any)
    ;(first as any).db.prepare(`
      UPDATE search_documents
      SET embedding_model='test-model',embedding_dimensions=2,embedding_json='[0.6,0.8]',
        embedding_chunk_count=1
      WHERE id='relation:direction-authority'
    `).run()
    ;(first as any).db.prepare(`
      INSERT INTO search_document_embedding_chunks(
        document_id,chunk_index,model,dimensions,vector_json,content_hash,chunk_hash,
        start_offset,end_offset,updated_at
      )
      SELECT id,0,'test-model',2,'[0.6,0.8]',content_hash,'legacy-direction-chunk',
        0,LENGTH(title || char(10) || search_text),updated_at
      FROM search_documents WHERE id='relation:direction-authority'
    `).run()
    const correctedRelation = {
      ...relation,
      directionExplanation: authoritativeExplanation,
      updatedAt: '2026-08-05T01:00:00.000Z'
    }
    first.syncGraph({ entities, relations: [correctedRelation], reviewQueue: [] } as any)
    const originalDocument = (first as any).db.prepare(`
      SELECT search_text,metadata_json,embedding_model
      FROM search_documents WHERE id='relation:direction-authority'
    `).get()
    assert.equal(
      JSON.parse(originalDocument.metadata_json).directionExplanation,
      authoritativeExplanation
    )
    assert.match(originalDocument.search_text, /方向人物负责海盐计划/)
    assert.equal(originalDocument.embedding_model, null)
    assert.equal((first as any).db.prepare(`
      SELECT COUNT(*) AS count FROM search_document_embedding_chunks
      WHERE document_id='relation:direction-authority'
    `).get().count, 0)
    assert.equal(first.searchText('海盐计划').some((row: any) =>
      row.id === 'relation:direction-authority'), true)
    first.close()

    reopened.initialize(databasePath)
    assert.equal(
      reopened.loadGraphSnapshot().relations[0].directionExplanation,
      authoritativeExplanation
    )
    const stateRelation = { ...correctedRelation, directionExplanation: '' }
    reopened.syncGraph({
      entities,
      relations: [stateRelation],
      reviewQueue: []
    } as any)
    assert.equal(stateRelation.directionExplanation, authoritativeExplanation)
    assert.equal(
      reopened.loadGraphSnapshot().relations[0].directionExplanation,
      authoritativeExplanation
    )

    ;(reopened as any).db.prepare(`
      UPDATE search_documents SET metadata_json='{"status":"candidate"}'
      WHERE id='relation:direction-authority'
    `).run()
    ;(reopened as any).repairStructuredSearchIndex()
    const repairedDocument = (reopened as any).db.prepare(`
      SELECT metadata_json FROM search_documents WHERE id='relation:direction-authority'
    `).get()
    assert.equal(
      JSON.parse(repairedDocument.metadata_json).directionExplanation,
      authoritativeExplanation
    )
    assert.match(
      (reopened as any).db.prepare(`
        SELECT search_text FROM search_documents WHERE id='relation:direction-authority'
      `).get().search_text,
      /方向人物负责海盐计划/
    )

    const history = reopened.listRelationHistory('direction-person')
    assert.deepEqual(
      history.map((item: any) => item.change_type),
      ['direction_updated', 'created']
    )
    assert.equal(
      JSON.parse(history[0].snapshot_json).directionExplanation,
      authoritativeExplanation
    )
    assert.equal(history[0].direction_explanation, authoritativeExplanation)
    assert.equal(history[0].direction_explanation_recorded, 1)
    ;(reopened as any).db.prepare(`
      UPDATE relation_history SET snapshot_json='{malformed'
      WHERE id=?
    `).run(history[0].id)
    const malformedHistory = reopened.listRelationHistory('direction-person')
    assert.equal(malformedHistory[0].direction_explanation, '')
    assert.equal(malformedHistory[0].direction_explanation_recorded, 0)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('event timeline filters cross-source evidence, status and time with stable pagination', () => withStore(store => {
  const makeEvent = (
    id: string,
    sourceSession: string,
    startAt: string,
    status: string,
    sourceId = sourceSession.includes('calendar') ? 'calendar'
      : sourceSession.includes('documents') ? 'documents' : 'wechat'
  ) => ({
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
      sourceId,
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
    makeEvent('rejected-event', 'data-source:calendar:work', '2026-08-01T10:00:00.000Z', 'rejected'),
    makeEvent('mail-event', 'shared-session', '2026-07-26T10:00:00.000Z', 'candidate', 'mail'),
    makeEvent('legacy-event', 'shared-session', '2026-07-25T10:00:00.000Z', 'candidate', 'legacy')
  ])

  const calendar = store.listEventTimeline({ sourceId: 'calendar', limit: 1 })
  assert.equal(calendar.total, 2)
  assert.equal(calendar.items[0].id, 'cancelled-event')
  assert.equal(calendar.items[0].source_id, 'calendar')
  assert.equal(calendar.hasMore, true)
  assert.equal(calendar.stale, false)
  assert.equal(calendar.items[0].evidence[0].session_id, 'data-source:calendar:work')
  ;(store as any).db.prepare(`UPDATE events SET updated_at=? WHERE id=?`)
    .run('2026-08-03T00:00:00.000Z', 'wechat-event')
  const staleCalendarPage = store.listEventTimeline({
    sourceId: 'calendar',
    offset: 1,
    limit: 1,
    revision: calendar.revision
  })
  assert.equal(staleCalendarPage.stale, true)
  assert.equal(staleCalendarPage.items.length, 0)

  const confirmed = store.listEventTimeline({
    status: 'confirmed',
    query: 'calendar-event',
    from: '2026-07-30T00:00:00.000Z',
    to: '2026-07-30T23:59:59.999Z'
  })
  assert.deepEqual(confirmed.items.map(item => item.id), ['calendar-event'])
  assert.equal(store.listEventTimeline({ query: '不存在的事件关键词' }).total, 0)
  assert.equal(store.listEventTimeline({ sourceId: 'documents' }).items[0].id, 'document-event')
  assert.equal(store.listEventTimeline({ sourceId: 'wechat' }).items[0].id, 'wechat-event')
  assert.equal(store.listEventTimeline({ sourceId: 'mail' }).items[0].id, 'mail-event')
  assert.equal(store.listEventTimeline({ sourceId: 'legacy' }).items[0].id, 'legacy-event')
  assert.deepEqual(
    store.listEventTimeline({ eventTypes: ['calendar'] }).items.map(item => item.id),
    ['cancelled-event', 'calendar-event']
  )
  assert.deepEqual(
    store.listEventTimeline({ eventTypes: ['meeting'], status: 'candidate' })
      .items.map(item => item.id),
    ['document-event', 'wechat-event', 'mail-event', 'legacy-event']
  )

  const manyEvidence = Array.from({ length: 25 }, (_, index) => ({
    sourceId: 'wechat',
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

test('project key event timeline pages beyond legacy workspace windows and rejects stale continuation', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'long-running-project',
      type: 'project',
      canonicalName: '多年项目',
      aliases: [],
      accountIds: [],
      trustStatus: 'confirmed',
      confidence: 1,
      summary: ''
    }],
    relations: [],
    reviewQueue: []
  })
  const keyTypes = ['decision', 'delivery', 'meeting', 'organization_change']
  const events = Array.from({ length: 260 }, (_, index) => {
    const timestamp = new Date(Date.UTC(2022, 0, 1 + index)).toISOString()
    return {
      id: `long-project-key-${String(index).padStart(3, '0')}`,
      eventType: keyTypes[index % keyTypes.length],
      title: `多年项目关键事件 ${index}`,
      description: `第 ${index} 个项目决策或里程碑`,
      startAt: timestamp,
      endAt: '',
      location: '',
      confidence: 1,
      status: 'confirmed',
      searchText: `多年项目关键事件 ${index}`,
      createdAt: timestamp,
      participants: [{ entityId: 'long-running-project', role: 'project' }],
      evidence: []
    }
  })
  store.upsertEvents(events)
  store.upsertEvents(Array.from({ length: 45 }, (_, index) => ({
    ...events[index],
    id: `long-project-generic-${String(index).padStart(3, '0')}`,
    eventType: 'conversation',
    title: `不应进入关键时间线 ${index}`
  })))

  const first = store.listEventTimeline({
    entityId: 'long-running-project',
    eventTypes: keyTypes,
    limit: 40
  })
  assert.equal(first.total, 260)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  const collected = [...first.items]
  let offset = first.items.length
  while (offset < first.total) {
    const page = store.listEventTimeline({
      entityId: 'long-running-project',
      eventTypes: keyTypes,
      limit: 40,
      offset,
      revision: first.revision
    })
    assert.equal(page.stale, false)
    collected.push(...page.items)
    offset += page.items.length
  }
  assert.equal(collected.length, 260)
  assert.ok(collected.some(item => item.id === 'long-project-key-000'))
  assert.ok(!collected.some(item => item.id.startsWith('long-project-generic-')))

  ;(store as any).db.prepare(`UPDATE events SET updated_at=? WHERE id=?`)
    .run('2030-01-01T00:00:00.000Z', 'long-project-key-000')
  const stale = store.listEventTimeline({
    entityId: 'long-running-project',
    eventTypes: keyTypes,
    limit: 40,
    offset: 40,
    revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
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
    { id: 'person-d', type: 'person', canonicalName: '异常幅值人物' },
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
  store.saveEmbedding('entity:person-d', 'identity-test', [100, -100])
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

test('claim and event extraction batches roll back authority, evidence and search together', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'atomic-structured-person',
      type: 'person',
      canonicalName: '结构化原子人物',
      trustStatus: 'confirmed',
      confidence: 1,
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  })
  const database = (store as any).db
  const claims = [{
    id: 'atomic-claim-a',
    subjectId: 'atomic-structured-person',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.9,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '结构化原子人物 所在城市 上海',
    evidence: evidence('atomic-claim-message-a', '我在上海')
  }, {
    id: 'atomic-claim-b',
    subjectId: 'atomic-structured-person',
    predicate: '所在城市',
    objectValue: '杭州',
    confidence: 0.8,
    status: 'confirmed',
    sourceNature: 'other_statement',
    searchText: '结构化原子人物 所在城市 杭州',
    evidence: evidence('atomic-claim-message-b', '听说他在杭州')
  }]
  database.exec(`
    CREATE TRIGGER fail_second_claim_search
    BEFORE INSERT ON search_documents
    WHEN NEW.id='claim:atomic-claim-b'
    BEGIN
      SELECT RAISE(ABORT,'forced second claim search failure');
    END;
  `)
  const claimSearchRevision = store.getMemorySearchRevision()
  const claimStructuredRevision = store.getStructuredMemoryRevision()
  const claimEvidenceRevision = store.getMemoryEvidenceArchiveRevision()
  assert.throws(() => store.upsertClaims(claims), /forced second claim search failure/)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM claims
    WHERE id IN ('atomic-claim-a','atomic-claim-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM evidence
    WHERE claim_id IN ('atomic-claim-a','atomic-claim-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id IN ('claim:atomic-claim-a','claim:atomic-claim-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id IN ('claim:atomic-claim-a','claim:atomic-claim-b')
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), claimSearchRevision)
  assert.equal(store.getStructuredMemoryRevision(), claimStructuredRevision)
  assert.equal(store.getMemoryEvidenceArchiveRevision(), claimEvidenceRevision)
  assert.deepEqual(claims.map(claim => claim.status), ['confirmed', 'confirmed'])
  database.exec('DROP TRIGGER fail_second_claim_search')

  const events = [{
    id: 'atomic-event-a',
    eventType: 'meeting',
    title: '结构化原子会议甲',
    description: '第一条必须随第二条一起回滚',
    confidence: 0.9,
    status: 'candidate',
    searchText: '结构化原子会议甲 第一条',
    participants: [],
    evidence: evidence('atomic-event-message-a', '会议甲原文')
  }, {
    id: 'atomic-event-b',
    eventType: 'meeting',
    title: '结构化原子会议乙',
    description: '第二条触发搜索故障',
    confidence: 0.8,
    status: 'candidate',
    searchText: '结构化原子会议乙 第二条',
    participants: [],
    evidence: evidence('atomic-event-message-b', '会议乙原文')
  }]
  database.exec(`
    CREATE TRIGGER fail_second_event_search
    BEFORE INSERT ON search_documents
    WHEN NEW.id='event:atomic-event-b'
    BEGIN
      SELECT RAISE(ABORT,'forced second event search failure');
    END;
  `)
  const eventSearchRevision = store.getMemorySearchRevision()
  const eventStructuredRevision = store.getStructuredMemoryRevision()
  const eventEvidenceRevision = store.getMemoryEvidenceArchiveRevision()
  const graphRevision = store.getGraphReviewRevision()
  const graph = {
    entities: [{
      id: 'atomic-structured-person',
      type: 'person',
      canonicalName: '结构化原子人物',
      trustStatus: 'confirmed',
      confidence: 1,
      aliases: [],
      accountIds: []
    }, {
      id: 'atomic-structured-project',
      type: 'project',
      canonicalName: '结构化原子项目',
      trustStatus: 'confirmed',
      confidence: 0.9,
      aliases: [],
      accountIds: []
    }],
    relations: [{
      id: 'atomic-structured-relation',
      subjectId: 'atomic-structured-person',
      predicate: '参与',
      objectId: 'atomic-structured-project',
      status: 'candidate',
      confidence: 0.8,
      evidence: evidence('atomic-relation-message', '我参与结构化原子项目')
    }],
    reviewQueue: [{
      id: 'atomic-structured-review',
      kind: 'relation',
      title: '结构化原子关系候选',
      detail: '等待确认',
      status: 'pending',
      confidence: 0.8,
      relationId: 'atomic-structured-relation'
    }]
  }
  assert.throws(() => store.syncGraphAndStructuredMemory(
    graph as any,
    'atomic-structured-commit',
    [{
      entityId: 'atomic-structured-project',
      sourceId: 'wechat',
      messageId: 'atomic-project-message',
      sessionId: 'atomic-structured-session',
      timestamp: 3,
      sender: '结构化发送者',
      excerpt: '结构化原子项目身份依据',
      evidenceKind: 'identity'
    }],
    claims,
    events
  ), /forced second event search failure/)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM entities WHERE id='atomic-structured-project'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM relations WHERE id='atomic-structured-relation'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM review_queue WHERE id='atomic-structured-review'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM entity_evidence
    WHERE entity_id='atomic-structured-project'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM claims
    WHERE id IN ('atomic-claim-a','atomic-claim-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE id IN ('atomic-event-a','atomic-event-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM evidence
    WHERE claim_id IN ('atomic-claim-a','atomic-claim-b')
      OR event_id IN ('atomic-event-a','atomic-event-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id IN (
      'entity:atomic-structured-project',
      'relation:atomic-structured-relation',
      'claim:atomic-claim-a','claim:atomic-claim-b',
      'event:atomic-event-a','event:atomic-event-b'
    )
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id IN (
      'entity:atomic-structured-project',
      'relation:atomic-structured-relation',
      'claim:atomic-claim-a','claim:atomic-claim-b',
      'event:atomic-event-a','event:atomic-event-b'
    )
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), eventSearchRevision)
  assert.equal(store.getStructuredMemoryRevision(), eventStructuredRevision)
  assert.equal(store.getMemoryEvidenceArchiveRevision(), eventEvidenceRevision)
  assert.equal(store.getGraphReviewRevision(), graphRevision)
  assert.deepEqual(events.map(event => event.id), ['atomic-event-a', 'atomic-event-b'])
}))

test('model graph, structured memory and tasks roll back as one batch', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'model-batch-person',
      type: 'person',
      canonicalName: '模型批次人物',
      trustStatus: 'confirmed'
    }],
    relations: [],
    reviewQueue: []
  } as any)
  const database = (store as any).db
  store.recordTaskReviewDecision({
    evidenceFingerprint: 'model-batch-suppression',
    taskId: 'previously-rejected-task',
    decision: 'rejected',
    title: '历史拒绝任务',
    source: '模型批次'
  })
  database.exec(`
    CREATE TRIGGER fail_model_batch_task_search
    BEFORE INSERT ON search_documents
    WHEN NEW.id='task:model-batch-task'
    BEGIN
      SELECT RAISE(ABORT,'forced model task search failure');
    END;
  `)
  const revisions = {
    search: store.getMemorySearchRevision(),
    structured: store.getStructuredMemoryRevision(),
    evidence: store.getMemoryEvidenceArchiveRevision(),
    graph: store.getGraphReviewRevision(),
    tasks: store.getTaskArchiveRevision(),
    taskOwnership: store.getTaskOwnershipReviewRevision()
  }
  const graph = {
    entities: [{
      id: 'model-batch-person',
      type: 'person',
      canonicalName: '模型批次人物',
      trustStatus: 'confirmed'
    }, {
      id: 'model-batch-project',
      type: 'project',
      canonicalName: '模型批次项目',
      trustStatus: 'candidate'
    }],
    relations: [{
      id: 'model-batch-relation',
      subjectId: 'model-batch-person',
      predicate: '负责',
      objectId: 'model-batch-project',
      status: 'candidate',
      confidence: 0.8,
      evidence: evidence('model-batch-relation-message', '我负责模型批次项目')
    }],
    reviewQueue: []
  }
  const task = {
    id: 'model-batch-task',
    title: '完成模型批次项目',
    detail: '必须和图谱及事实一起提交',
    owner: '我',
    status: 'todo',
    classification: 'mine',
    priority: 'high',
    taskKind: 'action',
    source: '微信',
    sourceSessionId: 'model-batch-session',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    evidence: evidence('model-batch-task-message', '请完成模型批次项目')
  }
  assert.throws(() => store.syncGraphAndStructuredMemory(
    graph as any,
    'model-batch-commit',
    [],
    [{
      id: 'model-batch-claim',
      subjectId: 'model-batch-person',
      predicate: '负责项目',
      objectEntityId: 'model-batch-project',
      confidence: 0.9,
      status: 'candidate',
      searchText: '模型批次人物 负责 模型批次项目',
      evidence: evidence('model-batch-claim-message', '我负责模型批次项目')
    }],
    [{
      id: 'model-batch-event',
      eventType: 'work',
      title: '启动模型批次项目',
      confidence: 0.8,
      status: 'candidate',
      searchText: '启动模型批次项目',
      participants: [],
      evidence: evidence('model-batch-event-message', '模型批次项目今天启动')
    }],
    {
      tasks: [task],
      changes: [{
        taskId: task.id,
        before: {},
        after: task,
        reason: 'created_from_model_batch',
        evidence: task.evidence
      }]
    }
  ), /forced model task search failure/)
  for (const [table, ids] of [
    ['entities', ['model-batch-project']],
    ['relations', ['model-batch-relation']],
    ['claims', ['model-batch-claim']],
    ['events', ['model-batch-event']],
    ['task_directory', ['model-batch-task']]
  ] as const) {
    assert.equal(Number(database.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`
    ).get(...ids).count), 0)
  }
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM task_history WHERE task_id='model-batch-task'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM task_history_evidence WHERE task_id='model-batch-task'
  `).get().count), 0)
  assert.equal(store.getTaskReviewDecision('model-batch-suppression').suppression_count, 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id IN (
      'entity:model-batch-project','relation:model-batch-relation',
      'claim:model-batch-claim','event:model-batch-event','task:model-batch-task'
    )
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), revisions.search)
  assert.equal(store.getStructuredMemoryRevision(), revisions.structured)
  assert.equal(store.getMemoryEvidenceArchiveRevision(), revisions.evidence)
  assert.equal(store.getGraphReviewRevision(), revisions.graph)
  assert.equal(store.getTaskArchiveRevision(), revisions.tasks)
  assert.equal(store.getTaskOwnershipReviewRevision(), revisions.taskOwnership)
  database.exec('DROP TRIGGER fail_model_batch_task_search')
  store.prepareIngestionBatchCommit({
    commitId: 'model-batch-suppression-commit',
    runId: 'model-batch-suppression-run',
    batchIndex: 0,
    digest: {},
    messages: [],
    checkpointKeys: [],
    createdAt: '2026-08-06T00:00:00.000Z'
  })
  store.finalizeIngestionBatchCommit('model-batch-suppression-commit', {
    taskReviewSuppressionFingerprints: ['model-batch-suppression']
  })
  store.finalizeIngestionBatchCommit('model-batch-suppression-commit', {
    taskReviewSuppressionFingerprints: ['model-batch-suppression']
  })
  assert.equal(store.getTaskReviewDecision('model-batch-suppression').suppression_count, 1)
  assert.ok(Number(store.getTaskOwnershipReviewRevision()) > Number(revisions.taskOwnership))
}))

test('structured search dossiers bind the exact type, id and current search revision', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'dossier-person',
      type: 'person',
      canonicalName: '档案人物',
      trustStatus: 'confirmed'
    }, {
      id: 'dossier-project',
      type: 'project',
      canonicalName: '档案项目',
      trustStatus: 'confirmed'
    }],
    relations: [{
      id: 'dossier-relation',
      subjectId: 'dossier-person',
      predicate: '负责',
      objectId: 'dossier-project',
      confidence: 0.91,
      status: 'confirmed',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'dossier-relation-message',
        sessionId: 'dossier-session',
        timestamp: 1_780_000_001,
        sender: '档案人物',
        excerpt: '我负责档案项目'
      }]
    }],
    reviewQueue: []
  } as any)
  store.upsertClaims([{
    id: 'dossier-claim',
    subjectId: 'dossier-person',
    predicate: '所在城市',
    objectValue: '上海',
    confidence: 0.93,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '档案人物 所在城市 上海',
    evidence: [{
      sourceId: 'wechat',
      messageId: 'dossier-claim-message',
      sessionId: 'dossier-session',
      timestamp: 1_780_000_002,
      sender: '档案人物',
      excerpt: '我在上海'
    }]
  }])
  store.upsertEvents([{
    id: 'dossier-event',
    eventType: 'meeting',
    title: '档案会议',
    description: '讨论档案项目',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '',
    location: '上海',
    confidence: 0.88,
    status: 'candidate',
    searchText: '档案会议 讨论档案项目',
    participants: [{ entityId: 'dossier-person', role: '主持人' }],
    evidence: [{
      sourceId: 'wechat',
      messageId: 'dossier-event-message',
      sessionId: 'dossier-session',
      timestamp: 1_780_000_003,
      sender: '档案人物',
      excerpt: '明天开档案会议'
    }]
  }])

  const revision = store.getMemorySearchRevision()
  const claim = store.getStructuredMemoryDossier('claim', 'dossier-claim', revision)
  const event = store.getStructuredMemoryDossier('event', 'dossier-event', revision)
  const relation = store.getStructuredMemoryDossier('relation', 'dossier-relation', revision)
  assert.equal(claim.stale, false)
  assert.equal(claim.item.subject_name, '档案人物')
  assert.equal(claim.item.object_value, '上海')
  assert.equal(claim.item.evidence[0].message_id, 'dossier-claim-message')
  assert.equal(event.item.participants[0].entity_id, 'dossier-person')
  assert.equal(event.item.evidence_count, 1)
  assert.equal(relation.item.subject_name, '档案人物')
  assert.equal(relation.item.object_name, '档案项目')
  assert.equal(relation.item.evidence[0].message_id, 'dossier-relation-message')
  assert.equal(
    store.getCurrentStructuredMemoryDossier('claim', 'dossier-claim').item.object_value,
    '上海'
  )
  assert.equal(
    store.getCurrentStructuredMemoryDossier('event', 'dossier-event').item.participants[0].role,
    '主持人'
  )
  const database = (store as any).db
  const insertMemoryCorrection = database.prepare(`
    INSERT INTO memory_corrections(
      item_kind,item_id,before_json,after_json,created_at
    ) VALUES(?,?,?,?,?)
  `)
  for (let index = 0; index < 65; index += 1) {
    insertMemoryCorrection.run(
      'claim',
      'dossier-claim',
      JSON.stringify({ predicate: '所在城市', object_value: `旧值 ${index}` }),
      JSON.stringify({ predicate: '所在城市', object_value: `新值 ${index}` }),
      `2026-08-04T10:${String(index % 60).padStart(2, '0')}:00.000Z`
    )
  }
  const claimWithAudit = store.getCurrentStructuredMemoryDossier(
    'claim',
    'dossier-claim'
  )
  assert.equal(claimWithAudit.item.auditPage.total, 65)
  assert.equal(claimWithAudit.item.auditPage.items.length, 40)
  assert.equal(claimWithAudit.item.auditPage.hasMore, true)
  const claimAuditLast = store.listMemoryItemAuditPage({
    kind: 'claim',
    itemId: 'dossier-claim',
    offset: 40,
    revision: claimWithAudit.item.auditPage.revision
  })
  assert.equal(claimAuditLast.items.length, 25)
  assert.equal(claimAuditLast.hasMore, false)
  const insertHistory = database.prepare(`
    INSERT INTO relation_history(
      relation_id,subject_id,predicate,object_id,status,confidence,
      change_type,snapshot_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `)
  const insertCorrection = database.prepare(`
    INSERT INTO relation_corrections(
      review_id,before_relation_id,after_relation_id,
      before_subject_id,before_predicate,before_object_id,
      after_subject_id,after_predicate,after_object_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `)
  for (let index = 0; index < 94; index += 1) {
    insertHistory.run(
      'dossier-relation',
      'dossier-person',
      index % 2 ? '推进' : '负责',
      'dossier-project',
      index % 3 ? 'confirmed' : 'candidate',
      0.8,
      'status_changed',
      index === 93
        ? JSON.stringify({ directionExplanation: '档案人物负责档案项目。' })
        : '{}',
      `2026-08-04T11:${String(index % 60).padStart(2, '0')}:00.000Z`
    )
  }
  for (let index = 0; index < 65; index += 1) {
    insertCorrection.run(
      `dossier-review-${index}`,
      'dossier-relation',
      'dossier-relation',
      'dossier-person',
      '参与',
      'dossier-project',
      'dossier-person',
      '负责',
      'dossier-project',
      `2026-08-04T12:${String(index % 60).padStart(2, '0')}:00.000Z`
    )
  }
  const dossierWithPages = store.getStructuredMemoryDossier(
    'relation',
    'dossier-relation',
    revision
  )
  assert.equal(dossierWithPages.item.historyPage.total, 95)
  assert.equal(dossierWithPages.item.historyPage.items.length, 40)
  assert.equal(dossierWithPages.item.historyPage.hasMore, true)
  assert.equal(
    dossierWithPages.item.historyPage.items[0].direction_explanation,
    '档案人物负责档案项目。'
  )
  assert.equal(
    dossierWithPages.item.historyPage.items[0].direction_explanation_recorded,
    1
  )
  assert.equal(
    dossierWithPages.item.historyPage.items[1].direction_explanation_recorded,
    0
  )
  assert.equal(dossierWithPages.item.correctionPage.total, 65)
  assert.equal(dossierWithPages.item.correctionPage.items.length, 40)
  const currentDossier = store.getCurrentStructuredMemoryDossier(
    'relation',
    'dossier-relation'
  )
  assert.equal(currentDossier.stale, false)
  assert.equal(currentDossier.revision, revision)
  assert.equal(currentDossier.item.historyPage.total, 95)
  assert.equal(currentDossier.item.correctionPage.total, 65)
  const historySecond = store.listRelationDossierAuditPage({
    relationId: 'dossier-relation',
    kind: 'history',
    expectedSearchRevision: revision,
    offset: 40,
    limit: 40,
    revision: dossierWithPages.item.historyPage.revision
  })
  const historyLast = store.listRelationDossierAuditPage({
    relationId: 'dossier-relation',
    kind: 'history',
    expectedSearchRevision: revision,
    offset: 80,
    limit: 40,
    revision: dossierWithPages.item.historyPage.revision
  })
  assert.equal(historySecond.items.length, 40)
  assert.equal(historyLast.items.length, 15)
  assert.equal(historyLast.hasMore, false)
  assert.equal(new Set([
    ...dossierWithPages.item.historyPage.items,
    ...historySecond.items,
    ...historyLast.items
  ].map((item: any) => item.id)).size, 95)
  const correctionSecond = store.listRelationDossierAuditPage({
    relationId: 'dossier-relation',
    kind: 'correction',
    expectedSearchRevision: revision,
    offset: 40,
    revision: dossierWithPages.item.correctionPage.revision
  })
  assert.equal(correctionSecond.items.length, 25)
  assert.equal(correctionSecond.hasMore, false)
  insertHistory.run(
    'dossier-relation',
    'dossier-person',
    '新增变化',
    'dossier-project',
    'confirmed',
    0.9,
    'status_changed',
    '{}',
    '2026-08-04T13:00:00.000Z'
  )
  assert.equal(store.listRelationDossierAuditPage({
    relationId: 'dossier-relation',
    kind: 'history',
    expectedSearchRevision: revision,
    offset: 40,
    revision: dossierWithPages.item.historyPage.revision
  }).stale, true)
  insertMemoryCorrection.run(
    'claim',
    'dossier-claim',
    '{}',
    JSON.stringify({ predicate: '所在城市', object_value: '并发更新' }),
    '2026-08-04T13:01:00.000Z'
  )
  assert.equal(store.listMemoryItemAuditPage({
    kind: 'claim',
    itemId: 'dossier-claim',
    offset: 40,
    revision: claimWithAudit.item.auditPage.revision
  }).stale, true)
  assert.equal(store.getStructuredMemoryDossier('event', 'dossier-claim', revision), null)
  assert.equal(store.getStructuredMemoryDossier('claim', 'dossier-claim', '' as any).stale, true)

  store.upsertClaims([{
    id: 'dossier-claim',
    subjectId: 'dossier-person',
    predicate: '所在城市',
    objectValue: '北京',
    confidence: 0.95,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '档案人物 所在城市 北京',
    evidence: [{
      sourceId: 'wechat',
      messageId: 'dossier-claim-message-new',
      sessionId: 'dossier-session',
      timestamp: 1_780_000_004,
      sender: '档案人物',
      excerpt: '我现在在北京'
    }]
  }])
  assert.equal(store.getStructuredMemoryDossier('claim', 'dossier-claim', revision).stale, true)
}))

test('event dossiers page every participant role and reject mixed structured revisions', () => withStore(store => {
  const entities = Array.from({ length: 305 }, (_, index) => ({
    id: `large-event-person-${String(index).padStart(3, '0')}`,
    type: 'person',
    canonicalName: `大型事件参与者 ${String(index).padStart(3, '0')}`,
    summary: '',
    confidence: 1,
    trustStatus: 'confirmed',
    aliases: [],
    accountIds: []
  }))
  store.syncGraph({ entities, relations: [], reviewQueue: [] } as any)
  store.upsertEvents([{
    id: 'large-participant-event',
    eventType: 'meeting',
    title: '大型参与者事件',
    description: '验证完整参与者分页',
    startAt: '2026-08-06T08:00:00.000Z',
    confidence: 1,
    status: 'confirmed',
    searchText: '大型参与者事件 完整参与者分页',
    participants: entities.map((entity, index) => ({
      entityId: entity.id,
      role: `角色 ${String(index % 7).padStart(2, '0')}`
    })),
    evidence: evidence('large-participant-event-message', '大型参与者事件')
  }])

  const dossier = store.getCurrentStructuredMemoryDossier(
    'event',
    'large-participant-event'
  )
  assert.equal(dossier.stale, false)
  assert.equal(dossier.item.participant_count, 305)
  assert.equal(dossier.item.participantPage.items.length, 40)
  assert.equal(dossier.item.participantPage.total, 305)
  assert.equal(dossier.item.participantPage.hasMore, true)

  const pages = [dossier.item.participantPage]
  while (pages.at(-1).hasMore) {
    const previous = pages.at(-1)
    pages.push(store.listEventDossierParticipantPage({
      eventId: 'large-participant-event',
      expectedSearchRevision: dossier.revision,
      offset: pages.reduce((sum, page) => sum + page.items.length, 0),
      limit: 40,
      revision: dossier.item.participantPage.revision
    }))
    assert.equal(previous.stale, false)
  }
  const allParticipants = pages.flatMap(page => page.items)
  assert.equal(allParticipants.length, 305)
  assert.equal(new Set(allParticipants.map(item =>
    `${item.entity_id}\0${item.role}`)).size, 305)
  assert.equal(pages.at(-1).items.length, 25)

  ;(store as any).db.prepare(`
    INSERT INTO event_participants(event_id,entity_id,role) VALUES(?,?,?)
  `).run('large-participant-event', entities[0].id, '新增角色')
  assert.equal(store.listEventDossierParticipantPage({
    eventId: 'large-participant-event',
    expectedSearchRevision: dossier.revision,
    offset: 40,
    revision: dossier.item.participantPage.revision
  }).stale, true)

  const storeInternals = store as any
  const originalEvidencePayload = storeInternals.getDocumentEvidencePayload.bind(store)
  let changedDuringAssembly = false
  storeInternals.getDocumentEvidencePayload = (...args: any[]) => {
    if (!changedDuringAssembly) {
      changedDuringAssembly = true
      storeInternals.db.prepare(`
        INSERT INTO event_participants(event_id,entity_id,role) VALUES(?,?,?)
      `).run('large-participant-event', entities[1].id, '组装期间新增角色')
    }
    return originalEvidencePayload(...args)
  }
  const concurrentDossier = store.getCurrentStructuredMemoryDossier(
    'event',
    'large-participant-event'
  )
  assert.equal(concurrentDossier.stale, true)
  storeInternals.getDocumentEvidencePayload = originalEvidencePayload

  const participantsBeforeMetadataCorrection =
    store.listEventParticipantsForCorrection('large-participant-event')
  assert.equal(participantsBeforeMetadataCorrection.total, 307)
  assert.equal(participantsBeforeMetadataCorrection.truncated, false)
  const correctionParticipantRevision = store.getStructuredMemoryRevision()
  const correctionParticipantPage = store.listEventCorrectionParticipantPage({
    eventId: 'large-participant-event',
    revision: correctionParticipantRevision,
    offset: 0,
    limit: 100
  })
  assert.equal(correctionParticipantPage.items.length, 100)
  assert.equal(correctionParticipantPage.total, 307)
  assert.equal(correctionParticipantPage.hasMore, true)
  assert.equal(correctionParticipantPage.stale, false)
  store.correctEvent('large-participant-event', {
    title: '大型参与者事件（元数据纠正）',
    eventType: 'meeting',
    description: '只纠正事件正文，不替换参与者',
    startAt: '2026-08-06T08:00:00.000Z',
    location: '上海'
  })
  assert.equal(
    store.listEventParticipantsForCorrection('large-participant-event').total,
    307
  )
  const metadataAudit = store.listMemoryItemAuditPage({
    kind: 'event',
    itemId: 'large-participant-event'
  })
  assert.equal(metadataAudit.items[0].before.participantTotal, 307)
  assert.equal(metadataAudit.items[0].before.participants.length, 40)
  assert.equal(metadataAudit.items[0].before.participantsTruncated, true)
  assert.equal(metadataAudit.items[0].after.participantTotal, 307)
  const correctionId = Number(String(metadataAudit.items[0].id)
    .replace('correction:', ''))
  const snapshotPages: any[] = []
  do {
    snapshotPages.push(store.listEventCorrectionParticipantSnapshotPage({
      correctionId,
      phase: 'before',
      revision: metadataAudit.revision,
      offset: snapshotPages.reduce((sum, page) => sum + page.items.length, 0),
      limit: 40
    }))
  } while (snapshotPages.at(-1).hasMore)
  assert.equal(snapshotPages.flatMap(page => page.items).length, 307)
  const namedSnapshotMatch = store.listEventCorrectionParticipantSnapshotPage({
    correctionId,
    phase: 'before',
    revision: metadataAudit.revision,
    query: 'large-event-person-304',
    limit: 40
  })
  assert.equal(namedSnapshotMatch.total, 1)
  assert.equal(namedSnapshotMatch.unfilteredTotal, 307)
  assert.equal(namedSnapshotMatch.items[0].canonicalName, '大型事件参与者 304')
  const roleSnapshotMatches = store.listEventCorrectionParticipantSnapshotPage({
    correctionId,
    phase: 'after',
    revision: metadataAudit.revision,
    query: '角色 00',
    limit: 40
  })
  assert.equal(roleSnapshotMatches.total, 44)
  assert.equal(roleSnapshotMatches.items.length, 40)
  assert.equal(roleSnapshotMatches.hasMore, true)
  const remainingRoleSnapshotMatches =
    store.listEventCorrectionParticipantSnapshotPage({
      correctionId,
      phase: 'after',
      revision: metadataAudit.revision,
      query: '角色 00',
      offset: roleSnapshotMatches.nextOffset,
      limit: 40
    })
  assert.equal(remainingRoleSnapshotMatches.items.length, 4)
  assert.equal(remainingRoleSnapshotMatches.hasMore, false)

  store.correctEvent('large-participant-event', {
    title: '大型参与者事件（全量参与者纠正）',
    eventType: 'meeting',
    description: '显式替换超过 256 条参与者',
    startAt: '2026-08-06T08:00:00.000Z',
    participants: entities.map((entity, index) => ({
      entityId: entity.id,
      role: `最终角色 ${String(index % 9).padStart(2, '0')}`
    }))
  })
  assert.equal(
    store.listEventParticipantsForCorrection('large-participant-event').total,
    305
  )
  assert.equal(store.listEventCorrectionParticipantPage({
    eventId: 'large-participant-event',
    revision: correctionParticipantRevision,
    offset: 100,
    limit: 100
  }).stale, true)
  assert.equal(store.listEventCorrectionParticipantSnapshotPage({
    correctionId,
    phase: 'before',
    revision: metadataAudit.revision,
    offset: 40,
    limit: 40
  }).stale, true)
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
        sourceId: index % 2 === 0 ? 'documents' : 'wechat',
        messageId: `archive-message-${index}`,
        sessionId: index % 2 === 0 ? `data-source:documents:file-${index}` : 'wechat-session',
        timestamp: 1_700_000_000 + index,
        excerpt: `事实原文 ${index}`
      }]
    }
  })
  store.upsertClaims(claims)

  const first = store.listClaimArchive({ limit: 100 })
  const second = store.listClaimArchive({ offset: 100, limit: 100, revision: first.revision })
  assert.equal(first.total, 900)
  assert.equal(first.items.length, 100)
  assert.equal(second.items.length, 100)
  assert.equal(second.stale, false)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.ok(first.items.every(item => item.status !== 'rejected'))
  assert.ok(first.items.every(item => item.evidence_count === 1 && item.evidence.length === 1))
  ;(store as any).db.prepare(`UPDATE claims SET updated_at=? WHERE id=?`)
    .run('2026-08-03T00:00:00.000Z', 'archive-claim-0001')
  const staleSecond = store.listClaimArchive({ offset: 100, limit: 100, revision: first.revision })
  assert.equal(staleSecond.stale, true)
  assert.equal(staleSecond.items.length, 0)
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

test('fact archive filters canonical evidence sources and exposes every carrier', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'source-owner',
      type: 'person',
      canonicalName: '来源测试',
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  } as any)
  const claim = (id: string, sourceId: string) => ({
    id,
    subjectId: 'source-owner',
    predicate: `来源-${id}`,
    objectValue: sourceId,
    confidence: 1,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: `来源测试 ${sourceId}`,
    evidence: [{
      sourceId,
      messageId: 'shared-message',
      sessionId: 'shared-session',
      timestamp: 1_700_000_000,
      excerpt: `${sourceId} 原文`
    }]
  })
  store.upsertClaims([
    claim('wechat-claim', 'wechat'),
    claim('calendar-claim', 'calendar'),
    claim('mail-claim', 'mail'),
    claim('legacy-claim', 'legacy')
  ])
  store.upsertClaims([{
    ...claim('mixed-claim', 'wechat'),
    evidence: [
      claim('unused', 'wechat').evidence[0],
      { ...claim('unused', 'mail').evidence[0], messageId: 'mail-message' }
    ]
  }])

  assert.deepEqual(store.listClaimArchive({ sourceId: 'calendar' }).items.map(item => item.id), ['calendar-claim'])
  assert.deepEqual(store.listClaimArchive({ sourceId: 'legacy' }).items.map(item => item.id), ['legacy-claim'])
  assert.deepEqual(new Set(store.listClaimArchive({ sourceId: 'mail' }).items.map(item => item.id)),
    new Set(['mail-claim', 'mixed-claim']))
  const mixed = store.listClaimArchive({ predicate: 'mixed-claim', limit: 20 }).items
    .find(item => item.id === 'mixed-claim')
  assert.deepEqual(new Set(String(mixed.source_ids).split(',')), new Set(['wechat', 'mail']))
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

test('entity graph sidebar distinguishes authoritative totals from bounded previews', () => {
  const presentation = buildEntitySidebarPresentation({
    claimTotal: 260,
    claims: Array.from({ length: 200 }, (_, index) => ({ id: `claim-${index}` })),
    relationTotal: 320,
    relations: Array.from({ length: 200 }, (_, index) => ({ id: `relation-${index}` })),
    eventTotal: 240,
    events: Array.from({ length: 200 }, (_, index) => ({ id: `event-${index}` })),
    relationHistoryTotal: 125,
    relationHistory: Array.from({ length: 40 }, (_, index) => ({ id: `history-${index}` }))
  })
  assert.deepEqual(presentation, {
    claims: { total: 260, preview: 6, truncated: true },
    relations: { total: 320, preview: 6, truncated: true },
    events: { total: 240, preview: 5, truncated: true },
    relationHistory: { total: 125, preview: 8, truncated: true }
  })

  const legacy = buildEntitySidebarPresentation({
    claims: [{ id: 'claim' }],
    relations: [],
    events: [{ id: 'event' }],
    relationHistory: []
  })
  assert.equal(legacy.claims.total, 1)
  assert.equal(legacy.claims.truncated, false)
  assert.equal(legacy.events.preview, 1)
})

test('keyed loading state lets one memory audit finish without unlocking another', () => {
  const both = setKeyedLoadingState(
    setKeyedLoadingState({}, 'claim:alpha', true),
    'event:beta',
    true
  )
  assert.deepEqual(both, { 'claim:alpha': true, 'event:beta': true })
  const betaStillLoading = setKeyedLoadingState(both, 'claim:alpha', false)
  assert.deepEqual(betaStillLoading, { 'event:beta': true })
  assert.equal(setKeyedLoadingState(betaStillLoading, 'event:beta', true), betaStillLoading)
  assert.deepEqual(setKeyedLoadingState(betaStillLoading, 'event:beta', false), {})
})

test('keyed request gates let independent dossier sections page concurrently', () => {
  const gates = new KeyedLatestRequestGates()
  const relationHistory = gates.begin('relationHistory')
  const nameCorrections = gates.begin('entityCorrections')
  assert.equal(gates.isCurrent('relationHistory', relationHistory), true)
  assert.equal(gates.isCurrent('entityCorrections', nameCorrections), true)

  const newerRelationHistory = gates.begin('relationHistory')
  assert.equal(gates.isCurrent('relationHistory', relationHistory), false)
  assert.equal(gates.isCurrent('relationHistory', newerRelationHistory), true)
  assert.equal(gates.isCurrent('entityCorrections', nameCorrections), true)

  gates.invalidate('relationHistory')
  assert.equal(gates.isCurrent('relationHistory', newerRelationHistory), false)
  assert.equal(gates.isCurrent('entityCorrections', nameCorrections), true)
  gates.invalidateAll()
  assert.equal(gates.isCurrent('entityCorrections', nameCorrections), false)
})

test('relation dossier history and correction continuations stay independent until the dossier closes', () => {
  const gates = new KeyedLatestRequestGates()
  let loading: Record<string, boolean> = {}
  const history = gates.begin('history')
  loading = setKeyedLoadingState(loading, 'history', true)
  const correction = gates.begin('correction')
  loading = setKeyedLoadingState(loading, 'correction', true)

  const refreshedHistory = gates.begin('history')
  assert.equal(gates.isCurrent('history', history), false)
  assert.equal(gates.isCurrent('history', refreshedHistory), true)
  assert.equal(gates.isCurrent('correction', correction), true)

  loading = setKeyedLoadingState(loading, 'history', false)
  assert.deepEqual(loading, { correction: true })
  gates.invalidateAll()
  loading = {}
  assert.equal(gates.isCurrent('history', refreshedHistory), false)
  assert.equal(gates.isCurrent('correction', correction), false)
  assert.deepEqual(loading, {})
})

test('feedback operation keys isolate documents and scopes while normalizing equivalent input', () => {
  const first = memoryFeedbackOperationKey('claim:one', '  项目   进度 ', {
    entityId: 'entity:1',
    documentTypes: ['EVENT', 'claim', 'claim'],
    sourceIds: ['wechat', 'MAIL']
  })
  const equivalent = memoryFeedbackOperationKey('claim:one', '项目 进度', {
    entityId: 'entity:1',
    documentTypes: ['claim', 'event'],
    sourceIds: ['mail', 'WECHAT']
  })
  assert.equal(first, equivalent)
  assert.notEqual(first, memoryFeedbackOperationKey('claim:two', '项目 进度', {
    entityId: 'entity:1',
    documentTypes: ['claim', 'event'],
    sourceIds: ['mail', 'wechat']
  }))
  assert.notEqual(first, memoryFeedbackOperationKey('claim:one', '项目 进度', {
    entityId: 'entity:2',
    documentTypes: ['claim', 'event'],
    sourceIds: ['mail', 'wechat']
  }))
})

test('keyed feedback actions let independent cards save without unlocking each other', () => {
  let actions: Record<string, 'helpful' | 'not_relevant' | 'cleared'> = {}
  actions = setKeyedActionState(actions, 'scope-a:document-a', 'helpful')
  actions = setKeyedActionState(actions, 'scope-a:document-b', 'not_relevant')
  assert.deepEqual(actions, {
    'scope-a:document-a': 'helpful',
    'scope-a:document-b': 'not_relevant'
  })
  actions = setKeyedActionState(actions, 'scope-a:document-a')
  assert.deepEqual(actions, { 'scope-a:document-b': 'not_relevant' })
})

test('memory cards expose evidence totals but bound their latest evidence payload', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'bounded-person', type: 'person', canonicalName: '证据人物', trustStatus: 'confirmed' }],
    relations: [],
    reviewQueue: []
  })
  const manyEvidence = Array.from({ length: 125 }, (_, index) => ({
    messageId: `wechat:bounded-session:${index + 1}`,
    sessionId: 'bounded-session',
    timestamp: 1_700_000_000 + index,
    sender: `证据发送者 ${index + 1}`,
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
  assert.equal(feedClaim.evidence_count, manyEvidence.length)
  assert.equal(feedClaim.evidence.length, 20)
  assert.deepEqual(feedClaim.evidence.map((item: any) => item.message_id), manyEvidence.slice(-20).map(item => item.messageId))

  const dossierClaim = store.getEntityMemory('bounded-person').claims[0]
  assert.equal(dossierClaim.evidence_count, manyEvidence.length)
  assert.equal(dossierClaim.evidence.length, 20)
  assert.equal(dossierClaim.evidence.at(-1).message_id, 'wechat:bounded-session:125')

  const searchPayload = store.getDocumentEvidencePayload('claim', 'bounded-claim')
  assert.equal(searchPayload.evidenceTotal, manyEvidence.length)
  assert.equal(searchPayload.evidence.length, MEMORY_CARD_EVIDENCE_LIMIT)
  assert.deepEqual(
    searchPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(-MEMORY_CARD_EVIDENCE_LIMIT).map(item => item.messageId)
  )
  assert.deepEqual(store.getDocumentEvidence('claim', 'bounded-claim'), searchPayload.evidence)
  const boundedFrom = new Date(1_700_000_110 * 1000).toISOString()
  const boundedTo = new Date(1_700_000_115 * 1000).toISOString()
  const scopedStructuredPayload = store.getDocumentEvidencePayload('claim', 'bounded-claim', {
    from: boundedFrom,
    to: boundedTo
  })
  assert.equal(scopedStructuredPayload.evidenceTotal, 6)
  assert.deepEqual(
    scopedStructuredPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(110, 116).map(item => item.messageId)
  )
  assert.equal(Number((store as any).db.prepare(
    'SELECT COUNT(*) AS count FROM search_document_evidence WHERE document_id=?'
  ).get('claim:bounded-claim').count), 0)
  const firstEvidencePage = store.getDocumentEvidencePage('claim', 'bounded-claim', { limit: 40 })
  const secondEvidencePage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    offset: 40, limit: 40, revision: firstEvidencePage.revision
  })
  const lastEvidencePage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    offset: 120, limit: 40, revision: firstEvidencePage.revision
  })
  assert.equal(firstEvidencePage.total, manyEvidence.length)
  assert.equal(firstEvidencePage.hasMore, true)
  assert.equal(firstEvidencePage.items[0].sender, '证据发送者 125')
  assert.equal(secondEvidencePage.items.length, 40)
  assert.equal(lastEvidencePage.items.length, 5)
  assert.equal(lastEvidencePage.hasMore, false)
  assert.deepEqual(
    [...firstEvidencePage.items, ...secondEvidencePage.items, ...store.getDocumentEvidencePage(
      'claim', 'bounded-claim', {
        offset: 80, limit: 40, revision: firstEvidencePage.revision
      }
    ).items, ...lastEvidencePage.items].map(item => item.message_id),
    manyEvidence.map(item => item.messageId).reverse()
  )

  const fallbackPayload = store.getDocumentEvidencePayload('claim', 'bounded-claim')
  assert.equal(fallbackPayload.evidenceTotal, manyEvidence.length)
  assert.deepEqual(
    fallbackPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(-MEMORY_CARD_EVIDENCE_LIMIT).map(item => item.messageId)
  )
  const fallbackFirstPage = store.getDocumentEvidencePage('claim', 'bounded-claim', { limit: 40 })
  const fallbackPage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    offset: 120, limit: 40, revision: fallbackFirstPage.revision
  })
  assert.equal(fallbackPage.total, manyEvidence.length)
  assert.deepEqual(
    fallbackPage.items.map(item => item.message_id),
    manyEvidence.slice(0, 5).map(item => item.messageId).reverse()
  )
  assert.equal(fallbackPage.hasMore, false)

  store.upsertResources([{
    id: 'bounded-resource',
    resourceType: 'link',
    title: '通用证据索引',
    content: '验证非结构化记忆的完整证据分页',
    evidence: manyEvidence.map(item => ({ ...item, sender: '证据发送者' }))
  }])
  const scopedGenericPayload = store.getDocumentEvidencePayload('resource', 'bounded-resource', {
    from: boundedFrom,
    to: boundedTo
  })
  assert.equal(scopedGenericPayload.evidenceTotal, 6)
  assert.deepEqual(
    scopedGenericPayload.evidence.map(item => item.message_id),
    manyEvidence.slice(110, 116).map(item => item.messageId)
  )
  const genericFirstPage = store.getDocumentEvidencePage('resource', 'bounded-resource', { limit: 40 })
  const genericLastPage = store.getDocumentEvidencePage('resource', 'bounded-resource', {
    offset: 120,
    limit: 40,
    revision: genericFirstPage.revision
  })
  assert.equal(genericFirstPage.total, manyEvidence.length)
  assert.equal(genericFirstPage.items[0].message_id, manyEvidence.at(-1)?.messageId)
  assert.equal(genericFirstPage.items[0].sender, '证据发送者')
  assert.deepEqual(
    genericLastPage.items.map(item => item.message_id),
    manyEvidence.slice(0, 5).map(item => item.messageId).reverse()
  )
  assert.equal(genericLastPage.hasMore, false)

  store.upsertClaims([{
    id: 'bounded-claim',
    subjectId: 'bounded-person',
    predicate: '负责',
    objectValue: '证据边界',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '证据人物负责证据边界',
    evidence: [{ ...manyEvidence[0], sender: '修正后的发送者' }]
  }])
  const staleStructuredPage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    offset: 120,
    limit: 40,
    revision: fallbackFirstPage.revision
  })
  assert.equal(staleStructuredPage.stale, true)
  assert.deepEqual(staleStructuredPage.items, [])
  const enrichedFirstPage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    limit: 40
  })
  const enrichedPage = store.getDocumentEvidencePage('claim', 'bounded-claim', {
    offset: 120,
    limit: 40,
    revision: enrichedFirstPage.revision
  })
  assert.equal(enrichedPage.total, manyEvidence.length)
  assert.equal(enrichedPage.items.at(-1).sender, '修正后的发送者')
}))

test('relation graph snapshots keep a bounded hotset while SQLCipher retains every evidence row', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-relation-evidence-hotset-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const allEvidence = Array.from(
    { length: GRAPH_RELATION_EVIDENCE_HOT_LIMIT * 4 + 17 },
    (_, index) => ({
      sourceId: 'wechat',
      messageId: `relation-evidence-${index}`,
      sessionId: 'long-relation',
      timestamp: 1_700_000_000 + index,
      sender: '长期联系人',
      excerpt: `长期关系原文 ${index}`
    })
  )
  const graph = {
    entities: [{
      id: 'hotset-person',
      type: 'person',
      canonicalName: '长期联系人',
      trustStatus: 'confirmed'
    }, {
      id: 'hotset-project',
      type: 'project',
      canonicalName: '长期项目',
      trustStatus: 'confirmed'
    }],
    relations: [{
      id: 'hotset-relation',
      subjectId: 'hotset-person',
      predicate: '参与',
      objectId: 'hotset-project',
      confidence: 0.9,
      status: 'confirmed',
      evidence: allEvidence
    }],
    reviewQueue: []
  }
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncGraph(graph as any, 'hotset-first')
    const snapshot = first.loadGraphSnapshot()
    assert.equal(snapshot.relations[0].evidence.length, GRAPH_RELATION_EVIDENCE_HOT_LIMIT)
    assert.equal(snapshot.relations[0].evidenceTotal, allEvidence.length)
    assert.equal(snapshot.relations[0].evidence[0].messageId,
      `relation-evidence-${allEvidence.length - GRAPH_RELATION_EVIDENCE_HOT_LIMIT}`)
    assert.equal(first.getRelationEvidence(['hotset-relation']).get('hotset-relation')?.length, allEvidence.length)
    compactRelationEvidenceHotset(graph.relations[0], allEvidence.length)
    first.syncGraph(graph as any, 'hotset-second')
    assert.equal(first.getRelationEvidenceCounts().get('hotset-relation'), allEvidence.length)
  } finally {
    first.close()
  }
  const reopened = new PersonalMemoryStore()
  try {
    reopened.initialize(databasePath, key)
    const snapshot = reopened.loadGraphSnapshot()
    assert.equal(snapshot.relations[0].evidence.length, GRAPH_RELATION_EVIDENCE_HOT_LIMIT)
    assert.equal(snapshot.relations[0].evidenceTotal, allEvidence.length)
  } finally {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('complete evidence archives filter before paging across generic and structured stores', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'filtered-person', type: 'person', canonicalName: '筛选人物', trustStatus: 'confirmed' }],
    relations: [],
    reviewQueue: []
  })
  store.upsertResources([{
    id: 'filtered-resource',
    resourceType: 'document',
    title: '筛选资料',
    content: '验证完整证据筛选',
    evidence: [
      {
        sourceId: 'wechat', messageId: 'wechat:alpha:1', sessionId: 'alpha',
        timestamp: 1_700_000_000, sender: '甲', excerpt: '普通微信证据'
      },
      {
        sourceId: 'documents', messageId: 'document:design:2', sessionId: 'design-notes',
        timestamp: 1_700_000_100, sender: '乙', excerpt: '关键架构决定'
      },
      {
        sourceId: 'mail', messageId: 'mail:project:3', sessionId: 'project-mailbox',
        timestamp: 1_700_000_200, sender: '丙', excerpt: '邮件确认事项'
      }
    ]
  }])
  const generic = store.getDocumentEvidencePage('resource', 'filtered-resource', {
    source: 'documents',
    session: 'design',
    sender: '乙',
    query: '架构',
    fromTimestamp: 1_700_000_050,
    toTimestamp: 1_700_000_150
  })
  assert.equal(generic.unfilteredTotal, 3)
  assert.equal(generic.total, 1)
  assert.equal(generic.items[0].message_id, 'document:design:2')
  const impossibleGenericRole = store.getDocumentEvidencePage('resource', 'filtered-resource', {
    role: 'direct'
  })
  assert.equal(impossibleGenericRole.unfilteredTotal, 3)
  assert.equal(impossibleGenericRole.total, 0)
  assert.equal(store.getDocumentEvidencePage('resource', 'filtered-resource', {
    role: 'original'
  }).total, 3)

  store.upsertClaims([{
    id: 'filtered-claim',
    subjectId: 'filtered-person',
    predicate: '负责',
    objectValue: '筛选验证',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '筛选人物负责筛选验证',
    evidence: [
      {
        sourceId: 'wechat', messageId: 'wechat:claim:1', sessionId: 'claim-room',
        timestamp: 1_700_001_000, sender: '甲', excerpt: '本人直接确认', role: 'direct'
      },
      {
        sourceId: 'wechat', messageId: 'wechat:claim:2', sessionId: 'claim-room',
        timestamp: 1_700_001_100, sender: '乙', excerpt: '转述相关信息', role: 'indirect'
      },
      {
        sourceId: 'documents', messageId: 'document:claim:3', sessionId: 'claim-file',
        timestamp: 1_700_001_200, sender: '审计员', excerpt: '材料明确否认', role: 'contradiction'
      }
    ]
  }])
  const contradiction = store.getDocumentEvidencePage('claim', 'filtered-claim', {
    source: 'documents',
    role: 'contradiction',
    query: '否认',
    sender: '审计',
    session: 'file'
  })
  assert.equal(contradiction.unfilteredTotal, 3)
  assert.equal(contradiction.total, 1)
  assert.equal(contradiction.items[0].evidence_role, 'contradiction')
  assert.equal(store.getDocumentEvidencePage('claim', 'filtered-claim', {
    role: 'direct'
  }).items[0].message_id, 'wechat:claim:1')
}))

test('structured evidence migration deduplicates nullable legacy identities and preserves provenance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-migration-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{ id: 'migration-person', type: 'person', canonicalName: '迁移人物', trustStatus: 'confirmed' }],
      relations: [],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'migration-claim',
      subjectId: 'migration-person',
      predicate: '负责',
      objectValue: '迁移验证',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'self_statement',
      searchText: '迁移人物负责迁移验证',
      evidence: [{
        messageId: 'wechat:migration-session:migration-message',
        sessionId: 'migration-session',
        timestamp: 1_700_000_000,
        sender: '',
        excerpt: '短摘录',
        role: 'support'
      }]
    }])
    first.upsertResources([{
      id: 'legacy-sender-source',
      resourceType: 'chat-history',
      title: '迁移发送者来源',
      content: '可用于回填发送者的旧索引',
      evidence: [{
        messageId: 'wechat:migration-session:migration-message',
        sessionId: 'migration-session',
        timestamp: 1_700_000_000,
        sender: '迁移发送者',
        excerpt: '可用于回填发送者的旧索引'
      }]
    }])
    const database = (first as any).db
    database.exec(`
      DROP INDEX idx_evidence_claim_message;
      DROP INDEX idx_evidence_relation_message;
      DROP INDEX idx_evidence_event_message;
      DELETE FROM schema_meta WHERE key='structured_evidence_identity_version';
    `)
    database.prepare(`
      INSERT INTO evidence(
        claim_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'migration-claim', 'wechat:migration-session:migration-message', 'migration-session', 1_700_000_000,
      '', '这是迁移时应保留的更完整摘录', 'direct'
    )
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS count FROM evidence WHERE claim_id=?'
    ).get('migration-claim').count, 2)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const page = reopened.getDocumentEvidencePage('claim', 'migration-claim')
      assert.equal(page.total, 1)
      assert.equal(page.items[0].sender, '迁移发送者')
      assert.equal(page.items[0].excerpt, '这是迁移时应保留的更完整摘录')
      assert.equal(page.items[0].evidence_role, 'direct')
      const migrationAudit = JSON.parse(String(((reopened as any).db.prepare(`
        SELECT value FROM schema_meta WHERE key='structured_evidence_identity_version'
      `).get() as any).value))
      assert.equal(migrationAudit.version, 3)
      assert.equal(migrationAudit.evidenceBefore, 2)
      assert.equal(migrationAudit.evidenceAfter, 1)
      assert.equal(migrationAudit.duplicatesRemoved, 1)
      assert.equal(migrationAudit.sendersRecovered, 1)
      assert.equal(migrationAudit.sourceRowsBackfilledThisStart, 1)
      assert.equal(migrationAudit.sourceRowsBackfilledTotal, 1)
      assert.equal(migrationAudit.sourceIdentity, true)
      assert.deepEqual(reopened.getDiagnostics().structuredEvidenceMigration, migrationAudit)
      assert.equal(Number(((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM pragma_index_list('evidence')
        WHERE name IN(
          'idx_evidence_claim_message','idx_evidence_relation_message','idx_evidence_event_message'
        ) AND "unique"=1
      `).get() as any).count), 3)
      assert.deepEqual(
        ((reopened as any).db.prepare(`
          SELECT name FROM pragma_index_info('idx_evidence_claim_message')
          ORDER BY seqno
        `).all() as Array<{ name: string }>).map(row => row.name),
        ['claim_id', 'source_id', 'session_id', 'message_id']
      )
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured evidence constraints self-heal after index drift without trusting migration metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-drift-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{ id: 'drift-person', type: 'person', canonicalName: '漂移人物', trustStatus: 'confirmed' }],
      relations: [],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'drift-claim',
      subjectId: 'drift-person',
      predicate: '负责',
      objectValue: '约束漂移验证',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'self_statement',
      searchText: '漂移人物负责约束漂移验证',
      evidence: [{
        messageId: 'drift-message',
        sessionId: 'drift-session',
        timestamp: 1_700_000_000,
        sender: '原发送者',
        excerpt: '原始摘录',
        role: 'support'
      }]
    }])
    const database = (first as any).db
    const auditBefore = JSON.parse(String(database.prepare(`
      SELECT value FROM schema_meta WHERE key='structured_evidence_identity_version'
    `).get().value))
    assert.equal(auditBefore.version, 3)
    database.exec('DROP INDEX idx_evidence_claim_message')
    database.prepare(`
      INSERT INTO evidence(
        claim_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'drift-claim', 'drift-message', 'drift-session', 1_700_000_000,
      '恢复发送者', '索引漂移期间产生的更完整摘录', 'direct'
    )
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const page = reopened.getDocumentEvidencePage('claim', 'drift-claim')
      assert.equal(page.total, 1)
      assert.equal(page.items[0].sender, '恢复发送者')
      assert.equal(page.items[0].excerpt, '索引漂移期间产生的更完整摘录')
      assert.equal(page.items[0].evidence_role, 'direct')
      const diagnostics = reopened.getDiagnostics().structuredEvidenceMigration
      assert.equal(diagnostics.version, 3)
      assert.equal(diagnostics.constraintsHealthy, true)
      assert.equal(diagnostics.driftDetectedThisStart, true)
      assert.equal(diagnostics.constraintDriftRepairs, 1)
      assert.equal(diagnostics.repairRuns, auditBefore.repairRuns + 1)
      assert.equal(diagnostics.duplicatesRemoved, auditBefore.duplicatesRemoved + 1)
      assert.equal(Number(((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM pragma_index_list('evidence')
        WHERE name IN(
          'idx_evidence_claim_message','idx_evidence_relation_message','idx_evidence_event_message'
        ) AND "unique"=1 AND partial=1
      `).get() as any).count), 3)
      reopened.close()
      const verifiedAgain = new PersonalMemoryStore()
      try {
        verifiedAgain.initialize(databasePath)
        const verifiedDiagnostics = verifiedAgain.getDiagnostics().structuredEvidenceMigration
        assert.equal(verifiedDiagnostics.driftDetectedThisStart, false)
        assert.equal(verifiedDiagnostics.constraintDriftRepairs, 1)
        assert.equal(verifiedDiagnostics.repairRuns, auditBefore.repairRuns + 1)
      } finally {
        verifiedAgain.close()
      }
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured evidence upgrades quality without duplicating or downgrading repeated extraction', () => withStore(store => {
  const relation = {
    id: 'sender-relation',
    subjectId: 'sender-person-a',
    predicate: '协作',
    objectId: 'sender-person-b',
    confidence: 0.9,
    status: 'candidate',
    evidence: [{
      messageId: 'sender-relation-message',
      sessionId: 'sender-session',
      timestamp: 1_700_000_100,
      sender: '关系发送者',
      excerpt: '我们一起完成这个项目'
    }]
  }
  const graph = {
    entities: [
      { id: 'sender-person-a', type: 'person', canonicalName: '发送者甲', trustStatus: 'confirmed' },
      { id: 'sender-person-b', type: 'person', canonicalName: '发送者乙', trustStatus: 'confirmed' }
    ],
    relations: [relation],
    reviewQueue: [{
      id: 'sender-relation-review',
      kind: 'relation',
      title: '确认协作关系',
      detail: '确认关系方向',
      confidence: 0.9,
      status: 'pending',
      relationId: relation.id
    }]
  }
  store.syncGraph(graph)
  store.syncGraph(graph)
  store.syncGraph({
    ...graph,
    relations: [{
      ...relation,
      evidence: [{
        ...relation.evidence[0],
        timestamp: 1_700_000_101,
        sender: '关系发送者新备注',
        excerpt: '我们一起完成这个项目，并约定周五交付完整版本'
      }]
    }]
  })
  const relationPage = store.getDocumentEvidencePage('relation', relation.id)
  assert.equal(relationPage.total, 1)
  assert.equal(relationPage.items[0].sender, '关系发送者新备注')
  assert.equal(relationPage.items[0].timestamp, 1_700_000_101)
  assert.equal(relationPage.items[0].excerpt, '我们一起完成这个项目，并约定周五交付完整版本')

  const event = {
    id: 'sender-event',
    eventType: 'meeting',
    title: '发送者测试会议',
    description: '验证事件证据发送者',
    startAt: '2026-07-31T10:00:00.000Z',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '发送者测试会议',
    participants: [{ entityId: 'sender-person-a', role: 'participant' }],
    evidence: [{
      messageId: 'sender-event-message',
      sessionId: 'sender-session',
      timestamp: 1_700_000_200,
      sender: '事件发送者',
      excerpt: '明天开一次测试会议'
    }]
  }
  store.upsertEvents([{ ...event, evidence: [{ ...event.evidence[0], role: 'indirect' }] }])
  store.upsertEvents([{ ...event, evidence: [{
    ...event.evidence[0],
    timestamp: 1_700_000_201,
    sender: '事件发送者新备注',
    excerpt: '明天开一次测试会议，讨论发布方案',
    role: 'direct'
  }] }])
  store.upsertEvents([{ ...event, evidence: [{
    ...event.evidence[0],
    timestamp: 1_700_000_199,
    sender: '',
    excerpt: '短句',
    role: 'indirect'
  }] }])
  const eventPage = store.getDocumentEvidencePage('event', event.id)
  assert.equal(eventPage.total, 1)
  assert.equal(eventPage.items[0].sender, '事件发送者新备注')
  assert.equal(eventPage.items[0].timestamp, 1_700_000_201)
  assert.equal(eventPage.items[0].excerpt, '明天开一次测试会议，讨论发布方案')
  assert.equal(eventPage.items[0].evidence_role, 'direct')

  const claim = {
    id: 'quality-claim',
    subjectId: 'sender-person-a',
    predicate: '负责',
    objectValue: '发布',
    polarity: 'positive',
    valueType: 'text',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '发送者甲负责发布',
    evidence: [{
      messageId: 'quality-claim-message',
      sessionId: 'sender-session',
      timestamp: 1_700_000_300,
      sender: '最初发送者',
      excerpt: '他负责发布',
      role: 'indirect'
    }]
  }
  store.upsertClaims([claim])
  store.upsertClaims([{ ...claim, evidence: [{
    ...claim.evidence[0],
    timestamp: 1_700_000_301,
    sender: '确认发送者',
    excerpt: '我确认由发送者甲负责本周五的完整发布',
    role: 'contradiction'
  }] }])
  store.upsertClaims([{ ...claim, evidence: [{
    ...claim.evidence[0],
    timestamp: 1_700_000_299,
    sender: '',
    excerpt: '短句',
    role: 'direct'
  }] }])
  const claimPage = store.getDocumentEvidencePage('claim', claim.id)
  assert.equal(claimPage.total, 1)
  assert.equal(claimPage.items[0].timestamp, 1_700_000_301)
  assert.equal(claimPage.items[0].sender, '确认发送者')
  assert.equal(claimPage.items[0].excerpt, '我确认由发送者甲负责本周五的完整发布')
  assert.equal(claimPage.items[0].evidence_role, 'contradiction')

  const diagnostics = store.getDiagnostics()
  assert.ok(diagnostics.structuredEvidenceQualityMerge.upgradesTotal >= 3)
  assert.ok(diagnostics.structuredEvidenceQualityMerge.byKind.claim >= 1)
  assert.ok(diagnostics.structuredEvidenceQualityMerge.byKind.relation >= 1)
  assert.ok(diagnostics.structuredEvidenceQualityMerge.byKind.event >= 1)

  const stableRevisions = {
    search: store.getMemorySearchRevision(),
    structured: store.getStructuredMemoryRevision(),
    graph: store.getGraphReviewRevision()
  }
  store.syncGraph({
    ...graph,
    relations: [{
      ...relation,
      evidence: [{
        ...relation.evidence[0],
        timestamp: 1_700_000_101,
        sender: '关系发送者新备注',
        excerpt: '我们一起完成这个项目，并约定周五交付完整版本'
      }]
    }]
  })
  store.upsertEvents([{ ...event, evidence: [{
    ...event.evidence[0],
    timestamp: 1_700_000_201,
    sender: '事件发送者新备注',
    excerpt: '明天开一次测试会议，讨论发布方案',
    role: 'direct'
  }] }])
  store.upsertClaims([{ ...claim, evidence: [{
    ...claim.evidence[0],
    timestamp: 1_700_000_301,
    sender: '确认发送者',
    excerpt: '我确认由发送者甲负责本周五的完整发布',
    role: 'contradiction'
  }] }])
  assert.deepEqual({
    search: store.getMemorySearchRevision(),
    structured: store.getStructuredMemoryRevision(),
    graph: store.getGraphReviewRevision()
  }, stableRevisions)
}))

test('structured evidence preserves identical message ids from different sources across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-structured-source-evidence-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const evidence = [{
    sourceId: 'wechat',
    messageId: 'shared-message',
    sessionId: 'shared-session',
    timestamp: 1_700_000_301,
    sender: '微信发送者',
    excerpt: '微信原文'
  }, {
    sourceId: 'documents',
    messageId: 'shared-message',
    sessionId: 'shared-session',
    timestamp: 1_700_000_302,
    sender: '文档连接器',
    excerpt: '文档原文'
  }]
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [
        { id: 'source-person-a', type: 'person', canonicalName: '来源甲', trustStatus: 'confirmed' },
        { id: 'source-person-b', type: 'person', canonicalName: '来源乙', trustStatus: 'confirmed' }
      ],
      relations: [{
        id: 'source-relation',
        subjectId: 'source-person-a',
        predicate: '协作',
        objectId: 'source-person-b',
        confidence: 0.9,
        status: 'candidate',
        evidence
      }],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'source-claim',
      subjectId: 'source-person-a',
      predicate: '负责',
      objectValue: '跨来源验证',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '来源甲负责跨来源验证',
      evidence
    }])
    first.upsertEvents([{
      id: 'source-event',
      eventType: 'meeting',
      title: '跨来源会议',
      description: '',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '跨来源会议',
      participants: [{ entityId: 'source-person-a', role: 'participant' }],
      evidence
    }])
    for (const [kind, id] of [
      ['relation', 'source-relation'],
      ['claim', 'source-claim'],
      ['event', 'source-event']
    ] as const) {
      const page = first.getDocumentEvidencePage(kind, id)
      assert.equal(page.total, 2)
      assert.deepEqual(page.items.map(item => item.source_id).sort(), ['documents', 'wechat'])
      const scopedPayload = first.getDocumentEvidencePayload(kind, id, {
        sourceIds: ['documents'],
        sessionId: 'shared-session'
      })
      assert.equal(scopedPayload.evidenceTotal, 1)
      assert.deepEqual(
        scopedPayload.evidence.map(item => [item.source_id, item.sender, item.excerpt]),
        [['documents', '文档连接器', '文档原文']]
      )
    }
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      for (const [kind, id] of [
        ['relation', 'source-relation'],
        ['claim', 'source-claim'],
        ['event', 'source-event']
      ] as const) {
        assert.equal(reopened.getDocumentEvidencePage(kind, id).total, 2, `${kind} evidence after restart`)
      }
      const diagnostics = reopened.getDiagnostics().structuredEvidenceMigration
      assert.equal(diagnostics.version, 3)
      assert.equal(diagnostics.sourceIdentity, true)
      assert.equal(diagnostics.constraintsHealthy, true)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured evidence reference integrity removes legacy orphans and protects future deletes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-reference-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const entities = [
    { id: 'reference-person-a', type: 'person', canonicalName: '引用甲', trustStatus: 'confirmed' },
    { id: 'reference-person-b', type: 'person', canonicalName: '引用乙', trustStatus: 'confirmed' }
  ]
  const relation = {
    id: 'orphan-relation',
    subjectId: 'reference-person-a',
    predicate: '协作',
    objectId: 'reference-person-b',
    confidence: 0.9,
    status: 'candidate',
    evidence: [{
      messageId: 'orphan-relation-message',
      sessionId: 'reference-session',
      timestamp: 1_700_001_000,
      sender: '关系发送者',
      excerpt: '关系孤儿测试'
    }]
  }
  const event = {
    id: 'orphan-event',
    eventType: 'meeting',
    title: '事件孤儿测试',
    description: '',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '事件孤儿测试',
    participants: [{ entityId: 'reference-person-a', role: 'participant' }],
    evidence: [{
      messageId: 'orphan-event-message',
      sessionId: 'reference-session',
      timestamp: 1_700_001_001,
      sender: '事件发送者',
      excerpt: '事件孤儿测试'
    }]
  }
  try {
    first.initialize(databasePath)
    first.syncGraph({ entities, relations: [relation], reviewQueue: [] })
    first.upsertEvents([event])
    const database = (first as any).db
    database.exec(`
      DROP TRIGGER trg_relations_delete_evidence;
      DROP TRIGGER trg_events_delete_evidence;
      DELETE FROM event_participants WHERE event_id='orphan-event';
      DELETE FROM relations WHERE id='orphan-relation';
      DELETE FROM events WHERE id='orphan-event';
    `)
    assert.equal(Number(database.prepare(`
      SELECT COUNT(*) AS count FROM evidence
      WHERE relation_id='orphan-relation' OR event_id='orphan-event'
    `).get().count), 2)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const diagnostics = reopened.getDiagnostics()
      assert.equal(diagnostics.healthy, true)
      assert.equal(diagnostics.referentialIntegrityHealthy, true)
      assert.equal(diagnostics.foreignKeyViolations, 0)
      assert.deepEqual(diagnostics.structuredEvidenceReferences.orphansFoundThisStart, {
        claims: 0,
        relations: 1,
        events: 1
      })
      assert.equal(diagnostics.structuredEvidenceReferences.orphansRemovedTotal, 2)
      assert.equal(diagnostics.structuredEvidenceReferences.triggerRepairs, 2)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM evidence
        WHERE relation_id='orphan-relation' OR event_id='orphan-event'
      `).get().count), 0)

      const protectedRelation = { ...relation, id: 'protected-relation', evidence: [{
        ...relation.evidence[0],
        messageId: 'protected-relation-message'
      }] }
      const protectedEvent = { ...event, id: 'protected-event', evidence: [{
        ...event.evidence[0],
        messageId: 'protected-event-message'
      }] }
      reopened.syncGraph({ entities, relations: [protectedRelation], reviewQueue: [] })
      reopened.upsertEvents([protectedEvent])
      ;(reopened as any).db.exec(`
        DELETE FROM event_participants WHERE event_id='protected-event';
        DELETE FROM relations WHERE id='protected-relation';
        DELETE FROM events WHERE id='protected-event';
      `)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM evidence
        WHERE relation_id='protected-relation' OR event_id='protected-event'
      `).get().count), 0)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured search index reconciliation removes ghosts and rebuilds missing memories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-search-reconcile-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const entities = [
    {
      id: 'search-person-a',
      type: 'person',
      canonicalName: '检索甲',
      trustStatus: 'confirmed',
      aliases: ['检索阿甲'],
      accountIds: ['wxid_search_a'],
      externalIdentities: [{
        platform: 'email',
        accountId: 'search-a@example.com',
        displayName: '检索甲邮箱',
        confidence: 1
      }],
      summary: '负责可信实体检索',
      summaryStatus: 'confirmed'
    },
    { id: 'search-person-b', type: 'person', canonicalName: '检索乙', trustStatus: 'confirmed' },
    { id: 'search-person-candidate', type: 'person', canonicalName: '候选幽灵实体', trustStatus: 'candidate' }
  ]
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities,
      relations: [{
        id: 'search-ghost-relation',
        subjectId: 'search-person-a',
        predicate: '旧关系检索幽灵',
        objectId: 'search-person-b',
        confidence: 0.9,
        status: 'candidate',
        evidence: [{
          messageId: 'search-ghost-message',
          sessionId: 'search-session',
          timestamp: 1_700_002_000,
          sender: '检索发送者',
          excerpt: '旧关系检索幽灵'
        }]
      }],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'search-missing-claim',
      subjectId: 'search-person-a',
      predicate: '掌握',
      objectValue: '索引重建关键词',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'self_statement',
      searchText: '检索甲掌握索引重建关键词',
      evidence: [{
        messageId: 'search-claim-message',
        sessionId: 'search-session',
        timestamp: 1_700_002_001,
        sender: '检索发送者',
        excerpt: '索引重建关键词'
      }]
    }, {
      id: 'search-stale-metadata-claim',
      subjectId: 'search-person-b',
      predicate: '保存',
      objectValue: '可信元数据漂移',
      confidence: 0.8,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '检索乙保存可信元数据漂移',
      evidence: [{
        messageId: 'search-metadata-message',
        sessionId: 'search-session',
        timestamp: 1_700_002_003,
        sender: '检索发送者',
        excerpt: '可信元数据漂移'
      }]
    }, {
      id: 'search-stale-content-claim',
      subjectId: 'search-person-a',
      predicate: '记录',
      objectValue: '权威正文恢复',
      confidence: 0.85,
      status: 'candidate',
      sourceNature: 'self_statement',
      searchText: '检索甲记录权威正文恢复',
      evidence: [{
        messageId: 'search-content-message',
        sessionId: 'search-session',
        timestamp: 1_700_002_004,
        sender: '检索发送者',
        excerpt: '权威正文恢复'
      }]
    }])
    first.upsertEvents([{
      id: 'search-missing-event',
      eventType: 'meeting',
      title: '缺失事件索引',
      description: '',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '缺失事件索引恢复验证',
      participants: [{ entityId: 'search-person-a', role: 'participant' }],
      evidence: [{
        messageId: 'search-event-message',
        sessionId: 'search-session',
        timestamp: 1_700_002_002,
        sender: '检索发送者',
        excerpt: '缺失事件索引恢复验证'
      }]
    }])
    first.upsertResources([{
      id: 'search-missing-resource',
      resourceType: 'document',
      title: '缺失资源索引',
      content: '资源索引恢复关键词',
      fileName: '恢复资料.txt',
      metadata: { sourceId: 'documents' }
    }, {
      id: 'search-stale-resource',
      resourceType: 'file',
      title: '权威资源标题',
      content: '权威资源正文关键词',
      fileName: '权威资料.pdf',
      metadata: { sourceId: 'wechat', sessionName: '资源测试群' }
    }])
    const database = (first as any).db
    database.pragma('foreign_keys = OFF')
    assert.equal(Number(database.pragma('foreign_keys', { simple: true })), 0)
    database.exec(`
      DROP TRIGGER trg_claims_delete_search;
      DROP TRIGGER trg_relations_delete_search;
      DROP TRIGGER trg_events_delete_search;
      DROP TRIGGER trg_memory_resources_delete_search;
      DROP TRIGGER trg_entities_delete_search;
      DROP TRIGGER trg_search_documents_delete_payload;
      DROP TRIGGER trg_search_documents_ann_delete;
      CREATE TRIGGER trg_search_documents_ann_delete
      AFTER DELETE ON search_documents
      BEGIN
        SELECT 1;
      END;
      DELETE FROM search_documents
        WHERE id IN(
          'claim:search-missing-claim',
          'resource:search-missing-resource',
          'entity:search-person-b'
        );
      UPDATE search_documents
        SET document_type='resource',source_id='wrong-event-source'
        WHERE id='event:search-missing-event';
      DELETE FROM relations WHERE id='search-ghost-relation';
      INSERT INTO search_fts(document_id,title,search_text)
        VALUES('orphan:fts','孤儿全文','孤儿全文载荷');
      INSERT INTO search_document_evidence(
        document_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES('orphan:evidence','orphan-message','orphan-session',1,'孤儿','孤儿证据载荷');
      INSERT INTO vector_ann_entries(
        document_id,model,dimensions,table_id,signature,content_hash,updated_at
      ) VALUES
        ('orphan:ann','ann-test',2,0,1,'orphan-hash','2026-07-31T00:00:00.000Z'),
        ('relation:search-ghost-relation','ann-test',2,0,2,'ghost-hash','2026-07-31T00:00:00.000Z');
      DELETE FROM search_fts
        WHERE document_id IN('entity:search-person-a','entity:search-person-b');
      INSERT INTO search_fts(document_id,title,search_text)
        VALUES('entity:search-person-a','过期标题一','过期检索载荷一');
      INSERT INTO search_fts(document_id,title,search_text)
        VALUES('entity:search-person-a','过期标题二','过期检索载荷二');
      UPDATE claims SET status='rejected'
        WHERE id='search-stale-metadata-claim';
      UPDATE search_documents
        SET metadata_json='{"status":"confirmed","subjectId":"wrong-person","polarity":"negative"}'
        WHERE id='claim:search-stale-metadata-claim';
      UPDATE search_documents
        SET title='漂移事实标题',search_text='漂移事实正文',
          content_hash='wrong-content-hash',
          embedding_model='drifted-model',embedding_dimensions=2,embedding_json='[0.6,0.8]'
        WHERE id='claim:search-stale-content-claim';
      UPDATE search_fts SET title='漂移事实标题',search_text='漂移事实正文'
        WHERE document_id='claim:search-stale-content-claim';
      UPDATE search_documents
        SET title='漂移资源标题',search_text='漂移资源正文',
          metadata_json='{"resourceType":"link","sourceId":"wrong"}'
        WHERE id='resource:search-stale-resource';
      UPDATE search_fts SET title='漂移资源标题',search_text='漂移资源正文'
        WHERE document_id='resource:search-stale-resource';
      UPDATE search_documents
        SET title='漂移实体标题',search_text='漂移实体正文',
          metadata_json='{"entityType":"organization","accountIds":[]}'
        WHERE id='entity:search-person-a';
      UPDATE search_fts SET title='漂移实体标题',search_text='漂移实体正文'
        WHERE document_id='entity:search-person-a';
      INSERT INTO search_documents(
        id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
      ) VALUES(
        'entity:search-person-candidate','entity','search-person-candidate',
        '候选幽灵实体','候选幽灵实体','{"entityType":"person"}','candidate-hash',
        '2026-07-31T00:00:00.000Z'
      );
      INSERT INTO search_fts(document_id,title,search_text)
        VALUES('entity:search-person-candidate','候选幽灵实体','候选幽灵实体');
    `)
    database.pragma('foreign_keys = ON')
    assert.equal(Number(database.pragma('foreign_keys', { simple: true })), 1)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const diagnostics = reopened.getDiagnostics()
      assert.equal(diagnostics.healthy, true)
      assert.equal(diagnostics.structuredSearchIndexHealthy, true)
      assert.equal(diagnostics.structuredSearchIndex.ghostDocumentsRemovedThisStart, 3)
      assert.deepEqual(diagnostics.structuredSearchIndex.missingDocumentsRebuiltThisStart, {
        claims: 1,
        relations: 0,
        events: 1,
        resources: 1,
        entities: 1
      })
      assert.equal(diagnostics.genericSearchEvidenceIdentity.orphanRowsRemovedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.orphanPayloadRowsRemovedThisStart, 8)
      assert.equal(diagnostics.structuredSearchIndex.orphanAnnRowsRemovedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.orphanAnnRowsRemovedTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.missingDocumentsRebuiltTotal, 4)
      assert.equal(diagnostics.structuredSearchIndex.ghostRowsRemovedTotal, 11)
      assert.equal(diagnostics.structuredSearchIndex.ftsPayloadsRebuiltThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.ftsPayloadsRebuiltTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.metadataDocumentsRepairedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.metadataDocumentsRepairedTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.structuredDocumentsRepairedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.structuredDocumentsRepairedTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.resourceDocumentsRepairedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.resourceDocumentsRepairedTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.entityDocumentsRepairedThisStart, 1)
      assert.equal(diagnostics.structuredSearchIndex.entityDocumentsRepairedTotal, 1)
      assert.equal(diagnostics.structuredSearchIndex.triggerRepairs, 2)
      assert.equal(reopened.searchText('索引重建关键词').some((row: any) =>
        row.id === 'claim:search-missing-claim'), true)
      assert.equal(reopened.searchText('缺失事件索引恢复验证').some((row: any) =>
        row.id === 'event:search-missing-event'), true)
      assert.equal(reopened.searchText('资源索引恢复关键词').some((row: any) =>
        row.id === 'resource:search-missing-resource'), true)
      assert.equal(reopened.searchText('权威资源正文关键词').some((row: any) =>
        row.id === 'resource:search-stale-resource'), true)
      assert.equal(reopened.searchText('漂移资源正文').length, 0)
      assert.equal(reopened.searchText('旧关系检索幽灵').some((row: any) =>
        row.id === 'relation:search-ghost-relation'), false)
      assert.equal(reopened.searchText('检索甲').some((row: any) =>
        row.id === 'entity:search-person-a'), true)
      assert.equal(reopened.searchText('检索乙').some((row: any) =>
        row.id === 'entity:search-person-b'), true)
      assert.equal(reopened.searchText('检索阿甲').some((row: any) =>
        row.id === 'entity:search-person-a'), true)
      assert.equal(reopened.searchText('wxid_search_a').some((row: any) =>
        row.id === 'entity:search-person-a'), true)
      assert.equal(reopened.searchText('search-a@example.com').some((row: any) =>
        row.id === 'entity:search-person-a'), true)
      assert.equal(reopened.searchText('负责可信实体检索').some((row: any) =>
        row.id === 'entity:search-person-a'), true)
      assert.equal(reopened.searchText('漂移实体正文').length, 0)
      assert.equal(reopened.searchText('候选幽灵实体').length, 0)
      assert.equal(reopened.searchText('过期检索载荷').length, 0)
      assert.equal(reopened.searchText('权威正文恢复').some((row: any) =>
        row.id === 'claim:search-stale-content-claim'), true)
      assert.equal(reopened.searchText('漂移事实正文').length, 0)
      const repairedContentDocument = (reopened as any).db.prepare(`
        SELECT title,search_text,content_hash,embedding_model,embedding_dimensions,embedding_json
        FROM search_documents WHERE id='claim:search-stale-content-claim'
      `).get()
      assert.equal(repairedContentDocument.title, '记录')
      assert.equal(repairedContentDocument.search_text, '检索甲记录权威正文恢复')
      assert.equal(repairedContentDocument.content_hash,
        createHash('sha256').update('检索甲记录权威正文恢复').digest('hex'))
      assert.equal(repairedContentDocument.embedding_model, null)
      assert.equal(repairedContentDocument.embedding_dimensions, null)
      assert.equal(repairedContentDocument.embedding_json, null)
      const [repairedMetadataDocument] = reopened.searchText('可信元数据漂移')
      const repairedMetadata = JSON.parse(repairedMetadataDocument.metadata_json)
      assert.equal(repairedMetadata.status, 'rejected')
      assert.equal(repairedMetadata.subjectId, 'search-person-b')
      assert.equal(repairedMetadata.polarity, 'positive')
      assert.equal(filterMemorySearchResults([{
        ...repairedMetadataDocument,
        metadata: repairedMetadata
      }]).length, 0)
      assert.equal(reopened.getDocumentEvidencePage('claim', 'search-missing-claim').total, 1)
      assert.equal(reopened.getDocumentEvidencePage('event', 'search-missing-event').total, 1)

      ;(reopened as any).db.prepare(`
        INSERT INTO vector_ann_entries(
          document_id,model,dimensions,table_id,signature,content_hash,updated_at
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        'claim:search-missing-claim', 'ann-test', 2, 0, 3,
        'protected-hash', '2026-07-31T00:00:00.000Z'
      )
      ;(reopened as any).db.exec(`
        DELETE FROM claims WHERE id='search-missing-claim';
        DELETE FROM event_participants WHERE event_id='search-missing-event';
        DELETE FROM events WHERE id='search-missing-event';
        DELETE FROM memory_resources WHERE id='search-missing-resource';
        DELETE FROM entities WHERE id='search-person-b';
      `)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM search_documents
        WHERE id IN(
          'claim:search-missing-claim','event:search-missing-event',
          'resource:search-missing-resource','entity:search-person-b'
        )
      `).get().count), 0)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM search_fts
        WHERE document_id IN('claim:search-missing-claim','event:search-missing-event')
      `).get().count), 0)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM search_document_evidence
        WHERE document_id IN('claim:search-missing-claim','event:search-missing-event')
      `).get().count), 0)
      assert.equal(Number((reopened as any).db.prepare(`
        SELECT COUNT(*) AS count FROM vector_ann_entries
        WHERE document_id IN(
          'claim:search-missing-claim','event:search-missing-event',
          'orphan:ann','relation:search-ghost-relation'
        )
      `).get().count), 0)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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
    ownershipPolicyReason: '',
    evidenceFingerprint: createHash('sha256').update(JSON.stringify([[
      'legacy', 'message-task-1', '项目群', 1_700_000_001, '客户甲',
      '麻烦你确认一下几点更新'
    ]])).digest('hex'),
    evidenceFingerprintVersion: 3,
    evidenceCount: 1
  })
  assert.deepEqual(store.getDocumentEvidence('task', 'task-1').map(item => ({ ...item })), [{
    source_id: 'legacy',
    message_id: 'message-task-1',
    session_id: '项目群',
    timestamp: 1_700_000_001,
    sender: '客户甲',
    excerpt: '麻烦你确认一下几点更新'
  }])
}))

test('generic search evidence migrates to source-and-session identity and preserves same message ids', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-generic-evidence-identity-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.upsertResources([{
      id: 'resource-cross-session-evidence',
      resourceType: 'chat-history',
      title: '跨会话同号证据',
      content: '复合证据身份',
      evidence: [{
        messageId: 'same-local-message-id',
        sessionId: 'legacy-session',
        timestamp: 1_700_003_001,
        sender: '旧会话发送者',
        excerpt: '旧会话证据'
      }]
    }])
    ;(first as any).db.exec(`
      DROP TRIGGER trg_search_documents_delete_payload;
      CREATE TABLE search_document_evidence_legacy (
        document_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL DEFAULT 0,
        sender TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(document_id,message_id)
      ) STRICT;
      INSERT INTO search_document_evidence_legacy(
        document_id,message_id,session_id,timestamp,sender,excerpt
      )
      SELECT document_id,message_id,session_id,timestamp,sender,excerpt
      FROM search_document_evidence;
      INSERT INTO search_document_evidence_legacy(
        document_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES(
        'missing-search-document','orphan-message','orphan-session',1,
        '孤儿发送者','旧库孤儿证据'
      );
      DROP TABLE search_document_evidence;
      ALTER TABLE search_document_evidence_legacy RENAME TO search_document_evidence;
      CREATE TRIGGER trg_search_documents_delete_payload
      AFTER DELETE ON search_documents
      BEGIN
        DELETE FROM search_fts WHERE document_id=OLD.id;
        DELETE FROM search_document_evidence WHERE document_id=OLD.id;
      END;
    `)
    first.close()

    const migrated = new PersonalMemoryStore()
    try {
      migrated.initialize(databasePath)
      const migration = migrated.getDiagnostics().genericSearchEvidenceIdentity
      assert.equal(migration.constraintsHealthy, true)
      assert.equal(migration.migratedThisStart, true)
      assert.equal(migration.version, 3)
      assert.deepEqual(migration.primaryKey, [
        'document_id', 'source_id', 'session_id', 'message_id'
      ])
      assert.equal(migration.sourceIdentity, true)
      assert.equal(migration.foreignKeyCascade, true)
      assert.equal(migration.lookupIndexHealthy, true)
      assert.equal(migration.orphanRowsRemovedThisStart, 1)
      assert.equal(migration.orphanRowsRemovedTotal, 1)
      assert.equal(migration.sourceRowsBackfilledThisStart, 1)
      assert.equal(migration.sourceRowsBackfilledTotal, 1)
      assert.equal(migration.migrationsTotal, 1)
      assert.deepEqual(
        (migrated as any).db.prepare(`
          PRAGMA foreign_key_list(search_document_evidence)
        `).all().map((item: any) => ({
          table: item.table,
          from: item.from,
          to: item.to,
          onDelete: item.on_delete
        })),
        [{
          table: 'search_documents',
          from: 'document_id',
          to: 'id',
          onDelete: 'CASCADE'
        }]
      )
      assert.match(String(((migrated as any).db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type='index' AND name='idx_search_document_evidence_message'
      `).get() as any)?.sql || ''), /session_id\s*,\s*message_id/i)
      migrated.upsertResources([{
        id: 'resource-cross-session-evidence',
        resourceType: 'chat-history',
        title: '跨会话同号证据',
        content: '复合证据身份',
        evidence: [{
          sourceId: 'wechat',
          messageId: 'same-local-message-id',
          sessionId: 'shared-session',
          timestamp: 1_700_003_002,
          sender: '微信发送者',
          excerpt: '微信来源证据'
        }, {
          sourceId: 'documents',
          messageId: 'same-local-message-id',
          sessionId: 'shared-session',
          timestamp: 1_700_003_003,
          sender: '文档连接器',
          excerpt: '文档来源证据'
        }]
      }])
      assert.deepEqual(
        migrated.getDocumentEvidence('resource', 'resource-cross-session-evidence')
          .map(item => item.source_id).sort(),
        ['documents', 'wechat']
      )
      const documentOnly = migrated.getDocumentEvidencePayload(
        'resource',
        'resource-cross-session-evidence',
        { sourceIds: ['documents'], sessionId: 'shared-session' }
      )
      assert.equal(documentOnly.evidenceTotal, 1)
      assert.deepEqual(
        documentOnly.evidence.map(item => [item.source_id, item.sender, item.excerpt]),
        [['documents', '文档连接器', '文档来源证据']]
      )
      assert.deepEqual(
        migrated.getDocumentEvidencePayload(
          'resource',
          'resource-cross-session-evidence',
          { sourceIds: ['mail'] }
        ),
        {
          evidence: [],
          evidenceTotal: 0,
          evidenceSourceIds: [],
          evidenceSourceIdsComplete: true
        }
      )
      migrated.upsertResources([{
        id: 'resource-cascade-evidence',
        resourceType: 'chat-history',
        title: '级联删除证据',
        content: '外键删除保护',
        evidence: [{
          messageId: 'cascade-message',
          sessionId: 'cascade-session',
          timestamp: 1_700_003_004,
          sender: '级联发送者',
          excerpt: '级联删除证据'
        }]
      }])
      ;(migrated as any).db.prepare(`
        DELETE FROM search_documents WHERE id='resource:resource-cascade-evidence'
      `).run()
      assert.equal(Number(((migrated as any).db.prepare(`
        SELECT COUNT(*) AS count FROM search_document_evidence
        WHERE document_id='resource:resource-cascade-evidence'
      `).get() as any)?.count || 0), 0)
    } finally {
      migrated.close()
    }

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const migration = reopened.getDiagnostics().genericSearchEvidenceIdentity
      assert.equal(migration.constraintsHealthy, true)
      assert.equal(migration.migratedThisStart, false)
      assert.equal(migration.migrationsTotal, 1)
      assert.equal(migration.orphanRowsRemovedTotal, 1)
      assert.equal(migration.sourceRowsBackfilledTotal, 1)
      assert.equal(
        reopened.getDocumentEvidencePage(
          'resource', 'resource-cross-session-evidence'
        ).total,
        2
      )
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('unchanged tasks repair missing search documents and evidence after an interrupted write', () => withStore(store => {
  const task = {
    id: 'task-search-repair',
    title: '恢复断电后的待办检索',
    detail: '搜索派生数据必须从权威任务恢复',
    source: '恢复测试群',
    sourceSessionId: 'session-recovery',
    priority: 'high',
    status: 'todo',
    classification: 'mine',
    evidence: [{
      messageId: 'message-task-repair',
      sessionId: 'session-original-evidence',
      timestamp: 1_700_000_123,
      sender: '测试发送者',
      excerpt: '请恢复这条待办'
    }]
  }
  store.syncTasks([task])
  ;(store as any).db.prepare('DELETE FROM search_documents WHERE id=?')
    .run('task:task-search-repair')
  assert.equal(store.searchText('恢复断电后的待办检索').length, 0)

  store.syncTasks([task])

  assert.equal(store.searchText('恢复断电后的待办检索')[0].source_id, 'task-search-repair')
  assert.deepEqual(store.getDocumentEvidence('task', 'task-search-repair').map(item => ({
    message_id: item.message_id,
    session_id: item.session_id,
    sender: item.sender,
    excerpt: item.excerpt
  })), [{
    message_id: 'message-task-repair',
    session_id: 'session-original-evidence',
    sender: '测试发送者',
    excerpt: '请恢复这条待办'
  }])
  const diagnostics = store.getDiagnostics()
  assert.equal(diagnostics.taskSearchIndexHealthy, true)
  assert.equal(diagnostics.taskSearchIndex.repairedDerivedDocumentsThisSync, 1)
  assert.equal(diagnostics.taskSearchIndex.repairedMissingDocumentsThisSync, 1)
  assert.equal(diagnostics.taskSearchIndex.repairedEvidenceSetsThisSync, 1)
}))

test('model source proof covers complete evidence beyond the bounded card preview', () => withStore(store => {
  store.upsertResources([{
    id: 'privacy-source-proof',
    resourceType: 'chat-history',
    title: '跨来源长期证据',
    content: '最近证据均来自微信，但最早证据来自 Mail',
    metadata: { sourceId: 'wechat' },
    evidence: [{
      sourceId: 'mail',
      messageId: 'old-mail-evidence',
      sessionId: 'mail-session',
      timestamp: 1,
      sender: 'Mail',
      excerpt: '较早的邮件原文'
    }, ...Array.from({ length: MEMORY_CARD_EVIDENCE_LIMIT + 5 }, (_, index) => ({
      sourceId: 'wechat',
      messageId: `recent-wechat-${index}`,
      sessionId: 'wechat-session',
      timestamp: 100 + index,
      sender: '微信',
      excerpt: `较新的微信原文 ${index}`
    }))]
  }])
  const payload = store.getDocumentEvidencePayload('resource', 'privacy-source-proof')
  assert.equal(payload.evidence.length, MEMORY_CARD_EVIDENCE_LIMIT)
  assert.ok(payload.evidence.every(item => item.source_id === 'wechat'))
  assert.deepEqual(payload.evidenceSourceIds, ['mail', 'wechat'])
  assert.equal(payload.evidenceSourceIdsComplete, true)
  const searchResult = {
    id: 'resource:privacy-source-proof',
    document_type: 'resource',
    metadata: { sourceId: 'wechat' },
    ...payload
  }
  assert.deepEqual(filterModelEligibleMemoryResults([searchResult], {
    mail: { allowModelAnalysis: false }
  }), [])
  assert.deepEqual(filterModelEligibleMemoryResults([searchResult], {
    mail: { allowModelAnalysis: true }
  }).map(item => item.id), ['resource:privacy-source-proof'])

  const excessivePolicies: Record<string, { allowModelAnalysis: boolean }> = {}
  const excessiveEvidence = Array.from({ length: 65 }, (_, index) => {
    const sourceId = `future-source-${String(index).padStart(2, '0')}`
    excessivePolicies[sourceId] = { allowModelAnalysis: true }
    return {
      sourceId,
      messageId: `future-message-${index}`,
      sessionId: 'future-session',
      timestamp: index,
      sender: '未来连接器',
      excerpt: `异常来源 ${index}`
    }
  })
  store.upsertResources([{
    id: 'privacy-source-proof-overflow',
    resourceType: 'document',
    title: '异常来源集合',
    content: '来源种类超过可证明上限',
    evidence: excessiveEvidence
  }])
  const overflow = store.getDocumentEvidencePayload(
    'resource',
    'privacy-source-proof-overflow'
  )
  assert.equal(overflow.evidenceSourceIds.length, 64)
  assert.equal(overflow.evidenceSourceIdsComplete, false)
  assert.deepEqual(filterModelEligibleMemoryResults([{
    id: 'resource:privacy-source-proof-overflow',
    document_type: 'resource',
    ...overflow
  }], excessivePolicies), [])
}))

test('task directory and search payload roll back together when a derived write fails', () => withStore(store => {
  const original = {
    id: 'task-atomic-sync',
    title: '事务前标题',
    detail: '事务前正文',
    source: '事务测试群',
    priority: 'medium',
    status: 'todo',
    classification: 'mine',
    evidence: [{
      messageId: 'message-task-atomic',
      timestamp: 1_700_000_456,
      sender: '事务发送者',
      excerpt: '事务前证据'
    }]
  }
  store.syncTasks([original])
  ;(store as any).db.exec(`
    CREATE TRIGGER fail_task_search_update
    BEFORE UPDATE ON search_documents
    WHEN OLD.id='task:task-atomic-sync'
    BEGIN
      SELECT RAISE(ABORT,'forced derived write failure');
    END;
  `)

  assert.throws(() => store.syncTasks([{
    ...original,
    title: '事务后标题',
    detail: '事务后正文'
  }]), /forced derived write failure/)

  const directory = (store as any).db.prepare(`
    SELECT title,payload_json FROM task_directory WHERE id='task-atomic-sync'
  `).get()
  assert.equal(directory.title, '事务前标题')
  assert.equal(JSON.parse(directory.payload_json).detail, '事务前正文')
  assert.equal(store.searchText('事务前正文')[0].source_id, 'task-atomic-sync')
  assert.equal(store.searchText('事务后正文').length, 0)
  assert.equal(store.getDocumentEvidencePage('task', 'task-atomic-sync').total, 1)
  ;(store as any).db.exec('DROP TRIGGER fail_task_search_update')
}))

test('task sync repairs a canonical document with a drifted type and source id', () => withStore(store => {
  const task = {
    id: 'task-identity-repair',
    title: '修复待办搜索身份',
    detail: '文档类型和来源必须回到权威任务',
    source: '身份测试群',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }
  store.syncTasks([task])
  ;(store as any).db.prepare(`
    UPDATE search_documents SET document_type='entity',source_id='wrong-source'
    WHERE id='task:task-identity-repair'
  `).run()

  store.syncTasks([task])

  const repaired = (store as any).db.prepare(`
    SELECT document_type,source_id FROM search_documents
    WHERE id='task:task-identity-repair'
  `).get()
  assert.deepEqual(repaired, {
    document_type: 'task',
    source_id: 'task-identity-repair'
  })
  assert.equal(store.searchText('修复待办搜索身份')[0].source_id, 'task-identity-repair')
}))

test('runtime search repair restores derived indexes without reopening the database', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'runtime-repair-person',
      type: 'person',
      canonicalName: '在线修复测试人',
      trustStatus: 'confirmed'
    }],
    relations: [],
    reviewQueue: []
  })
  const task = {
    id: 'runtime-repair-task',
    title: '在线修复待办关键词',
    detail: '应用无需重启即可恢复检索',
    source: '运行时测试',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }
  store.upsertClaims([{
    id: 'runtime-repair-claim',
    subjectId: 'runtime-repair-person',
    predicate: '记录',
    objectValue: '在线修复事实关键词',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'self_statement',
    searchText: '在线修复事实关键词',
    evidence: [{
      messageId: 'runtime-repair-message',
      sessionId: 'runtime-repair-session',
      timestamp: 1_700_003_000,
      sender: '测试发送者',
      excerpt: '在线修复事实关键词'
    }]
  }])
  store.syncTasks([task])
  const database = (store as any).db
  database.pragma('foreign_keys = OFF')
  database.exec(`
    DROP TRIGGER trg_memory_search_revision_search_documents_insert;
    DELETE FROM search_documents WHERE id='claim:runtime-repair-claim';
    UPDATE search_documents
      SET document_type='entity',source_id='wrong-task-source'
      WHERE id='task:runtime-repair-task';
    DELETE FROM search_fts WHERE document_id='task:runtime-repair-task';
    INSERT INTO search_documents(
      id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
    ) VALUES(
      'claim:runtime-repair-ghost','claim','runtime-repair-ghost',
      '幽灵结果','幽灵结果','{}','ghost-hash','2026-08-04T00:00:00.000Z'
    );
    INSERT INTO vector_ann_entries(
      document_id,model,dimensions,table_id,signature,content_hash,updated_at
    ) VALUES(
      'runtime-repair-ann-orphan','ann-test',2,0,1,'orphan-hash',
      '2026-08-04T00:00:00.000Z'
    );
    DROP INDEX idx_evidence_claim_role;
    CREATE INDEX idx_evidence_claim_role ON evidence(claim_id,timestamp);
    DROP INDEX idx_memory_change_log_connector_operation_time;
    CREATE INDEX idx_memory_change_log_connector_operation_time
      ON memory_change_log(origin_kind,changed_at DESC,id DESC);
    INSERT INTO memory_change_context(singleton,origin_kind,origin_id,source_kind)
    VALUES(1,'connector_page','stale-runtime-context','documents');
  `)
  database.pragma('foreign_keys = ON')

  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents WHERE id='claim:runtime-repair-claim'
  `).get().count), 0)
  const drifted = store.getDiagnostics()
  assert.equal(drifted.healthy, false)
  assert.equal(drifted.structuredSearchIndexHealthy, false)
  assert.ok(drifted.structuredSearchIndex.currentMissingDocuments >= 1)
  assert.ok(drifted.structuredSearchIndex.currentGhostDocuments >= 1)
  assert.ok(drifted.structuredSearchIndex.currentAnnOrphans >= 1)
  assert.equal(drifted.reviewInboxIndexesHealthy, false)
  assert.equal(drifted.memoryChangeLog.connectorOperationIndex.healthy, false)
  assert.equal(drifted.memoryChangeLog.originContextClean, false)
  assert.throws(() => store.createBackup(), /数据库一致性检查失败/)
  const result = store.repairRuntimeSearchDerivedState([task])

  assert.equal(result.healthy, true)
  assert.equal(result.repaired.missingDocuments, 1)
  assert.ok(result.repaired.ghostDocuments >= 1)
  assert.equal(result.repaired.annOrphans, 1)
  assert.equal(result.repaired.taskDocuments, 1)
  assert.equal(result.repaired.reviewInboxIndexes, 1)
  assert.equal(result.repaired.memoryChangeConnectorOperationIndex, 1)
  assert.equal(result.repaired.memoryChangeOriginContexts, 1)
  assert.equal(store.searchText('在线修复事实关键词')[0]?.source_id, 'runtime-repair-claim')
  assert.equal(store.searchText('在线修复待办关键词')[0]?.source_id, 'runtime-repair-task')
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents WHERE id='claim:runtime-repair-ghost'
  `).get().count), 0)
  assert.equal(result.diagnostics.memorySearchRevisionHealthy, true)
  assert.equal(result.diagnostics.structuredSearchIndexHealthy, true)
  assert.equal(result.diagnostics.taskSearchIndexHealthy, true)
  assert.equal(result.diagnostics.reviewInboxIndexesHealthy, true)
  assert.equal(result.diagnostics.memoryChangeLogHealthy, true)
  assert.equal(result.diagnostics.memoryChangeLog.originContextClean, true)
  assert.equal(result.diagnostics.memoryChangeLog.clearedOriginContextsThisStart, 1)
  assert.equal(store.getSearchMaintenanceCheckpoint().lastAuditHealthy, true)
  assert.ok(Date.parse(store.getSearchMaintenanceCheckpoint().checkedAt) > 0)
}))

test('FTS-only repairs advance search revision exactly once and remain idempotent', () => withStore(store => {
  const resources = [{
    id: 'fts-revision-a',
    resourceType: 'document',
    title: '海盐检索版本甲',
    content: '海盐检索版本共同关键词',
    metadata: { sourceId: 'documents' },
    updatedAt: '2026-08-05T01:00:00.000Z'
  }, {
    id: 'fts-revision-b',
    resourceType: 'document',
    title: '海盐检索版本乙',
    content: '海盐检索版本共同关键词',
    metadata: { sourceId: 'documents' },
    updatedAt: '2026-08-05T01:00:01.000Z'
  }]
  store.upsertResources(resources)
  const database = (store as any).db
  const beforeRepair = Number(store.getMemorySearchRevision())
  database.prepare(`
    DELETE FROM search_fts WHERE document_id='resource:fts-revision-a'
  `).run()
  assert.equal(Number(store.getMemorySearchRevision()), beforeRepair)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id='resource:fts-revision-a'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id='resource:fts-revision-b'
  `).get().count), 1)

  ;(store as any).repairStructuredSearchIndex()
  assert.equal(Number(store.getMemorySearchRevision()), beforeRepair + 1)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id IN ('resource:fts-revision-a','resource:fts-revision-b')
  `).get().count), 2)
  assert.deepEqual(
    new Set(store.searchText('海盐检索版本', 10).map((item: any) => item.id)),
    new Set(['resource:fts-revision-a', 'resource:fts-revision-b'])
  )
  const afterRepair = store.getMemorySearchRevision()
  ;(store as any).repairStructuredSearchIndex()
  assert.equal(store.getMemorySearchRevision(), afterRepair)

  database.prepare(`
    DELETE FROM search_fts WHERE document_id='resource:fts-revision-a'
  `).run()
  const beforeWriteRepair = Number(store.getMemorySearchRevision())
  store.upsertResources([resources[0]])
  assert.equal(Number(store.getMemorySearchRevision()), beforeWriteRepair + 1)
  assert.equal(
    store.searchText('海盐检索版本甲', 10)[0]?.id,
    'resource:fts-revision-a'
  )
  const afterWriteRepair = store.getMemorySearchRevision()
  store.upsertResources([resources[0]])
  assert.equal(store.getMemorySearchRevision(), afterWriteRepair)
}))

test('live structured search audit rejects resource hash drift before trusted backup', () => withStore(store => {
  store.upsertResources([{
    id: 'live-resource-hash-drift',
    resourceType: 'document',
    title: '运行期资源校验',
    content: '资源正文没有变化但内容哈希被改写',
    fileName: '运行期资源.txt',
    metadata: { sourceId: 'documents' }
  }])
  const database = (store as any).db
  database.prepare(`
    UPDATE search_documents SET content_hash='plausible-but-wrong-hash'
    WHERE id='resource:live-resource-hash-drift'
  `).run()

  const drifted = store.getDiagnostics()
  assert.equal(drifted.structuredSearchIndexHealthy, false)
  assert.equal(drifted.structuredSearchIndex.currentMetadataMismatches, 1)
  assert.throws(() => store.createBackup(), /数据库一致性检查失败/)

  const repaired = store.repairRuntimeSearchDerivedState([])
  assert.equal(repaired.healthy, true)
  assert.equal(repaired.diagnostics.structuredSearchIndex.currentMetadataMismatches, 0)
  const document = database.prepare(`
    SELECT search_text,content_hash FROM search_documents
    WHERE id='resource:live-resource-hash-drift'
  `).get()
  assert.equal(document.content_hash,
    createHash('sha256').update(document.search_text).digest('hex'))
  assert.equal(store.createBackup().success, true)
}))

test('suppressed resource search residue is blocked and removed across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-suppressed-resource-search-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const resource = {
    id: 'suppressed-resource-residue',
    resourceType: 'document',
    title: '不应继续检索的回收站资源',
    content: '回收站资源残留搜索正文',
    fileName: '回收站资源.txt',
    metadata: { sourceId: 'documents' }
  }
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.upsertResources([resource])
    ;(first as any).db.prepare(`
      INSERT INTO resource_suppressions(resource_id,reason,created_at)
      VALUES(?,?,?)
    `).run(resource.id, 'interrupted_delete', '2026-08-05T00:00:00.000Z')
    const drifted = first.getDiagnostics()
    assert.equal(drifted.structuredSearchIndexHealthy, false)
    assert.equal(drifted.structuredSearchIndex.currentGhostDocuments, 1)
    assert.throws(() => first.createBackup(), /数据库一致性检查失败/)
    first.close()

    reopened.initialize(databasePath, key)
    const repaired = reopened.getDiagnostics()
    assert.equal(repaired.healthy, true)
    assert.equal(repaired.structuredSearchIndexHealthy, true)
    assert.equal(repaired.structuredSearchIndex.ghostDocumentsRemovedThisStart, 1)
    assert.equal(reopened.searchText('回收站资源残留搜索正文').length, 0)
    assert.equal(reopened.getMemoryStats().resources, 0)

    ;(reopened as any).db.prepare(
      'DELETE FROM resource_suppressions WHERE resource_id=?'
    ).run(resource.id)
    reopened.upsertResources([resource])
    assert.equal(reopened.searchText('回收站资源残留搜索正文')[0]?.source_id,
      resource.id)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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

test('weekly briefing exposes every daily summary in newest-first order', () => {
  const briefings = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const day = String(30 - index).padStart(2, '0')
    return [`2026-07-${day}`, {
      messageCount: index + 1,
      headline: `第 ${index + 1} 天`,
      summary: `第 ${index + 1} 天完整摘要`,
      summaryVerified: index % 2 === 0,
      summaryEvidence: index % 2 === 0 ? [{
        evidenceKey: `wechat:session:${index}`,
        excerpt: `原文 ${index}`
      }] : []
    }]
  }))
  const weekly = buildWeeklyBriefing(
    briefings,
    [],
    new Date('2026-07-30T12:00:00+08:00')
  )
  assert.equal(weekly.daysWithUpdates, 7)
  assert.equal(weekly.summaryCount, 7)
  assert.equal(weekly.summaries.length, 7)
  assert.deepEqual(
    weekly.summaries.map((item: any) => item.date),
    ['2026-07-30', '2026-07-29', '2026-07-28', '2026-07-27', '2026-07-26', '2026-07-25', '2026-07-24']
  )
  assert.equal(weekly.verifiedSummaryCount, 4)
  assert.equal(weekly.summaryEvidenceCount, 4)
  assert.equal(weekly.summaries.some((item: any) => item.date === '2026-07-23'), false)
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
  assert.deepEqual(grounded.summaryEvidence.map(item => item.sourceId), ['wechat'])
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

test('structured extraction evidence preserves explicit source and sender identity', () => {
  const incoming = buildStructuredExtractionEvidence({
    sourceId: 'documents',
    sessionId: 'data-source:documents',
    id: 'document-42',
    timestamp: 1_800_000_000,
    senderName: '项目计划.docx',
    direction: '本机文档'
  }, '文档证据正文', 'indirect')
  assert.deepEqual(incoming, {
    sourceId: 'documents',
    messageId: 'documents:data-source:documents:document-42',
    sessionId: 'data-source:documents',
    timestamp: 1_800_000_000,
    sender: '项目计划.docx',
    excerpt: '文档证据正文',
    role: 'indirect'
  })
  const outgoing = buildStructuredExtractionEvidence({
    sourceId: 'wechat',
    sessionId: 'private-chat',
    id: 'message-7',
    senderName: '错误显示名',
    direction: '我发送'
  }, '本人发出的原文')
  assert.equal(outgoing.sender, '我')
  assert.equal(outgoing.sourceId, 'wechat')
  assert.equal('role' in outgoing, false)
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
  assert.ok(Number.isFinite(Date.parse(outbox.pending[0].lastAttemptAt)))
  assert.ok(Date.parse(outbox.pending[0].nextAttemptAt) > Date.parse(outbox.pending[0].lastAttemptAt))
  markNotificationAttempt(outbox, notification.key, { success: true })
  assert.equal(outbox.pending.length, 0)
  assert.deepEqual(outbox.sentKeys, [notification.key])
  assert.equal(enqueueUniqueNotification(outbox, notification), false)
})

test('notification delivery does not let one failed head item starve later work', async () => {
  const outbox = { pending: [], sentKeys: [] } as any
  for (let index = 0; index < 8; index += 1) {
    enqueueUniqueNotification(outbox, {
      key: `notification-${index}`,
      title: `通知 ${index}`,
      content: `内容 ${index}`,
      createdAt: `2026-08-04T00:00:0${index}.000Z`
    })
  }
  const persisted: string[][] = []
  const result = await deliverNotificationBatch(outbox, async notification => {
    if (notification.key === 'notification-0') throw new Error('temporary failure')
  }, {
    limit: 5,
    normalizeError: () => '脱敏失败',
    onAttempt: () => persisted.push(outbox.pending.map((item: any) => item.key))
  })
  assert.deepEqual(result, { attempted: 5, sent: 4, failed: 1 })
  assert.deepEqual(outbox.pending.map((item: any) => item.key), [
    'notification-0', 'notification-5', 'notification-6', 'notification-7'
  ])
  assert.equal(outbox.pending[0].attempts, 1)
  assert.equal(outbox.pending[0].lastError, '脱敏失败')
  assert.deepEqual(outbox.sentKeys, [
    'notification-1', 'notification-2', 'notification-3', 'notification-4'
  ])
  assert.equal(persisted.length, 5)
  assert.deepEqual(persisted[0], Array.from({ length: 8 }, (_, index) => `notification-${index}`))
  assert.deepEqual(persisted[4], ['notification-0', 'notification-5', 'notification-6', 'notification-7'])
})

test('notification retries persist exponential backoff without starving due work', async () => {
  const outbox = { pending: [], sentKeys: [] } as any
  enqueueUniqueNotification(outbox, {
    key: 'cooling-down',
    title: '冷却中的通知',
    content: '稍后再试',
    createdAt: '2026-08-07T00:00:00.000Z'
  })
  enqueueUniqueNotification(outbox, {
    key: 'due-now',
    title: '当前可投递',
    content: '应当继续发送',
    createdAt: '2026-08-07T00:01:00.000Z'
  })
  const firstAttempt = new Date('2026-08-07T01:00:00.000Z')
  markNotificationAttempt(
    outbox,
    'cooling-down',
    { success: false, error: 'temporary failure' },
    firstAttempt
  )
  assert.equal(outbox.pending[0].nextAttemptAt, '2026-08-07T01:15:00.000Z')

  const delivered: string[] = []
  const result = await deliverNotificationBatch(outbox, async notification => {
    delivered.push(notification.key)
  }, {
    now: new Date('2026-08-07T01:05:00.000Z'),
    limit: 5
  })
  assert.deepEqual(result, { attempted: 1, sent: 1, failed: 0 })
  assert.deepEqual(delivered, ['due-now'])
  assert.deepEqual(outbox.pending.map((item: any) => item.key), ['cooling-down'])

  for (let attempt = 2; attempt <= 7; attempt += 1) {
    const at = new Date(Date.parse(outbox.pending[0].nextAttemptAt))
    markNotificationAttempt(
      outbox,
      'cooling-down',
      { success: false, error: 'still unavailable' },
      at
    )
  }
  assert.equal(
    Date.parse(outbox.pending[0].nextAttemptAt) - Date.parse(outbox.pending[0].lastAttemptAt),
    6 * 60 * 60_000
  )
})

test('notification queue capacity keeps the newest work and audits every discarded item', () => {
  const outbox = { pending: [], sentKeys: [] } as any
  for (let index = 0; index < 105; index += 1) {
    assert.equal(enqueueUniqueNotification(outbox, {
      key: `capacity-${index}`,
      title: `通知 ${index}`,
      content: `内容 ${index}`,
      createdAt: new Date(1_700_000_000_000 + index).toISOString()
    }), true)
  }
  assert.equal(outbox.pending.length, 100)
  assert.equal(outbox.pending[0].key, 'capacity-5')
  assert.equal(outbox.pending[99].key, 'capacity-104')
  assert.equal(outbox.discardedPendingCount, 5)
  assert.ok(Number.isFinite(Date.parse(outbox.lastDiscardedPendingAt)))
})

test('notification identities stay fixed-size for arbitrarily large task batches', () => {
  const identities = Array.from({ length: 20_000 }, (_, index) => `task-${index}`)
  const forward = buildNotificationDedupKey('new-tasks', identities)
  const reversed = buildNotificationDedupKey('new-tasks', [...identities].reverse())
  assert.equal(forward, reversed)
  assert.match(forward, /^new-tasks:v2:[a-f0-9]{64}$/)
  assert.equal(forward.length, 77)
  assert.equal(
    buildNotificationDedupKey('new-tasks', [...identities, 'task-1']),
    forward
  )
})

test('legacy notification state migrates identities and rejects malformed payloads', () => {
  const normalized = normalizeNotificationOutbox({
    pending: [{
      key: 'new-tasks:task-b,task-a',
      title: '新待办',
      content: '内容',
      createdAt: '2026-08-07T00:00:00.000Z',
      attempts: 2,
      lastAttemptAt: '2026-08-07T01:00:00.000Z',
      nextAttemptAt: '2026-08-07T01:30:00.000Z'
    }, {
      key: 'new-tasks:task-a,task-b',
      title: '迁移后重复',
      content: '不应重复',
      createdAt: '2026-08-07T00:01:00.000Z'
    }, {
      key: '',
      title: '异常项',
      createdAt: 'not-a-date'
    }],
    sentKeys: ['task-reminders:2026-08-06'],
    identityMigrationCount: 4,
    discardedInvalidCount: 3
  })
  assert.equal(normalized.pending.length, 1)
  assert.match(normalized.pending[0].key, /^new-tasks:v2:[a-f0-9]{64}$/)
  assert.equal(normalized.pending[0].attempts, 2)
  assert.deepEqual(normalized.sentKeys, ['task-reminders:2026-08-06'])
  assert.equal(normalized.identityMigrationCount, 6)
  assert.equal(normalized.discardedInvalidCount, 4)
})

test('notification startup normalization audits capacity repair and bounds counters', () => {
  const normalized = normalizeNotificationOutbox({
    pending: Array.from({ length: 105 }, (_, index) => ({
      key: `pending-capacity-${index}`,
      title: `通知 ${index}`,
      content: '',
      createdAt: new Date(1_700_000_000_000 + index).toISOString()
    })),
    sentKeys: Array.from({ length: 505 }, (_, index) => `sent-capacity-${index}`),
    discardedPendingCount: 7,
    prunedSentKeyCount: 11,
    identityMigrationCount: Number.POSITIVE_INFINITY,
    discardedInvalidCount: Number.MAX_SAFE_INTEGER
  })
  assert.equal(normalized.pending.length, 100)
  assert.equal(normalized.pending[0].key, 'pending-capacity-5')
  assert.equal(normalized.sentKeys.length, 500)
  assert.equal(normalized.sentKeys[0], 'sent-capacity-5')
  assert.equal(normalized.discardedPendingCount, 12)
  assert.equal(normalized.prunedSentKeyCount, 16)
  assert.equal(normalized.identityMigrationCount, 0)
  assert.equal(normalized.discardedInvalidCount, Number.MAX_SAFE_INTEGER)
  assert.ok(Number.isFinite(Date.parse(String(normalized.lastDiscardedPendingAt))))
})

test('notification enqueue bounds each persisted field before it reaches encrypted state', () => {
  const outbox = { pending: [], sentKeys: [] } as any
  assert.equal(enqueueUniqueNotification(outbox, {
    key: 'x'.repeat(10_000),
    title: ` 标题${'甲'.repeat(300)} `,
    content: '乙'.repeat(2_000),
    createdAt: '2026-08-07T00:00:00.000Z'
  }), true)
  assert.match(outbox.pending[0].key, /^notification:v2:[a-f0-9]{64}$/)
  assert.equal(outbox.pending[0].title.length, 160)
  assert.equal(outbox.pending[0].content.length, 600)
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

test('graph paths never traverse relations outside the retrieval scope', () => {
  const entities = [
    { id: 'left' },
    { id: 'right' },
    { id: 'calendar-bridge' },
    { id: 'rejected-bridge' }
  ]
  const relations = [{
    id: 'wechat-direct',
    subjectId: 'left',
    objectId: 'right',
    predicate: '微信关系',
    status: 'confirmed',
    evidence: [{ sourceId: 'wechat', messageId: 'wechat-direct' }]
  }, {
    id: 'calendar-left',
    subjectId: 'left',
    objectId: 'calendar-bridge',
    predicate: '日历同会',
    status: 'confirmed',
    evidence: [{ sourceId: 'calendar', messageId: 'calendar-left' }]
  }, {
    id: 'calendar-right',
    subjectId: 'calendar-bridge',
    objectId: 'right',
    predicate: '日历同会',
    status: 'confirmed',
    evidence: [{ sourceId: 'calendar', messageId: 'calendar-right' }]
  }, {
    id: 'rejected-shortcut',
    subjectId: 'left',
    objectId: 'rejected-bridge',
    predicate: '错误捷径',
    status: 'rejected'
  }, {
    id: 'rejected-shortcut-end',
    subjectId: 'rejected-bridge',
    objectId: 'right',
    predicate: '错误捷径',
    status: 'confirmed'
  }]
  const unscoped = findScopedGraphPath('left', 'right', entities, relations, 6)
  assert.deepEqual(unscoped.steps.map((step: any) => step.relationId), ['wechat-direct'])
  const calendarOnly = findScopedGraphPath(
    'left',
    'right',
    entities,
    relations,
    6,
    new Set(['calendar-left', 'calendar-right'])
  )
  assert.deepEqual(
    calendarOnly.steps.map((step: any) => step.relationId),
    ['calendar-left', 'calendar-right']
  )
  const noEligiblePath = findScopedGraphPath(
    'left',
    'right',
    entities,
    relations,
    6,
    new Set(['calendar-left'])
  )
  assert.equal(noEligiblePath.found, false)
  assert.deepEqual(noEligiblePath.steps, [])
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

test('project member directory pages every confirmed person once and rejects stale continuation', () => {
  withStore(store => {
    const people = Array.from({ length: 105 }, (_, index) => ({
      id: `project-member-${String(index).padStart(3, '0')}`,
      type: 'person',
      canonicalName: `成员 ${String(index).padStart(3, '0')}`,
      trustStatus: 'confirmed'
    }))
    const project = {
      id: 'project-member-directory',
      type: 'project',
      canonicalName: '完整成员目录',
      trustStatus: 'confirmed'
    }
    const relations = people.flatMap((person, index) => [{
      id: `project-member-relation-${index}`,
      subjectId: index % 2 ? project.id : person.id,
      objectId: index % 2 ? person.id : project.id,
      predicate: index % 2 ? '成员包括' : '参与',
      status: 'confirmed',
      confidence: 1
    }, ...(index === 0 ? [{
      id: 'project-member-duplicate-semantic-edge',
      subjectId: person.id,
      objectId: project.id,
      predicate: '负责',
      status: 'confirmed',
      confidence: 1
    }] : [])])
    store.syncGraph({
      entities: [
        project,
        ...people,
        {
          id: 'project-member-candidate',
          type: 'person',
          canonicalName: '候选成员',
          trustStatus: 'candidate'
        },
        {
          id: 'project-member-organization',
          type: 'organization',
          canonicalName: '协作组织',
          trustStatus: 'confirmed'
        }
      ],
      relations: [
        ...relations,
        {
          id: 'project-member-candidate-relation',
          subjectId: 'project-member-candidate',
          objectId: project.id,
          predicate: '参与',
          status: 'confirmed',
          confidence: 1
        },
        {
          id: 'project-member-organization-relation',
          subjectId: 'project-member-organization',
          objectId: project.id,
          predicate: '协作',
          status: 'confirmed',
          confidence: 1
        }
      ],
      reviewQueue: []
    } as any)

    const first = store.listProjectMemberPage({
      projectId: project.id,
      limit: 40
    })
    const second = store.listProjectMemberPage({
      projectId: project.id,
      limit: 40,
      offset: first.items.length,
      revision: first.revision
    })
    const third = store.listProjectMemberPage({
      projectId: project.id,
      limit: 40,
      offset: first.items.length + second.items.length,
      revision: first.revision
    })
    const ids = [...first.items, ...second.items, ...third.items].map(item => item.id)
    assert.equal(first.total, 105)
    assert.equal(first.hasMore, true)
    assert.equal(second.hasMore, true)
    assert.equal(third.hasMore, false)
    assert.equal(ids.length, 105)
    assert.equal(new Set(ids).size, 105)
    assert.equal(ids.includes('project-member-candidate'), false)
    assert.equal(ids.includes('project-member-organization'), false)

    store.syncGraph({
      entities: [project, ...people],
      relations,
      reviewQueue: []
    } as any)
    const stale = store.listProjectMemberPage({
      projectId: project.id,
      limit: 40,
      offset: 40,
      revision: first.revision
    })
    assert.equal(stale.stale, true)
    assert.deepEqual(stale.items, [])
  })
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

test('project directory paginates thousands of projects with filters and revision safety', () => {
  const entities = Array.from({ length: 2_500 }, (_, index) => ({
    id: `paged-project-${String(index).padStart(4, '0')}`,
    type: 'project',
    canonicalName: index === 1777 ? '北辰特殊项目' : `分页项目 ${index}`,
    aliases: index === 1777 ? ['Orion Initiative'] : [],
    summary: index === 1777 ? '跨团队特殊摘要' : `项目摘要 ${index}`,
    trustStatus: 'confirmed'
  }))
  const tasks = entities.map((entity, index) => ({
    id: `paged-project-task-${index}`,
    title: `推进 ${entity.canonicalName}`,
    project: entity.canonicalName,
    status: index % 4 === 0 ? 'done' : index % 2 === 0 ? 'doing' : 'todo',
    priority: index % 5 === 0 ? 'high' : 'medium',
    evidence: [{
      messageId: `paged-project-evidence-${index}`,
      excerpt: `不应进入项目目录 ${'原文'.repeat(100)}`
    }]
  }))
  tasks.push({
    id: 'derived-project-task',
    title: '推进无实体项目',
    project: '仅待办派生项目',
    status: 'doing',
    priority: 'medium',
    evidence: []
  } as any)
  const input = { entities, relations: [], claims: [], events: [], tasks }
  const directory = buildProjectDirectory(input)
  assert.equal(countProjectDirectory(input), 2_501)
  assert.equal(directory.length, 2_501)

  const first = paginateProjectDirectory(directory, { limit: 100 }, 'project-revision-1')
  const second = paginateProjectDirectory(directory, {
    limit: 100, offset: 100, revision: first.revision
  }, 'project-revision-1')
  assert.equal(first.items.length, 100)
  assert.equal(first.total, 2_501)
  assert.equal(second.items.length, 100)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.equal(JSON.stringify(first.items).includes('不应进入项目目录'), false)
  assert.equal(
    paginateProjectDirectory(directory, { query: '特殊摘要' }, 'project-revision-1')
      .items[0]?.id,
    'paged-project-1777'
  )
  assert.ok(paginateProjectDirectory(directory, { phase: 'completed' }, 'project-revision-1').total > 0)
  const stale = paginateProjectDirectory(directory, {
    limit: 100, offset: 100, revision: 'project-revision-1'
  }, 'project-revision-2')
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
})

test('project task pages preserve exact project assignment, all statuses, and revision safety', () => {
  const tasks = [
    ...Array.from({ length: 1_000 }, (_, index) => ({
      id: `long-project-task-${String(index).padStart(4, '0')}`,
      title: `长期项目任务 ${index}`,
      project: '项目 4',
      status: ['todo', 'doing', 'waiting', 'done', 'cancelled'][index % 5],
      priority: ['high', 'medium', 'low'][index % 3],
      updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      evidence: [{
        messageId: `long-project-message-${index}`,
        sessionId: 'long-project',
        timestamp: index,
        excerpt: `长期项目任务原文 ${index}`
      }]
    })),
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `similar-project-task-${index}`,
      title: `相似项目任务 ${index}`,
      project: '项目 42',
      status: 'todo',
      priority: 'medium'
    }))
  ]
  const project = buildProjectInsight({
    entities: [{
      id: 'long-project',
      type: 'project',
      canonicalName: '项目 4',
      aliases: [],
      trustStatus: 'confirmed'
    }],
    relations: [],
    claims: [],
    events: [],
    tasks
  }, 'long-project')
  assert.equal(project.taskTotal, 1_000)
  assert.equal(project.tasks.some((task: any) => task.project === '项目 42'), false)

  const first = paginateProjectTasks(project, { limit: 40 }, 'project-task-revision-1')
  const second = paginateProjectTasks(project, {
    limit: 40, offset: 40, revision: first.revision
  }, 'project-task-revision-1')
  assert.equal(first.items.length, 40)
  assert.equal(first.total, 1_000)
  assert.equal(first.hasMore, true)
  assert.equal(new Set([...first.items, ...second.items].map((task: any) => task.id)).size, 80)
  assert.deepEqual(new Set(first.items.map((task: any) => task.status)),
    new Set(['todo', 'doing', 'waiting', 'done', 'cancelled']))
  assert.equal(first.items[0].evidenceTotal, 1)
  const stale = paginateProjectTasks(project, {
    limit: 40, offset: 40, revision: 'project-task-revision-1'
  }, 'project-task-revision-2')
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
})

test('project risk pages are severity ordered, date aware in Shanghai, and revision safe', () => {
  const project = buildProjectInsight({
    entities: [{
      id: 'risk-project',
      type: 'project',
      canonicalName: '风险项目',
      aliases: [],
      trustStatus: 'confirmed'
    }],
    relations: [],
    claims: [],
    events: [],
    tasks: [
      ...Array.from({ length: 500 }, (_, index) => ({
        id: `risk-task-${String(index).padStart(4, '0')}`,
        title: `风险任务 ${index}`,
        project: '风险项目',
        status: 'waiting',
        taskKind: 'waiting',
        priority: 'high',
        due: '2026-07-30',
        dependsOnIds: ['external-project-blocker']
      })),
      {
        id: 'external-project-blocker',
        title: '其他项目仍未完成的前置任务',
        project: '其他项目',
        status: 'todo',
        priority: 'medium'
      }
    ],
    now: new Date('2026-07-30T16:30:00.000Z')
  }, 'risk-project')
  assert.equal(project.risks.length, 1_500)
  assert.ok(project.risks.some((risk: any) => risk.kind === 'overdue'))

  const first = paginateProjectRisks(project, { limit: 40 }, 'risk-revision:day=2026-07-31')
  const second = paginateProjectRisks(project, {
    limit: 40, offset: 40, revision: first.revision
  }, 'risk-revision:day=2026-07-31')
  assert.equal(first.total, 1_500)
  assert.equal(first.items.length, 40)
  assert.ok(first.items.every((risk: any) => risk.severity === 'high'))
  assert.equal(new Set([...first.items, ...second.items]
    .map((risk: any) => `${risk.taskId}:${risk.kind}`)).size, 80)
  const staleAtMidnight = paginateProjectRisks(project, {
    limit: 40,
    offset: 40,
    revision: 'risk-revision:day=2026-07-31'
  }, 'risk-revision:day=2026-08-01')
  assert.equal(staleAtMidnight.stale, true)
  assert.equal(staleAtMidnight.items.length, 0)
})

test('project memory is scoped in SQL before limits and preserves authoritative candidate totals', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'project-memory-scope',
      type: 'project',
      canonicalName: '长期项目',
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }, {
      id: 'unrelated-memory-scope',
      type: 'project',
      canonicalName: '无关项目',
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }, ...Array.from({ length: 125 }, (_, index) => ({
      id: `project-relation-neighbor-${index}`,
      type: 'person',
      canonicalName: `项目关系人物 ${index}`,
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }))],
    relations: Array.from({ length: 125 }, (_, index) => ({
      id: `project-scoped-relation-${index}`,
      subjectId: 'project-memory-scope',
      predicate: index % 2 ? '协作' : '负责',
      objectId: `project-relation-neighbor-${index}`,
      confidence: 0.9 - index / 10_000,
      status: 'confirmed',
      createdAt: new Date(1_550_000_000_000 + index * 1000).toISOString(),
      updatedAt: new Date(1_550_000_000_000 + index * 1000).toISOString(),
      evidence: index === 0
        ? [{ ...evidence(`project-scoped-relation-message-${index}`, `项目关系原文 ${index}`)[0],
            sourceId: 'mail' }]
        : evidence(`project-scoped-relation-message-${index}`, `项目关系原文 ${index}`)
    })),
    reviewQueue: []
  } as any, '', {
    entityEvidence: Array.from({ length: 125 }, (_, index) => ({
      entityId: 'project-memory-scope',
      sourceId: 'wechat',
      messageId: `wechat:identity-session:identity-message-${index}`,
      sessionId: 'identity-session',
      timestamp: 1_900_000_000 + index,
      sender: `身份发送者 ${index}`,
      excerpt: `项目身份直接原文 ${index}`,
      evidenceKind: index % 2 ? 'entity_mention' : 'identity_anchor'
    }))
  })
  const recoveredProjectEntity = store.loadGraphSnapshot().entities.find(
    entity => entity.id === 'project-memory-scope'
  )
  assert.equal(recoveredProjectEntity?.evidenceMessageIds.length, 250)
  assert.ok(recoveredProjectEntity?.evidenceMessageIds.includes(
    'wechat:identity-session:identity-message-124'
  ))
  const claims = Array.from({ length: 260 }, (_, index) => ({
    id: `project-scoped-claim-${index}`,
    subjectId: 'project-memory-scope',
    predicate: `项目事实 ${index}`,
    objectValue: `值 ${index}`,
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: `长期项目 项目事实 ${index}`,
    createdAt: new Date(1_500_000_000_000 + index * 1000).toISOString(),
    evidence: evidence(`project-scoped-claim-message-${index}`, `项目事实原文 ${index}`)
  }))
  const unrelatedClaims = Array.from({ length: 600 }, (_, index) => ({
    id: `unrelated-scoped-claim-${index}`,
    subjectId: 'unrelated-memory-scope',
    predicate: `无关事实 ${index}`,
    objectValue: `无关值 ${index}`,
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: `无关项目 无关事实 ${index}`,
    createdAt: new Date(1_800_000_000_000 + index * 1000).toISOString(),
    evidence: evidence(`unrelated-scoped-claim-message-${index}`, `无关事实原文 ${index}`)
  }))
  store.upsertClaims([...claims, ...unrelatedClaims])
  store.upsertEvents(Array.from({ length: 240 }, (_, index) => ({
    id: `project-scoped-event-${index}`,
    eventType: index % 2 ? 'decision' : 'meeting',
    title: index === 217 ? '远期火星发布会' : `项目事件 ${index}`,
    description: `长期项目事件 ${index}`,
    startAt: new Date(1_600_000_000_000 + index * 1000).toISOString(),
    endAt: '',
    location: '',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: `长期项目 项目事件 ${index}`,
    createdAt: new Date(1_600_000_000_000 + index * 1000).toISOString(),
    participants: [{ entityId: 'project-memory-scope', role: 'project' }],
    evidence: evidence(`project-scoped-event-message-${index}`, `项目事件原文 ${index}`)
  })))

  const memory = store.getEntityMemory('project-memory-scope', 200, true)
  assert.equal(memory.claimTotal, 260)
  assert.equal(memory.claims.length, 200)
  assert.ok(memory.claims.every(item => item.subject_id === 'project-memory-scope'))
  assert.equal(memory.eventTotal, 240)
  assert.equal(memory.events.length, 200)
  assert.ok(memory.events.every(item =>
    item.participants.some((participant: any) => participant.entity_id === 'project-memory-scope')))
  assert.equal(JSON.stringify(memory).includes('无关事实原文'), false)

  const claimPage = store.listClaimArchive({
    entityId: 'project-memory-scope', limit: 40
  })
  const claimPage2 = store.listClaimArchive({
    entityId: 'project-memory-scope', limit: 40, offset: 40, revision: claimPage.revision
  })
  assert.equal(claimPage.total, 260)
  assert.equal(new Set([...claimPage.items, ...claimPage2.items].map(item => item.id)).size, 80)

  const eventPage = store.listEventTimeline({
    entityId: 'project-memory-scope', limit: 40
  })
  const eventPage2 = store.listEventTimeline({
    entityId: 'project-memory-scope', limit: 40, offset: 40, revision: eventPage.revision
  })
  assert.equal(eventPage.total, 240)
  assert.equal(new Set([...eventPage.items, ...eventPage2.items].map(item => item.id)).size, 80)
  assert.equal(store.listEventTimeline({
    entityId: 'project-memory-scope',
    query: '火星发布'
  }).items[0]?.id, 'project-scoped-event-217')
  assert.equal(store.listEventTimeline({ entityId: 'unrelated-memory-scope' }).total, 0)

  const relationPage = store.listEntityRelationPage({
    entityId: 'project-memory-scope', limit: 40
  })
  const relationPage2 = store.listEntityRelationPage({
    entityId: 'project-memory-scope', limit: 40, offset: 40, revision: relationPage.revision
  })
  assert.equal(relationPage.total, 125)
  assert.equal(relationPage.items.length, 40)
  assert.equal(new Set([...relationPage.items, ...relationPage2.items].map(item => item.id)).size, 80)
  assert.equal(relationPage.items[0].evidenceTotal, 1)
  const outgoingRelations = store.listEntityRelationPage({
    entityId: 'project-memory-scope', direction: 'outgoing', limit: 100
  })
  assert.equal(outgoingRelations.total, 125)
  assert.ok(outgoingRelations.items.every(item => item.subject_id === 'project-memory-scope'))
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', direction: 'incoming'
  }).total, 0)
  const namedRelation = relationPage.items[0]
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope',
    query: String(namedRelation.object_name || '').slice(0, 8)
  }).total > 0, true)
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', status: 'confirmed'
  }).total, 125)
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', status: 'candidate'
  }).total, 0)
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', sourceId: 'mail'
  }).total, 1)
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', sourceId: 'legacy'
  }).total, 124)
  const entityEvidencePage = store.listEntityEvidencePage({
    entityId: 'project-memory-scope', limit: 40
  })
  const entityEvidenceStats = store.getEntityEvidenceStats('project-memory-scope')
  const entityEvidencePage2 = store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    limit: 40,
    offset: 40,
    revision: entityEvidencePage.revision
  })
  assert.equal(entityEvidencePage.total, 750)
  assert.equal(entityEvidencePage.unfilteredTotal, 750)
  assert.equal(entityEvidenceStats.evidenceTotal, 750)
  assert.equal(entityEvidenceStats.lastEvidenceAt, 1_900_000_124)
  assert.equal(entityEvidenceStats.activeEvidenceTotal, 750)
  assert.equal(entityEvidenceStats.lastActiveEvidenceAt, 1_900_000_124)
  assert.equal(new Set([...entityEvidencePage.items, ...entityEvidencePage2.items]
    .map(item => `${item.source_id}:${item.session_id}:${item.message_id}`)).size, 80)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', query: '项目关系原文'
  }).total, 125)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', sourceId: 'legacy'
  }).total, 624)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', sourceId: 'wechat'
  }).total, 125)
  const directIdentityEvidence = store.listEntityEvidencePage({
    entityId: 'project-memory-scope', query: '项目身份直接原文', limit: 100
  })
  assert.equal(directIdentityEvidence.total, 125)
  assert.ok(directIdentityEvidence.items.every(item => item.memoryKinds.includes('identity')))
  const identityOnlyEvidence = store.listEntityEvidencePage({
    entityId: 'project-memory-scope', memoryKind: 'identity', limit: 40
  })
  assert.equal(identityOnlyEvidence.total, 125)
  assert.ok(identityOnlyEvidence.items.every(item => item.memoryKinds.includes('identity')))
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    memoryKind: 'identity',
    limit: 40,
    offset: 40,
    revision: identityOnlyEvidence.revision
  }).items.length, 40)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', memoryKind: 'relation', sourceId: 'mail'
  }).total, 1)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', memoryKind: 'relation', sourceId: 'wechat'
  }).total, 0)
  const recentIdentityEvidence = store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    memoryKind: 'identity',
    from: new Date(1_900_000_100 * 1000).toISOString(),
    to: new Date(1_900_000_124 * 1000).toISOString(),
    limit: 10
  })
  assert.equal(recentIdentityEvidence.total, 25)
  assert.equal(recentIdentityEvidence.items.length, 10)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    memoryKind: 'identity',
    from: new Date(1_900_000_100 * 1000).toISOString(),
    to: new Date(1_900_000_124 * 1000).toISOString(),
    limit: 10,
    offset: 10,
    revision: recentIdentityEvidence.revision
  }).items.length, 10)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    memoryKind: 'identity',
    sourceId: 'wechat',
    from: new Date(1_900_000_120 * 1000).toISOString()
  }).total, 5)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'unrelated-memory-scope', query: '项目关系原文'
  }).total, 0)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope', limit: 40, offset: 40
  }).stale, true)
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope', limit: 40, offset: 40
  }).stale, true)

  const counts = store.getProjectReviewCounts([
    'project-memory-scope',
    'unrelated-memory-scope'
  ])
  assert.deepEqual(counts['project-memory-scope'], {
    candidateClaims: 260,
    candidateEvents: 240,
    candidateMilestones: 120,
    candidateDecisions: 120,
    candidateRelations: 0,
    total: 500
  })
  assert.equal(counts['unrelated-memory-scope'].candidateClaims, 600)
  assert.deepEqual(store.getEntityCandidateReviewCounts('project-memory-scope'), {
    claims: 260,
    relations: 0,
    events: 240,
    total: 500
  })
  assert.deepEqual(store.getEntityCandidateReviewCounts('unrelated-memory-scope'), {
    claims: 600,
    relations: 0,
    events: 0,
    total: 600
  })
  store.upsertClaims([{
    id: 'relation-page-concurrent-evidence-change',
    subjectId: 'unrelated-memory-scope',
    predicate: '并发补证据',
    objectValue: '触发结构化记忆版本',
    confidence: 0.9,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: '并发补证据触发结构化记忆版本',
    evidence: evidence('relation-page-concurrent-message', '并发补证据')
  }])
  assert.equal(store.listEntityRelationPage({
    entityId: 'project-memory-scope',
    limit: 40,
    offset: 40,
    revision: relationPage.revision
  }).stale, true)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'project-memory-scope',
    limit: 40,
    offset: 40,
    revision: entityEvidencePage.revision
  }).stale, true)
}))

test('entity identity anchors stay bounded, searchable and content-revision paged', () => withStore(store => {
  const entity = {
    id: 'large-identity-directory-person',
    type: 'person',
    canonicalName: '大型身份目录人物',
    summary: '',
    confidence: 1,
    trustStatus: 'confirmed',
    summaryStatus: 'confirmed',
    identityVersion: 1,
    aliases: Array.from({ length: 125 }, (_, index) =>
      `历史别名 ${String(index).padStart(3, '0')}`),
    accountIds: Array.from({ length: 80 }, (_, index) =>
      `wxid_large_identity_${String(index).padStart(3, '0')}`),
    externalIdentities: Array.from({ length: 60 }, (_, index) => ({
      platform: index % 2 ? 'email' : 'github',
      accountId: index % 2
        ? `person-${String(index).padStart(3, '0')}@example.com`
        : `large-person-${String(index).padStart(3, '0')}`,
      displayName: `外部身份 ${String(index).padStart(3, '0')}`,
      confidence: 0.9
    }))
  }
  store.syncGraph({ entities: [entity], relations: [], reviewQueue: [] } as any)
  const first = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    limit: 40
  })
  assert.equal(first.items.length, 40)
  assert.equal(first.total, 265)
  assert.equal(first.unfilteredTotal, 265)
  assert.deepEqual(first.counts, {
    alias: 125,
    identity: 140,
    wechat: 80,
    external: 60
  })
  assert.deepEqual(first.platforms, ['email', 'github', 'wechat'])
  const second = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    offset: 40,
    limit: 40,
    revision: first.revision
  })
  assert.equal(second.items.length, 40)
  assert.equal(new Set([...first.items, ...second.items]
    .map(item => `${item.kind}:${item.platform}:${item.value}`)).size, 80)
  const email = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    kind: 'identity',
    platform: 'email',
    limit: 40
  })
  assert.equal(email.total, 30)
  assert.ok(email.items.every((item: any) =>
    item.kind === 'identity' && item.platform === 'email'))
  const wechat = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    kind: 'identity',
    identityScope: 'wechat',
    limit: 100
  })
  assert.equal(wechat.total, 80)
  assert.ok(wechat.items.every((item: any) =>
    item.kind === 'identity' && item.platform === 'wechat'))
  const external = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    kind: 'identity',
    identityScope: 'external',
    limit: 40
  })
  assert.equal(external.total, 60)
  assert.equal(external.items.length, 40)
  assert.ok(external.items.every((item: any) =>
    item.kind === 'identity' && item.platform !== 'wechat'))
  const externalSecond = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    kind: 'identity',
    identityScope: 'external',
    offset: 40,
    limit: 40,
    revision: external.revision
  })
  assert.equal(externalSecond.items.length, 20)
  const exactAlias = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    kind: 'alias',
    query: '历史别名 124'
  })
  assert.equal(exactAlias.total, 1)
  assert.equal(exactAlias.items[0].value, '历史别名 124')
  const displayName = store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    query: '外部身份 058'
  })
  assert.equal(displayName.total, 1)
  assert.equal(displayName.items[0].platform, 'github')

  store.syncGraph({ entities: [structuredClone(entity)], relations: [], reviewQueue: [] } as any)
  assert.equal(store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    offset: 40,
    limit: 40,
    revision: first.revision
  }).stale, false)

  store.syncGraph({
    entities: [{ ...entity, aliases: [...entity.aliases, '刚新增的身份别名'] }],
    relations: [],
    reviewQueue: []
  } as any)
  assert.equal(store.listEntityIdentityAnchorPage({
    entityId: entity.id,
    offset: 40,
    limit: 40,
    revision: first.revision
  }).stale, true)
}))

test('project review counts include candidate relations from both directions', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'review-project', type: 'project', canonicalName: '审阅项目', trustStatus: 'confirmed' },
      { id: 'review-person-a', type: 'person', canonicalName: '成员甲', trustStatus: 'confirmed' },
      { id: 'review-person-b', type: 'person', canonicalName: '成员乙', trustStatus: 'confirmed' }
    ],
    relations: [{
      id: 'review-relation-outgoing',
      subjectId: 'review-project',
      predicate: '协调',
      objectId: 'review-person-a',
      confidence: 0.8,
      status: 'candidate',
      evidence: evidence('review-relation-outgoing-message', '项目协调成员甲')
    }, {
      id: 'review-relation-incoming',
      subjectId: 'review-person-b',
      predicate: '参与',
      objectId: 'review-project',
      confidence: 0.8,
      status: 'candidate',
      evidence: evidence('review-relation-incoming-message', '成员乙参与项目')
    }],
    reviewQueue: []
  } as any)
  const count = store.getProjectReviewCounts(['review-project'])['review-project']
  assert.deepEqual(count, {
    candidateClaims: 0,
    candidateEvents: 0,
    candidateMilestones: 0,
    candidateDecisions: 0,
    candidateRelations: 2,
    total: 2
  })
  store.upsertClaims([{
    id: 'review-object-claim',
    subjectId: 'review-person-a',
    predicate: '为项目负责',
    objectEntityId: 'review-project',
    objectValue: '审阅项目',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: '成员甲为审阅项目负责',
    evidence: evidence('review-object-claim-message', '成员甲为审阅项目负责')
  }])
  store.upsertEvents([{
    id: 'review-participant-event',
    eventType: 'meeting',
    title: '审阅项目启动会',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: '审阅项目启动会',
    participants: [{ entityId: 'review-project', role: 'project' }],
    evidence: evidence('review-participant-event-message', '审阅项目启动会')
  }])
  const completeProjectCount =
    store.getProjectReviewCounts(['review-project'])['review-project']
  assert.equal(completeProjectCount.candidateClaims, 1)
  assert.equal(completeProjectCount.candidateEvents, 1)
  assert.equal(completeProjectCount.total, 4)
  assert.deepEqual(store.getEntityCandidateReviewCounts('review-project'), {
    claims: 1,
    relations: 2,
    events: 1,
    total: 4
  })
  const page = store.listEntityRelationPage({
    entityId: 'review-project', status: 'candidate', limit: 1
  })
  assert.equal(page.total, 2)
  assert.equal(page.hasMore, true)
  assert.equal(store.listEntityRelationPage({
    entityId: 'review-project', status: 'candidate',
    limit: 1, offset: 1, revision: page.revision
  }).items.length, 1)
}))

test('entity relationship directory links deterministic pending reviews without copying payloads', () => withStore(store => {
  const relation = {
    id: 'directory-review-relation',
    subjectId: 'directory-review-person',
    predicate: '参与',
    objectId: 'directory-review-project',
    confidence: 0.8,
    status: 'candidate',
    evidence: evidence('directory-review-message', '人物参与项目')
  }
  const entities = [
    { id: 'directory-review-person', type: 'person', canonicalName: '目录人物', trustStatus: 'confirmed' },
    { id: 'directory-review-project', type: 'project', canonicalName: '目录项目', trustStatus: 'confirmed' }
  ]
  const reviews = [{
    id: 'directory-review-older',
    kind: 'relation',
    relationId: relation.id,
    title: '旧候选',
    detail: '不要复制到目录',
    confidence: 0.7,
    status: 'pending',
    createdAt: '2026-08-05T00:00:00.000Z'
  }, {
    id: 'directory-review-newer-b',
    kind: 'relation',
    relationId: relation.id,
    title: '新候选乙',
    detail: '不要复制到目录',
    confidence: 0.8,
    status: 'pending',
    createdAt: '2026-08-06T00:00:00.000Z'
  }, {
    id: 'directory-review-newer-a',
    kind: 'relation',
    relationId: relation.id,
    title: '新候选甲',
    detail: '不要复制到目录',
    confidence: 0.8,
    status: 'pending',
    createdAt: '2026-08-06T00:00:00.000Z'
  }]
  store.syncGraph({ entities, relations: [relation], reviewQueue: reviews } as any)
  const page = store.listEntityRelationPage({ entityId: 'directory-review-person' })
  assert.equal(page.items[0].pending_review_id, 'directory-review-newer-a')
  assert.equal(page.items[0].pending_review_count, 3)
  assert.equal('detail' in page.items[0], false)

  store.syncGraph({
    entities,
    relations: [relation],
    reviewQueue: reviews.map(review => ({
      ...review,
      status: 'confirmed',
      resolvedAt: '2026-08-06T01:00:00.000Z'
    }))
  } as any)
  const resolved = store.listEntityRelationPage({ entityId: 'directory-review-person' })
  assert.equal(resolved.items[0].pending_review_id, null)
  assert.equal(resolved.items[0].pending_review_count, 0)
  assert.equal(store.listEntityRelationPage({
    entityId: 'directory-review-person',
    offset: 1,
    revision: page.revision
  }).stale, true)

  store.syncGraph({
    entities,
    relations: [{ ...relation, status: 'rejected', updatedAt: '2026-08-06T02:00:00.000Z' }],
    reviewQueue: []
  } as any)
  assert.equal(store.listEntityRelationPage({
    entityId: 'directory-review-person'
  }).total, 0)
  const rejectedPage = store.listEntityRelationPage({
    entityId: 'directory-review-person',
    status: 'rejected'
  })
  assert.equal(rejectedPage.total, 1)
  assert.equal(rejectedPage.items[0].id, relation.id)
  assert.equal(rejectedPage.items[0].status, 'rejected')
  assert.equal(rejectedPage.items[0].evidenceTotal, 1)
  const rejectedDossier = store.getCurrentStructuredMemoryDossier(
    'relation',
    relation.id
  )
  assert.equal(rejectedDossier.stale, false)
  assert.equal(rejectedDossier.item.status, 'rejected')
  assert.equal(rejectedDossier.item.evidence_count, 1)
}))

test('entity evidence separates current memory links from historical audit and preserves roles', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'evidence-state-project',
      type: 'project',
      canonicalName: '证据状态项目',
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  } as any, '', {
    entityEvidence: [{
      entityId: 'evidence-state-project',
      sourceId: 'wechat',
      messageId: 'wechat:evidence-state-session:identity-current',
      sessionId: 'evidence-state-session',
      timestamp: 1_910_000_000,
      sender: '项目发起人',
      excerpt: '这是项目身份原文',
      evidenceKind: 'identity_anchor'
    }]
  })
  const claims = [{
    id: 'evidence-state-current-claim',
    subjectId: 'evidence-state-project',
    predicate: '当前事实',
    objectValue: '仍然有效',
    confidence: 0.9,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '当前事实仍然有效',
    evidence: [{
      sourceId: 'documents',
      messageId: 'current-claim-message',
      sessionId: 'current-claim-session',
      timestamp: 1_910_000_100,
      sender: '当前发送者',
      excerpt: '当前直接证据',
      role: 'direct'
    }, {
      sourceId: 'wechat',
      messageId: 'current-contradiction-message',
      sessionId: 'current-contradiction-session',
      timestamp: 1_910_000_150,
      sender: '反证发送者',
      excerpt: '当前事实仍有反证',
      role: 'contradiction'
    }]
  }, {
    id: 'evidence-state-rejected-claim',
    subjectId: 'evidence-state-project',
    predicate: '错误事实',
    objectValue: '已经拒绝',
    confidence: 0.7,
    status: 'rejected',
    sourceNature: 'other_statement',
    searchText: '错误事实已经拒绝',
    evidence: [{
      sourceId: 'mail',
      messageId: 'rejected-claim-message',
      sessionId: 'rejected-claim-session',
      timestamp: 1_910_000_200,
      sender: '历史发送者',
      excerpt: '仅保留为反证审计',
      role: 'contradiction'
    }]
  }, {
    id: 'evidence-state-shared-historical-claim',
    subjectId: 'evidence-state-project',
    predicate: '历史共享事实',
    objectValue: '与当前事实共用原文身份',
    confidence: 0.6,
    status: 'rejected',
    sourceNature: 'other_statement',
    searchText: '历史共享事实与当前事实共用原文身份',
    evidence: [{
      sourceId: 'documents',
      messageId: 'current-claim-message',
      sessionId: 'current-claim-session',
      timestamp: 1_910_000_100,
      sender: '当前发送者',
      excerpt: '同一原文也曾关联已拒绝历史',
      role: 'contradiction'
    }]
  }] as any[]
  store.upsertClaims(claims)
  store.upsertEvents([{
    id: 'evidence-state-cancelled-event',
    eventType: 'meeting',
    title: '已取消事件',
    description: '仅保留历史',
    startAt: new Date(1_910_000_300 * 1000).toISOString(),
    confidence: 0.8,
    status: 'cancelled',
    sourceNature: 'self_statement',
    searchText: '已取消事件仅保留历史',
    participants: [{ entityId: 'evidence-state-project', role: 'project' }],
    evidence: [{
      sourceId: 'calendar',
      messageId: 'cancelled-event-message',
      sessionId: 'cancelled-event-session',
      timestamp: 1_910_000_300,
      sender: '日历',
      excerpt: '会议已经取消',
      role: 'indirect'
    }]
  }] as any)

  const all = store.listEntityEvidencePage({ entityId: 'evidence-state-project' })
  const current = store.listEntityEvidencePage({
    entityId: 'evidence-state-project', evidenceState: 'current'
  })
  const historical = store.listEntityEvidencePage({
    entityId: 'evidence-state-project', evidenceState: 'historical', limit: 1
  })
  assert.equal(all.total, 5)
  assert.equal(current.total, 3)
  assert.equal(historical.total, 2)
  assert.equal(store.getEntityEvidenceStats('evidence-state-project').activeEvidenceTotal, 2)
  assert.ok(current.items.every(item => item.isCurrent))
  assert.ok(historical.items.every(item => !item.isCurrent))
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'historical',
    memoryKind: 'claim',
    sourceId: 'mail'
  }).items[0].evidenceRoles.includes('contradiction'), true)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'historical',
    memoryKind: 'event'
  }).items[0].evidenceRoles.includes('indirect'), true)
  const currentContradictions = store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'current',
    evidenceRole: 'contradiction'
  })
  assert.equal(currentContradictions.total, 2)
  const sharedEvidence = currentContradictions.items.find(
    item => item.message_id === 'current-claim-message'
  )
  assert.equal(sharedEvidence.hasHistorical, true)
  assert.deepEqual(new Set(sharedEvidence.evidenceRoles), new Set(['direct', 'contradiction']))
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'current',
    evidenceRole: 'direct',
    sourceId: 'documents'
  }).total, 1)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'historical',
    limit: 1,
    offset: 1,
    revision: historical.revision
  }).items.length, 1)
  store.upsertClaims([{ ...claims[0], status: 'rejected' }] as any)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project',
    evidenceState: 'historical',
    limit: 1,
    offset: 1,
    revision: historical.revision
  }).stale, true)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project', evidenceState: 'current'
  }).total, 1)
  assert.equal(store.listEntityEvidencePage({
    entityId: 'evidence-state-project', evidenceState: 'historical'
  }).total, 4)
  assert.equal(store.getEntityEvidenceStats('evidence-state-project').activeEvidenceTotal, 1)
}))

test('direct entity evidence is keyword searchable, scope aware and hydrated as original evidence', () => withStore(store => {
  const graph = {
    entities: [{
      id: 'searchable-evidence-entity',
      type: 'project',
      canonicalName: '直接证据检索项目',
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  }
  store.syncGraph(graph as any, '', {
    entityEvidence: [{
      entityId: 'searchable-evidence-entity',
      sourceId: 'wechat',
      messageId: 'wechat:searchable-entity-session:old-identity',
      sessionId: 'searchable-entity-session',
      timestamp: 1_920_000_000,
      sender: '旧发送者',
      excerpt: '首次提到火星暗号项目',
      evidenceKind: 'entity_mention'
    }, {
      entityId: 'searchable-evidence-entity',
      sourceId: 'mail',
      messageId: 'mail:new-identity',
      sessionId: 'data-source:mail:searchable',
      timestamp: 1_920_000_100,
      sender: '邮件发起人',
      excerpt: '邮件再次确认火星暗号身份',
      evidenceKind: 'identity_anchor'
    }]
  })
  const stableRevision = store.getMemorySearchRevision()
  store.syncGraph(graph as any, '', {
    entityEvidence: [{
      entityId: 'searchable-evidence-entity',
      sourceId: 'wechat',
      messageId: 'wechat:searchable-entity-session:old-identity',
      sessionId: 'searchable-entity-session',
      timestamp: 1_920_000_000,
      sender: '旧发送者',
      excerpt: '首次提到火星暗号项目',
      evidenceKind: 'entity_mention'
    }, {
      entityId: 'searchable-evidence-entity',
      sourceId: 'mail',
      messageId: 'mail:new-identity',
      sessionId: 'data-source:mail:searchable',
      timestamp: 1_920_000_100,
      sender: '',
      excerpt: '短句',
      evidenceKind: 'entity_mention'
    }]
  })
  assert.equal(store.getMemorySearchRevision(), stableRevision)
  assert.equal(store.getDocumentEvidencePage('entity', 'searchable-evidence-entity', {
    source: 'mail'
  }).items[0].evidence_kind, 'identity_anchor')

  store.syncGraph(graph as any, '', {
    entityEvidence: [{
      entityId: 'searchable-evidence-entity',
      sourceId: 'wechat',
      messageId: 'wechat:searchable-entity-session:old-identity',
      sessionId: 'searchable-entity-session',
      timestamp: 1_920_000_001,
      sender: '身份确认人',
      excerpt: '再次核验后确认火星暗号项目是稳定的身份锚点',
      evidenceKind: 'identity_anchor'
    }]
  })
  assert.ok(Number(store.getMemorySearchRevision()) > Number(stableRevision))
  const upgradedIdentity = store.getDocumentEvidencePage(
    'entity',
    'searchable-evidence-entity',
    { source: 'wechat' }
  ).items[0]
  assert.equal(upgradedIdentity.evidence_kind, 'identity_anchor')
  assert.equal(upgradedIdentity.timestamp, 1_920_000_001)
  assert.equal(upgradedIdentity.sender, '身份确认人')
  assert.equal(upgradedIdentity.excerpt, '再次核验后确认火星暗号项目是稳定的身份锚点')
  const identityArchive = store.listEntityEvidencePage({
    entityId: 'searchable-evidence-entity',
    memoryKind: 'identity',
    sourceId: 'wechat'
  })
  assert.deepEqual(identityArchive.items[0].identityEvidenceKinds, ['identity_anchor'])

  const result = store.searchText('火星暗号', 10)
    .find(item => item.id === 'entity:searchable-evidence-entity')
  assert.equal(result?.match_reason, 'entity_evidence')
  assert.equal(result?.entity_evidence_search_mode, 'fts_trigram')
  assert.equal(result?.matched_evidence_source_id, 'mail')
  assert.equal(result?.matched_evidence_message_id, 'mail:new-identity')
  assert.equal(result?.matched_evidence_excerpt, '邮件再次确认火星暗号身份')
  assert.equal(store.searchText('火星', 10)
    .find(item => item.id === 'entity:searchable-evidence-entity')?.entity_evidence_search_mode,
  'scan_fallback')
  const payload = store.getDocumentEvidencePayload('entity', 'searchable-evidence-entity')
  assert.equal(payload.evidenceTotal, 2)
  assert.ok(payload.evidence.every(item => item.evidence_role === 'original'))
  const datedEntityPayload = store.getDocumentEvidencePayload(
    'entity',
    'searchable-evidence-entity',
    {
      from: new Date(1_920_000_050 * 1000).toISOString(),
      to: new Date(1_920_000_150 * 1000).toISOString()
    }
  )
  assert.equal(datedEntityPayload.evidenceTotal, 1)
  assert.equal(datedEntityPayload.evidence[0].message_id, 'mail:new-identity')
  const hydratedDocument = store.getSearchDocumentById('entity:searchable-evidence-entity')
  assert.equal(hydratedDocument.evidenceTotal, 2)
  assert.equal(hydratedDocument.evidence.length, 2)
  const firstPage = store.getDocumentEvidencePage('entity', 'searchable-evidence-entity', {
    limit: 1,
    source: 'mail',
    query: '再次确认'
  })
  assert.equal(firstPage.total, 1)
  assert.equal(firstPage.unfilteredTotal, 2)
  assert.equal(firstPage.items[0].source_id, 'mail')
  assert.equal(firstPage.items[0].evidence_role, 'original')
  assert.equal(store.getDocumentEvidencePage('entity', 'searchable-evidence-entity', {
    role: 'contradiction'
  }).total, 0)

  const mailScope = store.listScopedSearchDocumentIds({
    sourceIds: ['mail'],
    sessionId: 'data-source:mail:searchable',
    from: new Date(1_920_000_050 * 1000).toISOString()
  })
  assert.equal(mailScope?.has('entity:searchable-evidence-entity'), true)
  assert.equal(store.searchText('首次提到', 10, mailScope, {
    sourceIds: ['mail']
  }).some(item => item.id === 'entity:searchable-evidence-entity'), false)
  assert.equal(store.searchText('再次确认', 10, mailScope, {
    sourceIds: ['mail'],
    sessionId: 'data-source:mail:searchable',
    from: new Date(1_920_000_050 * 1000).toISOString()
  }).find(item => item.id === 'entity:searchable-evidence-entity')
    ?.matched_evidence_source_id, 'mail')
  assert.equal(store.searchText('首次提到', 10, mailScope, {
    sourceIds: ['wechat'],
    from: new Date(1_920_000_050 * 1000).toISOString()
  }).some(item => item.id === 'entity:searchable-evidence-entity'), false)
  assert.equal(store.listScopedSearchDocumentIds({
    sourceIds: ['documents']
  })?.has('entity:searchable-evidence-entity'), false)
  const beforeRevision = Number(store.getMemorySearchRevision())
  const archive = store.getDocumentEvidencePage('entity', 'searchable-evidence-entity', {
    limit: 1
  })
  store.syncGraph(graph as any, '', {
    entityEvidence: [{
      entityId: 'searchable-evidence-entity',
      sourceId: 'calendar',
      messageId: 'calendar:newer-identity',
      sessionId: 'data-source:calendar:searchable',
      timestamp: 1_920_000_200,
      sender: '日历',
      excerpt: '日历补充新的身份线索',
      evidenceKind: 'entity_mention'
    }]
  })
  assert.ok(Number(store.getMemorySearchRevision()) > beforeRevision)
  assert.equal(store.getDocumentEvidencePage('entity', 'searchable-evidence-entity', {
    limit: 1,
    offset: 1,
    revision: archive.revision
  }).stale, true)
  assert.ok(store.searchText('新的身份线索', 10)
    .some(item => item.id === 'entity:searchable-evidence-entity'))
}))

test('entity evidence trigram index repairs trigger and row drift on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-entity-evidence-fts-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'fts-repair-person', type: 'person', canonicalName: '索引修复人物',
        confidence: 1, trustStatus: 'confirmed', aliases: [], accountIds: []
      }], relations: [], reviewQueue: []
    } as any, '', {
      entityEvidence: [{
        entityId: 'fts-repair-person', sourceId: 'wechat', messageId: 'fts-repair-message',
        sessionId: 'fts-repair-session', timestamp: 1_930_000_000, sender: '测试发送者',
        excerpt: '启动后应恢复银河罗盘线索', evidenceKind: 'identity_anchor'
      }]
    })
    const database = (first as any).db
    const insertEvidence = database.prepare(`
      INSERT INTO entity_evidence(entity_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_kind)
      VALUES('fts-repair-person','wechat',?,?,?,'批量发送者',?,'entity_mention')
    `)
    database.transaction(() => {
      for (let index = 0; index < 3_000; index += 1) {
        insertEvidence.run(
          `fts-scale-${index}`,
          'fts-scale-session',
          1_930_000_100 + index,
          index === 2_999 ? '规模检索终点包含海王星钥匙' : `规模检索普通线索 ${index}`
        )
      }
    })()
    assert.equal(first.searchText('海王星钥匙', 10)[0]?.entity_evidence_search_mode, 'fts_trigram')
    database.prepare(`UPDATE entity_evidence SET excerpt='更新后可检索土星坐标线索' WHERE message_id='fts-repair-message'`).run()
    assert.ok(first.searchText('土星坐标', 10).some((item: any) => item.id === 'entity:fts-repair-person'))
    assert.equal(first.searchText('银河罗盘', 10).length, 0)
    database.exec(`
      DROP TRIGGER trg_entity_evidence_fts_insert;
      UPDATE entity_evidence_fts SET excerpt='漂移索引内容'
      WHERE rowid=(SELECT id FROM entity_evidence WHERE message_id='fts-repair-message');
    `)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const diagnostics = reopened.getDiagnostics()
      assert.equal(diagnostics.entityEvidenceFtsHealthy, true)
      assert.equal(diagnostics.entityEvidenceFts.repairedThisStart, true)
      assert.equal(diagnostics.entityEvidenceFts.installedTriggers, 3)
      assert.ok(reopened.searchText('土星坐标', 10)
        .some(item => item.id === 'entity:fts-repair-person'))
      assert.ok(reopened.searchText('海王星钥匙', 10)
        .some(item => item.id === 'entity:fts-repair-person'))
      assert.equal(reopened.searchText('漂移索引内容', 10).length, 0)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('composed evidence scope indexes cover query plans and self-heal definition drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-scope-index-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const database = (first as any).db
    const plans = [{
      name: 'idx_search_document_evidence_scope',
      sql: `SELECT 1 FROM search_document_evidence
        WHERE document_id=? AND source_id=? AND session_id=? AND timestamp>=?`
    }, {
      name: 'idx_entity_evidence_scope',
      sql: `SELECT 1 FROM entity_evidence
        WHERE entity_id=? AND source_id=? AND session_id=? AND timestamp>=?`
    }, {
      name: 'idx_evidence_claim_scope',
      sql: `SELECT 1 FROM evidence
        WHERE claim_id=? AND source_id=? AND session_id=? AND timestamp>=?`
    }, {
      name: 'idx_evidence_relation_scope',
      sql: `SELECT 1 FROM evidence
        WHERE relation_id=? AND source_id=? AND session_id=? AND timestamp>=?`
    }, {
      name: 'idx_evidence_event_scope',
      sql: `SELECT 1 FROM evidence
        WHERE event_id=? AND source_id=? AND session_id=? AND timestamp>=?`
    }]
    for (const plan of plans) {
      const details = (database.prepare(`EXPLAIN QUERY PLAN ${plan.sql}`)
        .all('memory-id', 'wechat', 'scope-session', 1_700_000_000) as Array<{ detail: string }>)
        .map(row => row.detail).join(' ')
      assert.match(details, new RegExp(plan.name))
    }
    first.upsertResources([{
      id: 'scope-index-scale-resource',
      resourceType: 'document',
      title: '范围索引规模资料',
      content: '验证五千条原文下组合范围仍绑定同一证据',
      evidence: Array.from({ length: 5_000 }, (_, index) => ({
        sourceId: index % 2 ? 'mail' : 'documents',
        messageId: `scope-index-scale-${index}`,
        sessionId: index === 4_999 ? 'scale-target-session' : `scale-session-${index % 20}`,
        timestamp: 1_800_000_000 + index,
        sender: '规模测试',
        excerpt: `组合范围规模证据 ${index}`
      }))
    }])
    const scaleScope = first.listScopedSearchDocumentIds({
      sourceIds: ['mail'],
      sessionId: 'scale-target-session',
      from: new Date(1_800_004_999 * 1000).toISOString(),
      to: new Date(1_800_004_999 * 1000).toISOString()
    })
    assert.equal(scaleScope?.has('resource:scope-index-scale-resource'), true)
    assert.equal(first.getDocumentEvidencePayload(
      'resource',
      'scope-index-scale-resource',
      {
        sourceIds: ['mail'],
        sessionId: 'scale-target-session',
        from: new Date(1_800_004_999 * 1000).toISOString(),
        to: new Date(1_800_004_999 * 1000).toISOString()
      }
    ).evidenceTotal, 1)
    assert.equal(first.getEvidenceScopeIndexHealth().healthy, true)
    database.exec(`
      DROP INDEX idx_entity_evidence_scope;
      CREATE INDEX idx_entity_evidence_scope
        ON entity_evidence(entity_id,timestamp);
    `)
    assert.equal(first.getEvidenceScopeIndexHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const diagnostics = reopened.getDiagnostics()
      assert.equal(diagnostics.evidenceScopeIndexesHealthy, true)
      assert.equal(diagnostics.evidenceScopeIndexes.installedIndexes, 5)
      assert.equal(diagnostics.evidenceScopeIndexes.repairedThisStart, true)
      assert.equal(diagnostics.evidenceScopeIndexes.repairedIndexesThisStart, 1)
      assert.equal(diagnostics.evidenceScopeIndexes.unhealthyIndexes.length, 0)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('review inbox aggregation stays indexed and repairs index drift on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-review-inbox-index-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const database = (first as any).db
    const plans = [{
      index: 'idx_claims_status',
      sql: `SELECT COUNT(*) FROM claims WHERE status='candidate'`,
      args: []
    }, {
      index: 'idx_relations_status',
      sql: `SELECT COUNT(*) FROM relations WHERE status='confirmed'`,
      args: []
    }, {
      index: 'idx_events_status',
      sql: `SELECT COUNT(*) FROM events WHERE status='candidate'`,
      args: []
    }, {
      index: 'idx_review_queue_status',
      sql: `SELECT COUNT(*) FROM review_queue WHERE status='pending'`,
      args: []
    }, {
      index: 'idx_evidence_claim_role',
      sql: `SELECT 1 FROM evidence WHERE claim_id=? AND evidence_role='contradiction'`,
      args: ['claim-id']
    }, {
      index: 'idx_evidence_relation_role',
      sql: `SELECT 1 FROM evidence WHERE relation_id=? AND evidence_role='contradiction'`,
      args: ['relation-id']
    }, {
      index: 'idx_evidence_event_role',
      sql: `SELECT 1 FROM evidence WHERE event_id=? AND evidence_role='contradiction'`,
      args: ['event-id']
    }]
    for (const plan of plans) {
      const details = (database.prepare(`EXPLAIN QUERY PLAN ${plan.sql}`)
        .all(...plan.args) as Array<{ detail: string }>).map(row => row.detail).join(' ')
      assert.match(details, new RegExp(plan.index))
    }
    assert.deepEqual(first.getReviewInboxIndexHealth(), {
      version: 1,
      checkedAt: first.getReviewInboxIndexHealth().checkedAt,
      repairedThisStart: true,
      repairedIndexesThisStart: 7,
      repairsTotal: 1,
      expectedIndexes: 7,
      installedIndexes: 7,
      healthy: true,
      unhealthyIndexes: []
    })
    database.exec(`
      DROP INDEX idx_evidence_claim_role;
      CREATE INDEX idx_evidence_claim_role ON evidence(claim_id,timestamp);
      DROP INDEX idx_evidence_event_role;
      CREATE INDEX idx_evidence_event_role ON evidence(event_id,timestamp);
    `)
    assert.equal(first.getReviewInboxIndexHealth().healthy, false)
    assert.equal(first.getDiagnostics().reviewInboxIndexesHealthy, false)
    assert.equal(first.getDiagnostics().healthy, false)
    const originalExec = database.exec.bind(database)
    database.exec = () => {
      originalExec(`
        DROP INDEX idx_evidence_claim_role;
        CREATE INDEX idx_evidence_claim_role
          ON evidence(claim_id,evidence_role)
          WHERE claim_id IS NOT NULL;
      `)
      throw new Error('injected review inbox index repair failure')
    }
    assert.throws(
      () => (first as any).ensureReviewInboxIndexes(),
      /injected review inbox index repair failure/
    )
    database.exec = originalExec
    assert.deepEqual(
      first.getReviewInboxIndexHealth().unhealthyIndexes,
      ['idx_evidence_claim_role', 'idx_evidence_event_role']
    )
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const health = reopened.getReviewInboxIndexHealth()
      assert.equal(health.healthy, true)
      assert.equal(health.installedIndexes, 7)
      assert.equal(health.repairedThisStart, true)
      assert.equal(health.repairedIndexesThisStart, 2)
      assert.equal(health.repairsTotal, 2)
      assert.deepEqual(health.unhealthyIndexes, [])
      const diagnostics = reopened.getDiagnostics()
      assert.equal(diagnostics.reviewInboxIndexes.healthy, true)
      assert.equal(diagnostics.reviewInboxIndexesHealthy, true)
      assert.equal(diagnostics.healthy, true)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('memory growth log is privacy-minimal, pageable and self-heals trigger drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-growth-log-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const database = (first as any).db
    const initial = first.getMemoryChangeLogHealth()
    assert.equal(initial.healthy, true)
    assert.equal(initial.expectedTriggers, 21)
    assert.equal(initial.total, 0)
    assert.match(initial.trackedSince, /^20/)
    for (const [sql, index] of [
      [`SELECT id FROM memory_change_log ORDER BY changed_at DESC,id DESC LIMIT 40`,
        'idx_memory_change_log_time'],
      [`SELECT id FROM memory_change_log WHERE item_kind='claim'
        ORDER BY changed_at DESC,id DESC LIMIT 40`, 'idx_memory_change_log_kind_time'],
      [`SELECT id FROM memory_change_log WHERE change_kind='reviewed'
        ORDER BY changed_at DESC,id DESC LIMIT 40`, 'idx_memory_change_log_change_time'],
      [`SELECT id FROM memory_change_log WHERE change_detail='evidence'
        ORDER BY changed_at DESC,id DESC LIMIT 40`, 'idx_memory_change_log_detail_time'],
      [`SELECT id FROM memory_change_log WHERE origin_kind='human_action'
        ORDER BY changed_at DESC,id DESC LIMIT 40`, 'idx_memory_change_log_origin_time'],
      [`SELECT id FROM memory_change_log WHERE source_kind='wechat'
        ORDER BY changed_at DESC,id DESC LIMIT 40`, 'idx_memory_change_log_source_time'],
      [`SELECT id FROM memory_change_log
        WHERE origin_kind='model_batch' AND origin_id='batch'
          AND source_kind='wechat' ORDER BY id DESC LIMIT 40`,
        'idx_memory_change_log_origin_identity']
    ]) {
      const plan = (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
        .map(row => row.detail).join(' ')
      assert.match(plan, new RegExp(index))
    }
    const entityPlan = (database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT change_id FROM memory_change_entity_links
      WHERE entity_id='growth-person' ORDER BY change_id DESC LIMIT 40
    `).all() as Array<{ detail: string }>).map(row => row.detail).join(' ')
    assert.match(entityPlan, /idx_memory_change_entity_links_entity/)
    database.exec(`
      INSERT INTO entities(
        id,type,canonical_name,summary,confidence,created_at,updated_at,trust_status,summary_status
      ) VALUES
        ('growth-person','person','成长人物','',1,'2026-08-06T01:00:00.000Z','2026-08-06T01:00:00.000Z','confirmed','empty'),
        ('growth-project','project','成长项目','',1,'2026-08-06T01:01:00.000Z','2026-08-06T01:01:00.000Z','confirmed','empty');
      INSERT INTO claims(
        id,subject_id,predicate,object_value,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-claim','growth-person','负责','成长项目',0.8,'candidate','成长人物负责成长项目',
        '2026-08-06T01:02:00.000Z','2026-08-06T01:02:00.000Z'
      );
      INSERT INTO relations(
        id,subject_id,predicate,object_id,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-relation','growth-person','负责','growth-project',0.8,'candidate',
        '成长人物负责成长项目','2026-08-06T01:03:00.000Z','2026-08-06T01:03:00.000Z'
      );
      INSERT INTO events(
        id,event_type,title,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-event','meeting','成长会议',0.8,'candidate','成长会议',
        '2026-08-06T01:04:00.000Z','2026-08-06T01:04:00.000Z'
      );
      INSERT INTO memory_resources(
        id,resource_type,title,created_at,updated_at
      ) VALUES(
        'growth-resource','document','成长资料',
        '2026-08-06T01:05:00.000Z','2026-08-06T01:05:00.000Z'
      );
      INSERT INTO event_participants(event_id,entity_id,role)
      VALUES('growth-event','growth-person','participant');
      INSERT INTO entity_evidence(
        entity_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_kind
      ) VALUES(
        'growth-person','wechat','growth-entity-message','growth-session',1,
        'growth-person','身份原文不得进入成长响应','identity'
      );
      INSERT INTO evidence(
        claim_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(
        'growth-claim','wechat','growth-claim-message','growth-session',2,
        'growth-person','事实原文不得进入成长响应','direct'
      );
      INSERT INTO evidence(
        relation_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(
        'growth-relation','wechat','growth-relation-message','growth-session',3,
        'growth-person','关系原文不得进入成长响应','direct'
      );
      INSERT INTO evidence(
        event_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(
        'growth-event','wechat','growth-event-message','growth-session',4,
        'growth-person','事件原文不得进入成长响应','direct'
      );
    `)
    const firstPage = first.listMemoryChangeLogPage({ limit: 3 })
    assert.equal(firstPage.total, 11)
    assert.equal(firstPage.items.length, 3)
    assert.equal(firstPage.hasMore, true)
    assert.deepEqual(Object.keys(firstPage.items[0]).sort(), [
      'changeDetail', 'changeKind', 'changedAt', 'currentExists', 'id', 'itemId',
      'itemKind', 'originId', 'originKind', 'sourceKind', 'statusAfter', 'statusBefore', 'title'
    ])
    assert.equal(firstPage.items[0].originKind, 'system')
    assert.equal(firstPage.items[0].sourceKind, 'system')
    assert.equal(JSON.stringify(firstPage).includes('search_text'), false)
    assert.equal(JSON.stringify(firstPage).includes('excerpt'), false)
    assert.deepEqual(
      new Set(first.listMemoryChangeLogPage({ limit: 20 }).items.map(item => item.itemKind)),
      new Set(['entity', 'claim', 'relation', 'event', 'resource'])
    )
    const enriched = first.listMemoryChangeLogPage({ change: 'enriched', limit: 20 })
    assert.equal(enriched.total, 5)
    assert.equal(first.listMemoryChangeLogPage({
      detail: 'evidence', limit: 20
    }).total, 4)
    assert.equal(first.listMemoryChangeLogPage({
      detail: 'participant', limit: 20
    }).total, 1)
    assert.equal(JSON.stringify(enriched).includes('原文不得进入成长响应'), false)
    database.exec(`
      INSERT OR IGNORE INTO event_participants(event_id,entity_id,role)
      VALUES('growth-event','growth-person','participant');
      INSERT OR IGNORE INTO evidence(
        claim_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(
        'growth-claim','wechat','growth-claim-message','growth-session',2,
        'growth-person','重复证据不得再次产生变化','direct'
      );
    `)
    assert.equal(first.listMemoryChangeLogPage({ limit: 20 }).total, 11)
    const personGrowth = first.listMemoryChangeLogPage({
      entityId: 'growth-person', limit: 20
    })
    assert.equal(personGrowth.total, 9)
    assert.deepEqual(
      new Set(personGrowth.items.map(item => item.itemKind)),
      new Set(['entity', 'claim', 'relation', 'event'])
    )
    const projectGrowth = first.listMemoryChangeLogPage({
      entityId: 'growth-project', limit: 20
    })
    assert.equal(projectGrowth.total, 3)
    assert.deepEqual(
      new Set(projectGrowth.items.map(item => item.itemKind)),
      new Set(['entity', 'relation'])
    )
    database.exec(`
      INSERT INTO merge_history(
        source_entity_id,target_entity_id,source_name,target_name,snapshot_json,created_at
      ) VALUES(
        'growth-person','growth-project','成长人物','成长项目','{}',
        '2026-08-06T01:10:00.000Z'
      );
    `)
    assert.equal(first.listMemoryChangeLogPage({
      entityId: 'growth-project', limit: 20
    }).total, 10)
    database.exec(`
      UPDATE merge_history SET reverted_at='2026-08-06T01:11:00.000Z'
      WHERE source_entity_id='growth-person' AND target_entity_id='growth-project';
    `)
    assert.equal(first.listMemoryChangeLogPage({
      entityId: 'growth-project', limit: 20
    }).total, 3)
    database.exec(`
      UPDATE events SET title=title WHERE id='growth-event';
      BEGIN;
      INSERT INTO events(
        id,event_type,title,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-rolled-back','meeting','不会提交的事件',0.8,'candidate','不会提交',
        '2026-08-06T01:06:00.000Z','2026-08-06T01:06:00.000Z'
      );
      ROLLBACK;
    `)
    assert.equal(first.listMemoryChangeLogPage({ limit: 20 }).total, 11)
    assert.equal(JSON.stringify(first.listMemoryChangeLogPage({ limit: 20 }))
      .includes('growth-rolled-back'), false)
    database.exec(`
      UPDATE claims SET status='confirmed',updated_at='2026-08-06T02:00:00.000Z'
      WHERE id='growth-claim';
      UPDATE events SET title='成长会议（更新）',updated_at='2026-08-06T02:01:00.000Z'
      WHERE id='growth-event';
      DELETE FROM memory_resources WHERE id='growth-resource';
      DELETE FROM relations WHERE id='growth-relation';
    `)
    const reviewed = first.listMemoryChangeLogPage({ change: 'reviewed', limit: 20 })
    assert.equal(reviewed.total, 1)
    assert.equal(reviewed.items[0].itemId, 'growth-claim')
    assert.equal(reviewed.items[0].statusBefore, 'candidate')
    assert.equal(reviewed.items[0].statusAfter, 'confirmed')
    const removed = first.listMemoryChangeLogPage({ change: 'removed', limit: 20 })
    assert.equal(removed.total, 2)
    const removedResource = removed.items.find(item => item.itemId === 'growth-resource')
    assert.equal(removedResource?.title, '')
    assert.equal(removedResource?.currentExists, false)
    const removedRelation = first.listMemoryChangeLogPage({
      entityId: 'growth-person', change: 'removed', limit: 20
    })
    assert.equal(removedRelation.total, 1)
    assert.equal(removedRelation.items[0].itemId, 'growth-relation')
    assert.equal(removedRelation.items[0].currentExists, false)
    const oldRevision = first.listMemoryChangeLogPage({ limit: 1 }).revision
    database.exec(`
      INSERT INTO events(
        id,event_type,title,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-event-later','delivery','后续交付',0.8,'candidate','后续交付',
        '2026-08-06T03:00:00.000Z','2026-08-06T03:00:00.000Z'
      );
    `)
    assert.equal(first.listMemoryChangeLogPage({
      offset: 1, limit: 1, revision: oldRevision
    }).stale, true)
    database.exec(`
      DROP TRIGGER trg_memory_growth_claims_update;
      CREATE TRIGGER trg_memory_growth_claims_update AFTER UPDATE ON claims BEGIN SELECT 1; END;
      DROP TRIGGER trg_memory_growth_event_evidence_insert;
      DELETE FROM memory_change_entity_links
      WHERE entity_id='growth-person'
        AND change_id=(
          SELECT MIN(id) FROM memory_change_log
          WHERE item_kind='claim' AND item_id='growth-claim'
        );
      DELETE FROM schema_meta WHERE key='memory_change_entity_links_backfill_v1';
    `)
    assert.equal(first.getMemoryChangeLogHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const health = reopened.getMemoryChangeLogHealth()
      assert.equal(health.healthy, true)
      assert.equal(health.repairedThisStart, true)
      assert.equal(health.repairedTriggersThisStart, 2)
      assert.equal(health.total, 16)
      assert.match(health.entityLinkBackfill.completedAt, /^20/)
      assert.ok(health.entityLinkBackfill.linked >= 1)
      assert.equal(reopened.listMemoryChangeLogPage({
        entityId: 'growth-person', kind: 'claim', limit: 20
      }).total, 3)
      assert.equal(reopened.getDiagnostics().memoryChangeLog.healthy, true)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('memory growth origins are nested, filterable and rollback without context leaks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-growth-origin-'))
  const databasePath = join(directory, 'memory.sqlite')
  const store = new PersonalMemoryStore()
  try {
    store.initialize(databasePath)
    const database = (store as any).db
    store.startIngestionRun(
      'growth-origin-run',
      'deepseek-chat',
      'prompt-origin-v1',
      { trigger: 'manual' }
    )
    store.recordIngestionBatch(
      'growth-origin-run',
      0,
      3,
      'completed',
      '',
      {
        model: 'deepseek-chat',
        promptVersion: 'prompt-origin-v1',
        schemaVersion: 'schema-origin-v1',
        inputTokens: 120,
        outputTokens: 30,
        durationMs: 900,
        sensitiveRedaction: { version: 1, total: 2 },
        structuredEvidence: { version: 1, accepted: { events: 1 } },
        extractionContext: { version: 1, selectedEntities: 2 },
        extractionCoverage: { version: 1, attempts: 1 }
      }
    )
    store.prepareIngestionBatchCommit({
      commitId: 'model-batch-growth-safe',
      runId: 'growth-origin-run',
      batchIndex: 0,
      digest: { privateValue: 'PRIVATE DIGEST MUST NOT LEAK' },
      messages: [{ content: 'PRIVATE MESSAGE MUST NOT LEAK' }],
      checkpointKeys: ['PRIVATE CHECKPOINT MUST NOT LEAK'],
      createdAt: '2026-08-06T01:05:29.000Z'
    })
    store.runWithMemoryChangeOrigin({
      kind: 'model_batch',
      id: 'model-batch-growth-safe',
      sourceKind: 'wechat'
    }, () => {
      database.exec(`
        INSERT INTO events(
          id,event_type,title,confidence,status,search_text,created_at,updated_at
        ) VALUES(
          'growth-origin-event','meeting','来源批次测试',0.8,'candidate','来源批次测试',
          '2026-08-06T01:05:30.000Z','2026-08-06T01:05:30.000Z'
        );
      `)
      store.runWithMemoryChangeOrigin({
        kind: 'human_action',
        id: 'nested-human-growth-safe',
        sourceKind: 'local'
      }, () => database.exec(`
        UPDATE events SET status='confirmed',updated_at='2026-08-06T01:05:31.000Z'
        WHERE id='growth-origin-event'
      `))
      database.exec(`
        UPDATE events SET title='来源批次测试（补充）',updated_at='2026-08-06T01:05:32.000Z'
        WHERE id='growth-origin-event'
      `)
    })
    assert.equal(store.listMemoryChangeLogPage({
      origin: 'model_batch', source: 'wechat', limit: 20
    }).total, 2)
    assert.equal(store.listMemoryChangeLogPage({
      origin: 'human_action', source: 'local', limit: 20
    }).total, 1)
    assert.equal(store.listMemoryChangeLogPage({
      origin: 'model_batch', limit: 20
    }).items.every(item => item.originId === 'model-batch-growth-safe'), true)
    const modelPage = store.listMemoryChangeLogPage({
      origin: 'model_batch', limit: 20
    })
    const originDossier = store.getMemoryChangeOriginDossier(
      modelPage.items[0].id,
      modelPage.revision
    )
    assert.equal(originDossier.totalChanges, 2)
    assert.equal(originDossier.modelBatch.runId, 'growth-origin-run')
    assert.equal(originDossier.modelBatch.batchIndex, 0)
    assert.equal(originDossier.modelBatch.messageCount, 3)
    assert.equal(originDossier.modelBatch.inputTokens, 120)
    assert.equal(originDossier.modelBatch.sensitiveRedaction.total, 2)
    assert.equal(JSON.stringify(originDossier).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(originDossier).includes('checkpointKeys'), false)
    assert.equal(JSON.stringify(originDossier).includes('messages'), false)
    assert.equal(Number(database.prepare(`
      SELECT COUNT(*) AS count FROM memory_change_context
    `).get().count), 0)
    assert.throws(() => store.runWithMemoryChangeOrigin({
      kind: 'model_batch',
      id: 'rolled-back-origin',
      sourceKind: 'documents'
    }, () => {
      database.exec(`
        INSERT INTO events(
          id,event_type,title,confidence,status,search_text,created_at,updated_at
        ) VALUES(
          'growth-origin-rollback','meeting','回滚来源测试',0.8,'candidate','回滚来源测试',
          '2026-08-06T01:05:33.000Z','2026-08-06T01:05:33.000Z'
        )
      `)
      throw new Error('rollback origin')
    }), /rollback origin/)
    assert.equal(store.listMemoryChangeLogPage({
      origin: 'model_batch', source: 'documents', limit: 20
    }).total, 0)
    assert.equal(Number(database.prepare(`
      SELECT COUNT(*) AS count FROM memory_change_context
    `).get().count), 0)
    database.exec(`
      INSERT INTO events(
        id,event_type,title,confidence,status,search_text,created_at,updated_at
      ) VALUES(
        'growth-origin-system','meeting','系统来源测试',0.8,'candidate','系统来源测试',
        '2026-08-06T01:05:34.000Z','2026-08-06T01:05:34.000Z'
      )
    `)
    assert.throws(() => store.getMemoryChangeOriginDossier(
      modelPage.items[0].id,
      modelPage.revision
    ), /已经变化/)
    const system = store.listMemoryChangeLogPage({
      origin: 'system', source: 'system', limit: 20
    })
    assert.equal(system.total, 1)
    assert.equal(system.items[0].originId, '')
    store.deleteMemoryItem('event', 'growth-origin-system', 'manual_delete', {
      kind: 'human_action',
      id: 'explicit-delete-origin',
      sourceKind: 'local'
    })
    const deleted = store.listMemoryChangeLogPage({
      origin: 'human_action', source: 'local', change: 'removed', limit: 20
    })
    assert.equal(deleted.total, 1)
    assert.equal(deleted.items[0].originId, 'explicit-delete-origin')
    assert.equal(store.getMemoryChangeLogHealth().originContextClean, true)
    assert.equal(JSON.stringify(store.listMemoryChangeLogPage({ limit: 20 }))
      .includes('回滚来源测试'), false)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('connector operation filtering is complete across pages and keeps legacy origins unclassified', () => withStore(store => {
  const database = (store as any).db
  const insert = database.prepare(`
    INSERT INTO memory_change_log(
      item_kind,item_id,change_kind,change_detail,origin_kind,origin_id,source_kind,
      status_before,status_after,changed_at
    ) VALUES('resource',?,'updated','content','connector_page',?,?,'','',?)
  `)
  database.transaction(() => {
    for (let index = 0; index < 125; index += 1) {
      insert.run(
        `pdf-operation-${index}`,
        `wechat.pdf_ocr:${String(index).padStart(24, '0')}`,
        'wechat',
        new Date(Date.UTC(2026, 7, 6, 2, 0, index)).toISOString()
      )
    }
    for (let index = 0; index < 65; index += 1) {
      insert.run(
        `document-page-${index}`,
        `documents.page:${String(index).padStart(24, '0')}`,
        'documents',
        new Date(Date.UTC(2026, 7, 6, 3, 0, index)).toISOString()
      )
    }
    insert.run(
      'legacy-connector-operation',
      'wechat:1234567890abcdef12345678',
      'wechat',
      '2026-08-06T04:00:00.000Z'
    )
  })()

  const first = store.listMemoryChangeLogPage({
    connectorOperation: 'wechat_pdf_ocr',
    limit: 40
  })
  assert.equal(first.total, 125)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.equal(first.items.every(item =>
    item.originKind === 'connector_page' &&
    item.originId.startsWith('wechat.pdf_ocr:')), true)
  const second = store.listMemoryChangeLogPage({
    connectorOperation: 'wechat_pdf_ocr',
    limit: 40,
    offset: 40,
    revision: first.revision
  })
  assert.equal(second.total, 125)
  assert.equal(second.items.length, 40)
  assert.equal(new Set([
    ...first.items.map(item => item.id),
    ...second.items.map(item => item.id)
  ]).size, 80)
  assert.equal(store.listMemoryChangeLogPage({
    connectorOperation: 'documents_page',
    source: 'documents',
    limit: 100
  }).total, 65)
  assert.equal(store.listMemoryChangeLogPage({
    connectorOperation: 'wechat_resources',
    limit: 100
  }).total, 0)
  assert.equal(store.listMemoryChangeLogPage({
    origin: 'connector_page',
    source: 'wechat',
    limit: 1
  }).total, 126)
  const queryPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM memory_change_log log
    WHERE log.origin_kind='connector_page'
      AND substr(log.origin_id,1,instr(log.origin_id,':')-1)=?
    ORDER BY log.changed_at DESC,log.id DESC
    LIMIT 40 OFFSET 80
  `).all('wechat.pdf_ocr')
  const planText = queryPlan.map((row: any) => String(row.detail || '')).join('\n')
  assert.match(planText, /idx_memory_change_log_connector_operation_time/)
  assert.doesNotMatch(planText, /USE TEMP B-TREE FOR ORDER BY/)
  database.exec(`
    DROP INDEX idx_memory_change_log_connector_operation_time;
    CREATE INDEX idx_memory_change_log_connector_operation_time
    ON memory_change_log(origin_kind);
  `)
  assert.equal(store.getMemoryChangeLogHealth().healthy, false)
  ;(store as any).ensureMemoryChangeLog()
  const repairedHealth = store.getMemoryChangeLogHealth()
  assert.equal(repairedHealth.healthy, true)
  assert.equal(repairedHealth.repairedIndexesThisStart, 1)
  assert.equal(repairedHealth.connectorOperationIndex.healthy, true)
  const repairedPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM memory_change_log log
    WHERE log.origin_kind='connector_page'
      AND substr(log.origin_id,1,instr(log.origin_id,':')-1)=?
    ORDER BY log.changed_at DESC,log.id DESC
    LIMIT 40 OFFSET 80
  `).all('wechat.pdf_ocr')
  const repairedPlanText = repairedPlan
    .map((row: any) => String(row.detail || '')).join('\n')
  assert.match(repairedPlanText, /idx_memory_change_log_connector_operation_time/)
  assert.doesNotMatch(repairedPlanText, /USE TEMP B-TREE FOR ORDER BY/)
}))

test('entity memory growth stays complete beyond five hundred changes and isolates same names', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-growth-entity-scale-'))
  const databasePath = join(directory, 'memory.sqlite')
  const store = new PersonalMemoryStore()
  try {
    store.initialize(databasePath)
    const database = (store as any).db
    database.exec(`
      INSERT INTO entities(
        id,type,canonical_name,summary,confidence,created_at,updated_at,trust_status,summary_status
      ) VALUES
        ('growth-scale-a','person','同名成员','',1,
          '2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z','confirmed','empty'),
        ('growth-scale-b','person','同名成员','',1,
          '2026-08-06T00:00:01.000Z','2026-08-06T00:00:01.000Z','confirmed','empty');
    `)
    const insertLog = database.prepare(`
      INSERT INTO memory_change_log(
        item_kind,item_id,change_kind,status_before,status_after,changed_at
      ) VALUES('claim',?,'updated','candidate','candidate',?)
    `)
    const insertLink = database.prepare(`
      INSERT INTO memory_change_entity_links(change_id,entity_id) VALUES(?,?)
    `)
    database.transaction(() => {
      for (let index = 0; index < 2_410; index += 1) {
        const entityId = index % 2 ? 'growth-scale-b' : 'growth-scale-a'
        const result = insertLog.run(
          `growth-scale-claim-${index}`,
          `2026-08-06T01:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:` +
            `${String(index % 60).padStart(2, '0')}.000Z`
        )
        insertLink.run(result.lastInsertRowid, entityId)
      }
    })()
    const first = store.listMemoryChangeLogPage({
      entityId: 'growth-scale-a', limit: 40
    })
    assert.equal(first.total, 1_206)
    assert.equal(first.items.length, 40)
    const last = store.listMemoryChangeLogPage({
      entityId: 'growth-scale-a',
      offset: 1_200,
      limit: 40,
      revision: first.revision
    })
    assert.equal(last.stale, false)
    assert.equal(last.items.length, 6)
    assert.equal(last.hasMore, false)
    assert.equal(store.listMemoryChangeLogPage({
      entityId: 'growth-scale-b', limit: 1
    }).total, 1_206)
    assert.equal(first.items.some(item => item.itemId.includes('growth-scale-b')), false)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('event corrections record only genuinely new participant enrichment', () => withStore(store => {
  const database = (store as any).db
  database.exec(`
    INSERT INTO entities(
      id,type,canonical_name,summary,confidence,created_at,updated_at,trust_status,summary_status
    ) VALUES(
      'growth-participant-a','person','参与者甲','',1,
      '2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z','confirmed','empty'
    );
    INSERT INTO events(
      id,event_type,title,description,confidence,status,source_nature,search_text,created_at,updated_at
    ) VALUES(
      'growth-corrected-event','meeting','参与者会议','',1,'confirmed',
      'human_confirmation','参与者会议',
      '2026-08-06T00:01:00.000Z','2026-08-06T00:01:00.000Z'
    );
    INSERT INTO event_participants(event_id,entity_id,role)
    VALUES('growth-corrected-event','growth-participant-a','participant');
  `)
  assert.equal(store.listMemoryChangeLogPage({
    detail: 'participant', limit: 20
  }).total, 1)
  database.exec(`
    UPDATE entities SET identity_version=2,updated_at='2026-08-06T00:03:00.000Z'
    WHERE id='growth-participant-a'
  `)
  assert.equal(store.listMemoryChangeLogPage({
    detail: 'identity', limit: 20
  }).total, 1)
  store.correctEvent('growth-corrected-event', {
    title: '参与者会议',
    participants: [{ entityId: 'growth-participant-a', role: 'participant' }]
  })
  assert.equal(store.listMemoryChangeLogPage({
    detail: 'participant', limit: 20
  }).total, 1)
  database.exec(`
    INSERT INTO entities(
      id,type,canonical_name,summary,confidence,created_at,updated_at,trust_status,summary_status
    ) VALUES(
      'growth-participant-b','person','参与者乙','',1,
      '2026-08-06T00:02:00.000Z','2026-08-06T00:02:00.000Z','confirmed','empty'
    );
  `)
  store.correctEvent('growth-corrected-event', {
    title: '参与者会议',
    participants: [
      { entityId: 'growth-participant-a', role: 'participant' },
      { entityId: 'growth-participant-b', role: 'participant' }
    ]
  })
  assert.equal(store.listMemoryChangeLogPage({
    detail: 'participant', limit: 20
  }).total, 2)
}))

test('direct entity evidence follows reversible identity merges without copying plaintext', () => withStore(store => {
  const entities = ['source-identity-evidence', 'target-identity-evidence'].map((id, index) => ({
    id,
    type: 'person',
    canonicalName: index ? '保留身份' : '被合并身份',
    summary: '',
    confidence: 1,
    trustStatus: 'confirmed',
    aliases: [],
    accountIds: []
  }))
  store.syncGraph({ entities, relations: [], reviewQueue: [] } as any, '', {
    entityEvidence: entities.map((entity, index) => ({
      entityId: entity.id,
      sourceId: 'wechat',
      messageId: `wechat:merge-evidence:message-${index}`,
      sessionId: 'merge-evidence',
      timestamp: 1_900_100_000 + index,
      sender: entity.canonicalName,
      excerpt: `身份直接原文 ${index}`,
      evidenceKind: 'identity_anchor'
    }))
  })
  const mergeId = store.recordMerge(entities[0].id, entities[1].id, {
    source: entities[0],
    target: entities[1],
    relations: []
  })
  assert.equal(store.listEntityEvidencePage({
    entityId: entities[1].id
  }).total, 2)
  const mergedEvidenceMatch = store.searchText('身份直接原文 0', 10)
    .find(item => item.id === `entity:${entities[1].id}`)
  assert.equal(mergedEvidenceMatch?.matched_evidence_message_id,
    'wechat:merge-evidence:message-0')
  assert.equal(store.loadGraphSnapshot().entities.find(
    entity => entity.id === entities[1].id
  )?.evidenceMessageIds.length, 2)
  store.markMergeReverted(mergeId)
  assert.equal(store.listEntityEvidencePage({
    entityId: entities[1].id
  }).total, 1)
  assert.equal(store.listEntityEvidencePage({
    entityId: entities[0].id
  }).total, 1)
}))

test('entity evidence stats keep rejected audit evidence out of trusted relationship strength', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'evidence-stats-person',
      type: 'person',
      canonicalName: '证据统计人物',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  } as any)
  store.upsertClaims([
    {
      id: 'evidence-stats-active',
      subjectId: 'evidence-stats-person',
      predicate: '负责',
      objectValue: '可信事项',
      confidence: 0.9,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '可信事项',
      evidence: [{
        messageId: 'active-message',
        sessionId: 'active-session',
        timestamp: 1_800_000_000,
        excerpt: '有效证据'
      }]
    },
    {
      id: 'evidence-stats-rejected',
      subjectId: 'evidence-stats-person',
      predicate: '居住地',
      objectValue: '已拒绝事项',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '已拒绝事项',
      evidence: [{
        messageId: 'rejected-message',
        sessionId: 'rejected-session',
        timestamp: 1_900_000_000,
        excerpt: '只保留作审计的拒绝证据'
      }]
    }
  ])
  store.updateMemoryItemStatus('claim', 'evidence-stats-rejected', 'rejected')
  assert.equal(
    (store as any).db.prepare(`SELECT status FROM claims WHERE id=?`)
      .get('evidence-stats-rejected').status,
    'rejected'
  )

  assert.deepEqual(store.getEntityEvidenceStats('evidence-stats-person'), {
    evidenceTotal: 2,
    lastEvidenceAt: 1_900_000_000,
    activeEvidenceTotal: 1,
    lastActiveEvidenceAt: 1_800_000_000
  })
}))

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
  const second = store.listTaskArchive({ offset: 100, limit: 100, revision: first.revision })
  assert.equal(first.total, 400)
  assert.equal(first.items.length, 100)
  assert.equal(second.items.length, 100)
  assert.equal(second.stale, false)
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
  const staleSecond = store.listTaskArchive({ offset: 100, limit: 100, revision: first.revision })
  assert.equal(staleSecond.stale, true)
  assert.equal(staleSecond.items.length, 0)
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

test('closed task project directory stays searchable and pageable beyond 500 projects', () => withStore(store => {
  const tasks = Array.from({ length: 625 }, (_, index) => ({
    id: `archive-project-task-${String(index).padStart(4, '0')}`,
    title: `项目归档任务 ${index}`,
    project: index === 611 ? '远古火星迁移计划' : `历史项目 ${String(index).padStart(4, '0')}`,
    priority: 'medium',
    confidence: 0.9,
    classification: 'mine',
    status: 'done',
    createdAt: new Date(1_500_000_000_000 + index * 10_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + index * 10_000).toISOString(),
    evidence: []
  }))
  store.syncTasks(tasks)

  const first = store.listTaskArchiveProjects({ limit: 100 })
  const sixth = store.listTaskArchiveProjects({
    offset: 500,
    limit: 100,
    revision: first.revision
  })
  assert.equal(first.total, 625)
  assert.equal(first.items.length, 100)
  assert.equal(first.hasMore, true)
  assert.equal(sixth.items.length, 100)
  assert.equal(sixth.stale, false)
  assert.equal(new Set([...first.items, ...sixth.items].map(item => item.project)).size, 200)

  const searched = store.listTaskArchiveProjects({ query: '火星' })
  assert.deepEqual(searched.items.map(item => item.project), ['远古火星迁移计划'])
  assert.equal(searched.items[0]?.taskTotal, 1)
  assert.equal(store.listTaskArchive({ project: '火星迁移' }).items[0]?.id, tasks[611].id)

  store.syncTasks(tasks.map(task => task.id === tasks[0].id
    ? { ...task, project: '后来新增的项目名称' }
    : task))
  const stale = store.listTaskArchiveProjects({
    offset: 100,
    limit: 100,
    revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
  assert.equal(store.listTaskArchiveProjects({ query: '后来新增' }).total, 1)
}))

test('active task workset stays filtered, pageable, and revision safe at scale', () => withStore(store => {
  const tasks = Array.from({ length: 1_500 }, (_, index) => ({
    id: `active-task-${String(index).padStart(4, '0')}`,
    title: index === 997 ? '主动工作集特殊关键词' : `进行中任务 ${index}`,
    detail: `工作集说明 ${index}`,
    owner: '我',
    project: `行动项目 ${index % 12}`,
    taskKind: ['action', 'delegated', 'waiting'][index % 3],
    priority: ['high', 'medium', 'low'][index % 3],
    confidence: 0.91,
    classification: index % 10 === 0 ? 'others' : 'mine',
    status: ['todo', 'doing', 'waiting', 'done', 'cancelled'][index % 5],
    createdAt: new Date(1_600_000_000_000 + index * 10_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + index * 10_000).toISOString(),
    evidence: [{
      messageId: `active-task-message-${index}`,
      sessionId: 'active-task-session',
      timestamp: 1_700_000_000 + index,
      sender: '行动群',
      excerpt: `不应进入进行中目录的原文 ${index} ${'y'.repeat(300)}`
    }]
  }))
  store.syncTasks(tasks)

  const first = store.listActiveTaskWorkset({ limit: 100 })
  const second = store.listActiveTaskWorkset({ offset: 100, limit: 100, revision: first.revision })
  assert.equal(first.total, 750)
  assert.equal(first.items.length, 100)
  assert.equal(second.items.length, 100)
  assert.equal(second.stale, false)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.ok(first.items.every(item => ['todo', 'doing', 'waiting'].includes(item.status)))
  assert.ok(first.items.every(item => item.classification === 'mine'))
  assert.ok(first.items.every(item => item.evidenceTotal === 1))
  assert.equal(JSON.stringify(first.items).includes('不应进入进行中目录的原文'), false)
  assert.equal(store.listActiveTaskWorkset({ status: 'doing' }).total, 300)
  assert.equal(store.listActiveTaskWorkset({ priority: 'high' }).total, 250)
  assert.equal(store.listActiveTaskWorkset({ taskKind: 'delegated' }).total, 250)
  assert.equal(store.listActiveTaskWorkset({ query: '主动工作集特殊关键词' }).items[0]?.id, 'active-task-0997')
  const focused = store.listActiveTaskWorkset({
    taskId: 'active-task-0997',
    status: 'todo',
    priority: 'high',
    query: '完全不匹配的关键词'
  })
  assert.equal(focused.total, 0)
  assert.equal(store.listActiveTaskWorkset({ taskId: 'active-task-0997' }).items[0]?.id, 'active-task-0997')
  assert.equal(store.listActiveTaskWorkset({ taskId: 'missing-active-task' }).total, 0)

  store.syncTasks(tasks.map(task => task.id === 'active-task-0997'
    ? {
        ...task,
        evidence: [...task.evidence, {
          messageId: 'active-task-message-0997-followup',
          sessionId: 'active-task-session',
          timestamp: 1_800_000_000,
          sender: '行动群',
          excerpt: '新增证据应使旧后续页失效'
        }]
      }
    : task))
  const staleSecond = store.listActiveTaskWorkset({
    offset: 100, limit: 100, revision: first.revision
  })
  assert.equal(staleSecond.stale, true)
  assert.equal(staleSecond.items.length, 0)
  assert.equal(
    store.listActiveTaskWorkset({ query: '主动工作集特殊关键词' }).items[0]?.evidenceTotal,
    2
  )

  store.syncTasks(tasks.map(task => task.id === 'active-task-0997'
    ? { ...task, status: 'done', updatedAt: '2026-08-04T00:00:00.000Z' }
    : task))
  assert.equal(store.listActiveTaskWorkset({ query: '主动工作集特殊关键词' }).total, 0)
  assert.equal(store.listActiveTaskWorkset({ taskId: 'active-task-0997' }).total, 0)
}))

test('task calendar pages every matching task in a month without depending on workset loading', () => withStore(store => {
  const tasks = Array.from({ length: 505 }, (_, index) => ({
    id: `calendar-task-${String(index).padStart(4, '0')}`,
    title: index === 404 ? '月历独立检索关键词' : `月历任务 ${index}`,
    detail: `月历任务详情 ${index}`,
    owner: '我',
    taskKind: ['action', 'delegated', 'waiting'][index % 3],
    priority: ['high', 'medium', 'low'][index % 3],
    confidence: 0.93,
    classification: index === 503 ? 'others' : 'mine',
    status: index === 502 ? 'done' : ['todo', 'doing', 'waiting'][index % 3],
    due: index === 501 ? '2026-09-01' : `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
    createdAt: new Date(1_700_000_000_000 + index * 10_000).toISOString(),
    updatedAt: new Date(1_800_000_000_000 + index * 10_000).toISOString(),
    evidence: []
  }))
  store.syncTasks(tasks)

  const first = store.listTaskCalendarPage({ month: '2026-08', limit: 200 })
  const second = store.listTaskCalendarPage({
    month: '2026-08', offset: 200, limit: 200, revision: first.revision
  })
  const third = store.listTaskCalendarPage({
    month: '2026-08', offset: 400, limit: 200, revision: first.revision
  })
  assert.equal(first.total, 502)
  assert.equal(first.items.length, 200)
  assert.equal(second.items.length, 200)
  assert.equal(third.items.length, 102)
  assert.equal(third.hasMore, false)
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 502)
  assert.equal(store.listTaskCalendarPage({ month: '2026-09' }).total, 1)
  assert.equal(store.listTaskCalendarPage({ month: '2026-08', priority: 'high' }).total, 168)
  assert.equal(store.listTaskCalendarPage({ month: '2026-08', taskKind: 'delegated' }).total, 167)
  assert.equal(
    store.listTaskCalendarPage({ month: '2026-08', query: '月历独立检索关键词' }).items[0]?.id,
    'calendar-task-0404'
  )
  assert.equal(store.listTaskCalendarPage({ month: 'not-a-month' }).total, 0)

  store.syncTasks(tasks.map(task => task.id === 'calendar-task-0404'
    ? { ...task, due: '2026-09-02', updatedAt: '2026-08-04T10:00:00.000Z' }
    : task))
  const stale = store.listTaskCalendarPage({
    month: '2026-08', offset: 200, limit: 200, revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
  assert.equal(store.listTaskCalendarPage({ month: '2026-08' }).total, 501)
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
  const second = store.listTaskOwnershipReviews({
    offset: 100, limit: 100, revision: first.revision
  })
  assert.equal(first.total, 1_000)
  assert.equal(first.items.length, 100)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 200)
  assert.equal(second.stale, false)
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
  const stale = store.listTaskOwnershipReviews({
    offset: 100, limit: 100, revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.deepEqual(stale.items, [])
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
    lastScheduledAttemptAt: '2026-07-31T00:02:00.000Z',
    lastScheduledCompletedAt: '2026-07-30T12:00:00.000Z',
    lastScheduledError: '日历连接器暂时失败',
    scheduledRetryCount: 2,
    nextScheduledRetryAt: '2026-07-31T00:32:00.000Z',
    lastSystemSuspendAt: '2026-07-31T02:00:00.000Z',
    lastSystemResumeAt: '2026-07-31T08:00:00.000Z',
    systemResumeCount: 4,
    lastSchedulerWakeAt: '2026-07-31T08:00:00.000Z',
    lastSchedulerWakeReason: 'system_resume',
    lastSchedulerGapMs: 21_600_000,
    lastResumeCatchupAt: '2026-07-31T08:00:01.000Z',
    lastResumeCatchupResult: 'backlog_catchup_attempted',
    resumeCatchupRetry: {
      pendingSince: '2026-07-31T08:00:01.000Z',
      lastAttemptAt: '2026-07-31T08:00:01.000Z',
      nextAttemptAt: '2026-07-31T08:15:01.000Z',
      failureCount: 1,
      lastError: '电脑刚唤醒，网络尚未连接'
    },
    lastAttemptAt: '2026-07-31T00:01:00.000Z',
    lastError: null,
    pendingSessionRetryCount: 3,
    pendingSessionBacklogCount: 1_000,
    backlogRetry: {
      nextAttemptAt: '2026-07-31T00:15:00.000Z',
      failureCount: 2,
      paused: false,
      lastAttemptAt: '2026-07-31T00:02:00.000Z',
      lastProgressAt: '2026-07-31T00:00:00.000Z',
      lastOutcome: 'progressed',
      previousBacklogCount: 1_100,
      remainingBacklogCount: 1_000
    }
  }
  const payload = buildCursorStatusPayload(cursor)
  const serialized = JSON.stringify(payload)
  assert.equal(payload.payloadPolicy.version, CURSOR_STATUS_PAYLOAD_VERSION)
  assert.equal(payload.privateStateCounts.recentMessageKeys, 20_000)
  assert.equal(payload.privateStateCounts.sessionCursors, 10_000)
  assert.equal(payload.privateStateCounts.continuationOffsets, 1_000)
  assert.equal(payload.lastScheduledError, '日历连接器暂时失败')
  assert.equal(payload.scheduledRetryCount, 2)
  assert.equal(payload.nextScheduledRetryAt, '2026-07-31T00:32:00.000Z')
  assert.deepEqual(payload.backlogRetry, {
    nextAttemptAt: '2026-07-31T00:15:00.000Z',
    failureCount: 2,
    paused: false,
    lastAttemptAt: '2026-07-31T00:02:00.000Z',
    lastProgressAt: '2026-07-31T00:00:00.000Z',
    lastOutcome: 'progressed',
    previousBacklogCount: 1_100,
    remainingBacklogCount: 1_000
  })
  assert.deepEqual(payload.systemWake, {
    lastSuspendAt: '2026-07-31T02:00:00.000Z',
    lastResumeAt: '2026-07-31T08:00:00.000Z',
    resumeCount: 4,
    lastWakeAt: '2026-07-31T08:00:00.000Z',
    lastWakeReason: 'system_resume',
    lastGapMs: 21_600_000,
    lastCatchupAt: '2026-07-31T08:00:01.000Z',
    lastCatchupResult: 'backlog_catchup_attempted',
    retry: {
      pendingSince: '2026-07-31T08:00:01.000Z',
      lastAttemptAt: '2026-07-31T08:00:01.000Z',
      nextAttemptAt: '2026-07-31T08:15:01.000Z',
      failureCount: 1,
      lastError: '电脑刚唤醒，网络尚未连接'
    }
  })
  assert.equal(payload.recentMessageIds, undefined)
  assert.equal(payload.sessionCursors, undefined)
  assert.equal(payload.sessionOffsets, undefined)
  assert.equal(serialized.includes('private-message-key'), false)
  assert.equal(serialized.includes('private-session'), false)
  assert.ok(Buffer.byteLength(serialized) < 2_000)
})

test('daily schedule is acknowledged only after every enabled source and backlog completes', () => {
  assert.deepEqual(
    assessSchedulerWake(
      Date.parse('2026-07-31T01:00:00.000Z'),
      Date.parse('2026-07-31T07:00:00.000Z'),
      true
    ),
    {
      reason: 'system_resume',
      elapsedMs: 6 * 60 * 60_000,
      shouldRunImmediately: true,
      resetAttemptThrottle: false
    }
  )
  assert.deepEqual(
    assessSchedulerWake(
      Date.parse('2026-07-31T07:00:00.000Z'),
      Date.parse('2026-07-31T06:50:00.000Z')
    ),
    {
      reason: 'clock_backward',
      elapsedMs: -10 * 60_000,
      shouldRunImmediately: true,
      resetAttemptThrottle: true
    }
  )
  assert.equal(assessSchedulerWake(
    Date.parse('2026-07-31T07:00:00.000Z'),
    Date.parse('2026-07-31T07:01:00.000Z')
  ).reason, 'regular')
  assert.equal(assessSchedulerWake(
    Date.parse('2026-07-31T07:00:00.000Z'),
    Date.parse('2026-07-31T07:04:00.000Z')
  ).reason, 'timer_gap')
  assert.equal(shouldRunResumeCatchup(
    4 * 60_000,
    '2026-07-31T06:00:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), false)
  assert.equal(shouldRunResumeCatchup(
    6 * 60 * 60_000,
    '2026-07-31T07:50:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), false)
  assert.equal(shouldRunResumeCatchup(
    6 * 60 * 60_000,
    '2026-07-31T07:30:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), true)
  const missedResumeWake = assessSchedulerWake(
    Date.parse('2026-07-31T01:00:00.000Z'),
    Date.parse('2026-07-31T08:00:00.000Z')
  )
  assert.equal(missedResumeWake.reason, 'timer_gap')
  assert.equal(shouldRunSchedulerWakeCatchup(
    missedResumeWake,
    '2026-07-31T07:30:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), true)
  assert.equal(shouldRunSchedulerWakeCatchup(
    missedResumeWake,
    '2026-07-31T07:50:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), false)
  assert.equal(shouldRunSchedulerWakeCatchup(
    assessSchedulerWake(
      Date.parse('2026-07-31T07:59:00.000Z'),
      Date.parse('2026-07-31T08:00:00.000Z')
    ),
    '2026-07-31T07:30:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), false)
  assert.equal(shouldRunSchedulerWakeCatchup(
    assessSchedulerWake(
      Date.parse('2026-07-31T08:10:00.000Z'),
      Date.parse('2026-07-31T08:00:00.000Z')
    ),
    '2026-07-31T07:30:00.000Z',
    Date.parse('2026-07-31T08:00:00.000Z')
  ), false)
  const resumeFailedOnce = planResumeCatchupRetry(
    EMPTY_RESUME_CATCHUP_RETRY_STATE,
    { complete: false, reason: '网络未连接' },
    '2026-07-31T08:00:00.000Z'
  )
  assert.deepEqual(resumeFailedOnce, {
    pendingSince: '2026-07-31T08:00:00.000Z',
    lastAttemptAt: '2026-07-31T08:00:00.000Z',
    nextAttemptAt: '2026-07-31T08:15:00.000Z',
    failureCount: 1,
    lastError: '网络未连接'
  })
  const resumeFailedTwice = planResumeCatchupRetry(
    resumeFailedOnce,
    { complete: false, reason: 'DeepSeek 仍不可达' },
    '2026-07-31T08:15:00.000Z'
  )
  assert.equal(resumeFailedTwice.pendingSince, resumeFailedOnce.pendingSince)
  assert.equal(resumeFailedTwice.failureCount, 2)
  assert.equal(resumeFailedTwice.nextAttemptAt, '2026-07-31T08:45:00.000Z')
  assert.equal(isResumeCatchupRetryDue(
    resumeFailedTwice,
    Date.parse('2026-07-31T08:44:59.999Z')
  ), false)
  assert.equal(isResumeCatchupRetryDue(
    resumeFailedTwice,
    Date.parse('2026-07-31T08:45:00.000Z')
  ), true)
  assert.equal(isResumeCatchupRetryDue(
    {
      ...resumeFailedTwice,
      lastAttemptAt: '2026-07-31T08:15:00.000Z',
      nextAttemptAt: '2026-07-31T08:45:00.000Z'
    },
    Date.parse('2026-07-31T07:00:00.000Z')
  ), true)
  assert.deepEqual(planResumeCatchupRetry(
    resumeFailedTwice,
    { complete: true, reason: '' },
    '2026-07-31T08:45:00.000Z'
  ), EMPTY_RESUME_CATCHUP_RETRY_STATE)
  assert.equal(shouldRunResumeCatchup(
    6 * 60 * 60_000,
    null,
    Date.parse('2026-07-31T08:00:00.000Z')
  ), true)
  assert.deepEqual(assessScheduledSyncResult({
    success: true,
    partial: false,
    cancelled: false,
    documentSourceError: null,
    calendarSourceError: null,
    mailSourceError: null
  }), { complete: true, reason: '' })
  assert.equal(assessScheduledSyncResult({
    success: true,
    partial: true,
    message: '仍有一个高流量会话等待下一页'
  }).complete, false)
  assert.equal(assessScheduledSyncResult({
    success: true,
    partial: false,
    calendarSourceError: 'EventKit 暂时不可用'
  }).reason, 'EventKit 暂时不可用')
  assert.equal(assessScheduledSyncResult({
    success: false,
    documentSourceError: '文档目录暂时不可访问'
  }).reason, '文档目录暂时不可访问')
  assert.equal(assessScheduledSyncResult({
    success: true,
    cancelled: true
  }).complete, false)
  assert.equal(assessScheduledSyncResult(null).complete, false)
  const previous = {
    lastScheduledRunDate: '2026-07-30',
    lastScheduledCompletedAt: '2026-07-30T12:00:00.000Z',
    scheduledRetryCount: 2
  }
  assert.deepEqual(planScheduledSyncState(
    previous,
    { complete: false, reason: '日历仍需重试' },
    '2026-07-31',
    '2026-07-31T12:00:00.000Z'
  ), {
    lastScheduledRunDate: '2026-07-30',
    lastScheduledCompletedAt: '2026-07-30T12:00:00.000Z',
    lastScheduledError: '日历仍需重试',
    scheduledRetryCount: 3,
    nextScheduledRetryAt: '2026-07-31T13:00:00.000Z',
    pendingScheduledRunDate: '2026-07-31'
  })
  assert.deepEqual(planScheduledSyncState(
    previous,
    { complete: true, reason: '' },
    '2026-07-31',
    '2026-07-31T12:15:00.000Z'
  ), {
    lastScheduledRunDate: '2026-07-31',
    lastScheduledCompletedAt: '2026-07-31T12:15:00.000Z',
    lastScheduledError: null,
    scheduledRetryCount: 0,
    nextScheduledRetryAt: null,
    pendingScheduledRunDate: null
  })
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7].map(scheduledSyncRetryDelayMs),
    [15, 30, 60, 120, 240, 360, 360].map(minutes => minutes * 60_000)
  )
  assert.equal(shouldReconcileScheduledSync('manual', { lastScheduledError: '失败' }), true)
  assert.equal(shouldReconcileScheduledSync('startup', { lastScheduledError: '失败' }), true)
  assert.equal(shouldReconcileScheduledSync('backlog', { lastScheduledError: '失败' }), true)
  assert.equal(shouldReconcileScheduledSync('daily', { lastScheduledError: '失败' }), false)
  assert.equal(shouldReconcileScheduledSync('manual', { lastScheduledError: null }), false)
  assert.equal(
    scheduledSyncTargetTimestamp('2026-07-30T12:00:00.000Z', Date.parse('2026-07-31T00:00:00.000Z')),
    Date.parse('2026-07-30T12:00:00.000Z')
  )
  assert.equal(
    scheduledSyncTargetTimestamp(null, Date.parse('2026-07-31T00:00:00.000Z')),
    Date.parse('2026-07-31T00:00:00.000Z')
  )
})

test('graph commit mismatch recovers authoritative entities relations evidence and pending reviews', () => {
  withStore(store => {
    const graph = {
      entities: [{
        id: 'graph-recovery-a',
        type: 'person',
        canonicalName: '恢复甲',
        aliases: ['甲别名'],
        accountIds: ['wxid-recovery-a'],
        externalIdentities: [{
          platform: 'email',
          accountId: 'a@example.com',
          displayName: '恢复甲',
          confidence: 1
        }],
        summary: '已确认摘要',
        summaryStatus: 'confirmed',
        trustStatus: 'confirmed',
        confidence: 0.9,
        evidenceMessageIds: ['wechat:recovery-session:recovery-message'],
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        identityVersion: 2,
        lastDisambiguatedAt: null
      }, {
        id: 'graph-recovery-b',
        type: 'organization',
        canonicalName: '恢复组织',
        aliases: [],
        accountIds: [],
        externalIdentities: [],
        summary: '',
        summaryStatus: 'empty',
        trustStatus: 'confirmed',
        confidence: 0.8,
        evidenceMessageIds: [],
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        identityVersion: 1,
        lastDisambiguatedAt: null
      }],
      relations: [{
        id: 'graph-recovery-relation',
        subjectId: 'graph-recovery-a',
        predicate: '服务于',
        objectId: 'graph-recovery-b',
        confidence: 0.92,
        status: 'confirmed',
        directionExplanation: '恢复甲向恢复组织',
        evidence: [{
          sourceId: 'wechat',
          messageId: 'wechat:recovery-session:recovery-message',
          sessionId: 'recovery-session',
          timestamp: 1_700_000_000,
          sender: '恢复甲',
          excerpt: '我在恢复组织工作'
        }],
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z'
      }],
      reviewQueue: [{
        id: 'graph-recovery-pending',
        kind: 'relation',
        title: '仍需审阅',
        detail: '待处理关系',
        confidence: 0.7,
        status: 'pending',
        relationId: 'graph-recovery-relation',
        createdAt: '2026-07-31T00:00:00.000Z'
      }, {
        id: 'graph-recovery-resolved',
        kind: 'entity_alias',
        title: '已处理别名',
        detail: '',
        confidence: 0.8,
        status: 'confirmed',
        createdAt: '2026-07-31T00:00:00.000Z',
        resolvedAt: '2026-07-31T01:00:00.000Z'
      }]
    }
    store.syncGraph(graph as any, 'graph-commit-authoritative')
    assert.equal(store.getGraphCommitId(), 'graph-commit-authoritative')
    assert.equal(GRAPH_COMMIT_RECOVERY_VERSION, 'graph-sql-authority-v1')
    assert.equal(shouldRecoverGraphFromSql('graph-commit-authoritative', 'graph-commit-stale'), true)
    assert.equal(shouldRecoverGraphFromSql('graph-commit-authoritative', 'graph-commit-authoritative'), false)
    assert.equal(shouldRecoverGraphFromSql('', 'graph-commit-stale'), false)
    const snapshot = store.loadGraphSnapshot()
    assert.equal(snapshot.entities.length, 2)
    assert.equal(snapshot.entities[0].aliases[0], '甲别名')
    assert.equal(snapshot.entities[0].accountIds[0], 'wxid-recovery-a')
    assert.equal(snapshot.entities[0].externalIdentities[0].accountId, 'a@example.com')
    assert.ok(snapshot.entities[0].evidenceMessageIds.includes('wechat:recovery-session:recovery-message'))
    assert.equal(snapshot.relations.length, 1)
    assert.equal(snapshot.relations[0].status, 'confirmed')
    assert.equal(snapshot.relations[0].directionExplanation, '恢复甲向恢复组织')
    assert.equal(snapshot.relations[0].evidence[0].sender, '恢复甲')
    assert.equal(snapshot.reviewQueue.length, 1)
    assert.equal(snapshot.reviewQueue[0].id, 'graph-recovery-pending')
    const recovered = recoverGraphStateFromSql({
      entities: [{
        ...graph.entities[0],
        canonicalName: '过期姓名',
        evidenceMessageIds: ['json-only-evidence']
      }, {
        id: 'json-only-entity',
        canonicalName: '不应复活',
        evidenceMessageIds: []
      }],
      relations: [{
        ...graph.relations[0],
        status: 'candidate',
        directionExplanation: '保留的人类可读方向'
      }, {
        id: 'json-only-relation',
        subjectId: 'graph-recovery-a',
        predicate: '错误关系',
        objectId: 'json-only-entity',
        status: 'candidate'
      }],
      reviewQueue: [graph.reviewQueue[1]],
      identityScan: { lastFullScanAt: '2026-07-30T00:00:00.000Z' },
      lastSqlCommitId: 'graph-commit-stale'
    }, snapshot, 'graph-commit-authoritative')
    assert.equal(recovered.entities.length, 2)
    assert.equal(recovered.entities[0].canonicalName, '恢复甲')
    assert.ok(recovered.entities[0].evidenceMessageIds.includes('json-only-evidence'))
    assert.equal(recovered.relations.length, 1)
    assert.equal(recovered.relations[0].status, 'confirmed')
    assert.equal(recovered.relations[0].directionExplanation, '保留的人类可读方向')
    assert.deepEqual(recovered.reviewQueue.map((review: any) => review.id), ['graph-recovery-pending'])
    assert.equal(recovered.identityScan.lastFullScanAt, '2026-07-30T00:00:00.000Z')
    assert.equal(recovered.lastSqlCommitId, 'graph-commit-authoritative')
  })
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

test('deferred backup retention preserves old snapshots until the state sidecar commits', () => withStore(store => {
  const backups = Array.from({ length: 10 }, () => {
    const backup = store.createBackup()
    writeFileSync(`${backup.path}.state.json`, 'encrypted-state-placeholder')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
    return backup
  })
  const oldest = backups[0]
  const databaseOnly = store.createBackup([], { deferRetention: true })
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
  const deferred = store.createBackup([], { deferRetention: true })
  writeFileSync(`${deferred.path}.state.json`, 'encrypted-state-placeholder')
  const stateOnly = join(
    dirname(deferred.path),
    'personal-memory-orphan.sqlite.state.json'
  )
  writeFileSync(stateOnly, 'encrypted-state-placeholder')
  assert.equal(existsSync(oldest.path), true)
  assert.equal(existsSync(databaseOnly.path), true)
  assert.equal(existsSync(deferred.path), true)
  assert.equal(store.getDiagnostics().backups.length, 12)
  assert.deepEqual(store.getBackupPairIntegrity(), {
    version: 'joint-backup-integrity-v1',
    complete: 11,
    databaseOnly: 1,
    stateOnly: 1,
    completeBytes: store.getBackupPairIntegrity().completeBytes,
    databaseOnlyBytes: store.getBackupPairIntegrity().databaseOnlyBytes,
    stateOnlyBytes: Buffer.byteLength('encrypted-state-placeholder'),
    retentionPolicy: 'complete_pairs_latest_10_incomplete_preserved_outside_slots'
  })

  const retained = store.finalizeBackupRetention([], { requireStateSidecar: true })
  assert.equal(retained, 10)
  assert.equal(existsSync(oldest.path), false)
  assert.equal(existsSync(databaseOnly.path), true)
  assert.equal(existsSync(deferred.path), true)
  const integrity = store.getDiagnostics().backupPairIntegrity
  assert.equal(integrity.complete, 10)
  assert.equal(integrity.databaseOnly, 1)
  assert.equal(integrity.stateOnly, 1)
  assert.equal(existsSync(stateOnly), true)
  assert.equal(store.getDiagnostics().backups.length, 11)
}))

test('joint backup retention preserves invalid pairs outside the ten restorable slots', () => withStore(store => {
  const backups = Array.from({ length: 11 }, () => {
    const backup = store.createBackup([], { deferRetention: true })
    writeFileSync(`${backup.path}.state.json`, 'encrypted-state-placeholder')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
    return backup
  })
  const invalidNewest = backups.at(-1)!
  const retained = store.finalizeBackupRetention([], {
    requireStateSidecar: true,
    isRestorable: backup => backup.path !== invalidNewest.path
  })

  assert.equal(retained, 10)
  assert.equal(existsSync(invalidNewest.path), true)
  assert.equal(existsSync(`${invalidNewest.path}.state.json`), true)
  assert.equal(store.getDiagnostics().backups.length, 11)
  assert.equal(store.getBackupPairIntegrity().complete, 11)
}))

test('verified backup rejects evidence revision drift and online repair restores both ledgers', () => withStore(store => {
  const database = (store as any).db
  const before = store.getDiagnostics()
  assert.equal(before.healthy, true)
  assert.equal(before.structuredEvidenceRevisionHealthy, true)
  assert.equal(before.generalEvidenceRevisionHealthy, true)

  database.exec(`
    DROP TRIGGER structured_evidence_revision_update;
    CREATE TRIGGER structured_evidence_revision_update
    AFTER UPDATE ON evidence BEGIN SELECT 1; END;
    DROP TRIGGER general_evidence_revision_search_delete;
  `)

  const drifted = store.getDiagnostics()
  assert.equal(drifted.healthy, false)
  assert.equal(drifted.structuredEvidenceRevisionHealthy, false)
  assert.equal(drifted.generalEvidenceRevisionHealthy, false)
  assert.throws(
    () => store.createBackup(),
    /数据库一致性检查失败/
  )

  const repaired = store.repairRuntimeSearchDerivedState([])
  assert.equal(repaired.healthy, true)
  assert.equal(repaired.repaired.structuredEvidenceTriggers, 1)
  assert.equal(repaired.repaired.generalEvidenceTriggers, 1)
  assert.equal(repaired.diagnostics.healthy, true)
  assert.equal(repaired.diagnostics.structuredEvidenceRevisionHealthy, true)
  assert.equal(repaired.diagnostics.generalEvidenceRevisionHealthy, true)
  assert.equal(store.createBackup().success, true)
}))

test('verified backup rejects live task search drift and runtime repair restores authority', () => withStore(store => {
  const task = {
    id: 'task-live-backup-gate',
    title: '核验待办实时备份门禁',
    detail: '不能只相信上一次保存的健康摘要',
    source: '可靠性测试',
    sourceSessionId: 'task-live-backup-session',
    status: 'todo',
    priority: 'high',
    classification: 'mine',
    evidence: [{
      messageId: 'task-live-backup-message',
      sessionId: 'task-live-backup-session',
      timestamp: 1_700_006_000,
      sender: '测试发送者',
      excerpt: '请核验待办实时备份门禁'
    }]
  }
  store.syncTasks([task])
  const database = (store as any).db
  database.exec(`
    UPDATE search_documents
    SET search_text='共同漂移后的错误正文',
      content_hash='共同漂移后的错误哈希'
    WHERE id='task:task-live-backup-gate';
    UPDATE search_fts
    SET search_text='共同漂移后的错误正文'
    WHERE document_id='task:task-live-backup-gate';
    DELETE FROM schema_meta WHERE key='task_search_index_integrity';
  `)

  const drifted = store.getDiagnostics()
  assert.equal(drifted.taskSearchIndexHealthy, false)
  assert.equal(drifted.healthy, false)
  assert.equal(drifted.taskSearchIndex.version, 0)
  assert.equal(drifted.taskSearchIndex.currentPayloadMismatches, 1)
  assert.throws(() => store.createBackup(), /数据库一致性检查失败/)

  const repaired = store.repairRuntimeSearchDerivedState([task])
  assert.equal(repaired.healthy, true)
  assert.equal(repaired.repaired.taskDocuments, 1)
  assert.equal(repaired.diagnostics.taskSearchIndexHealthy, true)
  assert.equal(repaired.diagnostics.taskSearchIndex.currentMismatches, 0)
  assert.equal(store.searchText('不能只相信上一次保存的健康摘要')[0]?.source_id,
    'task-live-backup-gate')
  assert.equal(store.createBackup().success, true)
}))

test('task evidence fingerprint detects equal-count content replacement and repairs it', () => withStore(store => {
  const task = {
    id: 'task-evidence-content-drift',
    title: '核验待办证据内容',
    detail: '证据数量相同也必须核验实际内容',
    source: '可靠性测试',
    sourceSessionId: 'task-evidence-content-session',
    status: 'todo',
    priority: 'high',
    classification: 'mine',
    evidence: [{
      sourceId: 'wechat',
      messageId: 'task-evidence-content-message',
      sessionId: 'task-evidence-content-session',
      timestamp: 1_700_006_100,
      sender: '原发送者',
      excerpt: '这是原始待办证据'
    }]
  }
  store.syncTasks([task])
  const database = (store as any).db
  database.exec(`
    UPDATE search_document_evidence
    SET sender='被替换的发送者',excerpt='数量不变但内容已经被替换'
    WHERE document_id='task:task-evidence-content-drift';
  `)

  const drifted = store.getDiagnostics()
  assert.equal(drifted.taskSearchIndex.currentEvidenceSetMismatches, 1)
  assert.equal(drifted.taskSearchIndexHealthy, false)
  assert.throws(() => store.createBackup(), /数据库一致性检查失败/)

  const repaired = store.repairRuntimeSearchDerivedState([task])
  assert.equal(repaired.healthy, true)
  assert.equal(repaired.repaired.taskDocuments, 1)
  assert.deepEqual(
    store.getDocumentEvidence('task', 'task-evidence-content-drift')
      .map(item => [item.sender, item.excerpt]),
    [['原发送者', '这是原始待办证据']]
  )
  assert.equal(repaired.diagnostics.taskSearchIndex.currentEvidenceSetMismatches, 0)
}))

test('task evidence fingerprint v3 is stable across input ordering', () => withStore(store => {
  const evidenceRows = [{
    sourceId: 'wechat',
    messageId: 'task-order-message-b',
    sessionId: 'task-order-session',
    timestamp: 1_700_006_201,
    sender: '发送者乙',
    excerpt: '第二条证据'
  }, {
    sourceId: 'wechat',
    messageId: 'task-order-message-a',
    sessionId: 'task-order-session',
    timestamp: 1_700_006_200,
    sender: '发送者甲',
    excerpt: '第一条证据'
  }]
  const task = {
    id: 'task-evidence-order-stable',
    title: '稳定待办证据顺序',
    source: '可靠性测试',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }
  store.syncTasks([{ ...task, evidence: evidenceRows }])
  const database = (store as any).db
  const first = database.prepare(`
    SELECT evidence_fingerprint FROM task_directory
    WHERE id='task-evidence-order-stable'
  `).get().evidence_fingerprint
  store.syncTasks([{ ...task, evidence: [...evidenceRows].reverse() }])
  const second = database.prepare(`
    SELECT evidence_fingerprint FROM task_directory
    WHERE id='task-evidence-order-stable'
  `).get().evidence_fingerprint
  assert.equal(second, first)
  assert.equal(store.getDiagnostics().taskSearchIndexHealthy, true)
}))

test('authoritative task evidence appends beyond the state hotset and enriches repeated carriers', () => withStore(store => {
  const task = {
    id: 'task-complete-evidence-archive',
    title: '长期累计任务证据',
    source: '项目群',
    sourceSessionId: 'long-task-session',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }
  const initialEvidence = Array.from({ length: 60 }, (_, index) => ({
    sourceId: 'wechat',
    sessionId: 'long-task-session',
    messageId: `long-task-message-${index}`,
    timestamp: index,
    sender: index === 59 ? '' : '群友',
    excerpt: `历史原文 ${index}`
  }))
  store.syncTasks([{ ...task, evidence: initialEvidence }], false, true)
  const hotset = initialEvidence.slice(-50).map(item => item.messageId === 'long-task-message-59'
    ? { ...item, timestamp: 100, sender: '补全发送者', excerpt: '补全后的最新原文' }
    : item)
  store.syncTasks([{ ...task, evidence: hotset }], false, true)

  const archived = store.listTaskEvidence([task.id]).get(task.id) || []
  assert.equal(archived.length, 60)
  assert.equal(archived[0].messageId, 'long-task-message-0')
  assert.deepEqual(
    archived.filter(item => item.messageId === 'long-task-message-59')
      .map(item => [item.timestamp, item.sender, item.excerpt]),
    [[100, '补全发送者', '补全后的最新原文']]
  )
  const diagnostics = store.getDiagnostics()
  assert.equal(diagnostics.taskSearchIndexHealthy, true)
  assert.equal(diagnostics.taskSearchIndex.evidenceFingerprintVersion, 3)
}))

test('startup repairs task evidence truncated by legacy state replacement from change history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-evidence-archive-repair-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const task = {
    id: 'task-legacy-truncated-evidence',
    title: '恢复旧版截断证据',
    source: '旧版项目群',
    sourceSessionId: 'legacy-task-session',
    status: 'todo',
    priority: 'high',
    classification: 'mine'
  }
  const historicalEvidence = [{
    sourceId: 'wechat',
    sessionId: 'legacy-task-session',
    messageId: 'legacy-old-message',
    timestamp: 1,
    sender: '旧发送者',
    excerpt: '旧版被热集覆盖的原文'
  }, {
    sourceId: 'wechat',
    sessionId: 'legacy-task-session',
    messageId: 'legacy-current-message',
    timestamp: 2,
    sender: '新发送者',
    excerpt: '仍在热集中的原文'
  }]
  try {
    first.initialize(databasePath)
    first.syncTasks([{ ...task, evidence: historicalEvidence }])
    first.recordTaskChanges(
      task.id,
      {},
      task,
      'legacy_full_evidence_snapshot',
      historicalEvidence
    )
    first.syncTasks([{ ...task, evidence: historicalEvidence.slice(-1) }])
    const database = (first as any).db
    assert.equal(database.prepare(`
      SELECT COUNT(*) FROM search_document_evidence
      WHERE document_id='task:task-legacy-truncated-evidence'
    `).pluck().get(), 1)
    database.prepare(`
      DELETE FROM schema_meta WHERE key='task_evidence_archive_integrity_v1'
    `).run()
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath)
      const repaired = reopened.listTaskEvidence([task.id]).get(task.id) || []
      assert.deepEqual(repaired.map(item => item.messageId), [
        'legacy-old-message',
        'legacy-current-message'
      ])
      const archive = reopened.getDiagnostics().taskSearchIndex.evidenceArchive
      assert.equal(archive.rowsInserted, 1)
      assert.equal(archive.rowsAfter, 2)
      reopened.syncTasks([{ ...task, evidence: historicalEvidence.slice(-1) }], false, true)
      assert.equal(reopened.getDiagnostics().taskSearchIndexHealthy, true)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('task evidence content drift remains blocked across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-evidence-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const task = {
    id: 'task-evidence-restart-drift',
    title: '跨重启核验待办证据',
    source: '可靠性测试',
    status: 'todo',
    priority: 'medium',
    classification: 'mine',
    evidence: [{
      sourceId: 'wechat',
      messageId: 'task-evidence-restart-message',
      sessionId: 'task-evidence-restart-session',
      timestamp: 1_700_006_300,
      sender: '原发送者',
      excerpt: '跨重启仍需保留的原文'
    }]
  }
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncTasks([task])
    ;(first as any).db.exec(`
      UPDATE search_document_evidence SET excerpt='重启前被替换的错误原文'
      WHERE document_id='task:task-evidence-restart-drift';
    `)
    first.close()

    reopened.initialize(databasePath, key)
    const drifted = reopened.getDiagnostics()
    assert.equal(drifted.taskSearchIndexHealthy, false)
    assert.equal(drifted.taskSearchIndex.currentEvidenceSetMismatches, 1)
    assert.throws(() => reopened.createBackup(), /数据库一致性检查失败/)
    const repaired = reopened.repairRuntimeSearchDerivedState([task])
    assert.equal(repaired.healthy, true)
    assert.equal(reopened.getDocumentEvidence('task', 'task-evidence-restart-drift')[0]?.excerpt,
      '跨重启仍需保留的原文')
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('task search drift remains unhealthy across restart until authoritative repair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-search-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const task = {
    id: 'task-search-restart-drift',
    title: '跨重启核验待办检索',
    detail: '重开数据库不能遗忘派生索引漂移',
    source: '可靠性测试',
    status: 'todo',
    priority: 'medium',
    classification: 'mine'
  }
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncTasks([task])
    ;(first as any).db.exec(`
      DELETE FROM search_documents WHERE id='task:task-search-restart-drift';
      DELETE FROM schema_meta WHERE key='task_search_index_integrity';
    `)
    first.close()

    reopened.initialize(databasePath, key)
    const drifted = reopened.getDiagnostics()
    assert.equal(drifted.taskSearchIndexHealthy, false)
    assert.equal(drifted.taskSearchIndex.currentMissingDocuments, 1)
    assert.throws(() => reopened.createBackup(), /数据库一致性检查失败/)
    const repaired = reopened.repairRuntimeSearchDerivedState([task])
    assert.equal(repaired.healthy, true)
    assert.equal(repaired.repaired.taskDocuments, 1)
    assert.equal(reopened.searchText('重开数据库不能遗忘派生索引漂移').length, 1)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('full current-database identity is stable per run and changes with durable content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-current-database-identity-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const emptyIdentity = first.getCurrentDatabaseSha256()
    assert.match(emptyIdentity, /^[a-f0-9]{64}$/)
    assert.equal(first.getCurrentDatabaseSha256(), emptyIdentity)
    first.syncTasks([{
      id: 'identity-drift-task',
      title: '完整身份必须感知这条任务',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    }])
    const changedIdentity = first.getCurrentDatabaseSha256()
    assert.notEqual(changedIdentity, emptyIdentity)
    assert.equal(first.getCurrentDatabaseSha256(), changedIdentity)
    first.close()

    second.initialize(databasePath, key)
    const reopenedIdentity = second.getCurrentDatabaseSha256()
    assert.match(reopenedIdentity, /^[a-f0-9]{64}$/)
    assert.equal(second.getCurrentDatabaseSha256(), reopenedIdentity)
    assert.equal(second.searchText('完整身份必须感知这条任务').length, 1)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('restoring an old snapshot protects it from safety-backup retention and reuses one rollback point', () => withStore(store => {
  store.syncTasks([{
    id: 'task-before-protected-backup',
    title: '保留最旧快照',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }])
  const backups = Array.from({ length: 10 }, () => {
    const backup = store.createBackup()
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
    return backup
  })
  const oldest = backups[0]
  const inspected = store.inspectBackup(oldest.path)
  assert.equal(inspected.integrity, 'ok')
  assert.equal(inspected.encrypted, false)
  assert.equal(inspected.counts.searchDocuments, 1)

  store.syncTasks([{
    id: 'task-after-protected-backup',
    title: '恢复后必须消失',
    priority: 'low',
    status: 'todo',
    classification: 'mine'
  }])
  const safety = store.createBackup([oldest.path])
  assert.equal(existsSync(oldest.path), true)
  assert.equal(store.getDiagnostics().backups.length, 11)
  const restored = store.restoreBackup(oldest.path, safety.path)
  assert.equal(restored.safetyBackup, safety.path)
  assert.equal(existsSync(oldest.path), true)
  assert.equal(store.searchText('恢复后必须消失').length, 0)
  assert.equal(store.getDiagnostics().backups.length, 11)
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

test('multi-vector long documents rank by their best semantic chunk without duplicating results', () => withStore(store => {
  const model = 'test-multi-vector:2d'
  store.upsertResources([{
    id: 'long-semantic-resource',
    resourceType: 'document',
    title: '长文档',
    content: `${'常规背景内容。'.repeat(900)}\n远端唯一主题`,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }, {
    id: 'generic-semantic-resource',
    resourceType: 'document',
    title: '普通文档',
    content: '一般相关内容',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }])
  const candidates = store.listEmbeddingCandidates(model, 10)
  const long = candidates.find(item => item.id === 'resource:long-semantic-resource')
  const generic = candidates.find(item => item.id === 'resource:generic-semantic-resource')
  assert.ok(long)
  assert.ok(generic)
  const longChunks = buildEmbeddingChunkDetails(`${long.title}\n${long.search_text}`)
  const chunkVectors = longChunks.map((chunk, index) => ({
    vector: index === longChunks.length - 1 ? [0, 1] : [1, 0],
    chunkHash: createHash('sha256').update(chunk.text).digest('hex'),
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset
  }))
  assert.equal(store.saveEmbeddingBatch([{
    id: long.id,
    model,
    vector: meanNormalizedEmbeddings(chunkVectors.map(item => item.vector)),
    expectedContentHash: long.content_hash,
    chunks: chunkVectors
  }, {
    id: generic.id,
    model,
    vector: [0.7, 0.7],
    expectedContentHash: generic.content_hash,
    chunks: [{
      vector: [0.7, 0.7],
      chunkHash: '',
      startOffset: 0,
      endOffset: `${generic.title}\n${generic.search_text}`.trim().length
    }]
  }]), 2)
  const results = store.searchVector([0, 1], model, 10)
  assert.equal(results[0].id, long.id)
  assert.equal(results.filter(item => item.id === long.id).length, 1)
  assert.equal(results[0].chunk_index, longChunks.length - 1)
  assert.match(results[0].semantic_match_excerpt, /远端唯一主题/)
  assert.equal('embedding_json' in results[0], false)
  assert.equal('embedding_model' in results[0], false)
  assert.equal(store.listEmbeddingCandidates(model, 10).length, 0)
  ;(store as any).db.prepare(`
    UPDATE search_document_embedding_chunks SET end_offset=999999
    WHERE document_id=?
  `).run(generic.id)
  assert.equal(store.listEmbeddingCandidates(model, 10)
    .some(item => item.id === generic.id), true)

  store.upsertResources([{
    id: 'long-semantic-resource',
    resourceType: 'document',
    title: '长文档',
    content: '正文已经变化',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T01:00:00.000Z'
  }])
  assert.equal(store.listEmbeddingCandidates(model, 10)
    .some(item => item.id === long.id), true)
}))

test('malformed vectors remain pending and recover safely across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-invalid-vector-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const model = 'test-invalid-vector:2d'
  const tasks = Array.from({ length: 3 }, (_, index) => ({
    id: `invalid-vector-task-${index}`,
    title: `损坏向量测试 ${index}`,
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }))
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.syncTasks(tasks)
    tasks.forEach(task => first.saveEmbedding(`task:${task.id}`, model, [1, 0]))
    const database = (first as any).db
    database.exec(`
      UPDATE search_documents SET embedding_json='not-json'
      WHERE id='task:invalid-vector-task-0';
      UPDATE search_documents SET embedding_json='[1]'
      WHERE id='task:invalid-vector-task-1';
      UPDATE search_documents SET embedding_json='[1,null]'
      WHERE id='task:invalid-vector-task-2';
    `)
    const invalid = first.getEmbeddingStats(model)
    assert.equal(invalid.total, 3)
    assert.equal(invalid.indexed, 0)
    assert.equal(invalid.pending, 3)
    assert.equal(invalid.invalid, 3)
    assert.equal(first.listEmbeddingCandidates(model).length, 3)
    assert.deepEqual(first.searchVector([1, 0], model), [])
    assert.equal(first.ensureApproximateVectorIndex(model, {
      minimumDocuments: 1
    }).rebuilt, false)
    first.close()

    reopened.initialize(databasePath, key)
    assert.equal(reopened.getEmbeddingStats(model).invalid, 3)
    assert.equal(reopened.listEmbeddingCandidates(model).length, 3)
    assert.equal(reopened.getEmbeddingStats('next-model:2d').invalid, 0)
    reopened.saveEmbedding('task:invalid-vector-task-0', model, [1, 0])
    reopened.saveEmbedding('task:invalid-vector-task-0', model, [Number.NaN, 0])
    const repaired = reopened.getEmbeddingStats(model)
    assert.equal(repaired.indexed, 1)
    assert.equal(repaired.pending, 2)
    assert.equal(repaired.invalid, 2)
    assert.equal(reopened.searchVector([1, 0], model)[0]?.source_id,
      'invalid-vector-task-0')
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('embedding batches reject count, dimension and non-finite output before writes', () => {
  assert.deepEqual(validateEmbeddingBatch([[1, 0], [0, 1]], 2), {
    valid: true,
    dimensions: 2,
    reason: ''
  })
  assert.equal(validateEmbeddingBatch([[1, 0]], 2).reason, 'count_mismatch')
  assert.equal(validateEmbeddingBatch([[]], 1).reason, 'empty_vector')
  assert.equal(validateEmbeddingBatch([[0, 0]], 1).reason, 'invalid_norm')
  assert.equal(validateEmbeddingBatch([[Number.MAX_VALUE, Number.MAX_VALUE]], 1).reason, 'invalid_norm')
  assert.equal(validateEmbeddingBatch([[1, 0], [1]], 2).reason, 'dimension_mismatch')
  assert.equal(validateEmbeddingBatch([[1, Number.NaN]], 1).reason, 'non_finite_value')
  assert.equal(validateEmbeddingBatch([[1, Number.POSITIVE_INFINITY]], 1).reason,
    'non_finite_value')
})

test('semantic query deadline returns promptly without cancelling background model loading', async () => {
  let finishLoading: ((value: number[]) => void) | null = null
  const loading = new Promise<number[]>(resolve => { finishLoading = resolve })
  await assert.rejects(
    () => withVectorQueryDeadline(loading, 10),
    /立即回退全文检索/
  )
  finishLoading!([1, 2, 3])
  assert.deepEqual(await loading, [1, 2, 3])
  assert.equal(await withVectorQueryDeadline(Promise.resolve('ready'), 100), 'ready')
})

test('semantic search warmup schedules pending work without awaiting an index batch', () => {
  let scheduled = 0
  assert.equal(requestVectorIndexWarmup(0, false, () => { scheduled += 1 }), false)
  assert.equal(scheduled, 0)
  assert.equal(requestVectorIndexWarmup(24, false, () => { scheduled += 1 }), true)
  assert.equal(scheduled, 1)
  assert.equal(requestVectorIndexWarmup(0, true, () => { scheduled += 1 }), true)
  assert.equal(scheduled, 2)
  assert.equal(approximateVectorIndexNeedsRecovery({
    status: 'dirty',
    eligible: 2_100,
    indexed: 2_099,
    eligibleChunks: 2_400,
    indexedChunks: 2_399,
    minimumDocuments: 2_000
  }), true)
  assert.equal(approximateVectorIndexNeedsRecovery({
    status: 'dirty',
    eligible: 100,
    indexed: 99,
    eligibleChunks: 120,
    indexedChunks: 119,
    minimumDocuments: 2_000
  }), false)
  assert.equal(approximateVectorIndexNeedsRecovery({
    status: 'ready',
    eligible: 2_100,
    indexed: 2_100,
    eligibleChunks: 2_400,
    indexedChunks: 2_400,
    minimumDocuments: 2_000
  }), false)
})

test('local embedding identity pins an immutable model revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-model-identity-'))
  try {
    const service = new LocalEmbeddingService()
    service.initialize(directory)
    const status = service.getStatus()
    assert.equal(status.model, LOCAL_EMBEDDING_MODEL)
    assert.equal(status.revision, LOCAL_EMBEDDING_REVISION)
    assert.match(status.cacheDirectory, new RegExp(`/revisions/${LOCAL_EMBEDDING_REVISION}$`))
    assert.match(service.modelVersion, new RegExp(`@${LOCAL_EMBEDDING_REVISION}:`))
    assert.notEqual(LOCAL_EMBEDDING_REVISION, 'main')
    assert.match(LOCAL_EMBEDDING_REVISION, /^[a-f0-9]{40}$/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('long document embedding chunks cover the complete 80k document with overlap', () => {
  const sections = Array.from({ length: 81 }, (_, index) =>
    `段落-${String(index).padStart(3, '0')}-开始 ${String.fromCharCode(0x4e00 + index).repeat(970)} 段落-${String(index).padStart(3, '0')}-结束`)
  const text = sections.join('\n\n')
  const chunks = buildEmbeddingChunks(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.length <= LOCAL_EMBEDDING_MAX_CHUNKS)
  assert.ok(chunks.every(chunk => chunk.length <= LOCAL_EMBEDDING_CHUNK_SIZE))
  for (let index = 0; index < sections.length; index += 1) {
    assert.equal(chunks.some(chunk => chunk.includes(`段落-${String(index).padStart(3, '0')}-开始`)), true)
  }
  assert.ok(chunks.slice(0, -1).every((chunk, index) => {
    const overlapProbe = chunk.slice(-Math.min(LOCAL_EMBEDDING_CHUNK_OVERLAP / 2, chunk.length))
    return chunks[index + 1].includes(overlapProbe)
  }))
})

test('chunk embedding aggregation returns one normalized vector per document', () => {
  assert.deepEqual(meanNormalizedEmbeddings([[1, 0], [0, 1]]).map(value => Number(value.toFixed(6))),
    [0.707107, 0.707107])
  assert.deepEqual(meanNormalizedEmbeddings([[1, 0], [-1, 0]]), [])
  assert.deepEqual(meanNormalizedEmbeddings([[1, 0], [1]]), [])
})

test('document embedding includes semantic content from the far end of a long document', async () => {
  const service = new LocalEmbeddingService()
  const observed: string[] = []
  const inferenceBatchSizes: number[] = []
  ;(service as any).embed = async (chunks: string[]) => {
    inferenceBatchSizes.push(chunks.length)
    observed.push(...chunks)
    return chunks.map(chunk => chunk.includes('远端唯一语义标记')
      ? [0, 1]
      : [1, 0])
  }
  const [vector] = await service.embedDocuments([
    `${'前部普通内容。'.repeat(1_500)}\n远端唯一语义标记`
  ])
  assert.ok(observed.length > 1)
  assert.ok(inferenceBatchSizes.length > 1)
  assert.ok(inferenceBatchSizes.every(size => size <= LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE))
  assert.equal(observed.some(chunk => chunk.includes('远端唯一语义标记')), true)
  assert.ok(vector[1] > 0)
  assert.ok(Math.abs(Math.sqrt(vector[0] ** 2 + vector[1] ** 2) - 1) < 1e-12)
})

test('local embedding cache verification removes only corrupted derived files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-model-integrity-'))
  const model = 'fixture/model'
  const revision = 'a'.repeat(40)
  const modelDirectory = join(directory, 'fixture', 'model', revision)
  const filePath = join(modelDirectory, 'weights.bin')
  try {
    mkdirSync(modelDirectory, { recursive: true })
    writeFileSync(filePath, 'trusted-bytes')
    const trustedHash = createHash('sha256').update('trusted-bytes').digest('hex')
    const verified = await verifyModelCacheManifest({
      cacheDirectory: directory,
      model,
      revision,
      manifest: [{ path: 'weights.bin', sha256: trustedHash }]
    })
    assert.deepEqual(verified, { state: 'verified', checked: 1, missing: 0, removed: 0 })
    assert.equal(existsSync(filePath), true)

    writeFileSync(filePath, 'tampered-bytes')
    const repaired = await verifyModelCacheManifest({
      cacheDirectory: directory,
      model,
      revision,
      manifest: [{ path: 'weights.bin', sha256: trustedHash }]
    })
    assert.deepEqual(repaired, { state: 'repaired', checked: 0, missing: 1, removed: 1 })
    assert.equal(existsSync(filePath), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('local embedding manifest covers every runtime-critical pinned artifact', () => {
  assert.deepEqual(LOCAL_EMBEDDING_MANIFEST.map(entry => entry.path), [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
    'onnx/model_quantized.onnx_data'
  ])
  LOCAL_EMBEDDING_MANIFEST.forEach(entry => assert.match(entry.sha256, /^[a-f0-9]{64}$/))
})

test('successful post-download verification preserves the repair that triggered it', () => {
  const initial = {
    state: 'not_checked' as const,
    checkedAt: '',
    checked: 0,
    missing: 5,
    removed: 0,
    lastRepairAt: ''
  }
  const repaired = recordModelCacheIntegrity(initial, {
    state: 'repaired',
    checked: 4,
    missing: 1,
    removed: 1
  }, '2026-08-05T04:00:00.000Z')
  const verified = recordModelCacheIntegrity(repaired, {
    state: 'verified',
    checked: 5,
    missing: 0,
    removed: 0
  }, '2026-08-05T04:00:05.000Z')
  assert.equal(verified.state, 'verified')
  assert.equal(verified.missing, 0)
  assert.equal(verified.removed, 1)
  assert.equal(verified.lastRepairAt, '2026-08-05T04:00:00.000Z')
  assert.equal(verified.checkedAt, '2026-08-05T04:00:05.000Z')
})

test('cosine similarity is scale safe and rejects unusable vectors', () => {
  assert.equal(safeCosineSimilarity([1, 0], [1_000_000, 0]), 1)
  assert.equal(safeCosineSimilarity([1, 0], [0, 5]), 0)
  assert.equal(safeCosineSimilarity([1, 0], [-7, 0]), -1)
  assert.equal(safeCosineSimilarity([1, 0], [0, 0]), null)
  assert.equal(safeCosineSimilarity([1, 0], [1]), null)
  assert.equal(safeCosineSimilarity([1, 0], [Number.NaN, 0]), null)
})

test('bounded vector indexing stops after its foreground budget and resumes without duplicates', async () => {
  const pending = Array.from({ length: 5 }, (_, index) => ({
    id: `bounded-vector-${index}`,
    content_hash: `hash-${index}`
  }))
  const committed: string[] = []
  const run = (maxBatches?: number) => runVectorIndexPass({
    maxBatches,
    batchSize: 2,
    listCandidates: limit => pending.slice(0, limit),
    embed: async documents => documents.map((_, index) => index % 2 ? [0, 1] : [1, 0]),
    commit: document => {
      const index = pending.findIndex(item => item.id === document.id)
      if (index < 0) return false
      pending.splice(index, 1)
      committed.push(document.id)
      return true
    }
  })
  assert.deepEqual(await run(2), { indexed: 4, batches: 2, drained: false })
  assert.equal(pending.length, 1)
  assert.deepEqual(await run(), { indexed: 1, batches: 1, drained: true })
  assert.equal(new Set(committed).size, 5)
})

test('bounded vector indexing rejects a malformed batch before any partial commit', async () => {
  let commits = 0
  await assert.rejects(() => runVectorIndexPass({
    maxBatches: 1,
    batchSize: 2,
    listCandidates: () => [{ id: 'one' }, { id: 'two' }],
    embed: async () => [[1, 0]],
    commit: () => {
      commits += 1
      return true
    }
  }), /异常的批次/)
  assert.equal(commits, 0)
})

test('bounded vector indexing delegates a validated model batch to one atomic commit', async () => {
  let individualCommits = 0
  let batchCommits = 0
  const result = await runVectorIndexPass({
    maxBatches: 1,
    batchSize: 2,
    listCandidates: () => [
      { id: 'atomic-vector-one', content_hash: 'hash-one' },
      { id: 'atomic-vector-two', content_hash: 'hash-two' }
    ],
    embed: async () => [[1, 0], [0, 1]],
    commit: () => {
      individualCommits += 1
      return true
    },
    commitBatch: items => {
      batchCommits += 1
      assert.deepEqual(items.map(item => item.document.id), [
        'atomic-vector-one',
        'atomic-vector-two'
      ])
      return items.length
    }
  })
  assert.deepEqual(result, { indexed: 2, batches: 1, drained: false })
  assert.equal(batchCommits, 1)
  assert.equal(individualCommits, 0)
})

test('bounded vector indexing exits on zero progress instead of spinning forever', async () => {
  let listCalls = 0
  await assert.rejects(() => runVectorIndexPass({
    maxBatches: 3,
    batchSize: 1,
    listCandidates: () => {
      listCalls += 1
      return [{ id: 'changing-document', content_hash: `version-${listCalls}` }]
    },
    embed: async () => [[1, 0]],
    commit: () => false
  }), /没有可安全提交/)
  assert.equal(listCalls, 1)
})

test('vector continuation health exposes scheduling, progress, retry and recovery', () => {
  const initial = {
    scheduled: false,
    runCount: 0,
    indexedCount: 0,
    failureStreak: 0,
    nextRetryAt: '',
    lastScheduledAt: '',
    lastAttemptAt: '',
    lastSuccessAt: '',
    lastErrorAt: '',
    lastError: ''
  }
  const scheduled = recordVectorIndexContinuation(initial, {
    type: 'scheduled',
    at: '2026-08-05T02:00:00.000Z'
  })
  assert.equal(scheduled.scheduled, true)
  const started = recordVectorIndexContinuation(scheduled, {
    type: 'started',
    at: '2026-08-05T02:00:01.000Z'
  })
  assert.equal(started.scheduled, false)
  assert.equal(started.runCount, 1)
  const failed = recordVectorIndexContinuation(started, {
    type: 'failed',
    at: '2026-08-05T02:00:02.000Z',
    error: 'model temporarily unavailable'
  })
  assert.equal(failed.lastError, 'model temporarily unavailable')
  assert.equal(failed.lastErrorAt, '2026-08-05T02:00:02.000Z')
  assert.equal(failed.failureStreak, 1)
  assert.equal(failed.nextRetryAt, '2026-08-05T02:01:02.000Z')
  const retry = recordVectorIndexContinuation(failed, {
    type: 'scheduled',
    at: '2026-08-05T02:01:02.000Z'
  })
  assert.equal(retry.scheduled, true)
  assert.equal(retry.lastError, failed.lastError)
  const recovered = recordVectorIndexContinuation(retry, {
    type: 'succeeded',
    at: '2026-08-05T02:01:05.000Z',
    indexed: 48
  })
  assert.equal(recovered.scheduled, false)
  assert.equal(recovered.indexedCount, 48)
  assert.equal(recovered.failureStreak, 0)
  assert.equal(recovered.nextRetryAt, '')
  assert.equal(recovered.lastSuccessAt, '2026-08-05T02:01:05.000Z')
  assert.equal(recovered.lastError, '')
  assert.equal(recordVectorIndexContinuation(recovered, {
    type: 'cancelled',
    at: '2026-08-05T02:02:00.000Z'
  }).scheduled, false)
})

test('vector continuation health persists in SQLCipher without reviving an old timer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-vector-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.saveVectorIndexContinuationHealth({
      scheduled: true,
      runCount: 7,
      indexedCount: 336,
      failureStreak: 3,
      nextRetryAt: '2026-08-05T02:04:00.000Z',
      lastScheduledAt: '2026-08-05T02:00:00.000Z',
      lastAttemptAt: '2026-08-05T02:00:01.000Z',
      lastSuccessAt: '2026-08-05T02:00:05.000Z',
      lastErrorAt: '2026-08-05T01:59:00.000Z',
      lastError: ''
    })
    first.close()

    reopened.initialize(databasePath, key)
    assert.deepEqual(reopened.getVectorIndexContinuationHealth(), {
      scheduled: false,
      runCount: 7,
      indexedCount: 336,
      failureStreak: 3,
      nextRetryAt: '2026-08-05T02:04:00.000Z',
      lastScheduledAt: '2026-08-05T02:00:00.000Z',
      lastAttemptAt: '2026-08-05T02:00:01.000Z',
      lastSuccessAt: '2026-08-05T02:00:05.000Z',
      lastErrorAt: '2026-08-05T01:59:00.000Z',
      lastError: ''
    })
    ;(reopened as any).db.prepare(`
      UPDATE schema_meta SET value='not-json'
      WHERE key='vector_index_continuation_health_v1'
    `).run()
    const recovered = reopened.getVectorIndexContinuationHealth()
    assert.equal(recovered.scheduled, false)
    assert.equal(recovered.runCount, 0)
    assert.equal(recovered.indexedCount, 0)
    assert.equal(recovered.failureStreak, 0)
    assert.equal(recovered.nextRetryAt, '')
    assert.equal(recovered.lastError, '')
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('vector continuation retry backs off across restart and caps at six hours', () => {
  assert.equal(vectorIndexRetryDelayMs(1), 60_000)
  assert.equal(vectorIndexRetryDelayMs(2), 120_000)
  assert.equal(vectorIndexRetryDelayMs(4), 480_000)
  assert.equal(vectorIndexRetryDelayMs(99), 6 * 60 * 60_000)
  assert.equal(vectorIndexScheduleDelayMs(
    { nextRetryAt: '2026-08-05T03:00:00.000Z' },
    12_000,
    Date.parse('2026-08-05T02:00:00.000Z')
  ), 60 * 60_000)
  assert.equal(vectorIndexScheduleDelayMs(
    { nextRetryAt: '2026-08-05T01:00:00.000Z' },
    12_000,
    Date.parse('2026-08-05T02:00:00.000Z')
  ), 12_000)
})

test('semantic ranking uses cosine similarity so vector magnitude cannot dominate relevance', () => withStore(store => {
  const model = 'test-cosine-ranking:2d'
  store.syncTasks([
    {
      id: 'cosine-aligned',
      title: '方向一致',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    },
    {
      id: 'cosine-inflated',
      title: '幅值很大但方向较差',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    }
  ])
  assert.equal(store.saveEmbedding('task:cosine-aligned', model, [1, 0]), true)
  assert.equal(store.saveEmbedding('task:cosine-inflated', model, [8, 6]), true)
  const results = store.searchVector([1, 0], model, 10)
  assert.deepEqual(results.map(item => item.id), ['task:cosine-aligned', 'task:cosine-inflated'])
  assert.equal(results[0].semantic_score, 1)
  assert.ok(Math.abs(results[1].semantic_score - 0.8) < 1e-12)
  assert.equal(store.saveEmbedding('task:cosine-inflated', model, [0, 0]), false)
}))

test('legacy zero vectors become invalid pending work and never enter semantic results', () => withStore(store => {
  const model = 'test-zero-vector:2d'
  store.syncTasks([{
    id: 'zero-vector',
    title: '零向量损坏',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }])
  assert.equal(store.saveEmbedding('task:zero-vector', model, [1, 0]), true)
  ;(store as any).db.prepare(`
    UPDATE search_documents SET embedding_json='[0,0]' WHERE id='task:zero-vector'
  `).run()
  const stats = store.getEmbeddingStats(model)
  assert.equal(stats.indexed, 0)
  assert.equal(stats.pending, 1)
  assert.equal(stats.invalid, 1)
  assert.deepEqual(store.searchVector([1, 0], model), [])
  assert.deepEqual(store.listEmbeddingCandidates(model).map(item => item.id), ['task:zero-vector'])
}))

test('vector query fallback remains visible and a later success clears only current error', () => {
  const initial = {
    fallbackCount: 0,
    dimensionRepairCount: 0,
    lastDimensionRepairAt: '',
    lastFallbackAt: '',
    lastSuccessAt: '',
    lastError: ''
  }
  const failed = recordVectorQueryOutcome(initial, {
    success: false,
    at: '2026-08-05T01:00:00.000Z',
    error: '本地查询向量无效：non_finite_value'
  })
  assert.deepEqual(failed, {
    fallbackCount: 1,
    dimensionRepairCount: 0,
    lastDimensionRepairAt: '',
    lastFallbackAt: '2026-08-05T01:00:00.000Z',
    lastSuccessAt: '',
    lastError: '本地查询向量无效：non_finite_value'
  })
  const recovered = recordVectorQueryOutcome(failed, {
    success: true,
    at: '2026-08-05T01:05:00.000Z'
  })
  assert.equal(recovered.fallbackCount, 1)
  assert.equal(recovered.lastFallbackAt, failed.lastFallbackAt)
  assert.equal(recovered.lastSuccessAt, '2026-08-05T01:05:00.000Z')
  assert.equal(recovered.lastError, '')
})

test('vector query health writes only failures, repairs and the first recovery success', () => {
  const healthy = {
    fallbackCount: 3,
    dimensionRepairCount: 2,
    lastDimensionRepairAt: '2026-08-05T01:00:00.000Z',
    lastFallbackAt: '2026-08-05T01:05:00.000Z',
    lastSuccessAt: '2026-08-05T01:10:00.000Z',
    lastError: ''
  }
  assert.equal(shouldPersistVectorQueryOutcome(healthy, { success: true }), false)
  assert.equal(shouldPersistVectorQueryOutcome(healthy, {
    success: true,
    dimensionRepairs: 1
  }), true)
  assert.equal(shouldPersistVectorQueryOutcome(healthy, { success: false }), true)
  assert.equal(shouldPersistVectorQueryOutcome({
    ...healthy,
    lastError: 'temporary failure'
  }, { success: true }), true)
})

test('vector query health survives a SQLCipher reopen and malformed history is isolated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-vector-query-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.saveVectorQueryHealth({
      fallbackCount: 4,
      dimensionRepairCount: 9,
      lastDimensionRepairAt: '2026-08-05T01:00:00.000Z',
      lastFallbackAt: '2026-08-05T01:02:00.000Z',
      lastSuccessAt: '2026-08-05T01:03:00.000Z',
      lastError: 'temporary local model failure'
    })
    first.close()

    reopened.initialize(databasePath, key)
    assert.deepEqual(reopened.getVectorQueryHealth(), {
      fallbackCount: 4,
      dimensionRepairCount: 9,
      lastDimensionRepairAt: '2026-08-05T01:00:00.000Z',
      lastFallbackAt: '2026-08-05T01:02:00.000Z',
      lastSuccessAt: '2026-08-05T01:03:00.000Z',
      lastError: 'temporary local model failure'
    })
    ;(reopened as any).db.prepare(`
      UPDATE schema_meta SET value='[' WHERE key='vector_query_health_v1'
    `).run()
    assert.deepEqual(reopened.getVectorQueryHealth(), {
      fallbackCount: 0,
      dimensionRepairCount: 0,
      lastDimensionRepairAt: '',
      lastFallbackAt: '',
      lastSuccessAt: '',
      lastError: ''
    })
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('query dimension invalidation makes mismatched vectors pending without touching the current dimension', () => withStore(store => {
  const model = 'test-query-dimension-binding'
  store.syncTasks([
    {
      id: 'dimension-current',
      title: '当前维度',
      detail: '当前维度向量',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    },
    {
      id: 'dimension-stale',
      title: '漂移维度',
      detail: '漂移维度向量',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    }
  ])
  assert.equal(store.saveEmbedding('task:dimension-current', model, [1, 0]), true)
  assert.equal(store.saveEmbedding('task:dimension-stale', model, [1, 0, 0]), true)

  assert.equal(store.invalidateEmbeddingDimensionMismatches(model, 2), 1)
  assert.deepEqual(store.searchVector([1, 0], model, 10).map(item => item.id), ['task:dimension-current'])
  const candidates = store.listEmbeddingCandidates(model, 10).map(item => item.id)
  assert.equal(candidates.includes('task:dimension-stale'), true)
  assert.equal(candidates.includes('task:dimension-current'), false)
  assert.equal(store.invalidateEmbeddingDimensionMismatches(model, 2), 0)
}))

test('vector query diagnostics count dimension repairs without turning them into failures', () => {
  const repaired = recordVectorQueryOutcome({
    fallbackCount: 2,
    dimensionRepairCount: 3,
    lastDimensionRepairAt: '2026-08-05T00:30:00.000Z',
    lastFallbackAt: '2026-08-05T00:45:00.000Z',
    lastSuccessAt: '',
    lastError: 'old error'
  }, {
    success: true,
    at: '2026-08-05T01:00:00.000Z',
    dimensionRepairs: 4
  })
  assert.equal(repaired.fallbackCount, 2)
  assert.equal(repaired.dimensionRepairCount, 7)
  assert.equal(repaired.lastDimensionRepairAt, '2026-08-05T01:00:00.000Z')
  assert.equal(repaired.lastSuccessAt, '2026-08-05T01:00:00.000Z')
  assert.equal(repaired.lastError, '')
})

test('embedding commit is bound to the exact document content hash', () => withStore(store => {
  const model = 'test-content-bound-vector:2d'
  const task = {
    id: 'content-bound-vector-task',
    title: '向量提交绑定正文',
    detail: '生成向量时的旧正文',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }
  store.syncTasks([task])
  const [candidate] = store.listEmbeddingCandidates(model)
  assert.match(candidate.content_hash, /^[a-f0-9]{64}$/)
  store.syncTasks([{ ...task, detail: '向量生成期间更新后的新正文' }])

  assert.equal(store.saveEmbedding(
    candidate.id, model, [1, 0], candidate.content_hash
  ), false)
  assert.equal(store.getEmbeddingStats(model).indexed, 0)
  const [current] = store.listEmbeddingCandidates(model)
  assert.notEqual(current.content_hash, candidate.content_hash)
  assert.equal(store.saveEmbedding(
    current.id, model, [1, 0], current.content_hash
  ), true)
  assert.equal(store.getEmbeddingStats(model).indexed, 1)
  assert.equal(store.searchVector([1, 0], model)[0]?.search_text.includes('新正文'), true)
}))

test('embedding model batches roll every vector back when a later SQL write fails', () => withStore(store => {
  const model = 'test-atomic-vector-batch:2d'
  const tasks = ['one', 'two'].map(suffix => ({
    id: `atomic-vector-task-${suffix}`,
    title: `原子向量 ${suffix}`,
    detail: `批次正文 ${suffix}`,
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }))
  store.syncTasks(tasks)
  const candidates = store.listEmbeddingCandidates(model, 10)
    .filter(item => String(item.id).startsWith('task:atomic-vector-task-'))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  assert.equal(candidates.length, 2)
  ;(store as any).db.exec(`
    CREATE TEMP TRIGGER fail_second_atomic_vector
    BEFORE UPDATE ON search_documents
    WHEN NEW.id='task:atomic-vector-task-two'
    BEGIN
      SELECT RAISE(ABORT, 'injected vector batch failure');
    END;
  `)
  assert.throws(() => store.saveEmbeddingBatch(candidates.map((item, index) => ({
    id: item.id,
    model,
    vector: index ? [0, 1] : [1, 0],
    expectedContentHash: item.content_hash
  }))), /injected vector batch failure/)
  assert.equal(store.getEmbeddingStats(model).indexed, 0)
  assert.equal(store.getEmbeddingStats(model).pending, 2)
  ;(store as any).db.exec('DROP TRIGGER fail_second_atomic_vector')
}))

test('embedding model batches commit current documents and leave stale versions pending', () => withStore(store => {
  const model = 'test-partial-stale-vector-batch:2d'
  const tasks = ['current', 'stale'].map(suffix => ({
    id: `versioned-vector-task-${suffix}`,
    title: `版本向量 ${suffix}`,
    detail: `原始正文 ${suffix}`,
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }))
  store.syncTasks(tasks)
  const candidates = store.listEmbeddingCandidates(model, 10)
    .filter(item => String(item.id).startsWith('task:versioned-vector-task-'))
  const stale = candidates.find(item => item.id.endsWith('-stale'))
  assert.ok(stale)
  store.syncTasks(tasks.map(task => task.id.endsWith('-stale')
    ? { ...task, detail: '生成向量期间已经变化' }
    : task))

  assert.equal(store.saveEmbeddingBatch(candidates.map((item, index) => ({
    id: item.id,
    model,
    vector: index ? [0, 1] : [1, 0],
    expectedContentHash: item.content_hash
  }))), 1)
  assert.equal(store.getEmbeddingStats(model).indexed, 1)
  assert.equal(store.getEmbeddingStats(model).pending, 1)
  assert.equal(store.listEmbeddingCandidates(model).some(item => item.id === stale.id), true)
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

test('chunk ANN recalls a long-document tail without scanning every long document', () => withStore(store => {
  const model = 'test-ann-chunks:8d'
  const distractor = [0, 1, 0.04, 0.03, 0.02, 0.01, 0.005, 0.002]
  const tailVector = [1, 0, 0.04, 0.03, 0.02, 0.01, 0.005, 0.002]
  const normalize = (vector: number[]) => {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return vector.map(value => value / norm)
  }
  store.syncTasks(Array.from({ length: 39 }, (_, index) => ({
    id: `chunk-ann-distractor-${index}`,
    title: `分块索引干扰项 ${index}`,
    detail: '与长文档尾部语义无关',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  })))
  for (let index = 0; index < 39; index += 1) {
    store.saveEmbedding(`task:chunk-ann-distractor-${index}`, model, normalize(distractor))
  }
  const title = '完整长文档'
  const lead = '普通背景内容。'.repeat(80)
  const tail = '尾部唯一语义：火星港口交付校验。'
  store.upsertResources([{
    id: 'chunk-ann-long-resource',
    resourceType: 'document',
    title,
    content: `${lead}${tail}`,
    metadata: { sourceId: 'documents' },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }])
  const [candidate] = store.listEmbeddingCandidates(model)
    .filter(item => item.id === 'resource:chunk-ann-long-resource')
  const authoritative = `${candidate.title}\n${candidate.search_text}`.replace(/\r\n?/g, '\n').trim()
  const tailStart = authoritative.indexOf(tail)
  assert.equal(store.saveEmbedding(
    candidate.id,
    model,
    normalize(distractor),
    candidate.content_hash,
    [
      { vector: normalize(distractor), chunkHash: '', startOffset: 0, endOffset: tailStart },
      { vector: normalize(tailVector), chunkHash: '', startOffset: tailStart, endOffset: authoritative.length }
    ]
  ), true)
  const built = store.ensureApproximateVectorIndex(model, { minimumDocuments: 20 })
  assert.equal(built.indexed, 40)
  assert.equal(built.indexedChunks, 41)
  assert.equal(built.chunkCoverage, 1)
  assert.equal(built.coverageValidation, 'write_guarded')
  const results = store.searchVector(normalize(tailVector), model, 1, {
    minimumDocuments: 20,
    minimumCandidates: 1
  })
  assert.equal(results[0]?.id, 'resource:chunk-ann-long-resource')
  assert.equal(results[0]?.semantic_search_mode, 'ann')
  assert.equal(results[0]?.semantic_match_excerpt, tail)

  ;(store as any).db.prepare(`
    DELETE FROM vector_ann_chunk_entries
    WHERE document_id=? AND chunk_index=1 AND table_id=0
  `).run('resource:chunk-ann-long-resource')
  const incomplete = store.getApproximateVectorIndexStats(model, 8)
  assert.equal(incomplete.active, false)
  assert.equal(incomplete.status, 'dirty')
  assert.equal(incomplete.coverageValidation, 'full_audit')
  assert.ok(incomplete.chunkCoverage < 1)
  assert.equal(store.searchVector(normalize(tailVector), model, 1, {
    minimumDocuments: 20,
    minimumCandidates: 1
  })[0]?.semantic_search_mode, 'exact')
  const rebuilt = store.ensureApproximateVectorIndex(model, { minimumDocuments: 20 })
  assert.equal(rebuilt.rebuilt, true)
  assert.equal(rebuilt.coverageValidation, 'write_guarded')
  assert.equal(rebuilt.chunkCoverage, 1)
  ;(store as any).db.prepare(`
    UPDATE search_document_embedding_chunks SET vector_json=vector_json
    WHERE document_id=? AND chunk_index=1
  `).run('resource:chunk-ann-long-resource')
  assert.equal(store.getApproximateVectorIndexStats(model, 8).status, 'dirty')
}))

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
    minimumCandidates: 30,
    maximumCandidates: 64
  })
  assert.equal(approximate[0].semantic_search_mode, 'ann')
  assert.ok(approximate.every(item =>
    item.semantic_candidate_count <= 64 && item.semantic_candidate_budget === 64))
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
    evidence: [{ source_id: 'wechat', session_id: 'session-onyx', timestamp: inRange }]
  }, {
    id: 'task-1',
    document_type: 'task',
    source_id: 'task-1',
    title: '准备 Onyx 演示',
    search_text: '准备 Onyx 演示',
    metadata: {},
    updated_at: '2026-07-29T10:00:00+08:00',
    evidence: [{ source_id: 'documents', session_id: 'session-other', timestamp: inRange }]
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
    evidence: [{ source_id: 'wechat', session_id: 'session-onyx', timestamp: inRange }]
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
  assert.deepEqual(filterMemorySearchResults(items, {
    sourceIds: ['documents']
  }).map(item => item.id), ['task-1'])
  assert.deepEqual(filterMemorySearchResults(items, {
    sourceIds: ['calendar']
  }, true).map(item => item.id), ['relation-1', 'task-1', 'entity-with-index-time-only'])
  assert.deepEqual(filterMemorySearchResults(items, {
    supportability: 'supporting'
  }).map(item => item.id), ['relation-1', 'task-1'])
  assert.deepEqual(filterMemorySearchResults(items, {
    supportability: 'review_only'
  }).map(item => item.id), ['entity-with-index-time-only'])
  assert.equal(filterMemorySearchResults(items, {
    supportability: 'forged-status'
  }).length, 0)
  assert.deepEqual(filterMemorySearchResults(items, {
    evidenceConflict: 'without_contradiction'
  }).map(item => item.id), ['relation-1', 'task-1', 'entity-with-index-time-only'])
  assert.equal(filterMemorySearchResults(items, {
    evidenceConflict: 'with_contradiction'
  }).length, 0)
  assert.equal(filterMemorySearchResults(items, {
    evidenceConflict: 'forged-conflict'
  }).length, 0)
  assert.deepEqual(filterMemorySearchResults(items, {
    evidenceStrength: 'direct'
  }).map(item => item.id), ['relation-1'])
  assert.equal(filterMemorySearchResults(items, {
    evidenceStrength: 'indirect_only'
  }).length, 0)
  assert.equal(filterMemorySearchResults(items, {
    evidenceStrength: 'forged-strength'
  }).length, 0)
  assert.deepEqual(filterMemorySearchResults(items, {
    evidenceBreadth: 'single_source'
  }).map(item => item.id), ['relation-1', 'task-1'])
  assert.equal(filterMemorySearchResults(items, {
    evidenceBreadth: 'multi_source'
  }).length, 0)
  assert.equal(filterMemorySearchResults(items, {
    evidenceBreadth: 'forged-breadth'
  }).length, 0)
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
    evidence: [{ sourceId: 'wechat', messageId: `global-${index}`, timestamp, sender: '全局', excerpt: '共同关键词' }]
  }))
  tasks.push({
    id: 'scoped-target',
    title: '共同关键词 范围内唯一目标',
    detail: '只能通过召回前范围约束可靠找回',
    priority: 'high',
    status: 'todo',
    classification: 'mine',
    sourceSessionId: 'session-target',
    evidence: [{ sourceId: 'documents', messageId: 'target-message', timestamp, sender: '目标', excerpt: '共同关键词 范围内证据' }]
  })
  store.syncTasks(tasks)
  const scope = store.listScopedSearchDocumentIds({
    sessionId: 'session-target',
    sourceIds: ['documents'],
    from: '2026-07-30',
    to: '2026-07-30',
    documentTypes: ['task']
  })
  assert.deepEqual([...scope || []], ['task:scoped-target'])
  assert.deepEqual([...(store.listScopedSearchDocumentIds({ sourceIds: ['wechat'] }) || [])].length, 350)
  assert.deepEqual(
    [...(store.listScopedSearchDocumentIds({ sourceIds: ['calendar'] }) || [])],
    []
  )
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
  assert.equal(isMemorySearchPageRevisionStale({
    offset: 40,
    expectedRevision: '7',
    startingRevision: '7',
    completedRevision: '7'
  }), false)
  assert.equal(isMemorySearchPageRevisionStale({
    offset: 40,
    expectedRevision: '6',
    startingRevision: '7',
    completedRevision: '7'
  }), true)
  assert.equal(isMemorySearchPageRevisionStale({
    offset: 40,
    startingRevision: '7',
    completedRevision: '7'
  }), true)
  assert.equal(isMemorySearchPageRevisionStale({
    offset: 0,
    startingRevision: '7',
    completedRevision: '8'
  }), true)
})

test('opening a search result evidence archive is bound to the visible document snapshot', () =>
  withStore(store => {
    store.syncTasks([{
      id: 'evidence-search-snapshot',
      title: '证据档案快照',
      detail: '搜索卡必须只打开用户实际看到的权威文档版本',
      priority: 'medium',
      status: 'todo',
      classification: 'mine',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'snapshot-message',
        sessionId: 'snapshot-session',
        timestamp: 1_767_225_600,
        sender: '快照测试',
        excerpt: '原始证据'
      }]
    }])
    const visibleRevision = store.getMemorySearchRevision()
    assert.deepEqual(
      store.validateSearchDocumentSnapshot('task', 'evidence-search-snapshot', visibleRevision),
      { revision: visibleRevision, stale: false, exists: true }
    )
    assert.deepEqual(
      store.validateSearchDocumentSnapshot('task', 'evidence-search-snapshot', 'older-revision'),
      { revision: visibleRevision, stale: true, exists: true }
    )

    const database = (store as any).db
    database.prepare(`DELETE FROM search_documents WHERE id=?`)
      .run('task:evidence-search-snapshot')
    const deletedRevision = store.getMemorySearchRevision()
    assert.notEqual(deletedRevision, visibleRevision)
    assert.deepEqual(
      store.validateSearchDocumentSnapshot('task', 'evidence-search-snapshot', visibleRevision),
      { revision: deletedRevision, stale: true, exists: false }
    )

    store.syncTasks([{
      id: 'evidence-search-snapshot',
      title: '同 ID 的新版本',
      detail: '旧卡片不能静默连接到重建内容',
      priority: 'high',
      status: 'doing',
      classification: 'mine'
    }])
    const recreated = store.validateSearchDocumentSnapshot(
      'task',
      'evidence-search-snapshot',
      visibleRevision
    )
    assert.equal(recreated.exists, true)
    assert.equal(recreated.stale, true)
    assert.notEqual(recreated.revision, visibleRevision)
  }))

test('opening a hydrated citation evidence archive binds document content and evidence authority', () =>
  withStore(store => {
    const baseTask = {
      id: 'citation-evidence-snapshot',
      title: '引用证据快照',
      detail: '正文和完整原文必须分别参与点击时核验',
      priority: 'medium',
      status: 'todo',
      classification: 'mine'
    }
    store.syncTasks([{
      ...baseTask,
      evidence: [{
        sourceId: 'wechat',
        messageId: 'citation-snapshot-1',
        sessionId: 'citation-snapshot-session',
        timestamp: 1_767_225_600,
        sender: '引用测试',
        excerpt: '第一条原文'
      }]
    }])
    const visible = store.getSearchDocumentById('task:citation-evidence-snapshot')
    assert.ok(visible)
    const contentHash = String(visible.content_hash)
    const evidenceAuthorityRevision = Number(visible.evidenceAuthorityRevision || 0)
    assert.deepEqual(
      store.validateDocumentEvidenceSnapshot(
        'task',
        'citation-evidence-snapshot',
        contentHash,
        evidenceAuthorityRevision
      ),
      {
        stale: false,
        exists: true,
        contentHash,
        evidenceAuthorityRevision
      }
    )

    store.syncTasks([{
      ...baseTask,
      evidence: [{
        sourceId: 'wechat',
        messageId: 'citation-snapshot-1',
        sessionId: 'citation-snapshot-session',
        timestamp: 1_767_225_600,
        sender: '引用测试',
        excerpt: '第一条原文'
      }, {
        sourceId: 'mail',
        messageId: 'citation-snapshot-2',
        sessionId: 'citation-snapshot-mail',
        timestamp: 1_767_225_601,
        sender: '邮件测试',
        excerpt: '新增权威原文'
      }]
    }])
    const evidenceChanged = store.validateDocumentEvidenceSnapshot(
      'task',
      'citation-evidence-snapshot',
      contentHash,
      evidenceAuthorityRevision
    )
    assert.equal(evidenceChanged.exists, true)
    assert.equal(evidenceChanged.contentHash, contentHash)
    assert.equal(evidenceChanged.stale, true)
    assert.ok(evidenceChanged.evidenceAuthorityRevision > evidenceAuthorityRevision)

    const current = store.getSearchDocumentById('task:citation-evidence-snapshot')
    store.syncTasks([{
      ...baseTask,
      detail: '正文在引用展示后被人工更新',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'citation-snapshot-1',
        sessionId: 'citation-snapshot-session',
        timestamp: 1_767_225_600,
        sender: '引用测试',
        excerpt: '第一条原文'
      }, {
        sourceId: 'mail',
        messageId: 'citation-snapshot-2',
        sessionId: 'citation-snapshot-mail',
        timestamp: 1_767_225_601,
        sender: '邮件测试',
        excerpt: '新增权威原文'
      }]
    }])
    const contentChanged = store.validateDocumentEvidenceSnapshot(
      'task',
      'citation-evidence-snapshot',
      String(current.content_hash),
      Number(current.evidenceAuthorityRevision || 0)
    )
    assert.equal(contentChanged.exists, true)
    assert.notEqual(contentChanged.contentHash, String(current.content_hash))
    assert.equal(contentChanged.stale, true)

    const database = (store as any).db
    database.prepare(`DELETE FROM search_documents WHERE id=?`)
      .run('task:citation-evidence-snapshot')
    assert.deepEqual(
      store.validateDocumentEvidenceSnapshot(
        'task',
        'citation-evidence-snapshot',
        contentChanged.contentHash,
        contentChanged.evidenceAuthorityRevision
      ),
      {
        stale: true,
        exists: false,
        contentHash: '',
        evidenceAuthorityRevision: 0
      }
    )
  }))

test('scoped memory browsing reaches every result beyond the ranked search window', () =>
  withStore(store => {
    const tasks = Array.from({ length: 1_205 }, (_, index) => ({
      id: `range-browse-${index}`,
      title: `范围浏览任务 ${index}`,
      detail: '验证统一检索无关键词范围浏览可以超过五百条',
      priority: 'low',
      status: 'todo',
      classification: 'mine',
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      sourceSessionId: `range-session-${index}`,
      evidence: [{
        sourceId: 'wechat',
        messageId: `range-message-${index}`,
        sessionId: `range-session-${index}`,
        timestamp: 1_767_225_600 + index,
        sender: '范围测试',
        excerpt: `范围浏览证据 ${index}`
      }]
    }))
    store.syncTasks(tasks)
    const options = { sourceIds: ['wechat'], documentTypes: ['task'] }
    const scope = store.listScopedSearchDocumentIds(options)
    assert.equal(scope?.size, 1_205)
    const context = buildMemorySearchFeedbackContext('', options)
    const first = store.listSearchDocumentsInScopePage(scope!, {
      offset: 0,
      limit: 100,
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint
    })
    const beyondOldCap = store.listSearchDocumentsInScopePage(scope!, {
      offset: 1_200,
      limit: 100,
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint
    })
    assert.equal(first.total, 1_205)
    assert.equal(first.items.length, 100)
    assert.equal(first.hasMore, true)
    assert.equal(beyondOldCap.items.length, 5)
    assert.equal(beyondOldCap.hasMore, false)
    assert.equal(new Set([
      ...first.items.map(item => item.id),
      ...beyondOldCap.items.map(item => item.id)
    ]).size, 105)
    assert.deepEqual(store.getSearchDocumentTypeCountsInScope(scope!), {
      task: 1_205
    })

    store.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'task:range-browse-0',
      action: 'helpful'
    })
    store.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'task:range-browse-1204',
      action: 'not_relevant'
    })
    const feedbackFirst = store.listSearchDocumentsInScopePage(scope!, {
      limit: 40,
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint
    })
    const feedbackLast = store.listSearchDocumentsInScopePage(scope!, {
      offset: 1_200,
      limit: 40,
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint
    })
    assert.equal(feedbackFirst.items[0].id, 'task:range-browse-0')
    assert.equal(feedbackFirst.items[0].relevance_feedback, 'helpful')
    assert.equal(feedbackLast.items.at(-1).id, 'task:range-browse-1204')
    assert.equal(feedbackLast.items.at(-1).relevance_feedback, 'not_relevant')
  }))

test('complete keyword archive pages every exact indexed match beyond five hundred', () =>
  withStore(store => {
    const tasks = Array.from({ length: 1_205 }, (_, index) => ({
      id: `keyword-archive-${index}`,
      title: `完整关键词盲区 ${index}`,
      detail: '用于验证本机全文档案不会停在混合排序池上限',
      priority: 'low',
      status: 'todo',
      classification: 'mine',
      updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      sourceSessionId: `keyword-session-${index}`,
      evidence: [{
        sourceId: 'wechat',
        messageId: `keyword-message-${index}`,
        sessionId: `keyword-session-${index}`,
        timestamp: 1_700_000_000 + index,
        sender: '关键词测试',
        excerpt: `完整关键词原文 ${index}`
      }]
    }))
    store.syncTasks(tasks)
    const scope = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      documentTypes: ['task']
    })
    assert.equal(scope?.size, 1_205)
    const first = store.listSearchDocumentsByKeywordPage('完整关键词盲区', scope, {
      offset: 0,
      limit: 100
    })
    const middle = store.listSearchDocumentsByKeywordPage('完整关键词盲区', scope, {
      offset: 500,
      limit: 100
    })
    const last = store.listSearchDocumentsByKeywordPage('完整关键词盲区', scope, {
      offset: 1_200,
      limit: 100
    })
    assert.equal(first.searchMode, 'fts')
    assert.equal(first.total, 1_205)
    assert.equal(first.items.length, 100)
    assert.equal(middle.items.length, 100)
    assert.equal(last.items.length, 5)
    assert.equal(last.hasMore, false)
    assert.equal(new Set([
      ...first.items.map(item => item.id),
      ...middle.items.map(item => item.id),
      ...last.items.map(item => item.id)
    ]).size, 205)
    assert.deepEqual(
      store.getSearchDocumentTypeCountsByKeyword('完整关键词盲区', scope),
      { counts: { task: 1_205 }, searchMode: 'fts' }
    )
  }))

test('memory trust scopes and facets separate confirmed candidates from source material', () =>
  withStore(store => {
    store.syncGraph({
      entities: [{
        id: 'trust-facet-person',
        type: 'person',
        canonicalName: '可信分面人物',
        summary: '',
        confidence: 1,
        trustStatus: 'confirmed',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: []
    } as any)
    store.upsertClaims([{
      id: 'trust-facet-confirmed',
      subjectId: 'trust-facet-person',
      predicate: '负责',
      objectValue: '可信层级关键词',
      confidence: 0.95,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '可信层级关键词 已确认事实',
      evidence: [
        ...evidence('trust-confirmed-message', '可信层级关键词 已确认事实')
          .map(item => ({ ...item, sourceId: 'wechat' })),
        {
          sourceId: 'calendar',
          messageId: 'trust-confirmed-calendar-contradiction',
          sessionId: 'data-source:calendar',
          timestamp: 1_800_000_002,
          excerpt: '日历载体只提供反证',
          role: 'contradiction'
        },
        {
          sourceId: 'mail',
          messageId: 'trust-confirmed-mail-indirect',
          sessionId: 'data-source:mail',
          timestamp: 1_700_000_003,
          excerpt: '邮件载体只有第三方转述',
          role: 'indirect'
        }
      ]
    }, {
      id: 'trust-facet-candidate',
      subjectId: 'trust-facet-person',
      predicate: '关注',
      objectValue: '可信层级关键词',
      confidence: 0.75,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '可信层级关键词 待确认事实',
      evidence: evidence('trust-candidate-message', '可信层级关键词 待确认事实')
        .map(item => ({ ...item, sourceId: 'wechat', role: 'indirect' }))
    }])
    store.syncTasks([{
      id: 'trust-facet-task',
      title: '可信层级关键词 原始待办',
      detail: '原始资料不冒充结构化事实',
      priority: 'low',
      status: 'todo',
      classification: 'mine',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'trust-task-message',
        sessionId: 'trust-task-session',
        timestamp: 1_800_000_000,
        sender: '可信测试',
        excerpt: '可信层级关键词 原始待办'
      }, {
        sourceId: 'documents',
        messageId: 'trust-task-document',
        sessionId: 'data-source:documents',
        timestamp: 1_800_000_001,
        sender: '本机文档',
        excerpt: '可信层级关键词 同一待办的文档依据'
      }]
    }])

    const confirmed = store.listScopedSearchDocumentIds({ trustStatuses: ['confirmed'] })
    const candidate = store.listScopedSearchDocumentIds({ trustStatuses: ['candidate'] })
    const source = store.listScopedSearchDocumentIds({ trustStatuses: ['source'] })
    const invalid = store.listScopedSearchDocumentIds({ trustStatuses: ['forged-status'] })
    const supporting = store.listScopedSearchDocumentIds({ supportability: 'supporting' })
    const reviewOnly = store.listScopedSearchDocumentIds({ supportability: 'review_only' })
    const invalidSupport = store.listScopedSearchDocumentIds({
      supportability: 'forged-supportability'
    })
    const contradictions = store.listScopedSearchDocumentIds({
      evidenceConflict: 'with_contradiction'
    })
    const noContradictions = store.listScopedSearchDocumentIds({
      evidenceConflict: 'without_contradiction'
    })
    const directEvidence = store.listScopedSearchDocumentIds({
      evidenceStrength: 'direct'
    })
    const indirectOnlyEvidence = store.listScopedSearchDocumentIds({
      evidenceStrength: 'indirect_only'
    })
    const multiSourceEvidence = store.listScopedSearchDocumentIds({
      evidenceBreadth: 'multi_source'
    })
    const singleSourceEvidence = store.listScopedSearchDocumentIds({
      evidenceBreadth: 'single_source'
    })
    const invalidConflict = store.listScopedSearchDocumentIds({
      evidenceConflict: 'forged-conflict'
    })
    assert.deepEqual([...confirmed!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-confirmed'
    ])
    assert.deepEqual([...candidate!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-candidate'
    ])
    assert.deepEqual([...source!].filter(id => id.includes('trust-facet')), [
      'entity:trust-facet-person',
      'task:trust-facet-task'
    ])
    assert.equal(invalid?.size, 0)
    assert.deepEqual([...supporting!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-confirmed',
      'task:trust-facet-task'
    ])
    assert.deepEqual([...reviewOnly!].filter(id => id.includes('trust-facet')), [
      'entity:trust-facet-person',
      'claim:trust-facet-candidate'
    ])
    assert.equal(invalidSupport?.size, 0)
    assert.deepEqual([...contradictions!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-confirmed'
    ])
    assert.deepEqual([...noContradictions!].filter(id => id.includes('trust-facet')), [
      'entity:trust-facet-person',
      'claim:trust-facet-candidate',
      'task:trust-facet-task'
    ])
    assert.deepEqual([...directEvidence!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-confirmed'
    ])
    assert.deepEqual([...indirectOnlyEvidence!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-candidate'
    ])
    assert.deepEqual([...multiSourceEvidence!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-confirmed',
      'task:trust-facet-task'
    ])
    assert.deepEqual([...singleSourceEvidence!].filter(id => id.includes('trust-facet')), [
      'claim:trust-facet-candidate'
    ])
    assert.equal(store.listScopedSearchDocumentIds({
      evidenceStrength: 'forged-strength'
    })?.size, 0)
    assert.equal(store.listScopedSearchDocumentIds({
      evidenceBreadth: 'forged-breadth'
    })?.size, 0)
    assert.equal(invalidConflict?.size, 0)
    assert.deepEqual(
      store.getSearchDocumentTrustCountsByKeyword('可信层级关键词', null),
      {
        counts: { candidate: 1, confirmed: 1, source: 1 },
        searchMode: 'fts'
      }
    )
    assert.deepEqual(
      store.getSearchDocumentSupportCountsByKeyword('可信层级关键词', null),
      {
        counts: { supporting: 2, review_only: 1 },
        searchMode: 'fts'
      }
    )
    const supportFacetScope = store.listScopedSearchDocumentIds({
      documentTypes: ['entity', 'claim', 'task']
    })!
    assert.deepEqual(store.getSearchDocumentSupportCountsInScope(supportFacetScope), {
      supporting: 2,
      review_only: 2
    })
    const wechatScope = store.listScopedSearchDocumentIds({ sourceIds: ['wechat'] })!
    const documentScope = store.listScopedSearchDocumentIds({ sourceIds: ['documents'] })!
    assert.equal(store.listSearchDocumentsByKeywordPage(
      '可信层级关键词', wechatScope, { limit: 1 }
    ).total, 3)
    assert.equal(store.listSearchDocumentsByKeywordPage(
      '可信层级关键词', documentScope, { limit: 1 }
    ).total, 1)
    assert.equal(wechatScope.has('task:trust-facet-task'), true)
    assert.equal(documentScope.has('task:trust-facet-task'), true)
    const calendarSupporting = store.listScopedSearchDocumentIds({
      sourceIds: ['calendar'],
      supportability: 'supporting'
    })!
    const calendarReviewOnly = store.listScopedSearchDocumentIds({
      sourceIds: ['calendar'],
      supportability: 'review_only'
    })!
    assert.equal(calendarSupporting.has('claim:trust-facet-confirmed'), false)
    assert.equal(calendarReviewOnly.has('claim:trust-facet-confirmed'), true)
    const wechatContradictions = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceConflict: 'with_contradiction'
    })!
    const calendarContradictions = store.listScopedSearchDocumentIds({
      sourceIds: ['calendar'],
      evidenceConflict: 'with_contradiction'
    })!
    const wechatWithoutContradictions = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceConflict: 'without_contradiction'
    })!
    const calendarWithoutContradictions = store.listScopedSearchDocumentIds({
      sourceIds: ['calendar'],
      evidenceConflict: 'without_contradiction'
    })!
    const wechatDirect = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceStrength: 'direct'
    })!
    const wechatIndirectOnly = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceStrength: 'indirect_only'
    })!
    const mailDirect = store.listScopedSearchDocumentIds({
      sourceIds: ['mail'],
      evidenceStrength: 'direct'
    })!
    const mailIndirectOnly = store.listScopedSearchDocumentIds({
      sourceIds: ['mail'],
      evidenceStrength: 'indirect_only'
    })!
    const wechatMultiSource = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceBreadth: 'multi_source'
    })!
    const wechatSingleSource = store.listScopedSearchDocumentIds({
      sourceIds: ['wechat'],
      evidenceBreadth: 'single_source'
    })!
    assert.equal(wechatContradictions.has('claim:trust-facet-confirmed'), false)
    assert.equal(calendarContradictions.has('claim:trust-facet-confirmed'), true)
    assert.equal(wechatWithoutContradictions.has('claim:trust-facet-confirmed'), true)
    assert.equal(calendarWithoutContradictions.has('claim:trust-facet-confirmed'), false)
    assert.equal(wechatDirect.has('claim:trust-facet-confirmed'), true)
    assert.equal(wechatIndirectOnly.has('claim:trust-facet-confirmed'), false)
    assert.equal(mailDirect.has('claim:trust-facet-confirmed'), false)
    assert.equal(mailIndirectOnly.has('claim:trust-facet-confirmed'), true)
    assert.equal(wechatMultiSource.has('claim:trust-facet-confirmed'), false)
    assert.equal(wechatSingleSource.has('claim:trust-facet-confirmed'), true)
    const futureSupporting = store.listScopedSearchDocumentIds({
      from: '2027-01-01',
      to: '2027-12-31',
      supportability: 'supporting'
    })!
    const futureReviewOnly = store.listScopedSearchDocumentIds({
      from: '2027-01-01',
      to: '2027-12-31',
      supportability: 'review_only'
    })!
    assert.equal(futureSupporting.has('claim:trust-facet-confirmed'), false)
    assert.equal(futureReviewOnly.has('claim:trust-facet-confirmed'), true)
    assert.equal(store.listScopedSearchDocumentIds({
      from: '2027-01-01',
      to: '2027-12-31',
      evidenceConflict: 'with_contradiction'
    })!.has('claim:trust-facet-confirmed'), true)
    assert.deepEqual(
      store.getSearchDocumentSupportCountsByKeyword(
        '可信层级关键词',
        store.listScopedSearchDocumentIds({ sourceIds: ['calendar'] }),
        { sourceIds: ['calendar'] }
      ),
      {
        counts: { supporting: 0, review_only: 1 },
        searchMode: 'fts'
      }
    )
    assert.deepEqual(
      store.getSearchDocumentContradictionCountByKeyword(
        '可信层级关键词',
        store.listScopedSearchDocumentIds({ sourceIds: ['wechat'] }),
        { sourceIds: ['wechat'] }
      ),
      { count: 0, searchMode: 'fts' }
    )
    assert.deepEqual(
      store.getSearchDocumentContradictionCountByKeyword(
        '可信层级关键词',
        store.listScopedSearchDocumentIds({ sourceIds: ['calendar'] }),
        { sourceIds: ['calendar'] }
      ),
      { count: 1, searchMode: 'fts' }
    )
    assert.equal(
      store.getSearchDocumentContradictionCountInScope(
        store.listScopedSearchDocumentIds({ sourceIds: ['calendar'] })!,
        { sourceIds: ['calendar'] }
      ),
      1
    )
  }))

test('evidence review preset scopes count exact combinations before paging', () =>
  withStore(store => {
    store.syncGraph({
      entities: [{
        id: 'preset-count-person',
        type: 'person',
        canonicalName: '组合计数人物',
        summary: '',
        confidence: 1,
        trustStatus: 'confirmed',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: []
    } as any)
    const evidenceRow = (
      messageId: string,
      sourceId: string,
      role: 'direct' | 'indirect' | 'contradiction'
    ) => ({
      sourceId,
      messageId,
      sessionId: sourceId === 'wechat' ? 'preset-session' : `data-source:${sourceId}`,
      timestamp: 1_800_100_000,
      excerpt: `组合计数关键词 ${messageId}`,
      role
    })
    store.upsertClaims([{
      id: 'preset-conservative',
      subjectId: 'preset-count-person',
      predicate: '负责',
      objectValue: '多源可信',
      confidence: 0.95,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '组合计数关键词 多源直接支持',
      evidence: [
        evidenceRow('preset-direct-wechat', 'wechat', 'direct'),
        evidenceRow('preset-direct-document', 'documents', 'direct')
      ]
    }, {
      id: 'preset-conflict',
      subjectId: 'preset-count-person',
      predicate: '所在地',
      objectValue: '出现反证',
      confidence: 0.85,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '组合计数关键词 已确认但含反证',
      evidence: [
        evidenceRow('preset-conflict-direct', 'wechat', 'direct'),
        evidenceRow('preset-conflict-contradiction', 'documents', 'contradiction')
      ]
    }, {
      id: 'preset-fragile',
      subjectId: 'preset-count-person',
      predicate: '可能参与',
      objectValue: '单源候选',
      confidence: 0.65,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '组合计数关键词 单源间接候选',
      evidence: [evidenceRow('preset-indirect-wechat', 'wechat', 'indirect')]
    }, {
      id: 'preset-distractor',
      subjectId: 'preset-count-person',
      predicate: '可能参与',
      objectValue: '多源候选',
      confidence: 0.65,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '组合计数关键词 多源间接候选',
      evidence: [
        evidenceRow('preset-indirect-document', 'documents', 'indirect'),
        evidenceRow('preset-indirect-mail', 'mail', 'indirect')
      ]
    }])
    store.syncTasks([{
      id: 'preset-task',
      title: '组合计数关键词 原始任务',
      detail: '',
      priority: 'low',
      status: 'todo',
      classification: 'mine',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'preset-task-message',
        sessionId: 'preset-session',
        timestamp: 1_800_100_000,
        sender: '测试',
        excerpt: '组合计数关键词 原始任务'
      }]
    }])

    const baseScope = {
      documentTypes: ['claim'],
      trustStatuses: ['source'],
      evidenceConflict: 'with_contradiction'
    }
    const conservativeIds = store.listScopedSearchDocumentIds(
      memorySearchReviewPresetOptions(baseScope, 'conservative_support') as any
    )!
    const fragileIds = store.listScopedSearchDocumentIds(
      memorySearchReviewPresetOptions(baseScope, 'fragile_candidate') as any
    )!
    const conflictIds = store.listScopedSearchDocumentIds(
      memorySearchReviewPresetOptions(baseScope, 'confirmed_conflict') as any
    )!

    assert.deepEqual(
      [...conservativeIds].filter(id => id.includes('preset-')),
      ['claim:preset-conservative']
    )
    assert.deepEqual(
      [...fragileIds].filter(id => id.includes('preset-')),
      ['claim:preset-fragile']
    )
    assert.deepEqual(
      [...conflictIds].filter(id => id.includes('preset-')),
      ['claim:preset-conflict']
    )
    assert.equal(conservativeIds.has('claim:preset-conflict'), false)
    assert.equal(
      store.listSearchDocumentsByKeywordPage(
        '组合计数关键词',
        conservativeIds,
        { offset: 0, limit: 1 }
      ).total,
      1
    )
    assert.equal(
      store.listSearchDocumentsByKeywordPage(
        '组合计数关键词',
        fragileIds,
        { offset: 0, limit: 1 }
      ).total,
      1
    )
    assert.equal(
      store.listSearchDocumentsByKeywordPage(
        '组合计数关键词',
        conflictIds,
        { offset: 0, limit: 1 }
      ).total,
      1
    )
    assert.deepEqual(store.getMemoryStats().reviewInbox, {
      candidateClaims: 2,
      candidateEvents: 0,
      confirmedConflicts: 1,
      graphPending: 0
    })
  }))

test('memory search revision covers documents, evidence, vectors and relevance decisions', () =>
  withStore(store => {
    const revisions: number[] = [Number(store.getMemorySearchRevision())]
    store.upsertResources([{
      id: 'revision-resource',
      resourceType: 'document',
      title: '版本门禁资料',
      content: '用于验证统一检索分页版本',
      metadata: { sourceId: 'documents' },
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      evidence: [{
        sourceId: 'documents',
        sessionId: 'data-source:documents:revision',
        messageId: 'revision-message',
        timestamp: 1_775_000_000,
        sender: '文档',
        excerpt: '统一检索分页版本'
      }]
    }])
    revisions.push(Number(store.getMemorySearchRevision()))
    store.saveEmbedding('resource:revision-resource', 'revision-model:2d', [1, 0])
    revisions.push(Number(store.getMemorySearchRevision()))
    const context = buildMemorySearchFeedbackContext('分页版本', { sourceIds: ['documents'] })
    store.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'resource:revision-resource',
      action: 'helpful'
    })
    revisions.push(Number(store.getMemorySearchRevision()))
    const beforeRead = store.getMemorySearchRevision()
    store.searchText('分页版本', 10)
    assert.equal(store.getMemorySearchRevision(), beforeRead)
    assert.ok(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]))
  }))

test('memory search revision trigger definitions are audited live and repaired selectively on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-search-revision-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initialHealth = first.getMemorySearchRevisionHealth()
    assert.equal(initialHealth.version, 'memory-search-revision-v3')
    assert.equal(initialHealth.revision, first.getMemorySearchRevision())
    assert.equal(initialHealth.expectedTriggers, 24)
    assert.equal(initialHealth.installedTriggers, 24)
    assert.equal(initialHealth.validTriggers, 24)
    assert.equal(initialHealth.healthy, true)
    ;(first as any).db.exec(`
      DROP TRIGGER trg_memory_search_revision_search_documents_insert;
      CREATE TRIGGER trg_memory_search_revision_search_documents_insert
      AFTER INSERT ON search_documents BEGIN SELECT 1; END;
      CREATE TRIGGER trg_memory_search_revision_unexpected
      AFTER INSERT ON search_documents BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getMemorySearchRevisionHealth()
    assert.equal(driftedHealth.installedTriggers, 24)
    assert.equal(driftedHealth.validTriggers, 23)
    assert.deepEqual(driftedHealth.unhealthyTriggers, [
      'trg_memory_search_revision_search_documents_insert'
    ])
    assert.deepEqual(driftedHealth.unexpectedTriggers, [
      'trg_memory_search_revision_unexpected'
    ])
    assert.equal(driftedHealth.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getMemorySearchRevisionHealth()
    assert.equal(repairedHealth.installedTriggers, 24)
    assert.equal(repairedHealth.validTriggers, 24)
    assert.equal(repairedHealth.repairedThisStart, true)
    assert.equal(repairedHealth.repairedTriggersThisStart, 2)
    assert.deepEqual(repairedHealth.unhealthyTriggers, [])
    assert.deepEqual(repairedHealth.unexpectedTriggers, [])
    assert.equal(repairedHealth.healthy, true)
    const beforeInsert = Number(reopened.getMemorySearchRevision())
    reopened.upsertResources([{
      id: 'revision-definition-proof',
      resourceType: 'document',
      title: '定义恢复证明',
      content: '重启自愈后插入必须继续推进检索 revision',
      metadata: { sourceId: 'documents' },
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z'
    }])
    assert.ok(Number(reopened.getMemorySearchRevision()) > beforeInsert)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('search feedback archive revision advances and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-search-feedback-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'feedback-revision-person',
        type: 'person',
        canonicalName: '反馈版本人物',
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    } as any)
    const initial = Number(first.getMemorySearchFeedbackArchiveRevision())
    const context = buildMemorySearchFeedbackContext('反馈档案版本', {})
    first.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: 'entity:feedback-revision-person',
      action: 'helpful'
    })
    assert.ok(Number(first.getMemorySearchFeedbackArchiveRevision()) > initial)
    const feedbackRevisionHealth = first.getMemorySearchFeedbackArchiveRevisionHealth()
    assert.equal(feedbackRevisionHealth.version, 'memory-search-feedback-archive-revision-v2')
    assert.equal(feedbackRevisionHealth.expectedTriggers, 3)
    assert.equal(feedbackRevisionHealth.validTriggers, 3)
    assert.equal(feedbackRevisionHealth.healthy, true)
    ;(first as any).db.exec(
      'DROP TRIGGER trg_memory_search_feedback_archive_revision_update'
    )
    assert.equal(first.getMemorySearchFeedbackArchiveRevisionHealth().installedTriggers, 2)
    assert.equal(first.getMemorySearchFeedbackArchiveRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getMemorySearchFeedbackArchiveRevisionHealth().installedTriggers, 3)
    assert.equal(reopened.getMemorySearchFeedbackArchiveRevisionHealth().healthy, true)
    assert.equal(reopened.getMemorySearchFeedbackArchive({}).total, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('complete evidence archive revision covers every authoritative evidence store and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const database = (first as any).db
    const now = '2026-08-03T00:00:00.000Z'
    let previous = Number(first.getMemoryEvidenceArchiveRevision())
    const expectAdvanced = () => {
      const current = Number(first.getMemoryEvidenceArchiveRevision())
      assert.ok(current > previous)
      previous = current
    }
    database.prepare(`
      INSERT INTO search_documents(
        id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'resource:evidence-revision',
      'resource',
      'evidence-revision',
      '证据版本资料',
      '证据版本正文',
      '{}',
      'a'.repeat(64),
      now
    )
    assert.equal(Number(first.getMemoryEvidenceArchiveRevision()), previous)
    database.prepare(`
      INSERT INTO search_document_evidence(
        document_id,source_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'resource:evidence-revision',
      'documents',
      'generic-evidence-message',
      'generic-evidence-session',
      1_754_000_000,
      '通用发送者',
      '通用原文'
    )
    expectAdvanced()
    database.prepare(`
      UPDATE search_document_evidence SET sender=? WHERE document_id=?
    `).run('修复后的发送者', 'resource:evidence-revision')
    expectAdvanced()
    database.prepare(`
      INSERT INTO evidence(
        claim_id,relation_id,event_id,source_id,message_id,session_id,
        timestamp,sender,excerpt,evidence_role
      ) VALUES(NULL,NULL,NULL,?,?,?,?,?,?,?)
    `).run(
      'wechat',
      'structured-evidence-message',
      'structured-evidence-session',
      1_754_000_001,
      '结构化发送者',
      '结构化原文',
      'support'
    )
    expectAdvanced()
    database.prepare(`
      UPDATE evidence SET evidence_role='contradiction' WHERE message_id=?
    `).run('structured-evidence-message')
    expectAdvanced()
    database.prepare('DELETE FROM search_document_evidence WHERE document_id=?')
      .run('resource:evidence-revision')
    expectAdvanced()
    database.prepare('DELETE FROM evidence WHERE message_id=?')
      .run('structured-evidence-message')
    expectAdvanced()
    database.prepare(`
      INSERT INTO entities(
        id,type,canonical_name,created_at,updated_at,trust_status,summary_status
      ) VALUES(?,?,?,?,?,'confirmed','empty')
    `).run(
      'evidence-revision-entity',
      'person',
      '原文版本人物',
      '2026-08-05T00:00:00.000Z',
      '2026-08-05T00:00:00.000Z'
    )
    database.prepare(`
      INSERT INTO entity_evidence(
        entity_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_kind
      ) VALUES(?,?,?,?,?,?,?,'identity_anchor')
    `).run(
      'evidence-revision-entity',
      'wechat',
      'entity-evidence-revision-message',
      'entity-evidence-revision-session',
      1_754_000_002,
      '身份发送者',
      '身份原文'
    )
    expectAdvanced()
    database.prepare(`
      UPDATE entity_evidence SET excerpt='身份原文已核验'
      WHERE message_id='entity-evidence-revision-message'
    `).run()
    expectAdvanced()
    database.prepare(`
      DELETE FROM entity_evidence
      WHERE message_id='entity-evidence-revision-message'
    `).run()
    expectAdvanced()
    const evidenceRevisionHealth = first.getMemoryEvidenceArchiveRevisionHealth()
    assert.equal(evidenceRevisionHealth.version, 'memory-evidence-archive-revision-v3')
    assert.equal(evidenceRevisionHealth.expectedTriggers, 9)
    assert.equal(evidenceRevisionHealth.validTriggers, 9)
    assert.equal(evidenceRevisionHealth.healthy, true)
    database.exec(
      'DROP TRIGGER trg_memory_evidence_archive_revision_evidence_update'
    )
    assert.equal(first.getMemoryEvidenceArchiveRevisionHealth().installedTriggers, 8)
    assert.equal(first.getMemoryEvidenceArchiveRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getMemoryEvidenceArchiveRevisionHealth().installedTriggers, 9)
    assert.equal(reopened.getMemoryEvidenceArchiveRevisionHealth().healthy, true)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured memory revision covers review payloads and repairs its trigger set on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-structured-revision-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getStructuredMemoryRevision())
    first.syncGraph({
      entities: [{
        id: 'revision-person',
        type: 'person',
        canonicalName: '版本人物',
        trustStatus: 'confirmed',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: []
    } as any)
    first.upsertClaims([{
      id: 'structured-revision-claim',
      subjectId: 'revision-person',
      predicate: '负责',
      objectValue: '分页保护',
      confidence: 0.8,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '版本人物负责分页保护',
      evidence: [{
        sourceId: 'wechat',
        sessionId: 'revision-session',
        messageId: 'revision-message',
        timestamp: 1_775_000_000,
        excerpt: '负责分页保护'
      }]
    }])
    assert.ok(Number(first.getStructuredMemoryRevision()) > initial)
    const visibleRevision = first.getStructuredMemoryRevision()
    const entityDossierPage = first.listClaimArchive({
      entityId: 'revision-person',
      status: 'candidate',
      limit: 40
    })
    assert.equal(entityDossierPage.revision, visibleRevision)
    assert.deepEqual(entityDossierPage.items.map(item => item.id), [
      'structured-revision-claim'
    ])
    assert.doesNotThrow(() =>
      assertStructuredMemoryMutationRevision(visibleRevision, first.getStructuredMemoryRevision()))
    first.updateMemoryItemStatus('claim', 'structured-revision-claim', 'confirmed')
    assert.throws(
      () => assertStructuredMemoryMutationRevision(visibleRevision, first.getStructuredMemoryRevision()),
      /事实与事件档案在展示后发生了变化/
    )
    assert.equal(first.listClaimArchive({
      entityId: 'revision-person',
      offset: 1,
      limit: 40,
      revision: entityDossierPage.revision
    }).stale, true)
    const initialHealth = first.getStructuredMemoryRevisionHealth()
    assert.equal(initialHealth.version, 'structured-memory-revision-v2')
    assert.equal(initialHealth.expectedTriggers, 24)
    assert.equal(initialHealth.validTriggers, 24)
    assert.equal(initialHealth.healthy, true)
    ;(first as any).db.exec(`
      DROP TRIGGER trg_structured_memory_revision_claims_insert;
      CREATE TRIGGER trg_structured_memory_revision_claims_insert
      AFTER INSERT ON claims BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getStructuredMemoryRevisionHealth()
    assert.equal(driftedHealth.installedTriggers, 24)
    assert.equal(driftedHealth.validTriggers, 23)
    assert.equal(driftedHealth.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getStructuredMemoryRevisionHealth()
    assert.equal(repairedHealth.validTriggers, 24)
    assert.equal(repairedHealth.repairedTriggersThisStart, 1)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(reopened.getGraphReviewRevisionHealth().repairedThisStart, false)
    assert.equal(reopened.getTaskOwnershipReviewRevisionHealth().repairedThisStart, false)
    assert.equal(reopened.getAssistantHistoryRevisionHealth().repairedThisStart, false)
    const beforeProofInsert = Number(reopened.getStructuredMemoryRevision())
    reopened.upsertClaims([{
      id: 'structured-revision-repair-proof',
      subjectId: 'revision-person',
      predicate: '验证',
      objectValue: '触发器修复后继续推进',
      confidence: 0.9,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '触发器修复后继续推进',
      evidence: [{
        sourceId: 'wechat',
        sessionId: 'revision-session',
        messageId: 'revision-repair-proof-message',
        timestamp: 1_775_000_001,
        excerpt: '触发器修复后继续推进'
      }]
    }])
    assert.ok(Number(reopened.getStructuredMemoryRevision()) > beforeProofInsert)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reversible graph mutation restores memory and persists the restored snapshot on failure', () => {
  let graph = { status: 'candidate', revision: 1 }
  let persisted: any = null
  assert.throws(() => runReversibleGraphMutation({
    snapshot: structuredClone(graph),
    transact: apply => apply(),
    apply: () => {
      graph.status = 'confirmed'
      graph.revision = 2
      throw new Error('injected graph commit failure')
    },
    restore: snapshot => { graph = snapshot },
    persistRestored: () => { persisted = structuredClone(graph) }
  }), /injected graph commit failure/)
  assert.deepEqual(graph, { status: 'candidate', revision: 1 })
  assert.deepEqual(persisted, graph)
})

test('nested graph sync rolls review and correction side effects back together', () => withStore(store => {
  const entities = [
    {
      id: 'atomic-review-left',
      type: 'person',
      canonicalName: '原子审阅甲',
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    },
    {
      id: 'atomic-review-right',
      type: 'person',
      canonicalName: '原子审阅乙',
      summary: '',
      confidence: 1,
      trustStatus: 'confirmed',
      aliases: [],
      accountIds: []
    }
  ]
  const relation = {
    id: 'atomic-review-relation',
    subjectId: 'atomic-review-left',
    predicate: '认识',
    objectId: 'atomic-review-right',
    confidence: 0.8,
    status: 'candidate',
    evidence: [],
    createdAt: '2026-08-05T04:00:00.000Z',
    updatedAt: '2026-08-05T04:00:00.000Z'
  }
  const review = {
    id: 'atomic-review-entry',
    kind: 'relation',
    title: '原子审阅甲 — 认识 → 原子审阅乙',
    detail: '等待确认',
    confidence: 0.8,
    status: 'pending',
    relationId: relation.id,
    createdAt: '2026-08-05T04:00:00.000Z'
  }
  store.syncGraph({ entities, relations: [relation], reviewQueue: [review] } as any)
  assert.throws(() => store.runInTransaction(() => {
    store.recordRelationCorrection(review.id, relation as any, {
      ...relation,
      predicate: '同事',
      status: 'confirmed'
    } as any)
    store.syncGraph({
      entities,
      relations: [{ ...relation, predicate: '同事', status: 'confirmed' }],
      reviewQueue: [{ ...review, status: 'confirmed', resolvedAt: '2026-08-05T04:01:00.000Z' }]
    } as any)
    throw new Error('injected outer transaction failure')
  }), /injected outer transaction failure/)

  const snapshot = store.loadGraphSnapshot()
  assert.equal(snapshot.relations[0].predicate, '认识')
  assert.equal(snapshot.relations[0].status, 'candidate')
  assert.equal(snapshot.reviewQueue[0].status, 'pending')
  assert.equal(Number((store as any).db.prepare(
    `SELECT COUNT(*) AS count FROM relation_corrections WHERE review_id=?`
  ).get(review.id).count), 0)
}))

test('graph review revision covers queue and enriched graph state and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-graph-review-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getGraphReviewRevision())
    const graph = {
      entities: [{
        id: 'review-revision-person',
        type: 'person',
        canonicalName: '审阅版本人物',
        trustStatus: 'candidate',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: [{
        id: 'review-revision-candidate',
        kind: 'entity_creation',
        title: '审阅版本候选',
        detail: '等待确认',
        confidence: 0.8,
        status: 'pending',
        createdAt: '2026-08-03T00:00:00.000Z'
      }]
    } as any
    first.syncGraph(graph)
    assert.ok(Number(first.getGraphReviewRevision()) > initial)
    const visibleRevision = first.listReviewLedgerPage({ status: 'pending' }).revision
    assert.doesNotThrow(() => assertGraphReviewMutationRevision(
      visibleRevision,
      first.getGraphReviewRevision()
    ))
    graph.reviewQueue[0].detail = '后台补充了新的候选原文'
    first.syncGraph(graph)
    assert.throws(() => assertGraphReviewMutationRevision(
      visibleRevision,
      first.getGraphReviewRevision()
    ), /刷新后重新确认/)
    const initialHealth = first.getGraphReviewRevisionHealth()
    assert.equal(initialHealth.version, 'graph-review-revision-v3')
    assert.equal(initialHealth.expectedTriggers, 24)
    assert.equal(initialHealth.validTriggers, 24)
    assert.equal(initialHealth.healthy, true)
    ;(first as any).db.exec(`
      DROP TRIGGER trg_graph_review_revision_review_queue_insert;
      CREATE TRIGGER trg_graph_review_revision_review_queue_insert
      AFTER INSERT ON review_queue BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getGraphReviewRevisionHealth()
    assert.equal(driftedHealth.installedTriggers, 24)
    assert.equal(driftedHealth.validTriggers, 23)
    assert.equal(driftedHealth.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getGraphReviewRevisionHealth()
    assert.equal(repairedHealth.validTriggers, 24)
    assert.equal(repairedHealth.repairedTriggersThisStart, 1)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(reopened.listReviewLedgerPage({ status: 'pending' }).items[0]?.id, 'review-revision-candidate')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('task archive revision covers directory evidence and history and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getTaskArchiveRevision())
    const task = {
      id: 'task-archive-revision',
      title: '验证任务档案版本',
      detail: '任务目录和证据共同推进版本',
      priority: 'high',
      confidence: 1,
      classification: 'mine',
      status: 'done',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T01:00:00.000Z',
      evidence: [{
        sourceId: 'wechat',
        sessionId: 'task-revision-session',
        messageId: 'task-revision-message',
        timestamp: 1_775_000_000,
        excerpt: '完成任务档案版本验证'
      }]
    }
    first.syncTasks([task])
    const afterDirectoryAndEvidence = Number(first.getTaskArchiveRevision())
    assert.ok(afterDirectoryAndEvidence > initial)
    first.recordTaskChanges(task.id, { status: 'doing' }, { status: 'done' }, 'revision-test', task.evidence)
    assert.ok(Number(first.getTaskArchiveRevision()) > afterDirectoryAndEvidence)
    const taskArchiveRevisionHealth = first.getTaskArchiveRevisionHealth()
    assert.equal(taskArchiveRevisionHealth.version, 'task-archive-revision-v3')
    assert.equal(taskArchiveRevisionHealth.expectedTriggers, 12)
    assert.equal(taskArchiveRevisionHealth.validTriggers, 12)
    assert.equal(taskArchiveRevisionHealth.healthy, true)
    ;(first as any).db.exec('DROP TRIGGER trg_task_archive_revision_task_directory_insert')
    assert.equal(first.getTaskArchiveRevisionHealth().installedTriggers, 11)
    assert.equal(first.getTaskArchiveRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getTaskArchiveRevisionHealth().installedTriggers, 12)
    assert.equal(reopened.getTaskArchiveRevisionHealth().healthy, true)
    assert.equal(reopened.listTaskArchive().items[0]?.id, task.id)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('task ownership review revision covers queue decisions and action history and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-ownership-review-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getTaskOwnershipReviewRevision())
    first.syncTasks([{
      id: 'task-ownership-review-revision',
      title: '验证任务归属审阅版本',
      detail: '待确认队列、决定和撤销记录共同推进版本',
      priority: 'high',
      confidence: 0.7,
      classification: 'uncertain',
      status: 'todo',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T01:00:00.000Z',
      evidence: evidence('task-ownership-review-revision-message', '这件事可能需要你处理')
    }])
    const afterQueue = Number(first.getTaskOwnershipReviewRevision())
    assert.ok(afterQueue > initial)
    const visibleRevision = first.listTaskOwnershipReviews().revision
    assert.doesNotThrow(() => assertTaskOwnershipMutationRevision(
      visibleRevision,
      first.getTaskOwnershipReviewRevision()
    ))
    first.syncTasks([{
      id: 'task-ownership-review-revision',
      title: '验证任务归属审阅版本',
      detail: '后台补充了新的归属证据',
      priority: 'high',
      confidence: 0.8,
      classification: 'uncertain',
      status: 'todo',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T01:30:00.000Z',
      evidence: [
        ...evidence('task-ownership-review-revision-message', '这件事可能需要你处理'),
        ...evidence('task-ownership-review-revision-message-2', '补充的任务归属上下文')
      ]
    }])
    assert.throws(() => assertTaskOwnershipMutationRevision(
      visibleRevision,
      first.getTaskOwnershipReviewRevision()
    ), /刷新后重新确认/)
    first.recordTaskReviewDecision({
      evidenceFingerprint: 'task-ownership-review-revision-fingerprint',
      taskId: 'task-ownership-review-revision',
      decision: 'mine',
      title: '验证任务归属审阅版本',
      source: '版本验证群',
      evidence: evidence('task-ownership-review-revision-message', '这件事可能需要你处理'),
      task: { id: 'task-ownership-review-revision', title: '验证任务归属审阅版本' }
    })
    const afterDecision = Number(first.getTaskOwnershipReviewRevision())
    assert.ok(afterDecision > afterQueue)
    first.revokeTaskReviewDecision('task-ownership-review-revision-fingerprint')
    assert.ok(Number(first.getTaskOwnershipReviewRevision()) > afterDecision)
    const initialHealth = first.getTaskOwnershipReviewRevisionHealth()
    assert.equal(initialHealth.version, 'task-ownership-review-revision-v3')
    assert.equal(initialHealth.expectedTriggers, 18)
    assert.equal(initialHealth.validTriggers, 18)
    assert.equal(initialHealth.healthy, true)
    ;(first as any).db.exec(`
      DROP TRIGGER trg_task_ownership_review_revision_task_review_decisions_insert;
      CREATE TRIGGER trg_task_ownership_review_revision_task_review_decisions_insert
      AFTER INSERT ON task_review_decisions BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getTaskOwnershipReviewRevisionHealth()
    assert.equal(driftedHealth.installedTriggers, 18)
    assert.equal(driftedHealth.validTriggers, 17)
    assert.equal(driftedHealth.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getTaskOwnershipReviewRevisionHealth()
    assert.equal(repairedHealth.validTriggers, 18)
    assert.equal(repairedHealth.repairedTriggersThisStart, 1)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(reopened.listTaskOwnershipReviews().items[0]?.id, 'task-ownership-review-revision')
    assert.equal(
      reopened.listTaskReviewDecisionPage().items[0]?.evidence_fingerprint,
      'task-ownership-review-revision-fingerprint'
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('identity merge archive revision covers merge revert and deletion and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-identity-merge-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    first.syncGraph({
      entities: [],
      relations: [],
      reviewQueue: [{
        id: 'merge-revert-review',
        kind: 'possible_duplicate',
        title: '撤销合并重启核验',
        detail: '已确认合并',
        confidence: 0.9,
        status: 'confirmed',
        mergeSourceEntityId: 'merge-revision-source-1',
        mergeTargetEntityId: 'merge-revision-target-1'
      }]
    } as any)
    assert.equal(
      first.listGraphReviewsByIds(['merge-revert-review'])[0]?.mergeTargetEntityId,
      'merge-revision-target-1'
    )
    const initial = Number(first.getIdentityMergeArchiveRevision())
    const firstMergeId = first.recordMerge('merge-revision-source-1', 'merge-revision-target-1', {
      source: { id: 'merge-revision-source-1', canonicalName: '合并版本来源一' },
      target: { id: 'merge-revision-target-1', canonicalName: '合并版本保留一' },
      relations: []
    })
    const afterInsert = Number(first.getIdentityMergeArchiveRevision())
    assert.ok(afterInsert > initial)
    first.markMergeReverted(firstMergeId)
    const afterRevert = Number(first.getIdentityMergeArchiveRevision())
    assert.ok(afterRevert > afterInsert)
    const secondMergeId = first.recordMerge('merge-revision-source-2', 'merge-revision-target-2', {
      source: { id: 'merge-revision-source-2', canonicalName: '合并版本来源二' },
      target: { id: 'merge-revision-target-2', canonicalName: '合并版本保留二' },
      relations: []
    })
    ;(first as any).db.prepare('DELETE FROM merge_history WHERE id=?').run(secondMergeId)
    assert.ok(Number(first.getIdentityMergeArchiveRevision()) > afterRevert)
    const identityRevisionHealth = first.getIdentityMergeArchiveRevisionHealth()
    assert.equal(identityRevisionHealth.version, 'identity-merge-archive-revision-v2')
    assert.equal(identityRevisionHealth.expectedTriggers, 3)
    assert.equal(identityRevisionHealth.validTriggers, 3)
    assert.equal(identityRevisionHealth.healthy, true)
    ;(first as any).db.exec(
      'DROP TRIGGER trg_identity_merge_archive_revision_merge_history_update'
    )
    assert.equal(first.getIdentityMergeArchiveRevisionHealth().installedTriggers, 2)
    assert.equal(first.getIdentityMergeArchiveRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(
      reopened.listGraphReviewsByIds(['merge-revert-review'])[0]?.status,
      'confirmed'
    )
    assert.equal(reopened.getIdentityMergeArchiveRevisionHealth().installedTriggers, 3)
    assert.equal(reopened.getIdentityMergeArchiveRevisionHealth().healthy, true)
    const page = reopened.listMergeHistoryPage()
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.id, firstMergeId)
    assert.equal(page.items[0]?.canRevert, false)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('identity merge revert commits graph, decision and archive atomically', () => {
  withStore(store => {
    const mergedGraph = {
      entities: [{
        id: 'merge-atomic-target',
        type: 'person',
        canonicalName: '合并后身份',
        aliases: ['原身份'],
        accountIds: [],
        externalIdentities: [],
        evidenceMessageIds: [],
        summary: '',
        summaryStatus: 'empty',
        confidence: 1,
        identityVersion: 2,
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    }
    store.syncGraph(mergedGraph as any, 'merge-atomic-before')
    const snapshot = {
      source: {
        ...mergedGraph.entities[0],
        id: 'merge-atomic-source',
        canonicalName: '原身份',
        aliases: [],
        identityVersion: 1
      },
      target: {
        ...mergedGraph.entities[0],
        canonicalName: '保留身份',
        aliases: [],
        identityVersion: 1
      },
      relations: [],
      sourceEventParticipants: [],
      targetEventParticipants: [],
      affectedReviews: []
    }
    const mergeId = store.recordMerge(
      snapshot.source.id,
      snapshot.target.id,
      snapshot
    )
    store.recordIdentityDecision(
      snapshot.source.id,
      snapshot.target.id,
      'merged',
      1,
      1,
      '原子撤销测试'
    )
    const restoredGraph = {
      entities: [snapshot.source, snapshot.target],
      relations: [],
      reviewQueue: []
    }
    assert.throws(() => store.syncGraph(restoredGraph as any, 'merge-atomic-invalid', {
      identityMergeRevert: {
        mergeId: mergeId + 999,
        sourceId: snapshot.source.id,
        targetId: snapshot.target.id,
        sourceParticipants: [],
        targetParticipants: []
      }
    }), /撤销档案已经变化/)
    assert.deepEqual(
      store.loadGraphSnapshot().entities.map(entity => entity.id),
      ['merge-atomic-target']
    )
    assert.equal(store.getMergeSnapshot(mergeId)?.source?.id, snapshot.source.id)
    assert.equal(
      store.getIdentityDecision(snapshot.source.id, snapshot.target.id)?.decision,
      'merged'
    )

    store.syncGraph(restoredGraph as any, 'merge-atomic-after', {
      identityMergeRevert: {
        mergeId,
        sourceId: snapshot.source.id,
        targetId: snapshot.target.id,
        sourceParticipants: [],
        targetParticipants: []
      }
    })
    assert.deepEqual(
      store.loadGraphSnapshot().entities.map(entity => entity.id).sort(),
      ['merge-atomic-source', 'merge-atomic-target']
    )
    assert.equal(store.getMergeSnapshot(mergeId), null)
    assert.equal(store.getIdentityDecision(snapshot.source.id, snapshot.target.id), null)
  })
})

test('ingestion archive revision covers run and batch lifecycle and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-ingestion-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getIngestionArchiveRevision())
    first.startIngestionRun(
      'ingestion-revision-run',
      'deepseek-test',
      'prompt-test',
      { trigger: 'backlog', backlogBeforeCount: 7 }
    )
    const afterRun = Number(first.getIngestionArchiveRevision())
    assert.ok(afterRun > initial)
    first.recordIngestionBatch(
      'ingestion-revision-run',
      0,
      12,
      'running',
      '',
      { model: 'deepseek-test', promptVersion: 'prompt-test', schemaVersion: 'schema-test' }
    )
    const afterBatch = Number(first.getIngestionArchiveRevision())
    assert.ok(afterBatch > afterRun)
    first.recordIngestionBatch(
      'ingestion-revision-run',
      0,
      12,
      'completed',
      '',
      {
        model: 'deepseek-test',
        promptVersion: 'prompt-test',
        schemaVersion: 'schema-test',
        inputTokens: 120,
        outputTokens: 30,
        durationMs: 500
      }
    )
    first.finishIngestionRun('ingestion-revision-run', {
      messageCount: 12,
      entityCount: 2,
      relationCount: 1,
      status: 'partial',
      backlogAfterCount: 3,
      backlogOutcome: 'progressed',
      backlogNextAttemptAt: '2026-08-06T05:15:00.000Z'
    })
    assert.ok(Number(first.getIngestionArchiveRevision()) > afterBatch)
    const ingestionArchiveRevisionHealth = first.getIngestionArchiveRevisionHealth()
    assert.equal(ingestionArchiveRevisionHealth.version, 'ingestion-archive-revision-v2')
    assert.equal(ingestionArchiveRevisionHealth.expectedTriggers, 6)
    assert.equal(ingestionArchiveRevisionHealth.validTriggers, 6)
    assert.equal(ingestionArchiveRevisionHealth.healthy, true)
    ;(first as any).db.exec(
      'DROP TRIGGER trg_ingestion_archive_revision_ingestion_batches_update'
    )
    assert.equal(first.getIngestionArchiveRevisionHealth().installedTriggers, 5)
    assert.equal(first.getIngestionArchiveRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getIngestionArchiveRevisionHealth().installedTriggers, 6)
    assert.equal(reopened.getIngestionArchiveRevisionHealth().healthy, true)
    const run = reopened.listIngestionRunPage({ query: 'backlog' }).items[0]
    assert.equal(run?.status, 'partial')
    assert.equal(run?.trigger_kind, 'backlog')
    assert.equal(run?.backlog_before_count, 7)
    assert.equal(run?.backlog_after_count, 3)
    assert.equal(run?.backlog_outcome, 'progressed')
    assert.equal(run?.backlog_next_attempt_at, '2026-08-06T05:15:00.000Z')
    assert.equal(reopened.listIngestionRunPage({ query: 'progressed' }).total, 1)
    assert.equal(reopened.listIngestionRunPage({ query: '积压自动接力' }).total, 1)
    assert.equal(reopened.listIngestionRunPage({ query: '已推进' }).total, 1)
    assert.equal(reopened.listIngestionRunPage({
      trigger: 'backlog',
      backlogOutcome: 'progressed'
    }).total, 1)
    assert.equal(reopened.listIngestionRunPage({
      trigger: 'resume',
      backlogOutcome: 'progressed'
    }).total, 0)
    assert.equal(reopened.getIngestionRunDossier('ingestion-revision-run')?.batchTotal, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ingestion recovery revision covers prepare retry commit and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-ingestion-recovery-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getIngestionRecoveryRevision())
    first.prepareIngestionBatchCommit({
      commitId: 'recovery-revision-commit',
      runId: 'recovery-revision-run',
      batchIndex: 0,
      digest: { tasks: [] },
      messages: [],
      checkpointKeys: [],
      createdAt: '2026-08-03T00:00:00.000Z'
    })
    const afterPrepare = Number(first.getIngestionRecoveryRevision())
    assert.ok(afterPrepare > initial)
    first.recordIngestionBatchCommitRecoveryFailure(
      'recovery-revision-commit',
      '模拟恢复失败'
    )
    const afterFailure = Number(first.getIngestionRecoveryRevision())
    assert.ok(afterFailure > afterPrepare)
    first.markIngestionBatchCommitApplied('recovery-revision-commit')
    assert.ok(Number(first.getIngestionRecoveryRevision()) > afterFailure)
    const ingestionRecoveryRevisionHealth = first.getIngestionRecoveryRevisionHealth()
    assert.equal(ingestionRecoveryRevisionHealth.version, 'ingestion-recovery-revision-v2')
    assert.equal(ingestionRecoveryRevisionHealth.expectedTriggers, 3)
    assert.equal(ingestionRecoveryRevisionHealth.validTriggers, 3)
    assert.equal(ingestionRecoveryRevisionHealth.healthy, true)
    ;(first as any).db.exec(
      'DROP TRIGGER trg_ingestion_recovery_revision_ingestion_batch_commits_update'
    )
    assert.equal(first.getIngestionRecoveryRevisionHealth().installedTriggers, 2)
    assert.equal(first.getIngestionRecoveryRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getIngestionRecoveryRevisionHealth().installedTriggers, 3)
    assert.equal(reopened.getIngestionRecoveryRevisionHealth().healthy, true)
    assert.equal(reopened.listIngestionRecoveryPage().total, 0)
    assert.equal(reopened.getIngestionCommitHealth().committed, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('cross-store recovery revision covers both queues and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-cross-store-recovery-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const initial = Number(first.getCrossStoreRecoveryRevision())
    first.prepareTaskMutationCommit({
      commitId: 'cross-revision-task',
      beforeTokens: { task: 'before' },
      afterTokens: { task: 'after' },
      changes: []
    })
    const afterTask = Number(first.getCrossStoreRecoveryRevision())
    assert.ok(afterTask > initial)
    first.prepareConversationSourceMutationCommit({
      commitId: 'cross-revision-source',
      beforeTokens: { source: 'before' },
      afterTokens: { source: 'after' },
      policies: []
    })
    assert.ok(Number(first.getCrossStoreRecoveryRevision()) > afterTask)
    const health = first.getCrossStoreRecoveryRevisionHealth()
    assert.equal(health.version, 'cross-store-recovery-revision-v1')
    assert.equal(health.expectedTriggers, 6)
    assert.equal(health.validTriggers, 6)
    assert.equal(health.healthy, true)
    ;(first as any).db.exec(
      'DROP TRIGGER trg_cross_store_recovery_revision_task_mutation_commits_update'
    )
    assert.equal(first.getCrossStoreRecoveryRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    assert.equal(reopened.getCrossStoreRecoveryRevisionHealth().installedTriggers, 6)
    assert.equal(reopened.getCrossStoreRecoveryRevisionHealth().healthy, true)
    assert.equal(reopened.listCrossStoreRecoveryPage().total, 2)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('assistant history revision covers authoritative history and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-assistant-history-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const database = (first as any).db
    const now = '2026-08-03T00:00:00.000Z'
    let previous = Number(first.getAssistantHistoryRevision())
    const expectAdvanced = () => {
      const current = Number(first.getAssistantHistoryRevision())
      assert.ok(current > previous)
      previous = current
    }

    const conversationId = first.saveAssistantExchange(
      '可信历史版本问题',
      '可信历史版本回答',
      []
    )
    expectAdvanced()
    const answerId = database.prepare(`
      SELECT id FROM assistant_messages
      WHERE conversation_id=? AND role='assistant'
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).pluck().get(conversationId)
    database.prepare(`
      INSERT INTO search_documents(
        id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'assistant-history-document',
      'resource',
      'assistant-history-source',
      '可信来源',
      '可信来源正文',
      '{}',
      'a'.repeat(64),
      now
    )
    expectAdvanced()
    database.prepare(`
      INSERT INTO search_document_evidence(
        document_id,source_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'assistant-history-document',
      'wechat',
      'assistant-history-message',
      'assistant-history-session',
      1_754_000_000,
      '测试发送者',
      '可信来源原文'
    )
    expectAdvanced()
    database.prepare(`
      INSERT INTO assistant_answer_dependencies(
        message_id,conversation_id,statement_index,document_id,content_hash,created_at
      ) VALUES(?,?,?,?,?,?)
    `).run(
      answerId,
      conversationId,
      0,
      'assistant-history-document',
      'a'.repeat(64),
      now
    )
    expectAdvanced()
    database.prepare(`
      INSERT INTO assistant_answer_review_decisions(
        message_id,state_key,action,created_at
      ) VALUES(?,?,?,?)
    `).run(answerId, 'assistant-history-state', 'reopened', now)
    expectAdvanced()
    database.prepare(`
      INSERT INTO evidence(
        claim_id,relation_id,event_id,source_id,message_id,session_id,
        timestamp,sender,excerpt,evidence_role
      ) VALUES(NULL,NULL,NULL,?,?,?,?,?,?,?)
    `).run(
      'wechat',
      'assistant-history-structured-message',
      'assistant-history-session',
      1_754_000_001,
      '测试发送者',
      '结构化可信原文',
      'support'
    )
    expectAdvanced()
    database.prepare(`
      UPDATE assistant_conversations SET title=? WHERE id=?
    `).run('可信历史版本问题（更新）', conversationId)
    expectAdvanced()

    const initialHealth = first.getAssistantHistoryRevisionHealth()
    assert.equal(initialHealth.version, 'assistant-history-revision-v4')
    assert.equal(initialHealth.expectedTriggers, 30)
    assert.equal(initialHealth.validTriggers, 30)
    assert.equal(initialHealth.healthy, true)
    database.exec(`
      DROP TRIGGER trg_assistant_history_revision_assistant_messages_insert;
      CREATE TRIGGER trg_assistant_history_revision_assistant_messages_insert
      AFTER INSERT ON assistant_messages BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getAssistantHistoryRevisionHealth()
    assert.equal(driftedHealth.installedTriggers, 30)
    assert.equal(driftedHealth.validTriggers, 29)
    assert.equal(driftedHealth.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getAssistantHistoryRevisionHealth()
    assert.equal(repairedHealth.validTriggers, 30)
    assert.equal(repairedHealth.repairedTriggersThisStart, 1)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(reopened.listAssistantConversationsPage({ limit: 20 }).total, 1)
    assert.equal(reopened.getAssistantConversation(conversationId).messages.length, 2)
    assert.equal(reopened.listAssistantAnswerReviewDecisionsPage(answerId).total, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('resource archive revision covers content evidence and trash and self-heals on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-resource-archive-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    let previous = Number(first.getResourceArchiveRevision())
    const expectAdvanced = () => {
      const current = Number(first.getResourceArchiveRevision())
      assert.ok(current > previous)
      previous = current
    }
    first.upsertResources([{
      id: 'resource-revision',
      resourceType: 'file',
      title: '资源版本保护',
      content: '资源正文',
      metadata: {},
      evidence: [{
        sourceId: 'wechat',
        messageId: 'resource-revision-message',
        sessionId: 'resource-revision-session',
        timestamp: 1_754_000_001,
        sender: '测试发送者',
        excerpt: '资源版本原文'
      }]
    }])
    expectAdvanced()
    first.deleteResource('resource-revision')
    expectAdvanced()
    const resourceArchiveRevisionHealth = first.getResourceArchiveRevisionHealth()
    assert.equal(resourceArchiveRevisionHealth.version, 'resource-archive-revision-v2')
    assert.equal(resourceArchiveRevisionHealth.expectedTriggers, 9)
    assert.equal(resourceArchiveRevisionHealth.validTriggers, 9)
    assert.equal(resourceArchiveRevisionHealth.healthy, true)
    ;(first as any).db.exec(`
      DROP TRIGGER trg_resource_archive_revision_search_document_evidence_insert;
      CREATE TRIGGER trg_resource_archive_revision_search_document_evidence_insert
      AFTER INSERT ON search_document_evidence
      BEGIN
        UPDATE schema_meta
        SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE key='resource_archive_revision';
      END;
    `)
    const conditionDrift = first.getResourceArchiveRevisionHealth()
    assert.equal(conditionDrift.installedTriggers, 9)
    assert.equal(conditionDrift.validTriggers, 8)
    assert.equal(conditionDrift.healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const repairedHealth = reopened.getResourceArchiveRevisionHealth()
    assert.equal(repairedHealth.validTriggers, 9)
    assert.equal(repairedHealth.repairedTriggersThisStart, 1)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(reopened.listResourceArchive().total, 0)
    assert.equal(reopened.listResourceTrashArchive().total, 1)
    const beforeTaskEvidence = reopened.getResourceArchiveRevision()
    reopened.syncTasks([{
      id: 'resource-revision-filter-proof-task',
      title: '非资源证据不能推进资源 revision',
      detail: '',
      priority: 'medium',
      confidence: 1,
      classification: 'mine',
      status: 'todo',
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      evidence: [{
        sourceId: 'wechat',
        sessionId: 'resource-filter-proof-session',
        messageId: 'resource-filter-proof-task-message',
        timestamp: 1_775_000_010,
        excerpt: '这是任务证据'
      }]
    }])
    assert.equal(reopened.getResourceArchiveRevision(), beforeTaskEvidence)
    reopened.upsertResources([{
      id: 'resource-revision-filter-proof',
      resourceType: 'document',
      title: '资源条件修复证明',
      content: '资源写入必须推进 revision',
      metadata: {},
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      evidence: [{
        sourceId: 'wechat',
        sessionId: 'resource-filter-proof-session',
        messageId: 'resource-filter-proof-resource-message',
        timestamp: 1_775_000_011,
        excerpt: '这是资源证据'
      }]
    }])
    assert.ok(Number(reopened.getResourceArchiveRevision()) > Number(beforeTaskEvidence))
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
      evidence: [{ sourceId: 'wechat', messageId: 'scope-relation-message', sessionId: 'scope-session', timestamp: 1_754_000_000, excerpt: '为范围组织提供服务' }]
    }],
    reviewQueue: []
  })
  store.upsertEvents([{
    id: 'scope-event',
    eventType: 'meeting',
    title: '范围会议',
    description: '',
    startAt: '2025-07-01T10:00:00.000Z',
    endAt: '2025-09-01T10:00:00.000Z',
    confidence: 0.8,
    status: 'candidate',
    searchText: '范围人物参加范围会议',
    participants: [{ entityId: 'scope-person', role: 'participant' }],
    evidence: [{ sourceId: 'calendar', messageId: 'scope-event-message', sessionId: 'scope-session', timestamp: 1_735_689_600, excerpt: '提前安排范围会议' }]
  }])
  store.upsertResources([{
    id: 'scope-combination-resource',
    resourceType: 'document',
    title: '组合范围资料',
    content: '验证组合范围必须由同一条证据满足',
    evidence: [{
      sourceId: 'mail',
      messageId: 'scope-mail-old',
      sessionId: 'mail-session',
      timestamp: 1_735_689_600,
      excerpt: '旧邮件证据'
    }, {
      sourceId: 'wechat',
      messageId: 'scope-wechat-new',
      sessionId: 'wechat-session',
      timestamp: 1_785_556_800,
      excerpt: '新微信证据'
    }]
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
  assert.ok(store.listScopedSearchDocumentIds({
    sourceIds: ['calendar'],
    sessionId: 'scope-session',
    from: '2025-08-01',
    to: '2025-08-01'
  })?.has('event:scope-event'))
  assert.equal(store.listScopedSearchDocumentIds({
    sourceIds: ['calendar'],
    sessionId: 'other-session',
    from: '2025-08-01',
    to: '2025-08-01'
  })?.has('event:scope-event'), false)
  assert.equal(store.listScopedSearchDocumentIds({
    sourceIds: ['mail'],
    sessionId: 'wechat-session',
    from: '2026-08-01',
    to: '2026-08-01'
  })?.has('resource:scope-combination-resource'), false)
  assert.ok(store.listScopedSearchDocumentIds({
    sourceIds: ['wechat'],
    sessionId: 'wechat-session',
    from: '2026-08-01',
    to: '2026-08-01'
  })?.has('resource:scope-combination-resource'))
  const eventTimePayload = store.getDocumentEvidencePayload('event', 'scope-event', {
    from: '2025-08-01',
    to: '2025-08-01'
  })
  assert.equal(eventTimePayload.evidenceTimeScopeMode, 'document_time')
  assert.equal(eventTimePayload.evidenceTotal, 1)
  assert.equal(eventTimePayload.evidence[0].message_id, 'scope-event-message')
  const evidenceTimePayload = store.getDocumentEvidencePayload('relation', 'scope-relation', {
    from: '2026-08-01',
    to: '2026-08-01'
  })
  assert.equal(evidenceTimePayload.evidenceTimeScopeMode, 'evidence_time')
  assert.equal(evidenceTimePayload.evidenceTotal, 0)
  assert.deepEqual(new Set(
    store.listScopedSearchDocumentIds({ sourceIds: ['wechat'] }) || []
  ), new Set(['relation:scope-relation', 'resource:scope-combination-resource']))
  assert.deepEqual(
    [...(store.listScopedSearchDocumentIds({ sourceIds: ['calendar'] }) || [])],
    ['event:scope-event']
  )
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
  const sourcePlan = buildMemoryQueryPlan(
    '只看日历和邮件里最近三天的会议',
    entities,
    new Date('2026-07-30T02:00:00Z')
  )
  assert.deepEqual(sourcePlan.inferredOptions.sourceIds, ['calendar', 'mail'])
  assert.ok(sourcePlan.explanation.some(item => item.includes('macOS 日历、macOS Mail')))
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
  const firstSavedExchange = store.saveAssistantExchangeDetailed('第一问', '第一答', [{
    documentId: 'claim:one',
    title: '证据一',
    contentHash: 'a'.repeat(64),
    evidenceSampleHash: 'b'.repeat(64),
    evidenceRoleCounts: { supporting: 4, contradiction: 1 },
    content: '不应复制进问答历史的结构化正文',
    evidence: [{ messageId: 'sensitive-message', excerpt: '不应复制的原文证据' }],
    feedbackContext: {
      query: '第一问',
      options: { sourceIds: ['wechat'], documentTypes: ['claim'] },
      version: 'memory-search-feedback-v2'
    }
  }], undefined, {
    version: 'statement-citations-v1',
    proposedStatements: 2,
    acceptedStatements: 1,
    rejectedStatements: 1,
    acceptedCitationIds: 1,
    removedConflictCitationIds: 0,
    rejectedConflictStatements: 0,
    rejectedOversizedStatements: 0,
    rejectedAnswerBudgetStatements: 0,
    promptIsolationVersion: 'untrusted-memory-envelope-v1',
    statementCitations: [['claim:one']],
    sourcePrivacyAudit: {
      version: 'model-source-privacy-v2',
      policy: {
        wechat: true,
        documents: true,
        calendar: false,
        mail: false,
        unknown: false
      },
      contextDocuments: 1,
      privacyExcludedDocuments: 2,
      budgetOmittedDocuments: 3,
      contextSourceIds: ['wechat'],
      excludedSourceIds: ['unknown', 'mail'],
      incompleteSourceDocuments: 1,
      outboundSha256: 'c'.repeat(64),
      redaction: {
        level: 'strict',
        total: 2,
        counts: { 邮箱: 2 },
        leakedText: '不能持久化'
      },
      boundaryChecks: ['before_send', 'after_response', 'forged'],
      rawOutbound: '不能持久化'
    },
    leakedSensitiveField: '不能离开主进程'
  }, '存在一条较早反证，结论需要保留条件')
  const conversationId = firstSavedExchange.conversationId
  assert.match(firstSavedExchange.questionMessageId, /^msg_exchange_.+_q$/)
  assert.match(firstSavedExchange.answerMessageId, /^msg_exchange_.+_a$/)
  store.saveAssistantExchange('第二问', '第二答', [{
    documentId: 'event:two',
    title: '证据二'
  }], conversationId)
  store.saveAssistantExchange(
    '第三问',
    '没有足够的已确认原始证据回答。检索到的待确认候选或线索不会被当作事实。',
    [],
    conversationId,
    {
      version: 'statement-citations-v1',
      acceptedStatements: 0,
      insufficientEvidencePolicyVersion: 'deterministic-insufficient-evidence-v1',
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: []
    }
  )

  const summaries = store.listAssistantConversations()
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].id, conversationId)
  assert.equal(summaries[0].title, '第一问')
  assert.equal(summaries[0].message_count, 6)
  assert.match(summaries[0].preview, /没有足够的已确认原始证据/)

  const conversation = store.getAssistantConversation(conversationId, 4)
  assert.deepEqual(conversation.messages.map((message: any) => [message.role, message.content]), [
    ['user', '第二问'],
    ['assistant', '第二答'],
    ['user', '第三问'],
    ['assistant', '没有足够的已确认原始证据回答。检索到的待确认候选或线索不会被当作事实。']
  ])
  assert.equal(conversation.messages[1].citations[0].documentId, 'event:two')
  const complete = store.getAssistantConversation(conversationId, 10)
  assert.equal(complete.messages[1].citations[0].feedbackContext.query, '第一问')
  assert.deepEqual(complete.messages[1].citations[0].feedbackContext.options.sourceIds, ['wechat'])
  assert.equal(complete.messages[1].citations[0].content, undefined)
  assert.equal(complete.messages[1].citations[0].evidence, undefined)
  assert.equal(complete.messages[1].citations[0].contentHash, 'a'.repeat(64))
  assert.equal(complete.messages[1].citations[0].evidenceSampleHash, 'b'.repeat(64))
  assert.deepEqual(complete.messages[1].citations[0].evidenceRoleCounts, {
    supporting: 4,
    contradiction: 1
  })
  assert.equal(
    complete.messages[1].uncertainty,
    '存在一条较早反证，结论需要保留条件'
  )
  assert.equal(JSON.stringify(complete.messages[1].citations).includes('不应复制'), false)
  assert.deepEqual(complete.messages[1].groundingAudit, {
    version: 'statement-citations-v1',
    proposedStatements: 2,
    acceptedStatements: 1,
    rejectedStatements: 1,
    acceptedCitationIds: 1,
    removedConflictCitationIds: 0,
    rejectedConflictStatements: 0,
    rejectedOversizedStatements: 0,
    rejectedAnswerBudgetStatements: 0,
    promptIsolationVersion: 'untrusted-memory-envelope-v1',
    sourcePrivacyAudit: {
      version: 'model-source-privacy-v2',
      policy: {
        wechat: true,
        documents: true,
        calendar: false,
        mail: false,
        unknown: false
      },
      contextDocuments: 1,
      privacyExcludedDocuments: 2,
      budgetOmittedDocuments: 3,
      contextSourceIds: ['wechat'],
      excludedSourceIds: ['mail', 'unknown'],
      incompleteSourceDocuments: 1,
      outboundSha256: 'c'.repeat(64),
      redaction: {
        level: 'strict',
        total: 2,
        counts: { 邮箱: 2 }
      },
      boundaryChecks: ['before_send', 'after_response']
    },
    statementCitations: [['claim:one']]
  })
  assert.equal(JSON.stringify(complete.messages[1].groundingAudit).includes('不能离开主进程'), false)
  assert.equal(JSON.stringify(complete.messages[1].groundingAudit).includes('不能持久化'), false)
  assert.equal(
    complete.messages[5].groundingAudit.insufficientEvidencePolicyVersion,
    'deterministic-insufficient-evidence-v1'
  )
  const storedAnswer = store.getAssistantAnswerMessage(firstSavedExchange.answerMessageId)
  assert.equal(storedAnswer.id, firstSavedExchange.answerMessageId)
  assert.equal(storedAnswer.role, 'assistant')
  assert.equal(storedAnswer.content, '第一答')
  assert.equal(storedAnswer.uncertainty, '存在一条较早反证，结论需要保留条件')
  assert.deepEqual(storedAnswer.groundingAudit.statementCitations, [['claim:one']])
  assert.equal(store.getAssistantAnswerMessage(firstSavedExchange.questionMessageId), null)
  assert.deepEqual(complete.messages[0].groundingAudit, {})
  for (let index = 0; index < complete.messages.length; index += 2) {
    assert.match(complete.messages[index].exchange_id, /^exchange_/)
    assert.equal(complete.messages[index].exchange_id, complete.messages[index + 1].exchange_id)
  }
  assert.equal(store.getAssistantExchangeIntegrityStats().pairedExchanges, 3)
  assert.equal(store.getAssistantExchangeIntegrityStats().unmatchedMessages, 0)
  const firstExchange = complete.messages[0].exchange_id
  assert.throws(() => (store as any).db.prepare(`
    INSERT INTO assistant_messages(
      id,conversation_id,role,content,citations_json,grounding_json,exchange_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    'duplicate-assistant-role',
    conversationId,
    'user',
    '重复角色',
    '[]',
    '{}',
    firstExchange,
    new Date().toISOString()
  ), /UNIQUE constraint failed/)

  assert.equal(store.deleteAssistantConversation(conversationId), true)
  assert.equal(store.getAssistantConversation(conversationId), null)
  assert.equal(store.listAssistantConversations().length, 0)
}))

test('assistant uncertainty and evidence sample identity survive a SQLCipher reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-answer-uncertainty-test-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const saved = first.saveAssistantExchangeDetailed(
      '这个结论确定吗？',
      '现有证据支持，但存在冲突。',
      [{
        documentId: 'claim:uncertain',
        title: '冲突事实',
        contentHash: 'a'.repeat(64),
        evidenceSampleHash: 'b'.repeat(64),
        evidenceRoleCounts: { supporting: 7, contradiction: 2 },
        evidenceAuthorityRevision: 42
      }],
      undefined,
      {
        version: 'statement-citations-v1',
        proposedStatements: 1,
        acceptedStatements: 1,
        rejectedStatements: 0,
        acceptedCitationIds: 1,
        promptIsolationVersion: 'untrusted-memory-envelope-v1',
        statementCitations: [['claim:uncertain']]
      },
      '两条反证尚未完成人工裁决。'
    )
    ;(first as any).db.prepare(`
      UPDATE assistant_answer_dependencies
      SET evidence_sample_hash='',evidence_supporting_count=0,evidence_contradiction_count=0,
        evidence_authority_revision=0
      WHERE message_id=?
    `).run(saved.answerMessageId)
    ;(first as any).db.prepare(`
      DELETE FROM schema_meta WHERE key='assistant_answer_dependencies_v4'
    `).run()
    first.close()

    reopened.initialize(databasePath)
    const conversation = reopened.getAssistantConversation(saved.conversationId, 10)
    const answer = conversation.messages.find((item: any) => item.role === 'assistant')
    assert.equal(answer.uncertainty, '两条反证尚未完成人工裁决。')
    assert.equal('uncertainty_text' in answer, false)
    assert.equal(answer.citations[0].evidenceSampleHash, 'b'.repeat(64))
    assert.deepEqual(answer.citations[0].evidenceRoleCounts, {
      supporting: 7,
      contradiction: 2
    })
    assert.equal(answer.citations[0].evidenceAuthorityRevision, 42)
    assert.deepEqual((reopened as any).db.prepare(`
      SELECT evidence_sample_hash,evidence_supporting_count,evidence_contradiction_count
        ,evidence_authority_revision
      FROM assistant_answer_dependencies WHERE message_id=?
    `).get(saved.answerMessageId), {
      evidence_sample_hash: 'b'.repeat(64),
      evidence_supporting_count: 7,
      evidence_contradiction_count: 2,
      evidence_authority_revision: 42
    })
    assert.equal(reopened.getAssistantAnswerDependencyStats().version, 4)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('assistant exchange rolls back conversation and question when answer persistence fails', () => withStore(store => {
  const database = (store as any).db
  database.exec(`
    CREATE TRIGGER fail_assistant_answer_insert
    BEFORE INSERT ON assistant_messages
    WHEN NEW.role='assistant'
    BEGIN
      SELECT RAISE(ABORT,'simulated answer write failure');
    END;
  `)
  assert.throws(() => store.saveAssistantExchange(
    '不能留下半个回合的问题',
    '这个回答会在写入时失败',
    []
  ), /simulated answer write failure/)
  database.exec(`DROP TRIGGER fail_assistant_answer_insert`)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_conversations
    WHERE title='不能留下半个回合的问题'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_messages
    WHERE content LIKE '%半个回合%'
  `).get().count), 0)
}))

test('assistant exchange rejects a stale search revision before persisting either message', () => withStore(store => {
  const database = (store as any).db
  const expectedSearchRevision = store.getMemorySearchRevision()
  store.syncTasks([{
    id: 'answer-commit-race-task',
    title: '回答提交竞态',
    detail: '在引用重核验后发生变化',
    priority: 'medium',
    status: 'todo',
    classification: 'mine'
  }])
  assert.notEqual(store.getMemorySearchRevision(), expectedSearchRevision)
  assert.throws(() => store.saveAssistantExchangeDetailed(
    '不能保存过期问题',
    '不能保存过期回答',
    [],
    undefined,
    {},
    '',
    { expectedSearchRevision }
  ), /引用证据在回答提交前发生了变化/)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_conversations
    WHERE title='不能保存过期问题'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_messages
    WHERE content LIKE '%不能保存过期%'
  `).get().count), 0)
}))

test('assistant conversation deletion preview binds messages, dependencies and reviews', () => withStore(store => {
  const saved = store.saveAssistantExchangeDetailed(
    '删除范围问题',
    '删除范围回答',
    [{ documentId: 'claim:preview', title: '证据', type: 'claim' }],
    undefined,
    {
      version: 'statement-citations-v1',
      statementCitations: [['claim:preview']]
    }
  )
  const database = (store as any).db
  database.prepare(`
    INSERT INTO assistant_answer_review_decisions(message_id,state_key,action,created_at)
    VALUES(?,?,?,?)
  `).run(saved.answerMessageId, 'review-state', 'acknowledged', new Date().toISOString())

  const first = store.previewDeleteAssistantConversation(saved.conversationId)
  assert.equal(first.counts.messages, 2)
  assert.equal(first.counts.userMessages, 1)
  assert.equal(first.counts.assistantMessages, 1)
  assert.equal(first.counts.citations, 1)
  assert.equal(first.counts.dependencies, 1)
  assert.equal(first.counts.reviews, 1)
  assert.match(first.identitySha256, /^[a-f0-9]{64}$/)

  store.saveAssistantExchange('后台新增问题', '后台新增回答', [], saved.conversationId)
  const afterMessage = store.previewDeleteAssistantConversation(saved.conversationId)
  assert.notEqual(afterMessage.identitySha256, first.identitySha256)
  assert.equal(afterMessage.counts.messages, 4)

  database.prepare(`
    INSERT INTO assistant_answer_review_decisions(message_id,state_key,action,created_at)
    VALUES(?,?,?,?)
  `).run(saved.answerMessageId, 'review-state-2', 'reopened', new Date().toISOString())
  const afterReview = store.previewDeleteAssistantConversation(saved.conversationId)
  assert.notEqual(afterReview.identitySha256, afterMessage.identitySha256)
  assert.equal(afterReview.counts.reviews, 2)

  assert.equal(store.deleteAssistantConversation(saved.conversationId), true)
  assert.equal(store.getAssistantConversation(saved.conversationId), null)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_answer_review_decisions
  `).get().count), 0)
}))

test('assistant conversation deletion identity survives reopen and detects later turns', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-conversation-delete-preview-reopen-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const conversationId = first.saveAssistantExchange('重启删除问题', '重启删除回答', [])
    const beforeRestart = first.previewDeleteAssistantConversation(conversationId)
    first.close()

    second.initialize(databasePath, key)
    const afterRestart = second.previewDeleteAssistantConversation(conversationId)
    assert.equal(afterRestart.identitySha256, beforeRestart.identitySha256)
    assert.deepEqual(afterRestart.counts, beforeRestart.counts)

    second.saveAssistantExchange('重启后新增问题', '重启后新增回答', [], conversationId)
    const afterNewTurn = second.previewDeleteAssistantConversation(conversationId)
    assert.notEqual(afterNewTurn.identitySha256, beforeRestart.identitySha256)
    assert.equal(afterNewTurn.counts.messages, 4)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy adjacent question and answer receive one stable exchange identity after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-assistant-exchange-migration-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32).toString('hex')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const conversationId = first.saveAssistantExchange('旧问题', '旧回答', [])
    ;(first as any).db.prepare(`
      UPDATE assistant_messages SET exchange_id='' WHERE conversation_id=?
    `).run(conversationId)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const messages = reopened.getAssistantConversation(conversationId, 10).messages
      assert.equal(messages.length, 2)
      assert.match(messages[0].exchange_id, /^legacy_[a-f0-9]{32}$/)
      assert.equal(messages[0].exchange_id, messages[1].exchange_id)
      const stats = reopened.getAssistantExchangeIntegrityStats()
      assert.equal(stats.pairedThisRun, 1)
      assert.equal(stats.pairedExchanges, 1)
      assert.equal(stats.unmatchedMessages, 0)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy assistant citations are compacted at scale without losing reference or feedback identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-assistant-citation-compaction-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32).toString('hex')
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const database = (first as any).db
    const createdAt = new Date().toISOString()
    database.prepare(`
      INSERT INTO assistant_conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)
    `).run('legacy-citations', '旧引用迁移', createdAt, createdAt)
    database.prepare(`DELETE FROM schema_meta WHERE key='assistant_citation_storage_v1'`).run()
    const insert = database.prepare(`
      INSERT INTO assistant_messages(id,conversation_id,role,content,citations_json,created_at)
      VALUES(?,?,?,?,?,?)
    `)
    const transaction = database.transaction(() => {
      for (let index = 0; index < 2_500; index += 1) {
        insert.run(
          `legacy-citation-${index}`,
          'legacy-citations',
          'assistant',
          `历史回答 ${index}`,
          JSON.stringify([{
            documentId: `claim:legacy-${index}`,
            sourceId: `legacy-${index}`,
            type: 'claim',
            title: `旧事实 ${index}`,
            content: `重复结构化正文 敏感副本 ${index}`,
            evidence: Array.from({ length: 20 }, (_, evidenceIndex) => ({
              messageId: `message-${index}-${evidenceIndex}`,
              excerpt: `不应长期复制的敏感原文 ${index}-${evidenceIndex}`
            })),
            feedbackContext: {
              query: `历史问题 ${index}`,
              options: { sourceIds: ['wechat'], documentTypes: ['claim'] },
              version: 'memory-search-feedback-v2'
            }
          }]),
          new Date(Date.now() + index).toISOString()
        )
      }
      insert.run(
        'legacy-citation-malformed',
        'legacy-citations',
        'assistant',
        '损坏引用仍保留回答',
        '{"evidence":"未知敏感载荷"',
        new Date(Date.now() + 2_501).toISOString()
      )
    })
    transaction()
    database.exec(`
      DROP TABLE IF EXISTS assistant_answer_review_decisions;
      DROP TABLE IF EXISTS assistant_answer_dependencies;
      DELETE FROM schema_meta WHERE key='assistant_answer_dependencies_v1';
      DROP INDEX IF EXISTS idx_assistant_messages_conversation_time;
      DROP INDEX IF EXISTS idx_assistant_messages_exchange_role;
      ALTER TABLE assistant_messages RENAME TO assistant_messages_before_grounding;
      CREATE TABLE assistant_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO assistant_messages(id,conversation_id,role,content,citations_json,created_at)
        SELECT id,conversation_id,role,content,citations_json,created_at
        FROM assistant_messages_before_grounding;
      DROP TABLE assistant_messages_before_grounding;
    `)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const raw = (reopened as any).db.prepare(`
        SELECT COUNT(*) AS count,
          SUM(instr(citations_json,'不应长期复制的敏感原文')) AS leakedEvidence,
          SUM(instr(citations_json,'重复结构化正文')) AS leakedContent
        FROM assistant_messages WHERE conversation_id='legacy-citations'
      `).get()
      assert.equal(Number(raw.count), 2_501)
      assert.equal(Number(raw.leakedEvidence), 0)
      assert.equal(Number(raw.leakedContent), 0)
      const columns = (reopened as any).db.prepare(`PRAGMA table_info(assistant_messages)`).all()
      assert.ok(columns.some((column: any) => column.name === 'grounding_json'))
      assert.ok(columns.some((column: any) => column.name === 'exchange_id'))
      assert.equal(reopened.getAssistantExchangeIntegrityStats().unmatchedMessages, 2_501)
      const dependencyStats = reopened.getAssistantAnswerDependencyStats()
      assert.equal(dependencyStats.messages, 2_500)
      assert.equal(dependencyStats.statements, 2_500)
      assert.equal(dependencyStats.dependencies, 2_500)
      const stats = reopened.getAssistantCitationStorageStats()
      assert.equal(stats.updatedMessages, 2_501)
      assert.equal(stats.citationsCompacted, 2_500)
      assert.equal(stats.malformedPayloadsCleared, 1)
      assert.ok(stats.bytesReclaimed > 1_000_000)
      const firstPage = reopened.getAssistantConversation('legacy-citations', { limit: 1 })
      assert.equal(reopened.getAssistantConversation(
        'legacy-citations',
        { offset: 1, limit: 1 }
      ).stale, true)
      const page = reopened.getAssistantConversation('legacy-citations', {
        offset: 1,
        limit: 1,
        revision: firstPage.revision
      })
      assert.equal(page.messages[0].citations[0].documentId, 'claim:legacy-2499')
      assert.equal(page.messages[0].citations[0].feedbackContext.query, '历史问题 2499')
      assert.equal(page.messages[0].citations[0].evidence, undefined)
      assert.equal(page.messages[0].citations[0].citationStorage, 'reference_only_v1')
      const firstReviewPage = reopened.listAssistantAnswerReviewsPage({
        status: 'invalid',
        limit: 40
      })
      const middleReviewPage = reopened.listAssistantAnswerReviewsPage({
        status: 'invalid',
        offset: 1_240,
        limit: 40,
        revision: firstReviewPage.revision
      })
      assert.equal(firstReviewPage.total, 2_500)
      assert.equal(firstReviewPage.counts.invalid, 2_500)
      assert.equal(firstReviewPage.items.length, 40)
      assert.equal(middleReviewPage.items.length, 40)
      assert.equal(new Set([
        ...firstReviewPage.items,
        ...middleReviewPage.items
      ].map((item: any) => item.message_id)).size, 80)
      assert.equal(JSON.stringify(firstReviewPage.items).includes('不应长期复制的敏感原文'), false)
    } finally {
      reopened.close()
    }
  } finally {
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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
  const second = store.listAssistantConversationsPage({
    limit: 40, offset: 40, revision: first.revision
  })
  const stats = store.getAssistantArchiveStats()
  assert.deepEqual(Object.keys(stats).sort(), [
    'answerDependencies', 'citationStorage', 'evidenceRevisions', 'exchangeIntegrity',
    'generalEvidenceRevisions', 'latestId', 'latestMessageCount', 'latestUpdatedAt',
    'modelRequestAudits', 'sourcePrivacyStorage', 'total'
  ])
  assert.deepEqual(Object.keys(stats.citationStorage).sort(), [
    'bytesReclaimed', 'citationsCompacted', 'completedAt', 'malformedPayloadsCleared',
    'scannedMessages', 'storedBytes', 'updatedMessages', 'version'
  ])
  assert.equal(JSON.stringify(stats.citationStorage).includes('历史问题'), false)
  assert.equal(JSON.stringify(stats.citationStorage).includes('历史回答'), false)
  assert.equal(stats.sourcePrivacyStorage.policy, 'category_only_no_connector_identity')
  assert.equal(JSON.stringify(stats.sourcePrivacyStorage).includes('历史问题'), false)
  assert.equal(stats.modelRequestAudits.policy, 'category_only_digest_no_prompt_v1')
  assert.equal(stats.modelRequestAudits.linkIntegrity.policy, 'opaque_target_auto_clear_v1')
  assert.equal(stats.modelRequestAudits.linkIntegrity.orphaned, 0)
  assert.equal(JSON.stringify(stats.modelRequestAudits).includes('历史问题'), false)
  assert.equal(stats.total, 600)
  assert.equal(first.total, 600)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.equal(second.stale, false)
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
  const firstLongPage = store.getAssistantConversation(longConversation, {
    offset: 0, limit: 40
  })
  const pages = [
    firstLongPage,
    ...Array.from({ length: 6 }, (_, index) =>
      store.getAssistantConversation(longConversation, {
        offset: (index + 1) * 40,
        limit: 40,
        revision: firstLongPage.revision
      }))
  ]
  const messages = pages.flatMap(page => page.messages)
  assert.equal(pages[0].total, 250)
  assert.equal(pages[0].hasOlder, true)
  assert.equal(pages[6].hasOlder, false)
  assert.equal(messages.length, 250)
  assert.equal(new Set(messages.map(message => message.id)).size, 250)
  assert.deepEqual(pages[0].messages.slice(-2).map((message: any) => message.content), ['长对话第 124 问', '长对话第 124 答'])
  ;(store as any).db.prepare(`
    UPDATE assistant_conversations SET title=title WHERE id=?
  `).run(longConversation)
  assert.equal(store.listAssistantConversationsPage({
    offset: 40, limit: 40, revision: first.revision
  }).stale, true)
  const staleMessages = store.getAssistantConversation(longConversation, {
    offset: 40, limit: 40, revision: firstLongPage.revision
  })
  assert.equal(staleMessages.stale, true)
  assert.deepEqual(staleMessages.messages, [])
}))

test('assistant archive filters statement dependencies without loading answer evidence', () => withStore(store => {
  const database = (store as any).db
  const now = new Date().toISOString()
  const insertDocument = database.prepare(`
    INSERT INTO search_documents(
      id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `)
  const insertEvidence = database.prepare(`
    INSERT INTO search_document_evidence(
      document_id,source_id,message_id,session_id,timestamp,sender,excerpt
    ) VALUES(?,?,?,?,?,?,?)
  `)
  for (const [id, hash] of [
    ['resource:current', 'a'.repeat(64)],
    ['resource:changed', 'b'.repeat(64)],
    ['resource:unknown', 'c'.repeat(64)]
  ]) {
    insertDocument.run(id, 'resource', id.slice('resource:'.length), id, id, '{}', hash, now)
    insertEvidence.run(id, 'documents', `${id}:message`, 'data-source:documents:test', 1, '文档', '仅用于资格核验')
  }
  const save = (question: string, documentId: string, contentHash: string, conversationId?: string) =>
    store.saveAssistantExchange(question, `${question}的回答`, [{
      documentId,
      sourceId: documentId.split(':')[1],
      type: 'resource',
      title: documentId,
      contentHash
    }], conversationId, {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [[documentId]]
    })
  const currentConversationId = save('当前有效会话', 'resource:current', 'a'.repeat(64))
  const changedConversationId = save('内容变化会话', 'resource:changed', 'a'.repeat(64))
  const changedAnswerId = String(database.prepare(`
    SELECT id FROM assistant_messages WHERE conversation_id=? AND role='assistant'
  `).get(changedConversationId)?.id || '')
  const reviewAnswer = (
    messageId: string,
    action: 'acknowledged' | 'reopened'
  ) => {
    const item = store.listAssistantAnswerReviewsPage({
      status: 'all',
      reviewState: 'all',
      messageId,
      limit: 1
    }).items[0]
    return store.reviewAssistantAnswer(messageId, action, item?.mutation_token || '')
  }
  save('后来仍有效的追问', 'resource:current', 'a'.repeat(64), changedConversationId)
  save('旧版未知会话', 'resource:unknown', '')
  save('来源删除会话', 'resource:missing', 'd'.repeat(64))
  store.saveAssistantExchange('没有事实陈述', '证据不足', [])

  const all = store.listAssistantConversationsPage({ limit: 20 })
  const statuses = new Map(all.items.map((item: any) => [item.title, item.revalidation_status]))
  assert.equal(statuses.get('当前有效会话'), 'current')
  assert.equal(statuses.get('内容变化会话'), 'invalid')
  assert.equal(statuses.get('旧版未知会话'), 'needs_review')
  assert.equal(statuses.get('来源删除会话'), 'invalid')
  assert.equal(statuses.get('没有事实陈述'), 'not_applicable')
  const changedDirectoryItem = all.items.find((item: any) => item.title === '内容变化会话')
  assert.equal(changedDirectoryItem.revalidation_target_message_id, changedAnswerId)
  assert.equal(changedDirectoryItem.revalidation_content_changed_statements, 1)
  assert.equal(changedDirectoryItem.revalidation_missing_statements, 0)
  const missingDirectoryItem = all.items.find((item: any) => item.title === '来源删除会话')
  assert.equal(missingDirectoryItem.revalidation_missing_statements, 1)
  assert.equal(missingDirectoryItem.revalidation_content_changed_statements, 0)
  const anchoredConversation = store.getAssistantConversation(changedConversationId, {
    anchorMessageId: changedAnswerId,
    limit: 40
  })
  assert.equal(anchoredConversation.anchorFound, true)
  assert.equal(anchoredConversation.hasNewer, true)
  assert.equal(anchoredConversation.offset, 2)
  assert.equal(anchoredConversation.messages.at(-1).id, changedAnswerId)
  assert.deepEqual(
    store.listAssistantConversationsPage({ revalidationStatus: 'invalid', limit: 20 })
      .items.map((item: any) => item.title).sort(),
    ['内容变化会话', '来源删除会话'].sort()
  )
  assert.equal(store.listAssistantConversationsPage({
    revalidationStatus: 'needs_review', limit: 20
  }).items[0].title, '旧版未知会话')
  assert.equal(store.listAssistantConversationsPage({
    revalidationStatus: 'current', limit: 20
  }).items[0].title, '当前有效会话')
  assert.equal(store.listAssistantConversationsPage({
    revalidationStatus: 'not_applicable', limit: 20
  }).items[0].title, '没有事实陈述')
  const dependencyStats = store.getAssistantAnswerDependencyStats()
  assert.equal(dependencyStats.messages, 5)
  assert.equal(dependencyStats.statements, 5)
  assert.equal(dependencyStats.dependencies, 5)
  assert.equal(JSON.stringify(all.items).includes('仅用于资格核验'), false)
  const answerReviews = store.listAssistantAnswerReviewsPage({ status: 'all', limit: 20 })
  assert.equal(answerReviews.total, 5)
  assert.deepEqual(answerReviews.counts, {
    attention: 3,
    invalid: 2,
    needs_review: 1,
    current: 2,
    pending: 3,
    resolved: 0
  })
  assert.deepEqual(answerReviews.reasonCounts, {
    missing: 1,
    ineligible: 0,
    contentChanged: 1,
    evidenceCountsChanged: 0,
    evidenceChanged: 0,
    other: 0
  })
  assert.equal(answerReviews.items.find((item: any) => item.message_id === changedAnswerId)
    .revalidation_status, 'invalid')
  assert.equal(answerReviews.items.find((item: any) => item.message_id === changedAnswerId)
    .content_changed_statements, 1)
  assert.equal(answerReviews.items.find((item: any) => item.message_id === changedAnswerId)
    .question_preview, '内容变化会话')
  assert.match(
    answerReviews.items.find((item: any) => item.message_id === changedAnswerId).mutation_token,
    /^[a-f0-9]{64}$/
  )
  assert.equal(JSON.stringify(answerReviews.items).includes('仅用于资格核验'), false)
  assert.equal(JSON.stringify(answerReviews.items).includes('state_key'), false)
  assert.deepEqual(store.listAssistantAnswerReviewsPage({
    status: 'all',
    reviewState: 'all',
    invalidReason: 'content_changed',
    limit: 20
  }).items.map((item: any) => item.question_preview), ['内容变化会话'])
  assert.deepEqual(store.listAssistantAnswerReviewsPage({
    status: 'all',
    reviewState: 'all',
    invalidReason: 'missing',
    limit: 20
  }).items.map((item: any) => item.question_preview), ['来源删除会话'])
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'all',
    reviewState: 'all',
    invalidReason: 'content_changed',
    query: '不存在的组合关键词',
    limit: 20
  }).total, 0)
  const attentionPage = store.listAssistantAnswerReviewsPage({ status: 'attention', limit: 2 })
  const attentionSecondPage = store.listAssistantAnswerReviewsPage({
    status: 'attention',
    offset: 2,
    limit: 2,
    revision: attentionPage.revision
  })
  assert.equal(attentionPage.total, 3)
  assert.equal(attentionPage.items.length, 2)
  assert.equal(attentionPage.hasMore, true)
  assert.equal(attentionSecondPage.stale, false)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'all',
    query: '后来仍有效',
    limit: 20
  }).items[0].revalidation_status, 'current')
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'needs_review',
    limit: 20
  }).items[0].question_preview, '旧版未知会话')
  assert.throws(() => reviewAnswer(
    store.listAssistantAnswerReviewsPage({ status: 'current', limit: 20 }).items[0].message_id,
    'acknowledged'
  ), /当前仍有效/)
  const visibleChangedAnswer = store.listAssistantAnswerReviewsPage({
    status: 'all',
    reviewState: 'all',
    messageId: changedAnswerId,
    limit: 1
  }).items[0]
  const firstReviewDecision = store.reviewAssistantAnswer(
    changedAnswerId,
    'acknowledged',
    visibleChangedAnswer.mutation_token
  )
  assert.equal('stateKey' in firstReviewDecision, false)
  assert.throws(() => store.reviewAssistantAnswer(
    changedAnswerId,
    'reopened',
    visibleChangedAnswer.mutation_token
  ), /展示后发生了变化/)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    offset: 2,
    limit: 2,
    revision: attentionPage.revision
  }).stale, true)
  assert.equal(JSON.stringify(store.listAssistantAnswerReviewsPage({
    status: 'all', reviewState: 'all', limit: 20
  }).items).includes('state_key'), false)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'pending',
    limit: 20
  }).items.some((item: any) => item.message_id === changedAnswerId), false)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'resolved',
    limit: 20
  }).items[0].message_id, changedAnswerId)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'resolved',
    limit: 20
  }).reasonCounts.contentChanged, 1)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'pending',
    limit: 20
  }).reasonCounts.contentChanged, 0)
  assert.deepEqual(store.listAssistantAnswerReviewsPage({
    status: 'all',
    reviewState: 'all',
    limit: 20
  }).counts, {
    attention: 3,
    invalid: 2,
    needs_review: 1,
    current: 2,
    pending: 2,
    resolved: 1
  })
  database.prepare(`
    UPDATE search_documents SET content_hash=?,updated_at=? WHERE id=?
  `).run('9'.repeat(64), '2030-01-01T00:00:00.000Z', 'resource:changed')
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'pending',
    limit: 20
  }).items.some((item: any) => item.message_id === changedAnswerId), true)
  reviewAnswer(changedAnswerId, 'acknowledged')
  database.prepare(`
    UPDATE search_documents SET content_hash=? WHERE id=?
  `).run('8'.repeat(64), 'resource:changed')
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'pending',
    limit: 20
  }).items.some((item: any) => item.message_id === changedAnswerId), true)
  reviewAnswer(changedAnswerId, 'acknowledged')
  reviewAnswer(changedAnswerId, 'reopened')
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'attention',
    reviewState: 'pending',
    limit: 20
  }).items.some((item: any) => item.message_id === changedAnswerId), true)
  for (let index = 0; index < 41; index += 1) {
    reviewAnswer(changedAnswerId, index % 2 === 0 ? 'reopened' : 'acknowledged')
  }
  const firstDecisionPage = store.listAssistantAnswerReviewDecisionsPage(
    changedAnswerId,
    { limit: 20 }
  )
  const secondDecisionPage = store.listAssistantAnswerReviewDecisionsPage(
    changedAnswerId,
    { offset: 20, limit: 20, revision: firstDecisionPage.revision }
  )
  const lastDecisionPage = store.listAssistantAnswerReviewDecisionsPage(
    changedAnswerId,
    { offset: 40, limit: 20, revision: firstDecisionPage.revision }
  )
  assert.equal(firstDecisionPage.total, 45)
  assert.equal(firstDecisionPage.items.length, 20)
  assert.equal(secondDecisionPage.items.length, 20)
  assert.equal(lastDecisionPage.items.length, 5)
  assert.equal(lastDecisionPage.hasMore, false)
  assert.equal(firstDecisionPage.items[0].is_latest, 1)
  assert.equal(JSON.stringify(firstDecisionPage.items).includes('state_key'), false)
  assert.equal(new Set([
    ...firstDecisionPage.items,
    ...secondDecisionPage.items,
    ...lastDecisionPage.items
  ].map((item: any) => item.id)).size, 45)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'all', reviewState: 'all', limit: 20
  }).items.find((item: any) => item.message_id === changedAnswerId).review_decision_count, 45)

  database.prepare('UPDATE search_documents SET content_hash = ? WHERE id = ?')
    .run('e'.repeat(64), 'resource:current')
  assert.equal(
    store.listAssistantConversationsPage({ revalidationStatus: 'invalid', limit: 20 })
      .items.some((item: any) => item.title === '当前有效会话'),
    true
  )
  assert.deepEqual(store.listAssistantAnswerReviewsPage({ status: 'all', limit: 20 }).counts, {
    attention: 5,
    invalid: 4,
    needs_review: 1,
    current: 0,
    pending: 5,
    resolved: 0
  })
  database.prepare(`
    DELETE FROM search_document_evidence WHERE document_id='resource:current'
  `).run()
  const ineligibleAnswer = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    query: '当前有效会话',
    limit: 20
  }).items[0]
  assert.equal(ineligibleAnswer.ineligible_statements, 1)
  assert.equal(ineligibleAnswer.content_changed_statements, 0)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'ineligible',
    query: '当前有效会话',
    limit: 20
  }).items[0].message_id, ineligibleAnswer.message_id)

  assert.equal(store.deleteAssistantConversation(currentConversationId), true)
  const dependencyStatsAfterDelete = store.getAssistantAnswerDependencyStats()
  assert.equal(dependencyStatsAfterDelete.messages, 4)
  assert.equal(dependencyStatsAfterDelete.statements, 4)
  assert.equal(dependencyStatsAfterDelete.dependencies, 4)
  assert.equal(store.listAssistantAnswerReviewsPage({ status: 'all', limit: 20 }).total, 4)
  assert.ok(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_answer_review_decisions WHERE message_id=?
  `).get(changedAnswerId).count) >= 3)
  assert.equal(store.deleteAssistantConversation(changedConversationId), true)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM assistant_answer_review_decisions WHERE message_id=?
  `).get(changedAnswerId).count), 0)
}))

test('assistant archive invalidates answers when structured evidence counts change outside hydration', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'person-answer-counts',
      type: 'person',
      canonicalName: '证据计数测试对象',
      aliases: [],
      accountIds: ['wxid-answer-counts'],
      trustStatus: 'confirmed'
    }],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-answer-counts',
    subjectId: 'person-answer-counts',
    predicate: '负责',
    objectValue: '证据计数项目',
    confidence: 0.9,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '证据计数测试对象负责证据计数项目',
    evidence: [{
      sourceId: 'wechat',
      messageId: 'answer-counts-1',
      sessionId: 'answer-counts-session',
      timestamp: 1,
      sender: '证据计数测试对象',
      excerpt: '我负责证据计数项目',
      evidenceRole: 'direct'
    }]
  }])
  const database = (store as any).db
  const document = database.prepare(`
    SELECT content_hash FROM search_documents WHERE id='claim:claim-answer-counts'
  `).get()
  const initialAuthorityRevision = store.getSearchDocumentById(
    'claim:claim-answer-counts'
  ).evidenceAuthorityRevision
  assert.ok(initialAuthorityRevision > 0)
  const scopedEvidencePayload = store.getDocumentEvidencePayload(
    'claim',
    'claim-answer-counts',
    { sessionId: 'answer-counts-session' }
  )
  assert.equal(scopedEvidencePayload.evidenceAuthorityRevision, initialAuthorityRevision)
  assert.equal(scopedEvidencePayload.evidenceScopeRestricted, true)
  const saved = store.saveAssistantExchangeDetailed(
    '谁负责证据计数项目？',
    '证据计数测试对象负责。',
    [{
      documentId: 'claim:claim-answer-counts',
      sourceId: 'claim-answer-counts',
      type: 'claim',
      title: '负责证据计数项目',
      contentHash: document.content_hash,
      evidenceSampleHash: 'a'.repeat(64),
      evidenceRoleCounts: { supporting: 1, contradiction: 0 },
      evidenceAuthorityRevision: initialAuthorityRevision
    }],
    undefined,
    {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [['claim:claim-answer-counts']]
    }
  )
  const initialDirectory = store.listAssistantConversationsPage({ limit: 20 })
  assert.equal(initialDirectory.items[0].revalidation_status, 'current')
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'current',
    messageId: saved.answerMessageId,
    limit: 10
  }).total, 1)
  assert.deepEqual(database.prepare(`
    SELECT evidence_sample_hash,evidence_supporting_count,evidence_contradiction_count,
      evidence_authority_revision
    FROM assistant_answer_dependencies WHERE message_id=?
  `).get(saved.answerMessageId), {
    evidence_sample_hash: 'a'.repeat(64),
    evidence_supporting_count: 1,
    evidence_contradiction_count: 0,
    evidence_authority_revision: initialAuthorityRevision
  })

  database.prepare(`
    INSERT INTO evidence(
      claim_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    'claim-answer-counts',
    'wechat',
    'answer-counts-2',
    'answer-counts-session',
    2,
    '证据计数测试对象',
    '补充一条没有改变结构化摘要的支持原文',
    'direct'
  )
  const insertedAuthorityRevision = store.getSearchDocumentById(
    'claim:claim-answer-counts'
  ).evidenceAuthorityRevision
  assert.ok(insertedAuthorityRevision > initialAuthorityRevision)
  const countChangedDirectory = store.listAssistantConversationsPage({
    revalidationStatus: 'invalid',
    limit: 20
  }).items[0]
  assert.equal(countChangedDirectory.id, saved.conversationId)
  assert.equal(countChangedDirectory.revalidation_evidence_counts_changed_statements, 1)
  assert.equal(countChangedDirectory.revalidation_content_changed_statements, 0)
  const attention = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    messageId: saved.answerMessageId,
    limit: 10
  })
  assert.equal(attention.total, 1)
  assert.equal(attention.items[0].revalidation_status, 'invalid')
  assert.equal(attention.items[0].evidence_counts_changed_statements, 1)
  assert.equal(attention.items[0].content_changed_statements, 0)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'evidence_counts_changed',
    messageId: saved.answerMessageId,
    limit: 10
  }).total, 1)
  const roleSensitive = store.saveAssistantExchangeDetailed(
    '当前两条都是支持证据吗？',
    '当前两条均为非反证原文。',
    [{
      documentId: 'claim:claim-answer-counts',
      sourceId: 'claim-answer-counts',
      type: 'claim',
      title: '负责证据计数项目',
      contentHash: document.content_hash,
      evidenceSampleHash: 'b'.repeat(64),
      evidenceRoleCounts: { supporting: 2, contradiction: 0 },
      evidenceAuthorityRevision: insertedAuthorityRevision
    }],
    undefined,
    {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [['claim:claim-answer-counts']]
    }
  )
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'current',
    messageId: roleSensitive.answerMessageId,
    limit: 10
  }).total, 1)
  database.prepare(`
    UPDATE evidence SET evidence_role='contradiction'
    WHERE claim_id='claim-answer-counts' AND message_id='answer-counts-2'
  `).run()
  const roleChangedAuthorityRevision = store.getSearchDocumentById(
    'claim:claim-answer-counts'
  ).evidenceAuthorityRevision
  assert.ok(roleChangedAuthorityRevision > insertedAuthorityRevision)
  const roleChangedReview = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    messageId: roleSensitive.answerMessageId,
    limit: 10
  })
  assert.equal(roleChangedReview.total, 1)
  assert.equal(roleChangedReview.items[0].evidence_counts_changed_statements, 1)
  const sameCountSensitive = store.saveAssistantExchangeDetailed(
    '原文内容本身后来改过吗？',
    '当前原文集合尚未发生进一步修正。',
    [{
      documentId: 'claim:claim-answer-counts',
      sourceId: 'claim-answer-counts',
      type: 'claim',
      title: '负责证据计数项目',
      contentHash: document.content_hash,
      evidenceSampleHash: 'c'.repeat(64),
      evidenceRoleCounts: { supporting: 1, contradiction: 1 },
      evidenceAuthorityRevision: roleChangedAuthorityRevision
    }],
    undefined,
    {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [['claim:claim-answer-counts']]
    }
  )
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'current',
    messageId: sameCountSensitive.answerMessageId,
    limit: 10
  }).total, 1)
  database.prepare(`
    UPDATE evidence SET excerpt='修正后的反证原文，数量与角色都不变'
    WHERE claim_id='claim-answer-counts' AND message_id='answer-counts-2'
  `).run()
  const excerptChangedAuthorityRevision = store.getSearchDocumentById(
    'claim:claim-answer-counts'
  ).evidenceAuthorityRevision
  assert.ok(excerptChangedAuthorityRevision > roleChangedAuthorityRevision)
  const sameCountReview = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'evidence_changed',
    messageId: sameCountSensitive.answerMessageId,
    limit: 10
  })
  assert.equal(sameCountReview.total, 1)
  assert.equal(sameCountReview.items[0].evidence_changed_statements, 1)
  assert.equal(sameCountReview.items[0].evidence_counts_changed_statements, 0)
  database.prepare(`
    DELETE FROM evidence
    WHERE claim_id='claim-answer-counts' AND message_id='answer-counts-2'
  `).run()
  assert.ok(store.getSearchDocumentById(
    'claim:claim-answer-counts'
  ).evidenceAuthorityRevision > excerptChangedAuthorityRevision)
  assert.equal(store.listAssistantConversationsPage({
    offset: 1,
    limit: 20,
    revision: initialDirectory.revision
  }).stale, true)
}))

test('structured evidence revision triggers self-heal across a SQLCipher reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-evidence-revision-ledger-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'person-revision-ledger',
        type: 'person',
        canonicalName: '修订账本测试对象',
        aliases: [],
        accountIds: ['wxid-revision-ledger'],
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'claim-revision-ledger',
      subjectId: 'person-revision-ledger',
      predicate: '状态',
      objectValue: '初始',
      confidence: 0.9,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '修订账本测试对象状态初始',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'revision-ledger-message',
        sessionId: 'revision-ledger-session',
        timestamp: 1,
        sender: '修订账本测试对象',
        excerpt: '初始原文',
        evidenceRole: 'direct'
      }]
    }])
    const initialRevision = first.getSearchDocumentById(
      'claim:claim-revision-ledger'
    ).evidenceAuthorityRevision
    assert.ok(initialRevision > 0)
    const initialHealth = first.getStructuredEvidenceRevisionHealth()
    assert.equal(initialHealth.version, 1)
    assert.equal(initialHealth.rows, 1)
    assert.equal(initialHealth.triggers, 3)
    assert.equal(initialHealth.expectedTriggers, 3)
    assert.equal(initialHealth.validTriggers, 3)
    assert.equal(initialHealth.healthy, true)
    assert.deepEqual(initialHealth.unhealthyTriggers, [])
    assert.deepEqual(initialHealth.unexpectedTriggers, [])
    assert.equal(initialHealth.repairedThisStart, false)
    ;(first as any).db.exec(`
      DROP TRIGGER structured_evidence_revision_update;
      CREATE TRIGGER structured_evidence_revision_update
      AFTER UPDATE ON evidence BEGIN SELECT 1; END;
      DROP TRIGGER structured_evidence_revision_delete;
      CREATE TRIGGER structured_evidence_revision_unexpected
      AFTER INSERT ON evidence BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getStructuredEvidenceRevisionHealth()
    assert.equal(driftedHealth.triggers, 3)
    assert.equal(driftedHealth.expectedTriggers, 3)
    assert.equal(driftedHealth.validTriggers, 1)
    assert.equal(driftedHealth.healthy, false)
    assert.deepEqual(driftedHealth.unhealthyTriggers, [
      'structured_evidence_revision_delete',
      'structured_evidence_revision_update'
    ])
    assert.deepEqual(driftedHealth.unexpectedTriggers, [
      'structured_evidence_revision_unexpected'
    ])
    first.close()

    reopened.initialize(databasePath)
    const repairedHealth = reopened.getStructuredEvidenceRevisionHealth()
    assert.equal(repairedHealth.triggers, 3)
    assert.equal(repairedHealth.expectedTriggers, 3)
    assert.equal(repairedHealth.validTriggers, 3)
    assert.equal(repairedHealth.healthy, true)
    assert.deepEqual(repairedHealth.unhealthyTriggers, [])
    assert.deepEqual(repairedHealth.unexpectedTriggers, [])
    assert.equal(repairedHealth.repairedThisStart, true)
    assert.equal(repairedHealth.repairedTriggersThisStart, 3)
    assert.deepEqual(repairedHealth.repairedTriggerNames, [
      'structured_evidence_revision_delete',
      'structured_evidence_revision_unexpected',
      'structured_evidence_revision_update'
    ])
    ;(reopened as any).db.prepare(`
      UPDATE evidence SET excerpt='重启后修正的原文'
      WHERE claim_id='claim-revision-ledger' AND message_id='revision-ledger-message'
    `).run()
    const repairedRevision = reopened.getSearchDocumentById(
      'claim:claim-revision-ledger'
    ).evidenceAuthorityRevision
    assert.ok(repairedRevision > initialRevision)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('general evidence revisions invalidate answers and self-heal exact trigger drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-general-evidence-revision-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    const database = (first as any).db
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO search_documents(
        id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'resource:general-revision',
      'resource',
      'general-revision',
      '通用证据修订',
      '通用证据修订正文',
      '{}',
      'd'.repeat(64),
      now
    )
    database.prepare(`
      INSERT INTO search_document_evidence(
        document_id,source_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'resource:general-revision',
      'documents',
      'general-revision-message',
      'data-source:documents:general-revision',
      1,
      '文档',
      '第一版通用原文'
    )
    const resourceRevision = first.getSearchDocumentById(
      'resource:general-revision'
    ).evidenceAuthorityRevision
    assert.ok(resourceRevision > 0)
    const saved = first.saveAssistantExchangeDetailed(
      '通用证据现在是什么？',
      '当前由第一版通用原文支持。',
      [{
        documentId: 'resource:general-revision',
        sourceId: 'general-revision',
        type: 'resource',
        title: '通用证据修订',
        contentHash: 'd'.repeat(64),
        evidenceAuthorityRevision: resourceRevision
      }],
      undefined,
      {
        version: 'statement-citations-v1',
        proposedStatements: 1,
        acceptedStatements: 1,
        rejectedStatements: 0,
        acceptedCitationIds: 1,
        statementCitations: [['resource:general-revision']]
      }
    )
    assert.equal(first.listAssistantAnswerReviewsPage({
      status: 'current',
      reviewState: 'all',
      messageId: saved.answerMessageId,
      limit: 10
    }).total, 1)
    database.prepare(`
      UPDATE search_document_evidence SET excerpt='第二版通用原文'
      WHERE document_id='resource:general-revision'
        AND message_id='general-revision-message'
    `).run()
    assert.ok(first.getSearchDocumentById(
      'resource:general-revision'
    ).evidenceAuthorityRevision > resourceRevision)
    const invalid = first.listAssistantAnswerReviewsPage({
      status: 'invalid',
      reviewState: 'all',
      invalidReason: 'evidence_changed',
      messageId: saved.answerMessageId,
      limit: 10
    })
    assert.equal(invalid.total, 1)
    assert.equal(invalid.items[0].evidence_changed_statements, 1)

    first.syncGraph({
      entities: [{
        id: 'person-general-revision',
        type: 'person',
        canonicalName: '身份原文修订对象',
        aliases: [],
        accountIds: ['wxid-general-revision'],
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    })
    database.prepare(`
      INSERT INTO entity_evidence(
        entity_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_kind
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'person-general-revision',
      'wechat',
      'entity-general-revision-message',
      'entity-general-revision-session',
      2,
      '身份原文修订对象',
      '第一版身份原文',
      'identity'
    )
    const entityRevision = first.getSearchDocumentById(
      'entity:person-general-revision'
    ).evidenceAuthorityRevision
    assert.ok(entityRevision > 0)
    database.prepare(`
      UPDATE entity_evidence SET excerpt='第二版身份原文'
      WHERE entity_id='person-general-revision'
    `).run()
    assert.ok(first.getSearchDocumentById(
      'entity:person-general-revision'
    ).evidenceAuthorityRevision > entityRevision)

    const initialHealth = first.getGeneralEvidenceRevisionHealth()
    assert.equal(initialHealth.rows, 2)
    assert.equal(initialHealth.triggers, 6)
    assert.equal(initialHealth.validTriggers, 6)
    assert.equal(initialHealth.healthy, true)
    database.exec(`
      DROP TRIGGER general_evidence_revision_search_update;
      CREATE TRIGGER general_evidence_revision_search_update
      AFTER UPDATE ON search_document_evidence BEGIN SELECT 1; END;
      DROP TRIGGER general_evidence_revision_entity_delete;
      CREATE TRIGGER general_evidence_revision_unexpected
      AFTER INSERT ON entity_evidence BEGIN SELECT 1; END;
    `)
    const driftedHealth = first.getGeneralEvidenceRevisionHealth()
    assert.equal(driftedHealth.healthy, false)
    assert.equal(driftedHealth.validTriggers, 4)
    assert.deepEqual(driftedHealth.unhealthyTriggers, [
      'general_evidence_revision_entity_delete',
      'general_evidence_revision_search_update'
    ])
    assert.deepEqual(driftedHealth.unexpectedTriggers, [
      'general_evidence_revision_unexpected'
    ])
    first.close()

    reopened.initialize(databasePath)
    const repairedHealth = reopened.getGeneralEvidenceRevisionHealth()
    assert.equal(repairedHealth.triggers, 6)
    assert.equal(repairedHealth.validTriggers, 6)
    assert.equal(repairedHealth.healthy, true)
    assert.equal(repairedHealth.repairedThisStart, true)
    assert.equal(repairedHealth.repairedTriggersThisStart, 3)
    assert.deepEqual(repairedHealth.repairedTriggerNames, [
      'general_evidence_revision_entity_delete',
      'general_evidence_revision_search_update',
      'general_evidence_revision_unexpected'
    ])
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('scoped answer dependencies stay current until their authority revision changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-scoped-answer-dependency-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const reopened = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'person-scoped-answer',
        type: 'person',
        canonicalName: '范围回答对象',
        aliases: [],
        accountIds: ['wxid-scoped-answer'],
        trustStatus: 'confirmed'
      }],
      relations: [],
      reviewQueue: []
    })
    first.upsertClaims([{
      id: 'claim-scoped-answer',
      subjectId: 'person-scoped-answer',
      predicate: '状态',
      objectValue: '进行中',
      confidence: 0.9,
      status: 'confirmed',
      sourceNature: 'self_statement',
      searchText: '范围回答对象状态进行中',
      evidence: [{
        sourceId: 'wechat',
        messageId: 'scoped-answer-message-a',
        sessionId: 'scoped-answer-session-a',
        timestamp: 1,
        sender: '范围回答对象',
        excerpt: '会话 A 的范围内原文',
        evidenceRole: 'direct'
      }, {
        sourceId: 'wechat',
        messageId: 'scoped-answer-message-b',
        sessionId: 'scoped-answer-session-b',
        timestamp: 2,
        sender: '范围回答对象',
        excerpt: '会话 B 的范围外原文',
        evidenceRole: 'direct'
      }]
    }])
    const scopedDocument = first.getSearchDocumentById(
      'claim:claim-scoped-answer',
      { sessionId: 'scoped-answer-session-a' }
    )
    assert.equal(scopedDocument.evidenceTotal, 1)
    assert.equal(scopedDocument.evidenceScopeRestricted, true)
    assert.ok(scopedDocument.evidenceAuthorityRevision > 0)
    const saved = first.saveAssistantExchangeDetailed(
      '只看会话 A，现在是什么状态？',
      '会话 A 的证据显示正在进行。',
      [{
        documentId: 'claim:claim-scoped-answer',
        sourceId: 'claim-scoped-answer',
        type: 'claim',
        title: '范围回答对象状态',
        contentHash: scopedDocument.content_hash,
        evidenceSampleHash: 'a'.repeat(64),
        evidenceRoleCounts: scopedDocument.evidenceRoleCounts,
        evidenceAuthorityRevision: scopedDocument.evidenceAuthorityRevision,
        evidenceScopeRestricted: true,
        feedbackContext: {
          query: '只看会话 A，现在是什么状态？',
          options: {
            sessionId: 'scoped-answer-session-a',
            documentTypes: ['claim']
          },
          version: 'memory-search-feedback-v2'
        }
      }],
      undefined,
      {
        version: 'statement-citations-v1',
        proposedStatements: 1,
        acceptedStatements: 1,
        rejectedStatements: 0,
        acceptedCitationIds: 1,
        statementCitations: [['claim:claim-scoped-answer']]
      }
    )
    const dependency = (first as any).db.prepare(`
      SELECT evidence_scope_restricted,evidence_authority_revision,
        evidence_supporting_count
      FROM assistant_answer_dependencies WHERE message_id=?
    `).get(saved.answerMessageId)
    assert.equal(dependency.evidence_scope_restricted, 1)
    assert.equal(dependency.evidence_supporting_count, 1)
    assert.equal(first.listAssistantAnswerReviewsPage({
      status: 'current',
      reviewState: 'all',
      messageId: saved.answerMessageId,
      limit: 10
    }).total, 1)

    ;(first as any).db.prepare(`
      UPDATE evidence SET excerpt='会话 B 修正，但会话 A 原文未变'
      WHERE claim_id='claim-scoped-answer'
        AND session_id='scoped-answer-session-b'
    `).run()
    const review = first.listAssistantAnswerReviewsPage({
      status: 'needs_review',
      reviewState: 'all',
      messageId: saved.answerMessageId,
      limit: 10
    })
    assert.equal(review.total, 1)
    assert.equal(review.items[0].invalid_statements, 0)
    assert.equal(review.items[0].unknown_statements, 1)
    assert.equal(review.items[0].scoped_evidence_review_statements, 1)
    assert.equal(first.listAssistantAnswerReviewsPage({
      status: 'invalid',
      reviewState: 'all',
      messageId: saved.answerMessageId,
      limit: 10
    }).total, 0)
    first.close()

    reopened.initialize(databasePath)
    const persisted = reopened.listAssistantAnswerReviewsPage({
      status: 'needs_review',
      reviewState: 'all',
      messageId: saved.answerMessageId,
      limit: 10
    })
    assert.equal(persisted.total, 1)
    assert.equal(persisted.items[0].scoped_evidence_review_statements, 1)
    const answer = reopened.getAssistantConversation(saved.conversationId, 10)
      .messages.find((item: any) => item.id === saved.answerMessageId)
    assert.equal(answer.citations[0].evidenceScopeRestricted, true)
  } finally {
    first.close()
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('assistant archive does not report a failed citation when the same statement has current backup', () => withStore(store => {
  const database = (store as any).db
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO search_documents(
      id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    'resource:backup-current',
    'resource',
    'backup-current',
    '仍然有效的备用来源',
    '同一陈述仍有一项当前证据',
    '{}',
    'c'.repeat(64),
    now
  )
  database.prepare(`
    INSERT INTO search_document_evidence(
      document_id,source_id,message_id,session_id,timestamp,sender,excerpt
    ) VALUES(?,?,?,?,?,?,?)
  `).run(
    'resource:backup-current',
    'documents',
    'backup-current-message',
    'data-source:documents:backup',
    1,
    '文档',
    '当前备用原文'
  )
  const saved = store.saveAssistantExchangeDetailed(
    '有一项引用删除后，这个陈述还成立吗？',
    '仍有另一项当前证据支持。',
    [{
      documentId: 'resource:removed-primary',
      sourceId: 'removed-primary',
      type: 'resource',
      title: '已删除的主来源',
      contentHash: 'a'.repeat(64)
    }, {
      documentId: 'resource:backup-current',
      sourceId: 'backup-current',
      type: 'resource',
      title: '仍然有效的备用来源',
      contentHash: 'c'.repeat(64)
    }],
    undefined,
    {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 2,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [[
        'resource:removed-primary',
        'resource:backup-current'
      ]]
    }
  )
  const directory = store.listAssistantConversationsPage({ limit: 10 }).items[0]
  assert.equal(directory.id, saved.conversationId)
  assert.equal(directory.revalidation_status, 'current')
  assert.equal(directory.revalidation_missing_statements, 0)
  assert.equal(directory.revalidation_invalid_statements, 0)
  const review = store.listAssistantAnswerReviewsPage({
    status: 'current',
    messageId: saved.answerMessageId,
    limit: 10
  }).items[0]
  assert.equal(review.missing_statements, 0)
  assert.equal(review.invalid_statements, 0)
}))

test('assistant invalid-reason filters run before stable pagination', () => withStore(store => {
  const save = (question: string, documentId: string, contentHash: string) =>
    store.saveAssistantExchange(question, `${question}回答`, [{
      documentId,
      sourceId: documentId.split(':')[1],
      type: 'resource',
      title: documentId,
      contentHash
    }], undefined, {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      statementCitations: [[documentId]]
    })
  for (let index = 0; index < 75; index += 1) {
    save(`较早的删除来源 ${index}`, `resource:missing-${index}`, 'a'.repeat(64))
  }
  const database = (store as any).db
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO search_documents(
      id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    'resource:later-content-change',
    'resource',
    'later-content-change',
    '较新的正文变化来源',
    '当前正文',
    '{}',
    'b'.repeat(64),
    now
  )
  database.prepare(`
    INSERT INTO search_document_evidence(
      document_id,source_id,message_id,session_id,timestamp,sender,excerpt
    ) VALUES(?,?,?,?,?,?,?)
  `).run(
    'resource:later-content-change',
    'documents',
    'later-content-change-message',
    'data-source:documents:reason-pagination',
    1,
    '文档',
    '当前原文'
  )
  for (let index = 0; index < 15; index += 1) {
    save(`较新的正文变化 ${index}`, 'resource:later-content-change', 'a'.repeat(64))
  }

  const first = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'missing',
    limit: 30
  })
  const second = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'missing',
    offset: 30,
    limit: 30,
    revision: first.revision
  })
  const last = store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'missing',
    offset: 60,
    limit: 30,
    revision: first.revision
  })
  assert.equal(first.total, 75)
  assert.deepEqual(first.reasonCounts, {
    missing: 75,
    ineligible: 0,
    contentChanged: 15,
    evidenceCountsChanged: 0,
    evidenceChanged: 0,
    other: 0
  })
  assert.equal(first.items.length, 30)
  assert.equal(second.items.length, 30)
  assert.equal(last.items.length, 15)
  assert.equal(last.hasMore, false)
  assert.equal(new Set([...first.items, ...second.items, ...last.items]
    .map((item: any) => item.message_id)).size, 75)
  assert.equal([...first.items, ...second.items, ...last.items]
    .every((item: any) => item.missing_statements === 1), true)
  assert.equal(store.listAssistantAnswerReviewsPage({
    status: 'invalid',
    reviewState: 'all',
    invalidReason: 'content_changed',
    limit: 30
  }).total, 15)
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
    const firstDatabase = (first as any).db
    firstDatabase.prepare(`
      INSERT INTO search_documents(
        id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'resource:reopen-review', 'resource', 'reopen-review', '重启核验证据',
      '重启后仍应可核验', '{}', 'f'.repeat(64), new Date().toISOString()
    )
    firstDatabase.prepare(`
      INSERT INTO search_document_evidence(
        document_id,source_id,message_id,session_id,timestamp,sender,excerpt
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      'resource:reopen-review', 'documents', 'reopen-review-message',
      'data-source:documents:reopen', 1, '文档', '重启核验原文'
    )
    first.saveAssistantExchange('重启核验问题', '重启核验回答', [{
      documentId: 'resource:reopen-review',
      sourceId: 'reopen-review',
      type: 'resource',
      title: '重启核验证据',
      contentHash: 'f'.repeat(64)
    }], conversationId, {
      version: 'statement-citations-v1',
      proposedStatements: 1,
      acceptedStatements: 1,
      rejectedStatements: 0,
      acceptedCitationIds: 1,
      promptIsolationVersion: 'untrusted-memory-envelope-v1',
      sourcePrivacyAudit: {
        version: 'model-source-privacy-v2',
        policy: {
          wechat: true, documents: true, calendar: false, mail: true, unknown: false
        },
        contextDocuments: 1,
        privacyExcludedDocuments: 4,
        budgetOmittedDocuments: 2,
        contextSourceIds: ['documents'],
        excludedSourceIds: ['calendar', 'legacy'],
        incompleteSourceDocuments: 1,
        outboundSha256: 'd'.repeat(64),
        redaction: { level: 'standard', total: 1, counts: { 邮箱: 1 } },
        boundaryChecks: ['before_send', 'after_response']
      },
      statementCitations: [['resource:reopen-review']]
    })
    const reviewAnswerId = String(firstDatabase.prepare(`
      SELECT id FROM assistant_messages
      WHERE conversation_id=? AND role='assistant' AND content='重启核验回答'
    `).get(conversationId)?.id || '')
    firstDatabase.prepare(`
      UPDATE search_documents SET content_hash=? WHERE id='resource:reopen-review'
    `).run('e'.repeat(64))
    const visibleReview = first.listAssistantAnswerReviewsPage({
      status: 'all',
      reviewState: 'all',
      messageId: reviewAnswerId,
      limit: 1
    }).items[0]
    first.reviewAssistantAnswer(
      reviewAnswerId,
      'acknowledged',
      visibleReview.mutation_token
    )
    const rawGrounding = JSON.parse(String(firstDatabase.prepare(`
      SELECT grounding_json FROM assistant_messages WHERE id=?
    `).get(reviewAnswerId)?.grounding_json || '{}'))
    rawGrounding.sourcePrivacyAudit.excludedSourceIds = [
      'calendar',
      'legacy',
      'mailbox:owner@example.test'
    ]
    rawGrounding.sourcePrivacyAudit.rawOutbound = '不应保留的旧版请求正文'
    firstDatabase.prepare(`
      UPDATE assistant_messages SET grounding_json=? WHERE id=?
    `).run(JSON.stringify(rawGrounding), reviewAnswerId)
    firstDatabase.prepare(`
      DELETE FROM schema_meta WHERE key='assistant_source_privacy_storage_v1'
    `).run()
    first.close()

    second.initialize(databasePath, key)
    const archive = second.listAssistantConversationsPage({ query: '重启前问题', limit: 10 })
    assert.equal(archive.total, 1)
    assert.equal(archive.items[0].message_count, 62)
    const latest = second.getAssistantConversation(conversationId, { offset: 0, limit: 20 })
    assert.equal(second.getAssistantConversation(
      conversationId,
      { offset: 20, limit: 42 }
    ).stale, true)
    const older = second.getAssistantConversation(conversationId, {
      offset: 20,
      limit: 42,
      revision: latest.revision
    })
    assert.equal(latest.hasOlder, true)
    assert.equal(older.hasOlder, false)
    assert.equal(new Set([...latest.messages, ...older.messages].map((message: any) => message.id)).size, 62)
    const reopenedPrivacyAudit = [...latest.messages, ...older.messages]
      .find((message: any) => message.id === reviewAnswerId)?.groundingAudit?.sourcePrivacyAudit
    assert.equal(reopenedPrivacyAudit.version, 'model-source-privacy-v2')
    assert.equal(reopenedPrivacyAudit.policy.mail, true)
    assert.deepEqual(reopenedPrivacyAudit.contextSourceIds, ['documents'])
    assert.deepEqual(reopenedPrivacyAudit.excludedSourceIds, ['calendar', 'legacy', 'unknown'])
    assert.equal(reopenedPrivacyAudit.outboundSha256, 'd'.repeat(64))
    assert.deepEqual(reopenedPrivacyAudit.boundaryChecks, ['before_send', 'after_response'])
    const privacyStorage = second.getAssistantSourcePrivacyStorageStats()
    assert.equal(privacyStorage.policy, 'category_only_no_connector_identity')
    assert.equal(privacyStorage.privacyAudits, 1)
    assert.equal(privacyStorage.unknownSourceIdsCollapsed, 1)
    assert.ok(privacyStorage.updatedMessages >= 1)
    const repairedGrounding = String((second as any).db.prepare(`
      SELECT grounding_json FROM assistant_messages WHERE id=?
    `).get(reviewAnswerId)?.grounding_json || '')
    assert.equal(repairedGrounding.includes('owner@example.test'), false)
    assert.equal(repairedGrounding.includes('不应保留的旧版请求正文'), false)
    const answerReviews = second.listAssistantAnswerReviewsPage({
      status: 'invalid',
      query: '重启核验问题',
      limit: 10
    })
    assert.equal(answerReviews.total, 1)
    assert.equal(answerReviews.items[0].question_preview, '重启核验问题')
    assert.equal(answerReviews.items[0].revalidation_status, 'invalid')
    const decisionArchive = second.listAssistantAnswerReviewDecisionsPage(reviewAnswerId)
    assert.equal(decisionArchive.total, 1)
    assert.equal(decisionArchive.items[0].action, 'acknowledged')
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('model request audit is privacy-minimized, revision-paged and recovers interrupted sends', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-model-request-audit-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const baseAudit = {
      version: 'model-source-privacy-v2',
      policy: {
        wechat: true, documents: true, calendar: false, mail: false, unknown: false
      },
      contextDocuments: 2,
      privacyExcludedDocuments: 1,
      budgetOmittedDocuments: 0,
      contextSourceIds: ['wechat', 'mailbox:owner@example.test'],
      excludedSourceIds: ['calendar', 'connector:secret@example.test'],
      incompleteSourceDocuments: 1,
      outboundSha256: 'a'.repeat(64),
      redaction: { level: 'strict', total: 2, counts: { 邮箱: 2 } },
      boundaryChecks: ['before_send'],
      rawPrompt: '不应写入模型发送审计的原始问题'
    }
    const receivedId = first.recordAssistantModelRequestStarted(baseAudit, 'deepseek-test')
    first.finishAssistantModelRequestAudit(receivedId, 'response_received')
    const committedExchange = first.saveAssistantExchangeDetailed(
      '端到端审计问题',
      '端到端审计回答',
      [],
      undefined,
      {},
      '',
      { modelRequestAuditId: receivedId }
    )
    const committedConversationId = committedExchange.conversationId
    const failedId = first.recordAssistantModelRequestStarted({
      ...baseAudit,
      outboundSha256: 'b'.repeat(64)
    }, 'deepseek-test')
    first.finishAssistantModelRequestAudit(failedId, 'failed', 'timeout')
    first.recordAssistantModelRequestStarted({
      ...baseAudit,
      outboundSha256: 'c'.repeat(64)
    }, 'deepseek-test')

    const firstPage = first.listAssistantModelRequestAuditsPage({ limit: 2 })
    assert.equal(firstPage.total, 3)
    assert.equal(firstPage.items.length, 2)
    assert.deepEqual(firstPage.counts, {
      sending: 1,
      response_received: 1,
      failed: 1,
      interrupted: 0
    })
    assert.deepEqual(firstPage.answerCounts, {
      processing: 0,
      committed: 1,
      rejected: 0,
      interrupted: 0,
      not_applicable: 1,
      legacy_unknown: 0
    })
    assert.deepEqual(firstPage.items[0].sourcePrivacyAudit.contextSourceIds, [
      'unknown', 'wechat'
    ])
    assert.deepEqual(firstPage.items[0].sourcePrivacyAudit.excludedSourceIds, [
      'calendar', 'unknown'
    ])
    assert.equal(firstPage.items[0].sourcePrivacyAudit.rawPrompt, undefined)
    const committedAudit = first.listAssistantModelRequestAuditsPage({
      answerOutcome: 'committed',
      limit: 10
    }).items.find((item: any) => item.id === receivedId)
    assert.equal(committedAudit?.conversation_id, committedExchange.conversationId)
    assert.equal(committedAudit?.answer_message_id, committedExchange.answerMessageId)
    const rawAudit = String((first as any).db.prepare(`
      SELECT GROUP_CONCAT(audit_json, '') AS payload
      FROM assistant_model_request_audits
    `).get()?.payload || '')
    assert.equal(rawAudit.includes('owner@example.test'), false)
    assert.equal(rawAudit.includes('secret@example.test'), false)
    assert.equal(rawAudit.includes('原始问题'), false)
    const rawCommittedLink = (first as any).db.prepare(`
      SELECT conversation_id,answer_message_id
      FROM assistant_model_request_audits WHERE id=?
    `).get(receivedId)
    assert.equal(rawCommittedLink.conversation_id, committedExchange.conversationId)
    assert.equal(rawCommittedLink.answer_message_id, committedExchange.answerMessageId)
    const rawAuditRow = JSON.stringify((first as any).db.prepare(`
      SELECT * FROM assistant_model_request_audits WHERE id=?
    `).get(receivedId))
    assert.equal(rawAuditRow.includes('端到端审计问题'), false)
    assert.equal(rawAuditRow.includes('端到端审计回答'), false)

    const staleRevision = firstPage.revision
    const processingId = first.recordAssistantModelRequestStarted({
      ...baseAudit,
      outboundSha256: 'd'.repeat(64)
    }, 'deepseek-test')
    first.finishAssistantModelRequestAudit(processingId, 'response_received')
    const rejectedId = first.recordAssistantModelRequestStarted({
      ...baseAudit,
      outboundSha256: 'e'.repeat(64)
    }, 'deepseek-test')
    first.finishAssistantModelRequestAudit(rejectedId, 'response_received')
    first.finishAssistantModelRequestAnswerAudit(
      rejectedId,
      'rejected',
      'invalid_model_json'
    )
    assert.equal(first.listAssistantModelRequestAuditsPage({
      offset: 2,
      limit: 2,
      revision: staleRevision
    }).stale, true)
    first.close()

    second.initialize(databasePath, key)
    const reopened = second.listAssistantModelRequestAuditsPage({ limit: 10 })
    assert.equal(reopened.total, 5)
    assert.deepEqual(reopened.counts, {
      sending: 0,
      response_received: 3,
      failed: 1,
      interrupted: 1
    })
    assert.deepEqual(reopened.answerCounts, {
      processing: 0,
      committed: 1,
      rejected: 1,
      interrupted: 1,
      not_applicable: 2,
      legacy_unknown: 0
    })
    const reopenedCommitted = reopened.items.find((item: any) => item.id === receivedId)
    assert.equal(reopenedCommitted?.conversation_id, committedConversationId)
    assert.equal(reopenedCommitted?.answer_message_id, committedExchange.answerMessageId)
    assert.equal(second.getAssistantConversation(committedConversationId)?.messages.length, 2)
    const linkedRevision = reopened.revision
    assert.equal(second.deleteAssistantConversation(committedConversationId), true)
    assert.equal(second.listAssistantModelRequestAuditsPage({
      offset: 1,
      limit: 1,
      revision: linkedRevision
    }).stale, true)
    const afterConversationDeletion = second.listAssistantModelRequestAuditsPage({
      answerOutcome: 'committed',
      limit: 10
    })
    assert.equal(afterConversationDeletion.total, 1)
    assert.equal(afterConversationDeletion.items[0].conversation_id, '')
    assert.equal(afterConversationDeletion.items[0].answer_message_id, '')
    assert.equal(afterConversationDeletion.items[0].answer_outcome, 'committed')
    const clearedCommittedLink = (second as any).db.prepare(`
      SELECT conversation_id,answer_message_id
      FROM assistant_model_request_audits WHERE id=?
    `).get(receivedId)
    assert.equal(clearedCommittedLink.conversation_id, '')
    assert.equal(clearedCommittedLink.answer_message_id, '')
    assert.equal(second.getAssistantModelRequestAuditStats().linkIntegrity.orphaned, 0)
    assert.equal(reopened.items.filter((item: any) =>
      item.status === 'interrupted' &&
      item.outcome_code === 'process_interrupted'
    ).length, 1)
    assert.equal(reopened.items.some((item: any) =>
      item.answer_outcome === 'interrupted' &&
      item.answer_outcome_code === 'process_interrupted_after_response'
    ), true)
    assert.equal(reopened.items.some((item: any) =>
      item.answer_outcome === 'rejected' &&
      item.answer_outcome_code === 'invalid_model_json'
    ), true)
    const unusableAuditId = second.recordAssistantModelRequestStarted({
      ...baseAudit,
      outboundSha256: 'f'.repeat(64)
    }, 'deepseek-test')
    second.finishAssistantModelRequestAudit(unusableAuditId, 'failed', 'timeout')
    assert.throws(() => second.saveAssistantExchangeDetailed(
      '不应提交的问题',
      '不应提交的回答',
      [],
      undefined,
      {},
      '',
      { modelRequestAuditId: unusableAuditId }
    ), /模型发送审计状态已经变化/)
    assert.equal(second.listAssistantConversationsPage({
      query: '不应提交的问题',
      limit: 10
    }).total, 0)
    const unusableAudit = second.listAssistantModelRequestAuditsPage({
      status: 'failed',
      limit: 10
    }).items.find((item: any) => item.id === unusableAuditId)
    assert.equal(unusableAudit?.conversation_id, '')
    assert.equal(unusableAudit?.answer_message_id, '')
    assert.equal(second.getAssistantModelRequestAuditStats().policy,
      'category_only_digest_no_prompt_v1')
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('model answer audit links delete atomically and orphan drift self-heals on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-model-answer-link-repair-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const auditId = first.recordAssistantModelRequestStarted({
      version: 'model-source-privacy-v2',
      policy: {
        wechat: true, documents: false, calendar: false, mail: false, unknown: false
      },
      contextDocuments: 1,
      privacyExcludedDocuments: 0,
      budgetOmittedDocuments: 0,
      contextSourceIds: ['wechat'],
      excludedSourceIds: [],
      incompleteSourceDocuments: 0,
      outboundSha256: '9'.repeat(64),
      redaction: { level: 'standard', total: 0, counts: {} },
      boundaryChecks: ['before_send']
    }, 'deepseek-link-repair-test')
    first.finishAssistantModelRequestAudit(auditId, 'response_received')
    const exchange = first.saveAssistantExchangeDetailed(
      '链接事务问题',
      '链接事务回答',
      [],
      undefined,
      {},
      '',
      { modelRequestAuditId: auditId }
    )
    const db = (first as any).db
    db.exec(`
      DROP TRIGGER trg_assistant_model_request_audit_answer_delete;
      CREATE TRIGGER trg_assistant_model_request_audit_answer_delete
      BEFORE DELETE ON assistant_messages
      WHEN OLD.id='${exchange.answerMessageId}'
      BEGIN
        SELECT RAISE(ABORT,'forced link cleanup failure');
      END;
    `)
    assert.equal(first.getDiagnostics().modelRequestAuditLinkIntegrityHealthy, false)
    assert.throws(
      () => first.deleteAssistantConversation(exchange.conversationId),
      /forced link cleanup failure/
    )
    assert.equal(first.getAssistantConversation(exchange.conversationId)?.messages.length, 2)
    assert.equal(db.prepare(`
      SELECT answer_message_id FROM assistant_model_request_audits WHERE id=?
    `).get(auditId).answer_message_id, exchange.answerMessageId)

    db.exec('DROP TRIGGER trg_assistant_model_request_audit_answer_delete')
    db.prepare('DELETE FROM assistant_messages WHERE id=?').run(exchange.answerMessageId)
    assert.equal(db.prepare(`
      SELECT answer_message_id FROM assistant_model_request_audits WHERE id=?
    `).get(auditId).answer_message_id, exchange.answerMessageId)
    first.close()

    second.initialize(databasePath, key)
    const stats = second.getAssistantModelRequestAuditStats()
    assert.equal(stats.linkIntegrity.scannedThisStart, 1)
    assert.equal(stats.linkIntegrity.clearedThisStart, 1)
    assert.equal(stats.linkIntegrity.orphaned, 0)
    assert.equal(stats.linkIntegrity.deleteTriggerHealthy, true)
    assert.equal(stats.linkIntegrity.triggerRepairedThisStart, true)
    const diagnostics = second.getDiagnostics()
    assert.equal(diagnostics.modelRequestAuditLinkIntegrityHealthy, true)
    assert.equal(diagnostics.modelRequestAuditLinkIntegrity.orphaned, 0)
    const repaired = (second as any).db.prepare(`
      SELECT conversation_id,answer_message_id
      FROM assistant_model_request_audits WHERE id=?
    `).get(auditId)
    assert.equal(repaired.conversation_id, '')
    assert.equal(repaired.answer_message_id, '')
    const publicAudit = second.listAssistantModelRequestAuditsPage({
      answerOutcome: 'committed',
      limit: 10
    }).items[0]
    assert.equal(publicAudit.conversation_id, '')
    assert.equal(publicAudit.answer_message_id, '')
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('transport-only model request audits upgrade without inventing answer success', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-model-request-audit-upgrade-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const db = (first as any).db
    const triggerNames = (db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='trigger' AND name LIKE 'trg_assistant_model_request_audit_revision_%'
    `).all() as any[]).map(row => String(row.name || ''))
    for (const name of triggerNames) {
      db.exec(`DROP TRIGGER IF EXISTS "${name.replace(/"/g, '""')}"`)
    }
    db.exec(`
      DROP TABLE assistant_model_request_audits;
      CREATE TABLE assistant_model_request_audits (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN (
          'sending','response_received','failed','interrupted'
        )),
        outcome_code TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        audit_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE INDEX idx_assistant_model_request_audits_time
        ON assistant_model_request_audits(started_at DESC,id DESC);
      CREATE INDEX idx_assistant_model_request_audits_status_time
        ON assistant_model_request_audits(status,started_at DESC,id DESC);
    `)
    db.prepare(`
      INSERT INTO assistant_model_request_audits(
        status,outcome_code,model,audit_json,started_at,completed_at
      ) VALUES('response_received','response_received','legacy-model','{}',?,?)
    `).run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:01.000Z')
    first.close()

    second.initialize(databasePath, key)
    const upgraded = second.listAssistantModelRequestAuditsPage({ limit: 10 })
    assert.equal(upgraded.total, 1)
    assert.equal(upgraded.items[0].answer_outcome, 'legacy_unknown')
    assert.equal(upgraded.items[0].answer_outcome_code, 'legacy_transport_only')
    assert.equal(upgraded.answerCounts.legacy_unknown, 1)
    assert.equal((second as any).db.prepare(`
      SELECT COUNT(*) AS count FROM pragma_table_info('assistant_model_request_audits')
      WHERE name IN (
        'answer_outcome','answer_outcome_code','answer_completed_at',
        'conversation_id','answer_message_id'
      )
    `).get().count, 5)
    assert.equal((second as any).db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type='index' AND name='idx_assistant_model_request_audits_answer_message'
    `).get().count, 1)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('model answer outcome facets filter complete history before revision-safe paging', () =>
  withStore(store => {
    const audit = {
      version: 'model-source-privacy-v2',
      policy: {
        wechat: true, documents: true, calendar: false, mail: false, unknown: false
      },
      contextDocuments: 1,
      privacyExcludedDocuments: 0,
      budgetOmittedDocuments: 0,
      contextSourceIds: ['wechat'],
      excludedSourceIds: [],
      incompleteSourceDocuments: 0,
      outboundSha256: 'f'.repeat(64),
      redaction: { level: 'standard', total: 0, counts: {} },
      boundaryChecks: ['before_send']
    }
    for (let index = 0; index < 90; index += 1) {
      const id = store.recordAssistantModelRequestStarted({
        ...audit,
        outboundSha256: createHash('sha256').update(`request-${index}`).digest('hex')
      }, 'deepseek-facet-test')
      store.finishAssistantModelRequestAudit(id, 'response_received')
      store.finishAssistantModelRequestAnswerAudit(
        id,
        'rejected',
        index < 75 ? 'invalid_model_json' : 'evidence_changed'
      )
    }
    const first = store.listAssistantModelRequestAuditsPage({
      answerOutcome: 'rejected',
      answerOutcomeCode: 'invalid_model_json',
      limit: 30
    })
    const second = store.listAssistantModelRequestAuditsPage({
      answerOutcome: 'rejected',
      answerOutcomeCode: 'invalid_model_json',
      offset: 30,
      limit: 30,
      revision: first.revision
    })
    const last = store.listAssistantModelRequestAuditsPage({
      answerOutcome: 'rejected',
      answerOutcomeCode: 'invalid_model_json',
      offset: 60,
      limit: 30,
      revision: first.revision
    })
    assert.equal(first.total, 75)
    assert.deepEqual([first.items.length, second.items.length, last.items.length], [30, 30, 15])
    assert.equal(new Set([...first.items, ...second.items, ...last.items]
      .map((item: any) => item.id)).size, 75)
    assert.equal(first.counts.response_received, 75)
    assert.equal(first.answerCounts.rejected, 75)
    assert.equal(first.answerReasonCounts.invalid_model_json, 75)
    assert.equal(first.answerReasonCounts.evidence_changed, 15)
    assert.equal(store.listAssistantModelRequestAuditsPage({
      answerOutcomeCode: 'evidence_changed',
      limit: 30
    }).total, 15)
    const newId = store.recordAssistantModelRequestStarted({
      ...audit,
      outboundSha256: 'e'.repeat(64)
    }, 'deepseek-facet-test')
    store.finishAssistantModelRequestAudit(newId, 'response_received')
    store.finishAssistantModelRequestAnswerAudit(newId, 'rejected', 'invalid_model_json')
    assert.equal(store.listAssistantModelRequestAuditsPage({
      answerOutcome: 'rejected',
      answerOutcomeCode: 'invalid_model_json',
      offset: 30,
      limit: 30,
      revision: first.revision
    }).stale, true)
  }))

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
  const directClaim = store.getClaim('claim-corrected')
  assert.equal(directClaim.subject_name, '纠正对象')
  assert.equal(directClaim.object_value, '北京')
  assert.equal(directClaim.evidence_count, 2)
  assert.equal('evidence' in directClaim, false)
  assert.equal(store.getClaim('missing-claim'), null)
  const search = store.searchText('北京').find(item => item.id === 'claim:claim-corrected')
  assert.ok(search)
  assert.equal(JSON.parse(search.metadata_json).status, 'confirmed')
}))

test('human claim correction preserves negative semantics and rejects invalid validity ranges', () => withStore(store => {
  store.syncGraph({
    entities: [
      {
        id: 'person-negative-correction',
        type: 'person',
        canonicalName: '错误事实主体',
        aliases: [],
        accountIds: []
      },
      {
        id: 'person-corrected-subject',
        type: 'person',
        canonicalName: '正确事实主体',
        aliases: ['同名备注'],
        accountIds: ['wxid-correct-subject']
      }
    ],
    relations: [],
    reviewQueue: []
  })
  const extracted = {
    id: 'claim-negative-correction',
    subjectId: 'person-negative-correction',
    predicate: '任职于',
    objectValue: '错误公司',
    polarity: 'positive',
    confidence: 0.72,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '否定纠正对象 任职于 错误公司',
    evidence: evidence('negative-correction-message-1', '听说在错误公司工作')
  }
  store.upsertClaims([extracted])
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: 'Onyx Devs Lab',
    polarity: 'negative',
    validFrom: '2026-02-30'
  }), /生效时间格式无效/)
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: 'Onyx Devs Lab',
    polarity: 'negative',
    validFrom: '2026-08-02',
    validTo: '2026-08-01'
  }), /失效时间不能早于生效时间/)
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: 'Onyx Devs Lab',
    predicate: '   ',
    polarity: 'negative'
  }), /谓词不能为空/)
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: '四十二',
    valueType: 'number'
  }), /必须填写有效数字/)
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: '2026-02-30',
    valueType: 'date'
  }), /日期型事实值格式无效/)
  assert.throws(() => store.correctClaim('claim-negative-correction', {
    value: '也许',
    valueType: 'boolean'
  }), /布尔型事实值只能是/)
  assert.equal(store.getClaim('claim-negative-correction').correction_count, 0)

  store.correctClaim('claim-negative-correction', {
    value: 'Onyx Devs Lab',
    subjectId: 'person-corrected-subject',
    predicate: '投资于',
    polarity: 'negative',
    valueType: 'text',
    validFrom: '2026-08-01'
  })
  store.upsertClaims([{
    ...extracted,
    polarity: 'positive',
    objectValue: '另一错误公司',
    searchText: '模型重跑后的肯定结论',
    evidence: evidence('negative-correction-message-2', '重跑原文')
  }])
  const corrected = store.getClaim('claim-negative-correction')
  assert.equal(corrected.subject_id, 'person-corrected-subject')
  assert.equal(corrected.subject_name, '正确事实主体')
  assert.equal(corrected.object_value, 'Onyx Devs Lab')
  assert.equal(corrected.predicate, '投资于')
  assert.equal(corrected.polarity, 'negative')
  assert.equal(corrected.value_type, 'text')
  assert.equal(corrected.valid_from, '2026-08-01')
  assert.equal(corrected.status, 'confirmed')
  assert.equal(corrected.correction_count, 1)
  assert.equal(corrected.evidence_count, 2)
  assert.match(corrected.search_text, /并非/)
  assert.match(corrected.search_text, /投资于/)
  assert.match(corrected.search_text, /正确事实主体/)
  assert.doesNotMatch(corrected.search_text, /错误事实主体/)
  assert.match(corrected.search_text, /Onyx Devs Lab/)
  const search = store.searchText('Onyx Devs Lab')
    .find(item => item.id === 'claim:claim-negative-correction')
  assert.ok(search)
  assert.equal(search.title, '投资于')
  assert.match(search.search_text, /并非/)
  const correctedMetadata = JSON.parse(search.metadata_json)
  assert.equal(correctedMetadata.subjectId, 'person-corrected-subject')
  assert.equal(correctedMetadata.polarity, 'negative')
  assert.equal(correctedMetadata.valueType, 'text')
  assert.equal(correctedMetadata.sourceNature, 'human_confirmation')
  assert.equal(correctedMetadata.correctionCount, 1)

  const database = (store as any).db
  database.prepare(`
    DELETE FROM search_documents WHERE id='claim:claim-negative-correction'
  `).run()
  const repaired = store.repairRuntimeSearchDerivedState([])
  assert.equal(repaired.healthy, true)
  const rebuilt = store.searchText('Onyx Devs Lab')
    .find(item => item.id === 'claim:claim-negative-correction')
  assert.ok(rebuilt)
  assert.equal(rebuilt.title, '投资于')
  assert.match(rebuilt.search_text, /并非/)
  assert.doesNotMatch(rebuilt.search_text, /模型重跑后的肯定结论/)
  const rebuiltMetadata = JSON.parse(rebuilt.metadata_json)
  assert.equal(rebuiltMetadata.subjectId, 'person-corrected-subject')
  assert.equal(rebuiltMetadata.polarity, 'negative')
  assert.equal(rebuiltMetadata.valueType, 'text')
  assert.equal(rebuiltMetadata.sourceNature, 'human_confirmation')
  assert.equal(rebuiltMetadata.correctionCount, 1)

  database.prepare(`
    UPDATE entities SET canonical_name='主体后来改名'
    WHERE id='person-corrected-subject'
  `).run()
  const correctionAudit = store.listMemoryItemAuditPage({
    kind: 'claim',
    itemId: 'claim-negative-correction',
    limit: 40
  })
  assert.equal(correctionAudit.total, 1)
  assert.equal(correctionAudit.items[0].before.subjectId, 'person-negative-correction')
  assert.equal(correctionAudit.items[0].before.subjectName, '错误事实主体')
  assert.equal(correctionAudit.items[0].after.subjectId, 'person-corrected-subject')
  assert.equal(correctionAudit.items[0].after.subjectName, '正确事实主体')
  assert.equal(correctionAudit.items[0].after.predicate, '投资于')
  assert.equal(correctionAudit.items[0].after.valueType, 'text')
}))

test('human claim correction validates and persists structured scalar value types', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'typed-claim-person',
      type: 'person',
      canonicalName: '类型纠正对象',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  })
  const cases = [
    { suffix: 'number', valueType: 'number', value: '42.5' },
    { suffix: 'date', valueType: 'date', value: '2026-08-05' },
    { suffix: 'boolean', valueType: 'boolean', value: '是' }
  ] as const
  for (const item of cases) {
    const id = `typed-claim-${item.suffix}`
    store.upsertClaims([{
      id,
      subjectId: 'typed-claim-person',
      predicate: '类型测试',
      objectValue: '模型旧文本',
      valueType: 'text',
      confidence: 0.7,
      status: 'candidate',
      sourceNature: 'inference',
      searchText: '类型纠正对象 类型测试 模型旧文本',
      evidence: evidence(`typed-message-${item.suffix}`, '类型测试原文')
    }])
    store.correctClaim(id, {
      value: item.value,
      valueType: item.valueType
    })
    const corrected = store.getClaim(id)
    assert.equal(corrected.value_type, item.valueType)
    assert.equal(corrected.object_value, item.value)
    const document = store.searchText(item.value).find(row => row.id === `claim:${id}`)
    assert.ok(document)
    assert.equal(JSON.parse(document.metadata_json).valueType, item.valueType)
    const audit = store.listMemoryItemAuditPage({ kind: 'claim', itemId: id })
    assert.equal(audit.items[0].after.valueType, item.valueType)
  }
}))

test('human claim correction preserves trusted object identities across same-name entities', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'object-claim-person', type: 'person', canonicalName: '实体事实主体', aliases: [], accountIds: [] },
      { id: 'same-name-org-a', type: 'organization', canonicalName: '同名公司', aliases: ['旧实体'], accountIds: [] },
      { id: 'same-name-org-b', type: 'organization', canonicalName: '同名公司', aliases: ['正确实体'], accountIds: [] }
    ],
    relations: [],
    reviewQueue: []
  })
  const extracted = {
    id: 'claim-object-correction',
    subjectId: 'object-claim-person',
    predicate: '任职于',
    objectEntityId: 'same-name-org-a',
    confidence: 0.78,
    status: 'candidate',
    sourceNature: 'direct_statement',
    searchText: '实体事实主体 任职于 同名公司',
    evidence: evidence('object-correction-message-1', '原始实体事实')
  }
  store.upsertClaims([extracted])
  store.correctClaim(extracted.id, {
    value: '这段普通文本必须被忽略',
    objectEntityId: 'same-name-org-b',
    validFrom: '2026-08-05'
  })
  store.upsertClaims([{
    ...extracted,
    searchText: '模型重跑仍指向旧实体',
    evidence: evidence('object-correction-message-2', '重跑实体事实')
  }])

  const corrected = store.getClaim(extracted.id)
  assert.equal(corrected.object_entity_id, 'same-name-org-b')
  assert.equal(corrected.object_entity_name, '同名公司')
  assert.equal(corrected.object_value, null)
  assert.equal(corrected.value_type, 'text')
  assert.equal(corrected.valid_from, '2026-08-05')
  assert.equal(corrected.status, 'confirmed')
  assert.equal(corrected.source_nature, 'human_confirmation')
  assert.equal(corrected.evidence_count, 2)
  assert.doesNotMatch(corrected.search_text, /必须被忽略/)

  let search = store.searchText('同名公司')
    .find(item => item.id === `claim:${extracted.id}`)
  assert.ok(search)
  assert.equal(JSON.parse(search.metadata_json).objectEntityId, 'same-name-org-b')

  const database = (store as any).db
  database.prepare(`DELETE FROM search_documents WHERE id=?`).run(`claim:${extracted.id}`)
  assert.equal(store.repairRuntimeSearchDerivedState([]).healthy, true)
  search = store.searchText('同名公司')
    .find(item => item.id === `claim:${extracted.id}`)
  assert.ok(search)
  assert.equal(JSON.parse(search.metadata_json).objectEntityId, 'same-name-org-b')
  assert.doesNotMatch(search.search_text, /模型重跑仍指向旧实体/)

  database.prepare(`
    UPDATE entities SET canonical_name='正确实体后来改名' WHERE id='same-name-org-b'
  `).run()
  const audit = store.listMemoryItemAuditPage({
    kind: 'claim',
    itemId: extracted.id
  })
  assert.equal(audit.total, 1)
  assert.equal(audit.items[0].before.objectEntityId, 'same-name-org-a')
  assert.equal(audit.items[0].before.objectEntityName, '同名公司')
  assert.equal(audit.items[0].after.objectEntityId, 'same-name-org-b')
  assert.equal(audit.items[0].after.objectEntityName, '同名公司')
}))

test('claim correction distinguishes omitted object identity from an explicit scalar conversion', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'mode-claim-person', type: 'person', canonicalName: '模式事实主体', aliases: [], accountIds: [] },
      { id: 'mode-claim-org', type: 'organization', canonicalName: '模式事实组织', aliases: [], accountIds: [] }
    ],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'claim-value-mode',
    subjectId: 'mode-claim-person',
    predicate: '任职于',
    objectEntityId: 'mode-claim-org',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'direct_statement',
    searchText: '模式事实主体 任职于 模式事实组织',
    evidence: evidence('value-mode-message', '对象模式原文')
  }])

  store.correctClaim('claim-value-mode', {
    value: '旧窗口回传的显示名称',
    validFrom: '2026-08-01'
  })
  let corrected = store.getClaim('claim-value-mode')
  assert.equal(corrected.object_entity_id, 'mode-claim-org')
  assert.equal(corrected.object_value, null)
  assert.match(corrected.search_text, /模式事实组织/)
  assert.doesNotMatch(corrected.search_text, /旧窗口回传/)

  store.correctClaim('claim-value-mode', {
    valueMode: 'scalar',
    value: '外部顾问',
    valueType: 'text',
    validFrom: '2026-08-01'
  })
  corrected = store.getClaim('claim-value-mode')
  assert.equal(corrected.object_entity_id, null)
  assert.equal(corrected.object_value, '外部顾问')
  assert.match(corrected.search_text, /外部顾问/)

  assert.throws(() => store.correctClaim('claim-value-mode', {
    valueMode: 'entity',
    value: '不得猜测实体'
  }), /必须选择可信事实对象/)
  assert.equal(store.getClaim('claim-value-mode').object_value, '外部顾问')
  assert.equal(store.listMemoryItemAuditPage({
    kind: 'claim',
    itemId: 'claim-value-mode'
  }).total, 2)
}))

test('new conflicting claim ids cannot downgrade corrected or human-reviewed authority', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'protected-conflict-person',
      type: 'person',
      canonicalName: '冲突保护对象',
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: []
  })
  const base = (id: string, predicate: string, value: string, messageId: string) => ({
    id,
    subjectId: 'protected-conflict-person',
    predicate,
    objectValue: value,
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: `冲突保护对象 ${predicate} ${value}`,
    evidence: evidence(messageId, `${predicate} ${value}`)
  })
  store.upsertClaims([
    base('corrected-authority', '所在城市', '上海', 'authority-message-1'),
    base('reviewed-authority', '负责项目', '可信项目', 'authority-message-2')
  ])
  store.correctClaim('corrected-authority', { value: '北京' })
  store.updateMemoryItemStatus('claim', 'reviewed-authority', 'confirmed')

  store.upsertClaims([
    base('conflict-against-correction', '所在城市', '广州', 'authority-conflict-1'),
    base('conflict-against-review', '负责项目', '错误项目', 'authority-conflict-2')
  ])

  const corrected = store.getClaim('corrected-authority')
  const reviewed = store.getClaim('reviewed-authority')
  assert.equal(corrected.status, 'confirmed')
  assert.equal(corrected.object_value, '北京')
  assert.equal(corrected.source_nature, 'human_confirmation')
  assert.equal(corrected.conflict_group, null)
  assert.equal(reviewed.status, 'confirmed')
  assert.equal(reviewed.object_value, '可信项目')
  assert.equal(reviewed.conflict_group, null)
  assert.equal(store.getClaim('conflict-against-correction').status, 'candidate')
  assert.equal(store.getClaim('conflict-against-review').status, 'candidate')

  const correctedDocument = store.searchText('北京')
    .find(item => item.id === 'claim:corrected-authority')
  const reviewedDocument = store.searchText('可信项目')
    .find(item => item.id === 'claim:reviewed-authority')
  assert.ok(correctedDocument)
  assert.ok(reviewedDocument)
  assert.equal(JSON.parse(correctedDocument.metadata_json).status, 'confirmed')
  assert.equal(JSON.parse(reviewedDocument.metadata_json).status, 'confirmed')
  assert.equal(JSON.parse(correctedDocument.metadata_json).conflictGroup, undefined)
  assert.equal(JSON.parse(reviewedDocument.metadata_json).conflictGroup, undefined)

  const database = (store as any).db
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM evidence
    WHERE claim_id='corrected-authority' AND evidence_role='contradiction'
  `).get().count), 1)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM evidence
    WHERE claim_id='reviewed-authority' AND evidence_role='contradiction'
  `).get().count), 1)
  database.prepare(`
    DELETE FROM search_documents
    WHERE id IN ('claim:corrected-authority','claim:reviewed-authority')
  `).run()
  assert.equal(store.repairRuntimeSearchDerivedState([]).healthy, true)
  assert.equal(JSON.parse(store.searchText('北京')
    .find(item => item.id === 'claim:corrected-authority').metadata_json).status, 'confirmed')
  assert.equal(JSON.parse(store.searchText('可信项目')
    .find(item => item.id === 'claim:reviewed-authority').metadata_json).status, 'confirmed')
}))

test('human claim and event review decisions survive repeated extraction and remain auditable', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'person-reviewed', type: 'person', canonicalName: '审阅对象', aliases: [], accountIds: [] }],
    relations: [],
    reviewQueue: []
  })
  const claim = {
    id: 'claim-reviewed',
    subjectId: 'person-reviewed',
    predicate: '负责',
    objectValue: '原始项目',
    confidence: 0.72,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '审阅对象负责原始项目',
    evidence: evidence('reviewed-claim-message-1', '原始事实证据')
  }
  store.upsertClaims([claim])
  store.updateMemoryItemStatus('claim', claim.id, 'rejected')
  store.upsertClaims([{
    ...claim,
    objectValue: '模型重写项目',
    status: 'candidate',
    searchText: '模型试图重写已经拒绝的事实',
    evidence: evidence('reviewed-claim-message-2', '重复抽取的新事实证据')
  }])
  let reviewedClaim = store.getMemoryFeed().claims.find(item => item.id === claim.id)
  assert.equal(reviewedClaim.status, 'rejected')
  assert.equal(reviewedClaim.object_value, '原始项目')
  assert.equal(reviewedClaim.review_count, 1)
  assert.equal(reviewedClaim.evidence_count, 2)
  const rejectedSearchDocument = (store as any).db.prepare(
    `SELECT metadata_json FROM search_documents WHERE id='claim:claim-reviewed'`
  ).get()
  assert.equal(JSON.parse(rejectedSearchDocument.metadata_json).status, 'rejected')
  store.updateMemoryItemStatus('claim', claim.id, 'confirmed')
  store.upsertClaims([{
    ...claim,
    status: 'candidate',
    evidence: evidence('reviewed-claim-message-3', '恢复确认后的新证据')
  }])
  reviewedClaim = store.getMemoryFeed().claims.find(item => item.id === claim.id)
  assert.equal(reviewedClaim.status, 'confirmed')
  assert.equal(reviewedClaim.review_count, 2)
  assert.equal(reviewedClaim.evidence_count, 3)
  const claimArchive = store.listClaimArchive({ status: 'confirmed' })
  assert.equal(claimArchive.items[0].protected_review_count, 2)
  assert.equal('review_history' in claimArchive.items[0], false)
  const claimAudit = store.listMemoryItemAuditPage({
    kind: 'claim', itemId: claim.id, limit: 40
  })
  assert.equal(claimAudit.total, 2)
  assert.equal(claimAudit.items[0].previousStatus, 'rejected')
  assert.equal(claimAudit.items[0].decision, 'confirmed')

  const event = {
    id: 'event-reviewed',
    eventType: 'meeting',
    title: '原始审阅事件',
    description: '原始说明',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '原始审阅事件 原始说明',
    participants: [{ entityId: 'person-reviewed', role: 'participant' }],
    evidence: evidence('reviewed-event-message-1', '原始事件证据')
  }
  store.upsertEvents([event])
  store.updateMemoryItemStatus('event', event.id, 'rejected')
  store.upsertEvents([{
    ...event,
    title: '模型重写事件',
    description: '模型重写说明',
    status: 'candidate',
    evidence: evidence('reviewed-event-message-2', '重复抽取的新事件证据')
  }])
  const reviewedEvent = store.getMemoryFeed().events.find(item => item.id === event.id)
  assert.equal(reviewedEvent.status, 'rejected')
  assert.equal(reviewedEvent.title, '原始审阅事件')
  assert.equal(reviewedEvent.description, '原始说明')
  assert.equal(reviewedEvent.review_count, 1)
  assert.equal(reviewedEvent.evidence_count, 2)
  const eventTimeline = store.listEventTimeline({ status: 'rejected' })
  assert.equal(eventTimeline.items[0].protected_review_count, 1)
  assert.equal('review_history' in eventTimeline.items[0], false)
  const eventAudit = store.listMemoryItemAuditPage({
    kind: 'event', itemId: event.id, limit: 40
  })
  assert.equal(eventAudit.total, 1)
  assert.equal(eventAudit.items[0].decision, 'rejected')

  const systemPolicyClaim = {
    ...claim,
    id: 'claim-system-review-policy',
    objectValue: '系统策略项目',
    searchText: '系统策略原始正文',
    evidence: evidence('system-policy-message-1', '系统策略原始证据')
  }
  store.upsertClaims([systemPolicyClaim])
  store.updateMemoryItemStatus('claim', systemPolicyClaim.id, 'candidate', {
    actor: 'system',
    reason: '实体尚未确认，临时降级',
    protectFromExtraction: false
  })
  store.upsertClaims([{
    ...systemPolicyClaim,
    searchText: '非保护系统决定允许后续模型刷新正文',
    evidence: evidence('system-policy-message-2', '系统降级后的新证据')
  }])
  let systemReviewed = store.getMemoryFeed().claims.find(item => item.id === systemPolicyClaim.id)
  assert.equal(systemReviewed.search_text, '非保护系统决定允许后续模型刷新正文')
  store.updateMemoryItemStatus('claim', systemPolicyClaim.id, 'rejected', {
    actor: 'system',
    reason: '关联实体已被用户拒绝',
    protectFromExtraction: true
  })
  store.upsertClaims([{
    ...systemPolicyClaim,
    searchText: '保护决定之后不得覆盖',
    evidence: evidence('system-policy-message-3', '系统保护后的新证据')
  }])
  systemReviewed = store.getMemoryFeed().claims.find(item => item.id === systemPolicyClaim.id)
  assert.equal(systemReviewed.status, 'rejected')
  assert.equal(systemReviewed.search_text, '非保护系统决定允许后续模型刷新正文')
  const systemReviewArchive = store.listClaimArchive({ status: 'rejected' })
    .items.find(item => item.id === systemPolicyClaim.id)
  assert.equal(systemReviewArchive.protected_review_count, 1)
  const systemAudit = store.listMemoryItemAuditPage({
    kind: 'claim', itemId: systemPolicyClaim.id, limit: 40
  })
  assert.equal(systemAudit.items[0].actor, 'system')
  assert.equal(systemAudit.items[0].reason, '关联实体已被用户拒绝')
  assert.equal(systemAudit.items[0].protectFromExtraction, true)
  assert.equal(systemAudit.items[1].protectFromExtraction, false)
}))

test('claim and event audit histories paginate all corrections and decisions with one revision', () => withStore(store => {
  store.syncGraph({
    entities: [{ id: 'audit-person', type: 'person', canonicalName: '审计人物', aliases: [], accountIds: [] }],
    relations: [],
    reviewQueue: []
  })
  const claim = {
    id: 'claim-long-audit',
    subjectId: 'audit-person',
    predicate: '所在城市',
    objectValue: '城市 0',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '审计人物 所在城市',
    evidence: evidence('claim-long-audit-message', '事实审计原文')
  }
  store.upsertClaims([claim])
  for (let index = 0; index < 125; index += 1) {
    store.updateMemoryItemStatus(
      'claim',
      claim.id,
      index % 2 ? 'confirmed' : 'rejected',
      { reason: `裁决 ${index}` }
    )
  }
  for (let index = 1; index <= 5; index += 1) {
    store.correctClaim(claim.id, { value: `城市 ${index}`, validFrom: `2026-0${index}-01` })
  }
  const first = store.listMemoryItemAuditPage({
    kind: 'claim', itemId: claim.id, limit: 40
  })
  const second = store.listMemoryItemAuditPage({
    kind: 'claim', itemId: claim.id, limit: 40, offset: 40, revision: first.revision
  })
  assert.equal(first.total, 130)
  assert.equal(first.items.length, 40)
  assert.equal(second.items.length, 40)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 80)
  const corrections = [...first.items, ...second.items].filter(item => item.auditKind === 'correction')
  assert.ok(corrections.length > 0)
  assert.ok(corrections.every(item => item.before && item.after))

  const event = {
    id: 'event-audit-revision',
    eventType: 'meeting',
    title: '审计会议',
    description: '初始说明',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'other_statement',
    searchText: '审计会议',
    participants: [{ entityId: 'audit-person', role: 'participant' }],
    evidence: evidence('event-audit-revision-message', '事件审计原文')
  }
  store.upsertEvents([event])
  store.correctEvent(event.id, {
    title: '审计会议（已修正）',
    eventType: 'meeting',
    description: '人工修正说明',
    startAt: '2026-08-04T09:00:00+08:00',
    location: '上海'
  })
  const stale = store.listMemoryItemAuditPage({
    kind: 'claim', itemId: claim.id, limit: 40, offset: 80, revision: first.revision
  })
  assert.equal(stale.stale, true)
  const eventPage = store.listMemoryItemAuditPage({
    kind: 'event', itemId: event.id, limit: 40
  })
  assert.equal(eventPage.total, 1)
  assert.equal(eventPage.items[0].auditKind, 'correction')
  assert.equal(eventPage.items[0].before.title, '审计会议')
  assert.equal(eventPage.items[0].after.title, '审计会议（已修正）')
  assert.equal(eventPage.items[0].after.location, '上海')
}))

test('human memory review survives process restart and legacy startup normalization', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-memory-review-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'person-review-restart',
        type: 'person',
        canonicalName: '重启审阅对象',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: []
    })
    const claim = {
      id: 'claim-review-restart',
      subjectId: 'person-review-restart',
      predicate: '参与',
      objectValue: '重启保护项目',
      confidence: 0.8,
      status: 'candidate',
      sourceNature: 'other_statement',
      searchText: '重启审阅对象参与重启保护项目',
      evidence: evidence('review-restart-message-1', '重启前证据')
    }
    first.upsertClaims([claim])
    first.updateMemoryItemStatus('claim', claim.id, 'confirmed')
    ;(first as any).db.prepare(`
      INSERT INTO memory_review_decisions(
        item_kind,item_id,previous_status,decision,actor,reason,protect_from_extraction,created_at
      ) VALUES('claim',?,'confirmed','candidate','user','',1,'2026-07-31T00:00:00.000Z')
    `).run(claim.id)
    first.close()
    second.initialize(databasePath)
    let reviewed = second.getMemoryFeed().claims.find(item => item.id === claim.id)
    assert.equal(reviewed.status, 'confirmed')
    assert.equal(reviewed.review_count, 2)
    const migratedSystemDecision = (second as any).db.prepare(`
      SELECT actor,reason,protect_from_extraction
      FROM memory_review_decisions
      WHERE item_kind='claim' AND item_id=? AND decision='candidate'
    `).get(claim.id)
    assert.equal(migratedSystemDecision.actor, 'system')
    assert.equal(migratedSystemDecision.protect_from_extraction, 0)
    assert.match(migratedSystemDecision.reason, /系统临时降级/)
    second.upsertClaims([{
      ...claim,
      status: 'candidate',
      objectValue: '重启后模型改写',
      evidence: evidence('review-restart-message-2', '重启后重复抽取证据')
    }])
    reviewed = second.getMemoryFeed().claims.find(item => item.id === claim.id)
    assert.equal(reviewed.status, 'confirmed')
    assert.equal(reviewed.object_value, '重启保护项目')
    assert.equal(reviewed.evidence_count, 2)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('human event correction is audited, searchable and protected from repeated extraction', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'event-participant-wrong', type: 'person', canonicalName: '错误参与者', aliases: [], accountIds: [] },
      { id: 'event-participant-right', type: 'person', canonicalName: '正确参与者', aliases: [], accountIds: [] },
      { id: 'event-participant-late', type: 'person', canonicalName: '模型后来新增者', aliases: [], accountIds: [] }
    ],
    relations: [],
    reviewQueue: []
  })
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
    participants: [{ entityId: 'event-participant-wrong', role: '错误角色' }],
    evidence: evidence('event-message-1', '会议原文')
  }
  store.upsertEvents([extracted])
  const corrected = store.correctEvent('event-corrected', {
    title: '客户方案评审',
    eventType: 'review',
    description: '确认第二版方案与报价',
    startAt: '2026-07-31T06:00:00.000Z',
    endAt: '2026-07-31T07:30:00.000Z',
    location: '上海会议室',
    participants: [{ entityId: 'event-participant-right', role: '主持人' }]
  })
  assert.equal(corrected.status, 'confirmed')
  assert.equal(corrected.source_nature, 'human_confirmation')
  assert.equal(corrected.correction_count, 1)
  store.saveEmbedding('event:event-corrected', 'event-correction-vector', [1, 0])
  store.upsertEvents([{
    ...extracted,
    confidence: 0.99,
    title: '模型再次输出的错误会议',
    participants: [{ entityId: 'event-participant-late', role: '模型猜测角色' }],
    evidence: evidence('event-message-2', '重新抽取追加的证据')
  }])
  const event = store.getEvent('event-corrected')
  assert.equal(event.title, '客户方案评审')
  assert.equal(event.event_type, 'review')
  assert.equal(event.location, '上海会议室')
  assert.equal(event.status, 'confirmed')
  assert.equal(event.source_nature, 'human_confirmation')
  assert.equal(event.correction_count, 1)
  assert.equal(event.evidence_count, 2)
  assert.equal(event.participant_count, 1)
  assert.deepEqual(store.listEventParticipantsForCorrection('event-corrected').items, [{
    entity_id: 'event-participant-right',
    role: '主持人',
    canonical_name: '正确参与者'
  }])
  assert.equal(Object.hasOwn(event, 'evidence'), false)
  assert.equal(Object.hasOwn(event, 'participants'), false)
  assert.equal(store.getEvent('event-does-not-exist'), null)
  const correctedSearch = store.searchText('报价')
    .find(item => item.id === 'event:event-corrected')
  assert.ok(correctedSearch)
  assert.equal(JSON.parse(correctedSearch.metadata_json).sourceNature, 'human_confirmation')
  assert.equal(JSON.parse(correctedSearch.metadata_json).correctionCount, 1)
  assert.deepEqual(JSON.parse(correctedSearch.metadata_json).participantIds,
    ['event-participant-right'])
  assert.match(correctedSearch.search_text, /正确参与者/)
  assert.doesNotMatch(correctedSearch.search_text, /错误参与者|模型后来新增者/)
  assert.equal(store.getEmbeddingStats('event-correction-vector').pending, 0)
  const database = (store as any).db
  database.prepare(`DELETE FROM search_documents WHERE id='event:event-corrected'`).run()
  assert.equal(store.repairRuntimeSearchDerivedState([]).healthy, true)
  const rebuiltSearch = store.searchText('报价')
    .find(item => item.id === 'event:event-corrected')
  assert.ok(rebuiltSearch)
  assert.equal(JSON.parse(rebuiltSearch.metadata_json).sourceNature, 'human_confirmation')
  assert.equal(JSON.parse(rebuiltSearch.metadata_json).correctionCount, 1)
  assert.deepEqual(JSON.parse(rebuiltSearch.metadata_json).participantIds,
    ['event-participant-right'])
  assert.match(rebuiltSearch.search_text, /正确参与者/)
  assert.equal(store.getEmbeddingStats('event-correction-vector').pending, 1)
  const timeline = store.listEventTimeline()
  assert.equal(timeline.items[0].corrected_at !== null, true)
  store.upsertEvents([{ ...extracted, status: 'cancelled', evidence: evidence('event-message-cancelled', '来源事件已取消') }])
  assert.equal(store.getEvent('event-corrected').status, 'cancelled')
  assert.equal(store.getEvent('event-corrected').title, '客户方案评审')
  assert.equal(JSON.parse(store.searchText('报价')[0].metadata_json).status, 'cancelled')
  database.prepare(`
    UPDATE entities SET canonical_name='正确参与者后来改名'
    WHERE id='event-participant-right'
  `).run()
  const correctionAudit = store.listMemoryItemAuditPage({
    kind: 'event',
    itemId: 'event-corrected'
  })
  assert.equal(correctionAudit.items[0].before.participants[0].entityId,
    'event-participant-wrong')
  assert.equal(correctionAudit.items[0].before.participantsRecorded, true)
  assert.equal(correctionAudit.items[0].before.participants[0].canonicalName,
    '错误参与者')
  assert.equal(correctionAudit.items[0].after.participants[0].entityId,
    'event-participant-right')
  assert.equal(correctionAudit.items[0].after.participantsRecorded, true)
  assert.equal(correctionAudit.items[0].after.participants[0].canonicalName,
    '正确参与者')
  assert.equal(correctionAudit.items[0].after.participants[0].role, '主持人')
  assert.throws(() => store.correctEvent('event-corrected', {
    title: '非法时间',
    startAt: '2026-08-01T10:00:00.000Z',
    endAt: '2026-08-01T09:00:00.000Z'
  }), /结束时间不能早于开始时间/)
}))

test('event deduplication deterministically preserves human authority and its audit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-event-authority-dedup-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  const makeEvent = (id: string, title: string, messageId: string) => ({
    id,
    eventType: 'meeting',
    title,
    description: `${title}说明`,
    startAt: '2026-08-05T02:00:00.000Z',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'inference',
    searchText: title,
    participants: [{ entityId: 'event-authority-person', role: 'participant' }],
    evidence: evidence(messageId, `${title}原文`)
  })
  try {
    first.initialize(databasePath)
    first.syncGraph({
      entities: [{
        id: 'event-authority-person',
        type: 'person',
        canonicalName: '事件权威人物',
        aliases: [],
        accountIds: []
      }, {
        id: 'event-duplicate-participant',
        type: 'person',
        canonicalName: '重复事件新增参与者',
        aliases: [],
        accountIds: []
      }],
      relations: [],
      reviewQueue: []
    })
    first.upsertEvents([
      {
        ...makeEvent('event-plain-duplicate', '非常长但错误的模型事件标题', 'plain-only'),
        participants: [{ entityId: 'event-duplicate-participant', role: '记录人' }]
      },
      makeEvent('event-human-authority', '人工事件', 'human-only'),
      makeEvent('event-protected-a', '人工保留事件甲', 'protected-a-only'),
      makeEvent('event-protected-b', '人工保留事件乙', 'protected-b-only'),
      makeEvent('event-ambiguous-candidate', '需要人工判断归属的候选', 'ambiguous-only')
    ])
    first.correctEvent('event-human-authority', {
      title: '人工确认的客户会议',
      eventType: 'review',
      description: '人工确认后的说明',
      startAt: '2026-08-05T02:00:00.000Z',
      location: '上海'
    })
    first.updateMemoryItemStatus('event', 'event-plain-duplicate', 'candidate', {
      actor: 'system',
      reason: '旧版非保护候选记录',
      protectFromExtraction: false
    })
    first.updateMemoryItemStatus('event', 'event-protected-a', 'confirmed')
    first.updateMemoryItemStatus('event', 'event-protected-b', 'confirmed')
    first.saveEmbedding('event:event-human-authority', 'event-dedup-vector', [1, 0])
    const database = (first as any).db
    const insertSharedEvidence = database.prepare(`
      INSERT INTO evidence(
        event_id,source_id,message_id,session_id,timestamp,sender,excerpt,evidence_role
      ) VALUES(?,?,?,?,?,?,?,?)
    `)
    for (const eventId of ['event-plain-duplicate', 'event-human-authority']) {
      insertSharedEvidence.run(
        eventId, 'wechat', 'shared-authority-message', 'shared-authority-session',
        Date.parse('2026-08-05T02:00:00.000Z'), '发送者', '同一条事件原文', 'direct'
      )
    }
    for (const eventId of [
      'event-protected-a', 'event-protected-b', 'event-ambiguous-candidate'
    ]) {
      insertSharedEvidence.run(
        eventId, 'wechat', 'shared-protected-message', 'shared-protected-session',
        Date.parse('2026-08-05T02:00:00.000Z'), '发送者', '两条人工事件都引用的原文', 'direct'
      )
    }
    first.close()

    second.initialize(databasePath)
    assert.equal(second.getEvent('event-plain-duplicate'), null)
    const authoritative = second.getEvent('event-human-authority')
    assert.equal(authoritative.title, '人工确认的客户会议')
    assert.equal(authoritative.event_type, 'review')
    assert.equal(authoritative.status, 'confirmed')
    assert.equal(authoritative.source_nature, 'human_confirmation')
    assert.equal(authoritative.evidence_count, 3)
    assert.equal(authoritative.participant_count, 2)
    assert.ok(second.getEvent('event-protected-a'))
    assert.ok(second.getEvent('event-protected-b'))
    assert.equal(second.getEvent('event-ambiguous-candidate').status, 'candidate')
    const ambiguousTimelineEvent = second.listEventTimeline({ status: 'candidate' })
      .items.find(item => item.id === 'event-ambiguous-candidate')
    assert.equal(ambiguousTimelineEvent.dedupAmbiguity.relatedTotal, 2)
    assert.deepEqual(
      ambiguousTimelineEvent.dedupAmbiguity.relatedEvents.map((item: any) => item.id),
      ['event-protected-a', 'event-protected-b']
    )
    assert.ok(ambiguousTimelineEvent.dedupAmbiguity.relatedEvents.every((item: any) =>
      item.authorityReason === 'protected_review' && item.sharedEvidenceCount === 1))
    const audit = second.listMemoryItemAuditPage({
      kind: 'event',
      itemId: 'event-human-authority',
      limit: 40
    })
    assert.equal(audit.total, 2)
    assert.ok(audit.items.some(item => item.auditKind === 'correction'))
    assert.ok(audit.items.some(item => item.reason === '旧版非保护候选记录'))
    const diagnostics = second.getDiagnostics().eventDeduplicationAuthority
    assert.equal(diagnostics.mergedEventsThisStart, 1)
    assert.equal(diagnostics.protectedEventsPreservedThisStart, 1)
    assert.equal(diagnostics.ambiguousCandidatesPreservedThisStart, 1)
    assert.equal(diagnostics.reviewsReassignedThisStart, 1)
    assert.equal(diagnostics.searchDocumentsRefreshedThisStart, 1)
    const indexedEvent = second.searchText('人工确认的客户会议')
      .find(item => item.id === 'event:event-human-authority')
    assert.ok(indexedEvent)
    assert.deepEqual(
      JSON.parse(indexedEvent.metadata_json).participantIds,
      ['event-authority-person', 'event-duplicate-participant']
    )
    const retainedVector = (second as any).db.prepare(`
      SELECT embedding_model,embedding_chunk_count,
        (SELECT COUNT(*) FROM search_document_embedding_chunks chunk
          WHERE chunk.document_id=search_documents.id
            AND chunk.content_hash=search_documents.content_hash) AS current_chunks
      FROM search_documents WHERE id='event:event-human-authority'
    `).get()
    assert.equal(retainedVector.embedding_model, 'event-dedup-vector')
    assert.equal(retainedVector.embedding_chunk_count, 1)
    assert.equal(retainedVector.current_chunks, 1)

    second.upsertEvents([{
      ...makeEvent('event-model-rephrased', '模型再次生成的错误标题', 'new-model-evidence'),
      evidence: [{
        ...evidence('shared-authority-message', '同一条事件原文')[0],
        sourceId: 'wechat',
        sessionId: 'shared-authority-session'
      }, {
        ...evidence('human-only', '人工事件原文')[0],
        sourceId: 'wechat'
      }]
    }])
    assert.equal(second.getEvent('event-model-rephrased'), null)
    assert.equal(second.getEvent('event-human-authority').title, '人工确认的客户会议')
    second.upsertEvents([{
      ...makeEvent('event-new-ambiguous-model', '模型不能替人工分歧选边', 'unused'),
      evidence: [{
        ...evidence('shared-protected-message', '两条人工事件都引用的原文')[0],
        sourceId: 'wechat',
        sessionId: 'shared-protected-session'
      }]
    }])
    assert.equal(second.getEvent('event-new-ambiguous-model').status, 'candidate')
    const newAmbiguousTimelineEvent = second.listEventTimeline({ status: 'candidate' })
      .items.find(item => item.id === 'event-new-ambiguous-model')
    assert.equal(newAmbiguousTimelineEvent.dedupAmbiguity.relatedTotal, 2)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('structured memory trust identities are resolved by stable id without feed hydration', () => withStore(store => {
  store.syncGraph({
    entities: [
      { id: 'trust-subject', type: 'person', canonicalName: '事实主体', aliases: [], accountIds: [] },
      { id: 'trust-object', type: 'organization', canonicalName: '事实对象', aliases: [], accountIds: [] },
      { id: 'trust-participant-a', type: 'person', canonicalName: '参与者甲', aliases: [], accountIds: [] },
      { id: 'trust-participant-b', type: 'person', canonicalName: '参与者乙', aliases: [], accountIds: [] }
    ],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'trust-claim',
    subjectId: 'trust-subject',
    predicate: '服务于',
    objectEntityId: 'trust-object',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'direct_statement',
    searchText: '事实主体服务于事实对象',
    evidence: evidence('trust-claim-message', '服务关系原文')
  }])
  store.upsertEvents([{
    id: 'trust-event',
    eventType: 'meeting',
    title: '信任校验会议',
    confidence: 0.8,
    status: 'candidate',
    sourceNature: 'direct_statement',
    searchText: '信任校验会议',
    participants: [
      { entityId: 'trust-participant-b', role: '参会人' },
      { entityId: 'trust-participant-a', role: '主持人' }
    ],
    evidence: evidence('trust-event-message', '会议信任校验原文')
  }])
  assert.deepEqual(
    store.getStructuredMemoryEntityIds('claim', 'trust-claim'),
    ['trust-subject', 'trust-object']
  )
  assert.deepEqual(
    store.getStructuredMemoryEntityIds('event', 'trust-event'),
    ['trust-participant-a', 'trust-participant-b']
  )
  assert.equal(store.getStructuredMemoryEntityIds('claim', 'missing-claim'), null)
  assert.equal(store.getStructuredMemoryEntityIds('event', 'missing-event'), null)
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

test('memory card evidence reserves room for older contradictions and reports complete role counts', () => withStore(store => {
  store.syncGraph({
    entities: [{
      id: 'role-balanced-person',
      type: 'person',
      canonicalName: '证据平衡测试人',
      trustStatus: 'confirmed'
    }],
    relations: [],
    reviewQueue: []
  })
  store.upsertClaims([{
    id: 'role-balanced-claim',
    subjectId: 'role-balanced-person',
    predicate: '负责',
    objectValue: '证据平衡项目',
    confidence: 0.95,
    status: 'confirmed',
    sourceNature: 'self_statement',
    searchText: '证据平衡测试人负责证据平衡项目',
    evidence: Array.from({ length: 30 }, (_, index) => ({
      sourceId: index % 2 ? 'mail' : 'wechat',
      messageId: `role-balanced-message-${index}`,
      sessionId: `role-balanced-session-${index % 3}`,
      timestamp: 1_700_200_000 + index,
      sender: `发送者 ${index}`,
      excerpt: `正向原文 ${index}`,
      role: 'direct'
    }))
  }])
  const database = (store as any).db
  database.prepare(`
    UPDATE evidence SET evidence_role='contradiction',excerpt='较早但必须保留的反证'
    WHERE claim_id='role-balanced-claim' AND message_id='role-balanced-message-0'
  `).run()

  const payload = store.getDocumentEvidencePayload('claim', 'role-balanced-claim')
  assert.equal(payload.evidenceTotal, 30)
  assert.deepEqual(payload.evidenceRoleCounts, { supporting: 29, contradiction: 1 })
  assert.deepEqual(payload.evidenceSelection, {
    version: 'role-balanced-v1',
    supportingDisplayed: 19,
    contradictionDisplayed: 1,
    truncated: true
  })
  assert.equal(payload.evidence.length, 20)
  assert.equal(payload.evidence.some((item: any) =>
    item.message_id === 'role-balanced-message-0'
    && item.evidence_role === 'contradiction'), true)
  assert.equal(payload.evidence.some((item: any) =>
    item.message_id === 'role-balanced-message-10'), false)
  assert.equal(payload.evidence.some((item: any) =>
    item.message_id === 'role-balanced-message-29'), true)

  database.prepare(`
    UPDATE evidence SET evidence_role='contradiction'
    WHERE claim_id='role-balanced-claim'
  `).run()
  const contradictionOnly = store.getDocumentEvidencePayload(
    'claim',
    'role-balanced-claim'
  )
  assert.deepEqual(contradictionOnly.evidenceRoleCounts, {
    supporting: 0,
    contradiction: 30
  })
  assert.equal(contradictionOnly.evidence.length, 20)
  assert.equal(contradictionOnly.evidence.every((item: any) =>
    item.evidence_role === 'contradiction'), true)
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

test('task reminder directory pages every reminder and rejects mixed revisions', () => {
  const reminders = Array.from({ length: 125 }, (_, index) => ({
    id: `overdue:task-${String(index).padStart(3, '0')}`,
    taskId: `task-${index}`,
    kind: 'overdue' as const,
    severity: 'high' as const,
    title: `提醒 ${index}`,
    reason: `第 ${index} 条提醒`
  }))
  const first = paginateTaskReminders(reminders, {
    offset: 0, limit: 40, revision: 'revision-a'
  })
  const second = paginateTaskReminders(reminders, {
    offset: 40, limit: 40, revision: 'revision-a', expectedRevision: first.revision
  })
  const last = paginateTaskReminders(reminders, {
    offset: 80, limit: 100, revision: 'revision-a', expectedRevision: first.revision
  })
  assert.equal(first.total, 125)
  assert.equal(first.hasMore, true)
  assert.equal(second.items[0]?.id, 'overdue:task-040')
  assert.equal(last.items.length, 45)
  assert.equal(last.hasMore, false)
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map(item => item.id)).size, 125)

  const stale = paginateTaskReminders(reminders.slice(1), {
    offset: 40, limit: 40, revision: 'revision-b', expectedRevision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)
})

test('reminder feedback is bound to the visible revision and exact reminder identity', () => {
  const reminders = [{
    id: 'overdue:task-a',
    taskId: 'task-a',
    kind: 'overdue' as const,
    severity: 'high' as const,
    title: '处理合同',
    reason: '已逾期'
  }]
  assert.doesNotThrow(() => assertReminderPreferenceMutation(reminders, {
    reminderId: 'overdue:task-a',
    taskId: 'task-a',
    kind: 'overdue',
    action: 'snooze',
    expectedRevision: 'revision-current'
  }, 'revision-current'))
  assert.throws(() => assertReminderPreferenceMutation(reminders, {
    reminderId: 'overdue:task-a',
    taskId: 'task-a',
    kind: 'overdue',
    action: 'helpful',
    expectedRevision: 'revision-old'
  }, 'revision-current'), /提醒列表在展示后发生了变化/)
  assert.throws(() => assertReminderPreferenceMutation(reminders, {
    reminderId: 'overdue:task-a',
    taskId: 'task-other',
    kind: 'overdue',
    action: 'mute_kind',
    expectedRevision: 'revision-current'
  }, 'revision-current'), /这条提醒已变化或不再需要处理/)
  assert.doesNotThrow(() => assertReminderPreferenceMutation([], {
    kind: 'overdue',
    action: 'restore_kind',
    expectedRevision: 'revision-current'
  }, 'revision-current'))
  assert.throws(() => assertReminderPreferenceMutation([], {
    kind: 'overdue',
    action: 'restore_kind',
    expectedRevision: ''
  }, 'revision-current'), /提醒列表在展示后发生了变化/)
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
  assert.match(sanitized, /\[已隐藏的本机路径\]/)
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
  assert.equal(EXTRACTION_MEMORY_CONTEXT_VERSION, 'trusted-extraction-context-v2')
  assert.deepEqual(new Set(selected.entities.map(entity => entity.id)),
    new Set(['person-zhang-a', 'person-zhang-b']))
  assert.equal(selected.entities.some(entity => entity.id === 'person-zhang-candidate'), false)
  assert.equal(selected.directEntityIds.length, 2)
})

test('trusted extraction context always includes the explicitly bound owner identity', () => {
  const selected = selectTrustedExtractionEntities({
    messages: [{ content: '这条消息没有出现本人的姓名', sessionName: '工作群' }],
    entities: [{
      id: 'bound-owner',
      type: 'person',
      canonicalName: '同名用户',
      trustStatus: 'confirmed'
    }, {
      id: 'same-name-other',
      type: 'person',
      canonicalName: '同名用户',
      trustStatus: 'confirmed'
    }, {
      id: 'untrusted-owner',
      type: 'person',
      canonicalName: '候选本人',
      trustStatus: 'candidate'
    }],
    relations: [],
    ownerEntityIds: ['bound-owner', 'untrusted-owner'],
    limit: 24
  })
  assert.deepEqual(selected.directEntityIds, ['bound-owner'])
  assert.deepEqual(selected.reasons['bound-owner'], ['用户本人绑定身份'])
  assert.equal(selected.entities.some(entity => entity.id === 'same-name-other'), false)
  assert.equal(selected.entities.some(entity => entity.id === 'untrusted-owner'), false)
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
  const database = (store as any).db
  assert.equal(database.prepare(`SELECT COUNT(*) FROM task_history_evidence`).pluck().get(), 1)
  assert.equal(database.prepare(`
    SELECT COUNT(*) FROM task_history WHERE evidence_json!='[]'
  `).pluck().get(), 0)
  assert.deepEqual(store.getTaskHistoryEvidenceStorageStats(), {
    version: 'task-history-evidence-v2',
    policy: 'one_evidence_copy_per_change_set',
    historyRows: 2,
    changeSets: 1,
    evidenceBytes: Buffer.byteLength(JSON.stringify([{ messageId: 'message-history' }])),
    migration: store.getTaskHistoryEvidenceStorageStats().migration
  })
}))

test('task history pages every audit row and rejects a stale continuation', () => withStore(store => {
  for (let index = 0; index < 125; index += 1) {
    store.recordTaskChanges(
      'task-history-pages',
      { status: index % 2 ? 'todo' : 'doing' },
      { status: index % 2 ? 'doing' : 'todo' },
      `page-test-${index}`,
      []
    )
  }
  const first = store.listTaskHistoryPage({
    taskId: 'task-history-pages',
    limit: 40
  })
  const second = store.listTaskHistoryPage({
    taskId: 'task-history-pages',
    limit: 40,
    offset: first.items.length,
    revision: first.revision
  })
  const third = store.listTaskHistoryPage({
    taskId: 'task-history-pages',
    limit: 40,
    offset: first.items.length + second.items.length,
    revision: first.revision
  })
  const fourth = store.listTaskHistoryPage({
    taskId: 'task-history-pages',
    limit: 40,
    offset: first.items.length + second.items.length + third.items.length,
    revision: first.revision
  })
  const ids = [...first.items, ...second.items, ...third.items, ...fourth.items]
    .map(item => item.id)
  assert.equal(first.total, 125)
  assert.equal(first.hasMore, true)
  assert.equal(fourth.items.length, 5)
  assert.equal(fourth.hasMore, false)
  assert.equal(ids.length, 125)
  assert.equal(new Set(ids).size, 125)

  store.recordTaskChanges(
    'task-history-pages',
    { priority: 'medium' },
    { priority: 'high' },
    'concurrent-edit',
    []
  )
  const stale = store.listTaskHistoryPage({
    taskId: 'task-history-pages',
    limit: 40,
    offset: 40,
    revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.deepEqual(stale.items, [])
  assert.equal(stale.total, 0)
}))

test('legacy task history evidence copies compact once and remain visible on every field row', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-history-evidence-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    const database = (first as any).db
    const evidenceJson = JSON.stringify(Array.from({ length: 200 }, (_, index) => ({
      messageId: `legacy-history-message-${index}`,
      excerpt: `不应按字段重复的任务审计原文 ${index}`
    })))
    const insert = database.prepare(`
      INSERT INTO task_history(
        task_id,field,before_value,after_value,reason,evidence_json,created_at,change_set_id
      ) VALUES(?,?,?,?,?,?,?,'')
    `)
    for (const field of ['status', 'due', 'priority', 'owner', 'project']) {
      insert.run('legacy-history-task', field, '"before"', '"after"',
        'legacy_multi_field_edit', evidenceJson, '2026-08-01T00:00:00.000Z')
    }
    database.prepare("DELETE FROM schema_meta WHERE key='task_history_evidence_storage_v2'").run()
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath, key)
    const reopenedDatabase = (reopened as any).db
    assert.equal(reopenedDatabase.prepare(`
      SELECT COUNT(*) FROM task_history WHERE evidence_json!='[]'
    `).pluck().get(), 0)
    assert.equal(reopenedDatabase.prepare(`
      SELECT COUNT(*) FROM task_history_evidence WHERE task_id='legacy-history-task'
    `).pluck().get(), 1)
    const history = reopened.listTaskHistory(['legacy-history-task'])
    assert.equal(history.length, 5)
    assert.ok(history.every(item => JSON.parse(item.evidence_json).length === 200))
    const stats = reopened.getTaskHistoryEvidenceStorageStats()
    assert.equal(stats.migration.historyRows, 5)
    assert.equal(stats.migration.changeSets, 1)
    assert.equal(stats.migration.duplicateCopiesRemoved, 4)
    assert.ok(stats.migration.bytesReclaimed >= Buffer.byteLength(evidenceJson) * 4)
    reopened.close()
  } finally {
    try { first.close() } catch {}
    rmSync(directory, { recursive: true, force: true })
  }
})

test('batch task history is atomic when any member fails', () => withStore(store => {
  const database = (store as any).db
  database.exec(`
    CREATE TEMP TRIGGER fail_second_task_history
    BEFORE INSERT ON task_history
    WHEN NEW.task_id='task-b'
    BEGIN
      SELECT RAISE(ABORT,'injected batch task history failure');
    END
  `)
  assert.throws(() => store.recordTaskChangeSets([
    {
      taskId: 'task-a',
      before: { status: 'todo' },
      after: { status: 'done' },
      reason: 'bulk_complete_visible'
    },
    {
      taskId: 'task-b',
      before: { status: 'todo' },
      after: { status: 'done' },
      reason: 'bulk_complete_visible'
    }
  ]), /injected batch task history failure/)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM task_history WHERE task_id IN ('task-a','task-b')
  `).get().count), 0)
}))

test('prepared task mutation commits directory and history atomically then compacts recovery payload', () => withStore(store => {
  const base = (id: string) => ({
    id,
    title: id,
    detail: '',
    owner: '我',
    priority: 'medium',
    confidence: 1,
    classification: 'mine',
    status: 'todo',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    evidence: evidence(`message-${id}`, `重复任务恢复原文 ${'x'.repeat(5_000)}`)
  })
  const before = [base('prepared-task-a'), base('prepared-task-b')]
  const after = before.map(task => ({
    ...task,
    status: 'done',
    updatedAt: '2026-08-04T00:01:00.000Z'
  }))
  store.syncTasks(before)
  store.prepareTaskMutationCommit({
    commitId: 'prepared-task-commit',
    beforeTokens: { 'prepared-task-a': 'before-a', 'prepared-task-b': 'before-b' },
    afterTokens: { 'prepared-task-a': 'after-a', 'prepared-task-b': 'after-b' },
    changes: before.map((task, index) => ({
      taskId: task.id,
      before: task,
      after: after[index],
      reason: 'bulk_complete_visible',
      evidence: []
    }))
  })
  const database = (store as any).db
  database.exec(`
    CREATE TEMP TRIGGER fail_prepared_task_history
    BEFORE INSERT ON task_history
    WHEN NEW.task_id='prepared-task-b'
    BEGIN
      SELECT RAISE(ABORT,'injected prepared task failure');
    END
  `)
  assert.throws(() => store.finalizeTaskMutationCommit('prepared-task-commit', after),
    /injected prepared task failure/)
  store.recordTaskMutationRecoveryFailure(
    'prepared-task-commit',
    'injected prepared task failure'
  )
  assert.equal(store.getTaskMutationCommitHealth().prepared, 1)
  assert.equal(store.countTaskHistory('prepared-task-a'), 0)
  assert.equal(store.listTaskArchive({ status: 'all' }).total, 0)
  assert.equal(database.prepare(`SELECT status FROM task_directory WHERE id='prepared-task-a'`).get().status, 'todo')
  const compressed = database.prepare(`
    SELECT before_tokens_json,after_tokens_json,changes_json,payload_codec,
      LENGTH(payload_blob) AS stored_bytes,LENGTH(payload_backup_blob) AS backup_bytes,
      payload_sha256,payload_original_bytes
    FROM task_mutation_commits WHERE commit_id='prepared-task-commit'
  `).get()
  assert.deepEqual([
    compressed.before_tokens_json, compressed.after_tokens_json, compressed.changes_json
  ], ['{}', '{}', '[]'])
  assert.equal(compressed.payload_codec, 'gzip-json-v1')
  assert.equal(compressed.backup_bytes, compressed.stored_bytes)
  assert.match(compressed.payload_sha256, /^[a-f0-9]{64}$/)
  assert.ok(compressed.stored_bytes < compressed.payload_original_bytes / 5)
  assert.equal(store.listPreparedTaskMutationCommits()[0].changes.length, 2)
  assert.equal(store.getTaskMutationCommitHealth().compressedPayloads, 1)
  assert.equal(store.getTaskMutationCommitHealth().redundantPayloads, 1)
  database.prepare(`
    UPDATE task_mutation_commits SET payload_blob=X'00'
    WHERE commit_id='prepared-task-commit'
  `).run()
  assert.equal(store.listPreparedTaskMutationCommits()[0].changes.length, 2)
  assert.equal(store.getTaskMutationCommitHealth().backupRecoveries, 1)
  database.prepare(`
    UPDATE task_mutation_commits SET payload_backup_blob=X'01'
    WHERE commit_id='prepared-task-commit'
  `).run()
  assert.equal(store.listPreparedTaskMutationCommits()[0].changes.length, 2)
  assert.equal(store.getTaskMutationCommitHealth().backupRecoveries, 2)
  const taskCopies = database.prepare(`
    SELECT hex(payload_blob) AS primary_hex,hex(payload_backup_blob) AS backup_hex
    FROM task_mutation_commits WHERE commit_id='prepared-task-commit'
  `).get()
  assert.equal(taskCopies.primary_hex, taskCopies.backup_hex)

  database.exec('DROP TRIGGER fail_prepared_task_history')
  store.finalizeTaskMutationCommit('prepared-task-commit', after)
  const health = store.getTaskMutationCommitHealth()
  assert.deepEqual(
    { prepared: health.prepared, committed: health.committed, retainedPayloadBytes: health.retainedPayloadBytes },
    { prepared: 0, committed: 1, retainedPayloadBytes: 0 }
  )
  assert.equal(store.countTaskHistory('prepared-task-a'), 1)
  assert.equal(store.countTaskHistory('prepared-task-b'), 1)
  assert.equal(store.listTaskArchive({ status: 'all' }).total, 2)
  assert.equal(database.prepare(`SELECT status FROM task_directory WHERE id='prepared-task-a'`).get().status, 'done')
}))

test('cross-store recovery directory pages task and source failures without exposing payloads', () => withStore(store => {
  store.prepareTaskMutationCommit({
    commitId: 'cross-store-task',
    beforeTokens: { 'task-a': 'before' },
    afterTokens: { 'task-a': 'after' },
    changes: [{
      taskId: 'task-a',
      before: { id: 'task-a', status: 'todo' },
      after: { id: 'task-a', status: 'done' },
      evidence: evidence('task-message', '不应进入恢复目录的任务原文')
    }]
  })
  store.prepareConversationSourceMutationCommit({
    commitId: 'cross-store-source',
    beforeTokens: { 'session-a': 'before' },
    afterTokens: { 'session-a': 'after' },
    policies: [{
      sessionId: 'session-a',
      displayName: '不应进入恢复目录的会话名称',
      sessionType: 'private',
      enabled: false
    }]
  })
  const first = store.listCrossStoreRecoveryPage({ limit: 1 })
  assert.equal(first.total, 2)
  assert.equal(first.items.length, 1)
  assert.equal(first.hasMore, true)
  assert.equal(first.items[0].affected_count, 1)
  assert.equal(JSON.stringify(first.items).includes('不应进入恢复目录'), false)
  const second = store.listCrossStoreRecoveryPage({
    offset: 1,
    limit: 1,
    revision: first.revision
  })
  assert.equal(second.stale, false)
  assert.equal(second.items.length, 1)
  assert.notEqual(second.items[0].kind, first.items[0].kind)

  store.recordTaskMutationRecoveryFailure('cross-store-task', 'injected visible failure')
  const stale = store.listCrossStoreRecoveryPage({
    offset: 1,
    limit: 1,
    revision: first.revision
  })
  assert.equal(stale.stale, true)
  const refreshed = store.listCrossStoreRecoveryPage({ query: 'visible failure' })
  assert.equal(refreshed.total, 1)
  assert.equal(refreshed.items[0].kind, 'task')
  assert.equal(refreshed.items[0].payload_codec, 'gzip-json-v1')
  const prepared = store.getPreparedCrossStoreRecoveryCommit('task', 'cross-store-task')
  assert.equal(prepared.changes[0].after.status, 'done')
  assert.equal(prepared.changes[0].evidence[0].excerpt,
    '不应进入恢复目录的任务原文')
  store.abandonTaskMutationCommit('cross-store-task', 'user_kept_current_state')
  assert.equal(store.getPreparedCrossStoreRecoveryCommit('task', 'cross-store-task'), null)
  const audit = (store as any).db.prepare(`
    SELECT status,recovery_action,before_tokens_json,after_tokens_json,changes_json,
      payload_blob
    FROM task_mutation_commits WHERE commit_id='cross-store-task'
  `).get()
  assert.deepEqual({
    status: audit.status,
    recovery_action: audit.recovery_action,
    before_tokens_json: audit.before_tokens_json,
    after_tokens_json: audit.after_tokens_json,
    changes_json: audit.changes_json,
    payload_blob: audit.payload_blob
  }, {
    status: 'abandoned',
    recovery_action: 'user_kept_current_state',
    before_tokens_json: '{}',
    after_tokens_json: '{}',
    changes_json: '[]',
    payload_blob: null
  })
  store.finalizeConversationSourceMutationCommit('cross-store-source')
  const archive = store.listCrossStoreRecoveryArchivePage({ limit: 1 })
  assert.equal(archive.total, 2)
  assert.equal(archive.items.length, 1)
  assert.equal(archive.hasMore, true)
  assert.deepEqual({
    all: archive.counts.all,
    prepared: archive.counts.prepared,
    committed: archive.counts.committed,
    abandoned: archive.counts.abandoned,
    task: archive.counts.task,
    source: archive.counts.source,
    userKeptCurrentState: archive.counts.userKeptCurrentState
  }, {
    all: 2,
    prepared: 0,
    committed: 1,
    abandoned: 1,
    task: 1,
    source: 1,
    userKeptCurrentState: 1
  })
  assert.equal(JSON.stringify(archive.items).includes('不应进入恢复目录'), false)
  const archiveSecond = store.listCrossStoreRecoveryArchivePage({
    offset: 1,
    limit: 1,
    revision: archive.revision
  })
  assert.equal(archiveSecond.stale, false)
  assert.equal(archiveSecond.items.length, 1)
  const kept = store.listCrossStoreRecoveryArchivePage({
    action: 'user_kept_current_state'
  })
  assert.equal(kept.total, 1)
  assert.equal(kept.items[0].kind, 'task')
  assert.equal(kept.items[0].recovery_action, 'user_kept_current_state')
  const appliedSource = store.listCrossStoreRecoveryArchivePage({
    kind: 'source',
    status: 'committed',
    action: 'applied',
    from: '2000-01-01T00:00:00.000Z',
    to: '2100-01-01T00:00:00.000Z'
  })
  assert.equal(appliedSource.total, 1)
  assert.equal(appliedSource.items[0].commit_id, 'cross-store-source')
  store.prepareTaskMutationCommit({
    commitId: 'cross-store-new',
    beforeTokens: {},
    afterTokens: {},
    changes: []
  })
  assert.equal(store.listCrossStoreRecoveryArchivePage({
    offset: 1,
    limit: 1,
    revision: archive.revision
  }).stale, true)
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
        redaction_summary_json,evidence_validation_json,extraction_context_json,extraction_coverage_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
            }),
            JSON.stringify({
              version: 'extraction-coverage-v1',
              adaptivelySplit: batchIndex === 0,
              splitDepth: batchIndex === 0 ? 1 : 0,
              attempts: batchIndex === 0 ? 2 : 1,
              unresolved: false
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
    const secondPage = first.listIngestionRunPage({
      offset: 40, limit: 40, revision: firstPage.revision
    })
    assert.equal(firstPage.total, 1_200)
    assert.deepEqual(firstPage.counts, {
      running: 300, completed: 300, partial: 300, failed: 300, all: 1_200
    })
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 80)
    assert.equal(secondPage.stale, false)
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
      batchLimit: 40,
      revision: dossierFirst.revision
    })
    assert.equal(dossierFirst.batchTotal, 125)
    assert.equal(dossierFirst.batchHasMore, true)
    assert.equal(dossierFirst.batches.length, 40)
    assert.equal(new Set([...dossierFirst.batches, ...dossierSecond.batches]
      .map((batch: any) => batch.batch_index)).size, 80)
    assert.equal(JSON.stringify(dossierFirst).includes('extraction_context_json'), false)
    assert.equal(JSON.stringify(dossierFirst).includes('extraction_coverage_json'), false)
    assert.equal(dossierFirst.batches[0].extractionContext.entities[0].name, '有界上下文')
    assert.equal(dossierFirst.batches[0].extractionCoverage.attempts, 2)
    database.prepare(`
      UPDATE ingestion_batches SET status=status
      WHERE run_id='archive-run-1199' AND batch_index=0
    `).run()
    const stalePage = first.listIngestionRunPage({
      offset: 40, limit: 40, revision: firstPage.revision
    })
    assert.equal(stalePage.stale, true)
    assert.deepEqual(stalePage.items, [])
    const staleDossier = first.getIngestionRunDossier('archive-run-1199', {
      batchOffset: 40,
      batchLimit: 40,
      revision: dossierFirst.revision
    })
    assert.equal(staleDossier.stale, true)
    assert.deepEqual(staleDossier.batches, [])
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      const reopenedFirstPage = reopened.listIngestionRunPage({ limit: 1 })
      assert.equal(reopened.listIngestionRunPage({ offset: 1, limit: 1 }).stale, true)
      const lastPage = reopened.listIngestionRunPage({
        offset: 1_180,
        limit: 40,
        revision: reopenedFirstPage.revision
      })
      assert.equal(lastPage.items.length, 20)
      assert.equal(lastPage.hasMore, false)
      assert.equal(reopened.getIngestionArchiveSummary().runs, 1_200)
      assert.equal(reopened.getIngestionRunDossier('archive-run-1199', {
        batchOffset: 1,
        batchLimit: 1
      }).stale, true)
      assert.equal(reopened.getIngestionRunDossier('archive-run-1199', {
        batchOffset: 120,
        batchLimit: 40,
        revision: reopenedFirstPage.revision
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
    digest: {
      tasks: [{ title: '确认合同', detail: `重复结构化结果 ${'x'.repeat(8_000)}` }],
      __meta: { model: 'deepseek-test' }
    },
    messages: [{
      id: 'message-1',
      sessionId: 'session-1',
      content: `请确认合同 ${'重复消息窗口'.repeat(1_000)}`
    }],
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
  assert.deepEqual(store.listPreparedIngestionBatchCommits()[0].digest, input.digest)
  assert.deepEqual(store.listPreparedIngestionBatchCommits()[0].messages, input.messages)
  const coldPayload = (store as any).db.prepare(`
    SELECT digest_json,messages_json,checkpoint_keys_json,completion_json,payload_codec,
      LENGTH(payload_blob) AS retained_bytes,LENGTH(payload_backup_blob) AS backup_bytes,
      payload_sha256,payload_original_bytes
    FROM ingestion_batch_commits WHERE commit_id=?
  `).get(input.commitId)
  assert.deepEqual([
    coldPayload.digest_json,
    coldPayload.messages_json,
    coldPayload.checkpoint_keys_json,
    coldPayload.completion_json
  ], ['{}', '[]', '[]', '{}'])
  assert.equal(coldPayload.payload_codec, 'gzip-json-v1')
  assert.equal(coldPayload.backup_bytes, coldPayload.retained_bytes)
  assert.match(coldPayload.payload_sha256, /^[a-f0-9]{64}$/)
  assert.ok(coldPayload.retained_bytes < coldPayload.payload_original_bytes / 5)
  assert.equal(store.getIngestionCommitHealth().failedPayloadStorage.compressedRows, 1)
  assert.equal(store.getIngestionCommitHealth().failedPayloadStorage.redundantRows, 1)
  assert.ok(store.getIngestionCommitHealth().failedPayloadStorage.reclaimedBytes > 10_000)
  ;(store as any).db.prepare(`
    UPDATE ingestion_batch_commits SET payload_blob=X'00' WHERE commit_id=?
  `).run(input.commitId)
  const repaired = store.listPreparedIngestionBatchCommits()[0]
  assert.deepEqual(repaired.digest, input.digest)
  assert.deepEqual(repaired.messages, input.messages)
  assert.equal(
    store.getIngestionCommitHealth().failedPayloadStorage.backupRecoveries,
    1
  )
  const repairedCopies = (store as any).db.prepare(`
    SELECT hex(payload_blob) AS primary_hex,hex(payload_backup_blob) AS backup_hex
    FROM ingestion_batch_commits WHERE commit_id=?
  `).get(input.commitId)
  assert.equal(repairedCopies.primary_hex, repairedCopies.backup_hex)

  store.finalizeIngestionBatchCommit(input.commitId, {
    model: 'deepseek-test',
    promptVersion: 'prompt-test',
    schemaVersion: 'schema-test',
    durationMs: 123
  })
  assert.deepEqual(store.listPreparedIngestionBatchCommits(), [])
  assert.deepEqual(store.getIngestionCommitHealth(), {
    prepared: 0,
    unattempted: 0,
    preparedWechat: 0,
    preparedDocuments: 0,
    committed: 1,
    recoveryFailures: 0,
    oldestPreparedAt: null,
    payloadCompaction: {
      version: 1,
      compactedRows: 0,
      releasedBytes: 0,
      retainedBytes: 0,
      lastCompactedAt: ''
    },
    failedPayloadStorage: {
      version: 'ingestion-failed-payload-redundancy-v2',
      compressedRows: 0,
      redundantRows: 0,
      backupRecoveries: 0,
      retainedBytes: 0,
      originalBytes: 0,
      reclaimedBytes: 0
    }
  })
  const status = store.getIngestionStatus()
  assert.equal(status.batches.find((row: any) => row.status === 'completed')?.count, 1)
  assert.equal(status.commitHealth.committed, 1)
  assert.deepEqual(
    [...store.getProcessedIngestionMessageKeys(input.checkpointKeys)],
    input.checkpointKeys
  )
  assert.equal(status.messageLedger.total, 1)
  const committedPayload = (store as any).db.prepare(`
    SELECT digest_json,messages_json,checkpoint_keys_json,resource_id,
      resource_content_hash,completion_json
    FROM ingestion_batch_commits WHERE commit_id=?
  `).get(input.commitId)
  assert.deepEqual(committedPayload, {
    digest_json: '{}',
    messages_json: '[]',
    checkpoint_keys_json: '[]',
    resource_id: '',
    resource_content_hash: '',
    completion_json: '{}'
  })
}))

test('prepared recovery directory isolates malformed payloads and paginates without exposing them', () =>
  withStore(store => {
    const database = (store as any).db
    for (let index = 0; index < 65; index += 1) {
      store.prepareIngestionBatchCommit({
        commitId: `recovery-commit-${String(index).padStart(3, '0')}`,
        runId: `recovery-run-${Math.floor(index / 5)}`,
        batchIndex: index,
        digest: { tasks: [{ title: `敏感任务 ${index}` }] },
        messages: [{ id: `message-${index}`, content: `敏感原文 ${index}` }],
        checkpointKeys: [`wechat:session:message-${index}`],
        createdAt: `2026-08-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`
      })
    }
    database.prepare(`
      UPDATE ingestion_batch_commits
      SET digest_json='{broken',messages_json='{}',checkpoint_keys_json='null',
        completion_json='[]',recovery_attempts=2,last_error='上次恢复失败'
      WHERE commit_id='recovery-commit-064'
    `).run()

    const prepared = store.listPreparedIngestionBatchCommits(100)
    assert.equal(prepared.length, 65)
    const malformed = prepared.find((item: any) => item.commitId === 'recovery-commit-064')
    assert.match(malformed.parseError, /结构化结果/)
    assert.match(malformed.parseError, /消息载荷/)
    assert.match(malformed.parseError, /checkpoint/)
    assert.match(malformed.parseError, /完成信息/)
    assert.deepEqual(malformed.messages, [])
    assert.deepEqual(malformed.checkpointKeys, [])

    const firstPage = store.listIngestionRecoveryPage({ limit: 30 })
    const middlePage = store.listIngestionRecoveryPage({
      offset: 30, limit: 30, revision: firstPage.revision
    })
    const lastPage = store.listIngestionRecoveryPage({
      offset: 60, limit: 30, revision: firstPage.revision
    })
    assert.equal(firstPage.total, 65)
    assert.equal(firstPage.items.length, 30)
    assert.equal(middlePage.items.length, 30)
    assert.equal(middlePage.stale, false)
    assert.equal(lastPage.items.length, 5)
    assert.equal(lastPage.hasMore, false)
    assert.equal(new Set([
      ...firstPage.items,
      ...middlePage.items,
      ...lastPage.items
    ].map((item: any) => item.commit_id)).size, 65)
    assert.equal(JSON.stringify(firstPage).includes('敏感任务'), false)
    assert.equal(JSON.stringify(firstPage).includes('敏感原文'), false)
    const filtered = store.listIngestionRecoveryPage({ query: '上次恢复失败' })
    assert.equal(filtered.total, 1)
    assert.equal(filtered.items[0].commit_id, 'recovery-commit-064')
    assert.equal(prepared.at(-1).commitId, 'recovery-commit-064')
    store.recordIngestionBatchCommitRecoveryFailure(
      'recovery-commit-000',
      '并发恢复失败'
    )
    const stale = store.listIngestionRecoveryPage({
      offset: 30, limit: 30, revision: firstPage.revision
    })
    assert.equal(stale.stale, true)
    assert.deepEqual(stale.items, [])
  }))

test('legacy failed ingestion payload enters cold storage and replays after SQLCipher reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-ingestion-cold-payload-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.prepareIngestionBatchCommit({
      commitId: 'legacy-ingestion-cold',
      runId: 'legacy-ingestion-run',
      batchIndex: 7,
      digest: { claims: [{ value: '旧结构化结果'.repeat(1_000) }] },
      messages: [{ id: 'legacy-message', content: '旧消息窗口'.repeat(2_000) }],
      checkpointKeys: ['wechat:legacy-session:legacy-message'],
      createdAt: '2026-08-01T00:00:00.000Z',
      completion: { summary: '旧完成信息'.repeat(1_000) }
    })
    ;(first as any).db.prepare(`
      UPDATE ingestion_batch_commits SET recovery_attempts=2
      WHERE commit_id='legacy-ingestion-cold'
    `).run()
    first.close()

    second.initialize(databasePath, key)
    const recovered = second.listPreparedIngestionBatchCommits()[0]
    assert.equal(recovered.digest.claims[0].value, '旧结构化结果'.repeat(1_000))
    assert.equal(recovered.messages[0].content, '旧消息窗口'.repeat(2_000))
    assert.equal(recovered.completion.summary, '旧完成信息'.repeat(1_000))
    const health = second.getIngestionCommitHealth().failedPayloadStorage
    assert.equal(health.compressedRows, 1)
    assert.equal(health.redundantRows, 1)
    assert.ok(health.reclaimedBytes > 10_000)
    const physical = (second as any).db.prepare(`
      SELECT digest_json,messages_json,checkpoint_keys_json,completion_json,payload_codec,
        LENGTH(payload_blob)=LENGTH(payload_backup_blob) AS same_size,payload_sha256
      FROM ingestion_batch_commits WHERE commit_id='legacy-ingestion-cold'
    `).get()
    assert.deepEqual(physical, {
      digest_json: '{}',
      messages_json: '[]',
      checkpoint_keys_json: '[]',
      completion_json: '{}',
      payload_codec: 'gzip-json-v1',
      same_size: 1,
      payload_sha256: physical.payload_sha256
    })
    assert.match(physical.payload_sha256, /^[a-f0-9]{64}$/)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('dual-corrupted ingestion recovery stays prepared and never advances its checkpoint', () =>
  withStore(store => {
    const checkpointKey = 'wechat:dual-corrupt-session:dual-corrupt-message'
    store.prepareIngestionBatchCommit({
      commitId: 'dual-corrupt-ingestion',
      runId: 'dual-corrupt-run',
      batchIndex: 1,
      digest: { tasks: [{ title: '不能从损坏载荷应用' }] },
      messages: [{ id: 'dual-corrupt-message', content: '仍需从原断点重新核验' }],
      checkpointKeys: [checkpointKey],
      createdAt: '2026-08-04T00:00:00.000Z'
    })
    store.recordIngestionBatchCommitRecoveryFailure(
      'dual-corrupt-ingestion',
      'injected initial recovery failure'
    )
    ;(store as any).db.prepare(`
      UPDATE ingestion_batch_commits
      SET payload_blob=X'00',payload_backup_blob=X'01'
      WHERE commit_id='dual-corrupt-ingestion'
    `).run()
    const prepared = store.listPreparedIngestionBatchCommits()[0]
    assert.match(prepared.parseError, /压缩载荷/)
    assert.equal(store.getIngestionCommitHealth().prepared, 1)
    assert.equal(
      store.getProcessedIngestionMessageKeys([checkpointKey]).size,
      0
    )
    const physical = (store as any).db.prepare(`
      SELECT status,hex(payload_blob) AS primary_hex,
        hex(payload_backup_blob) AS backup_hex,applied_at
      FROM ingestion_batch_commits WHERE commit_id='dual-corrupt-ingestion'
    `).get()
    assert.deepEqual(physical, {
      status: 'prepared',
      primary_hex: '00',
      backup_hex: '01',
      applied_at: null
    })
  }))

test('prepared recovery batches drain beyond the first hundred and leave only attempted failures', () =>
  withStore(store => {
    for (let index = 0; index < 251; index += 1) {
      store.prepareIngestionBatchCommit({
        commitId: `startup-drain-${String(index).padStart(3, '0')}`,
        runId: 'startup-drain-run',
        batchIndex: index,
        digest: {},
        messages: [],
        checkpointKeys: [],
        createdAt: `2026-08-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`
      })
    }
    ;(store as any).db.prepare(`
      UPDATE ingestion_batch_commits SET digest_json='{broken'
      WHERE commit_id='startup-drain-250'
    `).run()
    assert.equal(store.getIngestionCommitHealth().unattempted, 251)
    const seen = new Set<string>()
    let passes = 0
    while (true) {
      const batch = store.listPreparedIngestionBatchCommits(100)
        .filter(commit => !seen.has(commit.commitId))
      if (!batch.length) break
      passes += 1
      for (const commit of batch) {
        seen.add(commit.commitId)
        if (commit.parseError) {
          store.recordIngestionBatchCommitRecoveryFailure(commit.commitId, commit.parseError)
        } else {
          store.finalizeIngestionBatchCommit(commit.commitId, {})
        }
      }
    }
    const health = store.getIngestionCommitHealth()
    assert.ok(passes >= 3)
    assert.equal(seen.size, 251)
    assert.equal(health.prepared, 1)
    assert.equal(health.unattempted, 0)
    assert.equal(health.recoveryFailures, 1)
  }))

test('committed ingestion payloads compact on commit and legacy restart without losing audit identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-committed-payload-compaction-'))
  const databasePath = join(directory, 'memory.sqlite')
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  const third = new PersonalMemoryStore()
  try {
    first.initialize(databasePath)
    first.startIngestionRun('compaction-run', 'deepseek-test', 'prompt-test')
    first.recordIngestionBatch('compaction-run', 0, 1, 'running')
    first.prepareIngestionBatchCommit({
      commitId: 'compaction-commit',
      runId: 'compaction-run',
      batchIndex: 0,
      digest: { tasks: [{ title: '不应长期复制的任务' }] },
      messages: [{ id: 'private-message', content: '不应长期复制的原文' }],
      checkpointKeys: ['wechat:private-session:private-message'],
      createdAt: '2026-08-03T00:00:00.000Z',
      sourceKind: 'document',
      resourceId: 'private-resource',
      resourceContentHash: 'private-content-hash',
      completion: { privateCompletion: true }
    })
    first.finalizeIngestionBatchCommit('compaction-commit')
    const database = (first as any).db
    database.prepare(`
      UPDATE ingestion_batch_commits SET
        digest_json=?,messages_json=?,checkpoint_keys_json=?,
        resource_id=?,resource_content_hash=?,completion_json=?
      WHERE commit_id='compaction-commit'
    `).run(
      '{"tasks":[{"title":"旧版敏感任务"}]}',
      '[{"content":"旧版敏感原文"}]',
      '["wechat:old-private-session:old-private-message"]',
      'old-private-resource',
      'old-private-content-hash',
      '{"oldPrivateCompletion":true}'
    )
    first.close()

    second.initialize(databasePath)
    const compacted = (second as any).db.prepare(`
      SELECT commit_id,run_id,batch_index,status,digest_json,messages_json,
        checkpoint_keys_json,resource_id,resource_content_hash,completion_json
      FROM ingestion_batch_commits WHERE commit_id='compaction-commit'
    `).get()
    assert.deepEqual(compacted, {
      commit_id: 'compaction-commit',
      run_id: 'compaction-run',
      batch_index: 0,
      status: 'committed',
      digest_json: '{}',
      messages_json: '[]',
      checkpoint_keys_json: '[]',
      resource_id: '',
      resource_content_hash: '',
      completion_json: '{}'
    })
    const firstAudit = second.getIngestionCommitHealth().payloadCompaction
    assert.equal(firstAudit.compactedRows, 1)
    assert.ok(firstAudit.releasedBytes > 100)
    assert.equal(firstAudit.retainedBytes, 0)
    assert.match(firstAudit.lastCompactedAt, /^20/)
    second.close()

    third.initialize(databasePath)
    const secondAudit = third.getIngestionCommitHealth().payloadCompaction
    assert.deepEqual(secondAudit, firstAudit)
  } finally {
    first.close()
    second.close()
    third.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

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
  const completionGrowth = store.listMemoryChangeLogPage({
    origin: 'model_batch',
    source: 'documents',
    limit: 20
  })
  assert.equal(completionGrowth.total, 1)
  assert.equal(completionGrowth.items[0].originId, 'document-commit-v1')
  const completionDossier = store.getMemoryChangeOriginDossier(
    completionGrowth.items[0].id,
    completionGrowth.revision
  )
  assert.equal(completionDossier.originKind, 'model_batch')
  assert.equal(completionDossier.sourceKind, 'documents')
  assert.equal(completionDossier.modelBatch.commitId, 'document-commit-v1')
  assert.equal(completionDossier.modelBatch.runId, 'document-run-v1')
  assert.equal(completionDossier.modelBatch.batchStatus, 'completed')
  assert.equal(completionDossier.modelBatch.messageCount, 1)

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
  store.startIngestionRun(
    'run-interrupted',
    'deepseek-test',
    'prompt-test',
    { trigger: 'resume', backlogBeforeCount: 4 }
  )
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
  assert.equal(run.trigger_kind, 'resume')
  assert.equal(run.backlog_before_count, 4)
  assert.equal(run.backlog_after_count, 4)
  assert.equal(run.backlog_outcome, 'interrupted')
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
    }, {
      event_type: 'commitment',
      status: 'rejected',
      participants: [{ entity_id: 'person-a' }],
      evidence: []
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

  const completeInsight = buildEntityInsights({
    entities: [
      { id: 'person-a', canonicalName: '张三', aliases: [], accountIds: [], trustStatus: 'confirmed' }
    ],
    relations: [],
    claims: [],
    events: [],
    tasks: [],
    authoritativeEvidence: {
      'person-a': { evidenceTotal: 750, lastEvidenceAt: 1_775_000_250 }
    },
    now: new Date(1_775_000_300_000)
  })['person-a']
  assert.equal(completeInsight.evidenceCount, 750)
  assert.equal(completeInsight.lastContactAt, 1_775_000_250)
  assert.ok(completeInsight.explanation.includes('750 条去重原文证据'))
})

test('entity dossiers derive bounded related tasks from the authoritative task set', () => {
  const entity = {
    id: 'person-related-tasks',
    canonicalName: '邢爱妮',
    aliases: ['爱妮'],
    accountIds: ['wxid-xingaini'],
    externalIdentities: [{ platform: 'email', accountId: 'aini@example.com', displayName: 'Aini Xing' }]
  }
  const tasks = Array.from({ length: 260 }, (_, index) => ({
    id: `entity-task-${String(index).padStart(3, '0')}`,
    title: index % 2 === 0 ? `与邢爱妮确认事项 ${index}` : `普通任务 ${index}`,
    detail: '',
    owner: index % 2 === 0 ? '我' : '邢爱妮',
    collaborators: [],
    status: ['todo', 'doing', 'waiting', 'done', 'cancelled'][index % 5],
    updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString()
  }))
  tasks.push({
    id: 'unrelated-short-name',
    title: '刑事材料整理',
    detail: '这个词只碰巧包含一个同音开头',
    owner: '我',
    collaborators: [],
    status: 'todo',
    updatedAt: '2026-08-04T00:00:00.000Z'
  })
  const result = listEntityRelatedTasks(entity, tasks, 100)
  assert.equal(result.total, 260)
  assert.equal(result.items.length, 100)
  assert.equal(result.truncated, true)
  assert.equal(result.items.some(item => item.id === 'unrelated-short-name'), false)
  assert.ok(result.items.every(task => taskRelatesToEntity(task, entity)))
  assert.ok(result.items.slice(0, 10).every(task => !['done', 'cancelled'].includes(task.status)))

  const first = paginateEntityRelatedTasks(entity, tasks, { limit: 40 }, 'entity-task-revision-1')
  const second = paginateEntityRelatedTasks(entity, tasks, {
    limit: 40,
    offset: 40,
    revision: first.revision
  }, 'entity-task-revision-1')
  assert.equal(first.total, 260)
  assert.equal(first.items.length, 40)
  assert.equal(new Set([...first.items, ...second.items].map(task => task.id)).size, 80)
  assert.ok(first.items.every(task => !['done', 'cancelled'].includes(task.status)))
  assert.deepEqual(new Set(result.items.map(task => task.status)),
    new Set(['todo', 'doing', 'waiting']))
  assert.deepEqual(new Set(tasks.filter(task => taskRelatesToEntity(task, entity)).map(task => task.status)),
    new Set(['todo', 'doing', 'waiting', 'done', 'cancelled']))
  const stale = paginateEntityRelatedTasks(entity, tasks, {
    limit: 40,
    offset: 40,
    revision: 'entity-task-revision-1'
  }, 'entity-task-revision-2')
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 0)

  const shortNameEntity = { canonicalName: '李', aliases: [], accountIds: [] }
  assert.equal(taskRelatesToEntity({ title: '李子采购', owner: '我' }, shortNameEntity), false)
  assert.equal(taskRelatesToEntity({ title: '普通任务', owner: '李' }, shortNameEntity), true)
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

test('human review calibration uses latest authoritative decisions without claiming population accuracy', () => {
  withStore(store => {
    const database = (store as any).db
    const now = '2026-08-09T00:00:00.000Z'
    database.prepare(`
      INSERT INTO task_review_decisions(
        evidence_fingerprint,task_id,decision,created_at,updated_at
      ) VALUES(?,?,?,?,?)
    `).run('task-mine', 'task-1', 'mine', now, now)
    database.prepare(`
      INSERT INTO task_review_decisions(
        evidence_fingerprint,task_id,decision,revoked_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?)
    `).run('task-revoked', 'task-2', 'rejected', now, now, now)
    database.prepare(`
      INSERT INTO memory_review_decisions(
        item_kind,item_id,previous_status,decision,actor,created_at
      ) VALUES(?,?,?,?,?,?)
    `).run('claim', 'claim-1', 'candidate', 'rejected', 'user', now)
    database.prepare(`
      INSERT INTO memory_review_decisions(
        item_kind,item_id,previous_status,decision,actor,created_at
      ) VALUES(?,?,?,?,?,?)
    `).run('claim', 'claim-1', 'rejected', 'confirmed', 'user', now)
    database.prepare(`
      INSERT INTO memory_review_decisions(
        item_kind,item_id,previous_status,decision,actor,created_at
      ) VALUES(?,?,?,?,?,?)
    `).run('event', 'event-system', 'candidate', 'rejected', 'system', now)
    database.prepare(`
      INSERT INTO review_queue(
        id,kind,title,detail,confidence,status,payload_json,created_at,resolved_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run('review-user', 'relation', '', '', 0.8, 'rejected',
      JSON.stringify({ resolutionActor: 'user' }), now, now)
    database.prepare(`
      INSERT INTO review_queue(
        id,kind,title,detail,confidence,status,payload_json,created_at,resolved_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run('review-system', 'relation', '', '', 0.8, 'confirmed',
      JSON.stringify({ resolutionActor: 'system' }), now, now)
    database.prepare(`
      INSERT INTO identity_decisions(
        pair_key,left_entity_id,right_entity_id,decision,created_at,updated_at
      ) VALUES(?,?,?,?,?,?)
    `).run('entity-1|entity-2', 'entity-1', 'entity-2', 'different', now, now)

    const firstCalibration = store.getHumanReviewCalibrationStats()
    assert.deepEqual(firstCalibration, {
      version: 'human-review-calibration-v1',
      revision: `${store.getTaskOwnershipReviewRevision()}:${store.getStructuredMemoryRevision()}:${store.getGraphReviewRevision()}`,
      taskOwnership: { accepted: 1, rejected: 0, revoked: 1, total: 1 },
      structuredMemory: { accepted: 1, rejected: 0, reopened: 0, total: 1 },
      graphCandidates: { accepted: 0, rejected: 1, total: 1 },
      identityPairs: { merged: 0, different: 1, total: 1 },
      reviewedTotal: 4,
      interpretation: 'selected_human_reviews_not_population_accuracy'
    })
    assert.strictEqual(store.getHumanReviewCalibrationStats(), firstCalibration)
    database.prepare(`
      INSERT INTO identity_decisions(
        pair_key,left_entity_id,right_entity_id,decision,created_at,updated_at
      ) VALUES(?,?,?,?,?,?)
    `).run('entity-3|entity-4', 'entity-3', 'entity-4', 'merged', now, now)
    const refreshedCalibration = store.getHumanReviewCalibrationStats()
    assert.notStrictEqual(refreshedCalibration, firstCalibration)
    assert.equal(refreshedCalibration.identityPairs.merged, 1)
    assert.equal(refreshedCalibration.reviewedTotal, 5)
  })
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
  assert.equal(store.listTaskArchive({ query: '回复隐私测试人' }).total, 0)
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
      classification: 'uncertain',
      evidence: evidence('message-task-review-1', '不应复制进任务快照的原文'),
      sourceMessageIds: ['message-task-review-1']
    }
  })
  assert.equal(recorded.decision, 'rejected')
  assert.equal(recorded.suppression_count, 0)

  store.recordTaskReviewSuppression('evidence-task-1')
  store.recordTaskReviewSuppression('evidence-task-1')

  const decision = store.getTaskReviewDecision('evidence-task-1')
  assert.equal(decision.suppression_count, 2)
  const hydratedSnapshot = JSON.parse(decision.task_json)
  assert.equal(hydratedSnapshot.evidence[0].messageId, 'message-task-review-1')
  assert.deepEqual(hydratedSnapshot.sourceMessageIds, ['message-task-review-1'])
  const physicalDecision = (store as any).db.prepare(`
    SELECT task_json,evidence_json FROM task_review_decisions WHERE evidence_fingerprint=?
  `).get('evidence-task-1')
  assert.equal(JSON.parse(physicalDecision.task_json).evidence, undefined)
  assert.equal(JSON.parse(physicalDecision.task_json).sourceMessageIds, undefined)
  assert.equal(JSON.parse(physicalDecision.evidence_json)[0].messageId, 'message-task-review-1')
  const physicalHistory = (store as any).db.prepare(`
    SELECT task_json FROM task_review_history WHERE evidence_fingerprint=?
  `).all('evidence-task-1')
  assert.ok(physicalHistory.every((row: any) =>
    JSON.parse(row.task_json).evidence === undefined
      && JSON.parse(row.task_json).sourceMessageIds === undefined))
  assert.equal(store.getTaskReviewSnapshotStorageStats().embeddedEvidenceRows, 0)
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
  assert.equal(reverted.task.evidence[0].messageId, 'message-task-review-1')
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
  const second = store.listTaskReviewDecisionPage({
    offset: 100, limit: 100, revision: first.revision
  })
  assert.equal(first.total, 2_500)
  assert.equal(first.counts.active, 2_000)
  assert.equal(first.counts.revoked, 500)
  assert.equal(first.counts.all, 2_500)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.evidence_fingerprint)).size, 200)
  assert.equal(second.stale, false)
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
  store.revokeTaskReviewDecision('audit-fingerprint-0001')
  const stale = store.listTaskReviewDecisionPage({
    offset: 100, limit: 100, revision: first.revision
  })
  assert.equal(stale.stale, true)
  assert.deepEqual(stale.items, [])

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
    historyLimit: 50,
    revision: dossierFirst.revision
  })
  assert.equal(dossierFirst.evidence.length, 20)
  assert.equal(dossierFirst.evidenceTotal, 30)
  assert.equal(dossierFirst.history.length, 50)
  assert.equal(dossierFirst.historyHasMore, true)
  assert.equal(dossierSecond.stale, false)
  assert.equal(new Set([...dossierFirst.history, ...dossierSecond.history].map(item => item.id)).size, 100)
  assert.equal(JSON.stringify(dossierFirst).includes('可恢复但不能泄露的任务快照'), false)
  assert.ok(dossierFirst.history.every((item: any) => !('task_json' in item)))
  store.revokeTaskReviewDecision(detailedFingerprint)
  const staleDossierPage = store.getTaskReviewDecisionDossier(detailedFingerprint, {
    historyOffset: 50,
    historyLimit: 50,
    revision: dossierFirst.revision
  })
  assert.equal(staleDossierPage.stale, true)
  assert.deepEqual(staleDossierPage.history, [])
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
    assert.equal(dossier.stale, false)
    assert.match(dossier.revision, /^\d+$/)
    assert.deepEqual(dossier.history.map((item: any) => item.action), ['revoked', 'rejected'])
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy task review snapshots compact embedded evidence and remain reversibly hydrated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-task-review-snapshot-migration-'))
  const databasePath = join(directory, 'memory.sqlite')
  const key = randomBytes(32)
  const first = new PersonalMemoryStore()
  const second = new PersonalMemoryStore()
  try {
    first.initialize(databasePath, key)
    first.recordTaskReviewDecision({
      evidenceFingerprint: 'legacy-review-fingerprint',
      taskId: 'legacy-review-task',
      decision: 'rejected',
      title: '旧归属判断',
      source: '旧项目群',
      evidence: evidence('legacy-review-message', `唯一权威原文 ${'x'.repeat(2_000)}`),
      task: { id: 'legacy-review-task', title: '旧归属判断', classification: 'uncertain' }
    })
    const legacyTaskJson = JSON.stringify({
      id: 'legacy-review-task',
      title: '旧归属判断',
      classification: 'uncertain',
      evidence: evidence('legacy-review-message', `重复原文 ${'x'.repeat(2_000)}`),
      sourceMessageIds: ['legacy-review-message']
    })
    ;(first as any).db.prepare(`
      UPDATE task_review_decisions SET task_json=? WHERE evidence_fingerprint=?
    `).run(legacyTaskJson, 'legacy-review-fingerprint')
    ;(first as any).db.prepare(`
      UPDATE task_review_history SET task_json=? WHERE evidence_fingerprint=?
    `).run(legacyTaskJson, 'legacy-review-fingerprint')
    ;(first as any).db.prepare(`
      DELETE FROM schema_meta WHERE key='task_review_snapshot_storage_v2'
    `).run()
    first.close()

    second.initialize(databasePath, key)
    const stats = second.getTaskReviewSnapshotStorageStats()
    assert.equal(stats.embeddedEvidenceRows, 0)
    assert.equal(stats.migration.rowsCompacted, 2)
    assert.ok(stats.migration.bytesReclaimed > 3_000)
    const physical = (second as any).db.prepare(`
      SELECT task_json FROM task_review_decisions WHERE evidence_fingerprint=?
    `).get('legacy-review-fingerprint')
    assert.equal(JSON.parse(physical.task_json).evidence, undefined)
    const restored = second.revokeTaskReviewDecision('legacy-review-fingerprint')
    assert.equal(restored.task.id, 'legacy-review-task')
    assert.equal(restored.task.evidence[0].messageId, 'legacy-review-message')
    assert.deepEqual(restored.task.sourceMessageIds, ['legacy-review-message'])
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('resource batches atomically roll back authority, search and evidence after a later failure', () => withStore(store => {
  const database = (store as any).db
  database.exec(`
    CREATE TRIGGER fail_second_resource_evidence
    BEFORE INSERT ON search_document_evidence
    WHEN NEW.document_id='resource:atomic-resource-b'
    BEGIN
      SELECT RAISE(ABORT,'forced resource evidence failure');
    END;
  `)
  const searchRevision = store.getMemorySearchRevision()
  const resourceRevision = store.getResourceArchiveRevision()
  assert.throws(() => store.upsertResources([{
    id: 'atomic-resource-a',
    resourceType: 'document',
    title: '原子资源甲',
    content: '第一条本应随整批回滚',
    metadata: { sourceId: 'documents' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'atomic-message-a',
      timestamp: 1,
      sender: '本机文档连接器',
      excerpt: '第一条证据'
    }]
  }, {
    id: 'atomic-resource-b',
    resourceType: 'document',
    title: '原子资源乙',
    content: '第二条在证据阶段触发故障',
    metadata: { sourceId: 'documents' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'atomic-message-b',
      timestamp: 2,
      sender: '本机文档连接器',
      excerpt: '第二条证据'
    }]
  }]), /forced resource evidence failure/)

  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources
    WHERE id IN ('atomic-resource-a','atomic-resource-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id IN ('resource:atomic-resource-a','resource:atomic-resource-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id IN ('resource:atomic-resource-a','resource:atomic-resource-b')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_document_evidence
    WHERE document_id IN ('resource:atomic-resource-a','resource:atomic-resource-b')
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), searchRevision)
  assert.equal(store.getResourceArchiveRevision(), resourceRevision)

  database.exec('BEGIN IMMEDIATE')
  database.prepare(`
    INSERT INTO schema_meta(key,value,updated_at) VALUES('resource_outer_before','kept','2026-08-05T02:00:00.000Z')
  `).run()
  assert.throws(() => store.upsertResources([{
    id: 'atomic-resource-b',
    resourceType: 'document',
    title: '嵌套事务资源',
    content: '保存点失败不能破坏调用方事务',
    metadata: { sourceId: 'documents' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'atomic-message-b',
      timestamp: 2,
      sender: '本机文档连接器',
      excerpt: '仍然触发故障'
    }]
  }]), /forced resource evidence failure/)
  assert.equal(database.inTransaction, true)
  database.prepare(`
    INSERT INTO schema_meta(key,value,updated_at) VALUES('resource_outer_after','kept','2026-08-05T02:00:01.000Z')
  `).run()
  database.exec('COMMIT')
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM schema_meta
    WHERE key IN ('resource_outer_before','resource_outer_after') AND value='kept'
  `).get().count), 2)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources WHERE id='atomic-resource-b'
  `).get().count), 0)
}))

test('resource connector page commits authority and checkpoint atomically and rejects stale configuration', () => withStore(store => {
  const database = (store as any).db
  store.registerDataSources([{
    id: 'documents',
    kind: 'document',
    displayName: '本机文档目录',
    description: '测试连接器',
    available: true,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence']
  }])
  const initial = store.listDataSources().find(item => item.id === 'documents')
  const configured = store.configureDataSource(
    'documents',
    { folderPath: '/tmp/weflow-atomic-documents' },
    true,
    initial.mutationToken
  )
  assert.equal(store.updateDataSourceRunIfCurrent({
    sourceId: 'documents',
    expectedCheckpoint: '',
    expectedConfig: configured.config,
    status: 'running',
    attemptedAt: '2026-08-06T00:00:00.000Z'
  }), true)
  const resource = {
    id: 'local-document:atomic-page',
    resourceType: 'document',
    title: '连接器原子页',
    content: '资源、全文、证据和 checkpoint 必须一起提交',
    metadata: { sourceId: 'documents', contentHash: 'atomic-content-v1' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'atomic-page-message',
      timestamp: 1,
      sender: '本机文档连接器',
      excerpt: '原子页证据'
    }]
  }
  database.exec(`
    CREATE TRIGGER fail_connector_page_evidence
    BEFORE INSERT ON search_document_evidence
    WHEN NEW.document_id='resource:local-document:atomic-page'
    BEGIN
      SELECT RAISE(ABORT,'forced connector page failure');
    END;
  `)
  const revisions = {
    search: store.getMemorySearchRevision(),
    resource: store.getResourceArchiveRevision()
  }
  assert.throws(() => store.commitResourceConnectorPage({
    sourceId: 'documents',
    expectedCheckpoint: '',
    nextCheckpoint: 'page-1',
    expectedConfig: configured.config,
    resources: [resource],
    preserveExistingEvidence: true
  }), /forced connector page failure/)
  assert.equal(store.listDataSources().find(item => item.id === 'documents').checkpoint, '')
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources WHERE id='local-document:atomic-page'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents WHERE id='resource:local-document:atomic-page'
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), revisions.search)
  assert.equal(store.getResourceArchiveRevision(), revisions.resource)
  assert.equal(store.listMemoryChangeLogPage({
    origin: 'connector_page', source: 'documents', limit: 20
  }).total, 0)

  database.exec('DROP TRIGGER fail_connector_page_evidence')
  store.commitResourceConnectorPage({
    sourceId: 'documents',
    expectedCheckpoint: '',
    nextCheckpoint: 'page-1',
    expectedConfig: configured.config,
    resources: [resource],
    preserveExistingEvidence: true
  })
  assert.equal(store.listDataSources().find(item => item.id === 'documents').checkpoint, 'page-1')
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_document_evidence
    WHERE document_id='resource:local-document:atomic-page'
  `).get().count), 1)
  const documentGrowth = store.listMemoryChangeLogPage({
    origin: 'connector_page', source: 'documents', limit: 20
  })
  assert.equal(documentGrowth.total, 1)
  assert.match(documentGrowth.items[0].originId, /^documents\.page:[a-f0-9]{24}$/)
  assert.equal(documentGrowth.items[0].originId.includes('page-1'), false)
  const documentOrigin = store.getMemoryChangeOriginDossier(
    documentGrowth.items[0].id,
    documentGrowth.revision
  )
  assert.equal(documentOrigin.totalChanges, 1)
  assert.equal(documentOrigin.originKind, 'connector_page')
  assert.equal(documentOrigin.sourceKind, 'documents')
  assert.equal(documentOrigin.connectorOperation, 'documents_page')
  assert.equal(documentOrigin.modelBatch, null)
  assert.equal(JSON.stringify(documentOrigin).includes('/tmp/weflow-atomic-documents'), false)

  const beforeReconfigure = store.listDataSources().find(item => item.id === 'documents')
  const reconfigured = store.configureDataSource(
    'documents',
    { folderPath: '/tmp/weflow-new-folder' },
    true,
    beforeReconfigure.mutationToken
  )
  assert.equal(reconfigured.checkpoint, '')
  assert.throws(() => store.commitResourceConnectorPage({
    sourceId: 'documents',
    expectedCheckpoint: '',
    nextCheckpoint: 'stale-page',
    expectedConfig: configured.config,
    resources: [{ ...resource, id: 'local-document:stale-page' }],
    preserveExistingEvidence: true
  }), /配置已变化/)
  assert.equal(store.updateDataSourceRunIfCurrent({
    sourceId: 'documents',
    expectedCheckpoint: '',
    expectedConfig: configured.config,
    status: 'error',
    error: '旧同步不应污染新配置'
  }), false)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources WHERE id='local-document:stale-page'
  `).get().count), 0)
  const current = store.listDataSources().find(item => item.id === 'documents')
  assert.equal(current.checkpoint, '')
  assert.equal(current.status, 'idle')
  assert.equal(current.lastError, null)
  store.commitResourceConnectorPage({
    sourceId: 'documents',
    expectedCheckpoint: '',
    nextCheckpoint: 'page-1',
    expectedConfig: reconfigured.config,
    resources: [{
      ...resource,
      id: 'local-document:reconfigured-page',
      title: '重配后的连接器页',
      metadata: { sourceId: 'documents', contentHash: 'atomic-content-v2' },
      evidence: [{
        ...resource.evidence[0],
        messageId: 'reconfigured-page-message'
      }]
    }],
    preserveExistingEvidence: true
  })
  const reconfiguredGrowth = store.listMemoryChangeLogPage({
    origin: 'connector_page', source: 'documents', limit: 20
  })
  assert.equal(reconfiguredGrowth.total, 2)
  assert.equal(new Set(reconfiguredGrowth.items.map(item => item.originId)).size, 2)
  assert.equal(reconfiguredGrowth.items.every(item =>
    /^documents\.page:[a-f0-9]{24}$/.test(item.originId)), true)

  store.registerDataSources([{
    id: 'mail',
    kind: 'email',
    displayName: 'macOS Mail',
    description: '测试 Mail 连接器',
    available: true,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence']
  }])
  const initialMail = store.listDataSources().find(item => item.id === 'mail')
  const configuredMail = store.configureDataSource(
    'mail',
    { mailboxIds: ['private-mailbox-id'], allowModelAnalysis: false },
    true,
    initialMail.mutationToken
  )
  store.commitResourceConnectorPage({
    sourceId: 'mail',
    expectedCheckpoint: '',
    nextCheckpoint: 'private-mail-checkpoint',
    expectedConfig: configuredMail.config,
    resources: [{
      id: 'mail-message:origin-page',
      resourceType: 'email',
      title: 'Mail 来源测试',
      content: 'Mail 正文不会进入来源账本',
      metadata: { sourceId: 'mail', contentHash: 'mail-origin-v1' },
      evidence: [{
        sourceId: 'mail',
        sessionId: 'data-source:mail:private-mailbox-id',
        messageId: 'mail-origin-message',
        timestamp: 2,
        sender: 'mail@example.com',
        excerpt: 'Mail 来源原文'
      }]
    }],
    preserveExistingEvidence: true
  })
  const mailGrowth = store.listMemoryChangeLogPage({
    origin: 'connector_page', source: 'mail', limit: 20
  })
  assert.equal(mailGrowth.total, 1)
  assert.match(mailGrowth.items[0].originId, /^mail\.page:[a-f0-9]{24}$/)
  assert.equal(mailGrowth.items[0].originId.includes('private'), false)
  const mailOrigin = store.getMemoryChangeOriginDossier(
    mailGrowth.items[0].id,
    mailGrowth.revision
  )
  assert.equal(mailOrigin.sourceKind, 'mail')
  assert.equal(mailOrigin.connectorOperation, 'mail_page')
  assert.equal(JSON.stringify(mailOrigin).includes('mail@example.com'), false)
  assert.equal(JSON.stringify(mailOrigin).includes('private-mailbox-id'), false)
  assert.equal(JSON.stringify(mailOrigin).includes('private-mail-checkpoint'), false)
}))

test('wechat resource batch records a private connector origin and rolls back all derived state', () => withStore(store => {
  const database = (store as any).db
  const privateRunId = 'run_private-wechat-resource-identity'
  const resource = {
    id: 'wechat-resource:origin-batch',
    resourceType: 'link',
    title: '微信资源来源测试',
    content: '微信消息资源正文',
    metadata: {
      sourceId: 'wechat',
      sessionId: 'private-session-id'
    },
    evidence: [{
      sourceId: 'wechat',
      sessionId: 'private-session-id',
      messageId: 'private-message-id',
      timestamp: 3,
      sender: 'private-sender',
      excerpt: '不会进入来源档案的微信原文'
    }]
  }
  database.exec(`
    CREATE TRIGGER fail_wechat_resource_evidence
    BEFORE INSERT ON search_document_evidence
    WHEN NEW.document_id='resource:wechat-resource:origin-batch'
    BEGIN
      SELECT RAISE(ABORT,'forced wechat resource failure');
    END;
  `)
  const revisions = {
    search: store.getMemorySearchRevision(),
    resource: store.getResourceArchiveRevision()
  }
  assert.throws(() => store.commitWechatResourceBatch({
    runId: privateRunId,
    resources: [resource]
  }), /forced wechat resource failure/)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources
    WHERE id='wechat-resource:origin-batch'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id='resource:wechat-resource:origin-batch'
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), revisions.search)
  assert.equal(store.getResourceArchiveRevision(), revisions.resource)
  assert.equal(store.listMemoryChangeLogPage({
    origin: 'connector_page',
    source: 'wechat',
    limit: 20
  }).total, 0)

  database.exec('DROP TRIGGER fail_wechat_resource_evidence')
  store.commitWechatResourceBatch({
    runId: privateRunId,
    resources: [resource]
  })
  const growth = store.listMemoryChangeLogPage({
    origin: 'connector_page',
    source: 'wechat',
    limit: 20
  })
  assert.equal(growth.total, 1)
  assert.match(growth.items[0].originId, /^wechat\.resources:[a-f0-9]{24}$/)
  assert.equal(growth.items[0].originId.includes(privateRunId), false)
  const dossier = store.getMemoryChangeOriginDossier(
    growth.items[0].id,
    growth.revision
  )
  assert.equal(dossier.originKind, 'connector_page')
  assert.equal(dossier.sourceKind, 'wechat')
  assert.equal(dossier.connectorOperation, 'wechat_resources')
  assert.equal(dossier.totalChanges, 1)
  const publicDossier = JSON.stringify(dossier)
  assert.equal(publicDossier.includes(privateRunId), false)
  assert.equal(publicDossier.includes('private-session-id'), false)
  assert.equal(publicDossier.includes('private-message-id'), false)
  assert.equal(publicDossier.includes('private-sender'), false)
  assert.equal(publicDossier.includes('不会进入来源档案'), false)

  store.appendResourceContent(
    resource.id,
    '本地继续补齐的 OCR 正文',
    { attachmentPdfOcrStatus: 'completed' },
    {
      kind: 'connector_page',
      id: 'wechat.pdf_ocr:1234567890abcdef12345678',
      sourceKind: 'wechat'
    }
  )
  const enrichedGrowth = store.listMemoryChangeLogPage({
    origin: 'connector_page',
    source: 'wechat',
    limit: 20
  })
  assert.equal(enrichedGrowth.total, 2)
  assert.equal(
    enrichedGrowth.items[0].originId,
    'wechat.pdf_ocr:1234567890abcdef12345678'
  )
  assert.equal(enrichedGrowth.items[0].changeKind, 'updated')
  const enrichedDossier = store.getMemoryChangeOriginDossier(
    enrichedGrowth.items[0].id,
    enrichedGrowth.revision
  )
  assert.equal(enrichedDossier.totalChanges, 1)
  assert.equal(enrichedDossier.sourceKind, 'wechat')
  assert.equal(enrichedDossier.connectorOperation, 'wechat_pdf_ocr')
}))

test('calendar resource and structured event commit atomically', () => withStore(store => {
  const database = (store as any).db
  store.registerDataSources([{
    id: 'calendar',
    kind: 'calendar',
    displayName: 'macOS 日历',
    description: '测试日历连接器',
    available: true,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence', 'events']
  }])
  const initialSource = store.listDataSources().find(item => item.id === 'calendar')
  const configuredSource = store.configureDataSource(
    'calendar',
    { calendarIds: ['atomic-calendar'] },
    true,
    initialSource.mutationToken
  )
  database.exec(`
    CREATE TRIGGER fail_calendar_event_search
    BEFORE INSERT ON search_documents
    WHEN NEW.id='event:calendar-atomic-event'
    BEGIN
      SELECT RAISE(ABORT,'forced calendar event search failure');
    END;
  `)
  const revisions = {
    search: store.getMemorySearchRevision(),
    resource: store.getResourceArchiveRevision(),
    structured: store.getStructuredMemoryRevision(),
    evidence: store.getMemoryEvidenceArchiveRevision(),
    graph: store.getGraphReviewRevision()
  }
  assert.throws(() => store.commitCalendarConnectorPage({
    sourceId: 'calendar',
    expectedCheckpoint: '',
    nextCheckpoint: 'calendar-page-1',
    expectedConfig: configuredSource.config,
    graph: {
    entities: [{
      id: 'calendar-atomic-attendee',
      type: 'person',
      canonicalName: '日历原子参与者',
      trustStatus: 'candidate',
      confidence: 0.9,
      aliases: [],
      accountIds: []
    }],
    relations: [],
    reviewQueue: [{
      id: 'calendar-atomic-review',
      kind: 'entity',
      entityId: 'calendar-atomic-attendee',
      title: '日历原子参与者',
      detail: '等待身份确认',
      status: 'pending',
      confidence: 0.9
    }]
    } as any,
    graphCommitId: 'calendar-atomic-graph-commit',
    entityEvidence: [{
    entityId: 'calendar-atomic-attendee',
    sourceId: 'calendar',
    messageId: 'calendar-atomic-message',
    sessionId: 'data-source:calendar:test',
    timestamp: 1,
    sender: 'macOS 日历连接器',
    excerpt: '日历参与者身份原文',
    evidenceKind: 'identity'
    }],
    resources: [{
    id: 'calendar-atomic-resource',
    resourceType: 'calendar-event',
    title: '日历原子会议',
    content: '资源正文必须与时间线事件一起提交',
    metadata: { sourceId: 'calendar', contentHash: 'calendar-atomic-hash' },
    evidence: [{
      sourceId: 'calendar',
      sessionId: 'data-source:calendar:test',
      messageId: 'calendar-atomic-message',
      timestamp: 1,
      sender: 'macOS 日历连接器',
      excerpt: '日历资源原文'
    }]
    }],
    events: [{
    id: 'calendar-atomic-event',
    eventType: 'calendar',
    title: '日历原子会议',
    description: '时间线事件在最后的搜索写入触发故障',
    confidence: 1,
    status: 'confirmed',
    searchText: '日历原子会议',
    participants: [{
      entityId: 'calendar-atomic-attendee',
      role: 'attendee'
    }],
    evidence: [{
      sourceId: 'calendar',
      sessionId: 'data-source:calendar:test',
      messageId: 'calendar-atomic-message',
      timestamp: 1,
      sender: 'macOS 日历连接器',
      excerpt: '日历事件原文',
      role: 'direct'
    }]
    }],
    preserveExistingResourceEvidence: true
  }), /forced calendar event search failure/)
  assert.equal(
    store.listDataSources().find(item => item.id === 'calendar').checkpoint,
    ''
  )
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM memory_resources WHERE id='calendar-atomic-resource'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM entities WHERE id='calendar-atomic-attendee'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM review_queue WHERE id='calendar-atomic-review'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM entity_evidence WHERE entity_id='calendar-atomic-attendee'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM events WHERE id='calendar-atomic-event'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM evidence WHERE event_id='calendar-atomic-event'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_documents
    WHERE id IN ('resource:calendar-atomic-resource','event:calendar-atomic-event')
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_document_evidence
    WHERE document_id='resource:calendar-atomic-resource'
  `).get().count), 0)
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM search_fts
    WHERE document_id IN ('resource:calendar-atomic-resource','event:calendar-atomic-event')
  `).get().count), 0)
  assert.equal(store.getMemorySearchRevision(), revisions.search)
  assert.equal(store.getResourceArchiveRevision(), revisions.resource)
  assert.equal(store.getStructuredMemoryRevision(), revisions.structured)
  assert.equal(store.getMemoryEvidenceArchiveRevision(), revisions.evidence)
  assert.equal(store.getGraphReviewRevision(), revisions.graph)

  database.exec('DROP TRIGGER fail_calendar_event_search')
  store.commitCalendarConnectorPage({
    sourceId: 'calendar',
    expectedCheckpoint: '',
    nextCheckpoint: 'calendar-empty-page',
    expectedConfig: configuredSource.config,
    resources: [],
    events: []
  })
  assert.equal(
    store.listDataSources().find(item => item.id === 'calendar').checkpoint,
    'calendar-empty-page'
  )
  const beforeReconfigure = store.listDataSources().find(item => item.id === 'calendar')
  store.configureDataSource(
    'calendar',
    { calendarIds: ['new-calendar'] },
    true,
    beforeReconfigure.mutationToken
  )
  assert.throws(() => store.commitCalendarConnectorPage({
    sourceId: 'calendar',
    expectedCheckpoint: '',
    nextCheckpoint: 'stale-calendar-page',
    expectedConfig: configuredSource.config,
    resources: [],
    events: []
  }), /配置已变化/)
  assert.equal(
    store.listDataSources().find(item => item.id === 'calendar').checkpoint,
    ''
  )
}))

test('resource content replacement and append roll back authority when search indexing fails', () => withStore(store => {
  store.upsertResources([{
    id: 'atomic-resource-content',
    resourceType: 'document',
    title: '原子正文资源',
    content: '最初正文',
    metadata: { sourceId: 'documents', extractionStage: 'initial' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'atomic-content-message',
      timestamp: 1,
      sender: '本机文档连接器',
      excerpt: '最初正文'
    }]
  }])
  const database = (store as any).db
  database.exec(`
    CREATE TRIGGER fail_resource_content_search_update
    BEFORE UPDATE ON search_documents
    WHEN OLD.id='resource:atomic-resource-content'
    BEGIN
      SELECT RAISE(ABORT,'forced resource content search failure');
    END;
  `)
  const initialSearchRevision = store.getMemorySearchRevision()
  const initialResourceRevision = store.getResourceArchiveRevision()
  const readResource = () => {
    const row = database.prepare(`
      SELECT content,metadata_json FROM memory_resources
      WHERE id='atomic-resource-content'
    `).get()
    return { content: row.content, metadata: JSON.parse(row.metadata_json) }
  }

  assert.throws(() => store.replaceResourceContent(
    'atomic-resource-content',
    '替换后正文',
    { extractionStage: 'replacement' }
  ), /forced resource content search failure/)
  assert.deepEqual(readResource(), {
    content: '最初正文',
    metadata: { sourceId: 'documents', extractionStage: 'initial' }
  })
  assert.equal(store.getMemorySearchRevision(), initialSearchRevision)
  assert.equal(store.getResourceArchiveRevision(), initialResourceRevision)
  assert.equal(store.searchText('替换后正文').length, 0)

  assert.throws(() => store.appendResourceContent(
    'atomic-resource-content',
    '追加后正文',
    { extractionStage: 'append' }
  ), /forced resource content search failure/)
  assert.deepEqual(readResource(), {
    content: '最初正文',
    metadata: { sourceId: 'documents', extractionStage: 'initial' }
  })
  assert.equal(store.getMemorySearchRevision(), initialSearchRevision)
  assert.equal(store.getResourceArchiveRevision(), initialResourceRevision)
  assert.equal(store.searchText('追加后正文').length, 0)

  database.exec('DROP TRIGGER fail_resource_content_search_update')
  store.replaceResourceContent(
    'atomic-resource-content',
    '替换成功正文',
    { extractionStage: 'replacement' }
  )
  store.appendResourceContent(
    'atomic-resource-content',
    '追加成功正文',
    { extractionStage: 'append' }
  )
  assert.deepEqual(readResource(), {
    content: '替换成功正文\n追加成功正文',
    metadata: { sourceId: 'documents', extractionStage: 'append' }
  })
  assert.equal(
    store.searchText('追加成功正文')[0]?.id,
    'resource:atomic-resource-content'
  )
  assert.equal(store.getDocumentEvidencePage(
    'resource', 'atomic-resource-content'
  ).total, 1)
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
  const updatedResource = {
    ...resource,
    content: `${resource.content} 请查看链接。`,
    updatedAt: '2026-07-30T02:00:00.000Z'
  }
  store.upsertResources([updatedResource])
  const stableRevision = store.getMemorySearchRevision()
  const stableResourceRevision = store.getResourceArchiveRevision()
  store.upsertResources([updatedResource])
  assert.equal(store.getMemorySearchRevision(), stableRevision)
  assert.equal(store.getResourceArchiveRevision(), stableResourceRevision)

  const feed = store.getMemoryFeed()
  assert.equal(feed.resources.length, 1)
  assert.equal(feed.resources[0].content.includes('请查看链接'), true)
  assert.equal(feed.resources[0].evidence[0].message_id, 'message-resource-1')
  assert.equal(store.getMemoryStats().resources, 1)
  const results = store.searchText('报价有效期')
  assert.ok(results.some(item => item.id === 'resource:resource-link-1'))
  assert.equal(store.getDocumentEvidence('resource', 'resource-link-1')[0].sender, '老张')
  const deletePreview = store.previewDeleteResource('resource-link-1')
  assert.equal(deletePreview.counts.evidence, 1)
  assert.match(deletePreview.identitySha256, /^[a-f0-9]{64}$/)
  store.upsertResources([{ ...resource, content: `${resource.content} 已更新。` }])
  assert.notEqual(
    store.previewDeleteResource('resource-link-1').identitySha256,
    deletePreview.identitySha256
  )
  const deleted = store.deleteResource('resource-link-1')
  assert.equal(deleted.success, true)
  assert.equal(deleted.suppressed, true)
  assert.equal(store.getMemoryFeed().resources.length, 0)
  assert.equal(store.searchText('报价有效期').some(item => item.id === 'resource:resource-link-1'), false)
  assert.deepEqual(store.getDocumentEvidence('resource', 'resource-link-1'), [])
  store.upsertResources([resource])
  assert.equal(store.getMemoryStats().resources, 0)
  assert.equal(store.listResourceTrash()[0].title, '项目验收说明')
  const visibleTrash = store.listResourceTrashArchive({ limit: 40 }).items[0]
  assert.match(visibleTrash.mutation_token, /^[a-f0-9]{64}$/)
  assert.equal(visibleTrash.resourceType, 'link')
  assert.match(visibleTrash.deletedAt, /^20/)
  assert.equal('snapshot_json' in visibleTrash, false)
  ;(store as any).db.prepare(`
    UPDATE resource_trash SET reason='后台更新的删除原因' WHERE resource_id=?
  `).run('resource-link-1')
  assert.throws(() => store.restoreResource(
    'resource-link-1',
    visibleTrash.mutation_token
  ), /快照在展示后发生了变化/)
  const currentTrash = store.listResourceTrashArchive({ limit: 40 }).items[0]
  assert.notEqual(currentTrash.mutation_token, visibleTrash.mutation_token)
  assert.equal(store.restoreResource(
    'resource-link-1',
    currentTrash.mutation_token
  ).success, true)
  assert.equal(store.getMemoryStats().resources, 1)
  assert.ok(store.searchText('报价有效期').some(item => item.id === 'resource:resource-link-1'))
  assert.equal(store.getDocumentEvidence('resource', 'resource-link-1')[0].message_id, 'message-resource-1')
  assert.deepEqual(store.listResourceTrash(), [])
  store.deleteResource('resource-link-1')
  const purgePreview = store.previewPurgeResourceTrash('resource-link-1')
  assert.equal(purgePreview.title, '项目验收说明')
  assert.equal(purgePreview.counts.evidence, 1)
  assert.match(purgePreview.identitySha256, /^[a-f0-9]{64}$/)
  assert.equal(store.purgeResourceTrash('resource-link-1').purged, 1)
  assert.equal(store.previewPurgeResourceTrash('resource-link-1'), null)
  assert.equal(store.restoreResource('resource-link-1', '').success, false)
  store.upsertResources([resource])
  assert.equal(store.getMemoryStats().resources, 0)
}))

test('connector resources retain complete content-version evidence while snapshots still replace', () => withStore(store => {
  const resource = {
    id: 'local-document:versioned-resource',
    resourceType: 'document',
    title: '长期项目方案.md',
    content: '第一版方案',
    metadata: {
      sourceId: 'documents',
      contentHash: 'hash-v1',
      sessionName: '项目资料'
    },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'document-id:hash-v1',
      timestamp: 1,
      sender: '本机文档连接器',
      excerpt: '第一版方案'
    }]
  }
  store.upsertResources([resource], true)
  store.upsertResources([{
    ...resource,
    content: '第二版方案',
    metadata: { ...resource.metadata, contentHash: 'hash-v2' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'document-id:hash-v2',
      timestamp: 2,
      sender: '',
      excerpt: '第二版'
    }]
  }], true)
  store.upsertResources([{
    ...resource,
    content: '第二版方案',
    metadata: { ...resource.metadata, contentHash: 'hash-v2' },
    evidence: [{
      sourceId: 'documents',
      sessionId: 'data-source:documents',
      messageId: 'document-id:hash-v2',
      timestamp: 3,
      sender: '项目方案.md',
      excerpt: '第二版方案（补全后的完整原文）'
    }]
  }], true)

  const versions = store.getDocumentEvidence('resource', resource.id)
  assert.deepEqual(versions.map(item => [
    item.message_id, item.timestamp, item.sender, item.excerpt
  ]), [
    ['document-id:hash-v1', 1, '本机文档连接器', '第一版方案'],
    ['document-id:hash-v2', 3, '项目方案.md', '第二版方案（补全后的完整原文）']
  ])
  const archive = store.getDiagnostics().resourceEvidenceArchive
  assert.equal(archive.version, 1)
  assert.equal(archive.authoritativeEvidenceRows, 2)
  assert.equal(archive.syncRunsTotal, 3)
  assert.equal(archive.preservedHistoricalRowsThisSync, 1)
  assert.equal(archive.historicalRecoveryAvailable, false)

  store.upsertResources([{
    ...resource,
    content: '普通快照替换',
    evidence: [{
      sourceId: 'wechat',
      sessionId: 'snapshot-session',
      messageId: 'snapshot-current',
      timestamp: 4,
      sender: '当前发送者',
      excerpt: '当前快照'
    }]
  }])
  assert.deepEqual(
    store.getDocumentEvidence('resource', resource.id)
      .map(item => item.message_id),
    ['snapshot-current']
  )
}))

test('resource archive pages stay bounded, revision-safe and hydrate only one dossier', () => withStore(store => {
  const resources = Array.from({ length: 125 }, (_, index) => ({
    id: `resource-archive-${String(index).padStart(3, '0')}`,
    resourceType: index % 2 ? 'file' : 'link',
    title: `资源档案 ${index}`,
    url: index % 2 ? '' : `https://example.com/${index}`,
    fileName: index % 2 ? `附件-${index}.pdf` : '',
    fileExt: index % 2 ? '.pdf' : '',
    content: `只应在单条档案出现的资源正文 ${index} ${'正文'.repeat(200)}`,
    metadata: {
      sourceId: index === 124 ? 'legacy' : index % 3 ? 'wechat' : 'documents',
      sessionName: `会话 ${index}`,
      attachmentStructure: { kind: 'document', headings: [`标题 ${index}`] }
    },
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    evidence: [{
      sourceId: index === 124 ? 'legacy' : index % 3 ? 'wechat' : 'documents',
      messageId: `resource-message-${index}`,
      sessionId: `resource-session-${index}`,
      timestamp: 1_775_000_000 + index,
      sender: `发送者 ${index}`,
      excerpt: `资源原文 ${index}`
    }]
  }))
  store.upsertResources(resources)

  const first = store.listResourceArchive({ limit: 40 })
  assert.equal(first.total, 125)
  assert.equal(first.items.length, 40)
  assert.equal(first.hasMore, true)
  assert.match(first.revision, /^\d+$/)
  assert.equal('content' in first.items[0], false)
  assert.equal('metadata_json' in first.items[0], false)
  assert.equal('evidence' in first.items[0], false)
  assert.ok(JSON.stringify(first.items).length < 20_000)

  const second = store.listResourceArchive({
    limit: 40,
    offset: 40,
    revision: first.revision
  })
  assert.equal(second.items.length, 40)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 80)

  const filtered = store.listResourceArchive({
    resourceType: 'link',
    sourceId: 'documents',
    query: '资源正文',
    limit: 100
  })
  assert.ok(filtered.total > 0)
  assert.ok(filtered.items.every(item => item.resource_type === 'link'))
  const legacy = store.listResourceArchive({ sourceId: 'legacy', limit: 40 })
  assert.equal(legacy.total, 1)
  assert.equal(legacy.items[0].id, 'resource-archive-124')
  assert.equal(legacy.items[0].source_ids, 'legacy')

  const dossier = store.getResourceDossier(first.items[0].id, first.revision)
  assert.equal(dossier.stale, false)
  assert.match(dossier.content, /只应在单条档案出现的资源正文/)
  assert.equal(dossier.metadata.attachmentStructure.kind, 'document')
  assert.equal(dossier.evidence.length, 1)
  const directDossier = store.getCurrentResourceDossier(first.items[1].id)
  assert.equal(directDossier.stale, false)
  assert.equal(directDossier.id, first.items[1].id)
  assert.match(directDossier.content, /只应在单条档案出现的资源正文/)

  store.upsertResources([{
    ...resources[0],
    title: '并发更新后的资源标题',
    updatedAt: '2026-07-02T00:00:00.000Z'
  }])
  assert.equal(store.listResourceArchive({
    limit: 40,
    offset: 40,
    revision: first.revision
  }).stale, true)
  assert.equal(store.getResourceDossier(first.items[1].id, first.revision).stale, true)

  store.deleteResource(resources[0].id)
  const trash = store.listResourceTrashArchive({ query: '并发更新', limit: 40 })
  assert.equal(trash.total, 1)
  assert.equal(trash.items[0].title, '并发更新后的资源标题')
  assert.equal('snapshot_json' in trash.items[0], false)
  assert.equal('content' in trash.items[0], false)
  assert.equal(store.getResourceArchiveRevisionHealth().healthy, true)
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
  assert.equal(store.restoreResource(resource.id, '').success, false)
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

test('background resource migrations deserialize only their bounded eligible rows', () => withStore(store => {
  const database = (store as any).db
  const insert = database.prepare(`
    INSERT INTO memory_resources(
      id,resource_type,title,url,file_name,file_ext,content,metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `)
  database.transaction(() => {
    for (let index = 0; index < 600; index += 1) {
      const suffix = String(index).padStart(4, '0')
      insert.run(
        `irrelevant-${suffix}`, 'file', `Irrelevant ${suffix}`, '', '', '.txt', '',
        JSON.stringify({ migrationProbe: true }),
        `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
        `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`
      )
    }
    for (let index = 0; index < 15; index += 1) {
      const suffix = String(index).padStart(2, '0')
      insert.run(
        `pending-pdf-${suffix}`, 'file', `PDF ${suffix}`, '', '', '.pdf', '',
        JSON.stringify({
          migrationProbe: true,
          attachmentFormat: '.pdf-ocr',
          attachmentLocalPath: `/tmp/pending-${suffix}.pdf`,
          attachmentPdfOcrTruncated: true,
          attachmentPdfOcrNextPage: 2
        }),
        `2026-02-01T00:00:${suffix}.000Z`, `2026-02-01T00:00:${suffix}.000Z`
      )
      insert.run(
        `pending-layout-${suffix}`, 'file', `Layout ${suffix}`, '', '', '.docx', '',
        JSON.stringify({
          migrationProbe: true,
          attachmentFormat: '.docx',
          attachmentLocalPath: `/tmp/pending-${suffix}.docx`
        }),
        `2026-03-01T00:00:${suffix}.000Z`, `2026-03-01T00:00:${suffix}.000Z`
      )
      insert.run(
        `pending-image-${suffix}`, 'image', `Image ${suffix}`, '', '', '.png', '',
        JSON.stringify({
          migrationProbe: true,
          mediaLocalPath: `/tmp/pending-${suffix}.png`
        }),
        `2026-04-01T00:00:${suffix}.000Z`, `2026-04-01T00:00:${suffix}.000Z`
      )
    }
    insert.run(
      'malformed-migration-metadata', 'image', 'Malformed', '', '', '.png', '',
      '{not-json', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'
    )
  })()

  const originalParse = JSON.parse
  let migrationMetadataParses = 0
  JSON.parse = ((value: string, ...args: any[]) => {
    if (String(value).includes('"migrationProbe":true')) migrationMetadataParses += 1
    return originalParse(value, ...args)
  }) as typeof JSON.parse
  try {
    assert.equal(store.listPendingPdfOcrResources(10).length, 10)
    assert.equal(store.listPendingAttachmentStructureResources('layout-v-next', 10).length, 10)
    assert.equal(store.listPendingImageSemanticResources('vision-v-next', 10).length, 10)
    assert.deepEqual(store.getAttachmentStructureMigrationStats('layout-v-next'), {
      total: 15, completed: 0, pending: 15, deferred: 0
    })
    assert.deepEqual(store.getImageSemanticMigrationStats('vision-v-next'), {
      total: 15, completed: 0, pending: 15, deferred: 0
    })
  } finally {
    JSON.parse = originalParse
  }
  assert.equal(migrationMetadataParses, 30)
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
  const claimDeleteIdentity = store.previewDeleteMemoryItem('claim', claim.id).identitySha256
  store.saveAssistantExchange('第二个敏感问题', '第二个敏感答案', [{
    documentId: `claim:${claim.id}`, type: 'claim', sourceId: claim.id,
    title: claim.predicate, content: claim.searchText, evidence: claim.evidence
  }])
  assert.notEqual(
    store.previewDeleteMemoryItem('claim', claim.id).identitySha256,
    claimDeleteIdentity
  )
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
    const initialRevision = Number(first.getMemoryDeletionAuditRevision())
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
    assert.ok(Number(first.getMemoryDeletionAuditRevision()) > initialRevision)

    const firstPage = first.listMemoryDeletionAuditPage({ limit: 40 })
    const secondPage = first.listMemoryDeletionAuditPage({
      limit: 40,
      offset: 40,
      revision: firstPage.revision
    })
    assert.equal(firstPage.total, 2_500)
    assert.equal(firstPage.items.length, 40)
    assert.equal(secondPage.items.length, 40)
    assert.equal(secondPage.stale, false)
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
    database.prepare('UPDATE memory_deletion_audit SET reason=reason WHERE id=?').run(1)
    const stalePage = first.listMemoryDeletionAuditPage({
      limit: 40,
      offset: 40,
      revision: firstPage.revision
    })
    assert.equal(stalePage.stale, true)
    assert.deepEqual(stalePage.items, [])
    const deletionAuditRevisionHealth = first.getMemoryDeletionAuditRevisionHealth()
    assert.equal(deletionAuditRevisionHealth.version, 'memory-deletion-audit-revision-v2')
    assert.equal(deletionAuditRevisionHealth.expectedTriggers, 3)
    assert.equal(deletionAuditRevisionHealth.validTriggers, 3)
    assert.equal(deletionAuditRevisionHealth.healthy, true)
    database.exec('DROP TRIGGER trg_memory_deletion_audit_revision_insert')
    assert.equal(first.getMemoryDeletionAuditRevisionHealth().installedTriggers, 2)
    assert.equal(first.getMemoryDeletionAuditRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    try {
      reopened.initialize(databasePath, key)
      assert.equal(reopened.getMemoryDeletionAuditRevisionHealth().installedTriggers, 3)
      assert.equal(reopened.getMemoryDeletionAuditRevisionHealth().healthy, true)
      const reopenedFirstPage = reopened.listMemoryDeletionAuditPage({ limit: 40 })
      const lastPage = reopened.listMemoryDeletionAuditPage({
        offset: 2_480,
        limit: 40,
        revision: reopenedFirstPage.revision
      })
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
  const initialSources = store.listDataSources()
  const initialWechat = initialSources.find(item => item.id === 'wechat')
  const initialCalendar = initialSources.find(item => item.id === 'calendar')
  assert.equal(initialWechat?.enabled, true)
  assert.match(initialWechat?.mutationToken, /^[a-f0-9]{64}$/)
  assert.throws(() => store.setDataSourceEnabled(
    'calendar', true, initialCalendar?.mutationToken
  ), /尚未安装/)

  store.setDataSourceEnabled('wechat', false, initialWechat?.mutationToken)
  assert.throws(() => store.setDataSourceEnabled(
    'wechat', true, initialWechat?.mutationToken
  ), /数据源状态在展示后发生了变化/)
  const disabledWechat = store.listDataSources().find(item => item.id === 'wechat')
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
  assert.equal(source.mutationToken, disabledWechat?.mutationToken)
  assert.notEqual(source.mutationToken, initialWechat?.mutationToken)

  const enabledAfterRunProgress = store.setDataSourceEnabled(
    'wechat',
    true,
    disabledWechat?.mutationToken
  )
  assert.equal(enabledAfterRunProgress.enabled, true)
  assert.equal(enabledAfterRunProgress.checkpoint, 'cursor-42')

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

  store.updateDataSourceRun('calendar', {
    status: 'error',
    checkpoint: 'background-calendar-cursor',
    attemptedAt: '2026-07-30T00:02:00.000Z',
    error: '后台运行状态不应使配置表单过期'
  })
  const configured = store.configureDataSource(
    'calendar',
    { calendarIds: ['work'] },
    true,
    initialCalendar?.mutationToken
  )
  assert.equal(configured.available, true)
  assert.equal(configured.enabled, true)
  assert.deepEqual(configured.config, { calendarIds: ['work'] })
  assert.equal(configured.checkpoint, '')
  assert.throws(() => store.configureDataSource(
    'calendar',
    { calendarIds: ['private'] },
    true,
    initialCalendar?.mutationToken
  ), /数据源配置在展示后发生了变化/)
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

test('omitted closed-task evidence preserves SQLCipher authority while an explicit empty set clears it', () => withStore(store => {
  const task = {
    id: 'closed-task-state-storage',
    title: '已经完成的长期任务',
    detail: '初始详情',
    owner: '我',
    priority: 'medium',
    status: 'done',
    classification: 'mine',
    source: '微信',
    sourceSessionId: 'closed-task-session',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    evidence: Array.from({ length: 125 }, (_, index) => ({
      sourceId: 'wechat',
      sessionId: 'closed-task-session',
      messageId: `closed-task-message-${index}`,
      timestamp: index,
      sender: '任务发送者',
      excerpt: `关闭任务原文 ${index}`
    }))
  }
  store.syncTasks([task])
  assert.deepEqual(store.getTaskEvidenceStorageStats(), {
    authoritativeTaskEvidenceRows: 125,
    closedTaskEvidenceRows: 125
  })

  const { evidence: _evidence, ...lightweight } = task
  store.syncTasks([{ ...lightweight, detail: '重启后的轻量结构更新' }])
  const database = (store as any).db
  assert.equal(database.prepare(`
    SELECT COUNT(*) FROM search_document_evidence
    WHERE document_id='task:closed-task-state-storage'
  `).pluck().get(), 125)
  assert.equal(store.listTaskArchive({ query: '轻量结构更新', limit: 10 }).total, 1)
  const hydrated = store.listTaskEvidence(['closed-task-state-storage'])
  assert.equal(hydrated.get('closed-task-state-storage')?.length, 125)
  assert.equal(hydrated.get('closed-task-state-storage')?.at(-1)?.messageId,
    'closed-task-message-124')

  store.syncTasks([{ ...lightweight, detail: '显式移除原文', evidence: [] }])
  assert.equal(database.prepare(`
    SELECT COUNT(*) FROM search_document_evidence
    WHERE document_id='task:closed-task-state-storage'
  `).pluck().get(), 0)
  assert.deepEqual(store.getTaskEvidenceStorageStats(), {
    authoritativeTaskEvidenceRows: 0,
    closedTaskEvidenceRows: 0
  })
}))
