import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

const between = (startText: string, endText: string): string => {
  const start = page.indexOf(startText)
  const end = page.indexOf(endText, start + startText.length)
  assert.notEqual(start, -1, `${startText} must exist`)
  assert.notEqual(end, -1, `${endText} must follow ${startText}`)
  return page.slice(start, end)
}

test('backup creation, restore, and deletion share one synchronous operation lock', () => {
  assert.match(page, /const memoryBackupMutationLock = useRef\(false\)/)
  assert.match(page, /const memoryBackupCreateGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(page, /const memoryRestoreGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(page, /const memoryBackupDeleteGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(
    page,
    /const memoryBackupOperationBusy = backingUpMemory \|\| restoringMemory \|\| deletingMemoryBackup \|\|[\s\S]*memoryBackupDeleteDialog\?\.status === 'deleting'/
  )

  for (const [start, end] of [
    ['  const backupMemory =', '  const openMemoryRestoreDialog ='],
    ['  const openMemoryRestoreDialog =', '  const closeMemoryRestoreDialog ='],
    ['  const restoreMemory =', '  const openMemoryBackupDeleteDialog ='],
    ['  const openMemoryBackupDeleteDialog =', '  const closeMemoryBackupDeleteDialog ='],
    ['  const deleteMemoryBackup =', '  const openExportMemoryBundle =']
  ] as const) {
    const operation = between(start, end)
    assert.match(operation, /memoryBackupMutationLock\.current/)
    assert.match(operation, /memoryBackupMutationLock\.current = true/)
    assert.match(operation, /memoryBackupMutationLock\.current = false/)
  }
})

test('every backup preview or mutation rejects late success and error results', () => {
  const cases = [
    ['  const backupMemory =', '  const openMemoryRestoreDialog =', 'memoryBackupCreateGate'],
    ['  const openMemoryRestoreDialog =', '  const closeMemoryRestoreDialog =', 'memoryRestoreGate'],
    ['  const restoreMemory =', '  const openMemoryBackupDeleteDialog =', 'memoryRestoreGate'],
    ['  const openMemoryBackupDeleteDialog =', '  const closeMemoryBackupDeleteDialog =', 'memoryBackupDeleteGate'],
    ['  const deleteMemoryBackup =', '  const openExportMemoryBundle =', 'memoryBackupDeleteGate']
  ] as const
  for (const [start, end, gate] of cases) {
    const operation = between(start, end)
    assert.match(operation, new RegExp(`${gate}\\.current\\.begin\\(\\)`))
    assert.ok(
      (operation.match(new RegExp(`${gate}\\.current\\.isCurrent\\(`, 'g')) || []).length >= 3,
      `${start} must gate success, error, and cleanup`
    )
  }
})

test('closing either preview invalidates its pending read and releases ownership', () => {
  const restoreClose = between('  const closeMemoryRestoreDialog =', '  const restoreMemory =')
  assert.match(restoreClose, /memoryRestoreGate\.current\.invalidate\(\)/)
  assert.match(restoreClose, /memoryBackupMutationLock\.current = false/)

  const deleteClose = between('  const closeMemoryBackupDeleteDialog =', '  const deleteMemoryBackup =')
  assert.match(deleteClose, /memoryBackupDeleteGate\.current\.invalidate\(\)/)
  assert.match(deleteClose, /memoryBackupMutationLock\.current = false/)
})

test('the backup directory disables every competing action while an operation owns it', () => {
  const health = between('<div className="assistant-memory-health-actions">', '</section>')
  assert.match(health, /disabled=\{memoryBackupOperationBusy \|\| !memoryDiagnostics\.healthy/)
  assert.match(health, /disabled=\{memoryBackupOperationBusy \|\| !availability\.enabled\}/)
  assert.match(health, /disabled=\{memoryBackupOperationBusy\}/)
})
