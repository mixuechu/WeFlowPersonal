import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PUBLIC_REMOTE_FETCH_MAX_REDIRECTS,
  PUBLIC_REMOTE_FETCH_TIMEOUT_MS,
  PublicRemoteFetchError,
  detectSupportedRasterExtension,
  fetchPublicRemoteBuffer,
  parsePublicRemoteUrl
} from '../electron/services/publicRemoteFetchService.ts'

test('public remote fetch URL policy allows only credential-free default-port web URLs', () => {
  assert.equal(parsePublicRemoteUrl('https://example.test/media?id=1#private')?.href, 'https://example.test/media?id=1')
  assert.equal(parsePublicRemoteUrl('http://example.test/image.gif')?.protocol, 'http:')
  assert.equal(parsePublicRemoteUrl('file:///tmp/private'), null)
  assert.equal(parsePublicRemoteUrl('https://user:pass@example.test/media'), null)
  assert.equal(parsePublicRemoteUrl('https://example.test:8443/media'), null)
  assert.equal(parsePublicRemoteUrl('not a url'), null)
  assert.equal(PUBLIC_REMOTE_FETCH_MAX_REDIRECTS, 3)
  assert.equal(PUBLIC_REMOTE_FETCH_TIMEOUT_MS, 15_000)
})

test('public remote raster policy requires supported file signatures', () => {
  assert.equal(detectSupportedRasterExtension(Buffer.from('GIF89a', 'ascii')), '.gif')
  assert.equal(detectSupportedRasterExtension(Buffer.from('89504e470d0a1a0a', 'hex')), '.png')
  assert.equal(detectSupportedRasterExtension(Buffer.from('ffd8ffe00000', 'hex')), '.jpg')
  assert.equal(detectSupportedRasterExtension(Buffer.from('524946460000000057454250', 'hex')), '.webp')
  assert.equal(detectSupportedRasterExtension(Buffer.from('<svg><script>', 'utf8')), null)
  assert.equal(detectSupportedRasterExtension(Buffer.from('<html>login</html>', 'utf8')), null)
})

test('public remote fetch rejects private targets before opening a request', async () => {
  for (const target of [
    'http://127.0.0.1/avatar.gif',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.8/internal.png',
    'http://[::1]/avatar.gif'
  ]) {
    await assert.rejects(
      fetchPublicRemoteBuffer(target, { maxBytes: 1024 }),
      (error: unknown) => error instanceof PublicRemoteFetchError && error.code === 'unsafe_url',
      target
    )
  }
})

test('public remote fetch rejects invalid byte budgets without network access', async () => {
  await assert.rejects(
    fetchPublicRemoteBuffer('https://example.test/image.gif', { maxBytes: 0 }),
    (error: unknown) => error instanceof PublicRemoteFetchError && error.code === 'too_large'
  )
})
