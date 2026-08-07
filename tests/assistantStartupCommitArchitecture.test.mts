import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../electron/services/aiAssistantService.ts', import.meta.url),
  'utf8'
)

test('assistant startup reaches schedulers only after a strict authority commit', () => {
  const initializeStart = source.indexOf('async initialize(): Promise<void>')
  const shutdownStart = source.indexOf('async prepareForAppShutdown', initializeStart)
  const initializeSource = source.slice(initializeStart, shutdownStart)
  const finalRecovery = initializeSource.indexOf('this.removeSuppressedRelationsFromState()')
  const strictCommit = initializeSource.indexOf('this.saveState(true)', finalRecovery)
  const schedulerStart = initializeSource.indexOf('this.scheduler = setInterval', strictCommit)
  assert.ok(initializeStart >= 0)
  assert.ok(finalRecovery >= 0)
  assert.ok(strictCommit > finalRecovery)
  assert.ok(schedulerStart > strictCommit)
})

test('strict assistant state persistence commits task authority before encrypted state', () => {
  const saveStart = source.indexOf('private saveState(strictMemorySync = false)')
  const nextMethod = source.indexOf('private persistCrossStoreMutationState', saveStart)
  const saveSource = source.slice(saveStart, nextMethod)
  const strictTaskSync = saveSource.indexOf(
    'if (strictMemorySync) {\n      personalMemoryStore.syncTasks'
  )
  const encryptedWrite = saveSource.indexOf('writeEncryptedDurableJson')
  const bestEffortTaskSync = saveSource.indexOf('if (!strictMemorySync)', encryptedWrite)
  assert.ok(saveStart >= 0)
  assert.ok(strictTaskSync >= 0)
  assert.ok(encryptedWrite > strictTaskSync)
  assert.ok(bestEffortTaskSync > encryptedWrite)
})
