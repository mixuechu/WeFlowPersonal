import crypto from 'crypto'

type Scope = Record<string, unknown>
const value = (input: unknown): string => String(input || '').trim()
const folded = (input: unknown): string => value(input).toLocaleLowerCase('zh-CN')
const digest = (kind: string, parts: unknown[]): string => crypto.createHash('sha256')
  .update(JSON.stringify([`audit-archive-${kind}-scope-v1`, ...parts])).digest('hex')

export const buildTaskOwnershipScopeToken = (scope: Scope = {}): string => digest('task-ownership', [
  value(scope.classification), value(scope.priority), folded(scope.query),
  value(scope.from), value(scope.to)
])

export const buildTaskFeedbackScopeToken = (scope: Scope = {}): string => digest('task-feedback', [
  value(scope.status), value(scope.decision), value(scope.reasonCode), folded(scope.query),
  value(scope.from), value(scope.to)
])

export const buildDeletionAuditScopeToken = (scope: Scope = {}): string => digest('deletion', [
  value(scope.kind), value(scope.reason), folded(scope.query), value(scope.from), value(scope.to)
])

export const buildMaintenanceAuditScopeToken = (scope: Scope = {}): string => digest('maintenance', [
  value(scope.operation), value(scope.trigger), value(scope.from), value(scope.to)
])

export const buildMemoryGrowthScopeToken = (scope: Scope = {}): string => digest('memory-growth', [
  value(scope.kind), value(scope.change), value(scope.detail), value(scope.origin),
  value(scope.source), value(scope.connectorOperation), value(scope.entityId),
  value(scope.from), value(scope.to)
])

export const buildMergeHistoryScopeToken = (scope: Scope = {}): string => digest('merge-history', [
  value(scope.status), folded(scope.query), value(scope.from), value(scope.to)
])

export const buildIngestionRunScopeToken = (scope: Scope = {}): string => digest('ingestion-run', [
  value(scope.status), value(scope.trigger), value(scope.backlogOutcome),
  value(scope.batchOutcome), value(scope.window), folded(scope.query),
  value(scope.from), value(scope.to)
])

export const buildIngestionRecoveryScopeToken = (scope: Scope = {}): string =>
  digest('ingestion-recovery', [folded(scope.query)])

export const buildCrossStoreRecoveryScopeToken = (scope: Scope = {}): string =>
  digest('cross-store-recovery', [value(scope.kind), folded(scope.query)])

export const buildCrossStoreRecoveryArchiveScopeToken = (scope: Scope = {}): string =>
  digest('cross-store-recovery-archive', [
    value(scope.kind), value(scope.status), value(scope.action), folded(scope.query),
    value(scope.from), value(scope.to)
  ])

export const buildResourceArchiveScopeToken = (scope: Scope = {}): string => digest('resource', [
  value(scope.resourceType), value(scope.sourceId), value(scope.enrichmentKind),
  value(scope.enrichmentStatus), folded(scope.query), value(scope.from), value(scope.to),
  value(scope.attachmentStructureParserVersion), value(scope.imageSemanticModelVersion)
])

export const buildResourceTrashScopeToken = (scope: Scope = {}): string =>
  digest('resource-trash', [folded(scope.query)])

export const buildMemoryItemAuditScopeToken = (scope: Scope = {}): string =>
  digest('memory-item', [value(scope.kind), value(scope.itemId)])

export const buildEventCorrectionSnapshotScopeToken = (scope: Scope = {}): string =>
  digest('event-correction-snapshot', [
    value(scope.correctionId), value(scope.phase), folded(scope.query)
  ])

export const buildEntityAuditScopeToken = (scope: Scope = {}): string =>
  digest('entity-audit', [value(scope.entityId), value(scope.kind)])

export const buildEventDossierParticipantScopeToken = (scope: Scope = {}): string =>
  digest('event-dossier-participant', [
    value(scope.eventId), value(scope.expectedSearchRevision)
  ])

export const buildRelationDossierAuditScopeToken = (scope: Scope = {}): string =>
  digest('relation-dossier-audit', [
    value(scope.relationId), value(scope.kind), value(scope.expectedSearchRevision)
  ])

export const buildTaskHistoryScopeToken = (scope: Scope = {}): string =>
  digest('task-history', [value(scope.taskId)])

export const buildEntityTaskScopeToken = (scope: Scope = {}): string =>
  digest('entity-task', [value(scope.entityId)])

export const buildProjectMemberScopeToken = (scope: Scope = {}): string =>
  digest('project-member', [value(scope.projectId)])

export const buildProjectTaskScopeToken = (scope: Scope = {}): string =>
  digest('project-task', [value(scope.projectId)])

export const buildProjectRiskScopeToken = (scope: Scope = {}): string =>
  digest('project-risk', [value(scope.projectId), value(scope.today)])

export const buildTaskReminderScopeToken = (scope: Scope = {}): string =>
  digest('task-reminder', [value(scope.reminderId)])

export const buildAssistantConversationScopeToken = (scope: Scope = {}): string =>
  digest('assistant-conversation', [
    folded(scope.query), value(scope.from), value(scope.to), value(scope.revalidationStatus)
  ])

export const buildAssistantModelAuditScopeToken = (scope: Scope = {}): string =>
  digest('assistant-model-audit', [
    value(scope.requestKind), value(scope.status), value(scope.answerOutcome),
    value(scope.answerOutcomeCode), value(scope.from), value(scope.to)
  ])

export const buildAssistantAnswerReviewScopeToken = (scope: Scope = {}): string =>
  digest('assistant-answer-review', [
    value(scope.status), value(scope.reviewState), value(scope.invalidReason),
    folded(scope.query), value(scope.from), value(scope.to)
  ])

export const buildAssistantAnswerDecisionScopeToken = (scope: Scope = {}): string =>
  digest('assistant-answer-decision', [value(scope.messageId)])

export const buildEventCorrectionParticipantScopeToken = (scope: Scope = {}): string =>
  digest('event-correction-participant', [value(scope.eventId)])

export const buildAssistantConversationMessageScopeToken = (scope: Scope = {}): string =>
  digest('assistant-conversation-message', [
    value(scope.conversationId), value(scope.anchorMessageId)
  ])

export const buildIngestionRunDossierScopeToken = (scope: Scope = {}): string =>
  digest('ingestion-run-dossier', [value(scope.runId)])

export const buildTaskFeedbackDossierScopeToken = (scope: Scope = {}): string =>
  digest('task-feedback-dossier', [value(scope.evidenceFingerprint)])

export const buildMemorySearchFeedbackArchiveScopeToken = (scope: Scope = {}): string =>
  digest('memory-search-feedback', [
    value(scope.action), folded(scope.query), value(scope.from), value(scope.to)
  ])
