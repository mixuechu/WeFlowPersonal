import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlaceholderPersonEntity,
  quarantinePlaceholderPersonEntities
} from '../electron/services/placeholderEntityPolicy.ts'

test('placeholder people are quarantined for review without deleting entities or relations', () => {
  const entities = [
    {
      id: 'placeholder',
      type: 'person',
      canonicalName: '用户',
      trustStatus: 'confirmed',
      summary: '用户正在本地部署 Agent',
      summaryStatus: 'confirmed',
      identityVersion: 3
    },
    {
      id: 'real-person',
      type: 'person',
      canonicalName: '李金石',
      trustStatus: 'confirmed',
      summary: '',
      summaryStatus: 'empty'
    }
  ]
  const result = quarantinePlaceholderPersonEntities(entities, '2026-08-04T00:00:00.000Z')
  assert.equal(result.entities.length, 2)
  assert.equal(result.quarantined, 1)
  assert.equal(result.changed, 1)
  assert.deepEqual(result.entities.find(item => item.id === 'placeholder'), {
    ...entities[0],
    trustStatus: 'legacy_unverified',
    summaryStatus: 'legacy_unverified',
    identityVersion: 4,
    updatedAt: '2026-08-04T00:00:00.000Z'
  })
  assert.equal(result.entities.find(item => item.id === 'real-person'), entities[1])
  const relations = [{ id: 'kept', subjectId: 'placeholder', objectId: 'real-person' }]
  assert.equal(relations.length, 1)
})

test('placeholder quarantine is idempotent and only applies to person entities', () => {
  const entities = [
    {
      id: 'already-quarantined',
      type: 'person',
      canonicalName: '群友',
      trustStatus: 'legacy_unverified',
      summary: '',
      summaryStatus: 'empty',
      updatedAt: 'original'
    },
    {
      id: 'group-named-user',
      type: 'group',
      canonicalName: '用户',
      trustStatus: 'confirmed',
      summary: '',
      summaryStatus: 'empty'
    },
    {
      id: 'rejected-placeholder',
      type: 'person',
      canonicalName: '某人',
      trustStatus: 'rejected',
      summary: '',
      summaryStatus: 'empty'
    }
  ]
  assert.equal(isPlaceholderPersonEntity(entities[0]), true)
  assert.equal(isPlaceholderPersonEntity(entities[1]), false)
  const result = quarantinePlaceholderPersonEntities(entities, 'later')
  assert.equal(result.changed, 0)
  assert.equal(result.entities[0], entities[0])
  assert.equal(result.entities[1], entities[1])
  assert.equal(result.entities[2], entities[2])
})
