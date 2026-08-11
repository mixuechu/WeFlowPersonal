import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('claim and event pages expose bounded untrusted entity review targets', () => {
  const service = read('electron/services/aiAssistantService.ts')
  const store = read('electron/services/personalMemoryStore.ts')
  const eventMethod = store.slice(
    store.indexOf('  listEventTimeline('),
    store.indexOf('\n  listEntityRelationPage(', store.indexOf('  listEventTimeline('))
  )
  const claimMethod = store.slice(
    store.indexOf('  listClaimArchive('),
    store.indexOf('\n  private memoryItemSemanticFingerprint(', store.indexOf('  listClaimArchive('))
  )
  assert.match(eventMethod, /LEFT JOIN entities e ON e\.id=ep\.entity_id/)
  assert.match(eventMethod, /entities_trusted: untrusted\.length === 0/)
  assert.match(eventMethod, /untrusted_entity_review_targets: untrusted\.slice\(0, 20\)/)
  assert.match(claimMethod, /s\.trust_status AS subject_trust_status/)
  assert.match(claimMethod, /entities_trusted: targets\.length === 0/)
  assert.match(claimMethod, /untrusted_entity_review_targets: targets\.slice\(0, 20\)/)
  assert.doesNotMatch(service.slice(
    service.indexOf('  getEventTimeline('),
    service.indexOf('\n  getEntityRelationPage(', service.indexOf('  getEventTimeline('))
  ), /this\.state\.graph\.entities/)
  assert.doesNotMatch(service.slice(
    service.indexOf('  getClaimArchive('),
    service.indexOf('\n  private inspectJointMemoryBackup(', service.indexOf('  getClaimArchive('))
  ), /this\.state\.graph\.entities/)
})

test('every blocked claim and event surface links to exact identity review work', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /function BlockedEntityReviewActions/)
  assert.match(page, /targets\.filter\(target => target\.trustStatus !== 'missing'\)/)
  assert.match(page, /blockedEntityMissingGuidance\(memoryKind\)/)
  assert.match(page, /setFocusedReviewEntityId\(target\.id\)/)
  assert.match(page, /setFocusedReviewEntityName\(target\.canonicalName\)/)
  assert.match(page, /entityId: focusedReviewEntityId \|\| undefined/)
  assert.match(page, /精确身份审阅范围：/)
  assert.match(page, /查看全部实体存在与名称档案/)
  assert.match(page, /compactReviewSourceId\(focusedReviewEntityId\)/)
  assert.match(page, /target\.trustStatus === 'candidate' \? 'pending' : 'all'/)
  assert.equal(page.match(/<BlockedEntityReviewActions item=/g)?.length, 8)
  assert.equal(page.match(/onOpenAll=\{/g)?.length >= 8, true)
  assert.match(page, /setReviewKindFilter\('entity_creation'\)/)
  assert.match(page, /setReviewStatusFilter\(scope\.status\)/)
})

test('blocked memories return after exact related identity work', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /const \[blockedIdentityReviewReturn, setBlockedIdentityReviewReturn\]/)
  assert.match(page, /memoryKind="relation"/)
  assert.match(page, /openBlockedEntityReview\(target, \{\s*kind: 'relation_review'/)
  assert.match(page, /buildBlockedStructuredMemoryReturnTarget\(memoryKind, item\)/)
  assert.match(page, /onOpen\(target, returnTarget\)/)
  assert.equal(page.match(/onOpenAll=\{returnTarget => openAllBlockedEntityReviews\(/g)?.length, 7)
  assert.match(page, /setReviewKindFilter\('entity_creation'\)/)
  assert.match(page, /setFocusedReviewId\(target\.reviewId\)/)
  assert.match(page, /shouldReturnToBlockedIdentitySource\(/)
  assert.match(page, /completedBlockedIdentity && blockedReturnBeforeDecision/)
  assert.match(page, /await returnToBlockedIdentitySource\(blockedReturnBeforeDecision\)/)
  assert.match(page, /target\.sourceId,\s*'identity_review'/)
  assert.match(page, /setBlockedIdentityReviewReturn\(null\); setReviewKindFilter/)
})
