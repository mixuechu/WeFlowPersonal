import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertIdentityCandidateVersionsCurrent,
  buildGraphIdentitySuggestionPlan,
  buildGraphIdentitySuggestions,
  buildNameIdentityPairPage,
  buildNameIdentityPairPlan,
  identityCandidateVersionsCurrent,
  planStaleGraphIdentityReviews,
  planStaleIdentityVersionReviews,
  planStaleRuleIdentityReviews,
  planStaleVectorIdentityReviews,
  resolveModelIdentitySuggestionTarget
} from '../electron/services/identityDisambiguation.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('identity merge confirmation is bound to both current entity versions', () => {
  const entities = new Map([
    ['left', { id: 'left', type: 'person', canonicalName: '甲', identityVersion: 4 }],
    ['right', { id: 'right', type: 'person', canonicalName: '乙', identityVersion: 7 }]
  ])
  assert.doesNotThrow(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right',
    leftIdentityVersion: 4, rightIdentityVersion: 7
  }, entities))
  assert.equal(identityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right',
    leftIdentityVersion: 4, rightIdentityVersion: 7
  }, entities), true)
  assert.equal(identityCandidateVersionsCurrent({
    leftEntityId: 'right', rightEntityId: 'left',
    leftIdentityVersion: 7, rightIdentityVersion: 4
  }, entities), true)
  assert.throws(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right',
    leftIdentityVersion: 3, rightIdentityVersion: 7
  }, entities), /人物档案已经变化/)
  assert.throws(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right',
    leftIdentityVersion: 4, rightIdentityVersion: 8
  }, entities), /人物档案已经变化/)
  assert.throws(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right',
    leftIdentityVersion: 7, rightIdentityVersion: 4
  }, entities), /人物档案已经变化/)
  assert.throws(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'right'
  }, entities), /旧版身份合并候选缺少实体版本/)
  assert.throws(() => assertIdentityCandidateVersionsCurrent({
    leftEntityId: 'left', rightEntityId: 'missing',
    leftIdentityVersion: 4, rightIdentityVersion: 7
  }, entities), /实体已经不存在/)
})

test('identity merge confirmation checks versions before writing review decisions', () => {
  const service = readFileSync(join(root, 'electron/services/aiAssistantService.ts'), 'utf8')
  const store = readFileSync(join(root, 'electron/services/personalMemoryStore.ts'), 'utf8')
  const page = readFileSync(join(root, 'src/pages/AiAssistantPage.tsx'), 'utf8')
  assert.match(service, /leftIdentityVersion: Number\(left\.identityVersion \|\| 1\)/)
  assert.match(service, /rightIdentityVersion: Number\(right\.identityVersion \|\| 1\)/)
  assert.match(service, /existing\?\.status === 'pending' && identityCandidateVersionsCurrent/)
  assert.doesNotMatch(service, /if \(existing\?\.status === 'pending'\) return false/)
  const applyReview = service.slice(
    service.indexOf('private applyGraphReview('),
    service.indexOf('private applyEntityRejectionCascade', service.indexOf('private applyGraphReview('))
  )
  assert.ok(applyReview.indexOf('assertIdentityCandidateVersionsCurrent(') >= 0)
  assert.ok(applyReview.indexOf('assertIdentityCandidateVersionsCurrent(') <
    applyReview.indexOf('recordIdentityReviewDecision('))
  assert.ok(applyReview.indexOf('assertIdentityCandidateVersionsCurrent(') <
    applyReview.indexOf('planEntityMerge('))
  assert.match(page, /旧版候选缺少人物身份版本，不能直接合并/)
  assert.match(page, /Boolean\(identityCandidateInvalidReason\)/)
  const graphRevisionTables = store.slice(
    store.indexOf('private graphReviewRevisionTables()'),
    store.indexOf('private backfillHumanReviewCalibrationHistory()')
  )
  assert.match(graphRevisionTables, /'graph_review_evidence'/)
  assert.match(graphRevisionTables, /'entities'/)
  assert.equal((store.match(/created_at=CASE[\s\S]*?candidateInstanceId/g) || []).length, 2)
})

