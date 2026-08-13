import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')

test('every graph review evidence preview uses the source-aware navigation component', () => {
  const start = page.indexOf("review.kind === 'relation'")
  const end = page.indexOf("review.status !== 'pending'", start)
  const reviewCards = page.slice(start, end)
  assert.match(reviewCards, /<EvidenceRows evidence=\{relation\.evidence\}/)
  assert.equal((reviewCards.match(/<EvidenceRows evidence=\{review\.evidence\}/g) || []).length, 3)
  assert.doesNotMatch(reviewCards, /key=\{evidence\.messageId\}/)
})

test('review evidence navigation retains complete source carrier identity', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  assert.match(service, /evidence\?: Array<\{ sourceId\?: string; messageId: string; sessionId: string;/)
  assert.match(page, /key=\{`\$\{item\.sourceId\}-\$\{item\.sessionId\}-\$\{item\.messageId\}-\$\{index\}`\}/)
  assert.match(page, /<EvidenceNavigationAction evidence=\{item\} \/>/)
})
