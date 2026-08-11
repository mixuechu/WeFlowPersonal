import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')

test('portable memory export publishes through the private atomic writer', () => {
  const start = service.indexOf('  async exportMemoryBundle(')
  const end = service.indexOf('  private getCurrentMemoryImportSummary', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const method = service.slice(start, end)
  assert.match(method, /writePrivateFileAtomically\(outputPath, payload\)/)
  assert.doesNotMatch(method, /writeFileSync\(outputPath/)
  assert.match(method, /payload\?\.fill\(0\)/)
  assert.match(method, /archive\?\.fill\(0\)/)
  assert.match(method, /databaseKeyBytes\?\.fill\(0\)/)
  assert.match(method, /databaseBytes\.fill\(0\)/)
  assert.match(method, /stateBytes\?\.fill\(0\)/)
})
