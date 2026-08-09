import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildGraphIdentitySuggestionPlan,
  buildGraphIdentitySuggestions,
  buildNameIdentityPairPlan
} from '../electron/services/identityDisambiguation.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function exhaustiveSuggestions(entities: any[], relations: any[]): any[] {
  const people = entities.filter(entity => entity.type === 'person').map(entity => entity.id)
  const peopleSet = new Set(people)
  const neighbors = new Map<string, Set<string>>()
  for (const relation of relations) {
    if (relation.status === 'rejected') continue
    if (peopleSet.has(relation.subjectId)) {
      const set = neighbors.get(relation.subjectId) || new Set<string>()
      set.add(relation.objectId)
      neighbors.set(relation.subjectId, set)
    }
    if (peopleSet.has(relation.objectId)) {
      const set = neighbors.get(relation.objectId) || new Set<string>()
      set.add(relation.subjectId)
      neighbors.set(relation.objectId, set)
    }
  }
  const result: any[] = []
  for (let left = 0; left < people.length; left += 1) {
    for (let right = left + 1; right < people.length; right += 1) {
      const shared = [...(neighbors.get(people[left]) || [])]
        .filter(id => neighbors.get(people[right])?.has(id)).length
      if (shared >= 2) result.push([people[left], people[right], shared])
    }
  }
  return result
}

test('inverted graph identity scan is equivalent to exhaustive sparse graph comparison', () => {
  const entities = [
    ...Array.from({ length: 240 }, (_, index) => ({
      id: `person-${String(index).padStart(3, '0')}`,
      type: 'person',
      canonicalName: `人物${index}`
    })),
    ...Array.from({ length: 80 }, (_, index) => ({
      id: `context-${index}`,
      type: index % 2 ? 'organization' : 'project',
      canonicalName: `上下文${index}`
    }))
  ]
  const relations: any[] = []
  for (let person = 0; person < 240; person += 1) {
    for (let offset = 0; offset < 4; offset += 1) {
      relations.push({
        subjectId: `person-${String(person).padStart(3, '0')}`,
        objectId: `context-${(person * 7 + offset * 13) % 80}`,
        status: offset === 3 && person % 11 === 0 ? 'rejected' : 'confirmed'
      })
    }
  }
  const expected = exhaustiveSuggestions(entities, relations)
  const actual = buildGraphIdentitySuggestions(entities, relations)
    .map(item => [item.leftId, item.rightId, Number(item.value.split(' ')[0])])
  assert.deepEqual(actual, expected)
})

test('high-degree graph hubs and pathological pair explosions are bounded and visible', () => {
  const people = Array.from({ length: 5_000 }, (_, index) => ({
    id: `person-${index}`, type: 'person', canonicalName: `人物${index}`
  }))
  const relations = people.flatMap(person => [
    { subjectId: person.id, objectId: 'global-group', status: 'confirmed' },
    { subjectId: person.id, objectId: 'global-org', status: 'confirmed' }
  ])
  const startedAt = performance.now()
  const plan = buildGraphIdentitySuggestionPlan(people, relations, {
    maxPeoplePerNeighbor: 500,
    maxPairCandidates: 1_000,
    maxSuggestions: 100
  })
  assert.equal(plan.suggestions.length, 0)
  assert.equal(plan.stats.skippedHighDegreeNeighbors, 2)
  assert.equal(plan.stats.pairCandidates, 0)
  assert.equal(plan.stats.truncated, false)
  assert.ok(performance.now() - startedAt < 3_000)

  const bounded = buildGraphIdentitySuggestionPlan(people.slice(0, 100), relations.slice(0, 200), {
    maxPeoplePerNeighbor: 100,
    maxPairCandidates: 50,
    maxSuggestions: 10
  })
  assert.equal(bounded.stats.pairCandidates, 50)
  assert.equal(bounded.stats.truncated, true)
  assert.equal(bounded.suggestions.length, 10)
})

