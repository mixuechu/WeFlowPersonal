import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dirname, '..')

test('packaged SQLCipher verification uses a script app instead of unsupported Electron eval', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const command = String(packageJson.scripts?.['verify:packaged-sqlcipher'] || '')
  const verifier = readFileSync(join(repositoryRoot, 'scripts/verify-packaged-sqlcipher.cjs'), 'utf8')
  assert.match(command, /^electron scripts\/verify-packaged-sqlcipher\.cjs /)
  assert.doesNotMatch(command, /(?:^|\s)-(?:e|-eval)(?:\s|$)/)
  assert.match(verifier, /resolve\(addonArgument\)/)
  assert.match(verifier, /value:\s*database\.prepare/)
})

test('electron packaging restores and verifies the workspace Node SQLCipher ABI', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const builder = readFileSync(join(repositoryRoot, 'scripts/run-electron-builder.cjs'), 'utf8')
  const verifier = readFileSync(join(repositoryRoot, 'scripts/verify-workspace-sqlcipher.cjs'), 'utf8')
  assert.equal(
    packageJson.scripts?.['verify:workspace-sqlcipher'],
    'node scripts/verify-workspace-sqlcipher.cjs'
  )
  assert.match(builder, /spawnSync\(npmCommand, \['rebuild', nativeModule\]/)
  assert.match(builder, /verify-workspace-sqlcipher\.cjs/)
  assert.match(builder, /verify-packaged-sqlcipher\.cjs/)
  assert.match(builder, /packagedVerifySucceeded/)
  assert.match(builder, /afterPack may already have rewritten it/)
  assert.match(verifier, /require\('better-sqlite3-multiple-ciphers'\)/)
  assert.match(verifier, /value:\s*database\.prepare/)
  assert.match(verifier, /workspace-ok/)
})

test('mac packaging separates the packaged Electron addon from the restored Node addon', () => {
  const afterPack = readFileSync(join(repositoryRoot, 'scripts/after-pack.cjs'), 'utf8')
  const breakLinkAt = afterPack.indexOf('rmSync(encryptedSqliteTarget, { force: true })')
  const copyAt = afterPack.indexOf('copyFileSync(encryptedSqliteSource, encryptedSqliteTarget)')
  assert.ok(breakLinkAt >= 0)
  assert.ok(copyAt > breakLinkAt)
})

test('mac signing skips sealed Electron data resources but never native code', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const ignorePatterns = (packageJson.build?.mac?.signIgnore || []).map((pattern: string) => new RegExp(pattern))
  const ignored = (path: string) => ignorePatterns.some((pattern: RegExp) => pattern.test(path))
  const framework = '/tmp/WeFlow.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
  assert.equal(ignored(`${framework}/zh_CN.lproj/locale.pak`), true)
  assert.equal(ignored(`${framework}/icudtl.dat`), true)
  assert.equal(ignored(`${framework}/snapshot_blob.bin`), true)
  assert.equal(ignored('/tmp/WeFlow.app/Contents/Resources/app.asar.unpacked/native/addon.node'), false)
  assert.equal(ignored('/tmp/WeFlow.app/Contents/Resources/app.asar.unpacked/native/libsqlcipher.dylib'), false)
  assert.equal(ignored('/tmp/WeFlow.app/Contents/Frameworks/WeFlow Helper.app'), false)
})
