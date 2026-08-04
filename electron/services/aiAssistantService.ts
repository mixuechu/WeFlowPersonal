import { app } from 'electron'
import crypto from 'crypto'
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { jsonrepair } from 'jsonrepair'
import JSZip from 'jszip'
import { ConfigService } from './config'
import { httpService } from './httpService'
import { showSystemNotification } from './systemNotificationService'
import { personalMemoryStore } from './personalMemoryStore'
import { localEmbeddingService } from './localEmbeddingService'
import { extractAttachmentText } from './attachmentTextExtractor'
import { structureOcrText } from './imageOcrStructuring'
import { captureWebSnapshot } from './webSnapshotService'
import { extractScannedPdfText, getPdfOcrStatus } from './pdfOcrService'
import { exportService } from './export'
import {
  filterMemorySearchResults,
  isMemorySearchPageRevisionStale,
  paginateMemoryResults,
  type MemorySearchOptions
} from './memorySearchFilters'
import {
  applyMemorySearchFeedback,
  buildMemorySearchFeedbackContext,
  MEMORY_SEARCH_FEEDBACK_VERSION,
  type MemorySearchFeedbackAction
} from './memorySearchFeedback.ts'
import {
  assertMemoryCitationReviewToken,
  buildMemoryCitationReviewIdentity,
  buildMemoryCitationReviewToken
} from './memoryCitationReviewPolicy.ts'
import {
  assertConversationSourceMutation,
  buildConversationSourceDirectory,
  type ConversationSourceDirectoryOptions
} from './conversationSourceDirectory.ts'
import {
  buildConversationSourceCursorToken,
  classifyConversationSourceMutationRecovery,
  readConversationSourceCursorState
} from './conversationSourceMutationPolicy.ts'
import { buildContextualMemoryQuestion, buildMemoryQueryPlan } from './memoryQueryPlanner'
import {
  applyTaskReviewFeedback,
  reconcileTasksWithReviewDecisions,
  taskEvidenceFingerprint
} from './taskReviewFeedback'
import {
  assertTaskMutationBatch,
  buildTaskMutationToken,
  classifyTaskMutationRecovery
} from './taskMutationPolicy.ts'
import {
  applyReminderPreferences,
  assertReminderPreferenceMutation,
  buildTaskReminders,
  findMatchingTask,
  normalizeReminderPreferences,
  paginateTaskReminders,
  type ReminderPreferences,
  type TaskReminder
} from './taskIntelligence'
import { buildEntityInsights, paginateEntityRelatedTasks } from './relationshipInsights'
import { classifyTaskAssignment, evaluateTaskAssignmentPolicy } from './taskAssignmentPolicy'
import { buildWeeklyBriefing, isQuietTime } from './briefingIntelligence'
import { groundBriefingDigest } from './briefingEvidencePolicy'
import {
  structuredEvidenceKey,
  validateStructuredDigestEvidence
} from './structuredEvidencePolicy'
import { planExtractedEntityResolution } from './entityResolutionPolicy'
import {
  buildEntitySummaryCandidate,
  planEntitySummaryConfirmation
} from './entitySummaryPolicy'
import {
  buildEntityAliasCandidates,
  planEntityAliasConfirmation
} from './entityAliasPolicy'
import {
  buildEntityCreationReview,
  buildLegacyEntityReview,
  canConfirmEntityCreation,
  inferLegacyEntityTrustStatus,
  isTrustedEntity,
  planEntityCreationConfirmation,
  type EntityTrustStatus
} from './entityTrustPolicy'
import { planEntityMerge } from './entityMergeDirection'
import {
  buildTrustedEntityDirectory,
  resolveTrustedEntityPairSelection,
  resolveTrustedEntitySelection,
  type TrustedEntityDirectoryOptions
} from './trustedEntityDirectory.ts'
import {
  assertEntityForgetConfirmation,
  buildEntityForgetPreviewToken
} from './entityForgetPolicy'
import {
  assertMemoryImportConfirmation,
  buildMemoryImportPreviewToken,
  type MemoryImportPreviewIdentity
} from './memoryImportPolicy'
import {
  assertMemoryBackupRestoreConfirmation,
  buildMemoryBackupRestorePreviewToken,
  type MemoryBackupRestoreIdentity
} from './memoryBackupRestorePolicy'
import {
  assertResourceDeletionConfirmation,
  buildResourceDeletionPreviewToken
} from './resourceDeletionPolicy'
import {
  assertStructuredMemoryDeletionConfirmation,
  buildStructuredMemoryDeletionPreviewToken,
  type StructuredMemoryDeletionReason
} from './structuredMemoryDeletionPolicy'
import {
  assertAssistantConversationDeletionConfirmation,
  buildAssistantConversationDeletionPreviewToken
} from './assistantConversationDeletionPolicy'
import {
  assertAssistantSettingsMutationToken,
  buildAssistantSettingsMutationToken,
  normalizeAssistantSettingsInput,
  type AssistantSettingsMutationIdentity
} from './assistantSettingsMutationPolicy'
import {
  isPlaceholderPersonEntity,
  quarantinePlaceholderPersonEntities
} from './placeholderEntityPolicy'
import { assertGraphReviewMutationRevision } from './graphReviewMutationPolicy'
import { assertTaskOwnershipMutationRevision } from './taskOwnershipMutationPolicy'
import { assertStructuredMemoryMutationRevision } from './structuredMemoryMutationPolicy'
import {
  assertIdentityMergeRevertConfirmation,
  buildIdentityMergeRevertPreviewToken,
  inspectIdentityMergeRevert,
  restoreIdentityMergeGraph
} from './identityMergeRevertPolicy'
import {
  ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT,
  compactEntityEvidenceMessageIds
} from '../../shared/entityEvidenceHotset.ts'
import {
  buildEncryptedAssistantState,
  getTaskStateStorageStats
} from '../../shared/taskStateStorage.ts'
import { applyRelationConfirmation, planRelationConfirmation, type RelationCorrection } from './relationCorrectionPolicy'
import {
  deliverNotificationBatch,
  enqueueUniqueNotification,
  type NotificationOutbox
} from './notificationOutbox'
import { findCommonGraphNeighbors, findScopedGraphPath } from './graphCommonNeighbors'
import {
  boundedEvidencePayload,
  GRAPH_QUERY_EVIDENCE_LIMIT,
  MEMORY_CARD_EVIDENCE_LIMIT
} from '../../shared/evidencePayload'
import {
  buildProjectDirectory,
  buildProjectInsight,
  countProjectDirectory,
  paginateProjectDirectory,
  paginateProjectRisks,
  paginateProjectTasks
} from './projectInsights'
import { buildDashboardRevisions, buildGraphWorkspaceRevision } from './dashboardRevisions'
import { attachLocalImageOcr, attachLocalVoiceTranscript, recoverMessageSemantics } from './messageSemanticRecovery'
import { sanitizeDiagnosticText } from './diagnosticRedaction'
import { getSensitiveLogDiagnostics } from './sensitiveLogPolicy'
import {
  buildExtractionContextAudit,
  EXTRACTION_MEMORY_CONTEXT_VERSION,
  selectTrustedExtractionEntities
} from './extractionMemoryContext'
import {
  initializeSessionRetryCursors,
  nextSessionContinuationOffset,
  planSessionCursorProgress
} from './ingestionCursorPolicy'
import { buildOverlappingAnalysisBatches } from './analysisBatching'
import {
  EXTRACTION_OUTPUT_LIMITS,
  accumulateExtractionAttemptMeta,
  inspectExtractionCoverage,
  splitSaturatedAnalysisBatch
} from './extractionCoveragePolicy'
import {
  compactGraphRelationEvidence,
  compactRelationEvidenceHotset
} from './graphEvidenceHotset'
import {
  EMPTY_BACKLOG_RETRY_STATE,
  isBacklogRetryDue,
  planBacklogRetry,
  type BacklogRetryState
} from './backlogRetryPolicy'
import {
  includeContinuationSessions,
  settleWithConcurrency
} from './sessionCollectionPolicy'
import { getAppRunRecoveryDiagnostics } from './appRunRecoveryService'
import type { DurableJsonRecovery } from './durableJsonState'
import {
  encodeEncryptedDurableJson,
  isEncryptedDurableJson,
  readEncryptedDurableJson,
  writeEncryptedDurableJson
} from './encryptedDurableJsonState'
import {
  PERSONAL_DATA_SOURCE_CATALOG,
  MEMORY_RAG_SYSTEM_PROMPT,
  buildModelMemoryContext,
  buildUntrustedMemoryQuestionEnvelope,
  classifyDocumentTaskOwnership,
  finalizeGroundedMemoryAnswer,
  getMemoryCitationFreshness,
  getMemoryEvidenceEligibility,
  normalizeDataSourceClaimNature,
  revalidateGroundedStatements,
  runPersonalDataSourceBatch
} from './personalDataSources'
import { LocalDocumentDataSource } from './localDocumentDataSource'
import { LocalCalendarDataSource, localCalendarService } from './localCalendarDataSource'
import { LocalMailDataSource, localMailService } from './localMailDataSource'
import { AsyncExpiringValue } from './asyncExpiringValue'
import {
  mapCalendarParticipantIdentities,
  type ExternalIdentity
} from './calendarParticipantIdentity'
import {
  decryptPortableMemoryBundle,
  encryptPortableMemoryBundle,
  isPortableMemoryBundle
} from './portableMemoryBundle'
import { redactLocalSecrets, redactSensitiveText, type SensitiveRedactionLevel } from './sensitiveRedaction'
import { chatService } from './chatService'
import { voiceTranscribeService } from './voiceTranscribeService'
import { localOcrService } from './localOcrService'
import { buildImageSemanticText, localImageSemanticService } from './localImageSemanticService'
import {
  assessIdentityPair,
  buildGraphIdentitySuggestions,
  buildNameBuckets,
  getFullIdentityScanSchedule,
  identityPairKey,
  isNegativeDecisionCurrent
} from './identityDisambiguation'
import { type GraphReviewPageOptions } from '../../shared/graphReviewPagination'
import { buildGraphViewport, type GraphViewportOptions } from '../../shared/graphViewport'
import {
  buildGraphDashboardPayload,
  buildGraphReviewEntityPayload,
  claimEntitiesAreTrusted,
  eventEntitiesAreTrusted,
  toGraphViewportEdge,
  toGraphViewportNode
} from '../../shared/graphPayload'
import { buildTaskDossier } from '../../shared/taskPayload'
import { buildTaskDependencyCandidates } from '../../shared/taskDependencyCandidates'
import { buildCursorStatusPayload } from '../../shared/cursorPayload'
import { collectStableCursorPages } from '../../shared/stableCursorPagination'
import {
  BRIEFING_RETENTION_DAYS,
  BRIEFING_STORAGE_VERSION,
  compactBriefings
} from '../../shared/briefingRetention'
import {
  GRAPH_REVIEW_STORAGE_VERSION,
  compactGraphReviewWorkset
} from '../../shared/graphReviewStorage'
import {
  GRAPH_COMMIT_RECOVERY_VERSION,
  recoverGraphStateFromSql,
  shouldRecoverGraphFromSql
} from '../../shared/graphCommitRecovery'
import {
  EMPTY_RESUME_CATCHUP_RETRY_STATE,
  assessSchedulerWake,
  assessScheduledSyncResult,
  isResumeCatchupRetryDue,
  planScheduledSyncState,
  planResumeCatchupRetry,
  scheduledSyncTargetTimestamp,
  shouldRunResumeCatchup,
  shouldReconcileScheduledSync,
  type ResumeCatchupRetryState
} from './scheduledSyncPolicy'
import {
  AUTOMATIC_MEMORY_BACKUP_POLICY_VERSION,
  shouldCreateAutomaticMemoryBackup
} from './automaticMemoryBackupPolicy'

const ATTACHMENT_STRUCTURE_PARSER_VERSION = 'attachment-layout-v3'

type AssistantTask = {
  id: string
  title: string
  detail: string
  owner: string
  due: string
  priority: 'high' | 'medium' | 'low'
  source: string
  sourceSessionId?: string
  collaborators?: string[]
  project?: string
  dependsOnIds?: string[]
  taskKind?: 'action' | 'delegated' | 'waiting'
  confidence: number
  status: 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled'
  createdAt?: string
  updatedAt?: string
  classification?: 'mine' | 'uncertain'
  assignmentEvidence?: string
  ownershipPolicyReason?: string
  sourceMessageIds?: string[]
  evidence?: Array<{
    sourceId?: string
    sessionId?: string
    messageId: string
    timestamp: number
    sender: string
    excerpt: string
  }>
}

type GraphEntity = {
  id: string
  type: 'person' | 'organization' | 'group' | 'project'
  canonicalName: string
  aliases: string[]
  accountIds: string[]
  externalIdentities: ExternalIdentity[]
  summary: string
  summaryStatus: 'confirmed' | 'legacy_unverified' | 'empty'
  trustStatus: EntityTrustStatus
  confidence: number
  evidenceMessageIds: string[]
  createdAt: string
  updatedAt: string
  identityVersion: number
  lastDisambiguatedAt: string | null
}

type GraphRelation = {
  id: string
  subjectId: string
  predicate: string
  objectId: string
  confidence: number
  directionExplanation?: string
  evidence: Array<{ messageId: string; sessionId: string; timestamp: number; excerpt: string }>
  evidenceTotal?: number
  status: 'candidate' | 'confirmed' | 'rejected'
  createdAt: string
  updatedAt: string
}

type AssistantState = {
  version: 3
  briefings: Record<string, any>
  tasks: AssistantTask[]
  lastSyncAt: string | null
  notifications: NotificationOutbox
  reminderPreferences: ReminderPreferences
  cursor: {
    lastMessageTimestamp: number
    recentMessageIds: string[]
    sessionCursors: Record<string, number>
    sessionOffsets: Record<string, number>
    lastSuccessfulRunAt: string | null
    lastScheduledRunDate: string | null
    lastScheduledAttemptAt: string | null
    lastScheduledCompletedAt: string | null
    lastScheduledError: string | null
    scheduledRetryCount: number
    nextScheduledRetryAt: string | null
    pendingScheduledRunDate: string | null
    lastSystemSuspendAt: string | null
    lastSystemResumeAt: string | null
    systemResumeCount: number
    lastSchedulerWakeAt: string | null
    lastSchedulerWakeReason: string | null
    lastSchedulerGapMs: number
    lastResumeCatchupAt: string | null
    lastResumeCatchupResult: string | null
    resumeCatchupRetry: ResumeCatchupRetryState
    lastAutomaticBackupDate: string | null
    lastAutomaticBackupAt: string | null
    lastAutomaticBackupAttemptAt: string | null
    lastAutomaticBackupError: string | null
    lastReminderNotificationDate?: string | null
    lastAttemptAt: string | null
    lastError: string | null
    pendingSessionRetryCount: number
    pendingSessionBacklogCount: number
    backlogRetry: BacklogRetryState
  }
  graph: {
    entities: GraphEntity[]
    relations: GraphRelation[]
    lastSqlCommitId?: string | null
    reviewQueue: Array<{ id: string; kind: 'possible_duplicate' | 'relation' | 'entity_summary' | 'entity_alias' | 'entity_creation'; title: string; detail: string; confidence: number; status: 'pending' | 'confirmed' | 'rejected'; createdAt: string; resolvedAt?: string; resolutionActor?: 'user' | 'system'; resolutionReason?: string; leftEntityId?: string; rightEntityId?: string; mergeSourceEntityId?: string; mergeTargetEntityId?: string; relationId?: string; originalRelationId?: string; correctedRelationId?: string; relationCorrection?: RelationCorrection; entityId?: string; entityIdentityVersion?: number; entityCanonicalName?: string; originalEntityCanonicalName?: string; correctedCanonicalName?: string; entityType?: string; legacyReview?: boolean; previousSummary?: string; summaryText?: string; originalSummaryText?: string; correctedSummaryText?: string; aliasText?: string; originalAliasText?: string; correctedAliasText?: string; evidence?: Array<{ messageId: string; sessionId: string; timestamp: number; sender: string; excerpt: string }>; candidateSource?: string; candidateSignals?: Array<{ source: string; label: string; value: string }> }>
    identityScan: { lastFullScanAt: string | null; lastRunAt: string | null; lastMode: 'incremental' | 'full' | null; lastCandidateCount: number }
  }
}

const EMPTY_STATE: AssistantState = {
  version: 3,
  briefings: {},
  tasks: [],
  lastSyncAt: null,
  notifications: {
    pending: [],
    sentKeys: [],
    discardedPendingCount: 0,
    prunedSentKeyCount: 0
  },
  reminderPreferences: { mutedKinds: [], snoozedUntil: {}, history: [] },
  cursor: {
    lastMessageTimestamp: 0,
    recentMessageIds: [],
    sessionCursors: {},
    sessionOffsets: {},
    lastSuccessfulRunAt: null,
    lastScheduledRunDate: null,
    lastScheduledAttemptAt: null,
    lastScheduledCompletedAt: null,
    lastScheduledError: null,
    scheduledRetryCount: 0,
    nextScheduledRetryAt: null,
    pendingScheduledRunDate: null,
    lastSystemSuspendAt: null,
    lastSystemResumeAt: null,
    systemResumeCount: 0,
    lastSchedulerWakeAt: null,
    lastSchedulerWakeReason: null,
    lastSchedulerGapMs: 0,
    lastResumeCatchupAt: null,
    lastResumeCatchupResult: null,
    resumeCatchupRetry: { ...EMPTY_RESUME_CATCHUP_RETRY_STATE },
    lastAutomaticBackupDate: null,
    lastAutomaticBackupAt: null,
    lastAutomaticBackupAttemptAt: null,
    lastAutomaticBackupError: null,
    lastReminderNotificationDate: null,
    lastAttemptAt: null,
    lastError: null,
    pendingSessionRetryCount: 0,
    pendingSessionBacklogCount: 0,
    backlogRetry: { ...EMPTY_BACKLOG_RETRY_STATE }
  },
  graph: { entities: [], relations: [], lastSqlCommitId: null, reviewQueue: [], identityScan: { lastFullScanAt: null, lastRunAt: null, lastMode: null, lastCandidateCount: 0 } }
}

const EXTRACTION_PROMPT_VERSION = 'personal-os-prompt-v8'
const EXTRACTION_SCHEMA_VERSION = 'personal-memory-schema-v6'
const DOCUMENT_ANALYSIS_VERSION = `${EXTRACTION_PROMPT_VERSION}/${EXTRACTION_SCHEMA_VERSION}/document-v1`

const SYSTEM_PROMPT = `你是一个谨慎的中文私人助理兼个人记忆图谱分析器。输入包含按会话组织的连续微信消息和用户身份档案。
输入也可能包含 sourceId=documents 的本机文档证据。文档中的“我”不得自动视为用户本人；除非文档明确写出用户姓名或身份，否则文档事实的 sourceNature 只能是 other_statement 或 inference。文档中的动作、计划和模板条目只有明确写出用户姓名/别名为负责人时才能标为 mine，否则进入 uncertain 或 others。不得把示例、目录、模板字段、历史完成项冒充当前任务。
待办归属规则：只有明确@用户、称呼用户、上下文明确指派用户，或用户自己明确承诺承担的事项才进入 mine；可能相关但证据不足进入 uncertain；明确分配给他人则标为 others；群公告、@所有人和泛泛讨论不得成为任务。
“我发送”只表示消息方向，绝不表示任务负责人是用户。用户发出的“查一下、看一下、确认一下、问一下、发一下、快、请、麻烦、帮我”等祈使句或请求，默认是要求收件人/群友执行，必须标为 others；只有同时出现“我来、我会、我负责、我去、我处理、我跟进、我要”等明确自我承诺，才可能标为 mine。
群聊必须结合 sender、direction、被提及名字和前后文判断，不能因为群内出现祈使句就默认属于用户。每个任务必须给出 assignmentEvidence。
引用消息规则：semanticType=quote 时，content 中“[引用上下文｜发送者：原文]”属于被引用的原作者，不是当前回复者的新陈述；它只能用于理解指代、回复对象和上下文，不得把引用原文的承诺或任务重新归到当前回复者名下。链接、文件、聊天记录、小程序、图片、语音、视频和表情的 semanticType 必须保留其媒介性质。
图片视觉规则：content 中“[图片视觉·Apple Vision 本地候选｜未经人工确认]”只是设备端分类线索，不是图片事实描述，也不能单独支持任务、人物、关系、claim 或 event；只能辅助理解和检索，必须结合原消息文字、OCR 或其他直接证据。
身份映射规则：每个会话的 participants 提供 wxid、通讯录备注 contactRemark、微信昵称 wechatNickname、群昵称 groupNickname、微信号 alias 和 displayName。wxid 是稳定身份主键，其余名称都是该身份在不同场景下的别名；同一个 wxid 的多个名称必须视为同一人，不同 wxid 即使同名也不得自动合并。理解消息中的称呼时优先结合群昵称和通讯录备注。
可信长期上下文规则：输入可能包含“与本批相关的已确认长期记忆”，它只用于识别已知实体、别名、项目和理解代词/简称。它不是本批新结论的消息证据，绝不能单独支持 task、entity、relation、claim、event、摘要或重点，也不能被复制为新增事实。所有输出仍必须引用本批 analysisScope=core 的真实 evidenceKey。长期上下文中不同 entityId 即使同名也必须保持为不同实体；没有当前 core 原文支持时不要输出。
分片规则：消息的 analysisScope 为 core 时才允许产生待办、实体、关系或合并候选；context 消息仅用于理解 core 的前后文，绝对不能单独据此重复产出结果。
知识图谱规则：提取人物、组织、群和项目，以及有明确消息证据的关系。不要因名字相同就合并人物；一个人可以有多个账号和别名。身份不确定时创建候选，不做硬合并。每个实体、关系和合并建议都必须带 evidenceKeys。
事实记忆规则：必须检查 core 消息中是否包含可长期复用的事实，例如身份、职业、组织、技能、偏好、所在地、项目属性、联系方式和状态变化；有则写入 claims。本人明确陈述标记 self_statement，他人陈述标记 other_statement，仅从上下文推断标记 inference。事实必须带直接 evidenceKeys；短暂寒暄和纯情绪不作为事实。明确否定或更正（例如“我不是某公司员工”“我已经不住上海”）也必须抽取，predicate 保持肯定式标准属性名，polarity 标为 negative；不要把“不任职于”另造为一个无法比较的新 predicate。
事件记忆规则：必须检查 core 消息中是否发生或计划会议、承诺、交付、旅行、付款、组织变化、决定等有时间意义的事件；有则写入 events。事件必须带 evidenceKeys，参与实体必须引用本次 entities 的 tempId。没有合格内容时数组为空，claims 和 events 两个字段仍必须返回。
输出预算：每批最多 ${EXTRACTION_OUTPUT_LIMITS.entities} 个实体、${EXTRACTION_OUTPUT_LIMITS.relations} 条关系、${EXTRACTION_OUTPUT_LIMITS.claims} 条高价值 claims、${EXTRACTION_OUTPUT_LIMITS.events} 个 events 和 ${EXTRACTION_OUTPUT_LIMITS.tasks} 个 tasks；优先保留与用户本人、重要人物、项目和行动有关且证据最强的内容，禁止为了凑数量记录琐碎事实。系统会在任一数组达到上限时自动把 core 证据细分重跑，因此不要用低价值条目占满数组。
“用户”“我”“本人”“对方”“群友”“某人”“未知”等只是角色占位词，绝对不能作为实体名称。用户本人必须使用身份档案里的真实姓名；身份档案没有姓名时，不创建用户本人的人物实体。
只根据消息证据，不臆测；title 用动词开头；不确定日期时 due 为空；source 使用会话显示名。
统一证据键规则：所有 evidenceKeys、sourceEvidenceKeys、summaryEvidenceKeys 都必须逐字复制输入消息的 evidenceKey，且只能引用 analysisScope=core 的消息。context 消息可以帮助理解，但绝不能成为任何输出的证据。无法引用真实 core 证据时不要输出该条结构。summary 必须列出 summaryEvidenceKeys；highlights 中每一项必须是 {"text":"重点","sourceEvidenceKeys":["证据键"]}。
只返回 JSON：
{"headline":"标题","summary":"摘要","summaryEvidenceKeys":["sourceId:sessionId:messageId"],"highlights":[{"text":"重要信息","sourceEvidenceKeys":["sourceId:sessionId:messageId"]}],"tasks":[{"title":"待办","detail":"上下文","owner":"负责人真实名称","collaborators":["协作者"],"project":"所属项目","dependsOnTitles":["依赖待办标题"],"taskKind":"action|delegated|waiting","due":"","priority":"high|medium|low","source":"会话名","confidence":0.8,"classification":"mine|uncertain|others","assignmentEvidence":"归属证据","sourceEvidenceKeys":["sourceId:sessionId:messageId"]}],"entities":[{"tempId":"e1","type":"person|organization|group|project","canonicalName":"名称","aliases":[],"accountIds":[],"summary":"仅基于引用原文的简述；它只是待用户确认的摘要候选","confidence":0.8,"evidenceKeys":["sourceId:sessionId:messageId"]}],"relations":[{"subjectTempId":"e1","predicate":"从主语到宾语可直接朗读的有向关系","objectTempId":"e2","directionExplanation":"完整自然语言，例如A向B提供服务","confidence":0.8,"evidenceKeys":["sourceId:sessionId:messageId"]}],"claims":[{"subjectTempId":"e1","predicate":"肯定式标准事实属性","objectTempId":"","objectValue":"事实值","polarity":"positive|negative","valueType":"text|number|date|boolean","validFrom":"","validTo":"","confidence":0.8,"sourceNature":"self_statement|other_statement|inference","evidenceKeys":["sourceId:sessionId:messageId"]}],"events":[{"eventType":"meeting|commitment|delivery|travel|payment|organization_change|decision|other","title":"事件","description":"描述","startAt":"","endAt":"","location":"","participants":[{"tempId":"e1","role":"参与者角色"}],"confidence":0.8,"evidenceKeys":["sourceId:sessionId:messageId"]}],"possibleDuplicates":[{"leftTempId":"e1","rightExistingName":"已有实体名","confidence":0.7,"reason":"原因","evidenceKeys":["sourceId:sessionId:messageId"]}]}`

function shanghaiDate(timestampMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestampMs))
}

function pendingScheduledDate(cursor: {
  lastScheduledAttemptAt?: string | null
  pendingScheduledRunDate?: string | null
}): string {
  const persisted = String(cursor?.pendingScheduledRunDate || '').trim()
  return persisted || shanghaiDate(scheduledSyncTargetTimestamp(cursor?.lastScheduledAttemptAt, Date.now()))
}

function messageKey(message: any): string {
  return `${message.sourceId || 'wechat'}:${message.sessionId}:${message.id}`
}

function stableTaskId(task: any): string {
  const evidence = (Array.isArray(task.sourceEvidenceKeys)
    ? task.sourceEvidenceKeys
    : Array.isArray(task.sourceMessageIds) ? task.sourceMessageIds : []).map(String).sort().join(',')
  const value = [task.title, task.source, evidence].map(item => String(item || '').trim().toLowerCase()).join('|')
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)
}

function parseModelJson(text: string): any {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw
  try {
    return JSON.parse(fenced)
  } catch {
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    const candidate = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced
    try {
      return JSON.parse(jsonrepair(candidate))
    } catch {
      throw new Error('模型没有返回有效 JSON')
    }
  }
}

function redact(text: string): string {
  return redactLocalSecrets(text)
}

function isOfficialAccountSession(session: any): boolean {
  const username = String(session?.username || session?.sessionId || '').trim().toLowerCase()
  const type = String(session?.type || '').trim().toLowerCase()
  const sessionType = String(session?.sessionType || '').trim().toLowerCase()
  return username.startsWith('gh_') || type === 'official' || sessionType === 'channel'
}

export class AiAssistantService {
  private pendingEntityEvidence: Array<{
    entityId: string
    sourceId: string
    messageId: string
    sessionId: string
    timestamp: number
    sender: string
    excerpt: string
    evidenceKind: string
  }> = []
  private config = ConfigService.getInstance()
  private state: AssistantState = structuredClone(EMPTY_STATE)
  private statePath = ''
  private stateEncryptionKey = ''
  private activeSync: Promise<any> | null = null
  private activeSyncTrigger: 'manual' | 'startup' | 'daily' | 'backlog' | 'resume' | null = null
  private scheduler: ReturnType<typeof setInterval> | null = null
  private notificationFlushPromise: Promise<void> | null = null
  private preparedRecoveryContinuation: ReturnType<typeof setTimeout> | null = null
  private connectorAuthorizationCache = new AsyncExpiringValue<{
    calendar: string
    mail: string
  }>(5 * 60_000)
  private lastSchedulerAttemptAt = 0
  private lastSchedulerTickAt = 0
  private vectorIndexPromise: Promise<any> | null = null
  private cancelRequested = false
  private taskReviewReconciliation = {
    checked: 0,
    removed: 0,
    confirmed: 0,
    restored: 0,
    lastRunAt: ''
  }
  private taskMutationRecovery = {
    attempted: 0,
    applied: 0,
    abandoned: 0,
    conflicts: 0,
    lastRecoveredAt: ''
  }
  private conversationSourceMutationRecovery = {
    attempted: 0,
    applied: 0,
    abandoned: 0,
    conflicts: 0,
    lastRecoveredAt: ''
  }
  private briefingStorage = {
    version: BRIEFING_STORAGE_VERSION,
    retentionDays: BRIEFING_RETENTION_DAYS,
    retainedDays: 0,
    removedDays: 0,
    strippedTaskSnapshots: 0,
    strippedTaskCount: 0,
    lastCompactedAt: ''
  }
  private graphReviewStorage = {
    version: GRAPH_REVIEW_STORAGE_VERSION,
    recoveryVersion: GRAPH_COMMIT_RECOVERY_VERSION,
    statePolicy: 'pending_only',
    pending: 0,
    archivedThisRun: 0,
    archivedEvidenceThisRun: 0,
    lastArchivedAt: '',
    recoveredFromSqlThisStart: false,
    recoveredAt: '',
    recoveredEntities: 0,
    recoveredRelations: 0,
    recoveredPendingReviews: 0
  }
  private stateStorage: DurableJsonRecovery & {
    lastWriteAt: string
    encrypted: boolean
    migratedPlaintext: boolean
    keyStorage: string
  } = {
    source: 'empty',
    recovered: false,
    repairedPrimary: false,
    primaryError: '',
    backupError: '',
    lastWriteAt: '',
    encrypted: false,
    migratedPlaintext: false,
    keyStorage: ''
  }

  async initialize(): Promise<void> {
    this.statePath = join(app.getPath('userData'), 'ai-assistant-state.json')
    localEmbeddingService.initialize(app.getPath('userData'))
    if (!this.config.isSafeStorageEncryptionAvailable()) {
      throw new Error('macOS 安全存储当前不可用，不能安全初始化个人记忆数据库密钥')
    }
    const databasePath = join(app.getPath('userData'), 'personal-memory.sqlite')
    const keyStored = this.config.isStoredWithSafeStorage('aiAssistantDatabaseKey')
    let databaseKey = String(this.config.get('aiAssistantDatabaseKey') || '')
    if (keyStored && !/^[a-f0-9]{64}$/i.test(databaseKey)) {
      throw new Error('无法从 macOS 安全存储读取个人记忆数据库密钥；为避免覆盖密钥，数据库未打开')
    }
    if (!keyStored && existsSync(databasePath) && statSync(databasePath).size >= 16 &&
        !readFileSync(databasePath).subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) {
      throw new Error('检测到已加密的个人记忆库，但 macOS 安全存储中缺少对应密钥；数据库未被修改')
    }
    if (!/^[a-f0-9]{64}$/i.test(databaseKey)) databaseKey = crypto.randomBytes(32).toString('hex')
    if (!keyStored) {
      this.config.set('aiAssistantDatabaseKey', databaseKey)
    }
    if (!this.config.isStoredWithSafeStorage('aiAssistantDatabaseKey')) {
      throw new Error('个人记忆数据库密钥未能写入 macOS 安全存储')
    }
    const stateKeyStored = this.config.isStoredWithSafeStorage('aiAssistantStateKey')
    let stateKey = String(this.config.get('aiAssistantStateKey') || '')
    if (stateKeyStored && !/^[a-f0-9]{64}$/i.test(stateKey)) {
      throw new Error('无法从 macOS 安全存储读取 AI 状态密钥；为避免覆盖状态，初始化已停止')
    }
    if (!stateKeyStored) {
      const encryptedStateExists = [this.statePath, `${this.statePath}.bak`]
        .some(path => existsSync(path) && isEncryptedDurableJson(readFileSync(path)))
      if (encryptedStateExists) {
        throw new Error('检测到已加密的 AI 状态，但 macOS 安全存储中缺少对应密钥；状态文件未被修改')
      }
      stateKey = crypto.randomBytes(32).toString('hex')
      this.config.set('aiAssistantStateKey', stateKey)
    }
    if (!this.config.isStoredWithSafeStorage('aiAssistantStateKey') || !/^[a-f0-9]{64}$/i.test(stateKey)) {
      throw new Error('AI 状态密钥未能写入 macOS 安全存储')
    }
    this.stateEncryptionKey = stateKey
    localOcrService.initialize(join(app.getPath('userData'), 'ai-ocr-cache.json'), stateKey)
    localImageSemanticService.initialize(join(app.getPath('userData'), 'ai-image-semantic-cache.json'), stateKey)
    chatService.initializeTranscriptCacheEncryption(stateKey)
    personalMemoryStore.initialize(databasePath, databaseKey)
    personalMemoryStore.registerDataSources(PERSONAL_DATA_SOURCE_CATALOG)
    personalMemoryStore.setDataSourceAvailability(
      'calendar',
      localCalendarService.isAvailable(),
      localCalendarService.isAvailable() ? '' : '当前构建未包含 macOS 日历 helper'
    )
    personalMemoryStore.setDataSourceAvailability(
      'mail',
      localMailService.isAvailable(),
      localMailService.isAvailable() ? '' : '当前构建未包含 macOS Mail helper'
    )
    const documentSource = personalMemoryStore.listDataSources().find(source => source.id === 'documents')
    const documentFolder = String(documentSource?.config?.folderPath || '')
    if (documentFolder) {
      try {
        const connector = new LocalDocumentDataSource(documentFolder)
        personalMemoryStore.setDataSourceAvailability('documents', true)
        if (connector.root !== documentFolder) {
          personalMemoryStore.configureDataSource('documents', { folderPath: connector.root }, true)
        }
      } catch (error) {
        personalMemoryStore.setDataSourceAvailability(
          'documents',
          false,
          `已配置的文档目录当前不可访问：${sanitizeDiagnosticText(error)}`
        )
      }
    }
    personalMemoryStore.purgeExpiredResourceTrash(
      Number(this.config.get('aiAssistantResourceTrashRetentionDays') || 0)
    )
    this.migrateLegacyData()
    this.loadState()
    const sourceMutationRecovery = this.recoverPreparedConversationSourceMutationCommits()
    const taskMutationRecovery = this.recoverPreparedTaskMutationCommits()
    personalMemoryStore.recordProcessedIngestionMessageKeys(
      this.state.cursor.recentMessageIds,
      'legacy-state-hot-cache-migration'
    )
    const initialRecovery = this.recoverPreparedIngestionBatchCommits()
    if (
      initialRecovery.unattempted > 0 ||
      sourceMutationRecovery.unattempted > 0 ||
      taskMutationRecovery.unattempted > 0
    ) this.schedulePreparedRecoveryContinuation()
    personalMemoryStore.reconcileInterruptedIngestionRuns({
      entityCount: this.state.graph.entities.length,
      relationCount: this.state.graph.relations.length
    })
    this.reconcileTaskReviewFeedbackOnStartup()
    this.removeSuppressedRelationsFromState()
    this.saveState()
    this.lastSchedulerTickAt = Date.now()
    this.scheduler = setInterval(() => void this.schedulerTick(), 60_000)
    this.scheduler.unref()
    if (this.config.get('aiAssistantEnabled')) {
      setTimeout(() => void this.sync('startup').catch(() => undefined), 5_000)
    }
    setTimeout(() => void this.flushNotificationOutbox(new Date()), 8_000)
    setTimeout(() => void this.ensureVectorIndex().catch(error =>
      console.warn('[AI Assistant] 本地向量索引暂未完成:', error)), 12_000)
  }

  dispose(): void {
    if (this.scheduler) clearInterval(this.scheduler)
    this.scheduler = null
    if (this.preparedRecoveryContinuation) clearTimeout(this.preparedRecoveryContinuation)
    this.preparedRecoveryContinuation = null
    personalMemoryStore.close()
  }

  handleSystemSuspend(observedAt = new Date()): void {
    this.state.cursor.lastSystemSuspendAt = observedAt.toISOString()
    this.saveState()
  }

  async handleSystemResume(observedAt = new Date()): Promise<string> {
    this.state.cursor.lastSystemResumeAt = observedAt.toISOString()
    this.state.cursor.systemResumeCount =
      Math.max(0, Number(this.state.cursor.systemResumeCount || 0)) + 1
    this.saveState()
    const result = await this.schedulerTick('system_resume', observedAt)
    this.state.cursor.lastResumeCatchupAt = new Date().toISOString()
    this.state.cursor.lastResumeCatchupResult = result
    this.saveState()
    return result
  }

  private migrateLegacyData(): void {
    const legacyRoot = join(app.getAppPath(), 'daily-ai-assistant')
    const legacyState = join(legacyRoot, 'data', 'state.json')
    if (!existsSync(this.statePath) && existsSync(legacyState)) {
      writeEncryptedDurableJson(
        this.statePath,
        JSON.parse(readFileSync(legacyState, 'utf8')),
        this.stateEncryptionKey
      )
    }
    if (!this.config.get('aiAssistantApiKey')) {
      const envPath = join(legacyRoot, '.env')
      if (existsSync(envPath)) {
        const match = readFileSync(envPath, 'utf8').match(/^AI_API_KEY=(.+)$/m)
        if (match?.[1]?.trim()) {
          this.config.set('aiAssistantApiKey', match[1].trim())
          try { unlinkSync(envPath) } catch {}
        }
      }
    }
  }

