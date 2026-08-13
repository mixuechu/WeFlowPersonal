import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types/electron.d.ts', import.meta.url), 'utf8')

test('five filtered structured-memory APIs reject continuation range drift before store reads', () => {
  for (const [method, builder] of [
    ['getClaimArchive', 'buildClaimPageScopeToken'],
    ['getEventTimeline', 'buildEventPageScopeToken'],
    ['getEntityRelationPage', 'buildRelationPageScopeToken'],
    ['getEntityIdentityAnchorPage', 'buildIdentityAnchorPageScopeToken'],
    ['getEntityEvidencePage', 'buildEntityEvidencePageScopeToken']
  ]) {
    const start = service.indexOf(`  ${method}(`)
    assert.notEqual(start, -1)
    const end = service.indexOf('\n  }', start)
    const block = service.slice(start, end + 4)
    assert.match(block, new RegExp(`${builder}\\(normalized\\)`))
    assert.match(block, /normalized\.offset > 0 &&[\s\S]*options\?\.pageScopeToken[\s\S]*!== pageScopeToken/)
    assert.match(block, /pageScopeStale: true, pageScopeToken/)
  }
})

test('all visible structured-memory continuation paths carry the first-page token', () => {
  assert.match(page, /revision: claimArchive\.revision,[\s\S]*pageScopeToken: claimArchive\.pageScopeToken/)
  assert.match(page, /revision: eventTimeline\.revision,[\s\S]*pageScopeToken: eventTimeline\.pageScopeToken/)
  assert.match(page, /revision: entityIdentityAnchorPage\.revision,[\s\S]*pageScopeToken: entityIdentityAnchorPage\.pageScopeToken/)
  assert.match(page, /revision: currentPage\.revision,[\s\S]*pageScopeToken: currentPage\.pageScopeToken/)
  assert.match(page, /revision: entityEvidencePage\.revision,[\s\S]*pageScopeToken: entityEvidencePage\.pageScopeToken/)
  assert.match(page, /revision: projectKeyEventPage\.revision,[\s\S]*pageScopeToken: projectKeyEventPage\.pageScopeToken/)
  assert.match(page, /revision: projectEvidencePage\.revision,[\s\S]*pageScopeToken: projectEvidencePage\.pageScopeToken/)
  assert.match(types, /getClaimArchive:[\s\S]*pageScopeToken\?: string; pageScopeStale\?: boolean/)
})
