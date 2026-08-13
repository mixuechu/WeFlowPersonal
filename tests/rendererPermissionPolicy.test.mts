import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAllowedRendererPermission } from '../electron/services/rendererPermissionPolicy.ts'

test('trusted application main frames may write sanitized clipboard text only', () => {
  const base = { trustedMainFrame: true, notificationRenderer: false, platform: 'darwin' as const }
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'clipboard-sanitized-write' }), true)
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'clipboard-read' }), false)
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'notifications' }), false)
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'geolocation' }), false)
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'media', mediaTypes: ['video'] }), false)
})

test('only the trusted Windows notification renderer may capture video without audio', () => {
  const base = {
    permission: 'media',
    trustedMainFrame: true,
    notificationRenderer: true,
    platform: 'win32' as const
  }
  assert.equal(isAllowedRendererPermission({ ...base, mediaTypes: ['video'] }), true)
  assert.equal(isAllowedRendererPermission({ ...base, mediaType: 'video' }), true)
  assert.equal(isAllowedRendererPermission({ ...base, permission: 'display-capture' }), true)
  assert.equal(isAllowedRendererPermission({ ...base, mediaTypes: ['audio'] }), false)
  assert.equal(isAllowedRendererPermission({ ...base, mediaTypes: ['video', 'audio'] }), false)
  assert.equal(isAllowedRendererPermission({ ...base, notificationRenderer: false, mediaTypes: ['video'] }), false)
  assert.equal(isAllowedRendererPermission({ ...base, platform: 'linux', mediaTypes: ['video'] }), false)
  assert.equal(isAllowedRendererPermission({ ...base, trustedMainFrame: false, mediaTypes: ['video'] }), false)
})

test('main process installs both Chromium permission handlers before creating windows', () => {
  const main = readFileSync(join(import.meta.dirname, '../electron/main.ts'), 'utf8')
  assert.match(main, /setPermissionCheckHandler/)
  assert.match(main, /setPermissionRequestHandler/)
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\n\s+installRendererPermissionPolicy\(\)/)
})
