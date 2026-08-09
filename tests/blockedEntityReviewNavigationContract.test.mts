import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('claim and event pages expose bounded untrusted entity review targets', () => {
  const service = read('electron/services/aiAssistantService.ts')
  assert.match(service, /buildUntrustedEntityReviewTargets\(/)
  assert.match(service, /claimUntrustedEntityIds\(claim, trustedIds\)/)
  assert.match(service, /eventUntrustedEntityIds\(event, trustedIds\)/)
  assert.match(service, /untrusted_entity_review_targets: reviewTargets\.items/)
  assert.match(service, /untrusted_entity_count: reviewTargets\.total/)
})

test('every blocked claim and event surface links to exact identity review work', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /function BlockedEntityReviewActions/)
  assert.match(page, /setReviewQuery\(target\.id\)/)
  assert.match(page, /target\.trustStatus === 'candidate' \? 'pending' : 'all'/)
  assert.equal(page.match(/<BlockedEntityReviewActions item=/g)?.length, 8)
  assert.match(page, /onOpenAll=\{\(\) => openReviewInboxTarget\('graph_identity'\)\}/)
})

test('blocked relation reviews return after exact endpoint identity work', () => {
  const page = read('src/pages/AiAssistantPage.tsx')
  assert.match(page, /const \[blockedIdentityReviewReturn, setBlockedIdentityReviewReturn\]/)
  assert.match(page, /memoryKind="relation"/)
  assert.match(page, /openBlockedEntityReview\(target, \{\s*reviewId: review\.id/)
  assert.match(page, /setReviewKindFilter\('entity_creation'\)/)
  assert.match(page, /setFocusedReviewId\(target\.reviewId\)/)
  assert.match(page, /blockedRelationReturnBeforeDecision\.reviewId !== id/)
  assert.match(page, /returnToBlockedRelationReview\(blockedRelationReturnBeforeDecision\)/)
})