test('identity scan diagnostics expose hub exclusions and truncation in the UI', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')
  const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')
  assert.match(service, /buildGraphIdentitySuggestionPlan/)
  assert.match(service, /contextualSkippedHubs = graphPlan\.stats\.skippedHighDegreeNeighbors/)
  assert.match(service, /contextualTruncated = graphPlan\.stats\.truncated/)
  assert.match(page, /共同邻居候选对/)
  assert.match(page, /已忽略低区分度超级枢纽/)
  assert.match(page, /已达安全上限/)
  assert.match(page, /最近每周同名候选对/)
  assert.match(page, /最大同名\/别名桶/)
  assert.match(page, /每周巡检已达上限/)
  assert.match(service, /loadIdentityDecisionIndex\(pairPlan\.pairKeys, now\)/)
  assert.match(service, /suggestions\.map\(suggestion => identityPairKey/)
  assert.match(store, /listIdentityDecisions\(pairKeys: string\[\]\)/)
  assert.match(store, /FROM json_each\(\?\) requested[\s\S]*JOIN identity_decisions/)
  assert.match(page, /SQLCipher 批量决定查询/)
  assert.match(service, /scanSimilarEntityPairsIncremental\(/)
  const contextualScan = service.slice(
    service.indexOf('private runContextualIdentityScan'),
    service.indexOf('private async syncLocalDocuments')
  )
  assert.ok(contextualScan.length > 0)
  assert.doesNotMatch(contextualScan, /listSimilarEntityPairs\(/)
  assert.match(store, /CREATE TABLE IF NOT EXISTS identity_vector_scan_state/)
  assert.match(store, /LIMIT \?\n\s*`\)\.all\(model, boundedProbeLimit\)/)
  assert.match(store, /commitIdentityVectorScanBatch\(/)
  assert.match(store, /INSERT OR IGNORE INTO identity_vector_scan_state[\s\S]*SELECT id,embedding_model,content_hash/)
  assert.match(service, /continueIdentityVectorScanWhileIdle\(now\)/)
  assert.match(service, /getIdentityVectorScanBacklog\([\s\S]*localEmbeddingService\.modelVersion/)
  assert.match(service, /if \(!vectorScan\.checkpoint\.probes\.length\)[\s\S]*vectorCheckpointCommitted = true/)
  assert.match(page, /本轮向量探针 \/ 扫描前待处理/)
  assert.match(page, /提交后剩余向量探针/)
  assert.match(page, /增量向量身份比较/)
  assert.match(page, /向量候选已达上限/)
  assert.match(page, /本轮向量进度未提交/)
})

test('weekly name scan keeps deterministic deduplicated order and bounds huge same-name buckets', () => {
  const ordinary = [{ id: 'z', type: 'person', canonicalName: '同名', aliases: ['共同别名'] }, {
    id: 'a', type: 'person', canonicalName: '同名', aliases: ['共同别名']
  }, {
    id: 'm', type: 'person', canonicalName: '第三人', aliases: ['共同别名']
  }]
  const ordinaryPlan = buildNameIdentityPairPlan(ordinary)
  assert.deepEqual(ordinaryPlan.pairKeys, ['a|z', 'm|z', 'a|m'])
  assert.equal(ordinaryPlan.stats.largestBucket, 3)
  assert.equal(ordinaryPlan.stats.truncated, false)

  const sameName = Array.from({ length: 10_000 }, (_, index) => ({
    id: `person-${index}`, type: 'person', canonicalName: '超大同名桶', aliases: []
  }))
  const startedAt = performance.now()
  const bounded = buildNameIdentityPairPlan(sameName, 100_000)
  assert.equal(bounded.pairKeys.length, 100_000)
  assert.equal(bounded.stats.largestBucket, 10_000)
  assert.equal(bounded.stats.truncated, true)
  assert.ok(performance.now() - startedAt < 3_000)
})
