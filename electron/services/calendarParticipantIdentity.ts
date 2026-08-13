import { createHash } from 'node:crypto'
import type { PersonalDataSourceItem } from './personalDataSources.ts'
import { compactEntityEvidenceMessageIds } from '../../shared/entityEvidenceHotset.ts'

export type ExternalIdentity = {
  platform: string
  accountId: string
  displayName: string
  confidence: number
}

export type CalendarIdentityEntity = {
  id: string
  type: string
  canonicalName: string
  aliases: string[]
  accountIds: string[]
  externalIdentities?: ExternalIdentity[]
  summary: string
  confidence: number
  evidenceMessageIds: string[]
  createdAt: string
  updatedAt: string
  identityVersion: number
  lastDisambiguatedAt: string | null
}

export type CalendarParticipantMapping = {
  entities: CalendarIdentityEntity[]
  participantsByEventId: Map<string, Array<{ entityId: string; role: string }>>
  duplicateSuggestions: Array<{ leftEntityId: string; rightEntityId: string; name: string }>
  changed: boolean
}

export function normalizeEmailIdentity(value: string): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/^mailto:/, '')
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

function stableEntityId(email: string): string {
  return `ent_email_${createHash('sha256').update(email).digest('hex').slice(0, 24)}`
}

export function mapCalendarParticipantIdentities(
  items: PersonalDataSourceItem[],
  currentEntities: CalendarIdentityEntity[],
  now: string
): CalendarParticipantMapping {
  const entities = currentEntities.map(entity => ({
    ...entity,
    aliases: [...(entity.aliases || [])],
    accountIds: [...(entity.accountIds || [])],
    externalIdentities: [...(entity.externalIdentities || [])],
    evidenceMessageIds: [...(entity.evidenceMessageIds || [])]
  }))
  const byEmail = new Map<string, CalendarIdentityEntity>()
  for (const entity of entities) {
    for (const identity of entity.externalIdentities || []) {
      if (identity.platform !== 'email') continue
      const email = normalizeEmailIdentity(identity.accountId)
      if (email) byEmail.set(email, entity)
    }
  }
  const participantsByEventId = new Map<string, Array<{ entityId: string; role: string }>>()
  const duplicateSuggestions: CalendarParticipantMapping['duplicateSuggestions'] = []
  const duplicateKeys = new Set<string>()
  let changed = false

  for (const item of items) {
    const mapped: Array<{ entityId: string; role: string }> = []
    for (const participant of item.participants || []) {
      const email = normalizeEmailIdentity(participant.id)
      if (!email) continue
      const displayName = String(participant.name || '').trim().slice(0, 100)
      const evidenceId = `${item.externalId}:${String(item.metadata?.contentHash || '').slice(0, 16)}`
      let entity = byEmail.get(email)
      if (!entity) {
        const canonicalName = displayName || email.split('@')[0]
        entity = {
          id: stableEntityId(email),
          type: 'person',
          canonicalName,
          aliases: [],
          accountIds: [],
          externalIdentities: [{
            platform: 'email',
            accountId: email,
            displayName: displayName || canonicalName,
            confidence: 1
          }],
          summary: '在用户明确选择的 macOS 日历事件中出现的参与者；邮箱是来源提供的稳定身份锚点。',
          summaryStatus: 'confirmed',
          trustStatus: 'confirmed',
          confidence: 0.95,
          evidenceMessageIds: [evidenceId],
          createdAt: now,
          updatedAt: now,
          identityVersion: 1,
          lastDisambiguatedAt: null
        }
        entities.push(entity)
        byEmail.set(email, entity)
        changed = true
        if (displayName) {
          for (const candidate of currentEntities) {
            if (candidate.id === entity.id || candidate.type !== 'person' || candidate.canonicalName !== displayName) continue
            const key = [entity.id, candidate.id].sort().join('|')
            if (duplicateKeys.has(key)) continue
            duplicateKeys.add(key)
            duplicateSuggestions.push({
              leftEntityId: entity.id,
              rightEntityId: candidate.id,
              name: displayName
            })
          }
        }
      } else {
        const identityBefore = JSON.stringify([entity.aliases, entity.externalIdentities])
        const evidenceBefore = JSON.stringify(entity.evidenceMessageIds)
        if (displayName && displayName !== entity.canonicalName) {
          entity.aliases = [...new Set([...entity.aliases, displayName])]
        }
        const identity = entity.externalIdentities!.find(value =>
          value.platform === 'email' && normalizeEmailIdentity(value.accountId) === email)
        if (identity && displayName && identity.displayName !== displayName) identity.displayName = displayName
        entity.evidenceMessageIds = compactEntityEvidenceMessageIds([
          ...entity.evidenceMessageIds,
          evidenceId
        ])
        const identityChanged = identityBefore !== JSON.stringify([entity.aliases, entity.externalIdentities])
        const evidenceChanged = evidenceBefore !== JSON.stringify(entity.evidenceMessageIds)
        if (identityChanged || evidenceChanged) {
          entity.updatedAt = now
          if (identityChanged) entity.identityVersion += 1
          changed = true
        }
      }
      if (!mapped.some(value => value.entityId === entity.id && value.role === participant.role)) {
        mapped.push({
          entityId: entity.id,
          role: String(participant.role || 'participant').slice(0, 80)
        })
      }
    }
    participantsByEventId.set(item.externalId, mapped)
  }
  return { entities, participantsByEventId, duplicateSuggestions, changed }
}
