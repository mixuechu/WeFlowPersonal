import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dirname, '..')

test('dependency audit gate checks production and complete trees without blocking offline builds', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const auditCommand = String(packageJson.scripts?.['verify:dependencies'] || '')
  const buildCommand = String(packageJson.scripts?.build || '')

  assert.equal(auditCommand, 'npm audit --omit=dev && npm audit')
  assert.doesNotMatch(buildCommand, /audit|verify:dependencies/)
})

test('every formal release platform fails closed on the shared dependency audit gate', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')
  const releaseJobs = ['release-mac-arm64', 'release-linux', 'release', 'release-windows-arm64']

  for (const [index, job] of releaseJobs.entries()) {
    const start = workflow.indexOf(`  ${job}:`)
    assert.notEqual(start, -1, `missing ${job} release job`)
    const nextJob = releaseJobs[index + 1]
    const end = nextJob ? workflow.indexOf(`  ${nextJob}:`, start + 1) : workflow.indexOf('  update-release-notes:', start + 1)
    const body = workflow.slice(start, end === -1 ? workflow.length : end)
    assert.match(body, /- name: Verify production and complete dependency trees\n\s+run: npm run verify:dependencies/)
  }
})
