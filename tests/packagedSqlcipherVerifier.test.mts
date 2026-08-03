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
