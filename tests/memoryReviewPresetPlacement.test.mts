import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)

test('evidence review presets render inside memory search instead of task archive', () => {
  const archiveStart = source.indexOf('<h3>已关闭任务档案</h3>')
  const memorySearchStart = source.indexOf('<h3><Search size={16} /> 搜索个人记忆</h3>')
  const presetStart = source.indexOf('data-memory-review-presets')
  const nextSection = source.indexOf('<section', memorySearchStart + 1)

  assert.ok(archiveStart >= 0)
  assert.ok(memorySearchStart > archiveStart)
  assert.ok(presetStart > memorySearchStart)
  assert.ok(nextSection < 0 || presetStart < nextSection)
  assert.equal(source.slice(archiveStart, memorySearchStart).includes('data-memory-review-presets'), false)
})
