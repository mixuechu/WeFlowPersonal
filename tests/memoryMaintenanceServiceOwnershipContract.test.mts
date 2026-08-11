import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)
const page = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)

const between = (startText: string, endText: string): string => {
  const start = service.indexOf(startText)
  const end = service.indexOf(endText, start + startText.length)
  assert.notEqual(start, -1, `${startText} must exist`)
  assert.notEqual(end, -1, `${endText} must follow ${startText}`)
  return service.slice(start, end)
}

test('the main process owns one lease across every mutating memory maintenance entry', () => {
  const ownership = between(
    '  private beginMemoryMaintenance(',
    '  private getMemoryMaintenanceStatus()'
  )
  assert.match(ownership, /if \(this\.memoryMaintenanceLease\)/)
  assert.match(ownership, /this\.memoryMaintenanceLease = lease/)
  assert.match(ownership, /this\.memoryMaintenanceLease\?\.token !== lease\.token/)
  assert.match(ownership, /this\.memoryMaintenancePromise = operation/)
  assert.match(ownership, /this\.finishMemoryMaintenance\(lease\)/)

  assert.match(service, /runMemoryMaintenanceSync\('backup_create'/)
  assert.match(service, /runMemoryMaintenanceSync\('backup_restore'/)
  assert.match(service, /runMemoryMaintenanceAsync\('backup_delete'/)
  assert.match(service, /runMemoryMaintenanceAsync\('import_staging_discard'/)
  assert.match(service, /runMemoryMaintenanceAsync\('bundle_export'/)
  assert.match(service, /runMemoryMaintenanceAsync\('bundle_import'/)
})

test('restore and import retain the same lease through safety snapshot and replacement', () => {
  const restore = between('  restoreMemoryBackup(', '  private inspectMemoryBackupForDeletion(')
  assert.match(restore, /applyMemoryBackup\(inspected\.preview\.path, inspected\.restoredState, lease\)/)

  const apply = between('  private applyMemoryBackup(', '  private async readMemoryBundle(')
  assert.match(apply, /assertMemoryMaintenanceLease\(maintenanceLease\)/)
  assert.match(apply, /createMemoryBackupWithLease\(\[path\], \{ maintenanceLease \}\)/)

  const imported = between('  async importMemoryBundle(', '  private getOwnerEntityPresentation(')
  assert.ok((imported.match(/assertMemoryImportConfirmation\(/g) || []).length >= 2)
  assert.match(imported, /assertMemoryReplacementIdle\(\)/)
  assert.match(imported, /applyMemoryBackup\(imported\.path, undefined, lease\)/)
})

test('maintenance ownership blocks new writers and participates in shutdown and diagnostics', () => {
  assert.match(service, /\{ name: 'memory_maintenance', promise: this\.memoryMaintenancePromise \}/)
  for (const marker of [
    "async sync(trigger:",
    'async repairMemorySearchIndexes()',
    'async ensureVectorIndex(options:',
    'auditActiveTaskLifecycles()',
    'async askMemory(question:',
    'async retryResourceEnrichmentBatch(',
    'async retryResourceEnrichment(input:'
  ]) {
    const start = service.indexOf(marker)
    assert.notEqual(start, -1, `${marker} must exist`)
    assert.match(service.slice(start, start + 1_500), /this\.memoryMaintenanceLease/)
  }
  assert.ok((service.match(/memoryMaintenance: this\.getMemoryMaintenanceStatus\(\)/g) || []).length >= 2)
  assert.match(page, /Boolean\(status\?\.memoryMaintenance\?\.active\)/)
  assert.match(page, /status\?\.memoryMaintenance\?\.message/)
})

test('import staging conflicts have a content-bound trash preview and visible review flow', () => {
  const discard = between(
    '  private inspectImportedBackupStagingConflictForDiscard(',
    '  private applyMemoryBackup('
  )
  assert.match(discard, /readFileSync\(path\)/)
  assert.match(discard, /sha256: crypto\.createHash\('sha256'\)/)
  assert.match(discard, /bytes\.fill\(0\)/)
  assert.match(discard, /String\(input\.previewToken \|\| ''\) !== inspected\.previewToken/)
  assert.match(discard, /String\(input\.confirmation \|\| ''\) !== '移到废纸篓'/)
  assert.match(discard, /stageMemoryArtifactsTrash\(/)
  assert.match(discard, /shell\.trashItem\(stagingDirectory\)/)
  assert.match(discard, /rollbackStagedMemoryBackupTrash\(staged\)/)
  assert.doesNotMatch(discard, /preview:\s*\{[\s\S]{0,500}\bpath:/)

  assert.match(page, /导入暂存需人工检查/)
  assert.match(page, /openImportedBackupStagingDialog/)
  assert.match(page, /discardImportedBackupStagingConflict/)
  assert.match(page, /预览后任一内容变化都会使本次确认失效/)
})
