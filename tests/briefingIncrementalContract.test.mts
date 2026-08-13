import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')

test('successful same-day increments merge through a replay-safe briefing identity', () => {
  assert.match(service, /fresh\.map\(messageKey\)\.sort\(\)\.join\('\\n'\)/)
  assert.match(service, /createHash\('sha256'\)/)
  assert.match(service, /this\.state\.briefings\[today\] = mergeDailyBriefing\(\s*this\.state\.briefings\[today\]/)
  assert.doesNotMatch(service, /this\.state\.briefings\[today\] = \{\s*date: today/)
})
