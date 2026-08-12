import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('startup presents a loaded window before synchronous Safe Storage configuration access', () => {
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'))
  const splash = ready.indexOf("createSplashWindow({ themeId: 'cloud-dancer', themeMode: 'system' })")
  const loaded = ready.indexOf("splashWindow!.webContents.once('did-finish-load'", splash)
  const guidance = ready.indexOf('正在访问本机安全存储', loaded)
  const config = ready.indexOf('configService = new ConfigService()', guidance)
  assert.ok(splash >= 0 && loaded > splash && guidance > loaded && config > guidance)
})

test('silent startup hides the authorization anchor only after configuration is readable', () => {
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'))
  const config = ready.indexOf('configService = new ConfigService()')
  const background = ready.indexOf('const startInBackground =', config)
  const close = ready.indexOf('if (startInBackground) closeSplash()', background)
  assert.ok(config >= 0 && background > config && close > background)
})
