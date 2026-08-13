import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOwnerEntityBinding } from '../electron/services/ownerEntityBindingPolicy.ts'
import { buildTrustedEntityDirectory } from '../electron/services/trustedEntityDirectory.ts'

const entities = [{
  id: 'owner-a',
  type: 'person',
  canonicalName: '同名用户',
  trustStatus: 'confirmed'
}, {
  id: 'owner-b',
  type: 'person',
  canonicalName: '同名用户',
  trustStatus: 'confirmed'
}, {
  id: 'owner-org',
  type: 'organization',
  canonicalName: '本人公司',
  trustStatus: 'confirmed'
}, {
  id: 'owner-candidate',
  type: 'person',
  canonicalName: '候选本人',
  trustStatus: 'candidate'
}]

test('owner identity binding is revision-bound, person-only and stable across same names', () => {
  const revision = buildTrustedEntityDirectory(entities).revision
  assert.equal(resolveOwnerEntityBinding(entities, {
    entityId: 'owner-b',
    directoryRevision: revision
  })?.id, 'owner-b')
  assert.equal(resolveOwnerEntityBinding(entities, {
    entityId: '',
    directoryRevision: ''
  }), null)
  assert.throws(() => resolveOwnerEntityBinding(entities, {
    entityId: 'owner-org',
    directoryRevision: revision
  }), /必须选择一个已确认的人物实体/)
  assert.throws(() => resolveOwnerEntityBinding(entities, {
    entityId: 'owner-candidate',
    directoryRevision: revision
  }), /已经变化、合并或不再可信/)
  assert.throws(() => resolveOwnerEntityBinding(entities, {
    entityId: 'owner-a',
    directoryRevision: 'stale'
  }), /已经变化、合并或不再可信/)
})
