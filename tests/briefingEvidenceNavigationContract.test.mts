import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('latest briefing summary and highlights use the shared evidence navigation surface', () => {
  assert.match(page, /className="assistant-briefing-evidence"><EvidenceRows[\s\S]*?evidence=\{briefing\.summaryEvidence\}/)
  assert.match(page, /className="assistant-highlight-evidence"><EvidenceRows[\s\S]*?evidence=\{highlight\.evidence\}/)
  assert.match(page, /summaryEvidenceLimit \|\| 40/)
  assert.match(page, /summaryEvidenceRowsOmitted \|\| 0/)
  assert.match(page, /briefing\.summaryEvidenceTotal \|\| briefing\.summaryEvidence\?\.length/)
  assert.match(page, /item\.evidenceTruncated/)
})

test('shared evidence rows fail closed for non-WeChat and malformed message identities', () => {
  assert.match(page, /function EvidenceNavigationAction/)
  assert.match(page, /const navigation = wechatEvidenceNavigation\(evidence\)/)
  assert.match(page, /evidenceNavigationUnavailableReason\(evidence\)/)
  assert.match(page, /openChatHistoryWindow\(\s*navigation\.sessionId, navigation\.messageId/)
})

test('every AI assistant original-message action shares the source-aware navigation gate', () => {
  assert.equal(page.match(/openChatHistoryWindow\(/g)?.length, 1)
  assert.match(page, /<EvidenceNavigationAction evidence=\{matchedEvidence\} label="打开命中原消息" \/>/)
  assert.ok((page.match(/<EvidenceNavigationAction evidence=/g) || []).length >= 5)
})
