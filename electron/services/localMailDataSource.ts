import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PersonalDataSourceConnector,
  PersonalDataSourceItem,
  PersonalDataSourcePullResult
} from './personalDataSources.ts'

export type LocalMailMailbox = {
  id: string
  accountId: string
  accountName: string
  path: string[]
  displayName: string
}

export type LocalMailMessage = {
  id: string
  messageId: string
  accountId: string
  mailboxId: string
  mailboxName: string
  subject: string
  sender: string
  to: string[]
  cc: string[]
  receivedAt: string
  sentAt: string
  content: string
  read: boolean
  flagged: boolean
  size: number
  attachmentNames: string[]
}

type MailboxCheckpoint = {
  cursor: string
  seenLocalIds: string[]
}

type MailCheckpoint = {
  version: 1
  mailboxes: Record<string, MailboxCheckpoint>
  hashes: Record<string, string>
}

function parseCheckpoint(value: string): MailCheckpoint {
  try {
    const parsed = JSON.parse(value || '{}')
    if (parsed?.version === 1 && parsed.mailboxes && parsed.hashes) {
      return {
        version: 1,
        mailboxes: Object.fromEntries(
          Object.entries(parsed.mailboxes).slice(-500).map(([id, entry]: [string, any]) => [id, {
            cursor: String(entry?.cursor || ''),
            seenLocalIds: Array.isArray(entry?.seenLocalIds)
              ? entry.seenLocalIds.map(String).slice(-5000)
              : []
          }])
        ),
        hashes: Object.fromEntries(Object.entries(parsed.hashes).slice(-20_000)) as Record<string, string>
      }
    }
  } catch {}
  return { version: 1, mailboxes: {}, hashes: {} }
}

function stableMessageId(message: LocalMailMessage): string {
  const identity = String(message.messageId || '').trim() ||
    `${message.mailboxId}\0${message.id}\0${message.receivedAt}`
  return createHash('sha256').update(`${message.accountId}\0${identity}`).digest('hex').slice(0, 32)
}

function contentHash(message: LocalMailMessage): string {
  return createHash('sha256').update(JSON.stringify({
    mailboxId: message.mailboxId,
    mailboxName: message.mailboxName,
    subject: message.subject,
    sender: message.sender,
    to: message.to,
    cc: message.cc,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
    content: message.content,
    read: message.read,
    flagged: message.flagged,
    attachmentNames: message.attachmentNames
  })).digest('hex')
}

export function mailMessageToDataSourceItem(message: LocalMailMessage): PersonalDataSourceItem {
  const externalId = stableMessageId(message)
  const hash = contentHash(message)
  const content = [
    `发件人：${message.sender || '未知'}`,
    message.to.length ? `收件人：${message.to.join('、')}` : '',
    message.cc.length ? `抄送：${message.cc.join('、')}` : '',
    message.sentAt ? `发送时间：${message.sentAt}` : '',
    message.attachmentNames.length ? `附件：${message.attachmentNames.join('、')}` : '',
    '',
    message.content
  ].filter((value, index) => Boolean(value) || index === 5).join('\n').slice(0, 30_000)
  return {
    sourceId: 'mail',
    externalId,
    kind: 'email',
    occurredAt: message.receivedAt,
    title: message.subject || '无主题邮件',
    content,
    scopeId: message.mailboxId,
    scopeName: message.mailboxName,
    participants: [
      { id: message.sender, name: message.sender, role: 'sender' },
      ...message.to.map(value => ({ id: value, name: value, role: 'recipient' })),
      ...message.cc.map(value => ({ id: value, name: value, role: 'cc' }))
    ].filter(value => value.id),
    metadata: {
      localMessageId: message.id,
      messageId: message.messageId,
      accountId: message.accountId,
      mailboxId: message.mailboxId,
      mailboxName: message.mailboxName,
      sender: message.sender,
      to: message.to,
      cc: message.cc,
      receivedAt: message.receivedAt,
      sentAt: message.sentAt,
      read: message.read,
      flagged: message.flagged,
      size: message.size,
      attachmentNames: message.attachmentNames,
      contentHash: hash
    }
  }
}

export class LocalMailService {
  private executable(): string {
    const candidates = [
      join(process.resourcesPath || '', 'resources', 'mail-helper'),
      join(process.cwd(), 'resources', 'mail-helper')
    ]
    return candidates.find(path => existsSync(path)) || ''
  }

  isAvailable(): boolean {
    return process.platform === 'darwin' && Boolean(this.executable())
  }

