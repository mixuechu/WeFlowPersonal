import test from 'node:test'
import assert from 'node:assert/strict'

import {
  trayIconCandidateNames,
  trayIconTargetSize
} from '../electron/services/trayIconPolicy.ts'

test('macOS tray prefers a PNG template source before the app ICNS fallback', () => {
  assert.deepEqual(trayIconCandidateNames('darwin'), ['icon.png', 'icon.icns'])
  assert.equal(trayIconTargetSize('darwin'), 18)
})

test('other platforms retain their native tray icon formats without forced resize', () => {
  assert.deepEqual(trayIconCandidateNames('win32'), ['icon.ico'])
  assert.deepEqual(trayIconCandidateNames('linux'), ['icon.png'])
  assert.equal(trayIconTargetSize('win32'), null)
  assert.equal(trayIconTargetSize('linux'), null)
})
