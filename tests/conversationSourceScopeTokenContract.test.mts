import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const directory = readFileSync(new URL('../electron/services/conversationSourceDirectory.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types/electron.d.ts', import.meta.url), 'utf8')

test('conversation source continuation carries a complete service scope token', () => {
  assert.match(directory, /conversation-source-directory-v1', query, type, enabled/)
  assert.match(directory, /offset > 0 &&[\s\S]*options\.directoryScopeToken[\s\S]*!== directoryScopeToken/)
  assert.match(directory, /const stale = directoryScopeStale \|\|/)
  assert.match(page, /expectedRevision: append \? sourceDirectory\.revision : undefined,[\s\S]*directoryScopeToken: append \? sourceDirectory\.directoryScopeToken : undefined/)
  assert.match(types, /directoryScopeToken: string[\s\S]*directoryScopeStale: boolean/)
})

test('bulk source mutation carries the first-page scope token through every page', () => {
  assert.match(service, /for \(let offset = 0; offset < directory\.total; offset \+= 100\)[\s\S]*expectedRevision: directory\.revision,[\s\S]*directoryScopeToken: directory\.directoryScopeToken/)
})

test('renderer distinguishes source range drift from directory revision drift', () => {
  assert.match(page, /result\.directoryScopeStale[\s\S]*会话目录筛选范围在翻页时发生变化/)
})