test('identity scans retire only pending candidates whose endpoint versions are no longer current', () => {
  const entities = new Map([
    ['a', { id: 'a', type: 'person', canonicalName: '甲', identityVersion: 2 }],
    ['b', { id: 'b', type: 'person', canonicalName: '乙', identityVersion: 5 }]
  ])
  const base = {
    kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'b'
  }
  assert.deepEqual(planStaleIdentityVersionReviews([
    { id: 'current', ...base, leftIdentityVersion: 2, rightIdentityVersion: 5 },
    { id: 'left-changed', ...base, leftIdentityVersion: 1, rightIdentityVersion: 5 },
    { id: 'right-changed', ...base, leftIdentityVersion: 2, rightIdentityVersion: 4 },
    { id: 'swapped', ...base, leftIdentityVersion: 5, rightIdentityVersion: 2 },
    { id: 'legacy', ...base },
    { id: 'missing', ...base, rightEntityId: 'missing', leftIdentityVersion: 2, rightIdentityVersion: 5 },
    { id: 'resolved', ...base, status: 'rejected', leftIdentityVersion: 1, rightIdentityVersion: 5 },
    { id: 'relation', ...base, kind: 'relation', leftIdentityVersion: 1, rightIdentityVersion: 5 }
  ], entities), ['left-changed', 'right-changed', 'swapped', 'legacy', 'missing'])
})

