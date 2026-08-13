export const EXTRACTION_MEMORY_CONTEXT_VERSION = 'trusted-extraction-context-v3'
export const EXTRACTION_CONTEXT_AUDIT_VERSION = 'extraction-context-audit-v1'

type ContextEntity = {
  id: string
  type: string
  canonicalName: string
  aliases?: string[]
  accountIds?: string[]
  externalIdentities?: Array<{ accountId?: string; account_id?: string }>
  summary?: string
  summaryStatus?: string
  trustStatus?: string
  updatedAt?: string
}

type ContextRelation = {
  id: string
  subjectId: string
  objectId: string
  predicate: string
  status: string
  confidence?: number
  updatedAt?: string
}

function normalized(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}

function compact(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function searchableTerm(value: unknown): string {
  const term = normalized(value)
  if (/^[\p{Script=Han}]+$/u.test(term)) return term.length >= 2 ? term : ''
  return term.length >= 3 ? term : ''
}

function identityAnchors(message: any): string[] {
  const identity = message?.senderIdentity || {}
  return [
    identity.wxid,
    identity.accountId,
    identity.account_id
  ].map(normalized).filter(Boolean)
}

function entityAnchors(entity: ContextEntity): string[] {
  return [
    ...(entity.accountIds || []),
    ...(entity.externalIdentities || []).flatMap(identity =>
      [identity.accountId, identity.account_id])
  ].map(normalized).filter(Boolean)
}

export function selectTrustedExtractionEntities(input: {
  messages: any[]
  entities: ContextEntity[]
  relations: ContextRelation[]
  ownerNames?: string[]
  ownerEntityIds?: string[]
  limit?: number
}): {
  entities: ContextEntity[]
  relations: ContextRelation[]
  directEntityIds: string[]
  expandedEntityIds: string[]
  reasons: Record<string, string[]>
} {
  const limit = Math.max(1, Math.min(40, Number(input.limit || 24)))
  const trusted = input.entities.filter(entity => entity.trustStatus === 'confirmed')
  const byId = new Map(trusted.map(entity => [entity.id, entity]))
  const anchors = new Set(input.messages.flatMap(identityAnchors))
  const ownerNames = new Set((input.ownerNames || []).map(normalized).filter(Boolean))
  const ownerEntityIds = new Set((input.ownerEntityIds || []).map(value => String(value || '').trim()).filter(Boolean))
  const haystack = normalized(input.messages.flatMap(message => [
    message.content,
    message.sessionName,
    message.senderName,
    message.quotedSender
  ]).join('\n'))
  const reasons = new Map<string, Set<string>>()
  const scores = new Map<string, number>()
  const add = (entity: ContextEntity, reason: string, score: number) => {
    const known = reasons.get(entity.id) || new Set<string>()
    known.add(reason)
    reasons.set(entity.id, known)
    scores.set(entity.id, Math.max(scores.get(entity.id) || 0, score))
  }
  for (const entity of trusted) {
    if (ownerEntityIds.has(entity.id)) {
      add(entity, '用户本人绑定身份', 110)
    }
    if (entityAnchors(entity).some(anchor => anchors.has(anchor))) {
      add(entity, '当前发送者身份锚点', 100)
    }
    const canonicalName = searchableTerm(entity.canonicalName)
    if (canonicalName && haystack.includes(canonicalName)) {
      add(entity, '正文或会话出现规范名', 80)
    }
    if ((entity.aliases || []).some(alias => {
      const term = searchableTerm(alias)
      return term && haystack.includes(term)
    })) {
      add(entity, '正文或会话出现可信别名', 75)
    }
    if ([entity.canonicalName, ...(entity.aliases || [])]
      .some(name => ownerNames.has(normalized(name)))) {
      add(entity, '用户本人可信身份', 90)
    }
  }
  const direct = [...scores.keys()].sort((left, right) => {
    const score = (scores.get(right) || 0) - (scores.get(left) || 0)
    if (score) return score
    const updated = String(byId.get(right)?.updatedAt || '')
      .localeCompare(String(byId.get(left)?.updatedAt || ''))
    return updated || left.localeCompare(right)
  }).slice(0, limit)
  const selected = new Set(direct)
  const directSet = new Set(direct)
  const expanded: string[] = []
  const confirmedRelations = input.relations.filter(relation =>
    relation.status === 'confirmed' &&
    byId.has(relation.subjectId) &&
    byId.has(relation.objectId))
  for (const relation of confirmedRelations
    .slice()
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))) {
    if (selected.size >= limit) break
    const neighbor = directSet.has(relation.subjectId) && !selected.has(relation.objectId)
      ? relation.objectId
      : directSet.has(relation.objectId) && !selected.has(relation.subjectId)
        ? relation.subjectId
        : ''
    if (!neighbor) continue
    selected.add(neighbor)
    expanded.push(neighbor)
    const known = reasons.get(neighbor) || new Set<string>()
    known.add('可信关系一跳邻居')
    reasons.set(neighbor, known)
  }
  const selectedEntities = [...selected].flatMap(id => byId.get(id) ? [byId.get(id)!] : [])
  const selectedRelations = confirmedRelations.filter(relation =>
    selected.has(relation.subjectId) && selected.has(relation.objectId))
    .slice(0, 40)
  return {
    entities: selectedEntities,
    relations: selectedRelations,
    directEntityIds: direct,
    expandedEntityIds: expanded,
    reasons: Object.fromEntries([...reasons.entries()]
      .filter(([id]) => selected.has(id))
      .map(([id, values]) => [id, [...values]]))
  }
}

