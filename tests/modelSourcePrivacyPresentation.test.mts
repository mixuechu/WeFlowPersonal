import test from 'node:test'
import assert from 'node:assert/strict'
import { presentModelSourcePrivacyAudit } from '../src/utils/modelSourcePrivacyPresentation.ts'

test('model source privacy audit presentation explains current and historical boundaries', () => {
  const presented = presentModelSourcePrivacyAudit({
    version: 'model-source-privacy-v2',
    policy: { mail: false },
    contextDocuments: 7,
    privacyExcludedDocuments: 3,
    budgetOmittedDocuments: 2,
    incompleteSourceDocuments: 1,
    contextSourceIds: ['wechat', 'documents'],
    excludedSourceIds: ['mail', 'future-source'],
    outboundSha256: 'a'.repeat(64),
    redaction: { total: 4 },
    boundaryChecks: ['before_send', 'after_response']
  })
  assert.equal(presented.valid, true)
  assert.match(presented.summary, /发送 7 份.*隐私隔离 3 份.*Mail 未授权/)
  assert.match(presented.detail, /微信、本机文档/)
  assert.match(presented.detail, /Mail、未知来源\(future-source\)/)
  assert.match(presented.detail, /预算另省略 2 份/)
  assert.match(presented.detail, /来源证明不完整/)
  assert.match(presented.detail, /请求指纹 a{12}/)
  assert.match(presented.detail, /边界均已核验/)
  assert.equal(presentModelSourcePrivacyAudit({}).valid, false)
})
