import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertMemoryBackupDeletionConfirmation,
  assertMemoryBackupRestoreConfirmation,
  buildMemoryBackupDeletionPreviewToken,
  buildMemoryBackupRestorePreviewToken
} from '../electron/services/memoryBackupRestorePolicy.ts'

const identity = {
  backupPath: '/private/backups/personal-memory.sqlite',
  backupDatabaseSha256: 'a'.repeat(64),
  backupStateSha256: 'b'.repeat(64),
  currentDatabaseSha256: 'c'.repeat(64),
  currentStateSha256: 'd'.repeat(64)
}

test('memory backup restore requires the exact visible confirmation', () => {
  const previewToken = buildMemoryBackupRestorePreviewToken(identity)
  assert.doesNotThrow(() => assertMemoryBackupRestoreConfirmation(identity, {
    previewToken,
    confirmation: '恢复快照'
  }))
  assert.throws(() => assertMemoryBackupRestoreConfirmation(identity, {
    previewToken,
    confirmation: '永久恢复'
  }), /请输入“恢复快照”/)
})

test('memory backup restore rejects target or current-memory drift', () => {
  const previewToken = buildMemoryBackupRestorePreviewToken(identity)
  for (const changed of [
    { ...identity, backupPath: '/private/backups/replaced.sqlite' },
    { ...identity, backupDatabaseSha256: 'e'.repeat(64) },
    { ...identity, backupStateSha256: 'e'.repeat(64) },
    { ...identity, currentDatabaseSha256: 'e'.repeat(64) },
    { ...identity, currentStateSha256: 'e'.repeat(64) }
  ]) {
    assert.throws(() => assertMemoryBackupRestoreConfirmation(changed, {
      previewToken,
      confirmation: '恢复快照'
    }), /预览后发生了变化/)
  }
})

test('memory backup deletion is action-bound and rejects artifact drift', () => {
  const deletionIdentity = {
    backupPath: identity.backupPath,
    backupDatabaseSha256: identity.backupDatabaseSha256,
    backupStateSha256: identity.backupStateSha256
  }
  const previewToken = buildMemoryBackupDeletionPreviewToken(deletionIdentity)
  assert.doesNotThrow(() => assertMemoryBackupDeletionConfirmation(deletionIdentity, {
    previewToken,
    confirmation: '移到废纸篓'
  }))
  assert.throws(() => assertMemoryBackupDeletionConfirmation(deletionIdentity, {
    previewToken: buildMemoryBackupRestorePreviewToken(identity),
    confirmation: '移到废纸篓'
  }), /发生了变化/)
  assert.throws(() => assertMemoryBackupDeletionConfirmation({
    ...deletionIdentity,
    backupStateSha256: 'e'.repeat(64)
  }, {
    previewToken,
    confirmation: '移到废纸篓'
  }), /发生了变化/)
  assert.throws(() => assertMemoryBackupDeletionConfirmation(deletionIdentity, {
    previewToken,
    confirmation: '永久删除'
  }), /请输入“移到废纸篓”/)
})