export function buildExtractionContextAudit(input: {
  inputFingerprint: string
  messages: any[]
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  totals: Record<string, number>
}): {
  version: string
  contextVersion: string
  inputFingerprint: string
  messageScope: { core: number; context: number }
  entities: any[]
  relations: any[]
  claims: any[]
  events: any[]
  totals: Record<string, number>
} {
  const fingerprint = /^[a-f0-9]{64}$/i.test(String(input.inputFingerprint || ''))
    ? String(input.inputFingerprint).toLowerCase()
    : ''
  return {
    version: EXTRACTION_CONTEXT_AUDIT_VERSION,
    contextVersion: EXTRACTION_MEMORY_CONTEXT_VERSION,
    inputFingerprint: fingerprint,
    messageScope: {
      core: (input.messages || []).filter(message => (message.analysisScope || 'core') === 'core').length,
      context: (input.messages || []).filter(message => message.analysisScope === 'context').length
    },
    entities: (input.entities || []).slice(0, 24).map(entity => ({
      id: compact(entity.id, 160),
      type: compact(entity.type, 40),
      name: compact(entity.canonicalName || entity.name, 160),
      reasons: (entity.selectionReasons || []).slice(0, 4)
        .map((reason: unknown) => compact(reason, 80)).filter(Boolean)
    })),
    relations: (input.relations || []).slice(0, 40).map(relation => ({
      id: compact(relation.id, 160),
      subject: compact(relation.subjectName || relation.subjectId, 160),
      predicate: compact(relation.predicate, 80),
      object: compact(relation.objectName || relation.objectId, 160)
    })),
    claims: (input.claims || []).slice(0, 36).map(claim => ({
      id: compact(claim.id, 160),
      subject: compact(claim.subject_name || claim.subjectName || claim.subject_id, 160),
      predicate: compact(claim.predicate, 80),
      value: compact(
        claim.object_entity_name || claim.objectEntityName || claim.object_value || claim.objectValue,
        240
      ),
      polarity: claim.polarity === 'negative' ? 'negative' : 'positive'
    })),
    events: (input.events || []).slice(0, 16).map(event => ({
      id: compact(event.id, 160),
      type: compact(event.event_type || event.eventType, 80),
      title: compact(event.title, 240),
      startAt: compact(event.start_at || event.startAt, 100)
    })),
    totals: Object.fromEntries(Object.entries(input.totals || {})
      .slice(0, 16)
      .map(([key, value]) => [compact(key, 80), Math.max(0, Number(value) || 0)]))
  }
}
