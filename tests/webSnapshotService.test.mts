import test from 'node:test'
import assert from 'node:assert/strict'
import { captureWebSnapshot, extractWebSnapshotText, isSafePublicAddress } from '../electron/services/webSnapshotService.ts'

test('web snapshot address policy blocks local, private and metadata networks', () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.2.3', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1',
    '::ffff:127.0.0.1'
  ]) assert.equal(isSafePublicAddress(address), false, address)
  assert.equal(isSafePublicAddress('8.8.8.8'), true)
  assert.equal(isSafePublicAddress('2606:4700:4700::1111'), true)
})

test('web snapshot parser removes active content and extracts useful metadata', () => {
  const result = extractWebSnapshotText(`
    <html><head>
      <title>项目进展 &amp; 验收</title>
      <meta name="description" content="本周完成第一轮验收">
      <style>.secret{display:none}</style>
      <script>fetch('https://tracker.example')</script>
    </head><body>
      <main><h1>交付计划</h1><p>周五前提交测试报告。</p></main>
    </body></html>
  `)
  assert.equal(result.title, '项目进展 & 验收')
  assert.equal(result.description, '本周完成第一轮验收')
  assert.match(result.text, /周五前提交测试报告/)
  assert.doesNotMatch(result.text, /tracker|display:none/)
})

test('web snapshot capture rejects unsafe URL forms before making a request', async () => {
  assert.equal((await captureWebSnapshot('http://127.0.0.1/admin')).status, 'unsafe_url')
  assert.equal((await captureWebSnapshot('http://169.254.169.254/latest/meta-data')).status, 'unsafe_url')
  assert.equal((await captureWebSnapshot('https://user:password@example.com/')).status, 'unsafe_url')
  assert.equal((await captureWebSnapshot('https://example.com:8443/')).status, 'unsafe_url')
})
