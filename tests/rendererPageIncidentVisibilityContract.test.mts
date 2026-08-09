import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/pages/AiAssistantPage.scss', import.meta.url), 'utf8')

test('AI assistant surfaces current page incidents and targets the authoritative run diagnostics', () => {
  assert.match(page, /buildRendererPageIncidentNotice\(memoryDiagnostics\?\.appRecovery\)/)
  assert.match(page, /本次运行有页面曾加载失败/)
  assert.match(page, /定位运行记录/)
  assert.match(page, /id="assistant-app-recovery-diagnostics"/)
  assert.match(page, /getElementById\('assistant-app-recovery-diagnostics'\)/)
  assert.match(page, /onClick=\{openAppRecoveryDiagnostics\}/)
  assert.match(page, /target\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(styles, /\.assistant-diagnostics-modal \{[^}]*overflow: auto;/)
})
