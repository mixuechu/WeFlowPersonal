import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertMemoryImportConfirmation,
  buildMemoryImportPreviewToken
} from '../electron/services/memoryImportPolicy.ts'

const identity = {
  bundleSha256: 'a'.repeat(64),
  databaseSha256: 'b'.repeat(64),
  stateSha256: 'c'.repeat(64),
  currentStateSha256: 'd'.repeat(64)
}

test('memory import requires the current preview token and exact visible confirmation', () => {
  const previewToken = buildMemoryImportPreviewToken(identity)
  assert.doesNotThrow(() => assertMemoryImportConfirmation(identity, {
    previewToken,
    confirmation: '导入并替换'
  }))
  assert.throws(() => assertMemoryImportConfirmation(identity, {
    previewToken,
    confirmation: '确认'
  }), /请输入“导入并替换”/)
  assert.throws(() => assertMemoryImportConfirmation(identity, {
    previewToken: '',
    confirmation: '导入并替换'
  }), /重新核对导入范围/)
})

test('memory import rejects package replacement and current-memory drift after preview', () => {
  const previewToken = buildMemoryImportPreviewToken(identity)
  for (const changed of [
    { ...identity, bundleSha256: 'e'.repeat(64) },
    { ...identity, databaseSha256: 'e'.repeat(64) },
    { ...identity, stateSha256: 'e'.repeat(64) },
    { ...identity, currentStateSha256: 'e'.repeat(64) }
  ]) {
    assert.throws(() => assertMemoryImportConfirmation(changed, {
      previewToken,
      confirmation: '导入并替换'
    }), /重新核对导入范围/)
  }
})
