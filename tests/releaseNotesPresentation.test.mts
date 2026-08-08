import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_RELEASE_NOTES_TEXT_LENGTH,
  releaseNotesToSafeText
} from '../src/utils/releaseNotesPresentation.ts'

test('release notes become bounded plain text without executable markup', () => {
  const result = releaseNotesToSafeText(`
    <h2>安全更新</h2>
    <ul><li>修复 &amp; 加固</li><li><img src=x onerror=alert(1)>稳定性</li></ul>
    <script>window.electronAPI.config.clear()</script>
    <style>body { display: none }</style>
  `)
  assert.equal(result, '安全更新\n\n• 修复 & 加固\n\n• 稳定性')
  assert.doesNotMatch(result, /<|>|electronAPI|onerror|display:\s*none/)
})

test('release notes decode numeric entities and enforce a renderer payload budget', () => {
  assert.equal(releaseNotesToSafeText('版本 &#x35;&#46;&#49; &#65;'), '版本 5.1 A')
  const result = releaseNotesToSafeText('更新'.repeat(MAX_RELEASE_NOTES_TEXT_LENGTH))
  assert.equal(result.length, MAX_RELEASE_NOTES_TEXT_LENGTH)
  assert.equal(result.endsWith('…'), true)
})

test('update dialog renders release notes as React text rather than raw HTML', () => {
  const component = readFileSync(join(import.meta.dirname, '../src/components/UpdateDialog.tsx'), 'utf8')
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/)
  assert.match(component, /\{releaseNotesText\}/)
})
