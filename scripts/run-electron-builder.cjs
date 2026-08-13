const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')

const nativeModule = 'better-sqlite3-multiple-ciphers'

const cli = require.resolve('electron-builder/out/cli/cli.js')
const env = {
  ...process.env,
  ...(process.platform === 'darwin' && !process.env.CSC_IDENTITY_AUTO_DISCOVERY
    ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    : {})
}
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

// electron-builder/@electron-rebuild intentionally rewrites the workspace addon
// for Electron before afterPack copies it into the application. Once packaging is
// fully finished, put the ignored workspace dependency back on the current Node
// ABI so a following `npm test` cannot fail with a misleading ABI error. Always
// attempt this after a failed build too: afterPack may already have rewritten it.
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const restore = spawnSync(npmCommand, ['rebuild', nativeModule], {
  env,
  stdio: 'inherit'
})
const verify = restore.status === 0 && !restore.error && !restore.signal
  ? spawnSync(process.execPath, [join(__dirname, 'verify-workspace-sqlcipher.cjs')], {
      env,
      stdio: 'inherit'
    })
  : null
const packagedAddon = process.platform === 'darwin'
  ? [
      join(process.cwd(), 'release', 'mac-arm64'),
      join(process.cwd(), 'release', 'mac'),
      join(process.cwd(), 'release', 'mac-x64')
    ].map(directory => join(directory, 'WeFlow.app', 'Contents', 'Resources',
      'app.asar.unpacked', 'node_modules', nativeModule))
      .find(existsSync) || ''
  : ''
const verifyPackaged = result.status === 0 && restore.status === 0 && packagedAddon
  ? spawnSync(require('electron'), [
      join(__dirname, 'verify-packaged-sqlcipher.cjs'),
      packagedAddon
    ], { env, stdio: 'inherit' })
  : null

if (result.error) throw result.error
if (result.signal) console.error(`electron-builder 被信号 ${result.signal} 终止`)
if (restore.error) throw restore.error
if (restore.signal) console.error(`Node SQLCipher ABI 恢复被信号 ${restore.signal} 终止`)
if (verify?.error) throw verify.error
if (verify?.signal) console.error(`Node SQLCipher ABI 校验被信号 ${verify.signal} 终止`)
if (verifyPackaged?.error) throw verifyPackaged.error
if (verifyPackaged?.signal) console.error(`安装包 SQLCipher ABI 校验被信号 ${verifyPackaged.signal} 终止`)

const builderSucceeded = !result.signal && result.status === 0
const restoreSucceeded = !restore.signal && restore.status === 0
const verifySucceeded = Boolean(verify) && !verify.signal && verify.status === 0
const packagedVerifySucceeded = process.platform !== 'darwin'
  || Boolean(verifyPackaged) && !verifyPackaged.signal && verifyPackaged.status === 0
if (!builderSucceeded || !restoreSucceeded || !verifySucceeded || !packagedVerifySucceeded) {
  process.exit(1)
}
