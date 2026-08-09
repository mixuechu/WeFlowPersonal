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
})

test('shared evidence rows fail closed for non-WeChat and malformed message identities', () => {
  assert.match(page, /const navigation = wechatEvidenceNavigation\(item\)/)
  assert.match(page, /evidenceNavigationUnavailableReason\(item\)/)
  assert.match(page, /openChatHistoryWindow\(\s*navigation\.sessionId, navigation\.messageId/)
})