  private async run(command: string, args: string[] = []): Promise<any> {
    const executable = this.executable()
    if (!executable) throw new Error('Mail 只读 helper 不可用')
    return await new Promise((resolve, reject) => {
      execFile(executable, [command, ...args], {
        timeout: 90_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, LANG: 'zh_CN.UTF-8' }
      }, (error, stdout) => {
        try {
          const payload = JSON.parse(String(stdout || '').trim())
          if (error || payload.success === false) {
            reject(new Error(payload.error || `Mail helper 失败：${error?.code || 'unknown'}`))
          } else {
            resolve(payload)
          }
        } catch {
          reject(error || new Error('Mail helper 返回了无效结果'))
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
      return { available: true, authorization, granted: authorization === 'authorized' }
    } catch {
      const status = await this.getStatus()
      return { ...status, granted: false }
    }
  }

  async listMailboxes(): Promise<LocalMailMailbox[]> {
    const payload = await this.run('mailboxes')
    return Array.isArray(payload.mailboxes) ? payload.mailboxes : []
  }

  async listMessages(
    mailboxId: string,
    startAt: string,
    endAt: string,
    limit: number,
    skippedLocalIds: string[]
  ): Promise<{ messages: LocalMailMessage[]; hasMore: boolean }> {
    const payload = await this.run('messages', [
      mailboxId,
      startAt,
      endAt,
      String(limit),
      JSON.stringify(skippedLocalIds.slice(-5000))
    ])
    return {
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      hasMore: Boolean(payload.hasMore)
    }
  }
}

export class LocalMailDataSource implements PersonalDataSourceConnector {
  readonly id = 'mail'
  readonly kind = 'email' as const
  readonly displayName = 'macOS Mail'
  readonly description = '用户明确授权并选择的 macOS Mail 邮箱'
  readonly available = true
  readonly localOnly = true
  readonly capabilities = ['incremental', 'original-evidence', 'attachments'] as const
  private readonly mailboxIds: string[]
  private readonly service: Pick<LocalMailService, 'listMessages'>
  private readonly now: () => Date

  constructor(
    mailboxIds: string[],
    service: Pick<LocalMailService, 'listMessages'> = localMailService,
    now: () => Date = () => new Date()
  ) {
    this.mailboxIds = [...new Set(mailboxIds.map(String).filter(Boolean))]
    this.service = service
    this.now = now
  }

  async pull(input: { checkpoint: string; limit: number; signal?: AbortSignal }): Promise<PersonalDataSourcePullResult> {
    if (input.signal?.aborted) throw new Error('邮件同步已取消')
    const checkpoint = parseCheckpoint(input.checkpoint)
    const now = this.now()
    const endAt = now.toISOString()
    let helperHasMore = false
    const candidates: Array<{
      mailboxId: string
      message: LocalMailMessage
      item: PersonalDataSourceItem
      hash: string
    }> = []
    for (const mailboxId of this.mailboxIds) {
      if (input.signal?.aborted) throw new Error('邮件同步已取消')
      const mailboxCheckpoint = checkpoint.mailboxes[mailboxId] || { cursor: '', seenLocalIds: [] }
      const cursorTime = Date.parse(mailboxCheckpoint.cursor)
      const startAt = new Date(Number.isFinite(cursorTime)
        ? Math.max(0, cursorTime - 5 * 60_000)
        : now.getTime() - 30 * 86_400_000).toISOString()
      const result = await this.service.listMessages(
        mailboxId,
        startAt,
        endAt,
        Math.max(1, Math.min(500, input.limit + 1)),
        mailboxCheckpoint.seenLocalIds
      )
      helperHasMore ||= result.hasMore
      for (const message of result.messages) {
        const item = mailMessageToDataSourceItem(message)
        const hash = String(item.metadata?.contentHash || '')
        if (checkpoint.hashes[item.externalId] === hash) continue
        candidates.push({ mailboxId, message, item, hash })
      }
    }
    candidates.sort((left, right) =>
      left.item.occurredAt.localeCompare(right.item.occurredAt) ||
      left.item.externalId.localeCompare(right.item.externalId))
    const selected = candidates.slice(0, Math.max(1, Math.min(500, input.limit)))
    for (const entry of selected) {
      checkpoint.hashes[entry.item.externalId] = entry.hash
      const current = checkpoint.mailboxes[entry.mailboxId] || { cursor: '', seenLocalIds: [] }
      current.cursor = current.cursor > entry.item.occurredAt ? current.cursor : entry.item.occurredAt
      current.seenLocalIds = [...new Set([...current.seenLocalIds, entry.message.id])].slice(-5000)
      checkpoint.mailboxes[entry.mailboxId] = current
    }
    return {
      items: selected.map(entry => entry.item),
      nextCheckpoint: JSON.stringify(checkpoint),
      hasMore: candidates.length > selected.length || helperHasMore
    }
  }
}

export const localMailService = new LocalMailService()
