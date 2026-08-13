import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('claim correction does not reinterpret a read exception as permanent deletion', () => {
  const start = page.indexOf('const openClaimCorrection = async')
  const end = page.indexOf('const openEventCorrection = async', start)
  const source = page.slice(start, end)
  assert.match(source, /try \{[\s\S]*getMemoryClaim\(citation\.sourceId\)/)
  assert.match(source, /catch \(error: any\)[\s\S]*当前无法判断该事实是否仍然存在，请重试。[\s\S]*return/)
  assert.match(source, /if \(!claim\) \{[\s\S]*该事实不存在或已经被永久删除。/)
  assert.doesNotMatch(source, /getMemoryClaim[\s\S]*\.catch\([\s\S]*return null/)
})

test('event correction does not reinterpret a read exception as permanent deletion', () => {
  const start = page.indexOf('const openEventCorrection = async')
  const end = page.indexOf('const openSources = async', start)
  const source = page.slice(start, end)
  assert.match(source, /try \{[\s\S]*getMemoryEvent\(citation\.sourceId\)/)
  assert.match(source, /catch \(error: any\)[\s\S]*当前无法判断该事件是否仍然存在，请重试。[\s\S]*return/)
  assert.match(source, /if \(!event\) \{[\s\S]*该事件不存在或已经被永久删除。/)
  assert.doesNotMatch(source, /getMemoryEvent[\s\S]*\.catch\([\s\S]*return null/)
})
