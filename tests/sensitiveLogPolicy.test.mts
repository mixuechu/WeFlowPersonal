import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applySensitiveLogPolicy,
  enforceSensitiveLogFileLimit,
  getSensitiveLogDiagnostics,
  SENSITIVE_LOG_MAX_BYTES,
  SENSITIVE_LOG_POLICY_VERSION,
  SENSITIVE_LOG_RETAIN_BYTES,
  shouldWriteSensitiveLog
} from '../electron/services/sensitiveLogPolicy.ts'

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-sensitive-log-test-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('disabled diagnostic logging removes legacy sensitive detail and records an audit', () => {
  withDirectory(directory => {
    const path = join(directory, 'logs', 'wcdb.log')
    applySensitiveLogPolicy(directory, true)
    writeFileSync(path, 'SELECT * FROM contact WHERE username=\"wxid-private\"\\n')
    const audit = applySensitiveLogPolicy(directory, false)
    assert.equal(readFileSync(path, 'utf8'), '')
    assert.equal((statSync(path).mode & 0o777).toString(8), '600')
    assert.equal(audit.version, SENSITIVE_LOG_POLICY_VERSION)
    assert.equal(audit.lastAction, 'disabled_cleanup')
    assert.ok(audit.bytesRemovedThisStart > 0)
    const diagnostics = getSensitiveLogDiagnostics(directory, false)
    assert.equal(diagnostics.currentBytes, 0)
    assert.equal(diagnostics.bounded, true)
    assert.equal(diagnostics.defaultPolicy, 'disabled_logs_are_empty')
  })
})

test('explicit diagnostic logging retains only a bounded recent tail', () => {
  withDirectory(directory => {
    const path = join(directory, 'logs', 'wcdb.log')
    applySensitiveLogPolicy(directory, true)
    const old = Buffer.alloc(SENSITIVE_LOG_MAX_BYTES + SENSITIVE_LOG_RETAIN_BYTES, 0x61)
    const recent = Buffer.from('\\nRECENT-SAFE-TAIL\\n')
    writeFileSync(path, Buffer.concat([old, recent]))
    const removed = enforceSensitiveLogFileLimit(path)
    const compacted = readFileSync(path)
    assert.ok(removed > 0)
    assert.ok(compacted.length <= SENSITIVE_LOG_RETAIN_BYTES + 256)
    assert.match(compacted.toString('utf8'), /诊断日志已按本机敏感日志策略轮转/)
    assert.match(compacted.toString('utf8'), /RECENT-SAFE-TAIL/)
    assert.equal((statSync(path).mode & 0o777).toString(8), '600')
  })
})

test('WCDB sensitive log gate only opens through an explicit setting or environment override', () => {
  assert.equal(shouldWriteSensitiveLog(false, undefined), false)
  assert.equal(shouldWriteSensitiveLog(false, '0'), false)
  assert.equal(shouldWriteSensitiveLog(true, undefined), true)
  assert.equal(shouldWriteSensitiveLog(false, '1'), true)
})
