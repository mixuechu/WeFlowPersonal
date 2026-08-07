import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMemoryBackupDirectory,
  describeMemoryBackupRestore
} from '../src/utils/memoryBackupPresentation.ts'

test('memory backup recovery exposes every retained snapshot beyond the old five-item UI cap', () => {
  const backups = Array.from({ length: 11 }, (_, index) => ({
    path: `/private/backups/personal-memory-${index}.sqlite`,
    createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    hasState: index !== 7
  }))
  const directory = buildMemoryBackupDirectory(backups)
  assert.equal(directory.length, 11)
  assert.equal(directory[5]?.path, '/private/backups/personal-memory-5.sqlite')
  assert.equal(directory[10]?.path, '/private/backups/personal-memory-10.sqlite')
  assert.equal(directory[7]?.hasState, false)
})

test('memory backup recovery ignores malformed entries without inventing paths', () => {
  assert.deepEqual(buildMemoryBackupDirectory(null), [])
  assert.deepEqual(buildMemoryBackupDirectory([null, {}, { path: ' ' }, {
    path: '/private/backups/valid.sqlite',
    hasState: true
  }]), [{
    path: '/private/backups/valid.sqlite',
    hasState: true
  }])
})

test('memory backup recovery fails closed for unverified and invalid snapshots', () => {
  assert.equal(describeMemoryBackupRestore({
    path: '/private/backups/good.sqlite',
    hasState: true,
    restoreStatus: 'restorable'
  }).enabled, true)
  assert.deepEqual(describeMemoryBackupRestore({
    path: '/private/backups/bad-db.sqlite',
    hasState: true,
    restoreStatus: 'invalid',
    restoreFailure: 'database_invalid'
  }), {
    enabled: false,
    title: '数据库损坏或无法读取；已保留原始现场，但不能作为完整快照恢复',
    suffix: '（数据库损坏或无法读取）'
  })
  assert.match(describeMemoryBackupRestore({
    path: '/private/backups/bad-state.sqlite',
    hasState: true,
    restoreStatus: 'invalid',
    restoreFailure: 'state_invalid'
  }).title, /AI 状态损坏或密钥不匹配/)
  assert.equal(describeMemoryBackupRestore({
    path: '/private/backups/legacy.sqlite',
    hasState: true
  }).enabled, false)
  assert.equal(describeMemoryBackupRestore({
    path: '/private/backups/database-only.sqlite',
    hasState: false,
    restoreStatus: 'incomplete'
  }).suffix, '（仅数据库）')
})
