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

test('backup, migration, and vector maintenance share one visible and synchronous owner', () => {
  assert.match(
    page,
    /const memoryMaintenanceBusy = memoryBackupOperationBusy \|\| migratingMemory \|\| indexingVectors \|\|[\s\S]*Boolean\(status\?\.memoryMaintenance\?\.active\)/
  )
  assert.match(page, /const memoryMaintenanceLock = useRef\(false\)/)
  assert.match(page, /const memoryMigrationGate = useRef\(new LatestRequestGate\(\)\)/)
  assert.match(page, /const memoryVectorIndexGate = useRef\(new LatestRequestGate\(\)\)/)

  const health = between('<div className="assistant-memory-health-actions">', '</section>')
  assert.ok((health.match(/disabled=\{memoryMaintenanceBusy/g) || []).length >= 5)
})

test('export owns the file dialog and rejects late selection, commit, and error results', () => {
  const operation = between('  const exportMemoryBundle =', '  const openImportMemoryBundle =')
  assert.match(operation, /if \(memoryMaintenanceBusy \|\| memoryMaintenanceLock\.current\) return/)
  assert.match(operation, /memoryMaintenanceLock\.current = true/)
  assert.match(operation, /memoryMigrationGate\.current\.begin\(\)/)
  assert.match(operation, /setMigratingMemory\(true\)[\s\S]*dialog\.saveFile/)
  assert.ok((operation.match(/memoryMigrationGate\.current\.isCurrent\(request\)/g) || []).length >= 4)
  assert.match(operation, /memoryMaintenanceLock\.current = false/)
})

test('import file selection, inspection, and replacement all bind current requests', () => {
  const selection = between('  const openImportMemoryBundle =', '  const importMemoryBundle =')
  assert.match(selection, /memoryMaintenanceLock\.current = true/)
  assert.match(selection, /memoryMigrationGate\.current\.begin\(\)/)
  assert.match(selection, /setMigratingMemory\(true\)[\s\S]*dialog\.openFile/)
  assert.ok((selection.match(/memoryMigrationGate\.current\.isCurrent\(request\)/g) || []).length >= 3)

  const operation = between('  const importMemoryBundle =', '  const closeMigrationDialog =')
  assert.match(operation, /const passphrase = migrationPassphrase/)
  assert.match(operation, /const inspected = migrationDialog\.inspected/)
  assert.match(operation, /const confirmation = migrationImportConfirmation/)
  assert.ok((operation.match(/memoryMigrationGate\.current\.isCurrent\(request\)/g) || []).length >= 4)
})

test('manual vector indexing participates in the same maintenance ownership', () => {
  const operation = between('  const indexMemoryVectors =', '  const decideReview =')
  assert.match(operation, /if \(memoryMaintenanceBusy \|\| memoryMaintenanceLock\.current\) return/)
  assert.match(operation, /memoryVectorIndexGate\.current\.begin\(\)/)
  assert.ok((operation.match(/memoryVectorIndexGate\.current\.isCurrent\(request\)/g) || []).length >= 3)
  assert.match(operation, /memoryMaintenanceLock\.current = false/)
})
