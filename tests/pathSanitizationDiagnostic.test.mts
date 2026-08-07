import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatPathSanitizationDiagnostic
} from '../electron/services/pathSanitizationDiagnostic.ts'

test('PATH sanitization diagnostics report only an aggregate count', () => {
  const message = formatPathSanitizationDiagnostic(7)

  assert.equal(message, '使用白名单裁剪 PATH，移除 7 个非受信任目录')
  assert.doesNotMatch(message, /Users|mimimi|workspace|node_modules/i)
})

test('PATH sanitization diagnostics bound malformed counts without echoing input', () => {
  const secretPath = '/Users/private/customer-alpha/bin'

  assert.equal(formatPathSanitizationDiagnostic(secretPath), '使用白名单裁剪 PATH，移除 0 个非受信任目录')
  assert.equal(formatPathSanitizationDiagnostic(-4), '使用白名单裁剪 PATH，移除 0 个非受信任目录')
  assert.equal(formatPathSanitizationDiagnostic(Number.POSITIVE_INFINITY), '使用白名单裁剪 PATH，移除 0 个非受信任目录')
  assert.doesNotMatch(formatPathSanitizationDiagnostic(secretPath), /private|customer-alpha/)
})
