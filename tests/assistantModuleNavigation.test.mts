import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ASSISTANT_MODULE_NAVIGATION,
  assistantModuleLabel
} from '../src/utils/assistantModuleNavigation.ts'

const page = readFileSync(
  fileURLToPath(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url)),
  'utf8'
)

test('AI 助理模块导航使用唯一且可读的稳定入口', () => {
  assert.equal(ASSISTANT_MODULE_NAVIGATION.length, 10)
  assert.equal(new Set(ASSISTANT_MODULE_NAVIGATION.map(item => item.id)).size, 10)
  assert.equal(new Set(ASSISTANT_MODULE_NAVIGATION.map(item => item.label)).size, 10)
  assert.equal(assistantModuleLabel('memory-search'), '统一检索')
  assert.equal(assistantModuleLabel('missing'), null)
})

test('每个导航入口在真实页面中都有对应锚点', () => {
  for (const item of ASSISTANT_MODULE_NAVIGATION) {
    assert.match(page, new RegExp(`id=["']${item.id}["']`), item.label)
  }
})

test('模块导航展示权威审阅数量并处理尚未加载的目标', () => {
  assert.match(page, /aria-label="AI 助理模块导航"/)
  assert.match(page, /reviewInboxReady && reviewInbox\.total > 0/)
  assert.match(page, /模块当前尚未加载，请完成首次整理后重试/)
  assert.match(page, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
})
