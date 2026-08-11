import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

const between = (source: string, startText: string, endText: string): string => {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start + startText.length)
  assert.notEqual(start, -1, `${startText} must exist`)
  assert.notEqual(end, -1, `${endText} must follow ${startText}`)
  return source.slice(start, end)
}

test('startup restores both authorities before loading assistant state', () => {
  const initialize = between(service, '  async initialize(): Promise<void>', '  async prepareForAppShutdown')
  assert.match(initialize, /personalMemoryStore\.initialize\(databasePath, databaseKey\)/)
  assert.match(
    initialize,
    /personalMemoryStore\.initialize\(databasePath, databaseKey\)[\s\S]*this\.recoverInterruptedMemoryRestore\(\)[\s\S]*this\.loadState\(\)/
  )
})

test('a prepared restore journal rolls database and encrypted state back as one startup gate', () => {
  const recovery = between(
    service,
    '  private recoverInterruptedMemoryRestore(): void',
    '  async initialize(): Promise<void>'
  )
  assert.match(recovery, /readEncryptedDurableJson/)
  assert.match(recovery, /journal\.phase === 'committed'/)
  assert.match(recovery, /personalMemoryStore\.restoreBackup\(safetyDatabasePath, safetyDatabasePath\)/)
  assert.match(recovery, /readEncryptedDurableJson[\s\S]*safetyStatePath/)
  assert.match(recovery, /writeEncryptedDurableJson\([\s\S]*this\.statePath/)
  assert.match(recovery, /throw new Error\('个人记忆恢复在上次退出时中断/)
  assert.doesNotMatch(recovery, /catch \{\}/)
})

test('restore writes prepared before replacement and committed only after both authorities load', () => {
  const apply = between(service, '  private applyMemoryBackup(', '  private async readMemoryBundle')
  const prepared = apply.indexOf("phase: 'prepared'")
  const database = apply.indexOf('personalMemoryStore.restoreBackup(path, safety.path)')
  const state = apply.indexOf('writeEncryptedDurableJson(\n        this.statePath')
  const load = apply.indexOf('this.loadState()', state)
  const save = apply.indexOf('this.saveState()', load)
  const committed = apply.indexOf("phase: 'committed'")
  assert.ok(prepared >= 0 && prepared < database)
  assert.ok(database < state && state < load && load < save && save < committed)
  assert.match(apply, /安全回滚尚未完成；恢复日志已保留/)
})

test('restore crash recovery is visible without exposing journal paths', () => {
  assert.match(service, /memoryRestoreRecovery: this\.memoryRestoreRecovery/)
  assert.match(page, /恢复事务启动检查/)
  assert.match(page, /已回滚中断恢复/)
  assert.match(page, /已清理完成日志/)
  assert.doesNotMatch(page, /safetyDatabasePath|safetyStatePath|memoryRestoreJournalPath/)
})
