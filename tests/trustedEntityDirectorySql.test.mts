import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { PersonalMemoryStore } from '../electron/services/personalMemoryStore.ts'

const serviceSource = readFileSync(new URL(
  '../electron/services/aiAssistantService.ts', import.meta.url
), 'utf8')
const pageSource = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('all trusted directory reads and selection gates use SQLCipher authority', () => {
  const directoryStart = serviceSource.indexOf('  getTrustedEntityDirectory(')
  const directoryEnd = serviceSource.indexOf('\n  getEntityTaskPage(', directoryStart)
  const directorySlice = serviceSource.slice(directoryStart, directoryEnd)
  assert.match(directorySlice, /personalMemoryStore\.listTrustedEntityDirectoryPage\(options\)/)
  assert.match(directorySlice, /personalMemoryStore\.resolveTrustedEntityDirectorySelection\(/)
  assert.doesNotMatch(serviceSource, /buildTrustedEntityDirectory\(this\.state\.graph\.entities/)
  assert.doesNotMatch(serviceSource, /resolveTrustedEntitySelection\(this\.state\.graph\.entities/)
  assert.doesNotMatch(serviceSource, /resolveTrustedEntityPairSelection\(this\.state\.graph\.entities/)
  const questionStart = serviceSource.indexOf('  private async runMemoryQuestion(')
  const questionEnd = serviceSource.indexOf('\n  getAssistantConversations(', questionStart)
  const questionSource = serviceSource.slice(questionStart, questionEnd)
  assert.match(questionSource, /personalMemoryStore\.listTrustedEntitiesMentionedInText\(/)
  assert.doesNotMatch(questionSource, /this\.state\.graph\.entities\.(?:find|filter|map)/)
  for (const [startMarker, endMarker] of [
    ['  async searchMemoryHybrid(', '\n  async searchMemoryWithTrustedScope('],
    ['  async updateMemorySearchFeedback(', '\n  getMemorySearchFeedbackArchive(']
  ]) {
    const start = serviceSource.indexOf(startMarker)
    const end = serviceSource.indexOf(endMarker, start)
    assert.ok(start > 0 && end > start, startMarker)
    const source = serviceSource.slice(start, end)
    assert.match(source, /getTrustedEntityPresentations\(\[options\.entityId\]\)/, startMarker)
    assert.doesNotMatch(source, /this\.state\.graph\.entities\.(?:find|filter|map)/, startMarker)
  }
  for (const [startMarker, endMarker] of [
    ['  getMemoryClaim(', '\n  getMemoryEvent('],
    ['  getMemoryEvent(', '\n  getEventCorrectionParticipantPage('],
    ['  getMemoryRelation(', '\n  previewRelationCorrection('],
    ['  findGraphPath(', '\n  findCommonNeighbors('],
    ['  findCommonNeighbors(', '\n  async askMemory(']
  ]) {
    const start = serviceSource.indexOf(startMarker)
    const end = serviceSource.indexOf(endMarker, start)
    assert.ok(start > 0 && end > start, startMarker)
    const source = serviceSource.slice(start, end)
    assert.match(source, /getTrustedEntityPresentations\(/, startMarker)
    assert.doesNotMatch(source, /this\.state\.graph\.entities\.(?:find|filter)/, startMarker)
  }
  const pickerStart = pageSource.indexOf('function TrustedEntityPicker(')
  const pickerEnd = pageSource.indexOf('\nfunction EventParticipantEditor(', pickerStart)
  const picker = pageSource.slice(pickerStart, pickerEnd)
  assert.match(picker, /offset: nextOffset[\s\S]*?expectedRevision: revision/)
  assert.match(picker, /setNextOffset\(Number\(result\.nextOffset/)
  assert.match(picker, /加载更多（已加载 \{options\.length\} \/ \{total\}）/)
})

test('SQLCipher trusted entity directory searches and paginates without materializing the graph', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-trusted-directory-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const store = new PersonalMemoryStore()
    store.initialize(databasePath)
    store.syncGraph({
      entities: Array.from({ length: 1_205 }, (_, index) => ({
        id: `trusted-${index}`,
        type: index % 5 === 0 ? 'organization' : 'person',
        canonicalName: index < 2 ? '王伟' : `实体 ${String(index).padStart(4, '0')}`,
        aliases: [`别名-${index}`],
        accountIds: [`wxid-${index}`],
        externalIdentities: [{
          platform: 'email',
          accountId: `person-${index}@example.com`,
          displayName: `外部身份 ${index}`
        }],
        trustStatus: index === 1_204 ? 'candidate' : 'confirmed',
        confidence: 1,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z'
      })),
      relations: [],
      reviewQueue: []
    } as any)

    const first = store.listTrustedEntityDirectoryPage({ limit: 100 })
    assert.equal(first.total, 1_204)
    assert.equal(first.items.length, 100)
    assert.equal(first.nextOffset, 100)
    assert.equal(first.hasMore, true)
    const final = store.listTrustedEntityDirectoryPage({
      offset: 1_200,
      limit: 100,
      expectedRevision: first.revision
    })
    assert.equal(final.items.length, 4)
    assert.equal(final.hasMore, false)

    for (const query of ['别名-123', 'wxid-123', 'person-123@example.com', '外部身份 123']) {
      const result = store.listTrustedEntityDirectoryPage({ query })
      assert.ok(result.total >= 1, query)
      assert.equal(result.items[0]?.id, 'trusted-123', query)
    }
    const sameName = store.listTrustedEntityDirectoryPage({ query: '王伟' })
    assert.deepEqual(new Set(sameName.items.map(item => item.id)), new Set(['trusted-0', 'trusted-1']))
    assert.ok(sameName.items.every(item => item.canonicalNameCollisionCount === 2))

    const mentioned = store.listTrustedEntitiesMentionedInText(
      '请结合别名-123、wxid-456 和 person-789@example.com 的关系回答'
    )
    assert.equal(mentioned.stale, false)
    assert.deepEqual(
      new Set(mentioned.items.map(entity => entity.id)),
      new Set(['trusted-123', 'trusted-456', 'trusted-789'])
    )
    const manyMentions = store.listTrustedEntitiesMentionedInText(
      Array.from({ length: 110 }, (_, index) => `实体 ${String(index + 10).padStart(4, '0')}`).join('、'),
      25
    )
    assert.equal(manyMentions.total, 110)
    assert.equal(manyMentions.items.length, 25)
    assert.equal(manyMentions.truncated, true)
    assert.ok(manyMentions.items.every(entity => entity.trustStatus === 'confirmed'))

    const selection = store.resolveTrustedEntityDirectorySelection({
      entityIds: ['trusted-1', 'trusted-123'],
      expectedRevision: first.revision
    })
    assert.equal(selection.reason, 'ok')
    assert.deepEqual(selection.entities.map(entity => entity.id), ['trusted-1', 'trusted-123'])
    const partial = store.resolveTrustedEntityDirectorySelection({
      entityIds: ['trusted-1', 'trusted-1204'],
      expectedRevision: first.revision
    })
    assert.equal(partial.reason, 'entity_untrusted')
    assert.deepEqual(partial.entities.map(entity => entity.id), ['trusted-1'])

    const database = (store as any).db
    database.prepare(`
      INSERT INTO aliases(entity_id,value,normalized_value,alias_type,confidence)
      VALUES(?,?,?,?,?)
    `).run('trusted-1', '新身份', '新身份', 'name', 1)
    const stale = store.listTrustedEntityDirectoryPage({
      offset: 100,
      expectedRevision: first.revision
    })
    assert.equal(stale.stale, true)
    assert.deepEqual(stale.items, [])
    assert.equal(store.resolveTrustedEntityDirectorySelection({
      entityIds: ['trusted-1'],
      expectedRevision: first.revision
    }).reason, 'revision_changed')
    assert.equal(store.getTrustedEntityDirectoryRevisionHealth().healthy, true)
    assert.equal(store.getTrustedEntityDirectoryRevisionHealth().expectedTriggers, 9)
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('trusted entity directory revision trigger definitions self-heal on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-trusted-directory-health-'))
  const databasePath = join(directory, 'memory.sqlite')
  try {
    const first = new PersonalMemoryStore()
    first.initialize(databasePath)
    const database = (first as any).db
    database.exec('DROP TRIGGER trg_trusted_entity_directory_revision_aliases_update')
    assert.equal(first.getTrustedEntityDirectoryRevisionHealth().healthy, false)
    first.close()

    const reopened = new PersonalMemoryStore()
    reopened.initialize(databasePath)
    const health = reopened.getTrustedEntityDirectoryRevisionHealth()
    assert.equal(health.healthy, true)
    assert.equal(health.validTriggers, 9)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
