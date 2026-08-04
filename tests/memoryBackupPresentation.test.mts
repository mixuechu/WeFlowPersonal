import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMemoryBackupDirectory } from '../src/utils/memoryBackupPresentation.ts'

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
