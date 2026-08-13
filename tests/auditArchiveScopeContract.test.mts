import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types/electron.d.ts', import.meta.url), 'utf8')

test('audit archive service wrapper fails closed before filtered SQL reads', () => {
  assert.match(service, /private withAuditArchiveScope\([\s\S]*offset > 0 &&[\s\S]*original\?\.archiveScopeToken[\s\S]*!== archiveScopeToken[\s\S]*archiveScopeStale: true/)
  for (const binding of [
    'buildTaskOwnershipScopeToken', 'buildTaskFeedbackScopeToken',
    'buildDeletionAuditScopeToken', 'buildMaintenanceAuditScopeToken',
    'buildMemoryGrowthScopeToken', 'buildMergeHistoryScopeToken',
    'buildIngestionRunScopeToken', 'buildIngestionRecoveryScopeToken',
    'buildCrossStoreRecoveryScopeToken', 'buildCrossStoreRecoveryArchiveScopeToken'
    , 'buildResourceArchiveScopeToken', 'buildResourceTrashScopeToken'
    , 'buildMemoryItemAuditScopeToken', 'buildEventCorrectionSnapshotScopeToken'
    , 'buildEntityAuditScopeToken', 'buildEventDossierParticipantScopeToken',
    'buildRelationDossierAuditScopeToken'
  ]) assert.match(service, new RegExp(`withAuditArchiveScope\\([\\s\\S]{0,80}?normalized,[\\s\\S]{0,40}?options,[\\s\\S]{0,80}?${binding}`))
})

test('composite dossiers decorate embedded first pages before enforcing continuation tokens', () => {
  assert.match(service, /private decorateStructuredMemoryDossier\([\s\S]*item\.auditPage[\s\S]*buildMemoryItemAuditScopeToken/)
  assert.match(service, /item\.participantPage[\s\S]*buildEventDossierParticipantScopeToken/)
  assert.match(service, /\['historyPage', 'history'\][\s\S]*buildRelationDossierAuditScopeToken/)
  assert.match(service, /auditPageMeta\(relationHistoryPage, 'relation_history'\)/)
  assert.match(page, /revision: page\.revision,[\s\S]*archiveScopeToken: page\.archiveScopeToken/)
  assert.match(page, /revision: String\(page\.revision \|\| ''\),[\s\S]*archiveScopeToken: page\.archiveScopeToken/)
  assert.match(page, /revision: pageMeta\.revision,[\s\S]*archiveScopeToken: pageMeta\.archiveScopeToken/)
})

test('memory audit and correction snapshot continuations bind their parent identity', () => {
  assert.match(page, /loadMore \? current\.archiveScopeToken : ''/)
  assert.match(page, /archiveScopeToken: archive\.archiveScopeToken/)
  assert.match(service, /withAuditArchiveScope\(normalized, options, buildMemoryItemAuditScopeToken/)
  assert.match(service, /withAuditArchiveScope\([\s\S]{0,100}?normalized, options, buildEventCorrectionSnapshotScopeToken/)
})

test('resource and trash continuations bind filters plus parser/model semantics', () => {
  assert.match(page, /revision: resourceArchive\.revision,[\s\S]*?archiveScopeToken: resourceArchive\.archiveScopeToken/)
  assert.match(page, /revision: resourceTrashArchive\.revision,[\s\S]*?archiveScopeToken: resourceTrashArchive\.archiveScopeToken/)
  assert.match(service, /attachmentStructureParserVersion: ATTACHMENT_STRUCTURE_PARSER_VERSION,[\s\S]*imageSemanticModelVersion:[\s\S]*withAuditArchiveScope\(normalized, options, buildResourceArchiveScopeToken/)
})

test('incremental and recovery continuations carry their first-page range identity', () => {
  for (const state of [
    'ingestionArchive', 'ingestionRecoveryQueue',
    'crossStoreRecoveryQueue', 'crossStoreRecoveryArchive'
  ]) assert.match(page, new RegExp(`revision: ${state}\\.revision,[\\s\\S]*?archiveScopeToken: ${state}\\.archiveScopeToken`))
  assert.match(types, /getIngestionRunPage:[\s\S]*?archiveScopeToken\?: string[\s\S]*?archiveScopeStale\?: boolean/)
})

test('every audit continuation carries its first-page range identity', () => {
  for (const state of [
    'taskOwnershipReviews', 'taskFeedbackArchive', 'memoryDeletionArchive',
    'memoryMaintenanceArchive', 'memoryGrowth', 'entityMemoryGrowth', 'mergeArchive'
  ]) assert.match(page, new RegExp(`revision: ${state}\\.revision,[\\s\\S]*?archiveScopeToken: ${state}\\.archiveScopeToken`))
  for (const method of [
    'getTaskOwnershipReviews', 'getTaskReviewDecisionPage', 'getMemoryDeletionAuditPage',
    'getMemoryMaintenanceAuditPage', 'getMemoryChangeLogPage', 'getMergeHistoryPage'
  ]) assert.match(types, new RegExp(`${method}:[\\s\\S]*?archiveScopeToken\\?: string[\\s\\S]*?archiveScopeStale\\?: boolean`))
})

test('fixed-parent dossier continuations bind the selected task, entity, or project', () => {
  for (const builder of [
    'buildTaskHistoryScopeToken', 'buildProjectMemberScopeToken'
  ]) assert.match(service, new RegExp(`withAuditArchiveScope\\([\\s\\S]{0,100}?normalized, options, ${builder}`))
  for (const [method, nextMethod, builder] of [
    ['getEntityTaskPage', 'getEntityAuditPage', 'buildEntityTaskScopeToken'],
    ['getProjectTaskPage', 'getProjectRiskPage', 'buildProjectTaskScopeToken'],
    ['getProjectRiskPage', 'getEventTimeline', 'buildProjectRiskScopeToken']
  ]) {
    const start = service.indexOf(`  ${method}(`)
    const end = service.indexOf(`\n  ${nextMethod}(`, start)
    const methodSource = service.slice(start, end)
    assert.match(methodSource, new RegExp(`${builder}\\(`))
    assert.match(methodSource, /archiveScopeStale: true/)
  }
  for (const token of [
    'focus.taskArchiveScopeToken', 'project.memberArchiveScopeToken',
    'project.taskArchiveScopeToken', 'project.riskArchiveScopeToken',
    'taskWorkspace.historyArchiveScopeToken'
  ]) assert.match(page, new RegExp(`archiveScopeToken: ${token.replaceAll('.', '\\.')}`))
  assert.match(service, /const today = shanghaiDate\(\)[\s\S]*buildProjectRiskScopeToken\(\{ projectId: id, today \}\)[\s\S]*listProjectRiskPage\(names, today/)
})

test('assistant archives, reminders, and correction participants retain their first-page identity', () => {
  for (const builder of [
    'buildAssistantConversationScopeToken', 'buildAssistantModelAuditScopeToken',
    'buildAssistantAnswerReviewScopeToken', 'buildAssistantAnswerDecisionScopeToken',
    'buildEventCorrectionParticipantScopeToken'
  ]) assert.match(service, new RegExp(`withAuditArchiveScope\\([\\s\\S]{0,120}?normalized, options, ${builder}`))
  assert.match(service, /queryTaskReminderPage[\s\S]*buildTaskReminderScopeToken[\s\S]*archiveScopeStale: true[\s\S]*listTaskReminderPage/)
  assert.match(service, /getAssistantModelRequestAudits[\s\S]*requestKind: String\(options\?\.requestKind \|\| ''\)[\s\S]*listAssistantModelRequestAuditsPage/)
  for (const token of [
    'taskReminderPage.archiveScopeToken', 'assistantArchive.archiveScopeToken',
    'modelRequestAudits.archiveScopeToken', 'assistantAnswerReviews.archiveScopeToken',
    'history.archiveScopeToken'
  ]) assert.match(page, new RegExp(`archiveScopeToken: ${token.replaceAll('.', '\\.')}`))
  assert.match(page, /participantArchiveScopeToken[\s\S]*archiveScopeToken/)
})

test('long composite histories bind their conversation anchor or ingestion run', () => {
  const conversationStart = service.indexOf('  getAssistantConversation(')
  const conversationEnd = service.indexOf('\n  previewDeleteAssistantConversation(', conversationStart)
  const conversation = service.slice(conversationStart, conversationEnd)
  assert.match(conversation, /buildAssistantConversationMessageScopeToken/)
  assert.match(conversation, /offset > 0[\s\S]*archiveScopeStale: true[\s\S]*getAssistantConversation\(conversationId/)
  assert.match(page, /conversationScopeAnchorMessageId: memoryConversation\.anchorMessageId[\s\S]*archiveScopeToken: memoryConversation\.archiveScopeToken/)
  assert.match(page, /offset: current\.offset,[\s\S]*anchorMessageId: current\.anchorMessageId/)

  const ingestionStart = service.indexOf('  getIngestionRunDossier(')
  const ingestionEnd = service.indexOf('\n  getIngestionRecoveryPage(', ingestionStart)
  const ingestion = service.slice(ingestionStart, ingestionEnd)
  assert.match(ingestion, /buildIngestionRunDossierScopeToken/)
  assert.match(ingestion, /normalized\.offset > 0[\s\S]*archiveScopeStale: true[\s\S]*getIngestionRunDossier/)
  assert.match(page, /revision: ingestionDossier\.revision,[\s\S]*archiveScopeToken: ingestionDossier\.archiveScopeToken/)
})

test('feedback histories retain their filtered archive or evidence parent identity', () => {
  assert.match(service, /getTaskReviewDecisionDossier[\s\S]*buildTaskFeedbackDossierScopeToken[\s\S]*archiveScopeStale: true[\s\S]*getTaskReviewDecisionDossier/)
  assert.match(page, /revision: taskFeedbackDossier\.revision,[\s\S]*archiveScopeToken: taskFeedbackDossier\.archiveScopeToken/)
  assert.match(service, /withAuditArchiveScope\([\s\S]{0,120}?normalized, options, buildMemorySearchFeedbackArchiveScopeToken/)
  assert.match(page, /revision: memoryFeedbackArchive\.revision,[\s\S]*archiveScopeToken: memoryFeedbackArchive\.archiveScopeToken/)
  assert.match(page, /\[field\]: \{[\s\S]*revision: page\.revision,[\s\S]*archiveScopeToken: page\.archiveScopeToken/)
})
