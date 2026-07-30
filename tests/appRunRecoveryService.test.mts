import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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

