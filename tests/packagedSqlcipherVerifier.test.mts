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
