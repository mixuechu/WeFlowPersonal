import test from 'node:test'
import assert from 'node:assert/strict'
import { boundEntityIdentityPresentation } from '../electron/services/entityIdentityPresentation.ts'

test('focused entity identity payload stays bounded while preserving authoritative totals', () => {
  const entity = {
    id: 'large-identity-payload',
    canonicalName: '大型身份人物',
    aliases: Array.from({ length: 500 }, (_, index) => `别名 ${index}`),
    accountIds: Array.from({ length: 400 }, (_, index) => `wxid_${index}`),
    externalIdentities: [
      ...Array.from({ length: 300 }, (_, index) => ({
        platform: 'email',
        accountId: `person-${index}@example.com`
      })),
      { platform: 'wechat', accountId: 'duplicate-wechat-carrier' }
    ],
    evidenceMessageIds: Array.from({ length: 500 }, (_, index) => `message-${index}`)
  }
  const presentation = boundEntityIdentityPresentation(entity)
  assert.equal(presentation.entity.aliases.length, 8)
  assert.equal(presentation.entity.accountIds.length, 8)
  assert.equal(presentation.entity.externalIdentities.length, 8)
  assert.deepEqual(presentation.summary, {
    aliases: 500,
    wechat: 400,
    external: 300,
    previewLimit: 8
  })
  assert.equal(entity.aliases.length, 500)
  assert.equal('evidenceMessageIds' in presentation.entity, false)
  assert.equal(JSON.stringify(presentation).includes('别名 499'), false)
  assert.equal(JSON.stringify(presentation).includes('person-299@example.com'), false)
})
