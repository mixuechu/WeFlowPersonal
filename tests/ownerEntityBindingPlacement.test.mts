import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/pages/AiAssistantPage.tsx', import.meta.url),
  'utf8'
)

test('owner identity binding is visible in settings and has a first-class dossier entry', () => {
  const profile = source.indexOf('MY MEMORY')
  const reviewInbox = source.indexOf('id="review-inbox"')
  const settings = source.indexOf('<span>我的图谱身份</span>')
  assert.ok(profile >= 0)
  assert.ok(reviewInbox > profile)
  assert.ok(settings > reviewInbox)
  assert.match(source.slice(settings, settings + 1_800), /type="person"/)
  assert.match(source.slice(settings, settings + 1_800), /ownerEntityRevision/)
  assert.match(source.slice(profile, reviewInbox), /setShowEntityDossier\(true\)/)
})
