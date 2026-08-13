import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mapCalendarParticipantIdentities,
  normalizeEmailIdentity,
  type CalendarIdentityEntity
} from '../electron/services/calendarParticipantIdentity.ts'
import type { PersonalDataSourceItem } from '../electron/services/personalDataSources.ts'

const now = '2026-07-30T00:00:00.000Z'

function item(participants: PersonalDataSourceItem['participants']): PersonalDataSourceItem {
  return {
    sourceId: 'calendar',
    externalId: 'calendar-event-1',
    kind: 'calendar-event',
    occurredAt: now,
    title: '产品评审',
    content: '日历事件',
    participants,
    metadata: { contentHash: 'abcdef0123456789' }
  }
}

function existing(overrides: Partial<CalendarIdentityEntity> = {}): CalendarIdentityEntity {
  return {
    id: 'wechat-person',
    type: 'person',
    canonicalName: 'Hun',
    aliases: [],
    accountIds: ['wxid_hun'],
    externalIdentities: [],
    summary: '微信实体',
    confidence: 1,
    evidenceMessageIds: ['wechat-message'],
    createdAt: now,
    updatedAt: now,
    identityVersion: 1,
    lastDisambiguatedAt: null,
    ...overrides
  }
}

test('calendar email creates a deterministic identity and same-name review instead of auto-merging', () => {
  const result = mapCalendarParticipantIdentities([
    item([{ id: 'Hun@Example.Test', name: 'Hun', role: 'required' }])
  ], [existing()], now)
  assert.equal(result.entities.length, 2)
  const calendarEntity = result.entities.find(entity => entity.id !== 'wechat-person')!
  assert.match(calendarEntity.id, /^ent_email_[a-f0-9]{24}$/)
  assert.equal(calendarEntity.externalIdentities?.[0].accountId, 'hun@example.test')
  assert.deepEqual(result.participantsByEventId.get('calendar-event-1'), [{
    entityId: calendarEntity.id,
    role: 'required'
  }])
  assert.deepEqual(result.duplicateSuggestions, [{
    leftEntityId: calendarEntity.id,
    rightEntityId: 'wechat-person',
    name: 'Hun'
  }])
})

test('exact email reuses one entity while changed display names become aliases idempotently', () => {
  const first = mapCalendarParticipantIdentities([
    item([{ id: 'person@example.test', name: '小王', role: 'organizer' }])
  ], [], now)
  const second = mapCalendarParticipantIdentities([
    item([{ id: 'PERSON@example.test', name: '王老师', role: 'organizer' }])
  ], first.entities, '2026-07-31T00:00:00.000Z')
  assert.equal(second.entities.length, 1)
  assert.deepEqual(second.entities[0].aliases, ['王老师'])
  assert.equal(second.entities[0].identityVersion, 2)

  const third = mapCalendarParticipantIdentities([
    {
      ...item([{ id: 'person@example.test', name: '王老师', role: 'organizer' }]),
      externalId: 'calendar-event-2'
    }
  ], second.entities, '2026-08-01T00:00:00.000Z')
  assert.equal(third.entities.length, 1)
  assert.equal(third.entities[0].identityVersion, 2)
  assert.equal(third.changed, true)

  const fourth = mapCalendarParticipantIdentities([
    {
      ...item([{ id: 'person@example.test', name: '王老师', role: 'organizer' }]),
      externalId: 'calendar-event-2'
    }
  ], third.entities, '2026-08-02T00:00:00.000Z')
  assert.equal(fourth.entities[0].identityVersion, 2)
  assert.equal(fourth.changed, false)
})

test('name-only calendar participants never create or merge identities', () => {
  const result = mapCalendarParticipantIdentities([
    item([{ id: '同名用户', name: '同名用户', role: 'required' }])
  ], [existing({ canonicalName: '同名用户' })], now)
  assert.equal(result.entities.length, 1)
  assert.deepEqual(result.participantsByEventId.get('calendar-event-1'), [])
  assert.deepEqual(result.duplicateSuggestions, [])
  assert.equal(normalizeEmailIdentity('not-an-email'), '')
})
