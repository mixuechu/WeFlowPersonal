import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedRendererNavigation } from '../electron/services/rendererNavigationPolicy.ts'

const distRoot = join('/Applications', 'WeFlow.app', 'Contents', 'Resources', 'app.asar', 'dist')

test('packaged renderer navigation stays inside the application dist tree', () => {
  assert.equal(isAllowedRendererNavigation(pathToFileURL(join(distRoot, 'index.html')).toString(), { distRoot }), true)
  assert.equal(isAllowedRendererNavigation(pathToFileURL(join(distRoot, 'splash.html')).toString(), { distRoot }), true)
  assert.equal(isAllowedRendererNavigation('file:///Users/example/private.txt', { distRoot }), false)
  assert.equal(isAllowedRendererNavigation('https://example.com/', { distRoot }), false)
  assert.equal(isAllowedRendererNavigation('javascript:alert(1)', { distRoot }), false)
})

test('development renderer navigation is restricted to the configured server origin', () => {
  const policy = { distRoot, devServerUrl: 'http://127.0.0.1:5173/' }
  assert.equal(isAllowedRendererNavigation('http://127.0.0.1:5173/#/settings', policy), true)
  assert.equal(isAllowedRendererNavigation('http://127.0.0.1:5174/', policy), false)
  assert.equal(isAllowedRendererNavigation('http://localhost:5173/', policy), false)
  assert.equal(isAllowedRendererNavigation('https://127.0.0.1:5173/', policy), false)
})

test('every application window inherits the global navigation guard and web security', () => {
  const repositoryRoot = join(import.meta.dirname, '..')
  const main = readFileSync(join(repositoryRoot, 'electron/main.ts'), 'utf8')
  const notification = readFileSync(join(repositoryRoot, 'electron/windows/notificationWindow.ts'), 'utf8')
  const windowSources = `${main}\n${notification}`

  assert.match(main, /app\.on\('web-contents-created'/)
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(main, /contents\.on\('will-attach-webview'/)
  assert.match(main, /contents\.on\('will-navigate'/)
  assert.doesNotMatch(windowSources, /webSecurity:\s*false/)
  assert.doesNotMatch(windowSources, /nodeIntegration:\s*true/)
  assert.doesNotMatch(windowSources, /certificate-error/)
})
