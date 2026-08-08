import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dirname, '..')

const getCsp = (html: string): string => {
  const match = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])(.*?)\1/i)
  assert.ok(match, 'missing Content-Security-Policy meta tag')
  return match[2]
}

test('main renderer CSP permits local media but no inline or evaluated scripts', () => {
  const csp = getCsp(readFileSync(join(repositoryRoot, 'index.html'), 'utf8'))
  assert.match(csp, /script-src 'self'/)
  assert.doesNotMatch(csp, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval')/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-src 'none'/)
  assert.match(csp, /base-uri 'none'/)
  assert.match(csp, /form-action 'none'/)
  assert.match(csp, /img-src[^;]*\bfile:/)
  assert.match(csp, /media-src[^;]*\bfile:/)
})

test('preload-free splash has no network, frame, object or form capability', () => {
  const csp = getCsp(readFileSync(join(repositoryRoot, 'public/splash.html'), 'utf8'))
  assert.match(csp, /default-src 'none'/)
  assert.doesNotMatch(csp, /https?:|connect-src|worker-src/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-src 'none'/)
  assert.match(csp, /form-action 'none'/)
})