test('model identity suggestions resolve only an exact trusted person id and canonical name', () => {
  const entities = new Map([
    ['person-a', { id: 'person-a', type: 'person', canonicalName: '同名用户', trustStatus: 'confirmed' }],
    ['person-b', { id: 'person-b', type: 'person', canonicalName: '同名用户', trustStatus: 'confirmed' }],
    ['candidate', { id: 'candidate', type: 'person', canonicalName: '候选人物', trustStatus: 'candidate' }],
    ['organization', { id: 'organization', type: 'organization', canonicalName: '同名用户', trustStatus: 'confirmed' }]
  ])
  assert.equal(resolveModelIdentitySuggestionTarget({
    rightExistingEntityId: 'person-b', rightExistingName: '同名用户'
  }, entities)?.id, 'person-b')
  assert.equal(resolveModelIdentitySuggestionTarget({ rightExistingName: '同名用户' }, entities), null)
  assert.equal(resolveModelIdentitySuggestionTarget({
    rightExistingEntityId: 'person-a', rightExistingName: '错误名称'
  }, entities), null)
  assert.equal(resolveModelIdentitySuggestionTarget({
    rightExistingEntityId: 'candidate', rightExistingName: '候选人物'
  }, entities), null)
  assert.equal(resolveModelIdentitySuggestionTarget({
    rightExistingEntityId: 'organization', rightExistingName: '同名用户'
  }, entities), null)
  assert.equal(resolveModelIdentitySuggestionTarget({
    rightExistingEntityId: 'invented', rightExistingName: '同名用户'
  }, entities), null)
})

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
  assert.match(page, /每周巡检正在续跑/)
  assert.match(page, /稳定断点已加密保存/)
  assert.match(service, /buildNameIdentityPairPage\(people, \{ cursor: pendingCursor \}\)/)
  assert.match(service, /loadIdentityDecisionIndex\(pairPage\.pairKeys, now\)/)
  assert.match(service, /lastFullScanAt: pairPage\.hasMore \? this\.state\.graph\.identityScan\.lastFullScanAt : now/)
  assert.match(service, /fullScanCursor: pairPage\.nextCursor/)
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
  assert.match(store, /idx_search_documents_person_embedding_scan/)
  assert.match(store, /json_extract\(d?\.?metadata_json,'\$\.entityType'\)='person'/)
  assert.match(store, /LIMIT \?\n\s*`\)\.all\(model, boundedProbeLimit\)/)
  assert.match(store, /commitIdentityVectorScanBatch\(/)
  assert.match(store, /identity_vector_scan_state[\s\S]*vector_hash TEXT NOT NULL DEFAULT ''/)
  assert.match(store, /scanned\.vector_hash=weflow_sha256\(d\.embedding_json\)/)
  assert.match(store, /INSERT INTO identity_vector_scan_state\([\s\S]*vector_hash[\s\S]*weflow_sha256\(embedding_json\)/)
  assert.match(store, /weflow_sha256\(current\.embedding_json\)=identity_vector_scan_state\.vector_hash/)
  assert.match(store, /currentProbeCount !== probes\.length[\s\S]*checkpoint 已过期，未写入候选或进度/)
  assert.match(store, /committedProbes !== probes\.length[\s\S]*checkpoint 已提交或发生竞争/)
  assert.match(service, /const reviewQueueBefore = structuredClone\(this\.state\.graph\.reviewQueue\)/)
  assert.match(service, /this\.state\.graph\.reviewQueue = reviewQueueBefore[\s\S]*reviewsById\.clear\(\)/)
  assert.match(service, /return \{ committed: false, pendingAfter: vectorScan\.stats\.pendingBefore, candidates: 0 \}/)
  assert.match(service, /进度已提交，但读取剩余积压失败/)
  assert.match(service, /planStaleVectorIdentityReviews\([\s\S]*!vectorScan\.stats\.truncated/)
  assert.match(service, /graphCommitId,[\s\S]*staleVectorReviewIds/)
  assert.match(store, /DELETE FROM review_queue[\s\S]*candidateSource'\)='vector_similarity'/)
  assert.match(service, /continueIdentityVectorScanWhileIdle\(now\)/)
  assert.match(service, /getIdentityVectorScanBacklog\([\s\S]*localEmbeddingService\.modelVersion/)
  assert.match(service, /if \(!vectorScan\.checkpoint\.probes\.length\)[\s\S]*vectorCheckpointCommitted = true/)
  assert.match(page, /本轮向量探针 \/ 扫描前待处理/)
  assert.match(page, /提交后剩余向量探针/)
  assert.match(page, /增量向量身份比较/)
  assert.match(page, /获得候选席位 \/ 存在命中的探针/)
  assert.match(page, /本轮撤销过期纯向量候选/)
  assert.match(page, /本机人物档案向量相似建议/)
  assert.match(page, /共同关系邻居建议/)
  assert.match(service, /planStaleGraphIdentityReviews\([\s\S]*skippedHighDegreeNeighbors === 0/)
  assert.match(page, /本轮撤销过期纯关系候选/)
  assert.match(service, /planStaleRuleIdentityReviews\([\s\S]*this\.runVectorIdentityScan/)
  assert.match(page, /本轮撤销过期纯规则候选/)
  assert.match(page, /本轮退役身份版本已变化候选/)
  assert.match(page, /仍有当前规则依据并重新生成/)
  assert.match(page, /向量候选已达上限/)
  assert.match(page, /本轮向量进度未提交/)
  assert.ok(contextualScan.indexOf('planStaleIdentityVersionReviews(') >= 0)
  assert.ok(contextualScan.indexOf('planStaleIdentityVersionReviews(') <
    contextualScan.indexOf('planStaleRuleIdentityReviews('))
  assert.ok(contextualScan.indexOf('planStaleIdentityVersionReviews(') <
    contextualScan.indexOf('this.runVectorIdentityScan('))
  assert.match(contextualScan, /assessIdentityPair\(left, right\)\.eligible && this\.enqueueIdentityPair\([\s\S]*?left, right, now, undefined/)
  assert.match(service, /rightExistingEntityId/)
  assert.doesNotMatch(service, /entitiesByCanonicalName\.get\(String\(item\.rightExistingName/)
  assert.match(service, /buildStructuredExtractionEvidence\([\s\S]*?source: 'llm_suggestion'/)
})

test('complete vector rescans retire only unsupported pure-vector identity reviews', () => {
  const reviews = [{
    id: 'stale-vector', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'b', candidateSource: 'vector_similarity',
    candidateSignals: [{ source: 'vector_similarity' }]
  }, {
    id: 'still-current', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'c', candidateSource: 'vector_similarity',
    candidateSignals: [{ source: 'vector_similarity' }]
  }, {
    id: 'rule-supported', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'd', candidateSource: 'vector_similarity',
    candidateSignals: [{ source: 'exact_name' }, { source: 'vector_similarity' }]
  }, {
    id: 'unscanned', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'x', rightEntityId: 'y', candidateSource: 'vector_similarity',
    candidateSignals: [{ source: 'vector_similarity' }]
  }, {
    id: 'human-resolved', kind: 'possible_duplicate', status: 'rejected',
    leftEntityId: 'a', rightEntityId: 'e', candidateSource: 'vector_similarity',
    candidateSignals: [{ source: 'vector_similarity' }]
  }]
  assert.deepEqual(planStaleVectorIdentityReviews(
    reviews,
    new Set(['a']),
    new Set(['a|c']),
    true
  ), ['stale-vector'])
  assert.deepEqual(planStaleVectorIdentityReviews(
    reviews,
    new Set(['a']),
    new Set(['a|c']),
    false
  ), [])
})

test('complete contextual scans retire only unsupported pure-graph identity reviews', () => {
  const reviews = [{
    id: 'stale-graph', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'b', candidateSource: 'graph_neighbors',
    candidateSignals: [{ source: 'graph_neighbors' }]
  }, {
    id: 'current-graph', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'c', candidateSource: 'graph_neighbors',
    candidateSignals: [{ source: 'graph_neighbors' }]
  }, {
    id: 'graph-and-name', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'd', candidateSource: 'graph_neighbors',
    candidateSignals: [{ source: 'exact_name' }, { source: 'graph_neighbors' }]
  }, {
    id: 'resolved-graph', kind: 'possible_duplicate', status: 'confirmed',
    leftEntityId: 'a', rightEntityId: 'e', candidateSource: 'graph_neighbors',
    candidateSignals: [{ source: 'graph_neighbors' }]
  }]
  assert.deepEqual(planStaleGraphIdentityReviews(
    reviews,
    new Set(['a|c']),
    true
  ), ['stale-graph'])
  assert.deepEqual(planStaleGraphIdentityReviews(
    reviews,
    new Set(['a|c']),
    false
  ), [])
})

test('current entity identities retire only unsupported pure-rule identity reviews', () => {
  const entities = new Map([
    ['a', { id: 'a', type: 'person', canonicalName: '甲', aliases: ['共同别名'], accountIds: [] }],
    ['b', { id: 'b', type: 'person', canonicalName: '乙', aliases: ['共同别名'], accountIds: [] }],
    ['c', { id: 'c', type: 'person', canonicalName: '丙', aliases: [], accountIds: [] }],
    ['d', { id: 'd', type: 'person', canonicalName: '丁', aliases: [], accountIds: [] }],
    ['e', { id: 'e', type: 'person', canonicalName: '戊', aliases: [], accountIds: ['wx-shared'] }],
    ['f', { id: 'f', type: 'person', canonicalName: '己', aliases: [], accountIds: ['wx-shared'] }],
    ['g', { id: 'g', type: 'person', canonicalName: '庚', aliases: [], accountIds: [] }]
  ])
  const reviews = [{
    id: 'still-rule-supported', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'b', candidateSource: 'alias_overlap',
    candidateSignals: [{ source: 'alias_overlap' }]
  }, {
    id: 'still-account-supported', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'e', rightEntityId: 'f', candidateSource: 'shared_account',
    candidateSignals: [{ source: 'shared_account' }]
  }, {
    id: 'removed-account', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'e', rightEntityId: 'g', candidateSource: 'shared_account',
    candidateSignals: [{ source: 'shared_account' }]
  }, {
    id: 'renamed-rule', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'c', candidateSource: 'exact_name',
    candidateSignals: [{ source: 'exact_name' }]
  }, {
    id: 'missing-endpoint', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'missing', candidateSource: 'shared_account',
    candidateSignals: [{ source: 'shared_account' }]
  }, {
    id: 'mixed-model', kind: 'possible_duplicate', status: 'pending',
    leftEntityId: 'a', rightEntityId: 'd', candidateSource: 'llm_suggestion',
    candidateSignals: [{ source: 'exact_name' }, { source: 'llm_suggestion' }]
  }, {
    id: 'resolved-rule', kind: 'possible_duplicate', status: 'rejected',
    leftEntityId: 'a', rightEntityId: 'c', candidateSource: 'exact_name',
    candidateSignals: [{ source: 'exact_name' }]
  }]
  assert.deepEqual(planStaleRuleIdentityReviews(reviews, entities), [
    'removed-account',
    'renamed-rule',
    'missing-endpoint'
  ])
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

test('weekly name scan continuation reaches every pair exactly once and rejects stale cursors', () => {
  const people = Array.from({ length: 6 }, (_, index) => ({
    id: `person-${index}`, type: 'person', canonicalName: '同名',
    aliases: index < 3 ? ['共享别名'] : [], identityVersion: 1
  }))
  const seen: string[] = []
  let cursor: string | null = null
  let fingerprint = ''
  do {
    const page = buildNameIdentityPairPage(people, { cursor, limit: 4 })
    if (fingerprint) assert.equal(page.snapshotFingerprint, fingerprint)
    fingerprint = page.snapshotFingerprint
    seen.push(...page.pairKeys)
    cursor = page.nextCursor
    if (!page.hasMore) break
  } while (true)
  assert.equal(seen.length, 15)
  assert.equal(new Set(seen).size, 15)
  assert.deepEqual([...seen].sort(), [...buildNameIdentityPairPlan(people).pairKeys].sort())

  const malformed = buildNameIdentityPairPage(people, { cursor: 'not-a-cursor', limit: 4 })
  assert.equal(malformed.cursorAccepted, false)
  assert.deepEqual(malformed.pairKeys, seen.slice(0, 4))
  const missingEndpointCursor = Buffer.from(JSON.stringify(['同名', 'missing', 'person-5'])).toString('base64url')
  const missingEndpoint = buildNameIdentityPairPage(people, { cursor: missingEndpointCursor, limit: 4 })
  assert.equal(missingEndpoint.cursorAccepted, false)
  assert.deepEqual(missingEndpoint.pairKeys, seen.slice(0, 4))
  const changed = buildNameIdentityPairPage([
    ...people.slice(0, 5), { ...people[5], identityVersion: 2 }
  ], { cursor: buildNameIdentityPairPage(people, { limit: 4 }).nextCursor, limit: 4 })
  assert.notEqual(changed.snapshotFingerprint, fingerprint)
})