  private loadState(): void {
    try {
      const durable = readEncryptedDurableJson<any>(
        this.statePath,
        structuredClone(EMPTY_STATE),
        this.stateEncryptionKey
      )
      const loaded = durable.value
      const migratedPlaintext = durable.recovery.source !== 'empty' && !durable.encrypted
      if (migratedPlaintext) {
        writeEncryptedDurableJson(
          this.statePath,
          buildEncryptedAssistantState(loaded),
          this.stateEncryptionKey
        )
      }
      this.stateStorage = {
        ...durable.recovery,
        primaryError: durable.recovery.primaryError ? sanitizeDiagnosticText(durable.recovery.primaryError) : '',
        backupError: durable.recovery.backupError ? sanitizeDiagnosticText(durable.recovery.backupError) : '',
        lastWriteAt: this.stateStorage.lastWriteAt,
        encrypted: durable.recovery.source !== 'empty',
        migratedPlaintext,
        keyStorage: 'macOS Safe Storage'
      }
      if (durable.recovery.source === 'empty' &&
          (durable.recovery.primaryError !== 'missing' || durable.recovery.backupError !== 'missing')) {
        throw new Error('主状态文件和最近良好副本均无法解析；为避免覆盖可恢复数据，已停止初始化')
      }
      this.state = {
        ...structuredClone(EMPTY_STATE),
        ...loaded,
        version: 3,
        cursor: {
          ...structuredClone(EMPTY_STATE.cursor),
          ...(loaded.cursor || {}),
          resumeCatchupRetry: {
            ...EMPTY_RESUME_CATCHUP_RETRY_STATE,
            ...(loaded.cursor?.resumeCatchupRetry || {})
          },
          backlogRetry: {
            ...EMPTY_BACKLOG_RETRY_STATE,
            ...(loaded.cursor?.backlogRetry || {})
          }
        },
        notifications: {
          pending: Array.isArray(loaded.notifications?.pending) ? loaded.notifications.pending : [],
          sentKeys: Array.isArray(loaded.notifications?.sentKeys) ? loaded.notifications.sentKeys : [],
          discardedPendingCount: Math.max(0, Number(loaded.notifications?.discardedPendingCount) || 0),
          lastDiscardedPendingAt: String(loaded.notifications?.lastDiscardedPendingAt || '') || undefined,
          prunedSentKeyCount: Math.max(0, Number(loaded.notifications?.prunedSentKeyCount) || 0)
        },
        reminderPreferences: normalizeReminderPreferences(loaded.reminderPreferences),
        tasks: Array.isArray(loaded.tasks)
          ? loaded.tasks.map((task: AssistantTask) => task.classification ? task : { ...task, classification: 'uncertain' })
          : [],
        graph: {
          entities: Array.isArray(loaded.graph?.entities) ? loaded.graph.entities.map((entity: any) => ({
            ...entity,
            externalIdentities: Array.isArray(entity.externalIdentities) ? entity.externalIdentities : [],
            summaryStatus: entity.summaryStatus || (entity.summary ? 'legacy_unverified' : 'empty'),
            trustStatus: inferLegacyEntityTrustStatus(entity),
            evidenceMessageIds: compactEntityEvidenceMessageIds(
              Array.isArray(entity.evidenceMessageIds) ? entity.evidenceMessageIds : []
            ),
            identityVersion: Number(entity.identityVersion || 1),
            lastDisambiguatedAt: entity.lastDisambiguatedAt || null
          })) : [],
          relations: Array.isArray(loaded.graph?.relations) ? loaded.graph.relations : [],
          lastSqlCommitId: loaded.graph?.lastSqlCommitId || null,
          reviewQueue: Array.isArray(loaded.graph?.reviewQueue) ? loaded.graph.reviewQueue : [],
          identityScan: {
            ...structuredClone(EMPTY_STATE.graph.identityScan),
            ...(loaded.graph?.identityScan || {})
          }
        }
      }
      const sqlCommitId = personalMemoryStore.getGraphCommitId()
      if (shouldRecoverGraphFromSql(sqlCommitId, this.state.graph.lastSqlCommitId)) {
        const snapshot = personalMemoryStore.loadGraphSnapshot()
        this.state.graph = recoverGraphStateFromSql(this.state.graph, snapshot, sqlCommitId)
        this.graphReviewStorage.recoveredFromSqlThisStart = true
        this.graphReviewStorage.recoveredAt = new Date().toISOString()
        this.graphReviewStorage.recoveredEntities = snapshot.entities.length
        this.graphReviewStorage.recoveredRelations = snapshot.relations.length
        this.graphReviewStorage.recoveredPendingReviews = snapshot.reviewQueue.length
      }
      this.compactBriefingState()
      compactGraphRelationEvidence(
        this.state.graph.relations,
        personalMemoryStore.getRelationEvidenceCounts()
      )
      this.quarantinePlaceholderEntities()
      this.repairInvalidRelations()
      const confirmedEntityIds = new Set(this.state.graph.reviewQueue.flatMap(review =>
        review.status === 'confirmed' && review.kind === 'entity_creation' && review.entityId
          ? [review.entityId]
          : []))
      for (const targetEntityId of personalMemoryStore.listActiveMergeTargetIds()) {
        confirmedEntityIds.add(targetEntityId)
      }
      for (const entity of this.state.graph.entities) {
        if (confirmedEntityIds.has(entity.id) && !isPlaceholderPersonEntity(entity)) {
          entity.trustStatus = 'confirmed'
        }
      }
      this.enforceEntityTrustOnDerivedMemory()
      this.ensureLegacyEntityReviews()
    } catch (error) {
      this.state = structuredClone(EMPTY_STATE)
      throw new Error(`AI 助理状态加载失败：${sanitizeDiagnosticText(error)}`)
    }
  }

  private reconcileTaskReviewFeedbackOnStartup(): void {
    const result = reconcileTasksWithReviewDecisions(
      this.state.tasks,
      personalMemoryStore.listActiveTaskReviewDecisions()
    )
    this.state.tasks = result.tasks
    for (const effect of result.effects) {
      personalMemoryStore.recordTaskReviewReconciliation(effect.evidenceFingerprint)
    }
    this.taskReviewReconciliation = {
      checked: result.checked,
      removed: result.effects.filter(effect => effect.action === 'removed').length,
      confirmed: result.effects.filter(effect => effect.action === 'confirmed').length,
      restored: result.effects.filter(effect => effect.action === 'restored').length,
      lastRunAt: new Date().toISOString()
    }
  }

