import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('assistant live status refresh is bounded and records the latest successful snapshot', () => {
  assert.match(page, /dashboardRefresh = useRef\(new TrailingCoalescedRequest<\[any, any\]>\(\)\)/)
  assert.match(page, /Promise\.all\(\[[\s\S]*aiAssistant\.status\(\)[\s\S]*aiAssistant\.dashboard\(\)/)
  assert.match(page, /setDashboardLoadedAt\(new Date\(\)\.toISOString\(\)\)/)
  assert.match(page, /window\.setInterval\(\(\) => void load\(\)\.catch\(\(\) => \{\}\), 15_000\)/)
})

test('assistant live status failure is honest about stale or unavailable state and can retry', () => {
  assert.match(page, /AI 助理当前状态暂时无法刷新/)
  assert.match(page, /最近成功快照，不能视为当前状态/)
  assert.match(page, /当前尚未取得可验证的运行状态/)
  assert.match(page, /系统每 15 秒有界重试/)
  assert.match(page, /disabled=\{dashboardRefreshing\}/)
  assert.match(page, /onClick=\{\(\) => void load\(\)\.catch\(\(\) => \{\}\)\}/)
})
