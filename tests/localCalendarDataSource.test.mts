import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LocalCalendarDataSource,
  calendarEventToDataSourceItem,
  type LocalCalendarEvent
} from '../electron/services/localCalendarDataSource.ts'
import { runPersonalDataSourceBatch } from '../electron/services/personalDataSources.ts'

function event(overrides: Partial<LocalCalendarEvent> = {}): LocalCalendarEvent {
  return {
    id: 'eventkit-1',
    externalId: 'external-1',
    calendarId: 'calendar-work',
    calendarTitle: '工作',
    title: '产品评审',
    notes: '讨论 Personal OS 增量记忆',
    location: '会议室 A',
    url: 'https://meet.example.test/review',
    startAt: '2026-07-30T02:00:00Z',
    endAt: '2026-07-30T03:00:00Z',
    isAllDay: false,
    status: '1',
    organizer: { name: '李金石', email: 'owner@example.test', role: 'organizer', status: 'accepted' },
    attendees: [{ name: 'Hun', email: 'hun@example.test', role: 'required', status: 'accepted' }],
    ...overrides
  }
}

test('calendar event becomes local structured evidence with participants and stable identity', () => {
  const first = calendarEventToDataSourceItem(event())
  const second = calendarEventToDataSourceItem(event({ notes: '内容已修改' }))
  assert.equal(first.sourceId, 'calendar')
  assert.equal(first.kind, 'calendar-event')
  assert.equal(first.externalId, second.externalId)
  assert.match(first.content, /会议室 A/)
  assert.match(first.content, /李金石/)
  assert.match(first.content, /Hun/)
  assert.deepEqual(first.participants?.map(value => value.id), ['owner@example.test', 'hun@example.test'])
  assert.notEqual(first.metadata?.contentHash, second.metadata?.contentHash)
})

test('calendar connector uses selected calendars and advances only after successful consumption', async () => {
  let current = event()
  const calls: Array<{ startAt: string; endAt: string; calendarIds: string[] }> = []
  const service = {
    async listEvents(startAt: string, endAt: string, calendarIds: string[]) {
      calls.push({ startAt, endAt, calendarIds })
      return [current]
    }
  }
  const connector = new LocalCalendarDataSource(
    ['calendar-work'],
    service,
    () => new Date('2026-07-30T00:00:00Z')
  )
  let checkpoint = ''
  const first = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 1)
  })
  checkpoint = first.checkpoint
  assert.equal(first.pulled, 1)
  assert.deepEqual(calls[0].calendarIds, ['calendar-work'])
  assert.equal(calls[0].startAt, '2026-05-01T00:00:00.000Z')
  assert.equal(calls[0].endAt, '2027-07-30T00:00:00.000Z')

  const unchanged = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 0)
  })
  assert.equal(unchanged.pulled, 0)

  current = event({ notes: '评审结论已更新' })
  await assert.rejects(
    runPersonalDataSourceBatch(connector, checkpoint, async () => {
      throw new Error('database unavailable')
    }),
    /database unavailable/
  )
  const retried = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 1)
    assert.match(items[0].content, /评审结论已更新/)
  })
  assert.equal(retried.pulled, 1)
  assert.notEqual(retried.checkpoint, checkpoint)
})

test('calendar connector pages changed events without repeating committed events', async () => {
  const events = [
    event({ id: '1', externalId: 'one', startAt: '2026-07-30T01:00:00Z' }),
    event({ id: '2', externalId: 'two', startAt: '2026-07-30T02:00:00Z' }),
    event({ id: '3', externalId: 'three', startAt: '2026-07-30T03:00:00Z' })
  ]
  const connector = new LocalCalendarDataSource(
    ['calendar-work'],
    { async listEvents() { return events } },
    () => new Date('2026-07-30T00:00:00Z')
  )
  let checkpoint = ''
  const seen: string[] = []
  for (let page = 0; page < 3; page += 1) {
    const result = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
      seen.push(...items.map(item => item.title + ':' + item.occurredAt))
    }, { limit: 1 })
    checkpoint = result.checkpoint
  }
  assert.equal(new Set(seen).size, 3)
  assert.equal(seen.length, 3)
})

test('calendar connector emits one cancellation tombstone when an in-window event is deleted', async () => {
  let events = [event()]
  const connector = new LocalCalendarDataSource(
    ['calendar-work'],
    { async listEvents() { return events } },
    () => new Date('2026-07-30T00:00:00Z')
  )
  let checkpoint = (await runPersonalDataSourceBatch(connector, '', async () => undefined)).checkpoint
  events = []
  const removed = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 1)
    assert.equal(items[0].metadata?.deleted, true)
    assert.match(items[0].content, /已从所选 macOS 日历中删除/)
  })
  checkpoint = removed.checkpoint
  assert.equal(removed.pulled, 1)
  const noRepeat = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
    assert.equal(items.length, 0)
  })
  assert.equal(noRepeat.pulled, 0)
})
