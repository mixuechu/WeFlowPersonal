import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeletionAuditScopeToken,
  buildCrossStoreRecoveryArchiveScopeToken,
  buildCrossStoreRecoveryScopeToken,
  buildIngestionRecoveryScopeToken,
  buildIngestionRunScopeToken,
  buildMaintenanceAuditScopeToken,
  buildMemoryGrowthScopeToken,
  buildMergeHistoryScopeToken,
  buildMemoryItemAuditScopeToken,
  buildEventCorrectionSnapshotScopeToken,
  buildEntityAuditScopeToken,
  buildEventDossierParticipantScopeToken,
  buildRelationDossierAuditScopeToken,
  buildTaskHistoryScopeToken,
  buildEntityTaskScopeToken,
  buildProjectMemberScopeToken,
  buildProjectTaskScopeToken,
  buildProjectRiskScopeToken,
  buildTaskReminderScopeToken,
  buildAssistantConversationScopeToken,
  buildAssistantModelAuditScopeToken,
  buildAssistantAnswerReviewScopeToken,
  buildAssistantAnswerDecisionScopeToken,
  buildEventCorrectionParticipantScopeToken,
  buildAssistantConversationMessageScopeToken,
  buildIngestionRunDossierScopeToken,
  buildTaskFeedbackDossierScopeToken,
  buildMemorySearchFeedbackArchiveScopeToken,
  buildResourceArchiveScopeToken,
  buildResourceTrashScopeToken,
  buildTaskFeedbackScopeToken,
  buildTaskOwnershipScopeToken
} from '../electron/services/auditArchiveScope.ts'

test('audit archive tokens bind every filter but never pagination controls', () => {
  const cases: Array<[any, Record<string, unknown>, Record<string, unknown>]> = [
    [buildTaskOwnershipScopeToken, { classification: 'other', priority: 'high', query: '跟进', from: 'a', to: 'b' }, { priority: 'low' }],
    [buildTaskFeedbackScopeToken, { status: 'active', decision: 'rejected', reasonCode: 'not_mine', query: '报价', from: 'a', to: 'b' }, { decision: 'mine' }],
    [buildDeletionAuditScopeToken, { kind: 'claim', reason: 'not_important', query: '旧事实', from: 'a', to: 'b' }, { reason: 'manual_delete' }],
    [buildMaintenanceAuditScopeToken, { operation: 'backup_create', trigger: 'manual', from: 'a', to: 'b' }, { trigger: 'automatic' }],
    [buildMemoryGrowthScopeToken, { kind: 'entity', change: 'updated', detail: 'identity', origin: 'human_action', source: 'wechat', connectorOperation: 'all', entityId: 'e1', from: 'a', to: 'b' }, { entityId: 'e2' }],
    [buildMergeHistoryScopeToken, { status: 'active', query: '张三', from: 'a', to: 'b' }, { status: 'reverted' }]
    , [buildIngestionRunScopeToken, { status: 'failed', trigger: 'resume', backlogOutcome: 'paused', batchOutcome: 'failed_any', window: '7d', query: '中断', from: 'a', to: 'b' }, { window: '24h' }]
    , [buildIngestionRecoveryScopeToken, { query: 'batch-a' }, { query: 'batch-b' }]
    , [buildCrossStoreRecoveryScopeToken, { kind: 'task', query: 'commit-a' }, { kind: 'source' }]
    , [buildCrossStoreRecoveryArchiveScopeToken, { kind: 'task', status: 'abandoned', action: 'user_kept_current_state', query: 'commit-a', from: 'a', to: 'b' }, { action: 'automatic_abandon' }]
    , [buildResourceArchiveScopeToken, { resourceType: 'image', sourceId: 'wechat', enrichmentKind: 'image_semantics', enrichmentStatus: 'pending', query: '截图', from: 'a', to: 'b', attachmentStructureParserVersion: 'p1', imageSemanticModelVersion: 'm1' }, { imageSemanticModelVersion: 'm2' }]
    , [buildResourceTrashScopeToken, { query: '合同' }, { query: '图片' }]
    , [buildMemoryItemAuditScopeToken, { kind: 'claim', itemId: 'c1' }, { itemId: 'c2' }]
    , [buildEventCorrectionSnapshotScopeToken, { correctionId: 1, phase: 'before', query: '张三' }, { phase: 'after' }]
    , [buildEntityAuditScopeToken, { entityId: 'e1', kind: 'name_correction' }, { kind: 'relation_history' }]
    , [buildEventDossierParticipantScopeToken, { eventId: 'ev1', expectedSearchRevision: 'r1' }, { eventId: 'ev2' }]
    , [buildRelationDossierAuditScopeToken, { relationId: 'rel1', kind: 'history', expectedSearchRevision: 'r1' }, { kind: 'correction' }]
    , [buildTaskHistoryScopeToken, { taskId: 'task-1' }, { taskId: 'task-2' }]
    , [buildEntityTaskScopeToken, { entityId: 'entity-1' }, { entityId: 'entity-2' }]
    , [buildProjectMemberScopeToken, { projectId: 'project-1' }, { projectId: 'project-2' }]
    , [buildProjectTaskScopeToken, { projectId: 'project-1' }, { projectId: 'project-2' }]
    , [buildProjectRiskScopeToken, { projectId: 'project-1', today: '2026-08-13' }, { today: '2026-08-14' }]
    , [buildTaskReminderScopeToken, { reminderId: 'reminder-1' }, { reminderId: 'reminder-2' }]
    , [buildAssistantConversationScopeToken, { query: '计划', from: 'a', to: 'b', revalidationStatus: 'current' }, { revalidationStatus: 'invalid' }]
    , [buildAssistantModelAuditScopeToken, { requestKind: 'memory_answer', status: 'failed', answerOutcome: 'rejected', answerOutcomeCode: 'invalid_model_json', from: 'a', to: 'b' }, { requestKind: 'task_lifecycle_audit' }]
    , [buildAssistantAnswerReviewScopeToken, { status: 'attention', reviewState: 'pending', invalidReason: 'missing', query: '项目', from: 'a', to: 'b' }, { reviewState: 'resolved' }]
    , [buildAssistantAnswerDecisionScopeToken, { messageId: 'message-1' }, { messageId: 'message-2' }]
    , [buildEventCorrectionParticipantScopeToken, { eventId: 'event-1' }, { eventId: 'event-2' }]
    , [buildAssistantConversationMessageScopeToken, { conversationId: 'conversation-1', anchorMessageId: 'message-1' }, { anchorMessageId: 'message-2' }]
    , [buildIngestionRunDossierScopeToken, { runId: 'run-1' }, { runId: 'run-2' }]
    , [buildTaskFeedbackDossierScopeToken, { evidenceFingerprint: 'fingerprint-1' }, { evidenceFingerprint: 'fingerprint-2' }]
    , [buildMemorySearchFeedbackArchiveScopeToken, { action: 'helpful', query: '项目', from: 'a', to: 'b' }, { action: 'not_relevant' }]
  ]
  for (const [builder, base, changed] of cases) {
    const first = builder(base)
    assert.notEqual(first, builder({ ...base, ...changed }))
    assert.equal(first, builder({ ...base, offset: 1000, limit: 1, revision: 'ignored' }))
  }
})
