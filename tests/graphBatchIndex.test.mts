import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addEntityToResolutionIndex,
  buildExtractedEntityResolutionIndex,
  planExtractedEntityResolution
} from '../electron/services/entityResolutionPolicy.ts'
import {
  addIdentityCandidateToLookup,
  assessIdentityPair,
  buildIdentityCandidateLookup,
  listIndexedIdentityCandidates
} from '../electron/services/identityDisambiguation.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('indexed extraction resolution preserves account and non-person name semantics', () => {
  const entities = [{
    id: 'person-a', type: 'person', canonicalName: '张三', aliases: ['老张'], accountIds: ['wxid-a']
  }, {
    id: 'org-a', type: 'organization', canonicalName: '示例公司', aliases: [], accountIds: []
  }]
  const index = buildExtractedEntityResolutionIndex(entities)
  const evidence = [{ senderIdentity: { wxid: 'wxid-a', displayName: '张三' } }]
  const inputs = [{
    type: 'person', canonicalName: '张三', accountIds: ['wxid-a'], __evidenceMessages: evidence
  }, {
    type: 'person', canonicalName: '张三', accountIds: [], __evidenceMessages: evidence
  }, {
    type: 'organization', canonicalName: '示例公司', confidence: 0.95, accountIds: []
  }]
  for (const input of inputs) {
    const scanned = planExtractedEntityResolution(input, entities)
    const indexed = planExtractedEntityResolution(input, index)
    assert.equal(indexed.existing?.id || null, scanned.existing?.id || null)
    assert.equal(indexed.resolution, scanned.resolution)
    assert.deepEqual(indexed.sameNameCandidates.map(item => item.id), scanned.sameNameCandidates.map(item => item.id))
  }

  const added = { id: 'person-b', type: 'person', canonicalName: '李四', aliases: [], accountIds: ['wxid-b'] }
  entities.push(added)
  addEntityToResolutionIndex(index, added)
  const result = planExtractedEntityResolution({
    type: 'person', canonicalName: '李四', accountIds: ['wxid-b'],
    __evidenceMessages: [{ senderIdentity: { wxid: 'wxid-b', displayName: '李四' } }]
  }, index)
  assert.equal(result.existing?.id, 'person-b')
})

test('indexed identity candidates equal exhaustive eligibility while avoiding unrelated people', () => {
  const entities = Array.from({ length: 50_000 }, (_, index) => ({
    id: `person-${index}`,
    type: 'person',
    canonicalName: index % 1_000 === 0 ? '共同名字' : `人物${index}`,
    aliases: index % 2_500 === 0 ? ['共同别名'] : [],
    accountIds: index % 5_000 === 0 ? ['shared-account'] : [],
    identityVersion: 1
  }))
  const lookup = buildIdentityCandidateLookup(entities)
  const target = entities[0]
  const expected = entities.filter(candidate => assessIdentityPair(target, candidate).eligible)
  const actual = listIndexedIdentityCandidates(lookup, target)
  assert.deepEqual(actual.map(item => item.id), expected.map(item => item.id))
  assert.ok(actual.length < 100)

  const added = {
    id: 'person-added', type: 'person', canonicalName: '共同名字', aliases: [], accountIds: [], identityVersion: 1
  }
  addIdentityCandidateToLookup(lookup, added)
  assert.equal(listIndexedIdentityCandidates(lookup, target).at(-1)?.id, 'person-added')
})

test('model graph batch uses mutable indexes instead of repeated full graph scans', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const start = service.indexOf('private mergeGraphDigest')
  const end = service.indexOf('private persistClaimsAndEvents', start)
  const implementation = service.slice(start, end)
  assert.match(implementation, /buildExtractedEntityResolutionIndex/)
  assert.match(implementation, /buildIdentityCandidateLookup/)
  assert.match(implementation, /pendingEntityReviewsByEntityId/)
  assert.match(implementation, /relationsById/)
  assert.doesNotMatch(implementation, /this\.state\.graph\.entities\.find/)
  assert.doesNotMatch(implementation, /this\.state\.graph\.relations\.find/)
  assert.doesNotMatch(implementation, /this\.state\.graph\.reviewQueue\.some/)
})
