import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppRunRecoveryService } from '../electron/services/appRunRecoveryService.ts'

const withTempDirectory = (run: (directory: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-run-recovery-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('an unfinished session is classified as an interruption on the next start', () => withTempDirectory(directory => {
  const first = new AppRunRecoveryService(directory)
  first.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  first.markReady(new Date('2026-07-29T20:00:02.000Z'))
  first.markServicesReady(new Date('2026-07-29T20:00:03.000Z'))
  first.dispose()

  const restarted = new AppRunRecoveryService(directory)
  restarted.start('5.1.0', new Date('2026-07-29T20:10:00.000Z'))
  const diagnostics = restarted.getDiagnostics()
  assert.equal(diagnostics.recoveredFromInterruption, true)
  assert.equal(diagnostics.previous?.exitReason, 'unknown_interruption')
  assert.equal(diagnostics.previous?.cleanExit, false)
  assert.match(diagnostics.recoveryMessage, /checkpoint/)
  restarted.dispose()
}))

test('a graceful shutdown is retained as a clean historical run', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  service.beginShutdown('normal', new Date('2026-07-29T20:05:00.000Z'))
  service.finishShutdown(undefined, new Date('2026-07-29T20:05:01.000Z'))

  const next = new AppRunRecoveryService(directory)
  next.start('5.1.0', new Date('2026-07-29T20:06:00.000Z'))
  const diagnostics = next.getDiagnostics()
  assert.equal(diagnostics.recoveredFromInterruption, false)
  assert.equal(diagnostics.previous?.exitReason, 'normal')
  assert.equal(diagnostics.previous?.cleanExit, true)
  next.dispose()
}))

test('shutdown steps retain the running phase when a later forced exit interrupts cleanup', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-30T00:00:00.000Z'))
  service.beginShutdown('normal', new Date('2026-07-30T00:01:00.000Z'))
  service.startShutdownStep('http-server-stop', new Date('2026-07-30T00:01:01.000Z'))
  service.finishShutdownStep('http-server-stop', 'completed', undefined, new Date('2026-07-30T00:01:01.250Z'))
  service.startShutdownStep('wcdb-worker-stop', new Date('2026-07-30T00:01:02.000Z'))
  service.finishShutdown('forced_timeout', new Date('2026-07-30T00:01:10.000Z'))
  const previous = service.getDiagnostics().previous
  assert.deepEqual(previous?.shutdownSteps, [
    {
      name: 'http-server-stop',
      status: 'completed',
      startedAt: '2026-07-30T00:01:01.000Z',
      endedAt: '2026-07-30T00:01:01.250Z',
      durationMs: 250
    },
    {
      name: 'wcdb-worker-stop',
      status: 'running',
      startedAt: '2026-07-30T00:01:02.000Z'
    }
  ])
}))

test('a persisted shutdown intent is clean even when Electron exits before async cleanup finishes', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  service.beginShutdown('normal', new Date('2026-07-29T20:05:00.000Z'))
  service.dispose()

  const next = new AppRunRecoveryService(directory)
  next.start('5.1.0', new Date('2026-07-29T20:06:00.000Z'))
  const diagnostics = next.getDiagnostics()
  assert.equal(diagnostics.previous?.cleanExit, true)
  assert.equal(diagnostics.previous?.exitReason, 'normal')
  assert.equal(diagnostics.recoveredFromInterruption, false)
  assert.equal(diagnostics.recoveryMessage, '上次运行正常结束')
  next.dispose()
}))

test('runtime incidents are redacted and ledger permissions are private', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  service.recordIncident(
    'renderer_gone',
    'wxid_secret crashed with sk-secret-value-12345678 at /Users/private/worker',
    false,
    new Date('2026-07-29T20:00:04.000Z')
  )
  const detail = service.getDiagnostics().current?.incidents[0]?.detail || ''
  assert.equal(detail.includes('wxid_secret'), false)
  assert.equal(detail.includes('sk-secret-value-12345678'), false)
  assert.equal(detail.includes('/Users/private'), false)

  const ledgerPath = join(directory, 'diagnostics', 'app-run-recovery.json')
  assert.equal(statSync(ledgerPath).mode & 0o777, 0o600)
  assert.doesNotThrow(() => JSON.parse(readFileSync(ledgerPath, 'utf8')))
  service.dispose()
}))

test('persisted recovery data is validated, bounded and redacted again on read', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  service.dispose()
  const ledgerPath = join(directory, 'diagnostics', 'app-run-recovery.json')
  const unsafeIncident = {
    at: '2026-07-29T20:00:04.000Z',
    kind: 'renderer_gone',
    detail: 'wxid_secret sk-secret-value-12345678 /Users/private/worker',
    fatal: true
  }
  writeFileSync(ledgerPath, JSON.stringify({
    schemaVersion: 1,
    current: {
      id: 'current-run',
      version: '5.1.0',
      startedAt: '2026-07-29T20:00:00.000Z',
      lastHeartbeatAt: '2026-07-29T20:00:03.000Z',
      stage: 'services_ready',
      cleanExit: false,
      incidents: Array.from({ length: 25 }, () => unsafeIncident),
      shutdownSteps: [{ name: 'x'.repeat(200), status: 'completed', startedAt: 'invalid' }]
    },
    history: [{ id: 'broken' }]
  }))

  const restarted = new AppRunRecoveryService(directory)
  restarted.start('5.1.0', new Date('2026-07-29T20:10:00.000Z'))
  const previous = restarted.getDiagnostics().previous
  assert.equal(previous?.incidents.length, 20)
  assert.equal(previous?.shutdownSteps, undefined)
  assert.equal(previous?.incidents.some(item => /wxid_secret|sk-secret-value|\/Users\/private/.test(item.detail)), false)
  assert.doesNotThrow(() => restarted.recordIncident('unhandled_rejection', 'later failure'))
  restarted.dispose()
}))

test('a malformed persisted current session is discarded without poisoning the next run', () => withTempDirectory(directory => {
  const service = new AppRunRecoveryService(directory)
  service.start('5.1.0', new Date('2026-07-29T20:00:00.000Z'))
  service.dispose()
  const ledgerPath = join(directory, 'diagnostics', 'app-run-recovery.json')
  writeFileSync(ledgerPath, JSON.stringify({
    schemaVersion: 1,
    current: { id: 'partial', stage: 'services_ready', incidents: 'not-an-array' },
    history: [null, [], { id: 'also-partial' }]
  }))

  const restarted = new AppRunRecoveryService(directory)
  assert.doesNotThrow(() => restarted.start('5.1.0', new Date('2026-07-29T20:10:00.000Z')))
  const diagnostics = restarted.getDiagnostics()
  assert.equal(diagnostics.previous, null)
  assert.equal(diagnostics.current?.incidents.length, 0)
  restarted.dispose()
}))
