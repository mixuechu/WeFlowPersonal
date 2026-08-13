import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PersonalDataSourceConnector,
  PersonalDataSourceItem,
  PersonalDataSourcePullResult
} from './personalDataSources.ts'

export type LocalCalendarParticipant = {
  name: string
  email: string
  role: string
  status: string
}

export type LocalCalendarEvent = {
  id: string
  externalId: string
  calendarId: string
  calendarTitle: string
  title: string
  notes: string
  location: string
  url: string
  startAt: string
  endAt: string
  isAllDay: boolean
  status: string
  organizer?: LocalCalendarParticipant
  attendees: LocalCalendarParticipant[]
}

type CalendarCheckpoint = {
  version: 2
  events: Record<string, { hash: string; event: LocalCalendarEvent }>
}

function parseCheckpoint(value: string): CalendarCheckpoint {
  try {
    const parsed = JSON.parse(value || '{}')
    if (parsed?.version === 2 && parsed.events && typeof parsed.events === 'object') {
      return {
        version: 2,
        events: Object.fromEntries(Object.entries(parsed.events).slice(-20_000)) as CalendarCheckpoint['events']
      }
    }
  } catch {}
  return { version: 2, events: {} }
}

function eventStableId(event: LocalCalendarEvent): string {
  return createHash('sha256')
    .update(`${event.calendarId}\0${event.externalId || event.id}\0${event.startAt}`)
    .digest('hex')
    .slice(0, 32)
}

function eventContentHash(event: LocalCalendarEvent): string {
  return createHash('sha256').update(JSON.stringify({
    title: event.title,
    notes: event.notes,
    location: event.location,
    url: event.url,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    status: event.status,
    organizer: event.organizer,
    attendees: event.attendees
  })).digest('hex')
}

export function calendarEventToDataSourceItem(event: LocalCalendarEvent): PersonalDataSourceItem {
  const participants = [
    ...(event.organizer ? [{ ...event.organizer, role: 'organizer' }] : []),
    ...(event.attendees || [])
  ]
  const participantText = participants
    .map(value => [value.name, value.email, value.role, value.status].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('；')
  const content = [
    `日历：${event.calendarTitle}`,
    `时间：${event.startAt} 至 ${event.endAt}${event.isAllDay ? '（全天）' : ''}`,
    event.location ? `地点：${event.location}` : '',
    participantText ? `参与者：${participantText}` : '',
    event.notes ? `备注：${event.notes}` : '',
    event.url ? `链接：${event.url}` : ''
  ].filter(Boolean).join('\n')
  return {
    sourceId: 'calendar',
    externalId: eventStableId(event),
    kind: 'calendar-event',
    occurredAt: event.startAt,
    title: event.title || '未命名日历事件',
    content,
    scopeId: event.calendarId,
    scopeName: event.calendarTitle,
    participants: participants.map(value => ({
      id: value.email || value.name,
      name: value.name || value.email,
      role: value.role
    })),
    metadata: {
      eventId: event.id,
      externalEventId: event.externalId,
      calendarId: event.calendarId,
      calendarTitle: event.calendarTitle,
      startAt: event.startAt,
      endAt: event.endAt,
      isAllDay: event.isAllDay,
      status: event.status,
      location: event.location,
      url: event.url,
      organizer: event.organizer || null,
      attendees: event.attendees || [],
      contentHash: eventContentHash(event)
    }
  }
}

export class LocalCalendarService {
  private executable(): string {
    const candidates = [
      join(process.resourcesPath || '', 'resources', 'calendar-helper'),
      join(process.cwd(), 'resources', 'calendar-helper')
    ]
    return candidates.find(path => existsSync(path)) || ''
  }

  isAvailable(): boolean {
    return process.platform === 'darwin' && Boolean(this.executable())
  }

  private async run(command: string, args: string[] = []): Promise<any> {
    const executable = this.executable()
    if (!executable) throw new Error('EventKit 日历 helper 不可用')
    return await new Promise((resolve, reject) => {
      execFile(executable, [command, ...args], {
        timeout: 70_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, LANG: 'zh_CN.UTF-8' }
      }, (error, stdout) => {
        try {
          const payload = JSON.parse(String(stdout || '').trim())
          if (error || payload.success === false) {
            reject(new Error(payload.error || `日历 helper 失败：${error?.code || 'unknown'}`))
          } else {
            resolve(payload)
          }
        } catch {
          reject(error || new Error('日历 helper 返回了无效结果'))
        }
      })
    })
  }

  async getStatus(): Promise<{ available: boolean; authorization: string }> {
    if (!this.isAvailable()) return { available: false, authorization: 'unavailable' }
    const payload = await this.run('status')
    return { available: true, authorization: String(payload.authorization || 'unknown') }
  }

  async requestAccess(): Promise<{ available: boolean; authorization: string; granted: boolean }> {
    if (!this.isAvailable()) return { available: false, authorization: 'unavailable', granted: false }
    try {
      const payload = await this.run('request')
      const authorization = String(payload.authorization || 'unknown')
      return { available: true, authorization, granted: ['fullAccess', 'authorized'].includes(authorization) }
    } catch {
      const status = await this.getStatus()
      return { ...status, granted: false }
    }
  }

  async listCalendars(): Promise<Array<{ id: string; title: string; source: string; type: string }>> {
    const payload = await this.run('calendars')
    return Array.isArray(payload.calendars) ? payload.calendars : []
  }

  async listEvents(startAt: string, endAt: string, calendarIds: string[]): Promise<LocalCalendarEvent[]> {
    const payload = await this.run('events', [startAt, endAt, JSON.stringify(calendarIds)])
    return Array.isArray(payload.events) ? payload.events : []
  }
}