  private removeSuppressedRelationsFromState(): void {
    const suppressedRelationIds = new Set(this.state.graph.relations
      .filter(relation => personalMemoryStore.isMemoryItemSuppressed('relation', relation.id))
      .map(relation => relation.id))
    if (!suppressedRelationIds.size) return
    this.state.graph.relations = this.state.graph.relations.filter(relation => !suppressedRelationIds.has(relation.id))
    this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review =>
      !review.relationId || !suppressedRelationIds.has(review.relationId))
  }

  private enforceEntityTrustOnDerivedMemory(): void {
    const trustedIds = new Set(this.state.graph.entities.filter(isTrustedEntity).map(entity => entity.id))
    for (const relation of this.state.graph.relations) {
      if (relation.status === 'confirmed' &&
          (!trustedIds.has(relation.subjectId) || !trustedIds.has(relation.objectId))) {
        relation.status = 'candidate'
      }
    }
    const feed = personalMemoryStore.getMemoryFeed()
    for (const claim of feed.claims || []) {
      if (claim.status === 'confirmed' &&
          (!trustedIds.has(claim.subject_id) ||
           (claim.object_entity_id && !trustedIds.has(claim.object_entity_id)))) {
        personalMemoryStore.updateMemoryItemStatus('claim', claim.id, 'candidate', {
          actor: 'system',
          reason: '事实涉及尚未确认的实体，自动降级为待确认',
          protectFromExtraction: false
        })
      }
    }
    for (const event of feed.events || []) {
      const participantIds = (event.participants || []).map((item: any) => item.entity_id).filter(Boolean)
      if (event.status === 'confirmed' && participantIds.some((id: string) => !trustedIds.has(id))) {
        personalMemoryStore.updateMemoryItemStatus('event', event.id, 'candidate', {
          actor: 'system',
          reason: '事件参与者包含尚未确认的实体，自动降级为待确认',
          protectFromExtraction: false
        })
      }
    }
  }

  private ensureLegacyEntityReviews(): void {
    const feed = personalMemoryStore.getMemoryFeed()
    for (const entity of this.state.graph.entities) {
      if (entity.trustStatus !== 'legacy_unverified') continue
      if (this.state.graph.reviewQueue.some(review =>
        review.kind === 'entity_creation' && review.entityId === entity.id &&
        review.status === 'pending')) continue
      const evidence = [
        ...this.state.graph.relations
          .filter(relation => relation.subjectId === entity.id || relation.objectId === entity.id)
          .flatMap(relation => relation.evidence || []),
        ...(feed.claims || [])
          .filter((claim: any) => claim.subject_id === entity.id || claim.object_entity_id === entity.id)
          .flatMap((claim: any) => claim.evidence || []),
        ...(feed.events || [])
          .filter((event: any) => (event.participants || []).some((participant: any) =>
            participant.entity_id === entity.id))
          .flatMap((event: any) => event.evidence || [])
      ]
      const review = buildLegacyEntityReview({
        entity,
        evidence,
        createdAt: entity.createdAt || new Date().toISOString()
      })
      if (review) {
        if (this.state.graph.reviewQueue.some(existing => existing.id === review.id)) {
          review.id = `${review.id}_v${Math.max(1, Number(entity.identityVersion || 1))}`
        }
        this.state.graph.reviewQueue.push(review)
      }
    }
  }

  private quarantinePlaceholderEntities(): void {
    const result = quarantinePlaceholderPersonEntities(
      this.state.graph.entities,
      new Date().toISOString()
    )
    this.state.graph.entities = result.entities
  }

  private repairInvalidRelations(): void {
    const entityTypes = new Map(this.state.graph.entities.map(entity => [entity.id, entity.type]))
    const personOnlyPredicates = /伴侣|配偶|夫妻|父亲|母亲|兄弟|姐妹|朋友|同学/
    const removed = new Set(this.state.graph.relations.filter(relation =>
      personOnlyPredicates.test(relation.predicate) &&
      (entityTypes.get(relation.subjectId) !== 'person' || entityTypes.get(relation.objectId) !== 'person')
    ).map(relation => relation.id))
    if (!removed.size) return
    this.state.graph.relations = this.state.graph.relations.filter(relation => !removed.has(relation.id))
    this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review => !review.relationId || !removed.has(review.relationId))
  }

  private saveState(strictMemorySync = false): void {
    this.compactBriefingState()
    let graphSynced = false
    const graphCommitId = crypto.randomUUID()
    try {
      personalMemoryStore.syncGraph(this.state.graph, graphCommitId, {
        entityEvidence: this.pendingEntityEvidence
      })
      this.pendingEntityEvidence = []
      this.state.graph.lastSqlCommitId = graphCommitId
      graphSynced = true
    } catch (error) {
      console.error('[AI Assistant] 个人记忆数据库同步失败:', sanitizeDiagnosticText(error))
      if (strictMemorySync) throw error
    }
    if (graphSynced) this.compactGraphReviewState()
    writeEncryptedDurableJson(
      this.statePath,
      buildEncryptedAssistantState(this.state),
      this.stateEncryptionKey
    )
    this.stateStorage.encrypted = true
    this.stateStorage.lastWriteAt = new Date().toISOString()
    try {
      personalMemoryStore.syncTasks(this.state.tasks)
    } catch (error) {
      console.error('[AI Assistant] 个人记忆任务同步失败:', sanitizeDiagnosticText(error))
      if (strictMemorySync) throw error
    }
  }

  private persistCrossStoreMutationState(): void {
    writeEncryptedDurableJson(
      this.statePath,
      buildEncryptedAssistantState(this.state),
      this.stateEncryptionKey
    )
    this.stateStorage.encrypted = true
    this.stateStorage.lastWriteAt = new Date().toISOString()
  }

  private hydrateTaskEvidenceFromSql(taskIds: string[]): void {
    const missing = this.state.tasks.filter(task =>
      taskIds.includes(task.id) && !Array.isArray(task.evidence))
    if (!missing.length) return
    const evidence = personalMemoryStore.listTaskEvidence(missing.map(task => task.id))
    for (const task of missing) task.evidence = evidence.get(task.id) || []
  }

  private recoverPreparedTaskMutationCommits(): { attempted: number; unattempted: number } {
    const startedAt = Date.now()
    const seenCommitIds = new Set<string>()
    let attempted = 0
    do {
      const batch = personalMemoryStore.listPreparedTaskMutationCommits(100)
        .filter(commit => !seenCommitIds.has(commit.commitId))
      if (!batch.length) break
      for (const commit of batch) {
        seenCommitIds.add(commit.commitId)
        attempted += 1
        this.taskMutationRecovery.attempted += 1
        try {
          if (commit.parseError) throw new Error(commit.parseError)
          this.hydrateTaskEvidenceFromSql([
            ...Object.keys(commit.beforeTokens || {}),
            ...Object.keys(commit.afterTokens || {})
          ])
          const action = classifyTaskMutationRecovery(
            this.state.tasks,
            commit.beforeTokens,
            commit.afterTokens
          )
          if (action === 'apply') {
            personalMemoryStore.finalizeTaskMutationCommit(commit.commitId, this.state.tasks)
            this.taskMutationRecovery.applied += 1
          } else if (action === 'abandon') {
            personalMemoryStore.abandonTaskMutationCommit(commit.commitId, 'state_not_committed')
            this.taskMutationRecovery.abandoned += 1
          } else {
            this.taskMutationRecovery.conflicts += 1
            throw new Error('任务状态同时不匹配变更前和变更后身份，已保留现场等待诊断')
          }
          this.taskMutationRecovery.lastRecoveredAt = new Date().toISOString()
        } catch (error) {
          personalMemoryStore.recordTaskMutationRecoveryFailure(commit.commitId, error)
        }
      }
    } while (Date.now() - startedAt < 1_500)
    return { attempted, unattempted: personalMemoryStore.getTaskMutationCommitHealth().unattempted }
  }

  private recoverPreparedConversationSourceMutationCommits(): { attempted: number; unattempted: number } {
    const startedAt = Date.now()
    const seenCommitIds = new Set<string>()
    let attempted = 0
    do {
      const batch = personalMemoryStore.listPreparedConversationSourceMutationCommits(100)
        .filter(commit => !seenCommitIds.has(commit.commitId))
      if (!batch.length) break
      for (const commit of batch) {
        seenCommitIds.add(commit.commitId)
        attempted += 1
        this.conversationSourceMutationRecovery.attempted += 1
        try {
          if (commit.parseError) throw new Error(commit.parseError)
          const action = classifyConversationSourceMutationRecovery(
            this.state.cursor,
            commit.beforeTokens,
            commit.afterTokens
          )
          if (action === 'apply') {
            personalMemoryStore.finalizeConversationSourceMutationCommit(commit.commitId)
            this.conversationSourceMutationRecovery.applied += 1
          } else if (action === 'abandon') {
            personalMemoryStore.abandonConversationSourceMutationCommit(
              commit.commitId,
              'state_not_committed'
            )
            this.conversationSourceMutationRecovery.abandoned += 1
          } else {
            this.conversationSourceMutationRecovery.conflicts += 1
            throw new Error('来源游标同时不匹配变更前和变更后身份，已保留现场等待诊断')
          }
          this.conversationSourceMutationRecovery.lastRecoveredAt = new Date().toISOString()
        } catch (error) {
          personalMemoryStore.recordConversationSourceMutationRecoveryFailure(
            commit.commitId,
            error
          )
        }
      }
    } while (Date.now() - startedAt < 1_500)
    return {
      attempted,
      unattempted: personalMemoryStore.getConversationSourceMutationCommitHealth().unattempted
    }
  }

  private checkpointGraphToSql(): void {
    personalMemoryStore.syncGraph(this.state.graph, crypto.randomUUID(), {
      entityEvidence: this.pendingEntityEvidence
    })
    this.pendingEntityEvidence = []
    compactGraphRelationEvidence(
      this.state.graph.relations,
      personalMemoryStore.getRelationEvidenceCounts()
    )
  }

  private hydrateRelationEvidence(relationIds: string[]): void {
    const evidence = personalMemoryStore.getRelationEvidence(relationIds)
    for (const relation of this.state.graph.relations) {
      const rows = evidence.get(relation.id)
      if (!rows) continue
      relation.evidence = rows
      relation.evidenceTotal = rows.length
    }
  }

  private compactBriefingState(): void {
    const result = compactBriefings(this.state.briefings, BRIEFING_RETENTION_DAYS)
    this.state.briefings = result.briefings
    this.briefingStorage.retainedDays = result.retainedDays
    if (result.changed) {
      this.briefingStorage.removedDays += result.removedDays
      this.briefingStorage.strippedTaskSnapshots += result.strippedTaskSnapshots
      this.briefingStorage.strippedTaskCount += result.strippedTaskCount
      this.briefingStorage.lastCompactedAt = new Date().toISOString()
    }
  }

  private compactGraphReviewState(): void {
    const result = compactGraphReviewWorkset(this.state.graph.reviewQueue)
    this.state.graph.reviewQueue = result.pending
    this.graphReviewStorage.pending = result.pending.length
    if (result.changed) {
      this.graphReviewStorage.archivedThisRun += result.resolved.length
      this.graphReviewStorage.archivedEvidenceThisRun += result.resolved.reduce(
        (total, review) => total + (Array.isArray(review?.evidence) ? review.evidence.length : 0),
        0
      )
      this.graphReviewStorage.lastArchivedAt = new Date().toISOString()
    }
  }

  private ingestionCommitId(runId: string, batchIndex: number, checkpointKeys: string[]): string {
    const fingerprint = checkpointKeys.slice().sort().join('\n')
    return `batch_${crypto.createHash('sha256')
      .update(`${runId}\n${batchIndex}\n${EXTRACTION_PROMPT_VERSION}\n${EXTRACTION_SCHEMA_VERSION}\n${fingerprint}`)
      .digest('hex')
      .slice(0, 32)}`
  }

  private recoverPreparedIngestionBatchCommits(): {
    attempted: number
    recovered: number
    failed: number
    remaining: number
    unattempted: number
  } {
    const startedAt = Date.now()
    const seenCommitIds = new Set<string>()
    let attempted = 0
    let recovered = 0
    let failed = 0
    do {
      const batch = personalMemoryStore.listPreparedIngestionBatchCommits(100)
        .filter(commit => !seenCommitIds.has(commit.commitId))
      if (!batch.length) break
      for (const commit of batch) {
        seenCommitIds.add(commit.commitId)
        attempted += 1
        const stateBeforeRecovery = structuredClone(this.state)
        const pendingEntityEvidenceBeforeRecovery = [...this.pendingEntityEvidence]
        try {
          if (commit.parseError) throw new Error(commit.parseError)
          const tempIds = this.mergeGraphDigest(commit.digest, commit.messages, commit.createdAt, commit.commitId)
          this.persistClaimsAndEvents(commit.digest, tempIds, commit.messages, commit.createdAt)
          if (commit.sourceKind === 'document') {
            this.persistDocumentTasks(commit.digest, commit.messages, commit.createdAt)
          } else {
            this.mergeRecoveredWechatTasks(commit.digest, commit.messages, commit.createdAt)
            this.state.cursor.recentMessageIds = [...new Set([
              ...this.state.cursor.recentMessageIds,
              ...commit.checkpointKeys
            ])].slice(-20_000)
          }
          this.saveState(true)
          personalMemoryStore.finalizeIngestionBatchCommit(commit.commitId, {
            ...commit.digest.__meta,
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION
          })
          if (commit.sourceKind === 'document') {
            personalMemoryStore.finishIngestionRun(commit.runId, {
              status: 'completed',
              messageCount: commit.messages.length,
              entityCount: this.state.graph.entities.length,
              relationCount: this.state.graph.relations.length
            })
          }
          recovered += 1
        } catch (error) {
          this.state = stateBeforeRecovery
          this.pendingEntityEvidence = pendingEntityEvidenceBeforeRecovery
          failed += 1
          personalMemoryStore.recordIngestionBatchCommitRecoveryFailure(
            commit.commitId,
            sanitizeDiagnosticText(error)
          )
        }
      }
    } while (Date.now() - startedAt < 1_500)
    const health = personalMemoryStore.getIngestionCommitHealth()
    return {
      attempted,
      recovered,
      failed,
      remaining: health.prepared,
      unattempted: health.unattempted
    }
  }

  private schedulePreparedRecoveryContinuation(): void {
    if (this.preparedRecoveryContinuation) return
    this.preparedRecoveryContinuation = setTimeout(() => {
      this.preparedRecoveryContinuation = null
      if (this.activeSync) {
        this.schedulePreparedRecoveryContinuation()
        return
      }
      const ingestion = personalMemoryStore.getIngestionCommitHealth().unattempted > 0
        ? this.recoverPreparedIngestionBatchCommits()
        : { unattempted: 0 }
      const taskMutation = personalMemoryStore.getTaskMutationCommitHealth().unattempted > 0
        ? this.recoverPreparedTaskMutationCommits()
        : { unattempted: 0 }
      const sourceMutation =
        personalMemoryStore.getConversationSourceMutationCommitHealth().unattempted > 0
          ? this.recoverPreparedConversationSourceMutationCommits()
          : { unattempted: 0 }
      if (
        ingestion.unattempted > 0 ||
        taskMutation.unattempted > 0 ||
        sourceMutation.unattempted > 0
      ) this.schedulePreparedRecoveryContinuation()
    }, 1_000)
    this.preparedRecoveryContinuation.unref?.()
  }

  private async ensureHttpApi(): Promise<{ port: number; token: string }> {
    let token = String(this.config.get('httpApiToken') || '').trim()
    if (!token) {
      token = crypto.randomBytes(32).toString('hex')
      this.config.set('httpApiToken', token)
    }
    const port = Number(this.config.get('httpApiPort')) || 5031
    if (!httpService.isRunning()) {
      const result = await httpService.start(port, '127.0.0.1')
      if (!result.success) throw new Error(result.error || '无法启动 WeFlow 数据接口')
    }
    return { port, token }
  }

  private async api(path: string, params: Record<string, any> = {}): Promise<any> {
    const { port, token } = await this.ensureHttpApi()
    const url = new URL(`http://127.0.0.1:${port}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    let lastError: any = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000)
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`)
        return payload
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  private async listAllWechatSessions(): Promise<any[]> {
    return collectStableCursorPages(
      async cursor => {
        const payload = await this.api('/api/v1/sessions', {
          limit: 10_000,
          cursor: cursor || undefined
        })
        return {
          items: Array.isArray(payload.sessions) ? payload.sessions : [],
          total: Number(payload.total ?? payload.count ?? 0),
          hasMore: payload.hasMore === true,
          nextCursor: String(payload.nextCursor || '')
        }
      },
      session => String(session?.username || '')
    )
  }

  private async listAllWechatContacts(): Promise<any[]> {
    return collectStableCursorPages(
      async cursor => {
        const payload = await this.api('/api/v1/contacts', {
          limit: 10_000,
          cursor: cursor || undefined
        })
        return {
          items: Array.isArray(payload.contacts) ? payload.contacts : [],
          total: Number(payload.total ?? payload.count ?? 0),
          hasMore: payload.hasMore === true,
          nextCursor: String(payload.nextCursor || '')
        }
      },
      contact => String(contact?.username || '')
    )
  }

  private async collectMessages(start: number, end: number): Promise<{
    messages: any[]
    failed: string[]
    successful: string[]
    continuationOffsets: Record<string, number>
  }> {
    const sessionsFromApi = await this.listAllWechatSessions()
    const contacts = await this.listAllWechatContacts().catch(() => [])
    const contactsById = new Map(contacts.map((contact: any) => [String(contact.username), contact]))
    const policies = personalMemoryStore.getConversationPolicies()
    const allSessions = includeContinuationSessions(
      sessionsFromApi,
      this.state.cursor.sessionOffsets,
      end
    )
    for (const session of allSessions) {
      if (isOfficialAccountSession(session) || policies.get(session.username) === false) {
        // 忽略期间持续推进该会话游标，重新启用时默认从启用时刻开始，
        // 避免突然补分析数月历史消息。
        this.state.cursor.sessionCursors[session.username] = end
        delete this.state.cursor.sessionOffsets[session.username]
      }
    }
    const sessions = allSessions.filter((session: any) => {
      if (isOfficialAccountSession(session)) return false
      if (policies.get(session.username) === false) return false
      const sessionStart = Number(this.state.cursor.sessionCursors[session.username] ?? start)
      return Number(session.lastTimestamp || 0) >= sessionStart
    })
    const retryCursors = initializeSessionRetryCursors(
      this.state.cursor.sessionCursors,
      sessions.map((session: any) => String(session.username || '')),
      start
    )
    this.state.cursor.sessionCursors = retryCursors.sessionCursors
    const ocrImages = Boolean(this.config.get('aiAssistantOcrImages'))
    const analyzeImages = Boolean(this.config.get('aiAssistantAnalyzeImages'))
    const loadImages = ocrImages || analyzeImages
    const results = await settleWithConcurrency(sessions, 8, async (session: any) => {
      const rawRows: any[] = []
      const persistedOffset = Math.max(0,
        Math.floor(Number(this.state.cursor.sessionOffsets[session.username]) || 0))
      const sessionStart = Math.max(0,
        Number(this.state.cursor.sessionCursors[session.username] ?? start) - (persistedOffset ? 0 : 300))
      let offset = persistedOffset
      let hasMore = false
      for (let page = 0; page < 50; page += 1) {
        const payload = await this.api('/api/v1/messages', {
          talker: session.username,
          limit: 200,
          offset,
          start: sessionStart,
          end,
          ascending: '1',
          media: loadImages ? '1' : undefined,
          image: loadImages ? '1' : undefined,
          voice: loadImages ? '0' : undefined,
          video: loadImages ? '0' : undefined,
          emoji: loadImages ? '0' : undefined
        })
        const pageRows = Array.isArray(payload.messages) ? payload.messages : []
        rawRows.push(...pageRows)
        hasMore = payload.hasMore === true
        if (!hasMore) break
        if (!pageRows.length) throw new Error('消息分页仍有后续但当前页为空')
        offset += pageRows.length
      }
      const isGroup = String(session.username).endsWith('@chatroom')
      const membersPayload = isGroup && rawRows.length
        ? await this.api('/api/v1/group-members', { chatroomId: session.username }).catch(() => ({ members: [] }))
        : { members: [] }
      const membersById = new Map((membersPayload.members || []).map((member: any) => [String(member.wxid), member]))
      const rows = rawRows.map((message: any) => {
        const isSelf = Number(message.isSend) === 1
        const senderId = String(message.senderUsername || (isSelf ? 'self' : ''))
        const contact: any = contactsById.get(senderId) || {}
        const member: any = membersById.get(senderId) || {}
        const identity = {
          wxid: senderId,
          contactRemark: String(member.remark || contact.remark || ''),
          wechatNickname: String(member.nickname || contact.nickname || contact.nickName || ''),
          groupNickname: String(member.groupNickname || ''),
          alias: String(member.alias || contact.alias || ''),
          displayName: String(
            member.groupNickname || member.remark || contact.remark ||
            member.nickname || contact.nickname || contact.nickName ||
            member.displayName || contact.displayName ||
            message.senderDisplayName || message.senderName || message.displayName || senderId
          )
        }
        const semantics = recoverMessageSemantics(message)
        return {
          id: String(message.serverId || message.localId),
          localId: String(message.localId || ''),
          serverId: String(message.serverId || ''),
          sessionId: session.username,
          sessionName: session.displayName || session.username,
          timestamp: Number(message.createTime || 0),
          direction: isSelf ? '我发送' : '对方发送',
          senderId,
          senderName: isSelf ? '我' : identity.displayName,
          senderIdentity: identity,
          isGroup,
          content: semantics.content,
          semanticType: semantics.semanticType,
          replyToMessageId: semantics.replyToMessageId,
          quotedSender: semantics.quotedSender,
          mediaLocalPath: String(message.mediaLocalPath || ''),
          appMsgKind: String(message.appMsgKind || ''),
          linkTitle: String(message.linkTitle || ''),
          linkUrl: String(message.linkUrl || ''),
          fileName: String(message.fileName || message.mediaFileName || ''),
          fileExt: String(message.fileExt || ''),
          fileSize: Number(message.fileSize || 0),
          fileMd5: String(message.fileMd5 || '')
        }
      }).filter((message: any) => message.content)
      return {
        sessionId: session.username,
        rows,
        continuationOffset: nextSessionContinuationOffset(persistedOffset, offset, hasMore, 20)
      }
    })
    const messages: any[] = []
    const failed: string[] = []
    const successful: string[] = []
    const continuationOffsets: Record<string, number> = {}
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value.sessionId)
        if (result.value.continuationOffset > 0) {
          continuationOffsets[result.value.sessionId] = result.value.continuationOffset
        }
        messages.push(...result.value.rows)
      } else {
        failed.push(sessions[index]?.username)
      }
    })
    const deduped = new Map(messages.map(message => [messageKey(message), message]))
    const sorted = [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp)
    await this.enrichVoiceTranscripts(sorted)
    await this.enrichImageOcr(sorted)
    await this.enrichImageSemantics(sorted)
    await this.enrichAttachmentText(sorted)
    await this.enrichWebSnapshots(sorted)
    return { messages: sorted, failed, successful, continuationOffsets }
  }

  private async enrichVoiceTranscripts(messages: any[]): Promise<void> {
    if (!this.config.get('autoTranscribeVoice')) return
    const model = await voiceTranscribeService.getModelStatus().catch(() => ({ success: false, exists: false }))
    if (!model.success || !model.exists) return
    const candidates = messages.filter(message =>
      message.semanticType === 'voice' && message.localId && !String(message.content || '').includes('本地转写')
    ).slice(0, 12)
    for (const message of candidates) {
      try {
        const result = await chatService.getVoiceTranscript(
          message.sessionId,
          message.localId,
          message.timestamp,
          undefined,
          message.senderId,
          message.serverId
        )
        if (result.success && result.transcript?.trim()) {
          message.content = attachLocalVoiceTranscript(message.content, redact(result.transcript))
          message.transcriptionSource = 'sensevoice-local'
        }
      } catch {}
    }
  }

  private async enrichImageOcr(messages: any[]): Promise<void> {
    if (!this.config.get('aiAssistantOcrImages')) return
    const status = await localOcrService.getStatus()
    if (!status.available || !status.chinese) return
    const candidates = messages.filter(message =>
      message.semanticType === 'image' && message.mediaLocalPath && !String(message.content || '').includes('本地OCR')
    ).slice(-8)
    for (const message of candidates) {
      const result = await localOcrService.recognize(message.mediaLocalPath)
      if (result.success && result.text?.trim()) {
        message.content = attachLocalImageOcr(message.content, redact(result.text))
        message.ocrSource = 'tesseract-local'
        message.ocrStructure = structureOcrText(redact(result.text))
      }
    }
  }

  private async enrichImageSemantics(messages: any[]): Promise<void> {
    if (!this.config.get('aiAssistantAnalyzeImages')) return
    if (!localImageSemanticService.getStatus().available) return
    const candidates = messages.filter(message =>
      message.semanticType === 'image'
      && message.mediaLocalPath
      && !String(message.content || '').includes('图片视觉·Apple Vision')
    ).slice(-4)
    for (const message of candidates) {
      const result = await localImageSemanticService.classify(message.mediaLocalPath)
      const semanticText = result.success ? buildImageSemanticText(result.labels) : ''
      if (!semanticText) continue
      message.content = `${message.content}\n${semanticText}`.trim().slice(0, 18_000)
      message.visualSource = 'apple-vision-local'
      message.visualLabels = result.labels
      message.visualModelVersion = localImageSemanticService.getStatus().modelVersion
    }
  }

  private async continuePendingImageSemantics(): Promise<void> {
    if (!this.config.get('aiAssistantAnalyzeImages')) return
    const status = localImageSemanticService.getStatus()
    if (!status.available) return
    const pending = personalMemoryStore.listPendingImageSemanticResources(status.modelVersion, 1)
    for (const resource of pending) {
      const filePath = String(resource.metadata?.mediaLocalPath || '')
      const attempts = Number(resource.metadata?.visualMigrationAttempts || 0)
      if (!filePath || !existsSync(filePath)) {
        personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
          visualMigrationStatus: 'not_found',
          visualMigrationAttempts: attempts + 1,
          visualMigrationNextAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
        })
        continue
      }
      const result = await localImageSemanticService.classify(filePath)
      if (!result.success) {
        const retryDays = Math.min(7, Math.max(1, 2 ** attempts))
        personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
          visualMigrationStatus: 'failed',
          visualMigrationAttempts: attempts + 1,
          visualMigrationNextAt: new Date(Date.now() + retryDays * 86_400_000).toISOString()
        })
        continue
      }
      const semanticText = buildImageSemanticText(result.labels)
      const baseContent = String(resource.content || '')
        .replace(/\n?\[图片视觉·Apple Vision 本地候选｜未经人工确认\][\s\S]*$/u, '')
        .trim()
      personalMemoryStore.replaceResourceContent(resource.id, `${baseContent}${semanticText ? `\n${semanticText}` : ''}`.trim(), {
        visualSource: 'apple-vision-local',
        visualLabels: result.labels,
        visualModelVersion: status.modelVersion,
        visualMigrationStatus: semanticText ? 'completed' : 'empty',
        visualMigrationAttempts: attempts + 1,
        visualMigrationNextAt: '',
        visualMigratedAt: new Date().toISOString()
      })
    }
  }

  private async enrichAttachmentText(messages: any[]): Promise<void> {
    const candidates = messages.filter(message =>
      message.semanticType === 'file' && message.fileName
    ).slice(-6)
    for (const message of candidates) {
      try {
        const located = await exportService.context.resolveFileAttachmentForIndexing({
          fileName: message.fileName,
          fileMd5: message.fileMd5,
          createTime: message.timestamp
        })
        if (!located) {
          message.attachmentIndexStatus = 'not_found'
          continue
        }
        const extracted = await extractAttachmentText(located.sourcePath, located.size)
        message.attachmentLocalPath = located.sourcePath
        message.attachmentMatchedBy = located.matchedBy
        message.attachmentIndexStatus = extracted.status
        message.attachmentFormat = extracted.format
        message.attachmentStructure = extracted.structure || null
        message.attachmentStructureParserVersion = extracted.structure ? ATTACHMENT_STRUCTURE_PARSER_VERSION : ''
        if (extracted.status === 'ocr_required' && this.config.get('aiAssistantOcrImages')) {
          const scanned = await extractScannedPdfText(located.sourcePath)
          message.attachmentPdfOcrStatus = scanned.status
          message.attachmentPdfOcrPages = scanned.processedPages
          message.attachmentPdfTotalPages = scanned.totalPages
          message.attachmentPdfOcrTruncated = scanned.truncated
          message.attachmentPdfOcrNextPage = scanned.nextPage
          if (scanned.success) {
            message.content = `${message.content}\n[PDF扫描·本地OCR] ${redact(scanned.text)}`.slice(0, 18_000)
            message.attachmentIndexStatus = 'indexed'
            message.attachmentFormat = '.pdf-ocr'
            message.attachmentTextSource = 'poppler-tesseract-local'
          }
        }
        if (extracted.success) {
          message.content = `${message.content}\n[附件·本地正文] ${redact(extracted.text)}`.slice(0, 18_000)
          message.attachmentTextSource = 'local-bounded-parser'
        }
      } catch {
        message.attachmentIndexStatus = 'failed'
      }
    }
  }

  private async enrichWebSnapshots(messages: any[]): Promise<void> {
    if (!this.config.get('aiAssistantIndexWebLinks')) return
    const candidates = messages.filter(message =>
      message.semanticType === 'link' && /^https?:\/\//i.test(message.linkUrl || '')
    ).slice(-4)
    for (const message of candidates) {
      const snapshot = await captureWebSnapshot(message.linkUrl)
      message.webSnapshotStatus = snapshot.status
      message.webSnapshotFinalUrl = snapshot.finalUrl || ''
      message.webSnapshotTitle = snapshot.title || ''
      message.webSnapshotDescription = snapshot.description || ''
      if (snapshot.success && snapshot.text) {
        message.content = `${message.content}\n[网页·本地快照] ${snapshot.text}`.slice(0, 18_000)
        message.webSnapshotSource = 'local-safe-fetch'
      }
    }
  }

  private async continuePendingPdfOcr(): Promise<void> {
    if (!this.config.get('aiAssistantOcrImages')) return
    const pending = personalMemoryStore.listPendingPdfOcrResources(1)
    for (const resource of pending) {
      const filePath = String(resource.metadata?.attachmentLocalPath || '')
      if (!filePath || !existsSync(filePath)) {
        personalMemoryStore.appendResourceContent(resource.id, '', {
          attachmentPdfOcrStatus: 'not_found',
          attachmentPdfOcrTruncated: false
        })
        continue
      }
      const startPage = Math.max(2, Number(resource.metadata?.attachmentPdfOcrNextPage || 2))
      const scanned = await extractScannedPdfText(filePath, startPage)
      const retryable = scanned.status === 'failed' || scanned.status === 'dependency_missing'
      personalMemoryStore.appendResourceContent(
        resource.id,
        scanned.success ? redact(scanned.text) : '',
        {
          attachmentPdfOcrStatus: scanned.status,
          attachmentPdfOcrPages: Number(resource.metadata?.attachmentPdfOcrPages || 0) + scanned.processedPages,
          attachmentPdfTotalPages: scanned.totalPages || resource.metadata?.attachmentPdfTotalPages || 0,
          attachmentPdfOcrTruncated: retryable ? true : scanned.truncated,
          attachmentPdfOcrNextPage: retryable ? startPage : scanned.nextPage
        }
      )
    }
  }

  private async continuePendingAttachmentStructures(): Promise<void> {
    const pending = personalMemoryStore.listPendingAttachmentStructureResources(
      ATTACHMENT_STRUCTURE_PARSER_VERSION,
      1
    )
    for (const resource of pending) {
      const filePath = String(resource.metadata?.attachmentLocalPath || '')
      const attempts = Number(resource.metadata?.attachmentStructureMigrationAttempts || 0)
      if (!filePath || !existsSync(filePath)) {
        personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
          attachmentStructureMigrationStatus: 'not_found',
          attachmentStructureMigrationAttempts: attempts + 1,
          attachmentStructureMigrationNextAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
        })
        continue
      }
      const extracted = await extractAttachmentText(filePath)
      if (extracted.success && extracted.structure) {
        const baseContent = String(resource.content || '').replace(/\n?\[附件·本地正文\][\s\S]*$/u, '').trim()
        const content = `${baseContent}\n[附件·本地正文] ${redact(extracted.text)}`.trim()
        personalMemoryStore.replaceResourceContent(resource.id, content, {
          attachmentStructure: extracted.structure,
          attachmentStructureParserVersion: ATTACHMENT_STRUCTURE_PARSER_VERSION,
          attachmentStructureMigrationStatus: 'completed',
          attachmentStructureMigrationAttempts: attempts + 1,
          attachmentStructureMigrationNextAt: '',
          attachmentStructureMigratedAt: new Date().toISOString()
        })
      } else {
        const retryDays = Math.min(7, Math.max(1, 2 ** attempts))
        personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
          attachmentStructureMigrationStatus: extracted.status || 'failed',
          attachmentStructureMigrationAttempts: attempts + 1,
          attachmentStructureMigrationNextAt: new Date(Date.now() + retryDays * 86_400_000).toISOString()
        })
      }
    }
  }

  private persistMessageResources(messages: any[], createdAt: string): void {
    const resourceTypes = new Set(['link', 'file', 'forward', 'miniapp', 'image', 'voice'])
    const resources = messages.flatMap(message => {
      if (!resourceTypes.has(message.semanticType)) return []
      if (message.semanticType === 'image' && !message.ocrSource && !message.visualSource) return []
      if (message.semanticType === 'voice' && !message.transcriptionSource) return []
      const recoveredContent = String(message.content || '')
        .replace(/^\[(?:图片·本地OCR|语音·本地转写)\]\s*/, '')
        .trim()
      const resourceType = message.semanticType === 'forward'
        ? 'chat-history'
        : message.semanticType === 'miniapp' ? 'mini-program' : message.semanticType
      const title = String(
        message.linkTitle || message.fileName ||
        (message.semanticType === 'image' ? '图片识别内容' :
          message.semanticType === 'voice' ? '语音转写' :
            message.semanticType === 'chat-history' ? '转发的聊天记录' :
              message.semanticType === 'mini-program' ? '小程序' : '消息资源')
      ).trim()
      const messageId = String(message.id || message.localId || '')
      if (!messageId) return []
      return [{
        id: crypto.createHash('sha256').update(`${message.sessionId}:${messageId}:${resourceType}`).digest('hex').slice(0, 32),
        resourceType,
        title,
        url: message.linkUrl,
        fileName: message.fileName,
        fileExt: message.fileExt,
        content: recoveredContent,
        metadata: {
          sourceId: String(message.sourceId || 'wechat'),
          sessionId: message.sessionId,
          sessionName: message.sessionName,
          senderId: message.senderId,
          senderName: message.senderName,
          appMsgKind: message.appMsgKind,
          fileSize: message.fileSize,
          fileMd5: message.fileMd5,
          mediaLocalPath: message.mediaLocalPath,
          transcriptionSource: message.transcriptionSource || '',
          ocrSource: message.ocrSource || '',
          ocrStructure: message.ocrStructure || null,
          visualSource: message.visualSource || '',
          visualLabels: message.visualLabels || [],
          visualModelVersion: message.visualModelVersion || '',
          attachmentLocalPath: message.attachmentLocalPath || '',
          attachmentMatchedBy: message.attachmentMatchedBy || '',
          attachmentIndexStatus: message.attachmentIndexStatus || '',
          attachmentFormat: message.attachmentFormat || '',
          attachmentTextSource: message.attachmentTextSource || '',
          attachmentStructure: message.attachmentStructure || null,
          attachmentStructureParserVersion: message.attachmentStructureParserVersion || '',
          attachmentPdfOcrStatus: message.attachmentPdfOcrStatus || '',
          attachmentPdfOcrPages: message.attachmentPdfOcrPages || 0,
          attachmentPdfTotalPages: message.attachmentPdfTotalPages || 0,
          attachmentPdfOcrTruncated: Boolean(message.attachmentPdfOcrTruncated),
          attachmentPdfOcrNextPage: message.attachmentPdfOcrNextPage || 0,
          webSnapshotStatus: message.webSnapshotStatus || '',
          webSnapshotFinalUrl: message.webSnapshotFinalUrl || '',
          webSnapshotTitle: message.webSnapshotTitle || '',
          webSnapshotDescription: message.webSnapshotDescription || '',
          webSnapshotSource: message.webSnapshotSource || ''
        },
        createdAt: new Date(Number(message.timestamp || 0) * 1000).toISOString(),
        updatedAt: createdAt,
        evidence: [{
          sourceId: String(message.sourceId || 'wechat'),
          messageId,
          sessionId: message.sessionId,
          timestamp: message.timestamp,
          sender: message.senderName,
          excerpt: String(message.content || '').slice(0, 2000)
        }]
      }]
    })
    personalMemoryStore.upsertResources(resources)
  }

  private async callAi(messages: any[]): Promise<any> {
    const apiKey = String(this.config.get('aiAssistantApiKey') || '').trim()
    if (!apiKey) throw new Error('请先设置 DeepSeek API Key')
    const baseUrl = String(this.config.get('aiAssistantApiBaseUrl') || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = String(this.config.get('aiAssistantApiModel') || 'deepseek-v4-flash')
    const compact = messages.map(message => ({
      messageId: message.id,
      evidenceKey: messageKey(message),
      time: new Date(message.timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      session: message.sessionName,
      sessionId: message.sessionId,
      isGroup: message.isGroup,
      direction: message.direction,
      senderId: message.senderId,
      sender: message.direction === '我发送' ? '我' : (message.senderName || message.senderId || '未知发送者'),
      analysisScope: message.analysisScope || 'core',
      sourceId: message.sourceId || 'wechat',
      sourceKind: message.sourceKind || 'chat',
      senderIdentity: message.senderIdentity,
      semanticType: message.semanticType,
      transcriptionSource: message.transcriptionSource || undefined,
      ocrSource: message.ocrSource || undefined,
      visualSource: message.visualSource || undefined,
      replyToMessageId: message.replyToMessageId || undefined,
      quotedSender: message.quotedSender || undefined,
      content: redact(message.content)
    }))
    const conversations = Object.values(compact.reduce((groups: Record<string, any>, message: any) => {
      const key = message.sessionId
      if (!groups[key]) groups[key] = { session: message.session, sessionId: key, isGroup: message.isGroup, participants: {}, messages: [] }
      if (message.senderIdentity?.wxid) groups[key].participants[message.senderIdentity.wxid] = message.senderIdentity
      const { senderIdentity, ...compactMessage } = message
      groups[key].messages.push(compactMessage)
      return groups
    }, {})).map((conversation: any) => ({ ...conversation, participants: Object.values(conversation.participants) }))
    const configuredOwnerName = String(this.config.get('aiAssistantOwnerName') || '').trim()
    const configuredAliases = String(this.config.get('aiAssistantOwnerAliases') || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean)
    const selfIdentity = messages.find(message => message.direction === '我发送' && message.senderIdentity)?.senderIdentity
    const inferredOwnerName = String(
      selfIdentity?.contactRemark || selfIdentity?.wechatNickname || selfIdentity?.displayName || ''
    ).trim()
    const ownerProfile = {
      name: configuredOwnerName || inferredOwnerName,
      aliases: [...new Set([
        ...configuredAliases,
        selfIdentity?.contactRemark,
        selfIdentity?.wechatNickname,
        selfIdentity?.groupNickname,
        selfIdentity?.alias
      ].map(value => String(value || '').trim()).filter(Boolean))],
      wxid: String(selfIdentity?.wxid || ''),
      background: String(this.config.get('aiAssistantOwnerBackground') || '').trim()
    }
    const contextSelection = selectTrustedExtractionEntities({
      messages,
      entities: this.state.graph.entities.filter(isTrustedEntity),
      relations: this.state.graph.relations,
      ownerNames: [ownerProfile.name, ...ownerProfile.aliases],
      limit: 24
    })
    const contextEntityIds = contextSelection.entities.map(entity => entity.id)
    const contextMemory = personalMemoryStore.getTrustedExtractionMemory(contextEntityIds, {
      claimLimit: 36,
      eventLimit: 16
    })
    const contextEntityNames = new Map(contextSelection.entities.map(entity => [entity.id, entity.canonicalName]))
    const extractionContext = {
      version: EXTRACTION_MEMORY_CONTEXT_VERSION,
      policy: '仅用于实体消歧和理解指代；不能作为本批任何输出的证据',
      entities: contextSelection.entities.map(entity => ({
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        accountIds: entity.accountIds,
        summary: entity.summary && entity.summaryStatus === 'confirmed' ? entity.summary : '',
        selectionReasons: contextSelection.reasons[entity.id] || []
      })),
      relations: contextSelection.relations.map(relation => ({
        id: relation.id,
        subjectId: relation.subjectId,
        subjectName: contextEntityNames.get(relation.subjectId) || '',
        predicate: relation.predicate,
        objectId: relation.objectId,
        objectName: contextEntityNames.get(relation.objectId) || '',
        confidence: relation.confidence
      })),
      claims: contextMemory.claims,
      events: contextMemory.events,
      totals: {
        selectedEntities: contextSelection.entities.length,
        directEntities: contextSelection.directEntityIds.length,
        expandedEntities: contextSelection.expandedEntityIds.length,
        relations: contextSelection.relations.length,
        claims: contextMemory.claims.length,
        claimMatches: contextMemory.claimTotal,
        events: contextMemory.events.length,
        eventMatches: contextMemory.eventTotal
      }
    }
    const redactionLevel = String(this.config.get('aiAssistantSensitiveRedactionLevel') || 'standard') as SensitiveRedactionLevel
    const outbound = redactSensitiveText(`用户身份档案：${JSON.stringify(ownerProfile)}
与本批相关的已确认长期记忆（只能用于消歧，不能充当新结论证据）：${JSON.stringify(extractionContext)}
按来源范围组织的新增证据：${JSON.stringify(conversations)}
请输出 json。`, redactionLevel)
    const extractionContextAudit = buildExtractionContextAudit({
      inputFingerprint: crypto.createHash('sha256')
        .update(`${SYSTEM_PROMPT}\n${outbound.text}`)
        .digest('hex'),
      messages,
      entities: extractionContext.entities,
      relations: extractionContext.relations,
      claims: extractionContext.claims,
      events: extractionContext.events,
      totals: extractionContext.totals
    })
    let lastError: any = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now()
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 5000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + (attempt ? '\n务必输出单个完整 JSON 对象。' : '') },
            { role: 'user', content: outbound.text }
          ]
        }),
        signal: AbortSignal.timeout(90_000)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek 请求失败 (${response.status})`)
      try {
        return {
          ...parseModelJson(payload?.choices?.[0]?.message?.content),
          __meta: {
            model,
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION,
            inputTokens: Number(payload?.usage?.prompt_tokens || 0),
            outputTokens: Number(payload?.usage?.completion_tokens || 0),
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1,
            sensitiveRedaction: outbound.summary,
            extractionContext: extractionContextAudit
          }
        }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  private buildAnalysisBatches(messages: any[], forcedContextKeys = new Set<string>()): any[][] {
    return buildOverlappingAnalysisBatches(messages, {
      messageKey,
      forcedContextKeys,
      coreSize: 100,
      overlap: 20,
      maxBatchSize: 160
    })
  }

  private mergeGraphDigest(
    digest: any,
    sourceMessages: any[],
    now: string,
    commitId = ''
  ): Map<string, string> {
    const tempIds = new Map<string, string>()
    const entities = Array.isArray(digest.entities) ? digest.entities : []
    for (const item of entities) {
      const reservedNames = new Set(['用户', '我', '本人', '自己', '对方', '群友', '某人', '未知', '未知用户', 'unknown', 'user'])
      const ownerName = String(this.config.get('aiAssistantOwnerName') || '').trim()
      const rawName = String(item.canonicalName || '').trim()
      const itemAliases = (Array.isArray(item.aliases) ? item.aliases : []).map(String).filter(Boolean)
      const canonicalName = reservedNames.has(rawName.toLowerCase()) && ownerName && itemAliases.includes(ownerName)
        ? ownerName
        : rawName
      if (!canonicalName || reservedNames.has(canonicalName.toLowerCase())) continue
      const resolution = planExtractedEntityResolution(
        { ...item, canonicalName, aliases: itemAliases },
        this.state.graph.entities
      )
      const accountIds = resolution.verifiedAccountIds
      const aliases = [...new Set(resolution.verifiedAliases
        .filter(alias => !reservedNames.has(alias.trim().toLowerCase()) && alias !== canonicalName))]
      const candidateAliases = [...new Set(resolution.candidateAliases
        .filter(alias => !reservedNames.has(alias.trim().toLowerCase()) && alias !== canonicalName))]
      const existing = resolution.existing || undefined
      const stableSeed = `${commitId}|${String(item.tempId || '')}|${canonicalName}|${String(item.type || 'person')}`
      const id = existing?.id || (commitId
        ? `ent_${crypto.createHash('sha256').update(stableSeed).digest('hex').slice(0, 32)}`
        : `ent_${crypto.randomUUID()}`)
      tempIds.set(String(item.tempId || id), id)
      const evidenceIds = [...new Set((Array.isArray(item.evidenceKeys) ? item.evidenceKeys : []).map(String))]
      for (const message of Array.isArray(item.__evidenceMessages) ? item.__evidenceMessages : []) {
        this.pendingEntityEvidence.push({
          entityId: id,
          sourceId: String(message.sourceId || 'wechat'),
          messageId: structuredEvidenceKey(message),
          sessionId: String(message.sessionId || ''),
          timestamp: Number(message.timestamp || 0),
          sender: String(message.senderName || message.senderId || ''),
          excerpt: redact(String(message.content || '')).slice(0, 300),
          evidenceKind: accountIds.length ? 'identity_anchor' : 'entity_mention'
        })
      }
      if (existing) {
        const before = JSON.stringify([existing.canonicalName, existing.aliases, existing.accountIds, existing.summary])
        existing.aliases = [...new Set([...existing.aliases, ...aliases])]
        existing.accountIds = [...new Set([...existing.accountIds, ...accountIds])]
        if (accountIds.length) {
          existing.trustStatus = 'confirmed'
          for (const pending of this.state.graph.reviewQueue) {
            if (pending.kind === 'entity_creation' && pending.entityId === existing.id && pending.status === 'pending') {
              pending.status = 'confirmed'
              pending.detail = `${pending.detail} 后续新增原文提供了可验证身份锚点，已自动确认。`
              pending.resolvedAt = now
              pending.resolutionActor = 'system'
              pending.resolutionReason = '新增原文提供了可验证身份锚点，系统按确定性规则自动确认'
            }
          }
        }
        existing.confidence = Math.max(existing.confidence, Number(item.confidence || 0))
        existing.evidenceMessageIds = compactEntityEvidenceMessageIds([
          ...existing.evidenceMessageIds,
          ...evidenceIds
        ])
        existing.updatedAt = now
        if (before !== JSON.stringify([existing.canonicalName, existing.aliases, existing.accountIds, existing.summary])) existing.identityVersion += 1
        const summaryCandidate = buildEntitySummaryCandidate({
          entityId: existing.id,
          entityName: existing.canonicalName,
          previousSummary: existing.summary,
          summary: item.summary,
          confidence: item.confidence,
          evidenceMessages: item.__evidenceMessages,
          evidenceKeys: evidenceIds,
          identityVersion: existing.identityVersion,
          createdAt: now
        })
        if (summaryCandidate && !this.state.graph.reviewQueue.some(review => review.id === summaryCandidate.id)) {
          this.state.graph.reviewQueue.push(summaryCandidate)
        }
        for (const aliasCandidate of buildEntityAliasCandidates({
          entity: existing,
          aliases: candidateAliases,
          evidenceMessages: item.__evidenceMessages,
          evidenceKeys: evidenceIds,
          confidence: item.confidence,
          createdAt: now
        })) {
          if (!this.state.graph.reviewQueue.some(review => review.id === aliasCandidate.id)) {
            this.state.graph.reviewQueue.push(aliasCandidate)
          }
        }
        this.enqueueIdentityCandidates(existing, now)
      } else {
        const created: GraphEntity = {
          id,
          type: ['person', 'organization', 'group', 'project'].includes(item.type) ? item.type : 'person',
          canonicalName: canonicalName.slice(0, 100),
          aliases,
          accountIds,
          externalIdentities: [],
          summary: '',
          summaryStatus: 'empty',
          trustStatus: accountIds.length ? 'confirmed' : 'candidate',
          confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
          evidenceMessageIds: compactEntityEvidenceMessageIds(evidenceIds),
          createdAt: now,
          updatedAt: now,
          identityVersion: 1,
          lastDisambiguatedAt: null
        }
        this.state.graph.entities.push(created)
        const entityReview = buildEntityCreationReview({
          entity: created,
          evidenceMessages: item.__evidenceMessages,
          evidenceKeys: evidenceIds,
          createdAt: now
        })
        if (entityReview) this.state.graph.reviewQueue.push(entityReview)
        const summaryCandidate = buildEntitySummaryCandidate({
          entityId: created.id,
          entityName: created.canonicalName,
          previousSummary: '',
          summary: item.summary,
          confidence: item.confidence,
          evidenceMessages: item.__evidenceMessages,
          evidenceKeys: evidenceIds,
          identityVersion: created.identityVersion,
          createdAt: now
        })
        if (summaryCandidate) this.state.graph.reviewQueue.push(summaryCandidate)
        this.state.graph.reviewQueue.push(...buildEntityAliasCandidates({
          entity: created,
          aliases: candidateAliases,
          evidenceMessages: item.__evidenceMessages,
          evidenceKeys: evidenceIds,
          confidence: item.confidence,
          createdAt: now
        }))
        this.enqueueIdentityCandidates(created, now)
      }
    }
    for (const item of Array.isArray(digest.relations) ? digest.relations : []) {
      const subjectId = tempIds.get(String(item.subjectTempId || ''))
      const objectId = tempIds.get(String(item.objectTempId || ''))
      if (!subjectId || !objectId || subjectId === objectId) continue
      const predicate = String(item.predicate || '').trim().slice(0, 80)
      if (!predicate) continue
      const subjectType = this.state.graph.entities.find(entity => entity.id === subjectId)?.type
      const objectType = this.state.graph.entities.find(entity => entity.id === objectId)?.type
      if (/伴侣|配偶|夫妻|父亲|母亲|兄弟|姐妹|朋友|同学/.test(predicate) &&
          (subjectType !== 'person' || objectType !== 'person')) continue
      const id = crypto.createHash('sha256').update(`${subjectId}|${predicate}|${objectId}`).digest('hex').slice(0, 20)
      const evidence = (Array.isArray(item.__evidenceMessages) ? item.__evidenceMessages : []).map((message: any) => ({
        messageId: structuredEvidenceKey(message),
        sessionId: String(message.sessionId),
        timestamp: Number(message.timestamp),
        excerpt: redact(String(message.content)).slice(0, 160)
      }))
      if (personalMemoryStore.isExtractedMemoryItemSuppressed('relation', {
        id, subjectId, predicate, objectId, evidence
      })) continue
      const existing = this.state.graph.relations.find(relation => relation.id === id)
      if (existing) {
        const known = new Set(existing.evidence.map(item => item.messageId))
        existing.evidence.push(...evidence.filter(item => !known.has(item.messageId)))
        existing.confidence = Math.max(existing.confidence, Number(item.confidence || 0))
        existing.updatedAt = now
        compactRelationEvidenceHotset(existing)
      } else {
        const relation: GraphRelation = {
          id, subjectId, predicate, objectId,
          confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
          directionExplanation: String(item.directionExplanation || '').slice(0, 240),
          evidence,
          evidenceTotal: evidence.length,
          status: 'candidate',
          createdAt: now,
          updatedAt: now
        }
        this.state.graph.relations.push(relation)
        if (relation.status === 'candidate') {
          const subject = this.state.graph.entities.find(entity => entity.id === subjectId)?.canonicalName || '未知'
          const object = this.state.graph.entities.find(entity => entity.id === objectId)?.canonicalName || '未知'
          this.state.graph.reviewQueue.push({
            id: `review_rel_${id}`, kind: 'relation', title: `${subject} — ${predicate} → ${object}`,
            detail: String(item.directionExplanation || evidence[0]?.excerpt || '需要根据消息证据确认这条关系').slice(0, 300),
            confidence: relation.confidence, status: 'pending', createdAt: now, relationId: id
          })
        }
      }
    }
    for (const item of Array.isArray(digest.possibleDuplicates) ? digest.possibleDuplicates : []) {
      const leftId = tempIds.get(String(item.leftTempId || ''))
      if (!leftId) continue
      const right = this.state.graph.entities.find(entity => entity.canonicalName === String(item.rightExistingName || ''))
      if (!right || right.id === leftId) continue
      const leftName = this.state.graph.entities.find(entity => entity.id === leftId)?.canonicalName || '未知人物'
      const left = this.state.graph.entities.find(entity => entity.id === leftId)
      if (left) this.enqueueIdentityPair(left, right, now, {
        source: 'llm_suggestion',
        detail: String(item.reason || ''),
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.5)))
      })
    }
    return tempIds
  }

  private persistClaimsAndEvents(digest: any, tempIds: Map<string, string>, sourceMessages: any[], now: string): void {
    const evidenceFor = (messages: any[], role: 'direct' | 'indirect' | 'contradiction' = 'direct') =>
      (Array.isArray(messages) ? messages : []).map(message => ({
        messageId: structuredEvidenceKey(message),
        sessionId: String(message.sessionId),
        timestamp: Number(message.timestamp),
        excerpt: redact(String(message.content)).slice(0, 300),
        role
      }))
    const claims = (Array.isArray(digest.claims) ? digest.claims : []).flatMap((item: any) => {
      const subjectId = tempIds.get(String(item.subjectTempId || ''))
      const objectEntityId = tempIds.get(String(item.objectTempId || ''))
      const predicate = String(item.predicate || '').trim().slice(0, 100)
      const objectValue = String(item.objectValue || '').trim().slice(0, 1000)
      const polarity = item.polarity === 'negative' ? 'negative' : 'positive'
      const sourceNature = normalizeDataSourceClaimNature(
        sourceMessages.some(message => message.sourceId === 'documents') ? 'documents' : 'wechat',
        String(item.sourceNature || '')
      )
      const evidence = evidenceFor(item.__evidenceMessages, sourceNature === 'self_statement' ? 'direct' : 'indirect')
      if (!subjectId || !predicate || (!objectEntityId && !objectValue) || !evidence.length) return []
      const value = objectEntityId || objectValue
      const subjectName = this.state.graph.entities.find(entity => entity.id === subjectId)?.canonicalName || ''
      const objectName = objectEntityId ? this.state.graph.entities.find(entity => entity.id === objectEntityId)?.canonicalName || '' : objectValue
      const id = crypto.createHash('sha256').update(`${subjectId}|${predicate}|${value}|${polarity}|${String(item.validFrom || '')}`).digest('hex').slice(0, 24)
      return [{
        id, subjectId, predicate, objectEntityId, objectValue: objectEntityId ? '' : objectValue,
        polarity,
        valueType: ['text', 'number', 'date', 'boolean'].includes(item.valueType) ? item.valueType : 'text',
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
        status: 'candidate',
        sourceNature,
        validFrom: String(item.validFrom || ''), validTo: String(item.validTo || ''),
        searchText: `${subjectName} ${polarity === 'negative' ? '并非' : ''} ${predicate} ${objectName}`.trim(), evidence, createdAt: now
      }]
    })
    const events = (Array.isArray(digest.events) ? digest.events : []).flatMap((item: any) => {
      const title = String(item.title || '').trim().slice(0, 200)
      const evidence = evidenceFor(item.__evidenceMessages)
      if (!title || !evidence.length) return []
      const participants = (Array.isArray(item.participants) ? item.participants : []).flatMap((participant: any) => {
        const entityId = tempIds.get(String(participant.tempId || ''))
        return entityId ? [{ entityId, role: String(participant.role || 'participant').slice(0, 80) }] : []
      })
      const participantNames = participants.map((participant: any) =>
        this.state.graph.entities.find(entity => entity.id === participant.entityId)?.canonicalName || '').filter(Boolean)
      const id = crypto.createHash('sha256').update(`${String(item.eventType || 'other')}|${title}|${String(item.startAt || '')}|${evidence[0].messageId}`).digest('hex').slice(0, 24)
      return [{
        id, eventType: String(item.eventType || 'other').slice(0, 80), title,
        description: String(item.description || '').slice(0, 1200),
        startAt: String(item.startAt || ''), endAt: String(item.endAt || ''), location: String(item.location || '').slice(0, 200),
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.6))),
        status: 'candidate', searchText: `${title} ${String(item.description || '')} ${participantNames.join(' ')}`.trim(),
        participants, evidence, createdAt: now
      }]
    })
    personalMemoryStore.upsertClaims(claims)
    personalMemoryStore.upsertEvents(events)
  }

  private enqueueIdentityCandidates(entity: GraphEntity, now: string): void {
    if (entity.type !== 'person') return
    if (this.state.graph.identityScan.lastRunAt !== now) this.state.graph.identityScan.lastCandidateCount = 0
    for (const candidate of this.state.graph.entities) {
      if (this.enqueueIdentityPair(entity, candidate, now)) this.state.graph.identityScan.lastCandidateCount += 1
    }
    entity.lastDisambiguatedAt = now
    this.state.graph.identityScan.lastRunAt = now
    this.state.graph.identityScan.lastMode = 'incremental'
  }

  private enqueueIdentityPair(
    left: GraphEntity,
    right: GraphEntity,
    now: string,
    suggestion?: { source: string; detail: string; confidence: number; label?: string; value?: string }
  ): boolean {
    const assessment = assessIdentityPair(left, right)
    if (!assessment.eligible && (!suggestion || suggestion.confidence < 0.65)) return false
    const decision = personalMemoryStore.getIdentityDecision(left.id, right.id)
    if (isNegativeDecisionCurrent(decision, left, right)) return false
    const id = crypto.createHash('sha256').update(identityPairKey(left.id, right.id)).digest('hex').slice(0, 20)
    const existing = this.state.graph.reviewQueue.find(review => review.id === id)
    if (existing?.status === 'pending') return false
    const signals = assessment.signals.map(signal => ({ source: signal.source, label: signal.label, value: signal.value }))
    if (suggestion?.label && !signals.some(signal => signal.source === suggestion.source)) {
      signals.push({ source: suggestion.source as any, label: suggestion.label, value: suggestion.value || '' })
    }
    const candidateReview = {
      id,
      kind: 'possible_duplicate',
      title: `${left.canonicalName} ↔ ${right.canonicalName}`,
      detail: suggestion?.detail || signals.map(signal => `${signal.label}“${signal.value}”`).join('；') + '，需人工确认是否为同一人。',
      confidence: Math.max(assessment.confidence, suggestion?.confidence || 0),
      status: 'pending',
      createdAt: now,
      leftEntityId: left.id,
      rightEntityId: right.id,
      candidateSource: suggestion?.source || signals[0]?.source || 'rule',
      candidateSignals: signals
    } as const
    if (existing) Object.assign(existing, candidateReview)
    else this.state.graph.reviewQueue.push(candidateReview)
    return true
  }

  private runScheduledIdentityScan(now: string): void {
    const schedule = getFullIdentityScanSchedule(
      this.state.graph.entities.length,
      this.state.graph.identityScan.lastFullScanAt,
      new Date(now)
    )
    if (!schedule.due) return
    const people = this.state.graph.entities.filter(entity => entity.type === 'person')
    const byId = new Map(people.map(entity => [entity.id, entity]))
    const pairKeys = new Set<string>()
    for (const ids of buildNameBuckets(people).values()) {
      for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
          pairKeys.add(identityPairKey(ids[leftIndex], ids[rightIndex]))
        }
      }
    }
    let candidates = 0
    for (const pairKey of pairKeys) {
      const [leftId, rightId] = pairKey.split('|')
      const left = byId.get(leftId)
      const right = byId.get(rightId)
      if (left && right && this.enqueueIdentityPair(left, right, now)) candidates += 1
    }
    this.state.graph.identityScan = {
      lastFullScanAt: now,
      lastRunAt: now,
      lastMode: 'full',
      lastCandidateCount: (this.state.graph.identityScan.lastRunAt === now
        ? this.state.graph.identityScan.lastCandidateCount
        : 0) + candidates
    }
  }

  private runContextualIdentityScan(now: string): void {
    const people = this.state.graph.entities.filter(entity => entity.type === 'person')
    const byId = new Map(people.map(entity => [entity.id, entity]))
    const suggestions = buildGraphIdentitySuggestions(people, this.state.graph.relations)
    for (const pair of personalMemoryStore.listSimilarEntityPairs(localEmbeddingService.modelVersion, 0.88, 200)) {
      if (!byId.has(pair.leftId) || !byId.has(pair.rightId)) continue
      suggestions.push({
        leftId: pair.leftId,
        rightId: pair.rightId,
        source: 'vector_similarity',
        label: '档案语义相似',
        value: `${Math.round(pair.score * 100)}%`,
        detail: `两个人物档案的本地向量相似度为 ${Math.round(pair.score * 100)}%，可能是同一人的不同账号，需人工确认。`,
        confidence: Math.min(0.92, pair.score)
      })
    }
    let candidates = 0
    for (const suggestion of suggestions) {
      const left = byId.get(suggestion.leftId)
      const right = byId.get(suggestion.rightId)
      if (left && right && this.enqueueIdentityPair(left, right, now, suggestion)) candidates += 1
    }
    this.state.graph.identityScan.lastCandidateCount += candidates
  }

  private async syncLocalDocuments(): Promise<{ indexed: number; error?: string }> {
    const source = personalMemoryStore.listDataSources().find(item => item.id === 'documents')
    if (!source?.enabled || !source.available || !source.config?.folderPath) return { indexed: 0 }
    const attemptedAt = new Date().toISOString()
    personalMemoryStore.updateDataSourceRun('documents', { status: 'running', attemptedAt })
    let checkpoint = String(source.checkpoint || '')
    let indexed = 0
    const warnings: string[] = []
    try {
      const connector = new LocalDocumentDataSource(source.config.folderPath)
      for (let page = 0; page < 5; page += 1) {
        const result = await runPersonalDataSourceBatch(
          connector,
          checkpoint,
          async items => {
            const updatedAt = new Date().toISOString()
            personalMemoryStore.upsertResources(items.map(item => {
              const metadata = item.metadata || {}
              const contentHash = String(metadata.contentHash || '')
              return {
                id: `local-document:${item.externalId}`,
                resourceType: 'document',
                title: item.title,
                fileName: item.title,
                fileExt: String(metadata.extension || ''),
                content: item.content,
                metadata: {
                  ...metadata,
                  sourceId: item.sourceId,
                  scopeId: item.scopeId || '',
                  scopeName: item.scopeName || '',
                  sessionName: item.scopeName || '本机文档',
                  senderName: '本机文档连接器'
                },
                createdAt: item.occurredAt,
                updatedAt,
                evidence: [{
                  sourceId: item.sourceId,
                  messageId: `${item.externalId}:${contentHash.slice(0, 16)}`,
                  sessionId: `data-source:${item.sourceId}`,
                  timestamp: Math.floor(Date.parse(item.occurredAt) / 1000),
                  sender: '本机文档连接器',
                  excerpt: String(item.content || item.title).slice(0, 2000)
                }]
              }
            }))
          },
          { limit: 10 }
        )
        checkpoint = result.checkpoint
        indexed += result.pulled
        warnings.push(...result.warnings)
        personalMemoryStore.updateDataSourceRun('documents', {
          status: 'running',
          checkpoint,
          attemptedAt
        })
        if (!result.hasMore) break
      }
      const warning = warnings[0] ? `仍有 ${warnings.length} 个文档等待重试：${warnings[0]}` : ''
      personalMemoryStore.updateDataSourceRun('documents', {
        status: warning ? 'error' : 'healthy',
        checkpoint,
        succeededAt: new Date().toISOString(),
        error: warning
      })
      return { indexed, error: warning || undefined }
    } catch (error) {
      const message = sanitizeDiagnosticText(error)
      personalMemoryStore.updateDataSourceRun('documents', {
        status: 'error',
        attemptedAt,
        error: message
      })
      return { indexed, error: message }
    }
  }

  private async syncLocalCalendar(): Promise<{ indexed: number; error?: string }> {
    const source = personalMemoryStore.listDataSources().find(item => item.id === 'calendar')
    const calendarIds = Array.isArray(source?.config?.calendarIds)
      ? source.config.calendarIds.map(String).filter(Boolean)
      : []
    if (!source?.enabled || !source.available || !calendarIds.length) return { indexed: 0 }
    const attemptedAt = new Date().toISOString()
    personalMemoryStore.updateDataSourceRun('calendar', { status: 'running', attemptedAt })
    let checkpoint = String(source.checkpoint || '')
    let indexed = 0
    try {
      const authorization = await localCalendarService.getStatus()
      if (!['fullAccess', 'authorized'].includes(authorization.authorization)) {
        throw new Error('日历读取权限已失效；请在数据源连接器中重新授权')
      }
      const connector = new LocalCalendarDataSource(calendarIds)
      for (let page = 0; page < 5; page += 1) {
        const result = await runPersonalDataSourceBatch(
          connector,
          checkpoint,
          async items => {
            const updatedAt = new Date().toISOString()
            const identityMapping = mapCalendarParticipantIdentities(
              items,
              this.state.graph.entities,
              updatedAt
            )
            if (identityMapping.changed || identityMapping.duplicateSuggestions.length) {
              const graphBeforeCalendarIdentity = structuredClone(this.state.graph)
              try {
                this.state.graph.entities = identityMapping.entities as GraphEntity[]
                for (const suggestion of identityMapping.duplicateSuggestions) {
                  const left = this.state.graph.entities.find(entity => entity.id === suggestion.leftEntityId)
                  const right = this.state.graph.entities.find(entity => entity.id === suggestion.rightEntityId)
                  if (left && right && this.enqueueIdentityPair(left, right, updatedAt, {
                    source: 'calendar_name_match',
                    label: '日历显示名相同',
                    value: suggestion.name,
                    detail: `日历邮箱身份“${left.canonicalName}”与已有实体“${right.canonicalName}”显示名相同，但邮箱与微信身份不能据此自动合并。`,
                    confidence: 0.75
                  })) {
                    this.state.graph.identityScan.lastCandidateCount += 1
                  }
                }
                this.checkpointGraphToSql()
                this.saveState()
              } catch (error) {
                this.state.graph = graphBeforeCalendarIdentity
                throw error
              }
            }
            const resources = items.map(item => {
              const metadata: any = item.metadata || {}
              const contentHash = String(metadata.contentHash || '')
              const messageId = `${item.externalId}:${contentHash.slice(0, 16)}`
              return {
                id: `calendar-event:${item.externalId}`,
                resourceType: 'calendar-event',
                title: item.title,
                url: String(metadata.url || ''),
                content: item.content,
                metadata: {
                  ...metadata,
                  sourceId: item.sourceId,
                  scopeId: item.scopeId || '',
                  scopeName: item.scopeName || '',
                  sessionName: item.scopeName || 'macOS 日历',
                  senderName: 'macOS 日历连接器'
                },
                createdAt: item.occurredAt,
                updatedAt,
                evidence: [{
                  sourceId: item.sourceId,
                  messageId,
                  sessionId: `data-source:${item.sourceId}:${item.scopeId || 'calendar'}`,
                  timestamp: Math.floor(Date.parse(item.occurredAt) / 1000),
                  sender: 'macOS 日历连接器',
                  excerpt: String(item.content || item.title).slice(0, 2000)
                }]
              }
            })
            const events = items.map(item => {
              const metadata: any = item.metadata || {}
              const contentHash = String(metadata.contentHash || '')
              return {
                id: `calendar-${item.externalId}`,
                eventType: 'calendar',
                title: item.title,
                description: item.content,
                startAt: String(metadata.startAt || item.occurredAt),
                endAt: String(metadata.endAt || ''),
                location: String(metadata.location || ''),
                confidence: 1,
                status: metadata.deleted ? 'cancelled' : 'confirmed',
                participants: identityMapping.participantsByEventId.get(item.externalId) || [],
                searchText: [
                  item.title, item.content, item.scopeName,
                  ...(item.participants || []).flatMap(value => [value.name, value.id])
                ].filter(Boolean).join('；'),
                createdAt: item.occurredAt,
                evidence: [{
                  sourceId: item.sourceId,
                  messageId: `${item.externalId}:${contentHash.slice(0, 16)}`,
                  sessionId: `data-source:${item.sourceId}:${item.scopeId || 'calendar'}`,
                  timestamp: Math.floor(Date.parse(item.occurredAt) / 1000),
                  excerpt: String(item.content || item.title).slice(0, 2000),
                  role: 'direct'
                }]
              }
            })
            personalMemoryStore.upsertResources(resources)
            personalMemoryStore.upsertEvents(events)
          },
          { limit: 100 }
        )
        checkpoint = result.checkpoint
        indexed += result.pulled
        personalMemoryStore.updateDataSourceRun('calendar', {
          status: 'running',
          checkpoint,
          attemptedAt
        })
        if (!result.hasMore) break
      }
      personalMemoryStore.updateDataSourceRun('calendar', {
        status: 'healthy',
        checkpoint,
        succeededAt: new Date().toISOString(),
        error: ''
      })
      return { indexed }
    } catch (error) {
      const message = sanitizeDiagnosticText(error)
      personalMemoryStore.updateDataSourceRun('calendar', {
        status: 'error',
        attemptedAt,
        error: message
      })
      return { indexed, error: message }
    }
  }

  private async syncLocalMail(): Promise<{ indexed: number; error?: string }> {
    const source = personalMemoryStore.listDataSources().find(item => item.id === 'mail')
    const mailboxIds = Array.isArray(source?.config?.mailboxIds)
      ? source.config.mailboxIds.map(String).filter(Boolean)
      : []
    if (!source?.enabled || !source.available || !mailboxIds.length) return { indexed: 0 }
    const attemptedAt = new Date().toISOString()
    personalMemoryStore.updateDataSourceRun('mail', { status: 'running', attemptedAt })
    let checkpoint = String(source.checkpoint || '')
    let indexed = 0
    try {
      const authorization = await localMailService.getStatus()
      if (!['authorized', 'mailNotRunning'].includes(authorization.authorization)) {
        throw new Error('Mail 只读权限当前不可用；请在数据源连接器中重新授权，并保持 Mail 可启动')
      }
      const connector = new LocalMailDataSource(mailboxIds)
      for (let page = 0; page < 5; page += 1) {
        const result = await runPersonalDataSourceBatch(
          connector,
          checkpoint,
          async items => {
            const updatedAt = new Date().toISOString()
            personalMemoryStore.upsertResources(items.map(item => {
              const metadata: any = item.metadata || {}
              const contentHash = String(metadata.contentHash || '')
              return {
                id: `mail-message:${item.externalId}`,
                resourceType: 'email',
                title: item.title,
                content: item.content,
                metadata: {
                  ...metadata,
                  sourceId: item.sourceId,
                  scopeId: item.scopeId || '',
                  scopeName: item.scopeName || '',
                  sessionName: item.scopeName || 'macOS Mail',
                  senderName: String(metadata.sender || 'macOS Mail 连接器'),
                  modelAnalysisAllowed: Boolean(source.config?.allowModelAnalysis)
                },
                createdAt: item.occurredAt,
                updatedAt,
                evidence: [{
                  sourceId: item.sourceId,
                  messageId: `${item.externalId}:${contentHash.slice(0, 16)}`,
                  sessionId: `data-source:${item.sourceId}:${item.scopeId || 'mailbox'}`,
                  timestamp: Math.floor(Date.parse(item.occurredAt) / 1000),
                  sender: String(metadata.sender || 'macOS Mail 连接器'),
                  excerpt: String(item.content || item.title).slice(0, 2000)
                }]
              }
            }))
          },
          { limit: 50 }
        )
        checkpoint = result.checkpoint
        indexed += result.pulled
        personalMemoryStore.updateDataSourceRun('mail', {
          status: 'running',
          checkpoint,
          attemptedAt
        })
        if (!result.hasMore) break
      }
      personalMemoryStore.updateDataSourceRun('mail', {
        status: 'healthy',
        checkpoint,
        succeededAt: new Date().toISOString(),
        error: ''
      })
      return { indexed }
    } catch (error) {
      const message = sanitizeDiagnosticText(error)
      personalMemoryStore.updateDataSourceRun('mail', {
        status: 'error',
        attemptedAt,
        error: message
      })
      return { indexed, error: message }
    }
  }

  private mergeRecoveredWechatTasks(digest: any, messages: any[], createdAt: string): number {
    const existing = new Map(this.state.tasks.map(task => [task.id, task]))
    let saved = 0
    for (const item of Array.isArray(digest.tasks) ? digest.tasks : []) {
      const sourceMessageIds = Array.isArray(item.sourceEvidenceKeys)
        ? item.sourceEvidenceKeys.map(String).slice(0, 20)
        : []
      const evidenceMessages = Array.isArray(item.__evidenceMessages) ? item.__evidenceMessages : []
      const assignment = classifyTaskAssignment({
        evidenceMessages,
        modelClassification: item.classification,
        modelTaskKind: item.taskKind
      })
      if (!assignment.keep) continue
      const taskKind = assignment.taskKind
      const task: AssistantTask = {
        id: stableTaskId(item),
        title: String(item.title || '待确认事项').slice(0, 160),
        detail: String(item.detail || '').slice(0, 500),
        owner: String(item.owner || '我').slice(0, 50),
        collaborators: (Array.isArray(item.collaborators) ? item.collaborators : [])
          .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20),
        project: String(item.project || '').trim().slice(0, 160),
        dependsOnIds: [],
        taskKind,
        due: String(item.due || '').slice(0, 40),
        priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
        source: String(item.source || '').slice(0, 100),
        sourceSessionId: String(evidenceMessages[0]?.sessionId || ''),
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
        status: taskKind === 'waiting' ? 'waiting' : 'todo',
        classification: assignment.classification,
        assignmentEvidence: String(item.assignmentEvidence || '').slice(0, 300),
        ownershipPolicyReason: assignment.rationale,
        sourceMessageIds,
        evidence: evidenceMessages.map((message: any) => ({
          sourceId: String(message.sourceId || 'wechat'),
          sessionId: String(message.sessionId || ''),
          messageId: structuredEvidenceKey(message),
          timestamp: Number(message.timestamp),
          sender: message.direction === '我发送' ? '我' : String(message.senderName || message.senderId || '对方'),
          excerpt: redact(String(message.content)).slice(0, 300)
        }))
      }
      const feedbackFingerprint = taskEvidenceFingerprint(task)
      const reviewedTask = applyTaskReviewFeedback(
        task,
        feedbackFingerprint ? personalMemoryStore.getTaskReviewDecision(feedbackFingerprint) : null
      )
      if (!reviewedTask) {
        personalMemoryStore.recordTaskReviewSuppression(feedbackFingerprint)
        continue
      }
      Object.assign(task, reviewedTask)
      const previous = existing.get(task.id) || findMatchingTask(task, this.state.tasks)
      if (previous) task.id = previous.id
      const merged: AssistantTask = previous ? {
        ...task,
        status: previous.status,
        owner: previous.owner || task.owner,
        collaborators: previous.collaborators || task.collaborators,
        project: previous.project || task.project,
        dependsOnIds: previous.dependsOnIds || task.dependsOnIds,
        taskKind: previous.taskKind || task.taskKind,
        evidence: [...(previous.evidence || []), ...(task.evidence || [])]
          .filter((value, index, rows) => rows.findIndex(candidate => candidate.messageId === value.messageId) === index)
          .slice(-50),
        createdAt: previous.createdAt,
        updatedAt: createdAt
      } : { ...task, createdAt, updatedAt: createdAt }
      existing.set(merged.id, merged)
      personalMemoryStore.recordTaskChanges(
        merged.id,
        previous || {},
        merged,
        previous ? 'replayed_ingestion_batch' : 'recovered_from_ingestion_batch',
        merged.evidence || []
      )
      saved += 1
    }
    this.state.tasks = [...existing.values()].sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)))
    return saved
  }

  private persistDocumentTasks(digest: any, messages: any[], createdAt: string): number {
    const ownerTerms = [
      String(this.config.get('aiAssistantOwnerName') || ''),
      ...String(this.config.get('aiAssistantOwnerAliases') || '').split(/[,，、\n]/)
    ].map(value => value.trim().toLowerCase()).filter(Boolean)
    const existing = new Map(this.state.tasks.map(task => [task.id, task]))
    let saved = 0
    for (const item of Array.isArray(digest.tasks) ? digest.tasks : []) {
      const sourceMessageIds = (Array.isArray(item.sourceEvidenceKeys)
        ? item.sourceEvidenceKeys
        : Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds : [])
        .map(String).slice(0, 20)
      const evidenceMessages = Array.isArray(item.__evidenceMessages)
        ? item.__evidenceMessages
        : messages.filter(message =>
          sourceMessageIds.includes(String(message.id)) ||
          sourceMessageIds.includes(structuredEvidenceKey(message)))
      if (!evidenceMessages.length) continue
      const evidenceText = evidenceMessages.map(message => String(message.content || '')).join('\n')
      const classification = classifyDocumentTaskOwnership(
        String(item.classification || ''),
        evidenceText,
        ownerTerms
      )
      if (classification === 'others') continue
      const task: AssistantTask = {
        id: stableTaskId({ ...item, source: `本机文档：${evidenceMessages[0].sessionName}`, sourceMessageIds }),
        title: String(item.title || '文档待确认事项').slice(0, 160),
        detail: String(item.detail || '').slice(0, 500),
        owner: classification === 'mine'
          ? String(item.owner || this.config.get('aiAssistantOwnerName') || '我').slice(0, 80)
          : String(item.owner || '待确认').slice(0, 80),
        collaborators: (Array.isArray(item.collaborators) ? item.collaborators : [])
          .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20),
        project: String(item.project || '').trim().slice(0, 160),
        dependsOnIds: [],
        taskKind: ['action', 'delegated', 'waiting'].includes(item.taskKind) ? item.taskKind : 'action',
        due: String(item.due || '').slice(0, 40),
        priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
        source: `本机文档：${evidenceMessages[0].sessionName}`.slice(0, 100),
        sourceSessionId: 'data-source:documents',
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.6))),
        status: item.taskKind === 'waiting' ? 'waiting' : 'todo',
        classification,
        assignmentEvidence: String(item.assignmentEvidence || '').slice(0, 300),
        ownershipPolicyReason: classification === 'mine'
          ? '文档正文明确出现用户姓名或别名，仍保留原文证据'
          : '文档没有明确把事项指派给用户，进入人工归属确认',
        sourceMessageIds,
        evidence: evidenceMessages.map(message => ({
          sourceId: 'documents',
          sessionId: 'data-source:documents',
          messageId: String(message.id),
          timestamp: Number(message.timestamp),
          sender: String(message.senderName || '本机文档连接器'),
          excerpt: redact(String(message.content)).slice(0, 300)
        }))
      }
      const feedbackFingerprint = taskEvidenceFingerprint(task)
      const feedback = feedbackFingerprint
        ? personalMemoryStore.getTaskReviewDecision(feedbackFingerprint)
        : null
      const reviewedTask = applyTaskReviewFeedback(task, feedback)
      if (!reviewedTask) {
        personalMemoryStore.recordTaskReviewSuppression(feedbackFingerprint)
        continue
      }
      Object.assign(task, reviewedTask)
      const previous = existing.get(task.id) || findMatchingTask(task, this.state.tasks)
      if (previous) task.id = previous.id
      const merged: AssistantTask = previous ? {
        ...task,
        status: previous.status,
        owner: previous.owner || task.owner,
        classification: previous.classification || task.classification,
        evidence: [...(previous.evidence || []), ...(task.evidence || [])]
          .filter((item, index, rows) => rows.findIndex(candidate => candidate.messageId === item.messageId) === index)
          .slice(-50),
        createdAt: previous.createdAt,
        updatedAt: createdAt
      } : { ...task, createdAt, updatedAt: createdAt }
      existing.set(merged.id, merged)
      personalMemoryStore.recordTaskChanges(
        merged.id,
        previous || {},
        merged,
        previous ? 'document_content_update' : 'created_from_document',
        merged.evidence || []
      )
      saved += 1
    }
    this.state.tasks = [...existing.values()].sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)))
    return saved
  }

  private async processPendingDocumentAnalysis(): Promise<{
    completed: number
    failed: number
    tasks: number
  }> {
    if (!String(this.config.get('aiAssistantApiKey') || '').trim()) {
      return { completed: 0, failed: 0, tasks: 0 }
    }
    const source = personalMemoryStore.listDataSources().find(item => item.id === 'documents')
    if (!source?.enabled || !source.available) return { completed: 0, failed: 0, tasks: 0 }
    const pending = personalMemoryStore.listPendingDocumentAnalysis(DOCUMENT_ANALYSIS_VERSION, 2)
    let completed = 0
    let failed = 0
    let tasks = 0
    for (const resource of pending) {
      const attempts = Number(resource.metadata?.documentAnalysisAttempts || 0)
      const evidence = resource.evidence?.[0]
      const message = {
        id: String(evidence?.message_id || `${resource.id}:${resource.metadata?.contentHash || ''}`),
        sourceId: 'documents',
        sourceKind: 'document',
        sessionId: 'data-source:documents',
        sessionName: String(resource.metadata?.scopeName || resource.file_name || '本机文档'),
        timestamp: Number(evidence?.timestamp || Math.floor(Date.parse(resource.updated_at) / 1000)),
        direction: '资料来源',
        senderId: 'local-document-connector',
        senderName: String(resource.file_name || resource.title || '本机文档'),
        senderIdentity: { displayName: '本机文档连接器' },
        isGroup: false,
        semanticType: 'document',
        analysisScope: 'core',
        content: `[本机文档：${resource.file_name || resource.title}]\n${String(resource.content || '')}`.slice(0, 18_000)
      }
      const runId = `doc_run_${crypto.randomUUID()}`
      const startedAt = Date.now()
      const createdAt = new Date().toISOString()
      personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
        documentAnalysisStatus: 'running',
        documentAnalysisAttempts: attempts + 1,
        documentAnalysisLastAttemptAt: createdAt
      })
      personalMemoryStore.startIngestionRun(
        runId,
        String(this.config.get('aiAssistantApiModel') || ''),
        DOCUMENT_ANALYSIS_VERSION
      )
      personalMemoryStore.recordIngestionBatch(runId, 0, 1, 'running', '', {
        model: String(this.config.get('aiAssistantApiModel') || ''),
        promptVersion: `${EXTRACTION_PROMPT_VERSION}/document-v1`,
        schemaVersion: EXTRACTION_SCHEMA_VERSION
      })
      try {
        const rawDigest = await this.callAi([message])
        const evidenceValidation = validateStructuredDigestEvidence(rawDigest, [message])
        const digest = {
          ...evidenceValidation.digest,
          __meta: {
            ...rawDigest.__meta,
            structuredEvidence: {
              version: 'structured-evidence-v1',
              accepted: evidenceValidation.accepted,
              rejected: evidenceValidation.rejected
            }
          }
        }
        const checkpointKeys = [messageKey(message)]
        const commitId = this.ingestionCommitId(runId, 0, checkpointKeys)
        personalMemoryStore.prepareIngestionBatchCommit({
          commitId,
          runId,
          batchIndex: 0,
          digest,
          messages: [message],
          checkpointKeys,
          createdAt,
          sourceKind: 'document',
          resourceId: resource.id,
          resourceContentHash: String(resource.metadata?.contentHash || ''),
          completion: {
            documentAnalysisStatus: 'completed',
            documentAnalysisVersion: DOCUMENT_ANALYSIS_VERSION,
            documentAnalysisContentHash: resource.metadata?.contentHash || '',
            documentAnalysisCompletedAt: new Date().toISOString(),
            documentAnalysisNextAt: '',
            documentAnalysisError: ''
          }
        })
        const tempIds = this.mergeGraphDigest(digest, [message], createdAt, commitId)
        this.checkpointGraphToSql()
        this.persistClaimsAndEvents(digest, tempIds, [message], createdAt)
        tasks += this.persistDocumentTasks(digest, [message], createdAt)
        this.saveState(true)
        personalMemoryStore.finalizeIngestionBatchCommit(commitId, {
          ...digest.__meta,
          promptVersion: `${EXTRACTION_PROMPT_VERSION}/document-v1`,
          durationMs: Number(digest.__meta?.durationMs || Date.now() - startedAt)
        })
        personalMemoryStore.finishIngestionRun(runId, {
          status: 'completed',
          messageCount: 1,
          entityCount: this.state.graph.entities.length,
          relationCount: this.state.graph.relations.length
        })
        completed += 1
      } catch (error) {
        const detail = sanitizeDiagnosticText(error)
        const retryDays = Math.min(7, Math.max(1, 2 ** attempts))
        personalMemoryStore.replaceResourceContent(resource.id, resource.content, {
          documentAnalysisStatus: 'failed',
          documentAnalysisError: detail,
          documentAnalysisNextAt: new Date(Date.now() + retryDays * 86_400_000).toISOString()
        })
        personalMemoryStore.recordIngestionBatch(runId, 0, 1, 'failed', detail, {
          model: String(this.config.get('aiAssistantApiModel') || ''),
          promptVersion: `${EXTRACTION_PROMPT_VERSION}/document-v1`,
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          durationMs: Date.now() - startedAt
        })
        personalMemoryStore.finishIngestionRun(runId, {
          status: 'failed',
          messageCount: 0,
          entityCount: this.state.graph.entities.length,
          relationCount: this.state.graph.relations.length,
          error: detail
        })
        failed += 1
      }
    }
    return { completed, failed, tasks }
  }

  async sync(trigger: 'manual' | 'startup' | 'daily' | 'backlog' | 'resume' = 'manual'): Promise<any> {
    if (this.activeSync) return this.activeSync
    this.cancelRequested = false
    if (trigger !== 'backlog' && this.state.cursor.backlogRetry.paused) {
      this.state.cursor.backlogRetry = {
        ...this.state.cursor.backlogRetry,
        paused: false
      }
      this.saveState()
    }
    this.activeSyncTrigger = trigger
    this.activeSync = this.runSync()
    try {
      const result = await this.activeSync
      if (shouldReconcileScheduledSync(trigger, this.state.cursor)) {
        const scheduledDate = pendingScheduledDate(this.state.cursor)
        const observedAt = new Date().toISOString()
        const assessment = assessScheduledSyncResult(result)
        this.state.cursor.lastScheduledAttemptAt = observedAt
        Object.assign(this.state.cursor, planScheduledSyncState(
          this.state.cursor,
          {
            ...assessment,
            reason: assessment.complete ? '' : sanitizeDiagnosticText(assessment.reason)
          },
          scheduledDate,
          observedAt
        ))
        this.saveState()
      }
      if (trigger === 'resume' || this.state.cursor.resumeCatchupRetry.pendingSince) {
        const observedAt = new Date().toISOString()
        const assessment = assessScheduledSyncResult(result)
        this.state.cursor.resumeCatchupRetry = planResumeCatchupRetry(
          this.state.cursor.resumeCatchupRetry,
          {
            ...assessment,
            reason: assessment.complete ? '' : sanitizeDiagnosticText(assessment.reason)
          },
          observedAt
        )
        this.saveState()
      }
      this.maybeCreateAutomaticMemoryBackup(result)
      return result
    } catch (error) {
      if (shouldReconcileScheduledSync(trigger, this.state.cursor)) {
        const scheduledDate = pendingScheduledDate(this.state.cursor)
        const observedAt = new Date().toISOString()
        this.state.cursor.lastScheduledAttemptAt = observedAt
        Object.assign(this.state.cursor, planScheduledSyncState(
          this.state.cursor,
          { complete: false, reason: sanitizeDiagnosticText(error) },
          scheduledDate,
          observedAt
        ))
        this.saveState()
      }
      if (trigger === 'resume' || this.state.cursor.resumeCatchupRetry.pendingSince) {
        const observedAt = new Date().toISOString()
        this.state.cursor.resumeCatchupRetry = planResumeCatchupRetry(
          this.state.cursor.resumeCatchupRetry,
          { complete: false, reason: sanitizeDiagnosticText(error) },
          observedAt
        )
        this.saveState()
      }
      throw error
    } finally {
      this.activeSync = null
      this.activeSyncTrigger = null
      this.cancelRequested = false
    }
  }

  private maybeCreateAutomaticMemoryBackup(result: any): void {
    const now = new Date()
    const policy = shouldCreateAutomaticMemoryBackup(result, this.state.cursor, now.getTime())
    if (!policy.create) return
    this.state.cursor.lastAutomaticBackupAttemptAt = now.toISOString()
    this.saveState()
    try {
      const backup = this.createMemoryBackup()
      const completedAt = new Date().toISOString()
      this.state.cursor.lastAutomaticBackupDate = policy.date
      this.state.cursor.lastAutomaticBackupAt = completedAt
      this.state.cursor.lastAutomaticBackupError = null
      this.saveState()
      // Make the joint snapshot self-describing: restoring it must retain the
      // successful automatic-backup marker instead of immediately duplicating it.
      writeEncryptedDurableJson(
        `${backup.path}.state.json`,
        this.state,
        this.stateEncryptionKey
      )
    } catch (error) {
      this.state.cursor.lastAutomaticBackupError = sanitizeDiagnosticText(error)
      this.saveState()
    }
  }

  private async runSync(): Promise<any> {
    const mailSync = await this.syncLocalMail()
    const calendarSync = await this.syncLocalCalendar()
    const documentSync = await this.syncLocalDocuments()
    const documentAnalysis = await this.processPendingDocumentAnalysis()
    const auxiliaryErrors = [
      documentSync.error,
      calendarSync.error,
      mailSync.error
    ].map(value => String(value || '').trim()).filter(Boolean)
    const wechatSource = personalMemoryStore.listDataSources().find(source => source.id === 'wechat')
    if (wechatSource && !wechatSource.enabled) {
      return {
        success: auxiliaryErrors.length === 0,
        partial: auxiliaryErrors.length > 0,
        cancelled: false,
        newMessageCount: 0,
        newTaskCount: 0,
        failedSessions: 0,
        indexedDocumentCount: documentSync.indexed,
        indexedCalendarEventCount: calendarSync.indexed,
        indexedMailMessageCount: mailSync.indexed,
        analyzedDocumentCount: documentAnalysis.completed,
        newDocumentTaskCount: documentAnalysis.tasks,
        documentSourceError: documentSync.error || null,
        calendarSourceError: calendarSync.error || null,
        mailSourceError: mailSync.error || null,
        message: documentSync.error || calendarSync.error || mailSync.error
          ? `微信数据源已暂停；其他数据源需要重试：${documentSync.error || calendarSync.error || mailSync.error}`
          : '微信数据源已暂停；增量游标保持不变'
      }
    }
    const runId = `run_${crypto.randomUUID()}`
    let runFinished = false
    let cancelled = false
    const previousSessionOffsets = { ...this.state.cursor.sessionOffsets }
    this.state.cursor.lastAttemptAt = new Date().toISOString()
    personalMemoryStore.updateDataSourceRun('wechat', {
      status: 'running',
      attemptedAt: this.state.cursor.lastAttemptAt
    })
    this.saveState()
    personalMemoryStore.startIngestionRun(
      runId,
      String(this.config.get('aiAssistantApiModel') || ''),
      `${EXTRACTION_PROMPT_VERSION}/${EXTRACTION_SCHEMA_VERSION}`
    )
    const now = Math.floor(Date.now() / 1000)
    const lookbackDays = Number(this.config.get('aiAssistantInitialLookbackDays')) || 3
    const start = this.state.cursor.lastMessageTimestamp
      ? Math.max(0, this.state.cursor.lastMessageTimestamp - 300)
      : now - lookbackDays * 86_400
    try {
      const collected = await this.collectMessages(start, now)
      const seen = new Set(this.state.cursor.recentMessageIds)
      const durableSeen = personalMemoryStore.getProcessedIngestionMessageKeys(
        collected.messages.map(messageKey)
      )
      const fresh = collected.messages.filter(message => {
        const key = messageKey(message)
        return !seen.has(key) && !durableSeen.has(key)
      })
      const freshKeys = new Set(fresh.map(messageKey))
      const forcedContextKeys = new Set(collected.messages
        .filter(message => !freshKeys.has(messageKey(message)))
        .map(messageKey))
      const digests: Array<{ digest: any; batch: any[] }> = []
      const createdAt = new Date().toISOString()
      await this.continuePendingPdfOcr()
      this.persistMessageResources(fresh, createdAt)
      await this.continuePendingImageSemantics()
      await this.continuePendingAttachmentStructures()
      const successfulMessageKeys: string[] = []
      const batchErrors: string[] = []
      const batches = this.buildAnalysisBatches(
        collected.messages,
        forcedContextKeys
      )
      const batchQueue = batches.map(batch => ({
        batch,
        splitDepth: 0,
        wasAdaptivelySplit: false,
        probeMeta: accumulateExtractionAttemptMeta()
      }))
      let batchIndex = 0
      while (batchQueue.length) {
        if (this.cancelRequested) {
          cancelled = true
          batchErrors.push('用户已安全暂停，未开始的批次将在下次继续')
          break
        }
        const work = batchQueue.shift()!
        const batch = work.batch
        const batchStartedAt = Date.now()
        try {
          const rawDigest = await this.callAi(batch)
          const coverage = inspectExtractionCoverage(rawDigest)
          const splitBatches = coverage.saturated && work.splitDepth < 2
            ? splitSaturatedAnalysisBatch(batch, { messageKey, minimumCoreSize: 25 })
            : []
          if (splitBatches.length > 1) {
            const probeMeta = accumulateExtractionAttemptMeta(work.probeMeta, rawDigest.__meta)
            batchQueue.unshift(...splitBatches.map((splitBatch, index) => ({
              batch: splitBatch,
              splitDepth: work.splitDepth + 1,
              wasAdaptivelySplit: true,
              probeMeta: index === 0 ? probeMeta : accumulateExtractionAttemptMeta()
            })))
            continue
          }
          personalMemoryStore.recordIngestionBatch(runId, batchIndex, batch.length, 'running', '', {
            model: String(this.config.get('aiAssistantApiModel') || ''),
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION
          })
          const evidenceValidation = validateStructuredDigestEvidence(rawDigest, batch)
          const aggregateMeta = accumulateExtractionAttemptMeta(work.probeMeta, rawDigest.__meta)
          const digest = {
            ...evidenceValidation.digest,
            __meta: {
              ...rawDigest.__meta,
              inputTokens: aggregateMeta.inputTokens,
              outputTokens: aggregateMeta.outputTokens,
              durationMs: aggregateMeta.durationMs,
              extractionAttempts: aggregateMeta.attempts,
              extractionCoverage: inspectExtractionCoverage(rawDigest, {
                adaptivelySplit: work.wasAdaptivelySplit,
                splitDepth: work.splitDepth,
                attempts: aggregateMeta.attempts,
                unresolved: coverage.saturated
              }),
              structuredEvidence: {
                version: 'structured-evidence-v1',
                accepted: evidenceValidation.accepted,
                rejected: evidenceValidation.rejected
              }
            }
          }
          const checkpointKeys = batch.filter(message => message.analysisScope === 'core').map(messageKey)
          const commitId = this.ingestionCommitId(runId, batchIndex, checkpointKeys)
          personalMemoryStore.prepareIngestionBatchCommit({
            commitId,
            runId,
            batchIndex,
            digest,
            messages: batch,
            checkpointKeys,
            createdAt
          })
          digests.push({ digest, batch })
          const tempIds = this.mergeGraphDigest(digest, batch, createdAt, commitId)
          this.checkpointGraphToSql()
          this.persistClaimsAndEvents(digest, tempIds, batch, createdAt)
          this.mergeRecoveredWechatTasks(digest, batch, createdAt)
          successfulMessageKeys.push(...checkpointKeys)
          this.state.cursor.recentMessageIds = [...new Set([...this.state.cursor.recentMessageIds, ...checkpointKeys])].slice(-20_000)
          this.saveState(true)
          personalMemoryStore.finalizeIngestionBatchCommit(commitId, {
            ...digest.__meta,
            durationMs: Number(digest.__meta?.durationMs || Date.now() - batchStartedAt)
          })
          if (this.cancelRequested) {
            cancelled = true
            batchErrors.push('用户已安全暂停，剩余批次将在下次继续')
            break
          }
          batchIndex += 1
        } catch (error: any) {
          const message = sanitizeDiagnosticText(error)
          batchErrors.push(message)
          personalMemoryStore.recordIngestionBatch(runId, batchIndex, batch.length, 'failed', message, {
            model: String(this.config.get('aiAssistantApiModel') || ''),
            promptVersion: EXTRACTION_PROMPT_VERSION,
            schemaVersion: EXTRACTION_SCHEMA_VERSION,
            durationMs: Date.now() - batchStartedAt
          })
          batchIndex += 1
        }
      }
      const tasks = new Map<string, AssistantTask>()
      const highlightItems: any[] = []
      const summaries: string[] = []
      const summaryEvidence: any[] = []
      let rejectedSummaryCount = 0
      let rejectedHighlightCount = 0
      for (const { digest, batch } of digests) {
        const groundedBriefing = groundBriefingDigest(digest, batch)
        highlightItems.push(...groundedBriefing.highlights)
        if (groundedBriefing.summary) summaries.push(groundedBriefing.summary)
        summaryEvidence.push(...groundedBriefing.summaryEvidence)
        if (groundedBriefing.rejectedSummary) rejectedSummaryCount += 1
        rejectedHighlightCount += groundedBriefing.rejectedHighlightCount
        for (const item of Array.isArray(digest.tasks) ? digest.tasks : []) {
          const sourceMessageIds = Array.isArray(item.sourceEvidenceKeys) ? item.sourceEvidenceKeys.map(String).slice(0, 20) : []
          const evidenceMessages = Array.isArray(item.__evidenceMessages) ? item.__evidenceMessages : []
          const assignment = classifyTaskAssignment({
            evidenceMessages,
            modelClassification: item.classification,
            modelTaskKind: item.taskKind
          })
          if (!assignment.keep) continue
          const taskKind = assignment.taskKind
          const task: AssistantTask = {
            id: stableTaskId(item),
            title: String(item.title || '待确认事项').slice(0, 160),
            detail: String(item.detail || '').slice(0, 500),
            owner: String(item.owner || '我').slice(0, 50),
            collaborators: (Array.isArray(item.collaborators) ? item.collaborators : [])
              .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20),
            project: String(item.project || '').trim().slice(0, 160),
            dependsOnIds: [],
            taskKind,
            due: String(item.due || '').slice(0, 40),
            priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
            source: String(item.source || '').slice(0, 100),
            sourceSessionId: String(evidenceMessages[0]?.sessionId || ''),
            confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
            status: taskKind === 'waiting' ? 'waiting' : 'todo',
            classification: assignment.classification,
            assignmentEvidence: String(item.assignmentEvidence || '').slice(0, 300),
            ownershipPolicyReason: assignment.rationale,
            sourceMessageIds,
            evidence: evidenceMessages.map(message => ({
              sourceId: String(message.sourceId || 'wechat'),
              sessionId: String(message.sessionId || ''),
              messageId: structuredEvidenceKey(message),
              timestamp: Number(message.timestamp),
              sender: message.direction === '我发送' ? '我' : String(message.senderName || message.senderId || '对方'),
              excerpt: redact(String(message.content)).slice(0, 300)
            }))
          }
          const feedbackFingerprint = taskEvidenceFingerprint(task)
          const feedback = feedbackFingerprint
            ? personalMemoryStore.getTaskReviewDecision(feedbackFingerprint)
            : null
          const reviewedTask = applyTaskReviewFeedback(task, feedback)
          if (!reviewedTask) {
            personalMemoryStore.recordTaskReviewSuppression(feedbackFingerprint)
            continue
          }
          Object.assign(task, reviewedTask)
          ;(task as any).dependsOnTitles = (Array.isArray(item.dependsOnTitles) ? item.dependsOnTitles : [])
            .map((value: any) => String(value || '').trim()).filter(Boolean).slice(0, 20)
          tasks.set(task.id, task)
        }
      }
      const titleToId = new Map([...tasks.values()].map(task => [task.title.trim().toLowerCase(), task.id]))
      for (const task of tasks.values()) {
        task.dependsOnIds = ((task as any).dependsOnTitles || [])
          .map((title: string) => titleToId.get(title.toLowerCase())).filter(Boolean)
        delete (task as any).dependsOnTitles
      }
      const existing = new Map(this.state.tasks.map(task => [task.id, task]))
      for (const task of tasks.values()) {
        const previous = existing.get(task.id) || findMatchingTask(task, this.state.tasks)
        if (previous && previous.id !== task.id) existing.delete(previous.id)
        if (previous) task.id = previous.id
        const mergedTask: AssistantTask = previous ? {
          ...task,
          status: previous.status,
          owner: previous.owner || task.owner,
          collaborators: previous.collaborators || task.collaborators,
          project: previous.project || task.project,
          dependsOnIds: previous.dependsOnIds || task.dependsOnIds,
          taskKind: previous.taskKind || task.taskKind,
          createdAt: previous.createdAt,
          updatedAt: createdAt
        } : { ...task, createdAt, updatedAt: createdAt }
        existing.set(task.id, mergedTask)
        personalMemoryStore.recordTaskChanges(task.id, previous || {}, mergedTask,
          previous ? 'incremental_message_update' : 'created_from_message', task.evidence || [])
      }
      const today = shanghaiDate()
      this.runContextualIdentityScan(createdAt)
      this.runScheduledIdentityScan(createdAt)
      if (fresh.length > 0) {
        this.state.briefings[today] = {
          date: today,
          headline: `已整理 ${fresh.length} 条新增消息`,
          summary: summaries.join(' ').slice(0, 900),
          summaryEvidence,
          summaryVerified: summaries.length > 0,
          highlightItems: [...new Map(highlightItems.map(item => [item.text, item])).values()].slice(0, 8),
          highlights: [...new Set(highlightItems.map(item => item.text))].slice(0, 8),
          evidencePolicy: {
            version: 'briefing-evidence-v1',
            rejectedSummaryCount,
            rejectedHighlightCount
          },
          messageCount: fresh.length,
          failedSessions: collected.failed.length,
          generatedAt: createdAt
        }
      }
      this.state.tasks = [...existing.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      this.state.cursor.recentMessageIds = [...new Set([...this.state.cursor.recentMessageIds, ...successfulMessageKeys])].slice(-20_000)
      const cursorProgress = planSessionCursorProgress({
        current: this.state.cursor.sessionCursors,
        currentOffsets: this.state.cursor.sessionOffsets,
        successfulSessionIds: collected.successful,
        failedSessionIds: collected.failed,
        continuationOffsets: collected.continuationOffsets,
        windowEnd: now,
        modelBatchesSucceeded: batchErrors.length === 0
      })
      this.state.cursor.sessionCursors = cursorProgress.sessionCursors
      this.state.cursor.sessionOffsets = cursorProgress.sessionOffsets
      this.state.cursor.pendingSessionRetryCount = cursorProgress.pendingSessionIds.length
      this.state.cursor.pendingSessionBacklogCount = cursorProgress.backlogSessionIds.length
      this.state.cursor.backlogRetry = planBacklogRetry({
        previous: this.state.cursor.backlogRetry,
        previousOffsets: previousSessionOffsets,
        currentOffsets: cursorProgress.sessionOffsets,
        now: new Date(createdAt),
        operationalFailure: batchErrors.length > 0 || collected.failed.length > 0,
        cancelled
      })
      const collectionError = cursorProgress.pendingSessionIds.length
        ? `${cursorProgress.pendingSessionIds.length} 个会话读取失败，已保留各自原始起点等待自动补齐`
        : ''
      const backlogNotice = cursorProgress.backlogSessionIds.length
        ? `${cursorProgress.backlogSessionIds.length} 个高流量会话仍有后续分页，已保存下一页位置等待继续补齐`
        : ''
      const operationalErrors = [
        ...batchErrors,
        ...(collectionError ? [collectionError] : [])
      ]
      const runErrors = [
        ...operationalErrors,
        ...(backlogNotice ? [backlogNotice] : [])
      ]
      if (cursorProgress.advanceGlobal) {
        this.state.cursor.lastMessageTimestamp = now
      }
      if (cursorProgress.complete) {
        this.state.cursor.lastSuccessfulRunAt = createdAt
        this.state.cursor.lastError = null
        this.state.lastSyncAt = createdAt
      } else {
        this.state.cursor.lastError = batchErrors.length
          ? `仍有 ${batchErrors.length} 个消息批次等待重试：${batchErrors[0]}`
          : collectionError || backlogNotice
      }
      this.saveState()
      personalMemoryStore.finishIngestionRun(runId, {
        status: runErrors.length ? 'partial' : 'completed',
        messageCount: successfulMessageKeys.length,
        entityCount: this.state.graph.entities.length,
        relationCount: this.state.graph.relations.length,
        error: runErrors[0]
      })
      runFinished = true
      if (!runErrors.length) {
        personalMemoryStore.updateDataSourceRun('wechat', {
          status: 'healthy',
          checkpoint: String(now),
          succeededAt: createdAt
        })
      } else if (!operationalErrors.length && backlogNotice) {
        personalMemoryStore.updateDataSourceRun('wechat', {
          status: 'idle',
          attemptedAt: this.state.cursor.lastAttemptAt || createdAt,
          error: backlogNotice
        })
      } else {
        personalMemoryStore.updateDataSourceRun('wechat', {
          status: cancelled ? 'idle' : 'error',
          attemptedAt: this.state.cursor.lastAttemptAt || createdAt,
          error: cancelled ? '' : runErrors[0]
        })
      }
      const mineTasks = [...tasks.values()].filter(task => task.classification === 'mine')
      if (mineTasks.length > 0) {
        this.enqueueNotification({
          key: `new-tasks:${mineTasks.map(task => task.id).sort().join(',')}`,
          title: `AI 助理发现 ${mineTasks.length} 个新待办`,
          content: mineTasks.slice(0, 2).map(task => task.title).join('；'),
          createdAt: new Date().toISOString()
        })
        this.saveState()
        await this.flushNotificationOutbox(new Date())
      }
      if (operationalErrors.length && !cancelled) {
        throw new Error(this.state.cursor.lastError || '部分消息或会话等待重试')
      }
      return {
        success: !operationalErrors.length && !auxiliaryErrors.length,
        partial: Boolean(runErrors.length || auxiliaryErrors.length),
        cancelled,
        newMessageCount: successfulMessageKeys.length,
        newTaskCount: mineTasks.length,
        failedSessions: collected.failed.length,
        indexedDocumentCount: documentSync.indexed,
        indexedCalendarEventCount: calendarSync.indexed,
        indexedMailMessageCount: mailSync.indexed,
        analyzedDocumentCount: documentAnalysis.completed,
        newDocumentTaskCount: documentAnalysis.tasks,
        documentSourceError: documentSync.error || null,
        calendarSourceError: calendarSync.error || null,
        mailSourceError: mailSync.error || null,
        message: cancelled
          ? '已安全暂停，成功批次已保存；下次将从断点继续'
          : backlogNotice || auxiliaryErrors[0] || ''
      }
    } catch (error: any) {
      this.state.cursor.lastError = sanitizeDiagnosticText(error)
      if (!runFinished) {
        this.state.cursor.pendingSessionBacklogCount = Object.keys(this.state.cursor.sessionOffsets)
          .filter(sessionId => Number(this.state.cursor.sessionOffsets[sessionId]) > 0).length
        this.state.cursor.backlogRetry = planBacklogRetry({
          previous: this.state.cursor.backlogRetry,
          previousOffsets: previousSessionOffsets,
          currentOffsets: this.state.cursor.sessionOffsets,
          now: new Date(),
          operationalFailure: true,
          cancelled: this.cancelRequested
        })
      }
      personalMemoryStore.updateDataSourceRun('wechat', {
        status: 'error',
        attemptedAt: this.state.cursor.lastAttemptAt || new Date().toISOString(),
        error: this.state.cursor.lastError
      })
      this.saveState()
      if (!runFinished) {
        personalMemoryStore.finishIngestionRun(runId, {
          status: 'failed', messageCount: 0,
          entityCount: this.state.graph.entities.length,
          relationCount: this.state.graph.relations.length,
          error: this.state.cursor.lastError
        })
      }
      throw error
    }
  }

  getStatus(): any {
    return {
      configured: Boolean(this.config.get('aiAssistantApiKey')),
      syncing: Boolean(this.activeSync),
      syncTrigger: this.activeSyncTrigger,
      cancelling: this.cancelRequested,
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      model: this.config.get('aiAssistantApiModel'),
      cursor: buildCursorStatusPayload(this.state.cursor),
      dataSources: personalMemoryStore.listDataSources()
    }
  }

  private cacheConnectorAuthorization(kind: 'calendar' | 'mail', authorization: string): void {
    const current = this.connectorAuthorizationCache.peek()
    this.connectorAuthorizationCache.set({
      calendar: 'unavailable',
      mail: 'unavailable',
      ...(current || {}),
      [kind]: String(authorization || 'unknown')
    })
    if (!current) this.connectorAuthorizationCache.invalidate()
  }

  async getDataSources(): Promise<any[]> {
    const analysis = personalMemoryStore.getDocumentAnalysisStats(DOCUMENT_ANALYSIS_VERSION)
    const authorizations = await this.connectorAuthorizationCache.get(async () => {
      const [calendar, mail] = await Promise.allSettled([
        localCalendarService.getStatus(),
        localMailService.getStatus()
      ])
      return {
        calendar: calendar.status === 'fulfilled'
          ? String(calendar.value.authorization || 'unknown')
          : 'unavailable',
        mail: mail.status === 'fulfilled'
          ? String(mail.value.authorization || 'unknown')
          : 'unavailable'
      }
    })
    return personalMemoryStore.listDataSources().map(source =>
      source.id === 'documents'
        ? { ...source, analysis }
        : source.id === 'calendar'
          ? {
              ...source,
              authorization: authorizations.calendar,
              selectedCalendarCount: Array.isArray(source.config?.calendarIds)
                ? source.config.calendarIds.length
                : 0
            }
          : source.id === 'mail'
            ? {
                ...source,
                authorization: authorizations.mail,
                selectedMailboxCount: Array.isArray(source.config?.mailboxIds)
                  ? source.config.mailboxIds.length
                  : 0
              }
          : source)
  }

  async getCalendarAuthorization(): Promise<any> {
    const status = await localCalendarService.getStatus()
    this.cacheConnectorAuthorization('calendar', status.authorization)
    return status
  }

  async requestCalendarAccess(): Promise<any> {
    const result = await localCalendarService.requestAccess()
    this.cacheConnectorAuthorization('calendar', result.authorization)
    return result
  }

  async listCalendars(): Promise<any[]> {
    const status = await localCalendarService.getStatus()
    if (!['fullAccess', 'authorized'].includes(status.authorization)) {
      throw new Error('请先明确授权读取日历')
    }
    return localCalendarService.listCalendars()
  }

  async getMailAuthorization(): Promise<any> {
    const status = await localMailService.getStatus()
    this.cacheConnectorAuthorization('mail', status.authorization)
    return status
  }

  async requestMailAccess(): Promise<any> {
    const result = await localMailService.requestAccess()
    this.cacheConnectorAuthorization('mail', result.authorization)
    return result
  }

  async listMailboxes(): Promise<any[]> {
    const status = await localMailService.getStatus()
    if (status.authorization !== 'authorized') {
      throw new Error('请先明确授权只读访问 macOS Mail')
    }
    return localMailService.listMailboxes()
  }

  setDataSourceEnabled(sourceId: string, enabled: boolean, expectedMutationToken: string): any {
    if (sourceId === 'calendar' && enabled) {
      const source = personalMemoryStore.listDataSources().find(item => item.id === 'calendar')
      if (!Array.isArray(source?.config?.calendarIds) || !source.config.calendarIds.length) {
        throw new Error('请先授权并至少选择一个日历')
      }
    }
    if (sourceId === 'mail' && enabled) {
      const source = personalMemoryStore.listDataSources().find(item => item.id === 'mail')
      if (!Array.isArray(source?.config?.mailboxIds) || !source.config.mailboxIds.length) {
        throw new Error('请先授权并至少选择一个 Mail 邮箱')
      }
    }
    const result = personalMemoryStore.setDataSourceEnabled(
      String(sourceId || ''),
      Boolean(enabled),
      String(expectedMutationToken || '')
    )
    if (sourceId === 'wechat' && !enabled && this.activeSync) {
      this.cancelRequested = true
    }
    return result
  }

  async configureDataSource(sourceId: string, input: any): Promise<any> {
    if (sourceId === 'documents') {
      const connector = new LocalDocumentDataSource(String(input?.folderPath || ''))
      return personalMemoryStore.configureDataSource(
        'documents',
        { folderPath: connector.root },
        true,
        String(input?.expectedMutationToken || '')
      )
    }
    if (sourceId === 'calendar') {
      const status = await localCalendarService.getStatus()
      if (!['fullAccess', 'authorized'].includes(status.authorization)) {
        throw new Error('请先明确授权读取日历')
      }
      const available = await localCalendarService.listCalendars()
      const availableIds = new Set(available.map(item => String(item.id)))
      const calendarIds = [...new Set(
        (Array.isArray(input?.calendarIds) ? input.calendarIds : [])
          .map(String)
          .filter(id => availableIds.has(id))
      )]
      if (!calendarIds.length) throw new Error('请至少选择一个日历')
      return personalMemoryStore.configureDataSource(
        'calendar',
        { calendarIds },
        true,
        String(input?.expectedMutationToken || '')
      )
    }
    if (sourceId === 'mail') {
      const status = await localMailService.getStatus()
      if (status.authorization !== 'authorized') {
        throw new Error('请先明确授权只读访问 macOS Mail')
      }
      const available = await localMailService.listMailboxes()
      const availableIds = new Set(available.map(item => String(item.id)))
      const mailboxIds = [...new Set(
        (Array.isArray(input?.mailboxIds) ? input.mailboxIds : [])
          .map(String)
          .filter(id => availableIds.has(id))
      )]
      if (!mailboxIds.length) throw new Error('请至少选择一个 Mail 邮箱')
      return personalMemoryStore.configureDataSource('mail', {
        mailboxIds,
        allowModelAnalysis: Boolean(input?.allowModelAnalysis)
      }, true, String(input?.expectedMutationToken || ''))
    }
    throw new Error('该数据源暂不支持本机配置')
  }

  cancelSync(): any {
    if (!this.activeSync) return { success: false, message: '当前没有正在运行的增量处理' }
    this.cancelRequested = true
    return { success: true, message: '将在当前批次安全完成后暂停' }
  }

  private getProjectDirectoryRevision(): string {
    return buildDashboardRevisions(personalMemoryStore).project
  }

  getProjectDirectory(options: any = {}): any {
    const revision = this.getProjectDirectoryRevision()
    const directory = buildProjectDirectory({
      entities: this.state.graph.entities,
      relations: this.state.graph.relations,
      claims: [],
      events: [],
      tasks: this.state.tasks.filter(task => task.classification === 'mine')
    })
    const page = paginateProjectDirectory(directory, options || {}, revision)
    if (page.stale) return page
    const reviewCounts = personalMemoryStore.getProjectReviewCounts(
      page.items.map(project => project.entityId).filter(Boolean)
    )
    const items = page.items.map(project => ({
      ...project,
      pendingReviewTotal: Number(project.pendingReviewTotal || 0) +
        Number(project.entityId
          ? (reviewCounts[project.entityId]?.candidateClaims || 0) +
            (reviewCounts[project.entityId]?.candidateMilestones || 0) +
            (reviewCounts[project.entityId]?.candidateDecisions || 0)
          : 0)
    }))
    const completedRevision = this.getProjectDirectoryRevision()
    if (completedRevision !== revision) {
      return {
        items: [], total: 0, hasMore: false,
        revision: completedRevision, stale: true
      }
    }
    return {
      items,
      total: page.total,
      hasMore: page.hasMore,
      revision,
      stale: false
    }
  }

  getDashboard(): any {
    const revisions = buildDashboardRevisions(personalMemoryStore)
    const dates = Object.keys(this.state.briefings).sort().reverse()
    const latest = dates[0] ? this.state.briefings[dates[0]] : null
    const tasks = this.state.tasks.filter(task => task.classification === 'mine')
    const taskWorksetStats = personalMemoryStore.listActiveTaskWorkset({ limit: 1 })
    const taskOwnershipReviewStats = personalMemoryStore.getTaskOwnershipReviewStats()
    const allTaskReminders = buildTaskReminders(tasks)
    const reminderResult = applyReminderPreferences(allTaskReminders, this.state.reminderPreferences)
    const taskReminderRevision = this.buildTaskReminderRevision(
      reminderResult.visible,
      taskWorksetStats.revision
    )
    const taskReminderPage = paginateTaskReminders(reminderResult.visible, {
      revision: taskReminderRevision,
      limit: 8
    })
    const memoryStats = personalMemoryStore.getMemoryStats()
    const projectCount = countProjectDirectory({
      entities: this.state.graph.entities,
      relations: this.state.graph.relations,
      claims: [],
      events: [],
      tasks
    })
    const graphReviewRevision = revisions.graph
    const graphRevision = graphReviewRevision
    const projectRevision = revisions.project
    const assistantArchiveStats = personalMemoryStore.getAssistantArchiveStats()
    const taskReviewArchiveStats = personalMemoryStore.getTaskReviewArchiveStats()
    const memoryDeletionArchiveStats = personalMemoryStore.getMemoryDeletionAuditStats()
    const mergeHistoryArchiveStats = personalMemoryStore.getMergeHistoryArchiveStats()
    const identityMergeSnapshotStorage = personalMemoryStore.getIdentityMergeSnapshotStorageStats()
    const resourceArchiveRevision = personalMemoryStore.getResourceArchiveRevision()
    const resourceTrashStats = personalMemoryStore.listResourceTrashArchive({ limit: 1 })
    return {
      briefing: latest ? { ...latest, tasks: undefined } : null,
      briefingStorage: this.briefingStorage,
      tasks: [],
      taskWorkset: {
        total: taskWorksetStats.total,
        counts: taskWorksetStats.counts,
        revision: taskWorksetStats.revision,
        version: 'task-workset-v1',
        directory: 'paginated_on_demand',
        dossier: 'single_item_on_demand'
      },
      taskOwnershipReviews: {
        total: taskOwnershipReviewStats.total,
        revision: revisions.taskOwnership,
        version: 'task-ownership-review-v1',
        directory: 'paginated_on_demand',
        dossier: 'on_demand'
      },
      taskPayloadPolicy: {
        version: 'task-active-workset-v3',
        directoryEvidence: 'count_only',
        activeDirectory: 'paginated_on_demand',
        dossier: 'on_demand',
        activeStatuses: ['todo', 'doing', 'waiting'],
        closedTasks: 'sqlcipher_archive'
      },
      taskMutationCommits: {
        ...personalMemoryStore.getTaskMutationCommitHealth(),
        startupRecovery: this.taskMutationRecovery,
        policy: 'prepared_state_then_atomic_sql_with_compressed_failure_payload_v2'
      },
      conversationSourceMutationCommits: {
        ...personalMemoryStore.getConversationSourceMutationCommitHealth(),
        startupRecovery: this.conversationSourceMutationRecovery,
        policy: 'prepared_state_then_atomic_sql_with_compressed_failure_payload_v2'
      },
      taskRevision: taskWorksetStats.revision,
      taskReminders: taskReminderPage.items,
      taskReminderDirectory: {
        total: taskReminderPage.total,
        revision: taskReminderPage.revision,
        hasMore: taskReminderPage.hasMore,
        version: 'task-reminder-directory-v1',
        directory: 'revision_paginated',
        pageLimit: taskReminderPage.limit
      },
      reminderPreferences: {
        ...this.state.reminderPreferences,
        suppressed: reminderResult.suppressed,
        total: allTaskReminders.length,
        visibleTotal: reminderResult.visible.length,
        payloadLimit: taskReminderPage.limit
      },
      taskReviewFeedback: {
        ...personalMemoryStore.getTaskReviewFeedbackStats(),
        reconciliation: this.taskReviewReconciliation,
        archive: {
          total: taskReviewArchiveStats.total,
          revision: revisions.taskOwnership,
          version: 'task-review-audit-v1',
          directory: 'paginated_without_evidence',
          dossier: 'on_demand'
        }
      },
      projectInsights: [],
      projectDirectory: {
        total: projectCount,
        revision: projectRevision,
        version: 'project-directory-v2',
        directory: 'paginated_on_demand',
        dossier: 'on_demand'
      },
      projectPayloadPolicy: {
        version: 'project-directory-v2',
        directoryFields: 'paginated_summary_only',
        dossier: 'on_demand'
      },
      projectRevision,
      graph: buildGraphDashboardPayload(),
      graphSummary: {
        entities: this.state.graph.entities.filter(entity => entity.trustStatus !== 'rejected').length,
        relations: this.state.graph.relations.filter(relation => relation.status !== 'rejected').length
      },
      graphPayloadPolicy: {
        version: 'graph-on-demand-v3',
        directoryEntities: 0,
        authoritativeEntities: this.state.graph.entities.length,
        entityDirectory: 'server_search_on_demand',
        entityProfiles: 'on_demand',
        entityEvidenceMessageIds: 'sqlcipher_authoritative_hotset_500',
        relationEvidence: 'sqlcipher_authoritative_hotset_100',
        reviewEntities: 'page_scoped'
      },
      graphRevision,
      graphReviewRevision,
      graphReviewStorage: this.graphReviewStorage,
      identityDisambiguation: {
        ...this.state.graph.identityScan,
        ...getFullIdentityScanSchedule(
          this.state.graph.entities.length,
          this.state.graph.identityScan.lastFullScanAt
        )
      },
      mergeHistoryArchive: {
        ...mergeHistoryArchiveStats,
        snapshotStorage: identityMergeSnapshotStorage,
        revision: revisions.identityMerge,
        version: 'identity-merge-audit-v1',
        directory: 'paginated_without_snapshot',
        snapshot: 'main_process_only'
      },
      memoryDeletionArchive: {
        total: memoryDeletionArchiveStats.total,
        revision: revisions.memoryDeletion,
        version: 'memory-deletion-audit-v1',
        directory: 'paginated_without_content'
      },
      memoryStats,
      memoryRevision: crypto.createHash('sha256')
        .update(JSON.stringify({
          claims: [memoryStats.claims, memoryStats.claimRevision],
          events: [memoryStats.events, memoryStats.eventRevision],
          resources: [memoryStats.resources, memoryStats.resourceRevision]
        }))
        .digest('hex')
        .slice(0, 16),
      attachmentStructureMigration: personalMemoryStore.getAttachmentStructureMigrationStats(
        ATTACHMENT_STRUCTURE_PARSER_VERSION
      ),
      imageSemanticMigration: personalMemoryStore.getImageSemanticMigrationStats(
        localImageSemanticService.getStatus().modelVersion
      ),
      memoryFeed: {
        claims: [],
        events: [],
        resources: []
      },
      memoryFeedPayloadPolicy: {
        version: 'memory-feed-directory-v3',
        claims: 'paginated_on_demand',
        events: 'paginated_on_demand',
        resources: 'paginated_on_demand',
        resourceDossier: 'single_item_on_demand'
      },
      resourceArchive: {
        total: memoryStats.resources,
        trash: resourceTrashStats.total,
        revision: resourceArchiveRevision,
        version: 'resource-archive-v1',
        directory: 'paginated_without_content',
        dossier: 'single_item_on_demand',
        trashDirectory: 'paginated_without_snapshot'
      },
      resourceTrash: [],
      ingestionStatus: personalMemoryStore.getIngestionStatus(),
      assistantArchive: {
        total: assistantArchiveStats.total,
        revision: revisions.assistantHistory,
        version: 'assistant-archive-v2',
        directory: 'paginated_on_demand',
        messages: 'newest_first_paginated',
        citationStorage: {
          ...assistantArchiveStats.citationStorage,
          policy: 'reference_only_authoritative_hydration'
        },
        exchangeIntegrity: assistantArchiveStats.exchangeIntegrity,
        answerDependencies: {
          ...assistantArchiveStats.answerDependencies,
          policy: 'statement_dependency_index_v1'
        }
      },
      qualityBaseline: evaluateTaskAssignmentPolicy(),
      weeklyBriefing: buildWeeklyBriefing(this.state.briefings, tasks),
      notificationDelivery: {
        pending: this.state.notifications.pending.length,
        sent: this.state.notifications.sentKeys.length,
        discardedPendingCount: Number(this.state.notifications.discardedPendingCount || 0),
        lastDiscardedPendingAt: this.state.notifications.lastDiscardedPendingAt || null,
        prunedSentKeyCount: Number(this.state.notifications.prunedSentKeyCount || 0),
        pendingLimit: 100,
        sentKeyLimit: 500,
        quiet: this.isNotificationQuiet(new Date()),
        quietStart: this.config.get('aiAssistantQuietStart'),
        quietEnd: this.config.get('aiAssistantQuietEnd'),
        oldestPendingAt: this.state.notifications.pending[0]?.createdAt || null,
        lastError: this.state.notifications.pending.find(item => item.lastError)?.lastError || null
      }
    }
  }

  getTaskWorkspace(taskId: string): any {
    this.hydrateTaskEvidenceFromSql([String(taskId || '')])
    const task = this.state.tasks.find(item => item.id === String(taskId || ''))
    if (!task) return null
    const historyPage = personalMemoryStore.listTaskHistoryPage({
      taskId: task.id,
      limit: 40
    })
    const dossier = buildTaskDossier(task, historyPage.items, historyPage.total)
    return {
      ...dossier,
      task: { ...dossier.task, mutationToken: buildTaskMutationToken(task) },
      historyHasMore: historyPage.hasMore,
      historyRevision: historyPage.revision,
      payloadPolicy: {
        ...dossier.payloadPolicy,
        version: 'task-dossier-v2',
        history: 'revision_paginated',
        historyPageLimit: 40
      }
    }
  }

  private buildTaskReminderRevision(reminders: TaskReminder[], taskRevision: string): string {
    const preferenceIdentity = normalizeReminderPreferences(this.state.reminderPreferences)
    return crypto.createHash('sha256').update(JSON.stringify({
      taskRevision,
      reminders: reminders.map(reminder => [
        reminder.id, reminder.taskId, reminder.kind, reminder.severity, reminder.title, reminder.reason
      ]),
      mutedKinds: preferenceIdentity.mutedKinds,
      snoozedUntil: preferenceIdentity.snoozedUntil,
      history: preferenceIdentity.history.map(item => [
        item.reminderId, item.taskId, item.kind, item.action, item.createdAt
      ])
    })).digest('hex')
  }

  getTaskReminderPage(options: any = {}): any {
    const tasks = this.state.tasks.filter(task => task.classification === 'mine')
    const reminders = applyReminderPreferences(
      buildTaskReminders(tasks),
      this.state.reminderPreferences
    ).visible
    const revision = this.buildTaskReminderRevision(
      reminders,
      personalMemoryStore.getTaskArchiveRevision()
    )
    return paginateTaskReminders(reminders, {
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 8),
      revision,
      expectedRevision: String(options?.revision || '')
    })
  }

  getTaskHistoryPage(taskId: string, options: any = {}): any {
    const id = String(taskId || '').trim()
    if (!this.state.tasks.some(task => task.id === id)) {
      return {
        items: [],
        total: 0,
        hasMore: false,
        revision: personalMemoryStore.getTaskArchiveRevision(),
        stale: false
      }
    }
    return personalMemoryStore.listTaskHistoryPage({
      taskId: id,
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getTaskDependencyCandidates(options: any = {}): any {
    const revision = personalMemoryStore.getTaskArchiveRevision()
    const result = buildTaskDependencyCandidates(this.state.tasks, {
      query: String(options?.query || ''),
      selectedIds: Array.isArray(options?.selectedIds) ? options.selectedIds.map(String) : [],
      excludeId: String(options?.excludeId || ''),
      limit: Number(options?.limit || 20),
      revision: String(options?.revision || '')
    }, revision)
    if (result.stale) return result
    const completedRevision = personalMemoryStore.getTaskArchiveRevision()
    return completedRevision === revision
      ? result
      : { items: [], total: 0, revision: completedRevision, stale: true }
  }

  getTaskArchive(options: any = {}): any {
    const page = personalMemoryStore.listTaskArchive({
      status: options?.status === 'done' || options?.status === 'cancelled'
        ? options.status
        : 'all',
      priority: ['high', 'medium', 'low'].includes(options?.priority)
        ? options.priority
        : '',
      project: String(options?.project || ''),
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const tasks = new Map(this.state.tasks.map(task => [task.id, task]))
    return {
      ...page,
      items: page.items.map((item: any) => {
        const task = tasks.get(String(item.id || ''))
        return task ? { ...item, mutationToken: buildTaskMutationToken(task) } : item
      })
    }
  }

  getTaskArchiveProjects(options: any = {}): any {
    return personalMemoryStore.listTaskArchiveProjects({
      query: String(options?.query || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getActiveTaskWorkset(options: any = {}): any {
    const page = personalMemoryStore.listActiveTaskWorkset({
      taskId: String(options?.taskId || ''),
      status: ['todo', 'doing', 'waiting'].includes(options?.status) ? options.status : 'all',
      priority: ['high', 'medium', 'low'].includes(options?.priority) ? options.priority : '',
      taskKind: ['action', 'delegated', 'waiting'].includes(options?.taskKind) ? options.taskKind : '',
      query: String(options?.query || ''),
      limit: Number(options?.limit || 100),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const tasks = new Map(this.state.tasks.map(task => [task.id, task]))
    return {
      ...page,
      items: page.items.map((item: any) => {
        const task = tasks.get(String(item.id || ''))
        return task ? { ...item, mutationToken: buildTaskMutationToken(task) } : item
      })
    }
  }

  getTaskCalendarPage(options: any = {}): any {
    const page = personalMemoryStore.listTaskCalendarPage({
      month: String(options?.month || ''),
      status: ['todo', 'doing', 'waiting'].includes(options?.status) ? options.status : 'all',
      priority: ['high', 'medium', 'low'].includes(options?.priority) ? options.priority : '',
      taskKind: ['action', 'delegated', 'waiting'].includes(options?.taskKind) ? options.taskKind : '',
      query: String(options?.query || ''),
      limit: Number(options?.limit || 200),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const tasks = new Map(this.state.tasks.map(task => [task.id, task]))
    return {
      ...page,
      items: page.items.map((item: any) => {
        const task = tasks.get(String(item.id || ''))
        return task ? { ...item, mutationToken: buildTaskMutationToken(task) } : item
      })
    }
  }

  getTaskOwnershipReviews(options: any = {}): any {
    return personalMemoryStore.listTaskOwnershipReviews({
      classification: String(options?.classification || ''),
      priority: String(options?.priority || ''),
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getTaskReviewDecisionPage(options: any = {}): any {
    const page = personalMemoryStore.listTaskReviewDecisionPage({
      status: ['active', 'revoked', 'all'].includes(options?.status) ? options.status : 'all',
      decision: ['mine', 'rejected', 'all'].includes(options?.decision) ? options.decision : 'all',
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const items = page.items.map(item => ({
      ...item,
      canRevert: Boolean(item.active && (
        item.can_restore_snapshot || this.state.tasks.some(task => task.id === item.task_id)
      ))
    }))
    const completedRevision = personalMemoryStore.getTaskOwnershipReviewRevision()
    if (completedRevision !== page.revision) {
      return {
        ...page,
        items: [],
        total: 0,
        hasMore: false,
        counts: { active: 0, revoked: 0, all: 0 },
        revision: completedRevision,
        stale: true
      }
    }
    return {
      ...page,
      items
    }
  }

  getTaskReviewDecisionDossier(evidenceFingerprint: string, options: any = {}): any {
    const dossier = personalMemoryStore.getTaskReviewDecisionDossier(
      String(evidenceFingerprint || '').trim(),
      {
        historyOffset: Number(options?.historyOffset || 0),
        historyLimit: Number(options?.historyLimit || 50),
        revision: String(options?.revision || '')
      }
    )
    if (!dossier) return null
    if (dossier.stale) return dossier
    const result = {
      ...dossier,
      canRevert: Boolean(dossier.active && (
        dossier.can_restore_snapshot || this.state.tasks.some(task => task.id === dossier.task_id)
      ))
    }
    const completedRevision = personalMemoryStore.getTaskOwnershipReviewRevision()
    if (completedRevision !== dossier.revision) {
      return {
        ...dossier,
        evidence: [],
        evidenceTotal: 0,
        history: [],
        historyTotal: 0,
        historyHasMore: false,
        revision: completedRevision,
        stale: true
      }
    }
    return result
  }

  getMemoryDeletionAuditPage(options: any = {}): any {
    return personalMemoryStore.listMemoryDeletionAuditPage({
      kind: ['claim', 'event', 'relation', 'all'].includes(options?.kind)
        ? options.kind
        : 'all',
      reason: ['manual_delete', 'not_important', 'all'].includes(options?.reason)
        ? options.reason
        : 'all',
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getMergeHistoryPage(options: any = {}): any {
    return personalMemoryStore.listMergeHistoryPage({
      status: ['active', 'reverted', 'all'].includes(options?.status)
        ? options.status
        : 'all',
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getGraphReviewPage(options?: Partial<GraphReviewPageOptions>): any {
    const status = options?.status === 'resolved' || options?.status === 'all'
      ? options.status
      : 'pending'
    const page = personalMemoryStore.listReviewLedgerPage({
      status,
      kind: String(options?.kind || '').trim(),
      query: String(options?.query || '').trim(),
      offset: options?.offset,
      limit: options?.limit,
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const items = page.items.map(review => {
      const relationId = review.correctedRelationId || review.relationId || review.originalRelationId
      const relation = relationId
        ? this.state.graph.relations.find(item => item.id === relationId) || null
        : null
      const relationCorrection = review.kind === 'relation'
        ? personalMemoryStore.getRelationCorrectionByReview(review.id)
        : null
      return {
        ...review,
        relation,
        relationCorrection,
        ...buildGraphReviewEntityPayload(
          this.state.graph.entities,
          review,
          relation,
          relationCorrection
        )
      }
    })
    const completedRevision = personalMemoryStore.getGraphReviewRevision()
    if (completedRevision !== page.revision) {
      return {
        ...page,
        items: [],
        total: 0,
        hasMore: false,
        counts: { pending: 0, resolved: 0, all: 0 },
        revision: completedRevision,
        stale: true
      }
    }
    return {
      ...page,
      items
    }
  }

  getGraphWorkspace(options?: Partial<GraphViewportOptions>): any {
    const focusEntityId = String(options?.focusEntityId || '').trim()
    const graphRevision = buildGraphWorkspaceRevision(personalMemoryStore, Boolean(focusEntityId))
    const requestedRevision = String(options?.revision || '').trim()
    if (requestedRevision && requestedRevision !== graphRevision) {
      return {
        viewport: {
          entities: [], relations: [], levels: {}, mode: options?.focusEntityId
            ? 'focus'
            : options?.query ? 'search' : 'overview',
          totalAvailable: 0, truncated: 0,
          totalRelationsAvailable: 0, truncatedRelations: 0,
          matchingSeeds: 0, maxNodes: Math.max(10, Math.min(300, Number(options?.maxNodes) || 60))
        },
        summary: { entities: 0, relations: 0 },
        predicates: [],
        focus: null,
        revision: graphRevision,
        stale: true
      }
    }
    const viewport = buildGraphViewport(this.state.graph.entities, this.state.graph.relations, {
      query: String(options?.query || '').trim(),
      relationType: String(options?.relationType || '').trim(),
      relationStatus: ['candidate', 'confirmed'].includes(String(options?.relationStatus || ''))
        ? String(options?.relationStatus)
        : '',
      focusEntityId,
      depth: Number(options?.depth || 1),
      maxNodes: Number(options?.maxNodes || 60)
    })
    const focusEntity = focusEntityId
      ? this.state.graph.entities.find(entity =>
        entity.id === focusEntityId && entity.trustStatus !== 'rejected') || null
      : null
    let focus: any = null
    if (focusEntity) {
      const mineTasks = this.state.tasks.filter(task => task.classification === 'mine')
      const memory = personalMemoryStore.getEntityMemory(focusEntity.id, 200)
      const evidenceStats = personalMemoryStore.getEntityEvidenceStats(focusEntity.id)
      const allRelations = this.state.graph.relations
        .filter(relation => relation.status !== 'rejected' &&
          (relation.subjectId === focusEntity.id || relation.objectId === focusEntity.id))
        .sort((left, right) =>
          Number(right.status === 'confirmed') - Number(left.status === 'confirmed') ||
          Number(right.confidence || 0) - Number(left.confidence || 0) ||
          String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))
      const insights = buildEntityInsights({
        entities: this.state.graph.entities,
        relations: this.state.graph.relations,
        claims: memory.claims,
        claimTotal: memory.claimTotal,
        events: memory.events,
        eventTotal: memory.eventTotal,
        tasks: mineTasks,
        authoritativeEvidence: {
          [focusEntity.id]: {
            evidenceTotal: evidenceStats.activeEvidenceTotal,
            lastEvidenceAt: evidenceStats.lastActiveEvidenceAt
          }
        }
      })
      const entityTaskRevision = this.getProjectDirectoryRevision()
      const relatedTasks = paginateEntityRelatedTasks(
        focusEntity,
        mineTasks,
        { limit: 40 },
        entityTaskRevision
      )
      const visibleRelations = allRelations.slice(0, 200)
      const relationHistoryPage = personalMemoryStore.listEntityAuditPage({
        entityId: focusEntity.id, kind: 'relation_history', limit: 40
      })
      const entityCorrectionsPage = personalMemoryStore.listEntityAuditPage({
        entityId: focusEntity.id, kind: 'name_correction', limit: 40
      })
      const relationCorrectionsPage = personalMemoryStore.listEntityAuditPage({
        entityId: focusEntity.id, kind: 'relation_correction', limit: 40
      })
      const entityProfileCorrectionsPage = personalMemoryStore.listEntityAuditPage({
        entityId: focusEntity.id, kind: 'profile_correction', limit: 40
      })
      const relationHistory = relationHistoryPage.items
      const entityCorrections = entityCorrectionsPage.items
      const relationCorrections = relationCorrectionsPage.items
      const entityProfileCorrections = entityProfileCorrectionsPage.items
      const namedEntityIds = new Set([
        focusEntity.id,
        ...visibleRelations.flatMap(relation => [relation.subjectId, relation.objectId]),
        ...relationCorrections.flatMap((item: any) => [
          item.before_subject_id,
          item.before_object_id,
          item.after_subject_id,
          item.after_object_id
        ])
      ].map(value => String(value || '')).filter(Boolean))
      const auditPageMeta = (page: any) => ({
        total: Number(page.total || 0),
        hasMore: Boolean(page.hasMore),
        revision: String(page.revision || ''),
        stale: Boolean(page.stale)
      })
      focus = {
        entity: focusEntity,
        insight: insights[focusEntity.id] || null,
        evidenceTotal: evidenceStats.evidenceTotal,
        lastEvidenceAt: evidenceStats.lastEvidenceAt,
        claims: memory.claims,
        claimTotal: memory.claimTotal,
        events: memory.events,
        eventTotal: memory.eventTotal,
        relations: visibleRelations.map(relation => ({
          ...relation,
          ...boundedEvidencePayload(
            relation.evidence,
            GRAPH_QUERY_EVIDENCE_LIMIT,
            relation.evidenceTotal
          )
        })),
        relationTotal: allRelations.length,
        relationHistory,
        entityCorrections,
        relationCorrections,
        entityProfileCorrections,
        auditPages: {
          relationHistory: auditPageMeta(relationHistoryPage),
          entityCorrections: auditPageMeta(entityCorrectionsPage),
          relationCorrections: auditPageMeta(relationCorrectionsPage),
          entityProfileCorrections: auditPageMeta(entityProfileCorrectionsPage)
        },
        tasks: relatedTasks.items.map(task => ({
          ...task,
          ...boundedEvidencePayload(task.evidence, MEMORY_CARD_EVIDENCE_LIMIT),
          mutationToken: buildTaskMutationToken(task)
        })),
        taskTotal: relatedTasks.total,
        tasksTruncated: relatedTasks.hasMore,
        taskHasMore: relatedTasks.hasMore,
        taskRevision: relatedTasks.revision,
        entityNames: Object.fromEntries(this.state.graph.entities
          .filter(entity => namedEntityIds.has(entity.id))
          .map(entity => [entity.id, entity.canonicalName]))
      }
    }
    const completedRevision = buildGraphWorkspaceRevision(personalMemoryStore, Boolean(focusEntityId))
    if (completedRevision !== graphRevision) {
      return {
        viewport: {
          entities: [], relations: [], levels: {}, mode: viewport.mode,
          totalAvailable: 0, truncated: 0,
          totalRelationsAvailable: 0, truncatedRelations: 0,
          matchingSeeds: 0, maxNodes: viewport.maxNodes
        },
        summary: { entities: 0, relations: 0 },
        predicates: [],
        focus: null,
        revision: completedRevision,
        stale: true
      }
    }
    return {
      viewport: {
        ...viewport,
        entities: viewport.entities.map(toGraphViewportNode),
        relations: viewport.relations.map(toGraphViewportEdge),
        levels: Object.fromEntries(viewport.levels)
      },
      summary: {
        entities: this.state.graph.entities.filter(entity => entity.trustStatus !== 'rejected').length,
        relations: this.state.graph.relations.filter(relation => relation.status !== 'rejected').length
      },
      predicates: [...new Set(this.state.graph.relations
        .filter(relation => relation.status !== 'rejected')
        .map(relation => relation.predicate)
        .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
      payloadPolicy: {
        version: 'graph-viewport-v2',
        nodeFields: 'drawing_only',
        edgeFields: 'drawing_only',
        focusProfile: focus ? 'loaded' : 'not_requested',
        expansion: 'revision_bound_60_120_200_300'
      },
      focus,
      revision: graphRevision,
      stale: false
    }
  }

  getTrustedEntityDirectory(options: TrustedEntityDirectoryOptions = {}): any {
    return buildTrustedEntityDirectory(this.state.graph.entities, options)
  }

  getEntityTaskPage(entityId: string, options: any = {}): any {
    const id = String(entityId || '').trim()
    const entity = this.state.graph.entities.find(candidate =>
      candidate.id === id && candidate.trustStatus !== 'rejected')
    if (!entity) throw new Error('人物或实体不存在')
    const revision = this.getProjectDirectoryRevision()
    const page = paginateEntityRelatedTasks(
      entity,
      this.state.tasks.filter(task => task.classification === 'mine'),
      {
        limit: Number(options?.limit || 40),
        offset: Number(options?.offset || 0),
        revision: String(options?.revision || '')
      },
      revision
    )
    if (page.stale) return page
    const completedRevision = this.getProjectDirectoryRevision()
    if (completedRevision !== revision) {
      return {
        items: [], total: 0, hasMore: false,
        revision: completedRevision, stale: true
      }
    }
    return {
      ...page,
      items: page.items.map(task => ({
        ...task,
        ...boundedEvidencePayload(task.evidence, MEMORY_CARD_EVIDENCE_LIMIT),
        mutationToken: buildTaskMutationToken(task)
      }))
    }
  }

  getEntityAuditPage(entityId: string, options: any = {}): any {
    const id = String(entityId || '').trim()
    const entity = this.state.graph.entities.find(candidate =>
      candidate.id === id && candidate.trustStatus !== 'rejected')
    if (!entity) throw new Error('人物或实体不存在')
    const kinds = new Set([
      'relation_history',
      'name_correction',
      'relation_correction',
      'profile_correction'
    ])
    const kind = String(options?.kind || '')
    if (!kinds.has(kind)) throw new Error('无效的人物审计类型')
    return personalMemoryStore.listEntityAuditPage({
      entityId: id,
      kind: kind as any,
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getMemoryItemAuditPage(kind: string, itemId: string, options: any = {}): any {
    const normalizedKind = String(kind || '')
    if (!['claim', 'event'].includes(normalizedKind)) throw new Error('无效的记忆类型')
    const id = String(itemId || '').trim()
    if (!id) throw new Error('记忆 ID 不能为空')
    return personalMemoryStore.listMemoryItemAuditPage({
      kind: normalizedKind as 'claim' | 'event',
      itemId: id,
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getProjectWorkspace(projectId: string): any {
    const id = String(projectId || '').trim()
    if (!id) throw new Error('请选择项目')
    const projectEntity = this.state.graph.entities.find(entity =>
      entity.id === id && entity.type === 'project' && isTrustedEntity(entity))
    const memoryFeed = projectEntity
      ? personalMemoryStore.getEntityMemory(id, 200, true)
      : personalMemoryStore.getMemoryFeed(500, false)
    const boundedProjectRelations = projectEntity
      ? this.state.graph.relations
        .filter(relation => relation.subjectId === id || relation.objectId === id)
        .sort((left, right) =>
          Number(right.status === 'confirmed') - Number(left.status === 'confirmed') ||
          Number(right.confidence || 0) - Number(left.confidence || 0) ||
          String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) ||
          String(left.id).localeCompare(String(right.id)))
        .slice(0, 200)
      : this.state.graph.relations
    const project = buildProjectInsight({
      entities: this.state.graph.entities,
      relations: boundedProjectRelations,
      claims: memoryFeed.claims,
      events: memoryFeed.events,
      tasks: this.state.tasks.filter(task => task.classification === 'mine')
    }, id)
    if (!project) throw new Error('项目不存在或已经不在当前可信视图中')
    const reviewCounts = projectEntity
      ? personalMemoryStore.getProjectReviewCounts([id])[id]
      : null
    const loadedMemoryReviewCount = Number(project.pendingReview?.claims?.length || 0) +
      Number(project.pendingReview?.milestones?.length || 0) +
      Number(project.pendingReview?.decisions?.length || 0) +
      Number(project.pendingReview?.relations?.length || 0)
    const authoritativeMemoryReviewCount = reviewCounts
      ? Number(reviewCounts.total || 0)
      : loadedMemoryReviewCount
    const taskRevision = this.getProjectDirectoryRevision()
    const taskPage = paginateProjectTasks(project, { limit: 40 }, taskRevision)
    const riskRevision = `${taskRevision}:day=${shanghaiDate()}`
    const riskPage = paginateProjectRisks(project, { limit: 40 }, riskRevision)
    const memberPage = projectEntity
      ? personalMemoryStore.listProjectMemberPage({ projectId: id, limit: 40 })
      : {
          items: project.members || [],
          total: Number(project.members?.length || 0),
          hasMore: false,
          revision: '',
          stale: false
        }
    return {
      project: {
        ...project,
        pendingReview: {
          ...project.pendingReview,
          total: authoritativeMemoryReviewCount,
          loadedMemoryTotal: loadedMemoryReviewCount,
          authoritativeMemoryTotal: authoritativeMemoryReviewCount
        },
        claimTotal: projectEntity
          ? Number((memoryFeed as any).claimTotal || 0)
          : Number(project.claims?.length || 0),
        eventTotal: projectEntity
          ? Number((memoryFeed as any).eventTotal || 0)
          : Number((project.milestones?.length || 0) + (project.decisions?.length || 0) +
            (project.pendingReview?.milestones?.length || 0) +
            (project.pendingReview?.decisions?.length || 0)),
        memoryTruncated: projectEntity && (
          Number((memoryFeed as any).claimTotal || 0) > memoryFeed.claims.length ||
          Number((memoryFeed as any).eventTotal || 0) > memoryFeed.events.length
        ),
        tasks: taskPage.items.map((item: any) => {
          const task = this.state.tasks.find(candidate => candidate.id === item.id)
          return task ? { ...item, mutationToken: buildTaskMutationToken(task) } : item
        }),
        taskTotal: taskPage.total,
        taskHasMore: taskPage.hasMore,
        taskRevision: taskPage.revision,
        risks: riskPage.items,
        riskTotal: riskPage.total,
        riskHasMore: riskPage.hasMore,
        riskRevision: riskPage.revision,
        members: memberPage.items,
        memberTotal: memberPage.total,
        memberHasMore: memberPage.hasMore,
        memberRevision: memberPage.revision
      },
      payloadPolicy: {
        version: 'project-dossier-v2',
        evidence: 'bounded',
        memoryScope: projectEntity ? 'sql_entity_first' : 'derived_name_fallback',
        claimLimit: projectEntity ? 200 : 500,
        eventLimit: projectEntity ? 200 : 500,
        loadedOnDemand: true,
        taskDirectory: 'paginated_40'
      }
    }
  }

  getProjectMemberPage(projectId: string, options: any = {}): any {
    const id = String(projectId || '').trim()
    if (!id) throw new Error('请选择项目')
    const projectEntity = this.state.graph.entities.find(entity =>
      entity.id === id && entity.type === 'project' && isTrustedEntity(entity))
    if (!projectEntity) throw new Error('项目不存在或已经不在当前可信视图中')
    return personalMemoryStore.listProjectMemberPage({
      projectId: id,
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getProjectTaskPage(projectId: string, options: any = {}): any {
    const id = String(projectId || '').trim()
    if (!id) throw new Error('请选择项目')
    const revision = this.getProjectDirectoryRevision()
    const project = buildProjectInsight({
      entities: this.state.graph.entities,
      relations: [],
      claims: [],
      events: [],
      tasks: this.state.tasks.filter(task => task.classification === 'mine')
    }, id)
    if (!project) throw new Error('项目不存在或已经不在当前目录中')
    const page = paginateProjectTasks(project, {
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    }, revision)
    if (page.stale) return page
    const completedRevision = this.getProjectDirectoryRevision()
    if (completedRevision !== revision) {
      return {
        items: [], total: 0, hasMore: false,
        revision: completedRevision, stale: true
      }
    }
    return {
      ...page,
      items: page.items.map((item: any) => {
        const task = this.state.tasks.find(candidate => candidate.id === item.id)
        return task ? { ...item, mutationToken: buildTaskMutationToken(task) } : item
      })
    }
  }

  getProjectRiskPage(projectId: string, options: any = {}): any {
    const id = String(projectId || '').trim()
    if (!id) throw new Error('请选择项目')
    const projectRevision = this.getProjectDirectoryRevision()
    const revision = `${projectRevision}:day=${shanghaiDate()}`
    const project = buildProjectInsight({
      entities: this.state.graph.entities,
      relations: [],
      claims: [],
      events: [],
      tasks: this.state.tasks.filter(task => task.classification === 'mine')
    }, id)
    if (!project) throw new Error('项目不存在或已经不在当前目录中')
    const page = paginateProjectRisks(project, {
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    }, revision)
    if (page.stale) return page
    const completedRevision = `${this.getProjectDirectoryRevision()}:day=${shanghaiDate()}`
    if (completedRevision !== revision) {
      return {
        items: [], total: 0, hasMore: false,
        revision: completedRevision, stale: true
      }
    }
    return page
  }

  getEventTimeline(options: any = {}): any {
    const page = personalMemoryStore.listEventTimeline({
      entityId: String(options?.entityId || ''),
      sourceId: ['wechat', 'documents', 'calendar', 'mail', 'legacy'].includes(options?.sourceId)
        ? options.sourceId
        : undefined,
      status: ['candidate', 'confirmed', 'rejected', 'cancelled'].includes(options?.status)
        ? options.status
        : undefined,
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 100),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const trustedIds = new Set(this.state.graph.entities.filter(isTrustedEntity).map(entity => entity.id))
    return {
      ...page,
      items: page.items.map((event: any) => ({
        ...event,
        entities_trusted: eventEntitiesAreTrusted(event, trustedIds)
      }))
    }
  }

  getEntityRelationPage(options: any = {}): any {
    const entityId = String(options?.entityId || '').trim()
    const entity = this.state.graph.entities.find(candidate =>
      candidate.id === entityId && candidate.trustStatus !== 'rejected')
    if (!entity) {
      return {
        items: [],
        total: 0,
        hasMore: false,
        revision: `${personalMemoryStore.getGraphReviewRevision()}:${personalMemoryStore.getStructuredMemoryRevision()}`,
        stale: false
      }
    }
    const page = personalMemoryStore.listEntityRelationPage({
      entityId,
      direction: ['outgoing', 'incoming'].includes(String(options?.direction || ''))
        ? options.direction
        : 'all',
      status: ['candidate', 'confirmed'].includes(String(options?.status || ''))
        ? options.status
        : 'all',
      sourceId: ['wechat', 'documents', 'calendar', 'mail', 'legacy'].includes(
        String(options?.sourceId || '')
      ) ? options.sourceId : undefined,
      query: String(options?.query || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    return {
      ...page,
      items: page.items.map((relation: any) => ({
        ...relation,
        subjectId: relation.subject_id,
        objectId: relation.object_id,
        createdAt: relation.created_at,
        updatedAt: relation.updated_at
      }))
    }
  }

  getEntityEvidencePage(options: any = {}): any {
    const entityId = String(options?.entityId || '').trim()
    const entity = this.state.graph.entities.find(candidate =>
      candidate.id === entityId && candidate.trustStatus !== 'rejected')
    if (!entity) {
      return {
        items: [],
        total: 0,
        unfilteredTotal: 0,
        hasMore: false,
        revision: `${personalMemoryStore.getGraphReviewRevision()}:${personalMemoryStore.getStructuredMemoryRevision()}`,
        stale: false
      }
    }
    return personalMemoryStore.listEntityEvidencePage({
      entityId,
      sourceId: ['wechat', 'documents', 'calendar', 'mail', 'legacy'].includes(String(options?.sourceId || ''))
        ? options.sourceId
        : undefined,
      memoryKind: ['identity', 'claim', 'relation', 'event'].includes(String(options?.memoryKind || ''))
        ? options.memoryKind
        : undefined,
      evidenceState: ['current', 'historical'].includes(String(options?.evidenceState || ''))
        ? options.evidenceState
        : undefined,
      evidenceRole: ['original', 'direct', 'indirect', 'contradiction', 'support']
        .includes(String(options?.evidenceRole || ''))
        ? options.evidenceRole
        : undefined,
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getClaimArchive(options: any = {}): any {
    const page = personalMemoryStore.listClaimArchive({
      entityId: String(options?.entityId || ''),
      sourceId: ['wechat', 'documents', 'calendar', 'mail', 'legacy'].includes(options?.sourceId)
        ? options.sourceId
        : undefined,
      status: ['candidate', 'confirmed', 'rejected'].includes(options?.status)
        ? options.status
        : undefined,
      predicate: String(options?.predicate || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
    if (page.stale) return page
    const trustedIds = new Set(this.state.graph.entities.filter(isTrustedEntity).map(entity => entity.id))
    return {
      ...page,
      items: page.items.map((claim: any) => ({
        ...claim,
        entities_trusted: claimEntitiesAreTrusted(claim, trustedIds)
      }))
    }
  }

  async getMemoryDiagnostics(): Promise<any> {
    const ingestionTotals = personalMemoryStore.getIngestionArchiveSummary()
    const ingestionRates = {
      inputPerMillion: Math.max(0, Number(this.config.get('aiAssistantInputCostPerMillion') || 0)),
      outputPerMillion: Math.max(0, Number(this.config.get('aiAssistantOutputCostPerMillion') || 0))
    }
    const databaseDiagnostics = personalMemoryStore.getDiagnostics()
    const ocr = await localOcrService.getStatus()
    const imageSemantics = localImageSemanticService.getStatus()
    const pdfOcr = await getPdfOcrStatus()
    const relationEvidenceCounts = personalMemoryStore.getRelationEvidenceCounts()
    const relationHotRows = this.state.graph.relations.reduce(
      (total, relation) => total + Number(relation.evidence?.length || 0),
      0
    )
    const relationEvidenceRows = [...relationEvidenceCounts.values()]
      .reduce((total, count) => total + Number(count || 0), 0)
    const entityEvidenceMessageRows = this.state.graph.entities.reduce(
      (total, entity) => total + Number(entity.evidenceMessageIds?.length || 0),
      0
    )
    return {
      ...databaseDiagnostics,
      identityMergeSnapshotStorage: personalMemoryStore.getIdentityMergeSnapshotStorageStats(),
      taskStateStorage: {
        ...getTaskStateStorageStats(this.state.tasks),
        ...personalMemoryStore.getTaskEvidenceStorageStats(),
        historyEvidence: personalMemoryStore.getTaskHistoryEvidenceStorageStats(),
        reviewSnapshots: personalMemoryStore.getTaskReviewSnapshotStorageStats()
      },
      graphEntityEvidenceHotset: {
        version: 'graph-entity-evidence-hotset-v1',
        hotLimitPerEntity: ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT,
        entities: this.state.graph.entities.length,
        inMemoryMessageIds: entityEvidenceMessageRows,
        entitiesAtLimit: this.state.graph.entities.filter(entity =>
          Number(entity.evidenceMessageIds?.length || 0) >= ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT).length,
        authoritativeEvidence: 'sqlcipher_on_demand',
        mergeAndRecoveryBounded: true
      },
      graphRelationEvidenceHotset: {
        version: 'graph-relation-evidence-hotset-v1',
        hotLimitPerRelation: 100,
        relations: this.state.graph.relations.length,
        authoritativeEvidenceRows: relationEvidenceRows,
        inMemoryEvidenceRows: relationHotRows,
        deferredEvidenceRows: Math.max(0, relationEvidenceRows - relationHotRows),
        relationsWithDeferredEvidence: this.state.graph.relations.filter(relation =>
          Number(relationEvidenceCounts.get(relation.id) || relation.evidenceTotal || 0) >
          Number(relation.evidence?.length || 0)).length,
        mutationHydration: 'affected_relations_on_demand'
      },
      taskMutationCommits: {
        ...personalMemoryStore.getTaskMutationCommitHealth(),
        startupRecovery: this.taskMutationRecovery,
        policy: 'prepared_state_then_atomic_sql_with_compressed_failure_payload_v2'
      },
      conversationSourceMutationCommits: {
        ...personalMemoryStore.getConversationSourceMutationCommitHealth(),
        startupRecovery: this.conversationSourceMutationRecovery,
        policy: 'prepared_state_then_atomic_sql_with_compressed_failure_payload_v2'
      },
      ingestionSummary: {
        ...ingestionTotals,
        estimatedCost:
          ingestionTotals.inputTokens / 1_000_000 * ingestionRates.inputPerMillion +
          ingestionTotals.outputTokens / 1_000_000 * ingestionRates.outputPerMillion,
        currency: 'CNY',
        rates: ingestionRates,
        costConfigured: ingestionRates.inputPerMillion > 0 || ingestionRates.outputPerMillion > 0
      },
      ingestionArchive: {
        total: ingestionTotals.runs,
        revision: crypto.createHash('sha256')
          .update(JSON.stringify({
            latestRunId: ingestionTotals.latestRunId,
            latestActivityAt: ingestionTotals.latestActivityAt,
            runs: ingestionTotals.runs,
            batches: ingestionTotals.batches
          }))
          .digest('hex')
          .slice(0, 16),
        version: 'ingestion-run-archive-v1',
        directory: 'paginated_without_batch_payload',
        dossier: 'on_demand_paginated_batches'
      },
      embeddings: {
        ...personalMemoryStore.getEmbeddingStats(localEmbeddingService.modelVersion),
        ...localEmbeddingService.getStatus(),
        indexing: Boolean(this.vectorIndexPromise)
      },
      privacy: {
        ...personalMemoryStore.getFilePermissionAudit(),
        databaseEncryption: databaseDiagnostics.encryption,
        stateMode: (() => { try { return (statSync(this.statePath).mode & 0o777).toString(8).padStart(3, '0') } catch { return null } })(),
        stateBackupMode: (() => { try { return (statSync(`${this.statePath}.bak`).mode & 0o777).toString(8).padStart(3, '0') } catch { return null } })(),
        stateEncryption: isEncryptedDurableJson(readFileSync(this.statePath))
          ? 'AES-256-GCM · key in macOS Safe Storage'
          : 'not encrypted',
        apiKeyStorage: 'macOS Safe Storage',
        httpBinding: '127.0.0.1',
        logsRedacted: true,
        sensitiveLogRetention: getSensitiveLogDiagnostics(
          app.getPath('userData'),
          this.config.get('logEnabled') === true
        ),
        sensitiveCaches: {
          version: 'encrypted-sensitive-cache-v1',
          ocr: ocr.privacy,
          imageSemantics: imageSemantics.privacy,
          voiceTranscripts: chatService.getTranscriptCachePrivacyStatus(),
          ...chatService.getRuntimeCachePrivacyStatus(),
          cacheMaps: this.config.getCacheMapPrivacyStatus()
        },
        sensitiveRedactionLevel: this.config.get('aiAssistantSensitiveRedactionLevel')
      },
      automaticBackup: {
        policyVersion: AUTOMATIC_MEMORY_BACKUP_POLICY_VERSION,
        cadence: 'after_complete_sync_once_per_shanghai_day',
        lastBackupDate: this.state.cursor.lastAutomaticBackupDate,
        lastBackupAt: this.state.cursor.lastAutomaticBackupAt,
        lastAttemptAt: this.state.cursor.lastAutomaticBackupAttemptAt,
        lastError: this.state.cursor.lastAutomaticBackupError,
        retryAfterMinutes: 60
      },
      stateStorage: this.stateStorage,
      appRecovery: getAppRunRecoveryDiagnostics(),
      ocr: { ...ocr, enabled: Boolean(this.config.get('aiAssistantOcrImages')) },
      imageSemantics: { ...imageSemantics, enabled: Boolean(this.config.get('aiAssistantAnalyzeImages')) },
      pdfOcr: { ...pdfOcr, enabled: Boolean(this.config.get('aiAssistantOcrImages')) }
    }
  }

  getIngestionRunPage(options: any = {}): any {
    return personalMemoryStore.listIngestionRunPage({
      status: ['running', 'completed', 'partial', 'failed', 'all'].includes(options?.status)
        ? options.status
        : 'all',
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      limit: Number(options?.limit || 40),
      offset: Number(options?.offset || 0),
      revision: String(options?.revision || '')
    })
  }

  getIngestionRunDossier(runId: string, options: any = {}): any {
    return personalMemoryStore.getIngestionRunDossier(
      String(runId || '').trim(),
      {
        batchOffset: Number(options?.batchOffset || 0),
        batchLimit: Number(options?.batchLimit || 40),
        revision: String(options?.revision || '')
      }
    )
  }

  getIngestionRecoveryPage(options: any = {}): any {
    return personalMemoryStore.listIngestionRecoveryPage({
      query: String(options?.query || ''),
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 30),
      revision: String(options?.revision || '')
    })
  }

  retryPreparedIngestion(): any {
    if (this.activeSync) throw new Error('当前正在增量处理，请在本轮结束后重试恢复队列')
    const result = this.recoverPreparedIngestionBatchCommits()
    if (result.unattempted > 0) this.schedulePreparedRecoveryContinuation()
    this.saveState()
    return result
  }

  createMemoryBackup(protectedPaths: string[] = []): any {
    const durable = readEncryptedDurableJson<any>(
      this.statePath,
      structuredClone(EMPTY_STATE),
      this.stateEncryptionKey
    )
    if (durable.recovery.source === 'empty') throw new Error('AI 状态不可读取，未创建不完整快照')
    const result = personalMemoryStore.createBackup(protectedPaths)
    const stateBackupPath = `${result.path}.state.json`
    writeEncryptedDurableJson(stateBackupPath, durable.value, this.stateEncryptionKey)
    return { ...result, stateBackupPath }
  }

  private inspectMemoryBackupForRestore(path: string): {
    preview: any
    identity: MemoryBackupRestoreIdentity
    restoredState: any
  } {
    const database = personalMemoryStore.inspectBackup(path)
    const stateBackupPath = `${database.path}.state.json`
    if (!existsSync(stateBackupPath)) throw new Error('该快照缺少 AI 助理状态文件，无法完整恢复')
    const restored = readEncryptedDurableJson<any>(
      stateBackupPath,
      structuredClone(EMPTY_STATE),
      this.stateEncryptionKey
    )
    if (restored.recovery.source === 'empty') throw new Error('快照中的 AI 状态损坏或密钥不匹配')
    const state = restored.value || {}
    const currentStateSummary = this.getCurrentMemoryImportSummary()
    const identity: MemoryBackupRestoreIdentity = {
      backupPath: database.path,
      backupDatabaseSha256: crypto.createHash('sha256')
        .update(readFileSync(database.path)).digest('hex'),
      backupStateSha256: crypto.createHash('sha256')
        .update(readFileSync(stateBackupPath)).digest('hex'),
      currentDatabaseSha256: personalMemoryStore.getCurrentDatabaseSha256(),
      currentStateSha256: crypto.createHash('sha256')
        .update(readFileSync(this.statePath)).digest('hex')
    }
    const preview = {
      path: database.path,
      name: database.name,
      bytes: database.bytes,
      createdAt: database.createdAt,
      integrity: database.integrity,
      encrypted: database.encrypted && restored.encrypted,
      counts: {
        ...database.counts,
        tasks: Array.isArray(state.tasks) ? state.tasks.length : 0,
        entities: Array.isArray(state.graph?.entities)
          ? state.graph.entities.filter((item: any) => item?.trustStatus !== 'rejected').length
          : Number(database.counts?.entities || 0),
        graphRelations: Array.isArray(state.graph?.relations)
          ? state.graph.relations.filter((item: any) => item?.status !== 'rejected').length
          : Number(database.counts?.relations || 0),
        pendingReviews: Array.isArray(state.graph?.reviewQueue)
          ? state.graph.reviewQueue.filter((item: any) => item?.status === 'pending').length
          : 0
      },
      lastSyncAt: state.lastSyncAt || state.cursor?.lastSuccessfulRunAt || null,
      cursor: {
        lastSuccessfulRunAt: state.cursor?.lastSuccessfulRunAt || null,
        pendingSessionRetryCount: Number(state.cursor?.pendingSessionRetryCount || 0),
        pendingSessionBacklogCount: Number(state.cursor?.pendingSessionBacklogCount || 0)
      },
      stateRecoverySource: restored.recovery.source,
      currentStateSummary,
      previewToken: buildMemoryBackupRestorePreviewToken(identity)
    }
    return { preview, identity, restoredState: state }
  }

  inspectMemoryBackup(path: string): any {
    return this.inspectMemoryBackupForRestore(path).preview
  }

  restoreMemoryBackup(
    path: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    const inspected = this.inspectMemoryBackupForRestore(path)
    assertMemoryBackupRestoreConfirmation(inspected.identity, input)
    return this.applyMemoryBackup(inspected.preview.path, inspected.restoredState)
  }

  private applyMemoryBackup(path: string, knownRestoredState?: any): any {
    const stateBackupPath = `${path}.state.json`
    if (!existsSync(stateBackupPath)) throw new Error('该快照缺少 AI 助理状态文件，无法完整恢复')
    let restoredState = knownRestoredState
    if (!restoredState) {
      const restored = readEncryptedDurableJson<any>(
        stateBackupPath,
        structuredClone(EMPTY_STATE),
        this.stateEncryptionKey
      )
      if (restored.recovery.source === 'empty') throw new Error('快照中的 AI 状态损坏或密钥不匹配')
      restoredState = restored.value
    }
    const safety = this.createMemoryBackup([path])
    try {
      const result = personalMemoryStore.restoreBackup(path, safety.path)
      writeEncryptedDurableJson(
        this.statePath,
        buildEncryptedAssistantState(restoredState),
        this.stateEncryptionKey
      )
      this.loadState()
      this.saveState()
      return { ...result, safetyBackup: safety.path, restoredStateFrom: stateBackupPath }
    } catch (error) {
      try {
        personalMemoryStore.restoreBackup(safety.path, safety.path)
        if (safety.stateBackupPath && existsSync(safety.stateBackupPath)) {
          const safetyState = readEncryptedDurableJson<any>(
            safety.stateBackupPath,
            structuredClone(EMPTY_STATE),
            this.stateEncryptionKey
          )
          if (safetyState.recovery.source !== 'empty') {
            writeEncryptedDurableJson(
              this.statePath,
              buildEncryptedAssistantState(safetyState.value),
              this.stateEncryptionKey
            )
          }
        }
        this.loadState()
        this.saveState()
      } catch {}
      throw error
    }
  }

  private async readMemoryBundle(bundlePath: string, passphrase?: string): Promise<{
    zip: JSZip
    portable: boolean
    bundleSha256: string
  }> {
    const bundleBytes = readFileSync(bundlePath)
    const portable = isPortableMemoryBundle(bundleBytes)
    const zipBytes = portable
      ? decryptPortableMemoryBundle(bundleBytes, String(passphrase || ''))
      : bundleBytes
    return {
      zip: await JSZip.loadAsync(zipBytes),
      portable,
      bundleSha256: crypto.createHash('sha256').update(bundleBytes).digest('hex')
    }
  }

  async exportMemoryBundle(outputPath: string, passphrase: string): Promise<any> {
    if (!String(outputPath || '').trim()) throw new Error('未选择导出位置')
    if (String(passphrase || '').normalize('NFKC').length < 12) throw new Error('迁移口令至少需要 12 个字符')
    const backup = this.createMemoryBackup()
    const databaseBytes = readFileSync(backup.path)
    const backupState = readEncryptedDurableJson<any>(
      backup.stateBackupPath,
      structuredClone(EMPTY_STATE),
      this.stateEncryptionKey
    )
    if (backupState.recovery.source === 'empty') throw new Error('AI 状态快照无法解密，迁移包未创建')
    const stateBytes = Buffer.from(JSON.stringify(backupState.value), 'utf8')
    const databaseKey = String(this.config.get('aiAssistantDatabaseKey') || '')
    if (!/^[a-f0-9]{64}$/i.test(databaseKey)) throw new Error('无法读取个人记忆数据库密钥，迁移包未创建')
    const manifest = {
      format: 'weflow-personal-memory',
      version: 2,
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      databaseSha256: crypto.createHash('sha256').update(databaseBytes).digest('hex'),
      stateSha256: crypto.createHash('sha256').update(stateBytes).digest('hex'),
      databaseEncryption: {
        ...personalMemoryStore.getEncryptionMetadata(),
        keyScope: 'portable-passphrase-envelope',
        rekeyOnImport: true
      }
    }
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    zip.file('personal-memory.sqlite', databaseBytes)
    zip.file('ai-assistant-state.json', stateBytes)
    zip.file('database-key.bin', Buffer.from(databaseKey, 'hex'))
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const payload = encryptPortableMemoryBundle(archive, passphrase)
    writeFileSync(outputPath, payload, { mode: 0o600 })
    try { chmodSync(outputPath, 0o600) } catch {}
    return { success: true, path: outputPath, bytes: payload.length, manifest }
  }

  private getCurrentMemoryImportSummary(): any {
    const tasks = this.state.tasks || []
    const entities = this.state.graph?.entities || []
    const relations = this.state.graph?.relations || []
    const diagnostics = personalMemoryStore.getDiagnostics()
    const databaseCounts = diagnostics.counts || {}
    const databaseRevisions = {
      search: diagnostics.memorySearchRevision?.revision || '0',
      structured: diagnostics.structuredMemoryRevision?.revision || '0',
      graph: diagnostics.graphReviewRevision?.revision || '0',
      tasks: diagnostics.taskArchiveRevision?.revision || '0',
      ownership: diagnostics.taskOwnershipReviewRevision?.revision || '0',
      assistant: diagnostics.assistantHistoryRevision?.revision || '0'
    }
    return {
      version: this.state.version,
      tasks: tasks.length,
      entities: entities.length,
      relations: relations.length,
      claims: Number(databaseCounts.claims || 0),
      events: Number(databaseCounts.events || 0),
      evidence: Number(databaseCounts.evidence || 0),
      lastSyncAt: this.state.lastSyncAt || null,
      identitySha256: crypto.createHash('sha256').update(JSON.stringify({
        lastSyncAt: this.state.lastSyncAt || null,
        tasks: tasks.map(item => [item.id, item.updatedAt || item.createdAt || '']).sort(),
        entities: entities.map(item => [item.id, item.updatedAt || '']).sort(),
        relations: relations.map(item => [item.id, item.updatedAt || '']).sort(),
        databaseCounts,
        databaseRevisions
      })).digest('hex')
    }
  }

  private async inspectLoadedMemoryBundle(
    zip: JSZip,
    portable: boolean,
    bundleSha256: string
  ): Promise<any> {
    const manifestEntry = zip.file('manifest.json')
    const databaseEntry = zip.file('personal-memory.sqlite')
    const stateEntry = zip.file('ai-assistant-state.json')
    if (!manifestEntry || !databaseEntry || !stateEntry) throw new Error('迁移包不完整')
    const manifest = JSON.parse(await manifestEntry.async('string'))
    if (manifest?.format !== 'weflow-personal-memory' || ![1, 2].includes(Number(manifest?.version))) {
      throw new Error('不支持的迁移包格式')
    }
    const databaseBytes = await databaseEntry.async('nodebuffer')
    const stateBytes = await stateEntry.async('nodebuffer')
    const databaseSha256 = crypto.createHash('sha256').update(databaseBytes).digest('hex')
    const stateSha256 = crypto.createHash('sha256').update(stateBytes).digest('hex')
    if (databaseSha256 !== manifest.databaseSha256 || stateSha256 !== manifest.stateSha256) {
      throw new Error('迁移包校验失败，文件可能损坏')
    }
    const currentEncryption = personalMemoryStore.getEncryptionMetadata()
    if (!portable && manifest.databaseEncryption?.keyFingerprint &&
        manifest.databaseEncryption.keyFingerprint !== currentEncryption.keyFingerprint) {
      throw new Error('这是旧版设备绑定迁移包，且密钥与本机不同；请在原设备重新导出口令保护的迁移包')
    }
    if (portable && (!zip.file('database-key.bin') || Number(manifest.version) !== 2)) {
      throw new Error('便携迁移包缺少安全换钥信息')
    }
    const state = JSON.parse(stateBytes.toString('utf8'))
    const currentStateSummary = this.getCurrentMemoryImportSummary()
    const previewIdentity: MemoryImportPreviewIdentity = {
      bundleSha256,
      databaseSha256,
      stateSha256,
      currentStateSha256: currentStateSummary.identitySha256
    }
    return {
      valid: true,
      portable,
      manifest,
      bundleSha256,
      databaseBytes: databaseBytes.length,
      previewToken: buildMemoryImportPreviewToken(previewIdentity),
      currentStateSummary,
      stateSummary: {
        version: state.version,
        tasks: Array.isArray(state.tasks) ? state.tasks.length : 0,
        entities: Array.isArray(state.graph?.entities) ? state.graph.entities.length : 0,
        relations: Array.isArray(state.graph?.relations) ? state.graph.relations.length : 0,
        claims: null,
        events: null,
        lastSyncAt: state.lastSyncAt || null
      }
    }
  }

  async inspectMemoryBundle(bundlePath: string, passphrase?: string): Promise<any> {
    const { zip, portable, bundleSha256 } = await this.readMemoryBundle(bundlePath, passphrase)
    return this.inspectLoadedMemoryBundle(zip, portable, bundleSha256)
  }

  async importMemoryBundle(
    bundlePath: string,
    passphrase?: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): Promise<any> {
    const { zip, portable, bundleSha256 } = await this.readMemoryBundle(bundlePath, passphrase)
    const inspected = await this.inspectLoadedMemoryBundle(zip, portable, bundleSha256)
    assertMemoryImportConfirmation({
      bundleSha256: inspected.bundleSha256,
      databaseSha256: inspected.manifest.databaseSha256,
      stateSha256: inspected.manifest.stateSha256,
      currentStateSha256: inspected.currentStateSummary.identitySha256
    }, input)
    const databaseBytes = await zip.file('personal-memory.sqlite')!.async('uint8array')
    const stateText = await zip.file('ai-assistant-state.json')!.async('string')
    const sourceKey = inspected.portable
      ? await zip.file('database-key.bin')!.async('nodebuffer')
      : undefined
    try {
      const imported = personalMemoryStore.registerImportedBackup(
        databaseBytes,
        stateText,
        sourceKey,
        encodeEncryptedDurableJson(JSON.parse(stateText), this.stateEncryptionKey)
      )
      return { ...this.applyMemoryBackup(imported.path), importedFrom: bundlePath }
    } finally {
      if (sourceKey) sourceKey.fill(0)
    }
  }

  getSettings(): any {
    const apiKeySecret = String(this.config.get('aiAssistantApiKey') || '')
    const settings = {
      configured: Boolean(apiKeySecret),
      baseUrl: this.config.get('aiAssistantApiBaseUrl'),
      model: this.config.get('aiAssistantApiModel'),
      scheduleTime: this.config.get('aiAssistantScheduleTime'),
      quietStart: this.config.get('aiAssistantQuietStart'),
      quietEnd: this.config.get('aiAssistantQuietEnd'),
      inputCostPerMillion: this.config.get('aiAssistantInputCostPerMillion'),
      outputCostPerMillion: this.config.get('aiAssistantOutputCostPerMillion'),
      enabled: this.config.get('aiAssistantEnabled'),
      ownerName: this.config.get('aiAssistantOwnerName'),
      ownerAliases: this.config.get('aiAssistantOwnerAliases'),
      ownerBackground: this.config.get('aiAssistantOwnerBackground'),
      transcribeVoice: this.config.get('autoTranscribeVoice'),
      ocrImages: this.config.get('aiAssistantOcrImages'),
      analyzeImages: this.config.get('aiAssistantAnalyzeImages'),
      indexWebLinks: this.config.get('aiAssistantIndexWebLinks'),
      resourceTrashRetentionDays: this.config.get('aiAssistantResourceTrashRetentionDays'),
      sensitiveRedactionLevel: this.config.get('aiAssistantSensitiveRedactionLevel')
    }
    return {
      ...settings,
      mutationToken: buildAssistantSettingsMutationToken({
        ...settings,
        apiKeySecret
      } as AssistantSettingsMutationIdentity)
    }
  }

  private async buildConversationSourceDirectory(options: ConversationSourceDirectoryOptions = {}): Promise<any> {
    const sessions = await this.listAllWechatSessions()
    return buildConversationSourceDirectory(
      sessions.filter((session: any) => !isOfficialAccountSession(session)),
      personalMemoryStore.getConversationPolicyRecords(),
      options
    )
  }

  async getConversationSources(options: ConversationSourceDirectoryOptions = {}): Promise<any> {
    return this.buildConversationSourceDirectory(options)
  }

  private commitConversationSourcePolicies(policies: Array<{
    sessionId: string
    displayName: string
    sessionType: 'group' | 'private'
    enabled: boolean
  }>): void {
    if (!policies.length) return
    const previousCursor = structuredClone(this.state.cursor)
    const now = Math.floor(Date.now() / 1000)
    const beforeTokens = Object.fromEntries(policies.map(policy => [
      policy.sessionId,
      buildConversationSourceCursorToken(
        policy.sessionId,
        readConversationSourceCursorState(previousCursor, policy.sessionId)
      )
    ]))
    const afterTokens = Object.fromEntries(policies.map(policy => [
      policy.sessionId,
      buildConversationSourceCursorToken(policy.sessionId, { cursor: now, offset: null })
    ]))
    const commitId = `conversation_source_mutation_${crypto.randomUUID()}`
    personalMemoryStore.prepareConversationSourceMutationCommit({
      commitId,
      beforeTokens,
      afterTokens,
      policies
    })
    for (const policy of policies) {
      this.state.cursor.sessionCursors[policy.sessionId] = now
      delete this.state.cursor.sessionOffsets[policy.sessionId]
    }
    this.state.cursor.pendingSessionBacklogCount =
      Object.keys(this.state.cursor.sessionOffsets).length
    if (!this.state.cursor.pendingSessionBacklogCount) {
      this.state.cursor.backlogRetry = { ...EMPTY_BACKLOG_RETRY_STATE }
    }
    try {
      this.persistCrossStoreMutationState()
      personalMemoryStore.finalizeConversationSourceMutationCommit(commitId)
    } catch (error) {
      this.state.cursor = previousCursor
      try {
        this.persistCrossStoreMutationState()
        personalMemoryStore.abandonConversationSourceMutationCommit(commitId, 'runtime_rollback')
      } catch (rollbackError) {
        personalMemoryStore.recordConversationSourceMutationRecoveryFailure(
          commitId,
          rollbackError
        )
      }
      throw error
    }
  }

  async setConversationSource(input: {
    sessionId: string
    enabled: boolean
    mutationToken?: string
  }): Promise<any> {
    const sessionId = String(input.sessionId || '').trim()
    if (!sessionId) throw new Error('缺少会话 ID')
    if (sessionId.toLowerCase().startsWith('gh_')) {
      return { success: true, sessionId, enabled: false, excludedReason: 'official_account' }
    }
    const directory = await this.buildConversationSourceDirectory({ limit: 100 })
    const source = directory.items.find((item: any) => item.sessionId === sessionId) ||
      (await this.buildConversationSourceDirectory({ query: sessionId, limit: 100 })).items
        .find((item: any) => item.sessionId === sessionId)
    assertConversationSourceMutation(source, input.mutationToken)
    this.commitConversationSourcePolicies([{
      sessionId: source.sessionId,
      displayName: source.displayName,
      sessionType: source.type,
      enabled: Boolean(input.enabled)
    }])
    return { success: true, sessionId, enabled: Boolean(input.enabled) }
  }

  async setConversationSourcesBulk(input: {
    type: 'group' | 'private'
    enabled: boolean
    query?: string
    currentEnabled?: 'all' | 'enabled' | 'disabled'
    expectedRevision?: string
  }): Promise<any> {
    if (input.type !== 'group' && input.type !== 'private') throw new Error('无效的会话类型')
    const sessions = (await this.listAllWechatSessions())
      .filter((session: any) => !isOfficialAccountSession(session))
    const policies = personalMemoryStore.getConversationPolicyRecords()
    const directory = buildConversationSourceDirectory(sessions, policies, {
      type: input.type,
      query: input.query,
      enabled: input.currentEnabled,
      limit: 100,
      expectedRevision: input.expectedRevision
    })
    if (directory.stale) throw new Error('信息来源目录已经变化，请刷新后重试')
    const matching: any[] = []
    for (let offset = 0; offset < directory.total; offset += 100) {
      matching.push(...buildConversationSourceDirectory(
        sessions,
        policies,
        {
          type: input.type,
          query: input.query,
          enabled: input.currentEnabled,
          offset,
          limit: 100,
          expectedRevision: directory.revision
        }
      ).items)
    }
    this.commitConversationSourcePolicies(matching.map(source => ({
      sessionId: source.sessionId,
      displayName: source.displayName,
      sessionType: source.type,
      enabled: Boolean(input.enabled)
    })))
    return { success: true, updated: matching.length }
  }

  setSettings(input: any): any {
    const currentSettings = this.getSettings()
    const { mutationToken: _currentMutationToken, ...currentVisibleSettings } = currentSettings
    assertAssistantSettingsMutationToken({
      ...currentVisibleSettings,
      apiKeySecret: String(this.config.get('aiAssistantApiKey') || '')
    } as AssistantSettingsMutationIdentity, input?.mutationToken)
    const patch = normalizeAssistantSettingsInput(input)
    this.config.setMany(patch)
    let maintenanceWarning = ''
    if (patch.aiAssistantResourceTrashRetentionDays !== undefined) {
      try {
        personalMemoryStore.purgeExpiredResourceTrash(patch.aiAssistantResourceTrashRetentionDays)
      } catch (error) {
        maintenanceWarning = `设置已保存；回收站到期维护暂未完成，将在下次启动重试：${sanitizeDiagnosticText(error)}`
      }
    }
    return { ...this.getSettings(), maintenanceWarning }
  }

  private applyTaskPatch(task: AssistantTask, patch: any, updatedAt: string): AssistantTask {
    const next = structuredClone(task)
    if (['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(patch.status)) next.status = patch.status
    if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.trim().slice(0, 300)
    if (typeof patch.detail === 'string') next.detail = patch.detail.trim().slice(0, 2000)
    if (typeof patch.owner === 'string') next.owner = patch.owner.trim().slice(0, 100) || '我'
    if (Array.isArray(patch.collaborators)) next.collaborators = patch.collaborators
      .map((value: any) => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    if (typeof patch.project === 'string') next.project = patch.project.trim().slice(0, 160)
    if (Array.isArray(patch.dependsOnIds)) {
      const knownIds = new Set(this.state.tasks.map(item => item.id))
      next.dependsOnIds = [...new Set(patch.dependsOnIds.map(String)
        .filter((value: string) => value !== task.id && knownIds.has(value)))].slice(0, 30)
    }
    if (['action', 'delegated', 'waiting'].includes(patch.taskKind)) next.taskKind = patch.taskKind
    if (typeof patch.due === 'string') next.due = patch.due.trim().slice(0, 100)
    if (['high', 'medium', 'low'].includes(patch.priority)) next.priority = patch.priority
    next.updatedAt = updatedAt
    return next
  }

  updateTasks(updates: Array<{ id?: string; patch?: any; mutationToken?: string }>): AssistantTask[] {
    if (Array.isArray(updates) && updates.length > 500) throw new Error('单次最多批量更新 500 条待办')
    const normalized = Array.isArray(updates) ? updates : []
    if (!normalized.length) return []
    const byId = new Map(this.state.tasks.map(task => [task.id, task]))
    assertTaskMutationBatch(this.state.tasks, normalized)
    const now = new Date().toISOString()
    const changes = normalized.map(update => {
      const before = structuredClone(byId.get(String(update.id))!)
      const after = this.applyTaskPatch(before, update.patch || {}, now)
      return { taskId: before.id, before, after, reason: String(update.patch?.reason || 'manual_edit'), evidence: after.evidence || [] }
    })
    const replacements = new Map(changes.map(change => [change.taskId, change.after]))
    const previousTasks = this.state.tasks
    const nextTasks = previousTasks.map(task => replacements.get(task.id) || task)
    const commitId = `task_mutation_${crypto.randomUUID()}`
    personalMemoryStore.prepareTaskMutationCommit({
      commitId,
      beforeTokens: Object.fromEntries(changes.map(change => [
        change.taskId,
        buildTaskMutationToken(change.before)
      ])),
      afterTokens: Object.fromEntries(changes.map(change => [
        change.taskId,
        buildTaskMutationToken(change.after)
      ])),
      changes
    })
    this.state.tasks = nextTasks
    try {
      this.persistCrossStoreMutationState()
      personalMemoryStore.finalizeTaskMutationCommit(commitId, nextTasks)
    } catch (error) {
      this.state.tasks = previousTasks
      try {
        this.persistCrossStoreMutationState()
        personalMemoryStore.abandonTaskMutationCommit(commitId, 'runtime_rollback')
      } catch (rollbackError) {
        personalMemoryStore.recordTaskMutationRecoveryFailure(commitId, rollbackError)
      }
      throw error
    }
    return changes.map(change => ({
      ...change.after,
      mutationToken: buildTaskMutationToken(change.after)
    }))
  }

  updateTask(id: string, patch: any, mutationToken?: string): AssistantTask | null {
    return this.updateTasks([{ id, patch, mutationToken }])[0] || null
  }

  createTaskFromMemory(input: any): AssistantTask {
    const title = String(input?.title || '').trim().slice(0, 300)
    if (!title) throw new Error('待办标题不能为空')
    const storedAnswer = personalMemoryStore.getAssistantAnswerMessage(
      String(input?.assistantMessageId || '')
    )
    if (!storedAnswer) throw new Error('找不到这段回答的本机加密记录，不能据此生成待办')
    const authenticatedAnswer = this.enrichAssistantCitationFeedback({
      messages: [storedAnswer]
    })?.messages?.[0]
    const citations = Array.isArray(authenticatedAnswer?.citations)
      ? authenticatedAnswer.citations
      : []
    const revalidation = authenticatedAnswer?.groundingRevalidation
      || revalidateGroundedStatements(storedAnswer.groundingAudit, citations)
    if (revalidation.status !== 'current' || Number(revalidation.supportedStatements || 0) < 1) {
      throw new Error('这段回答的权威证据已经变化、失效或无法证明仍与生成时一致，请用原问题重新提问后再生成待办')
    }
    const evidence = citations.flatMap((citation: any) => Array.isArray(citation?.evidence)
      ? citation.evidence.map((item: any) => ({
        messageId: String(item.message_id || item.messageId || ''),
        timestamp: Number(item.timestamp || 0),
        sender: String(item.sender || ''),
        excerpt: String(item.excerpt || '').slice(0, 2000)
      })).filter((item: any) => item.messageId)
      : []).slice(0, 30)
    const firstEvidence = citations.flatMap((citation: any) => citation?.evidence || [])[0]
    const now = new Date().toISOString()
    const task: AssistantTask = {
      id: `task_${crypto.randomUUID()}`,
      title,
      detail: String(input?.detail || '').trim().slice(0, 2000),
      owner: '我',
      collaborators: [],
      project: '',
      dependsOnIds: [],
      taskKind: 'action',
      due: '',
      priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'medium',
      source: '个人记忆问答',
      sourceSessionId: String(firstEvidence?.session_id || firstEvidence?.sessionId || ''),
      confidence: citations.length ? 0.9 : 0.6,
      status: 'todo',
      classification: 'mine',
      assignmentEvidence: citations.length ? `由 ${citations.length} 条记忆引用生成` : '由个人记忆问答手动生成',
      evidence,
      createdAt: now,
      updatedAt: now
    }
    this.state.tasks.unshift(task)
    personalMemoryStore.recordTaskChanges(task.id, {}, task, 'created_from_memory', evidence)
    this.saveState()
    return task
  }

  updateTaskReview(
    id: string,
    decision: 'mine' | 'rejected',
    expectedRevision?: string
  ): AssistantTask | null {
    assertTaskOwnershipMutationRevision(
      expectedRevision,
      personalMemoryStore.getTaskOwnershipReviewRevision()
    )
    const index = this.state.tasks.findIndex(item => item.id === id && item.classification !== 'mine')
    if (index < 0) return null
    const task = this.state.tasks[index]
    const evidenceFingerprint = taskEvidenceFingerprint(task)
    if (evidenceFingerprint) {
      personalMemoryStore.recordTaskReviewDecision({
        evidenceFingerprint,
        taskId: task.id,
        decision,
        title: task.title,
        source: task.source,
        evidence: task.evidence || [],
        task
      })
    }
    if (decision === 'rejected') {
      personalMemoryStore.recordTaskChanges(
        task.id,
        task,
        { ...task, classification: 'rejected' },
        'ownership_review_rejected',
        task.evidence || []
      )
      this.state.tasks.splice(index, 1)
      this.saveState()
      return task
    }
    const before = { ...task }
    task.classification = 'mine'
    task.updatedAt = new Date().toISOString()
    personalMemoryStore.recordTaskChanges(task.id, before, task, 'ownership_review_confirmed', task.evidence || [])
    this.saveState()
    return task
  }

  revertTaskReview(evidenceFingerprint: string, expectedRevision?: string): AssistantTask | null {
    assertTaskOwnershipMutationRevision(
      expectedRevision,
      personalMemoryStore.getTaskOwnershipReviewRevision()
    )
    const fingerprint = String(evidenceFingerprint || '').trim()
    const decision = personalMemoryStore.getTaskReviewDecision(fingerprint)
    if (!decision) return null
    const existing = this.state.tasks.find(item => item.id === decision.task_id)
    let snapshot: AssistantTask | null = null
    try { snapshot = JSON.parse(String(decision.task_json || '{}')) as AssistantTask } catch {}
    if (!existing && (!snapshot?.id || !snapshot?.title)) {
      throw new Error('这条旧反馈没有可恢复的任务快照，尚不能安全撤销')
    }
    const reverted = personalMemoryStore.revokeTaskReviewDecision(fingerprint)
    if (!reverted) return null
    if (existing) {
      const before = { ...existing }
      existing.classification = 'uncertain'
      existing.updatedAt = new Date().toISOString()
      personalMemoryStore.recordTaskChanges(existing.id, before, existing, 'ownership_review_reverted', existing.evidence || [])
      this.saveState()
      return existing
    }
    const restored: AssistantTask = {
      ...snapshot!,
      classification: 'uncertain',
      updatedAt: new Date().toISOString()
    }
    this.state.tasks.unshift(restored)
    personalMemoryStore.recordTaskChanges(restored.id, {}, restored, 'ownership_review_restored', restored.evidence || [])
    this.saveState()
    return restored
  }

  updateReminderPreference(input: {
    reminderId?: string
    taskId?: string
    kind: TaskReminder['kind']
    action: 'helpful' | 'snooze' | 'mute_kind' | 'restore_kind'
    expectedRevision?: string
  }): ReminderPreferences {
    const allowedKinds = new Set<TaskReminder['kind']>(['overdue', 'due_soon', 'waiting_stale', 'blocked'])
    const allowedActions = new Set(['helpful', 'snooze', 'mute_kind', 'restore_kind'])
    if (!allowedKinds.has(input?.kind) || !allowedActions.has(input?.action)) throw new Error('无效的提醒反馈')
    const preferences = normalizeReminderPreferences(this.state.reminderPreferences)
    const visibleReminders = applyReminderPreferences(
      buildTaskReminders(this.state.tasks.filter(task => task.classification === 'mine')),
      preferences
    ).visible
    const currentRevision = this.buildTaskReminderRevision(
      visibleReminders,
      personalMemoryStore.getTaskArchiveRevision()
    )
    assertReminderPreferenceMutation(visibleReminders, input, currentRevision)
    const now = new Date()
    if (input.action === 'snooze') {
      if (!input.reminderId) throw new Error('缺少提醒 ID')
      preferences.snoozedUntil[input.reminderId] = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    } else if (input.action === 'mute_kind') {
      preferences.mutedKinds = [...new Set([...preferences.mutedKinds, input.kind])]
    } else if (input.action === 'restore_kind') {
      preferences.mutedKinds = preferences.mutedKinds.filter(kind => kind !== input.kind)
    }
    preferences.history.push({
      reminderId: String(input.reminderId || ''),
      taskId: String(input.taskId || ''),
      kind: input.kind,
      action: input.action,
      createdAt: now.toISOString()
    })
    preferences.history = preferences.history.slice(-200)
    this.state.reminderPreferences = preferences
    this.saveState()
    return preferences
  }

  updateGraphReview(
    id: string,
    decision: 'confirmed' | 'rejected',
    options?: {
      expectedRevision?: string
      mergeTargetEntityId?: string
      correctedCanonicalName?: string
      correctedSummaryText?: string
      correctedAliasText?: string
      relationCorrection?: RelationCorrection
    }
  ): any {
    assertGraphReviewMutationRevision(
      options?.expectedRevision,
      personalMemoryStore.getGraphReviewRevision()
    )
    const review = this.state.graph.reviewQueue.find(item => item.id === id)
    if (!review || review.status !== 'pending') return null
    const resolutionNow = new Date().toISOString()
    const mergePlan = review.kind === 'possible_duplicate' && decision === 'confirmed'
      ? planEntityMerge(review, this.state.graph.entities, options?.mergeTargetEntityId)
      : null
    const relation = review.kind === 'relation' && review.relationId
      ? this.state.graph.relations.find(item => item.id === review.relationId)
      : null
    if (review.kind === 'relation' && decision === 'confirmed' && !relation) {
      throw new Error('关系候选已失效，请刷新后重试')
    }
    const relationPlan = review.kind === 'relation' && decision === 'confirmed' && relation
      ? planRelationConfirmation({
          review,
          relation,
          entities: this.state.graph.entities,
          correction: options?.relationCorrection
        })
      : null
    if (relationPlan?.changed) {
      this.hydrateRelationEvidence([relationPlan.before.id, relationPlan.after.id])
    }
    const profileEntity = (review.kind === 'entity_summary' || review.kind === 'entity_alias') && review.entityId
      ? this.state.graph.entities.find(item => item.id === review.entityId)
      : null
    if ((review.kind === 'entity_summary' || review.kind === 'entity_alias') && decision === 'confirmed' && !profileEntity) {
      throw new Error('实体候选已失效，请刷新后重试')
    }
    const summaryPlan = review.kind === 'entity_summary' && decision === 'confirmed' && profileEntity
      ? planEntitySummaryConfirmation(review, profileEntity, options?.correctedSummaryText)
      : null
    const aliasPlan = review.kind === 'entity_alias' && decision === 'confirmed' && profileEntity
      ? planEntityAliasConfirmation(review, profileEntity, options?.correctedAliasText)
      : null
    review.status = decision
    if (review.kind === 'entity_summary' && review.entityId) {
      const entity = this.state.graph.entities.find(item => item.id === review.entityId)
      if (decision === 'confirmed' && entity && summaryPlan) {
        if (summaryPlan.changed) {
          review.originalSummaryText = summaryPlan.suggestedValue
          review.correctedSummaryText = summaryPlan.finalValue
          review.summaryText = summaryPlan.finalValue
          personalMemoryStore.recordEntityProfileCorrection(
            entity.id, review.id, 'summary', summaryPlan.suggestedValue, summaryPlan.finalValue
          )
        }
        entity.summary = summaryPlan.finalValue
        entity.summaryStatus = 'confirmed'
        entity.updatedAt = new Date().toISOString()
      }
    }
    if (review.kind === 'entity_alias' && review.entityId) {
      const entity = this.state.graph.entities.find(item => item.id === review.entityId)
      if (decision === 'confirmed' && entity && aliasPlan) {
        if (aliasPlan.changed) {
          review.originalAliasText = aliasPlan.suggestedValue
          review.correctedAliasText = aliasPlan.finalValue
          review.aliasText = aliasPlan.finalValue
          personalMemoryStore.recordEntityProfileCorrection(
            entity.id, review.id, 'alias', aliasPlan.suggestedValue, aliasPlan.finalValue
          )
        }
        entity.aliases = [...new Set([...entity.aliases, aliasPlan.finalValue])]
        entity.identityVersion += 1
        entity.updatedAt = new Date().toISOString()
        this.enqueueIdentityCandidates(entity, entity.updatedAt)
      }
    }
    if (review.kind === 'entity_creation' && review.entityId) {
      const entity = this.state.graph.entities.find(item => item.id === review.entityId)
      if (decision === 'confirmed' && entity) {
        const correction = planEntityCreationConfirmation(review, entity, options?.correctedCanonicalName)
        if (correction.changed) {
          review.originalEntityCanonicalName = review.originalEntityCanonicalName || correction.beforeName
          review.correctedCanonicalName = correction.canonicalName
          review.entityCanonicalName = correction.canonicalName
          review.title = `${correction.canonicalName} · ${review.legacyReview ? '历史实体确认' : '实体候选'}`
          entity.canonicalName = correction.canonicalName
          entity.identityVersion += 1
        }
        if (canConfirmEntityCreation(review, entity)) {
          entity.trustStatus = 'confirmed'
          entity.updatedAt = new Date().toISOString()
          if (correction.changed) {
            personalMemoryStore.recordEntityCorrection(
              entity.id,
              review.id,
              correction.beforeName,
              correction.canonicalName
            )
            this.enqueueIdentityCandidates(entity, entity.updatedAt)
          }
        } else {
          review.status = 'rejected'
          review.detail = `${review.detail} 实体名称已变化或候选无效，未执行确认。`
          review.resolutionActor = 'system'
          review.resolutionReason = '实体名称已变化或候选已失效，系统拒绝过期确认'
        }
      } else if (decision === 'rejected' && entity) {
        entity.trustStatus = 'rejected'
        entity.updatedAt = new Date().toISOString()
        for (const relation of this.state.graph.relations) {
          if (relation.subjectId === entity.id || relation.objectId === entity.id) {
            relation.status = 'rejected'
            relation.updatedAt = entity.updatedAt
          }
        }
        for (const pending of this.state.graph.reviewQueue) {
          if (pending.status !== 'pending') continue
          const connectedRelation = pending.relationId
            ? this.state.graph.relations.find(relation => relation.id === pending.relationId)
            : null
          if (pending.entityId === entity.id ||
              pending.leftEntityId === entity.id ||
              pending.rightEntityId === entity.id ||
              connectedRelation?.subjectId === entity.id ||
              connectedRelation?.objectId === entity.id) {
            pending.status = 'rejected'
            pending.detail = `${pending.detail} 关联实体已被拒绝，此候选自动关闭。`
            pending.resolvedAt = resolutionNow
            pending.resolutionActor = 'system'
            pending.resolutionReason = '关联实体已被用户拒绝'
          }
        }
        const feed = personalMemoryStore.getMemoryFeed()
        for (const claim of feed.claims || []) {
          if (claim.subject_id === entity.id || claim.object_entity_id === entity.id) {
            personalMemoryStore.updateMemoryItemStatus('claim', claim.id, 'rejected', {
              actor: 'system',
              reason: '关联实体已被用户拒绝，事实随之拒绝',
              protectFromExtraction: true
            })
          }
        }
        for (const event of feed.events || []) {
          if ((event.participants || []).some((participant: any) => participant.entity_id === entity.id)) {
            personalMemoryStore.updateMemoryItemStatus('event', event.id, 'rejected', {
              actor: 'system',
              reason: '关联实体已被用户拒绝，事件随之拒绝',
              protectFromExtraction: true
            })
          }
        }
      }
    }
    if (review.kind === 'relation' && review.relationId) {
      if (relation) {
        if (decision === 'confirmed' && relationPlan) {
          const now = new Date().toISOString()
          if (relationPlan.changed && personalMemoryStore.isExtractedMemoryItemSuppressed('relation', {
            ...relationPlan.after,
            evidence: relation.evidence
          })) {
            review.status = 'pending'
            throw new Error('修正后的关系曾被永久删除，不能通过重新抽取恢复')
          }
          const applied = applyRelationConfirmation({
            relations: this.state.graph.relations,
            sourceRelationId: relation.id,
            plan: relationPlan,
            now
          })
          this.state.graph.relations = applied.relations
          if (relationPlan.changed) {
            review.originalRelationId = relationPlan.before.id
            review.correctedRelationId = relationPlan.after.id
            review.relationCorrection = {
              subjectId: relationPlan.after.subjectId,
              predicate: relationPlan.after.predicate,
              objectId: relationPlan.after.objectId
            }
            review.relationId = relationPlan.after.id
            const subjectName = this.state.graph.entities.find(entity => entity.id === relationPlan.after.subjectId)?.canonicalName || relationPlan.after.subjectId
            const objectName = this.state.graph.entities.find(entity => entity.id === relationPlan.after.objectId)?.canonicalName || relationPlan.after.objectId
            review.title = `${subjectName} — ${relationPlan.after.predicate} → ${objectName}`
            personalMemoryStore.recordRelationCorrection(review.id, relationPlan.before, relationPlan.after)
            for (const pending of this.state.graph.reviewQueue) {
              if (pending.id !== review.id && pending.status === 'pending' &&
                  (pending.relationId === relationPlan.before.id || pending.relationId === relationPlan.after.id)) {
                pending.status = 'rejected'
                pending.detail = `${pending.detail} 关系已由另一条人工纠正合并，此候选自动关闭。`
                pending.resolvedAt = resolutionNow
                pending.resolutionActor = 'system'
                pending.resolutionReason = '关系已由另一条人工纠正合并'
              }
            }
          }
        } else {
          relation.status = decision
          relation.updatedAt = new Date().toISOString()
        }
      }
    }
    if (review.kind === 'possible_duplicate' && decision === 'confirmed' && mergePlan) {
      const { source, target } = mergePlan
      {
        this.hydrateRelationEvidence(this.state.graph.relations
          .filter(item =>
            item.subjectId === source.id || item.objectId === source.id ||
            item.subjectId === target.id || item.objectId === target.id)
          .map(item => item.id))
        const affectedReviews = this.state.graph.reviewQueue
          .filter(pending =>
            pending.id === review.id ||
            pending.entityId === source.id ||
            pending.leftEntityId === source.id ||
            pending.rightEntityId === source.id)
          .map(pending => pending.id === review.id
            ? { ...structuredClone(pending), status: 'pending' as const, mergeSourceEntityId: undefined, mergeTargetEntityId: undefined }
            : structuredClone(pending))
        const sourceEventParticipants = personalMemoryStore.listEntityEventParticipants(source.id)
        const targetEventParticipants = personalMemoryStore.listEntityEventParticipants(target.id)
        personalMemoryStore.recordMerge(source.id, target.id, {
          source: structuredClone(source),
          target: structuredClone(target),
          relations: structuredClone(this.state.graph.relations.filter(item =>
            item.subjectId === source.id || item.objectId === source.id ||
            item.subjectId === target.id || item.objectId === target.id)),
          sourceEventParticipants,
          targetEventParticipants,
          affectedReviews
        })
        review.mergeSourceEntityId = source.id
        review.mergeTargetEntityId = target.id
        target.aliases = [...new Set([...target.aliases, source.canonicalName, ...source.aliases])].filter(alias => alias !== target.canonicalName)
        target.accountIds = [...new Set([...target.accountIds, ...source.accountIds])]
        const identities = new Map(
          [...(target.externalIdentities || []), ...(source.externalIdentities || [])]
            .map(identity => [`${identity.platform}:${identity.accountId.toLowerCase()}`, identity])
        )
        target.externalIdentities = [...identities.values()]
        target.evidenceMessageIds = compactEntityEvidenceMessageIds([
          ...target.evidenceMessageIds,
          ...source.evidenceMessageIds
        ])
        target.summary = target.summary || source.summary
        target.summaryStatus = target.summary === source.summary
          ? source.summaryStatus
          : target.summaryStatus
        target.confidence = Math.max(target.confidence, source.confidence)
        target.updatedAt = new Date().toISOString()
        target.identityVersion += 1
        target.lastDisambiguatedAt = target.updatedAt
        target.trustStatus = 'confirmed'
        for (const relation of this.state.graph.relations) {
          if (relation.subjectId === source.id) relation.subjectId = target.id
          if (relation.objectId === source.id) relation.objectId = target.id
        }
        const normalizedRelations = new Map<string, GraphRelation>()
        for (const relation of this.state.graph.relations) {
          if (relation.subjectId === relation.objectId) continue
          const relationId = crypto.createHash('sha256')
            .update(`${relation.subjectId}|${relation.predicate}|${relation.objectId}`).digest('hex').slice(0, 20)
          const existingRelation = normalizedRelations.get(relationId)
          if (existingRelation) {
            const knownEvidence = new Set(existingRelation.evidence.map(item => item.messageId))
            existingRelation.evidence.push(...relation.evidence.filter(item => !knownEvidence.has(item.messageId)))
            existingRelation.evidenceTotal = existingRelation.evidence.length
            existingRelation.confidence = Math.max(existingRelation.confidence, relation.confidence)
          } else {
            normalizedRelations.set(relationId, {
              ...relation,
              id: relationId,
              evidenceTotal: Math.max(
                Number(relation.evidenceTotal || 0),
                relation.evidence.length
              )
            })
          }
        }
        this.state.graph.relations = [...normalizedRelations.values()]
        this.state.graph.entities = this.state.graph.entities.filter(entity => entity.id !== source.id)
        for (const pending of this.state.graph.reviewQueue) {
          if (pending.id !== review.id && pending.status === 'pending' &&
              (pending.entityId === source.id ||
               pending.leftEntityId === source.id ||
               pending.rightEntityId === source.id)) {
            pending.status = 'rejected'
            pending.detail = `${pending.detail} 原实体已合并，此候选自动关闭。`
            pending.resolvedAt = resolutionNow
            pending.resolutionActor = 'system'
            pending.resolutionReason = '原实体已被合并到保留实体'
          }
        }
        personalMemoryStore.mergeEntityEventParticipants(source.id, target.id)
        this.checkpointGraphToSql()
        personalMemoryStore.recordIdentityDecision(source.id, target.id, 'merged', source.identityVersion, target.identityVersion, review.detail)
      }
    }
    if (review.kind === 'possible_duplicate' && decision === 'rejected' && review.leftEntityId && review.rightEntityId) {
      const left = this.state.graph.entities.find(entity => entity.id === review.leftEntityId)
      const right = this.state.graph.entities.find(entity => entity.id === review.rightEntityId)
      if (left && right) personalMemoryStore.recordIdentityDecision(left.id, right.id, 'different', left.identityVersion, right.identityVersion, review.detail)
    }
    if (review.status !== 'pending') {
      review.resolvedAt = resolutionNow
      review.resolutionActor = review.resolutionActor || 'user'
      review.resolutionReason = review.resolutionReason ||
        (review.status === 'confirmed' ? '用户确认候选' : '用户拒绝候选')
    }
    this.saveState()
    return review
  }

  previewRevertMerge(id: number, expectedRevision?: string): any {
    const archiveRevision = personalMemoryStore.getIdentityMergeArchiveRevision()
    if (!String(expectedRevision || '').trim() || String(expectedRevision) !== archiveRevision) {
      throw new Error('身份合并档案在展示后发生了变化，请刷新后重新核对')
    }
    const snapshot = personalMemoryStore.getMergeSnapshot(id)
    if (!snapshot?.source || !snapshot?.target || !Array.isArray(snapshot.relations)) return null
    const affectedReviewIds = (snapshot.affectedReviews || []).map((review: any) => String(review.id || ''))
    const currentReviews = personalMemoryStore.listGraphReviewsByIds(affectedReviewIds)
    const inspection = inspectIdentityMergeRevert({
      snapshot,
      currentGraph: { ...this.state.graph, reviewQueue: currentReviews },
      currentSourceParticipants: personalMemoryStore.listEntityEventParticipants(snapshot.source.id),
      currentTargetParticipants: personalMemoryStore.listEntityEventParticipants(snapshot.target.id),
      currentIdentityDecision: personalMemoryStore.getIdentityDecision(snapshot.source.id, snapshot.target.id)
    })
    return {
      mergeId: Number(id),
      sourceName: String(snapshot.source.canonicalName || snapshot.source.id),
      targetName: String(snapshot.target.canonicalName || snapshot.target.id),
      archiveRevision,
      safe: inspection.safe,
      reason: inspection.reason,
      counts: inspection.counts,
      previewToken: inspection.safe ? buildIdentityMergeRevertPreviewToken({
        mergeId: Number(id),
        archiveRevision,
        currentFingerprint: inspection.currentFingerprint
      }) : ''
    }
  }

  revertMerge(
    id: number,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    const archiveRevision = personalMemoryStore.getIdentityMergeArchiveRevision()
    const snapshot = personalMemoryStore.getMergeSnapshot(id)
    if (!snapshot?.source || !snapshot?.target || !Array.isArray(snapshot.relations)) {
      throw new Error('该身份合并不存在、已经撤销或缺少完整快照')
    }
    const inspection = inspectIdentityMergeRevert({
      snapshot,
      currentGraph: {
        ...this.state.graph,
        reviewQueue: personalMemoryStore.listGraphReviewsByIds(
          (snapshot.affectedReviews || []).map((review: any) => String(review.id || ''))
        )
      },
      currentSourceParticipants: personalMemoryStore.listEntityEventParticipants(snapshot.source.id),
      currentTargetParticipants: personalMemoryStore.listEntityEventParticipants(snapshot.target.id),
      currentIdentityDecision: personalMemoryStore.getIdentityDecision(snapshot.source.id, snapshot.target.id)
    })
    if (!inspection.safe) {
      throw new Error(`合并后相关档案已经变化，不能安全自动撤销：${inspection.reason}`)
    }
    assertIdentityMergeRevertConfirmation({
      mergeId: Number(id),
      archiveRevision,
      currentFingerprint: inspection.currentFingerprint
    }, input)
    const restoredGraph = restoreIdentityMergeGraph(snapshot, this.state.graph)
    personalMemoryStore.syncGraph(restoredGraph, crypto.randomUUID(), {
      identityMergeRevert: {
        mergeId: Number(id),
        sourceId: snapshot.source.id,
        targetId: snapshot.target.id,
        sourceParticipants: Array.isArray(snapshot.sourceEventParticipants)
          ? snapshot.sourceEventParticipants : [],
        targetParticipants: Array.isArray(snapshot.targetEventParticipants)
          ? snapshot.targetEventParticipants : []
      }
    })
    this.state.graph = restoredGraph
    this.saveState()
    return { success: true }
  }

  updateMemoryItemStatus(
    kind: 'claim' | 'event',
    id: string,
    status: 'confirmed' | 'rejected',
    expectedRevision?: string
  ): any {
    assertStructuredMemoryMutationRevision(
      expectedRevision,
      personalMemoryStore.getStructuredMemoryRevision()
    )
    if (status === 'confirmed') this.assertStructuredEntityTrust(kind, id)
    return personalMemoryStore.updateMemoryItemStatus(kind, id, status)
  }

  private assertStructuredEntityTrust(kind: 'claim' | 'event', id: string): void {
    const feed = personalMemoryStore.getMemoryFeed()
    if (kind === 'claim') {
      const claim = (feed.claims || []).find((item: any) => item.id === id)
      const entityIds = [claim?.subject_id, claim?.object_entity_id].filter(Boolean)
      if (entityIds.some(entityId => !isTrustedEntity(this.state.graph.entities.find(entity => entity.id === entityId)))) {
        throw new Error('请先确认事实涉及的实体，再确认事实')
      }
    } else {
      const event = (feed.events || []).find((item: any) => item.id === id)
      const entityIds = (event?.participants || []).map((item: any) => item.entity_id).filter(Boolean)
      if (entityIds.some((entityId: string) => !isTrustedEntity(this.state.graph.entities.find(entity => entity.id === entityId)))) {
        throw new Error('请先确认事件参与实体，再确认事件')
      }
    }
  }

  previewDeleteMemoryItem(
    kind: 'claim' | 'event' | 'relation',
    id: string,
    reason: StructuredMemoryDeletionReason = 'manual_delete'
  ): any {
    const preview = personalMemoryStore.previewDeleteMemoryItem(kind, id)
    if (!preview) return null
    const normalizedReason: StructuredMemoryDeletionReason =
      reason === 'not_important' ? 'not_important' : 'manual_delete'
    const identity = { ...preview, reason: normalizedReason }
    return {
      ...identity,
      previewToken: buildStructuredMemoryDeletionPreviewToken(identity)
    }
  }

  deleteMemoryItem(
    kind: 'claim' | 'event' | 'relation',
    id: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    const preview = this.previewDeleteMemoryItem(kind, id, 'manual_delete')
    if (!preview) throw new Error('该记忆不存在或已经删除')
    assertStructuredMemoryDeletionConfirmation(preview, input)
    const result = personalMemoryStore.deleteMemoryItem(kind, id)
    if (kind === 'relation') {
      this.state.graph.relations = this.state.graph.relations.filter(relation => relation.id !== id)
      this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review => review.relationId !== id)
      this.saveState()
    }
    return result
  }

  ignoreMemoryItem(
    kind: 'claim' | 'event',
    id: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    if (kind !== 'claim' && kind !== 'event') throw new Error('只有事实和事件可以标记为不重要')
    const preview = this.previewDeleteMemoryItem(kind, id, 'not_important')
    if (!preview) throw new Error('该记忆不存在或已经删除')
    assertStructuredMemoryDeletionConfirmation(preview, input)
    return {
      ...personalMemoryStore.deleteMemoryItem(kind, id, 'not_important'),
      spaceReclaimedForReuse: true
    }
  }

  previewDeleteMemoryResource(id: string): any {
    const preview = personalMemoryStore.previewDeleteResource(id)
    return preview ? {
      ...preview,
      previewToken: buildResourceDeletionPreviewToken(preview)
    } : null
  }

  getResourceArchive(options?: any): any {
    const sourceId = ['wechat', 'documents', 'calendar', 'mail', 'legacy'].includes(
      String(options?.sourceId || '')
    ) ? options.sourceId : undefined
    return personalMemoryStore.listResourceArchive({
      ...(options || {}),
      sourceId
    })
  }

  getResourceDossier(id: string, expectedRevision: string): any {
    return personalMemoryStore.getResourceDossier(id, expectedRevision)
  }

  getCurrentResourceDossier(id: string): any {
    return personalMemoryStore.getCurrentResourceDossier(id)
  }

  getStructuredMemoryDossier(
    kind: string,
    id: string,
    expectedSearchRevision: string
  ): any {
    const normalizedKind = String(kind || '')
    if (!['claim', 'event', 'relation'].includes(normalizedKind)) {
      throw new Error('无效的结构化记忆类型')
    }
    const sourceId = String(id || '').trim()
    if (!sourceId) throw new Error('结构化记忆 ID 不能为空')
    return personalMemoryStore.getStructuredMemoryDossier(
      normalizedKind as 'claim' | 'event' | 'relation',
      sourceId,
      expectedSearchRevision
    )
  }

  getRelationDossierAuditPage(
    relationId: string,
    kind: string,
    options: any = {}
  ): any {
    const normalizedKind = String(kind || '')
    if (!['history', 'correction'].includes(normalizedKind)) {
      throw new Error('无效的关系审计类型')
    }
    const id = String(relationId || '').trim()
    if (!id) throw new Error('关系 ID 不能为空')
    return personalMemoryStore.listRelationDossierAuditPage({
      relationId: id,
      kind: normalizedKind as 'history' | 'correction',
      expectedSearchRevision: String(options?.expectedSearchRevision || ''),
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 40),
      revision: String(options?.revision || '')
    })
  }

  getResourceTrashArchive(options?: any): any {
    return personalMemoryStore.listResourceTrashArchive(options || {})
  }

  deleteMemoryResource(
    id: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    const preview = this.previewDeleteMemoryResource(id)
    if (!preview) throw new Error('该资源不存在或已进入回收站')
    assertResourceDeletionConfirmation(preview, input)
    return personalMemoryStore.deleteResource(id)
  }

  restoreMemoryResource(id: string, expectedMutationToken: string): any {
    return personalMemoryStore.restoreResource(
      id,
      String(expectedMutationToken || '').trim()
    )
  }

  previewPurgeMemoryResourceTrash(id: string): any {
    const preview = personalMemoryStore.previewPurgeResourceTrash(id)
    return preview ? {
      ...preview,
      previewToken: buildResourceDeletionPreviewToken(preview)
    } : null
  }

  purgeMemoryResourceTrash(
    id: string,
    input: { previewToken?: string; confirmation?: string } = {}
  ): any {
    const preview = this.previewPurgeMemoryResourceTrash(id)
    if (!preview) throw new Error('该资源回收站快照不存在或已经清除')
    assertResourceDeletionConfirmation(preview, input)
    return personalMemoryStore.purgeResourceTrash(id)
  }

  reviewMemoryDocument(
    kind: 'relation' | 'claim' | 'event',
    id: string,
    decision: 'confirmed' | 'rejected',
    input: { assistantMessageId?: string; documentId?: string; reviewToken?: string } = {}
  ): any {
    const assistantMessageId = String(input.assistantMessageId || '').trim()
    const documentId = String(input.documentId || '').trim()
    const storedAnswer = personalMemoryStore.getAssistantAnswerMessage(assistantMessageId)
    if (!storedAnswer) throw new Error('找不到这段回答的本机加密记录，请刷新后再审阅')
    const storedCitation = (storedAnswer.citations || []).find((citation: any) =>
      String(citation.documentId || '') === documentId)
    if (!storedCitation) throw new Error('这条引用不属于指定回答，请刷新后再审阅')
    const storedContext = storedCitation.feedbackContext
    const context = storedContext && typeof storedContext === 'object'
      ? buildMemorySearchFeedbackContext(String(storedContext.query || ''), storedContext.options || {})
      : null
    const feedbackOptions = context ? (() => {
      try { return JSON.parse(context.scopeJson) } catch { return {} }
    })() : {}
    const document = personalMemoryStore.getSearchDocumentById(documentId, feedbackOptions)
    if (!document) throw new Error('引用指向的权威记忆已不存在，不能继续审阅')
    if (
      String(document.document_type || '') !== kind ||
      String(document.source_id || '') !== id ||
      String(storedCitation.type || '') !== kind ||
      String(storedCitation.sourceId || '') !== id
    ) throw new Error('引用身份已经变化，请刷新回答后再审阅')
    assertMemoryCitationReviewToken(buildMemoryCitationReviewIdentity({
      assistantMessageId,
      document,
      scopeFingerprint: context?.scopeFingerprint || 'unscoped'
    }), input.reviewToken)
    if (kind === 'claim' || kind === 'event') {
      if (decision === 'confirmed') this.assertStructuredEntityTrust(kind, id)
      return personalMemoryStore.updateMemoryItemStatus(kind, id, decision)
    }
    const relation = this.state.graph.relations.find(item => item.id === id)
    if (!relation) return null
    if (decision === 'confirmed') {
      const subject = this.state.graph.entities.find(entity => entity.id === relation.subjectId)
      const object = this.state.graph.entities.find(entity => entity.id === relation.objectId)
      if (!isTrustedEntity(subject) || !isTrustedEntity(object)) throw new Error('请先确认关系两端的实体，再确认关系')
    }
    relation.status = decision
    relation.updatedAt = new Date().toISOString()
    for (const review of this.state.graph.reviewQueue) {
      if (review.kind === 'relation' && review.relationId === id && review.status === 'pending') {
        review.status = decision
        review.resolvedAt = new Date().toISOString()
        review.resolutionActor = 'user'
        review.resolutionReason = decision === 'confirmed' ? '用户在统一记忆中确认关系' : '用户在统一记忆中拒绝关系'
      }
    }
    this.saveState()
    return relation
  }

  previewForgetEntity(id: string): any {
    const entity = this.state.graph.entities.find(item => item.id === id)
    const databasePreview = personalMemoryStore.previewForgetEntity(id)
    if (!entity || !databasePreview) return null
    const names = [...new Set([
      entity.canonicalName,
      ...(entity.aliases || []),
      ...(entity.accountIds || []),
      ...(databasePreview.names || [])
    ].map(value => String(value || '').trim().toLowerCase()).filter(value => value.length >= 2))]
    const taskIds = this.state.tasks.filter(task => [
      task.owner,
      ...(task.collaborators || []),
      task.project,
      task.title,
      task.detail,
      task.assignmentEvidence,
      ...(task.evidence || []).map(item => item.excerpt)
    ].some(value => names.some(name => String(value || '').toLowerCase().includes(name)))).map(task => task.id)
    const preview = {
      ...databasePreview,
      taskIds,
      counts: {
        claims: databasePreview.claimIds.length,
        relations: databasePreview.relationIds.length,
        events: databasePreview.eventIds.length,
        tasks: taskIds.length
      }
    }
    return {
      ...preview,
      previewToken: buildEntityForgetPreviewToken(preview)
    }
  }

  forgetEntity(id: string, input: { previewToken?: string; confirmation?: string } = {}): any {
    const preview = this.previewForgetEntity(id)
    if (!preview) throw new Error('实体不存在或已被遗忘')
    assertEntityForgetConfirmation(preview, input)
    const taskIds = new Set(preview.taskIds)
    const result = personalMemoryStore.forgetEntity(id, [...taskIds])
    if (!result) throw new Error('人物资料删除失败，当前记忆未改变')
    this.state.tasks = this.state.tasks.filter(task => !taskIds.has(task.id))
    for (const briefing of Object.values(this.state.briefings)) {
      if (Array.isArray(briefing?.tasks)) briefing.tasks = briefing.tasks.filter((task: any) => !taskIds.has(task.id))
    }
    this.state.graph.entities = this.state.graph.entities.filter(entity => entity.id !== id)
    const relationIds = new Set(this.state.graph.relations
      .filter(relation => relation.subjectId === id || relation.objectId === id).map(relation => relation.id))
    this.state.graph.relations = this.state.graph.relations.filter(relation => !relationIds.has(relation.id))
    this.state.graph.reviewQueue = this.state.graph.reviewQueue.filter(review =>
      review.leftEntityId !== id && review.rightEntityId !== id && (!review.relationId || !relationIds.has(review.relationId)))
    this.saveState()
    return result
  }

  searchMemory(
    query: string,
    limit = 200,
    allowedIds: Set<string> | null = null,
    evidenceScope: MemorySearchOptions = {}
  ): any[] {
    return personalMemoryStore.searchText(
      String(query || ''),
      limit,
      allowedIds,
      evidenceScope
    ).map((item: any) => {
      const evidencePayload = personalMemoryStore.getDocumentEvidencePayload(
        item.document_type,
        item.source_id,
        evidenceScope
      )
      const matchedEvidence = item.match_reason === 'entity_evidence'
        ? {
            source_id: item.matched_evidence_source_id,
            message_id: item.matched_evidence_message_id,
            session_id: item.matched_evidence_session_id,
            timestamp: item.matched_evidence_timestamp,
            sender: item.matched_evidence_sender,
            excerpt: item.matched_evidence_excerpt,
            evidence_role: 'original',
            evidence_kind: item.matched_evidence_kind
          }
        : null
      const {
        matched_evidence_source_id: _matchedSource,
        matched_evidence_message_id: _matchedMessage,
        matched_evidence_session_id: _matchedSession,
        matched_evidence_timestamp: _matchedTimestamp,
        matched_evidence_sender: _matchedSender,
        matched_evidence_excerpt: _matchedExcerpt,
        matched_evidence_kind: _matchedKind,
        ...document
      } = item
      return {
        ...document,
        metadata: (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
        matchedEvidence,
        ...evidencePayload
      }
    })
  }

  async searchMemoryHybrid(query: string, options: MemorySearchOptions = {}, maxResults = 40): Promise<any[]> {
    const selectedEntity = options.entityId ? this.state.graph.entities.find(entity => entity.id === options.entityId && isTrustedEntity(entity)) : null
    const scopedOptions = selectedEntity
      ? {
          ...options,
          entityTerms: [
            selectedEntity.canonicalName,
            ...(selectedEntity.aliases || []),
            ...(selectedEntity.accountIds || []),
            ...(selectedEntity.externalIdentities || []).flatMap(identity => [identity.accountId, identity.displayName])
          ]
        }
      : options
    const allowedIds = personalMemoryStore.listScopedSearchDocumentIds(scopedOptions)
    const scopeCandidateCount = allowedIds?.size ?? null
    const candidateLimit = Math.max(300, Math.min(500, Number(maxResults) || 40))
    const lexical = this.searchMemory(query, candidateLimit, allowedIds, scopedOptions)
    try {
      await this.ensureVectorIndex()
      const [queryVector] = await localEmbeddingService.embed([String(query || '')])
      const semantic = personalMemoryStore.searchVector(queryVector, localEmbeddingService.modelVersion, candidateLimit, {
        allowedIds
      })
      const merged = new Map<string, any>()
      lexical.forEach((item, index) => merged.set(item.id, {
        ...item,
        hybrid_score: 1 / (40 + index),
        match_source: '全文'
      }))
      semantic.forEach((item: any, index: number) => {
        if (Number(item.semantic_score || 0) < 0.35) return
        const existing = merged.get(item.id)
        const evidencePayload = existing
          ? { evidence: existing.evidence, evidenceTotal: existing.evidenceTotal }
          : personalMemoryStore.getDocumentEvidencePayload(item.document_type, item.source_id, scopedOptions)
        const semanticContribution = Math.max(0, Number(item.semantic_score || 0)) * 0.035 + 1 / (60 + index)
        merged.set(item.id, {
          ...(existing || item),
          semantic_score: item.semantic_score,
          semantic_search_mode: item.semantic_search_mode,
          hybrid_score: Number(existing?.hybrid_score || 0) + semanticContribution,
          match_source: existing ? '全文 + 语义' : '语义',
          metadata: existing?.metadata || (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
          ...evidencePayload
        })
      })
      const filtered = filterMemorySearchResults(
        [...merged.values()].sort((left, right) => Number(right.hybrid_score || 0) - Number(left.hybrid_score || 0)),
        scopedOptions,
        allowedIds !== null
      )
      return this.applyStoredMemorySearchFeedback(query, scopedOptions, filtered)
        .slice(0, Math.max(1, Math.min(500, maxResults))).map(item => ({
        ...item,
        retrieval_scope_applied: allowedIds !== null,
        retrieval_scope_candidates: scopeCandidateCount
      }))
    } catch (error) {
      console.warn('[AI Assistant] 向量检索回退为全文检索:', error)
      const filtered = filterMemorySearchResults(lexical, scopedOptions, allowedIds !== null)
      return this.applyStoredMemorySearchFeedback(query, scopedOptions, filtered)
        .slice(0, Math.max(1, Math.min(500, maxResults))).map(item => ({
        ...item,
        retrieval_scope_applied: allowedIds !== null,
        retrieval_scope_candidates: scopeCandidateCount
      }))
    }
  }

  async searchMemoryWithTrustedScope(query: string, options: MemorySearchOptions = {}): Promise<any[]> {
    if (options.entityId) {
      const selection = resolveTrustedEntitySelection(this.state.graph.entities, {
        entityId: options.entityId,
        expectedRevision: options.entitySelectionRevision
      })
      if (selection.stale) {
        throw new Error('所选实体已经变化或不再可信，请重新选择实体范围')
      }
    }
    return this.searchMemoryHybrid(query, options)
  }

  private memorySearchFeedbackContext(query: string, options: MemorySearchOptions): {
    context: ReturnType<typeof buildMemorySearchFeedbackContext>
    entries: any[]
  } {
    const context = buildMemorySearchFeedbackContext(query, options)
    return {
      context,
      entries: personalMemoryStore.listMemorySearchFeedback(
        context.queryFingerprint,
        context.scopeFingerprint,
        500
      )
    }
  }

  private applyStoredMemorySearchFeedback(query: string, options: MemorySearchOptions, items: any[]): any[] {
    const { entries } = this.memorySearchFeedbackContext(query, options)
    const decisions = new Map(entries.map(entry => [
      String(entry.documentId || ''),
      entry.action as 'helpful' | 'not_relevant'
    ]))
    return applyMemorySearchFeedback(items, decisions)
  }

  updateMemorySearchFeedback(input: {
    query?: string
    options?: MemorySearchOptions
    documentId?: string
    action?: MemorySearchFeedbackAction
  }): any {
    const query = String(input?.query || '')
    const options = input?.options || {}
    const context = buildMemorySearchFeedbackContext(query, options)
    const result = personalMemoryStore.recordMemorySearchFeedback({
      queryFingerprint: context.queryFingerprint,
      scopeFingerprint: context.scopeFingerprint,
      queryText: context.query,
      scopeJson: context.scopeJson,
      documentId: String(input?.documentId || ''),
      action: input?.action as MemorySearchFeedbackAction
    })
    return {
      ...result,
      version: MEMORY_SEARCH_FEEDBACK_VERSION,
      feedback: personalMemoryStore.listMemorySearchFeedback(
        context.queryFingerprint,
        context.scopeFingerprint,
        500
      )
    }
  }

  getMemorySearchFeedbackArchive(options?: any): any {
    return {
      ...personalMemoryStore.getMemorySearchFeedbackArchive(options || {}),
      version: MEMORY_SEARCH_FEEDBACK_VERSION
    }
  }

  deleteMemorySearchFeedback(input?: any): any {
    return {
      ...personalMemoryStore.deleteMemorySearchFeedback(input || {}),
      version: MEMORY_SEARCH_FEEDBACK_VERSION,
      payloadPolicy: 'sqlcipher-feedback-chain-purge-v1'
    }
  }

  async searchMemoryPage(
    query: string,
    options: MemorySearchOptions = {},
    pagination: {
      offset?: number
      limit?: number
      revision?: string
      mode?: 'hybrid' | 'lexical_archive'
    } = {}
  ): Promise<any> {
    const rawOffset = Number(pagination.offset)
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
    const limit = Math.max(1, Math.min(100, Number(pagination.limit) || 40))
    const text = String(query || '').trim()
    const searchMode = pagination.mode === 'lexical_archive' ? 'lexical_archive' : 'hybrid'
    if (text && searchMode === 'hybrid') {
      try { await this.ensureVectorIndex() } catch {}
    }
    const revision = personalMemoryStore.getMemorySearchRevision()
    const expectedRevision = String(pagination.revision || '').trim()
    if (isMemorySearchPageRevisionStale({
      offset,
      expectedRevision,
      startingRevision: revision,
      completedRevision: revision
    })) {
      return {
        results: [], offset, limit, total: 0, hasMore: false, truncated: false,
        scopeCandidates: null, feedback: [], feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
        revision, stale: true
      }
    }
    const entitySelection = options.entityId
      ? resolveTrustedEntitySelection(this.state.graph.entities, {
          entityId: options.entityId,
          expectedRevision: options.entitySelectionRevision
        })
      : null
    if (entitySelection?.stale) {
      return {
        results: [], offset, limit, total: 0, hasMore: false, truncated: false,
        scopeCandidates: null, feedback: [], feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
        revision, stale: false, entityScopeStale: true,
        entityDirectoryRevision: entitySelection.revision,
        entityScopeStaleReason: entitySelection.reason
      }
    }
    const selectedEntity = entitySelection?.entity || null
    const scopedOptions = selectedEntity ? {
      ...options,
      entityTerms: [
        selectedEntity.canonicalName,
        ...(selectedEntity.aliases || []),
        ...(selectedEntity.accountIds || []),
        ...(selectedEntity.externalIdentities || []).flatMap(identity => [identity.accountId, identity.displayName])
      ]
    } : options
    const allowedIds = personalMemoryStore.listScopedSearchDocumentIds(scopedOptions)
    if (!text && allowedIds === null) {
      return {
        results: [], offset, limit, total: 0, hasMore: false, truncated: false,
        scopeCandidates: null, feedback: [], feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
        revision, stale: false
      }
    }
    let page: any
    if (text && searchMode === 'lexical_archive') {
      const lexicalPage = personalMemoryStore.listSearchDocumentsByKeywordPage(
        text,
        allowedIds,
        { offset, limit }
      )
      const results = lexicalPage.items.map((item: any) => ({
        ...item,
        metadata: (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
        ...personalMemoryStore.getDocumentEvidencePayload(
          item.document_type,
          item.source_id,
          scopedOptions
        ),
        match_source: lexicalPage.searchMode === 'fts' ? '完整全文档案' : '完整子串档案',
        retrieval_scope_applied: allowedIds !== null,
        retrieval_scope_candidates: allowedIds?.size ?? null
      }))
      page = {
        results,
        offset: lexicalPage.offset,
        limit: lexicalPage.limit,
        total: lexicalPage.total,
        hasMore: lexicalPage.hasMore,
        truncated: false,
        searchMode,
        lexicalSearchMode: lexicalPage.searchMode
      }
    } else if (text) {
      const ranked = await this.searchMemoryHybrid(text, scopedOptions, 500)
      page = {
        ...paginateMemoryResults(ranked, offset, limit, 500),
        searchMode
      }
    } else {
      const browseContext = buildMemorySearchFeedbackContext(text, scopedOptions)
      const browsePage = personalMemoryStore.listSearchDocumentsInScopePage(allowedIds!, {
        offset,
        limit,
        queryFingerprint: browseContext.queryFingerprint,
        scopeFingerprint: browseContext.scopeFingerprint
      })
      const results = browsePage.items.map((item: any) => {
        const evidencePayload = personalMemoryStore.getDocumentEvidencePayload(
          item.document_type,
          item.source_id,
          scopedOptions
        )
        return {
          ...item,
          metadata: (() => { try { return JSON.parse(item.metadata_json || '{}') } catch { return {} } })(),
          ...evidencePayload,
          match_source: '范围浏览',
          retrieval_scope_applied: true,
          retrieval_scope_candidates: allowedIds!.size
        }
      }).map(item => ({
        ...item,
        ranking_base_score: Number(item.browse_score || 0),
        relevance_adjustment: item.relevance_feedback === 'helpful'
          ? 0.02
          : item.relevance_feedback === 'not_relevant' ? -0.04 : 0,
        hybrid_score: Number(item.browse_score || 0),
        match_source: '范围浏览'
      }))
      page = {
        results,
        offset: browsePage.offset,
        limit: browsePage.limit,
        total: browsePage.total,
        hasMore: browsePage.hasMore,
        truncated: false,
        searchMode: 'scope_browse'
      }
    }
    const feedback = this.memorySearchFeedbackContext(text, scopedOptions).entries
    const completedRevision = personalMemoryStore.getMemorySearchRevision()
    const completedEntitySelection = options.entityId
      ? resolveTrustedEntitySelection(this.state.graph.entities, {
          entityId: options.entityId,
          expectedRevision: options.entitySelectionRevision
        })
      : null
    if (completedEntitySelection?.stale) {
      return {
        results: [], offset, limit, total: 0, hasMore: false, truncated: false,
        scopeCandidates: null, feedback: [], feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
        revision: completedRevision, stale: false, entityScopeStale: true,
        entityDirectoryRevision: completedEntitySelection.revision,
        entityScopeStaleReason: completedEntitySelection.reason
      }
    }
    if (isMemorySearchPageRevisionStale({
      offset,
      expectedRevision,
      startingRevision: revision,
      completedRevision
    })) {
      return {
        results: [], offset, limit, total: 0, hasMore: false, truncated: false,
        scopeCandidates: null, feedback: [], feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
        revision: completedRevision, stale: true
      }
    }
    return {
      ...page,
      truncated: page.truncated,
      scopeCandidates: allowedIds?.size ?? null,
      feedback,
      feedbackVersion: MEMORY_SEARCH_FEEDBACK_VERSION,
      revision,
      stale: false,
      entityScopeStale: false,
      entityDirectoryRevision: entitySelection?.revision
    }
  }

  getMemoryEvidencePage(documentType: string, sourceId: string, pagination?: any): any {
    const normalizedType = String(documentType || '').trim()
    const normalizedSourceId = String(sourceId || '').trim()
    if (!new Set(['entity', 'relation', 'claim', 'event', 'task', 'resource']).has(normalizedType)) {
      throw new Error('记忆类型无效')
    }
    if (!normalizedSourceId || normalizedSourceId.length > 512 || /[\u0000-\u001f]/.test(normalizedSourceId)) {
      throw new Error('记忆标识无效')
    }
    return personalMemoryStore.getDocumentEvidencePage(normalizedType, normalizedSourceId, {
      offset: Number(pagination?.offset || 0),
      limit: Number(pagination?.limit || 40),
      revision: String(pagination?.revision || ''),
      query: String(pagination?.query || '').trim().slice(0, 500),
      source: String(pagination?.source || '').trim().toLowerCase().slice(0, 100),
      session: String(pagination?.session || '').trim().slice(0, 500),
      sender: String(pagination?.sender || '').trim().slice(0, 200),
      role: String(pagination?.role || '').trim().toLowerCase().slice(0, 32),
      fromTimestamp: Number(pagination?.fromTimestamp || 0),
      toTimestamp: Number(pagination?.toTimestamp || 0)
    })
  }

  async ensureVectorIndex(): Promise<any> {
    if (this.vectorIndexPromise) return this.vectorIndexPromise
    this.vectorIndexPromise = (async () => {
      let indexed = 0
      while (true) {
        const documents = personalMemoryStore.listEmbeddingCandidates(localEmbeddingService.modelVersion, 24)
        if (!documents.length) break
        const vectors = await localEmbeddingService.embed(documents.map((item: any) => `${item.title}\n${item.search_text}`))
        documents.forEach((item: any, index: number) =>
          personalMemoryStore.saveEmbedding(item.id, localEmbeddingService.modelVersion, vectors[index]))
        indexed += documents.length
      }
      const ann = personalMemoryStore.ensureApproximateVectorIndex(localEmbeddingService.modelVersion)
      return { indexed, ...personalMemoryStore.getEmbeddingStats(localEmbeddingService.modelVersion), ann }
    })().finally(() => { this.vectorIndexPromise = null })
    return this.vectorIndexPromise
  }

  findGraphPath(
    fromId: string,
    toId: string,
    maxDepth = 5,
    allowedRelationIds: Set<string> | null = null,
    entityDirectoryRevision?: string
  ): any {
    if (entityDirectoryRevision) {
      const selection = resolveTrustedEntityPairSelection(this.state.graph.entities, {
        fromId,
        toId,
        expectedRevision: entityDirectoryRevision
      })
      if (selection.stale) throw new Error('关系路径所选实体已经变化，请重新选择起点和终点')
    }
    return findScopedGraphPath(
      fromId,
      toId,
      this.state.graph.entities.filter(isTrustedEntity),
      this.state.graph.relations,
      maxDepth,
      allowedRelationIds
    )
  }

  findCommonNeighbors(fromId: string, toId: string, entityDirectoryRevision?: string): any {
    if (entityDirectoryRevision) {
      const selection = resolveTrustedEntityPairSelection(this.state.graph.entities, {
        fromId,
        toId,
        expectedRevision: entityDirectoryRevision
      })
      if (selection.stale) throw new Error('共同实体查询所选身份已经变化，请重新选择起点和终点')
    }
    const entities = this.state.graph.entities.filter(isTrustedEntity)
    const entityIds = new Set(entities.map(entity => entity.id))
    return {
      from: entities.find(entity => entity.id === fromId) || null,
      to: entities.find(entity => entity.id === toId) || null,
      common: findCommonGraphNeighbors(fromId, toId, entities, this.state.graph.relations.filter(relation =>
        relation.status === 'confirmed' && entityIds.has(relation.subjectId) && entityIds.has(relation.objectId)))
    }
  }

  async askMemory(question: string, conversationId?: string, options: MemorySearchOptions = {}): Promise<any> {
    const query = String(question || '').trim()
    if (!query) throw new Error('请输入问题')
    const explicitEntitySelection = options.entityId
      ? resolveTrustedEntitySelection(this.state.graph.entities, {
          entityId: options.entityId,
          expectedRevision: options.entitySelectionRevision
        })
      : null
    if (explicitEntitySelection?.stale) {
      throw new Error('所选实体已经变化或不再可信，请重新选择实体范围')
    }
    const conversationHistory = conversationId
      ? (personalMemoryStore.getAssistantConversation(conversationId, 8)?.messages || [])
        .filter((message: any) => message.role === 'user' || message.role === 'assistant')
        .map((message: any) => ({ role: message.role, content: String(message.content || '').slice(0, 3000) }))
      : []
    const contextualQuestion = buildContextualMemoryQuestion(query, conversationHistory)
    const trustedEntities = this.state.graph.entities.filter(isTrustedEntity)
    const plan = buildMemoryQueryPlan(contextualQuestion.query, trustedEntities)
    if (contextualQuestion.usedHistory) plan.explanation.unshift('结合上一轮问题解析本次指代')
    const plannedOptions: MemorySearchOptions = {
      ...plan.inferredOptions,
      ...options,
      documentTypes: options.documentTypes?.length ? options.documentTypes : plan.inferredOptions.documentTypes,
      relationTypes: options.relationTypes?.length ? options.relationTypes : plan.inferredOptions.relationTypes,
      sourceIds: options.sourceIds?.length ? options.sourceIds : plan.inferredOptions.sourceIds
    }
    const plannedEntity = plannedOptions.entityId
      ? trustedEntities.find(entity => entity.id === plannedOptions.entityId)
      : null
    const scopeAuditOptions: MemorySearchOptions = plannedEntity ? {
      ...plannedOptions,
      entityTerms: [
        plannedEntity.canonicalName,
        ...(plannedEntity.aliases || []),
        ...(plannedEntity.accountIds || []),
        ...(plannedEntity.externalIdentities || []).flatMap(identity => [identity.accountId, identity.displayName])
      ]
    } : plannedOptions
    const plannedScopeIds = personalMemoryStore.listScopedSearchDocumentIds(scopeAuditOptions)
    if (plannedScopeIds) plan.explanation.push(`召回前范围约束：${plannedScopeIds.size} 个候选文档`)
    const mergedResults = new Map<string, any>()
    let plannedGraphPath: any = null
    if (plan.matchedEntities.length >= 2) {
      if (plannedScopeIds !== null) plan.explanation.push('图路径同样受当前检索范围约束')
      const allowedRelationIds = plannedScopeIds === null
        ? null
        : new Set([...plannedScopeIds]
          .filter(documentId => documentId.startsWith('relation:'))
          .map(documentId => documentId.slice('relation:'.length)))
      plannedGraphPath = this.findGraphPath(
        plan.matchedEntities[0].id,
        plan.matchedEntities[1].id,
        6,
        allowedRelationIds
      )
      if (plannedGraphPath.found && plannedGraphPath.steps.length) {
        const names = new Map(trustedEntities.map(entity => [entity.id, entity.canonicalName]))
        const pathResults = plannedGraphPath.steps.map((step: any) => ({
          id: `relation:${step.relationId}`,
          document_type: 'relation',
          source_id: step.relationId,
          title: step.predicate,
          search_text: `${names.get(step.fromId) || step.fromId} ${step.forward ? step.predicate : `反向:${step.predicate}`} ${names.get(step.toId) || step.toId}`,
          metadata: { subjectId: step.fromId, objectId: step.toId, predicate: step.predicate, status: step.status },
          ...personalMemoryStore.getDocumentEvidencePayload('relation', step.relationId, plannedOptions),
          hybrid_score: 1,
          match_source: '图路径'
        }))
        for (const result of filterMemorySearchResults(
          pathResults,
          plannedOptions,
          plannedScopeIds !== null
        )) mergedResults.set(result.id, result)
        plan.explanation.push(`图路径：${plannedGraphPath.steps.length} 跳`)
      } else {
        plan.explanation.push(plannedScopeIds === null
          ? '图路径：未找到已知连接'
          : '图路径：当前检索范围内未找到已知连接')
      }
    }
    for (const plannedQuery of plan.queries.slice(0, 6)) {
      for (const result of await this.searchMemoryHybrid(plannedQuery, plannedOptions)) {
        const existing = mergedResults.get(result.id)
        if (!existing || Number(result.hybrid_score || 0) > Number(existing.hybrid_score || 0)) mergedResults.set(result.id, result)
      }
    }
    let results = [...mergedResults.values()]
      .sort((left, right) => Number(right.hybrid_score || 0) - Number(left.hybrid_score || 0))
    let usedFallbackTerms = false
    if (!results.length) {
      usedFallbackTerms = true
      const terms = query.match(/[A-Za-z0-9@._-]{2,}|[\u4e00-\u9fff]{2,}/g) || []
      const merged = new Map<string, any>()
      for (const term of terms.slice(0, 6)) {
        for (const result of await this.searchMemoryHybrid(term, plannedOptions)) merged.set(result.id, result)
      }
      results = [...merged.values()]
    }
    // Sub-query feedback is useful inside each retrieval branch, but the final answer
    // must obey feedback bound to the user's actual contextual question and scope.
    // applyMemorySearchFeedback is idempotent, so this removes any prior branch
    // adjustment before applying the final context decision.
    results = this.applyStoredMemorySearchFeedback(contextualQuestion.query, plannedOptions, results)
      .slice(0, usedFallbackTerms ? 30 : 40)
    const mailSource = personalMemoryStore.listDataSources().find(source => source.id === 'mail')
    const context = buildModelMemoryContext(results, {
      mail: { allowModelAnalysis: Boolean(mailSource?.config?.allowModelAnalysis) }
    }, 20)
    if (options.entityId && resolveTrustedEntitySelection(this.state.graph.entities, {
      entityId: options.entityId,
      expectedRevision: options.entitySelectionRevision
    }).stale) {
      throw new Error('所选实体在检索期间发生变化，请重新选择后再提问')
    }
    const apiKey = String(this.config.get('aiAssistantApiKey') || '').trim()
    if (!apiKey) throw new Error('请先设置 DeepSeek API Key')
    const baseUrl = String(this.config.get('aiAssistantApiBaseUrl') || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = String(this.config.get('aiAssistantApiModel') || 'deepseek-v4-flash')
    const redactionLevel = String(this.config.get('aiAssistantSensitiveRedactionLevel') || 'standard') as SensitiveRedactionLevel
    const { entitySelectionRevision: _entitySelectionRevision, ...modelSearchOptions } = plannedOptions
    const outbound = redactSensitiveText(buildUntrustedMemoryQuestionEnvelope({
      question: query,
      conversationHistory,
      queryPlan: plan,
      searchOptions: modelSearchOptions,
      context
    }), redactionLevel)
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: 1800, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: MEMORY_RAG_SYSTEM_PROMPT },
          { role: 'user', content: outbound.text }
        ]
      }),
      signal: AbortSignal.timeout(90_000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek 请求失败 (${response.status})`)
    const parsed = parseModelJson(payload?.choices?.[0]?.message?.content)
    const grounded = finalizeGroundedMemoryAnswer(parsed, context)
    const answer = grounded.answer
    const feedbackContext = buildMemorySearchFeedbackContext(contextualQuestion.query, plannedOptions)
    const feedbackOptions = (() => {
      try { return JSON.parse(feedbackContext.scopeJson) } catch { return {} }
    })()
    const resultById = new Map(results.map(result => [String(result.id || ''), result]))
    const citations = grounded.citations.map(citation => {
      const result = resultById.get(String(citation.documentId || '')) as any
      return {
        ...citation,
        citationFreshness: 'current',
        feedbackContext: {
          query: feedbackContext.query,
          options: feedbackOptions,
          version: MEMORY_SEARCH_FEEDBACK_VERSION
        },
        relevanceFeedback: String(result?.relevance_feedback || '')
      }
    })
    const savedExchange = personalMemoryStore.saveAssistantExchangeDetailed(
      query,
      answer,
      citations,
      conversationId,
      grounded.groundingAudit
    )
    const authenticatedAnswer = this.enrichAssistantCitationFeedback({
      messages: [{
        id: savedExchange.answerMessageId,
        citations
      }]
    })?.messages?.[0]
    const authenticatedCitations = authenticatedAnswer?.citations || citations
    return {
      conversationId: savedExchange.conversationId,
      assistantMessageId: savedExchange.answerMessageId,
      question: query,
      answer,
      uncertainty: String(parsed.uncertainty || ''),
      citations: authenticatedCitations,
      groundedStatements: grounded.statements,
      groundingAudit: grounded.groundingAudit,
      groundingRevalidation: revalidateGroundedStatements(grounded.groundingAudit, authenticatedCitations),
      sensitiveRedaction: outbound.summary,
      queryPlan: {
        ...plan,
        appliedOptions: plannedOptions,
        graphPath: plannedGraphPath ? {
          found: plannedGraphPath.found,
          entities: plannedGraphPath.entities?.map((entity: any) => entity?.canonicalName).filter(Boolean),
          steps: plannedGraphPath.steps?.map((step: any) => ({ predicate: step.predicate, forward: step.forward }))
        } : null
      }
    }
  }

  getAssistantConversations(options?: any): any {
    return personalMemoryStore.listAssistantConversationsPage({
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      revalidationStatus: options?.revalidationStatus,
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 30),
      revision: String(options?.revision || '')
    })
  }

  getAssistantAnswerReviews(options?: any): any {
    return personalMemoryStore.listAssistantAnswerReviewsPage({
      status: options?.status,
      reviewState: options?.reviewState,
      query: String(options?.query || ''),
      from: String(options?.from || ''),
      to: String(options?.to || ''),
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 30),
      revision: String(options?.revision || '')
    })
  }

  reviewAssistantAnswer(
    messageId: string,
    action: 'acknowledged' | 'reopened',
    expectedMutationToken: string
  ): any {
    return personalMemoryStore.reviewAssistantAnswer(
      String(messageId || '').trim(),
      action,
      String(expectedMutationToken || '').trim()
    )
  }

  getAssistantAnswerReviewDecisions(messageId: string, options?: any): any {
    return personalMemoryStore.listAssistantAnswerReviewDecisionsPage(
      String(messageId || '').trim(),
      {
        offset: Number(options?.offset || 0),
        limit: Number(options?.limit || 20),
        revision: String(options?.revision || '')
      }
    )
  }

  private enrichAssistantCitationFeedback(conversation: any): any {
    if (!conversation?.messages?.length) return conversation
    const contextCache = new Map<string, Map<string, string>>()
    const documentCache = new Map<string, any>()
    return {
      ...conversation,
      messages: conversation.messages.map((message: any) => {
        const citations = (message.citations || []).map((citation: any) => {
          const stored = citation?.feedbackContext
          const hasFeedbackContext = stored && typeof stored === 'object'
          const context = hasFeedbackContext
            ? buildMemorySearchFeedbackContext(String(stored.query || ''), stored.options || {})
            : null
          const feedbackOptions = context ? (() => {
            try { return JSON.parse(context.scopeJson) } catch { return {} }
          })() : {}
          let relevanceFeedback = ''
          if (context) {
            const cacheKey = `${context.queryFingerprint}:${context.scopeFingerprint}`
            let decisions = contextCache.get(cacheKey)
            if (!decisions) {
              decisions = new Map(personalMemoryStore.listMemorySearchFeedback(
                context.queryFingerprint,
                context.scopeFingerprint,
                500
              ).map(entry => [String(entry.documentId || ''), String(entry.action || '')]))
              contextCache.set(cacheKey, decisions)
            }
            relevanceFeedback = decisions.get(String(citation.documentId || '')) || ''
          }
          const documentKey = `${context?.scopeFingerprint || 'unscoped'}:${citation.documentId || ''}`
          if (!documentCache.has(documentKey)) {
            documentCache.set(documentKey, personalMemoryStore.getSearchDocumentById(
              String(citation.documentId || ''),
              feedbackOptions
            ))
          }
          const document = documentCache.get(documentKey)
          const canonicalFeedbackContext = context ? {
            query: context.query,
            options: feedbackOptions,
            version: MEMORY_SEARCH_FEEDBACK_VERSION
          } : undefined
          if (!document) return {
            ...citation,
            content: '',
            evidence: [],
            citationUnavailable: true,
            citationHydration: 'source_missing',
            citationFreshness: 'missing',
            relevanceFeedback,
            ...(canonicalFeedbackContext ? { feedbackContext: canonicalFeedbackContext } : {})
          }
          const eligibility = getMemoryEvidenceEligibility(document)
          const answerTimeContentHash = /^[a-f0-9]{64}$/i.test(String(citation.contentHash || ''))
            ? String(citation.contentHash).toLowerCase()
            : ''
          const currentContentHash = /^[a-f0-9]{64}$/i.test(String(document.content_hash || ''))
            ? String(document.content_hash).toLowerCase()
            : ''
          const citationFreshness = getMemoryCitationFreshness({
            answerTimeContentHash,
            currentContentHash,
            canSupportFacts: eligibility.canSupportFacts
          })
          const hydratedCitation = {
            ...citation,
            answerTimeTitle: citation.title || '',
            answerTimeContentHash,
            currentContentHash,
            sourceId: document.source_id,
            type: document.document_type,
            title: document.title,
            content: document.search_text,
            status: eligibility.status,
            trustLabel: eligibility.trustLabel,
            evidence: document.evidence || [],
            evidenceTotal: Math.max(
              Array.isArray(document.evidence) ? document.evidence.length : 0,
              Number(document.evidenceTotal || 0)
            ),
            canSupportFacts: eligibility.canSupportFacts,
            citationUnavailable: false,
            citationHydration: context ? 'authoritative_scoped' : 'authoritative_scope_unknown',
            citationFreshness,
            citationContentChanged: citationFreshness === 'changed',
            relevanceFeedback,
            ...(canonicalFeedbackContext ? { feedbackContext: canonicalFeedbackContext } : {})
          }
          return {
            ...hydratedCitation,
            reviewToken: buildMemoryCitationReviewToken(buildMemoryCitationReviewIdentity({
              assistantMessageId: String(message.id || ''),
              document,
              scopeFingerprint: context?.scopeFingerprint || 'unscoped'
            }))
          }
        })
        return {
          ...message,
          citations,
          groundingRevalidation: revalidateGroundedStatements(message.groundingAudit, citations)
        }
      })
    }
  }

  getAssistantConversation(id: string, options?: any): any {
    const page = personalMemoryStore.getAssistantConversation(String(id || '').trim(), {
      offset: Number(options?.offset || 0),
      limit: Number(options?.limit || 40),
      anchorMessageId: String(options?.anchorMessageId || ''),
      revision: String(options?.revision || '')
    })
    if (!page || page.stale) return page
    const enriched = this.enrichAssistantCitationFeedback(page)
    const completedRevision = personalMemoryStore.getAssistantHistoryRevision()
    if (completedRevision !== page.revision) {
      return {
        id: page.id,
        messages: [],
        total: 0,
        offset: page.offset,
        limit: page.limit,
        anchorMessageId: '',
        anchorFound: false,
        hasNewer: false,
        hasOlder: false,
        revision: completedRevision,
        stale: true
      }
    }
    return enriched
  }

  previewDeleteAssistantConversation(id: string): any {
    const preview = personalMemoryStore.previewDeleteAssistantConversation(String(id || '').trim())
    return {
      ...preview,
      previewToken: buildAssistantConversationDeletionPreviewToken({
        conversationId: preview.conversationId,
        identitySha256: preview.identitySha256
      })
    }
  }

  deleteAssistantConversation(id: string, input?: any): boolean {
    const conversationId = String(id || '').trim()
    const preview = personalMemoryStore.previewDeleteAssistantConversation(conversationId)
    assertAssistantConversationDeletionConfirmation(input || {}, {
      conversationId: preview.conversationId,
      identitySha256: preview.identitySha256
    })
    return personalMemoryStore.deleteAssistantConversation(conversationId)
  }

  correctClaim(id: string, input: any, expectedRevision?: string): any {
    assertStructuredMemoryMutationRevision(
      expectedRevision,
      personalMemoryStore.getStructuredMemoryRevision()
    )
    this.assertStructuredEntityTrust('claim', id)
    return personalMemoryStore.correctClaim(id, input)
  }

  correctEvent(id: string, input: any, expectedRevision?: string): any {
    assertStructuredMemoryMutationRevision(
      expectedRevision,
      personalMemoryStore.getStructuredMemoryRevision()
    )
    this.assertStructuredEntityTrust('event', id)
    return personalMemoryStore.correctEvent(id, input)
  }

  getMemoryEvent(id: string): any {
    const revision = personalMemoryStore.getStructuredMemoryRevision()
    const event = personalMemoryStore.getEvent(id)
    const completedRevision = personalMemoryStore.getStructuredMemoryRevision()
    if (completedRevision !== revision) {
      throw new Error('事实与事件档案在读取期间发生了变化，请重新打开')
    }
    return event ? { ...event, structuredMemoryRevision: revision } : null
  }

  private async schedulerTick(
    source: 'timer' | 'system_resume' = 'timer',
    observedNow?: Date
  ): Promise<string> {
    const now = observedNow || new Date()
    const nowMs = now.getTime()
    const wake = assessSchedulerWake(
      this.lastSchedulerTickAt,
      nowMs,
      source === 'system_resume'
    )
    this.lastSchedulerTickAt = nowMs
    if (wake.reason !== 'regular') {
      this.state.cursor.lastSchedulerWakeAt = now.toISOString()
      this.state.cursor.lastSchedulerWakeReason = wake.reason
      this.state.cursor.lastSchedulerGapMs = wake.elapsedMs
      if (wake.resetAttemptThrottle) {
        this.lastSchedulerAttemptAt = 0
        if (this.state.cursor.lastScheduledError) {
          this.state.cursor.nextScheduledRetryAt = now.toISOString()
        }
        if (this.state.cursor.resumeCatchupRetry.pendingSince) {
          this.state.cursor.resumeCatchupRetry.nextAttemptAt = now.toISOString()
        }
        if (this.state.cursor.pendingSessionBacklogCount > 0 &&
            this.state.cursor.backlogRetry.nextAttemptAt) {
          this.state.cursor.backlogRetry.nextAttemptAt = now.toISOString()
        }
      }
      this.saveState()
    }
    if (!this.config.get('aiAssistantEnabled')) return 'assistant_disabled'
    if (!this.activeSync) await this.flushNotificationOutbox(now)
    if (this.activeSync) return 'sync_already_running'
    if (isResumeCatchupRetryDue(this.state.cursor.resumeCatchupRetry, nowMs)) {
      if (nowMs - this.lastSchedulerAttemptAt < 60_000) return 'resume_retry_throttled'
      this.lastSchedulerAttemptAt = nowMs
      try {
        const result = await this.sync('resume')
        return result?.success === true && !result?.partial && !result?.cancelled
          ? 'resume_retry_completed'
          : 'resume_retry_partial'
      } catch {
        return 'resume_retry_failed'
      }
    }
    const wechatSource = personalMemoryStore.listDataSources().find(source => source.id === 'wechat')
    if (isBacklogRetryDue({
      state: this.state.cursor.backlogRetry,
      offsets: this.state.cursor.sessionOffsets,
      sourceEnabled: Boolean(wechatSource?.enabled),
      now
    })) {
      if (nowMs - this.lastSchedulerAttemptAt < 60_000) return 'backlog_throttled'
      this.lastSchedulerAttemptAt = nowMs
      try {
        await this.sync('backlog')
      } catch {}
      return 'backlog_catchup_attempted'
    }
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const today = shanghaiDate(nowMs)
    const schedule = String(this.config.get('aiAssistantScheduleTime') || '20:00')
    const dailyDue = time >= schedule && this.state.cursor.lastScheduledRunDate !== today
    if (!dailyDue) {
      if (source === 'system_resume' && shouldRunResumeCatchup(
        wake.elapsedMs,
        this.state.cursor.lastAttemptAt,
        nowMs
      )) {
        try {
          const result = await this.sync('resume')
          return result?.success === true && !result?.partial && !result?.cancelled
            ? 'resume_incremental_completed'
            : 'resume_incremental_partial'
        } catch {
          return 'resume_incremental_failed'
        }
      }
      if (source === 'system_resume' && wake.elapsedMs >= 5 * 60_000) {
        return 'resume_incremental_throttled'
      }
      return time < schedule ? 'before_daily_schedule' : 'daily_already_complete'
    }
    const nextScheduledRetryAt = Date.parse(String(this.state.cursor.nextScheduledRetryAt || ''))
    if (
      this.state.cursor.lastScheduledError
      && Number.isFinite(nextScheduledRetryAt)
      && nextScheduledRetryAt > nowMs
    ) return 'scheduled_retry_cooling_down'
    if (nowMs - this.lastSchedulerAttemptAt < 15 * 60_000) return 'daily_throttled'
    this.lastSchedulerAttemptAt = nowMs
    this.state.cursor.lastScheduledAttemptAt = now.toISOString()
    this.saveState()
    try {
      const result = await this.sync('daily')
      const assessment = assessScheduledSyncResult(result)
      const completedAt = new Date().toISOString()
      Object.assign(this.state.cursor, planScheduledSyncState(
        this.state.cursor,
        {
          ...assessment,
          reason: assessment.complete ? '' : sanitizeDiagnosticText(assessment.reason)
        },
        today,
        completedAt
      ))
      if (!assessment.complete) {
        this.saveState()
        return 'daily_partial_saved'
      }
      const reminders = applyReminderPreferences(
        buildTaskReminders(this.state.tasks.filter(task => task.classification === 'mine'), now),
        this.state.reminderPreferences,
        now
      ).visible
      if (reminders.length && this.state.cursor.lastReminderNotificationDate !== today) {
        this.enqueueNotification({
          key: `task-reminders:${today}`,
          title: `AI 助理：${reminders.length} 项需要留意`,
          content: reminders.slice(0, 2).map(item => `${item.title}（${item.reason}）`).join('；'),
          createdAt: now.toISOString()
        })
        this.state.cursor.lastReminderNotificationDate = today
      }
      this.saveState()
      await this.flushNotificationOutbox(now)
      return 'daily_completed'
    } catch (error) {
      Object.assign(this.state.cursor, planScheduledSyncState(
        this.state.cursor,
        { complete: false, reason: sanitizeDiagnosticText(error) },
        today,
        new Date().toISOString()
      ))
      this.saveState()
      return 'daily_failed_saved'
    }
  }

  private isNotificationQuiet(now: Date): boolean {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(now)
    return isQuietTime(
      time,
      String(this.config.get('aiAssistantQuietStart') || '22:00'),
      String(this.config.get('aiAssistantQuietEnd') || '08:00')
    )
  }

  private enqueueNotification(notification: { key: string; title: string; content: string; createdAt: string }): boolean {
    return enqueueUniqueNotification(this.state.notifications, notification)
  }

  private async flushNotificationOutbox(now: Date): Promise<void> {
    if (this.isNotificationQuiet(now) || !this.state.notifications.pending.length) return
    if (this.notificationFlushPromise) return this.notificationFlushPromise
    this.notificationFlushPromise = (async () => {
      await deliverNotificationBatch(this.state.notifications, async notification => {
        await showSystemNotification({
          title: notification.title,
          content: notification.content,
          channel: 'ai-assistant',
          targetRoute: '/ai-assistant'
        })
      }, {
        limit: 5,
        normalizeError: sanitizeDiagnosticText,
        onAttempt: () => this.saveState()
      })
    })()
    try {
      await this.notificationFlushPromise
    } finally {
      this.notificationFlushPromise = null
    }
  }
}

export const aiAssistantService = new AiAssistantService()
