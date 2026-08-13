import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('memory item audit never accepts a repeatedly stale replacement page', () => {
  const start = page.indexOf('const loadMemoryItemAudit = async (')
  const end = page.indexOf('const seedMemoryItemAuditFromDossier =', start)
  const loader = page.slice(start, end)

  assert.match(loader, /for \(let attempt = 0; attempt < 3 && page\.stale; attempt \+= 1\)/)
  assert.match(loader, /if \(page\.stale\) \{\s*throw new Error\('这条记忆的审计历史连续三次重新读取仍在变化/)
  assert.ok(
    loader.indexOf("if (page.stale) {\n          throw new Error") <
      loader.indexOf('setMemoryItemAudits(existing => setBoundedAuditCache')
  )
})

test('memory item audit failures remain visible and manually retryable', () => {
  assert.match(page, /审计读取失败：\{memoryItemAudits\[`claim:\$\{claim\.id\}`\]\.error\}[\s\S]*loadMemoryItemAudit\(\s*'claim', claim\.id/)
  assert.match(page, /审计读取失败：\{memoryItemAudits\[`event:\$\{event\.id\}`\]\.error\}[\s\S]*loadMemoryItemAudit\(\s*'event', event\.id/)
  assert.match(page, /审计读取失败：\{audit\.error\}[\s\S]*loadMemoryItemAudit\(\s*kind, item\.id/)
  assert.match(page, /audit\?\.status === 'ready' &&[\s\S]*这条记忆尚无人工纠正或可信状态变更/)
})

test('event correction participant continuation preserves its prefix and can retry', () => {
  const start = page.indexOf('const loadMoreEventCorrectionParticipantArchive = async () => {')
  const end = page.indexOf('const loadMoreResources = async () => {', start)
  const loader = page.slice(start, end)

  assert.match(loader, /\['ready', 'load_more_error'\]\.includes\(archive\.status\)/)
  assert.match(loader, /status: 'stale',[\s\S]*已保留当前内容/)
  assert.match(loader, /status: 'load_more_error',[\s\S]*loadMoreError:/)
  assert.doesNotMatch(loader, /setEventCorrectionParticipantArchive\(null\)/)
  assert.match(page, /status === 'load_more_error'[\s\S]*重试加载更多参与者/)
})

test('event correction participant first-page errors stay in the modal', () => {
  const start = page.indexOf('const openEventCorrectionParticipantArchive = async (')
  const end = page.indexOf('const loadMoreEventCorrectionParticipantArchive = async () => {', start)
  const opener = page.slice(start, end)

  assert.match(opener, /if \(!page \|\| page\.stale\) \{[\s\S]*status: 'error'/)
  assert.doesNotMatch(opener, /setEventCorrectionParticipantArchive\(null\)/)
  assert.match(page, /读取失败：\{eventCorrectionParticipantArchive\.error[\s\S]*重试当前快照/)
})
