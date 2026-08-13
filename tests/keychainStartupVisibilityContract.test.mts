import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('startup reads local encrypted configuration without asking for Keychain authorization', () => {
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'))
  const splash = ready.indexOf("createSplashWindow({ themeId: 'cloud-dancer', themeMode: 'system' })")
  const loaded = ready.indexOf("splashWindow!.webContents.once('did-finish-load'", splash)
  const guidance = ready.indexOf('正在读取本机加密配置', loaded)
  const config = ready.indexOf('configService = new ConfigService()', guidance)
  assert.ok(splash >= 0 && loaded > splash && guidance > loaded && config > guidance)
  assert.doesNotMatch(ready, /如系统询问请完成钥匙串授权/)
})

test('silent startup hides the startup splash only after configuration is readable', () => {
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'))
  const config = ready.indexOf('configService = new ConfigService()')
  const background = ready.indexOf('const startInBackground =', config)
  const close = ready.indexOf('if (startInBackground) closeSplash()', background)
  assert.ok(config >= 0 && background > config && close > background)
})