export class LocalCalendarDataSource implements PersonalDataSourceConnector {
  readonly id = 'calendar'
  readonly kind = 'calendar' as const
  readonly displayName = 'macOS 日历'
  readonly description = '用户明确授权并选择的 macOS 日历事件'
  readonly available = true
  readonly localOnly = true
  readonly capabilities = ['incremental', 'original-evidence', 'events'] as const
  private readonly calendarIds: string[]
  private readonly service: Pick<LocalCalendarService, 'listEvents'>
  private readonly now: () => Date

  constructor(
    calendarIds: string[],
    service: Pick<LocalCalendarService, 'listEvents'> = localCalendarService,
    now: () => Date = () => new Date()
  ) {
    this.calendarIds = calendarIds
    this.service = service
    this.now = now
  }

  async pull(input: { checkpoint: string; limit: number; signal?: AbortSignal }): Promise<PersonalDataSourcePullResult> {
    if (input.signal?.aborted) throw new Error('日历同步已取消')
    const checkpoint = parseCheckpoint(input.checkpoint)
    const now = this.now()
    const startAt = new Date(now.getTime() - 90 * 86_400_000).toISOString()
    const endAt = new Date(now.getTime() + 365 * 86_400_000).toISOString()
    const events = await this.service.listEvents(startAt, endAt, this.calendarIds)
    const current = events.map(event => ({
      event,
      item: calendarEventToDataSourceItem(event),
      hash: eventContentHash(event)
    }))
    const currentIds = new Set(current.map(entry => entry.item.externalId))
    const changed = current.filter(entry => checkpoint.events[entry.item.externalId]?.hash !== entry.hash)
    const removed = Object.entries(checkpoint.events)
      .filter(([id, entry]) =>
        !currentIds.has(id) &&
        this.calendarIds.includes(entry.event.calendarId) &&
        entry.event.startAt >= startAt &&
        entry.event.startAt <= endAt)
      .map(([id, entry]) => {
        const deletedEvent = {
          ...entry.event,
          notes: [entry.event.notes, '该事件已从所选 macOS 日历中删除。'].filter(Boolean).join('\n'),
          status: 'deleted'
        }
        return {
          event: deletedEvent,
          item: {
            ...calendarEventToDataSourceItem(deletedEvent),
            externalId: id,
            metadata: {
              ...calendarEventToDataSourceItem(deletedEvent).metadata,
              deleted: true
            }
          },
          hash: 'deleted'
        }
      })
    const pending = [...changed, ...removed]
      .sort((left, right) => left.item.occurredAt.localeCompare(right.item.occurredAt))
    const selected = pending.slice(0, Math.max(1, Math.min(500, input.limit)))
    for (const entry of selected) {
      if (entry.hash === 'deleted') delete checkpoint.events[entry.item.externalId]
      else checkpoint.events[entry.item.externalId] = { hash: entry.hash, event: entry.event }
    }
    return {
      items: selected.map(entry => entry.item),
      nextCheckpoint: JSON.stringify(checkpoint),
      hasMore: pending.length > selected.length
    }
  }
}

export const localCalendarService = new LocalCalendarService()
