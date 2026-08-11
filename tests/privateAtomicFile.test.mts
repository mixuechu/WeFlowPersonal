import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writePrivateFileAtomically } from '../electron/services/privateAtomicFile.ts'

test('private atomic publication replaces a target only with the complete verified payload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-private-atomic-'))
  const target = join(directory, 'memory.weflow-memory')
  writeFileSync(target, 'previous-complete-export')
  const payload = Buffer.from('next-complete-export')
  const result = writePrivateFileAtomically(target, payload)

  assert.equal(readFileSync(target, 'utf8'), 'next-complete-export')
  assert.equal(result.bytes, payload.length)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(statSync(target).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(directory), ['memory.weflow-memory'])
})

test('private atomic publication rejects directories without leaving staging files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-private-atomic-invalid-'))
  assert.throws(
    () => writePrivateFileAtomically(directory, Buffer.from('not-published')),
    /未选择有效的导出文件/
  )
  assert.deepEqual(readdirSync(directory), [])
})

test('a staging failure preserves the previously published export', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-private-atomic-preserve-'))
  const target = join(directory, 'memory.weflow-memory')
  writeFileSync(target, 'previous-complete-export')
  chmodSync(directory, 0o500)
  try {
    assert.throws(() => writePrivateFileAtomically(target, Buffer.from('replacement')))
    assert.equal(readFileSync(target, 'utf8'), 'previous-complete-export')
  } finally {
    chmodSync(directory, 0o700)
  }
  assert.deepEqual(readdirSync(directory), ['memory.weflow-memory'])
})
