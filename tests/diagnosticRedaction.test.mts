import test from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeDiagnosticText } from '../electron/services/diagnosticRedaction.ts'

test('diagnostic redaction folds complete macOS and Linux home paths', () => {
  const message = sanitizeDiagnosticText(
    'mac=/Users/alice/Desktop/Customer-Zeta/private.sqlite ' +
    'linux=/home/operator/contracts/Acquisition-2027.pdf ' +
    'url=file:///Users/alice/Library/Application%20Support/weflow/state.json'
  )

  assert.equal(
    message,
    'mac=[已隐藏的本机路径] linux=[已隐藏的本机路径] url=[已隐藏的本机路径]'
  )
  assert.doesNotMatch(message, /alice|operator|Customer-Zeta|Acquisition|weflow|state\.json/i)
})

test('diagnostic redaction folds Windows homes and macOS private temporary paths', () => {
  const message = sanitizeDiagnosticText(
    String.raw`windows=C:\Users\Alice\Desktop\Customer-Zeta\db.sqlite ` +
    'temp=/private/var/folders/xy/secret-work/T/export.json'
  )

  assert.equal(
    message,
    'windows=[已隐藏的本机路径] temp=[已隐藏的临时路径]'
  )
  assert.doesNotMatch(message, /Alice|Customer-Zeta|secret-work|export\.json/i)
})

test('diagnostic redaction keeps non-sensitive context around a folded path', () => {
  const message = sanitizeDiagnosticText(
    '读取失败 path=/Users/tester/Documents/private.db code=SQLITE_BUSY retry=2'
  )

  assert.equal(message, '读取失败 path=[已隐藏的本机路径] code=SQLITE_BUSY retry=2')
})
