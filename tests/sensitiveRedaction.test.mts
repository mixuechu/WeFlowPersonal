import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSensitiveRedactionContext,
  redactLocalSecrets,
  redactSensitiveText
} from '../electron/services/sensitiveRedaction.ts'

test('standard outbound redaction keeps stable placeholders without changing local source text', () => {
  const phone = '13800138000'
  const source = `请联系 ${phone}，邮箱 demo@example.com；再次确认 ${phone}。`
  const context = createSensitiveRedactionContext('standard')
  const result = redactSensitiveText(source, 'standard', context)
  assert.equal(result.text.includes(phone), false)
  assert.equal(result.text.match(/\[手机号#1\]/g)?.length, 2)
  assert.match(result.text, /\[邮箱#1\]/)
  assert.equal(result.summary.total, 3)
  assert.deepEqual(result.summary.counts, { 手机号: 2, 邮箱: 1 })
  assert.equal(source.includes(phone), true)
})

test('credential-only mode always hides secrets but leaves ordinary contact data intact', () => {
  const source = 'API Key: sk-0123456789abcdef0123456789abcdef，手机 13800138000'
  const result = redactSensitiveText(source, 'credentials')
  assert.equal(result.text.includes('sk-0123456789abcdef0123456789abcdef'), false)
  assert.equal(result.text.includes('13800138000'), true)
  assert.ok(result.summary.total >= 1)
  assert.equal(redactLocalSecrets(source).includes('13800138000'), true)
})

test('strict mode redacts identifiers, valid bank cards, IPs and secret URL parameters', () => {
  const source = [
    '身份证 11010519491231002X',
    '银行卡 4111 1111 1111 1111',
    '服务器 192.168.1.8',
    '链接 https://example.com/callback?token=super-secret-value&next=home'
  ].join('；')
  const result = redactSensitiveText(source, 'strict')
  assert.match(result.text, /\[身份证#1\]/)
  assert.match(result.text, /\[银行卡#1\]/)
  assert.match(result.text, /\[IP地址#1\]/)
  assert.match(result.text, /token=\[链接凭证#1\]/)
  assert.equal(result.summary.total, 4)
})

test('different sensitive values receive different placeholders while repeated values reuse one', () => {
  const result = redactSensitiveText('密码: first-secret 密码: second-secret 密码: first-secret', 'standard')
  assert.match(result.text, /密码: \[凭证#1\]/)
  assert.match(result.text, /密码: \[凭证#2\]/)
  assert.equal(result.text.match(/\[凭证#1\]/g)?.length, 2)
  assert.equal(result.summary.counts.凭证, 3)
})
