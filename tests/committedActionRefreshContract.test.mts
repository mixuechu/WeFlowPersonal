import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

const functionBody = (name: string, nextName: string): string => {
  const start = pageSource.indexOf(`  const ${name} =`)
  const end = pageSource.indexOf(`  const ${nextName} =`, start + 1)
  assert.notEqual(start, -1, `${name} must exist`)
  assert.notEqual(end, -1, `${nextName} must follow ${name}`)
  return pageSource.slice(start, end)
}

test('committed action refresh preserves the authoritative success result', () => {
  const body = functionBody('refreshDashboardAfterCommittedAction', 'retryNotificationDelivery')
  assert.match(body, /setMessage\(successMessage\)/)
  assert.match(body, /await load\(\)/)
  assert.match(body, /catch \{/)
  assert.match(body, /首页状态暂时无法刷新/)
  assert.doesNotMatch(body, /throw error/)
})

test('daily action mutations separate commit success from dashboard refresh failure', () => {
  const retryStart = pageSource.indexOf('  const retryNotificationDelivery =')
  const retryEnd = pageSource.indexOf('\n  useEffect(() =>', retryStart)
  assert.notEqual(retryStart, -1)
  assert.notEqual(retryEnd, -1)
  const retryBody = pageSource.slice(retryStart, retryEnd)
  assert.match(retryBody, /refreshDashboardAfterCommittedAction\(/)
  assert.doesNotMatch(retryBody, /catch[\s\S]*await load\(\)/)

  const cases = [
    ['syncNow', 'cancelSync'],
    ['cancelSync', 'auditTaskLifecycles'],
    ['auditTaskLifecycles', 'loadSettingsForDialog'],
    ['toggleTask', 'restoreArchivedTask'],
    ['restoreArchivedTask', 'loadMoreTaskArchive']
  ] as const
  for (const [name, nextName] of cases) {
    const body = functionBody(name, nextName)
    assert.match(body, /refreshDashboardAfterCommittedAction\(/, name)
    assert.doesNotMatch(body, /catch[\s\S]*await load\(\)/, name)
  }
})

test('destructive committed actions cannot reopen as failures only because dashboard refresh failed', () => {
  const cases = [
    ['restoreMemory', 'openMemoryBackupDeleteDialog'],
    ['importMemoryBundle', 'closeMigrationDialog'],
    ['confirmForgetSelectedEntity', 'toggleSource'],
    ['confirmRevertMerge', 'previewRestoreRejectedEntity'],
    ['confirmRestoreRejectedEntity', 'loadMoreMergeHistory'],
    ['confirmPermanentMemoryDeletion', 'ignoreMemoryItem'],
    ['restoreMemoryResource', 'purgeMemoryResourceTrash'],
    ['confirmResourceDeletion', 'saveClaimCorrection'],
    ['confirmConversationDeletion', 'createTaskFromMemory'],
    ['confirmCreateTaskFromMemory', 'reviewMemoryCitation']
  ] as const
  for (const [name, nextName] of cases) {
    const body = functionBody(name, nextName)
    assert.match(body, /refreshDashboardAfterCommittedAction\(/, name)
    assert.doesNotMatch(body, /await load\(\)/, name)
  }
})

test('routine edits and human review decisions preserve their committed result', () => {
  const cases = [
    ['updateReminderPreference', 'loadMoreTaskReminders'],
    ['retryResourceEnrichment', 'resourceEnrichmentBatchInput'],
    ['runResourceEnrichmentBatch', 'cancelResourceEnrichmentBatch'],
    ['updateProjectMemoryStatus', 'focusProjectCandidateSection'],
    ['saveTask', 'completeVisibleTasks'],
    ['completeVisibleTasks', 'loadMoreActiveTasks'],
    ['decideTaskReview', 'reviewMineTaskOwnership'],
    ['reviewMineTaskOwnership', 'revertTaskReview'],
    ['revertTaskReview', 'revertMerge'],
    ['updateMemoryStatus', 'updateEntityDossierMemoryStatus'],
    ['updateEntityDossierMemoryStatus', 'permanentlyDeleteMemoryItem'],
    ['saveClaimCorrection', 'beginEventCorrection'],
    ['saveEventCorrection', 'loadMoreEditingEventParticipants'],
    ['rejectEntityRelation', 'restoreEntityRelation'],
    ['restoreEntityRelation', 'openClaimCorrection'],
    ['retryPreparedIngestion', 'loadCrossStoreRecoveryQueue'],
    ['retryCrossStoreRecovery', 'openCrossStoreAbandonPreview'],
    ['confirmCrossStoreAbandon', 'openTaskFeedbackDossier'],
    ['decideReview', 'decideTaskReview'],
    ['reviewMemoryCitation', 'openRelationCitationCorrection'],
    ['saveRelationCitationCorrection', 'rejectEntityRelation']
  ] as const
  for (const [name, nextName] of cases) {
    const body = functionBody(name, nextName)
    assert.match(body, /refreshDashboardAfterCommittedAction\(/, name)
  }
})

test('answer persistence cannot be reported as failed by follow-up hydration', () => {
  const body = functionBody('askMemory', 'selectMemoryEntityScope')
  assert.match(body, /getAssistantConversation\(answer\.conversationId\)[\s\S]*\.catch\(\(\) => null\)/)
  assert.match(body, /await load\(\)\.catch\(\(\) => \{\}\)/)
})
