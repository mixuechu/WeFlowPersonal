import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('project key events reject stale first pages with a bounded recovery budget', () => {
  const start = page.indexOf('const request = projectKeyEventGate.current.begin()')
  const end = page.indexOf('const request = projectEvidenceGate.current.begin()', start)
  const effect = page.slice(start, end)

  assert.match(effect, /if \(page\.stale\) \{/)
  assert.match(effect, /boundedStaleReloads\.current\.next\(\s*'project_key_event_page'/)
  assert.match(effect, /项目关键时间线连续三次读取均发生变化/)
  assert.match(effect, /boundedStaleReloads\.current\.clear\('project_key_event_page'\)/)
  assert.ok(effect.indexOf('if (page.stale) {') < effect.indexOf("setProjectKeyEventPage({ ...page, status: 'ready' })"))
  assert.match(page, /关键时间线读取失败：[\s\S]*setProjectKeyEventRefreshKey\(value => value \+ 1\)/)
})

test('task feedback dossier stops repeated stale reloads and exposes manual retry', () => {
  const start = page.indexOf('const openTaskFeedbackDossier = async (')
  const end = page.indexOf('const loadMoreTaskFeedbackHistory = async () => {', start)
  const opener = page.slice(start, end)

  assert.match(opener, /boundedStaleReloads\.current\.next\(\s*'task_feedback_dossier'/)
  assert.match(opener, /归属反馈详情连续三次读取均发生变化，请手动重试/)
  assert.match(opener, /boundedStaleReloads\.current\.clear\('task_feedback_dossier'\)/)
  assert.match(page, /taskFeedbackDossier\.error[\s\S]*openTaskFeedbackDossier\(\s*taskFeedbackDossier\.evidence_fingerprint/)
})

test('task feedback continuation preserves history on stale and ordinary failure', () => {
  const start = page.indexOf('const loadMoreTaskFeedbackHistory = async () => {')
  const end = page.indexOf('const loadMoreEntityIdentityAnchors = async () => {', start)
  const loader = page.slice(start, end)

  assert.match(loader, /if \(page\.stale\) \{[\s\S]*setTaskFeedbackDossier\(\(current: any\) => \(\{[\s\S]*\.\.\.current,[\s\S]*historyError:/)
  assert.doesNotMatch(loader, /void openTaskFeedbackDossier/)
  assert.match(loader, /catch \(error: any\) \{[\s\S]*\.\.\.current,[\s\S]*historyError:/)
  assert.match(page, /taskFeedbackDossier\.historyError[\s\S]*重新载入最新详情/)
})
