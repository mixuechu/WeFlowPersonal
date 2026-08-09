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
  const searchReconciliation = initializeSource.indexOf(
    'personalMemoryStore.reconcileStructuredSearchAfterAuthorityCommit()',
    strictCommit
  )
  const schedulerStart = initializeSource.indexOf('this.scheduler = setInterval', searchReconciliation)
  assert.ok(initializeStart >= 0)
  assert.ok(finalRecovery >= 0)
  assert.ok(strictCommit > finalRecovery)
  assert.ok(searchReconciliation > strictCommit)
  assert.ok(schedulerStart > searchReconciliation)
})

test('assistant service delegates persistence ordering to the executable commit policy', () => {
  const saveStart = source.indexOf('private saveState(strictMemorySync = false)')
  const nextMethod = source.indexOf('private persistCrossStoreMutationState', saveStart)
  const saveSource = source.slice(saveStart, nextMethod)
  assert.ok(saveStart >= 0)
  assert.match(saveSource, /commitAssistantState\(\{\s*strict: strictMemorySync,/)
  assert.match(saveSource, /syncGraph: \(\) =>/)
  assert.match(saveSource, /syncTasks: \(\) =>/)
  assert.match(saveSource, /writeEncryptedState: \(\) =>/)
})
