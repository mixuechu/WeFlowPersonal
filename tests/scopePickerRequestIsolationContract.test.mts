import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('trusted entity picker clears old-scope candidates before its debounce', () => {
  const start = page.indexOf('function TrustedEntityPicker({')
  const end = page.indexOf('function EventParticipantEditor({', start)
  const picker = page.slice(start, end)

  assert.match(picker, /if \(!open\) \{[\s\S]*requestGate\.current\.invalidate\(\)[\s\S]*setOptions\(\[\]\)/)
  assert.match(picker, /const request = requestGate\.current\.begin\(\)[\s\S]*setOptions\(\[\]\)[\s\S]*const timer = window\.setTimeout/)
  assert.match(picker, /onChange=\{event => \{[\s\S]*requestGate\.current\.invalidate\(\)[\s\S]*setOptions\(\[\]\)[\s\S]*setQuery\(event\.target\.value\)/)
})

test('memory session picker invalidates and clears old candidates on scope changes', () => {
  const effectStart = page.indexOf("if (!memorySessionPickerOpen) {")
  const effectEnd = page.indexOf('}, [memorySessionPickerOpen, memorySessionQuery])', effectStart)
  const effect = page.slice(effectStart, effectEnd)

  assert.match(effect, /memorySessionPickerGate\.current\.invalidate\(\)/)
  assert.match(effect, /setMemorySessionOptions\(\[\]\)/)
  assert.match(effect, /const request = memorySessionPickerGate\.current\.begin\(\)[\s\S]*setMemorySessionOptions\(\[\]\)[\s\S]*const timer = window\.setTimeout/)
  assert.match(page, /onChange=\{event => \{\s*memorySessionPickerGate\.current\.invalidate\(\)[\s\S]*setMemorySessionOptions\(\[\]\)[\s\S]*setMemorySessionQuery\(event\.target\.value\)/)
})

test('choosing or clearing a session cancels any in-flight directory response', () => {
  assert.match(page, /aria-label="清除会话范围"[\s\S]*memorySessionPickerGate\.current\.invalidate\(\)[\s\S]*setMemorySessionPickerOpen\(false\)/)
  assert.match(page, /key=\{source\.sessionId\}[\s\S]*onClick=\{\(\) => \{\s*memorySessionPickerGate\.current\.invalidate\(\)[\s\S]*setMemorySessionSelection\(source\)/)
})
