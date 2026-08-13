import crypto from 'crypto'

type ScopeOptions = Record<string, unknown>

const text = (value: unknown): string => String(value || '').trim()
const folded = (value: unknown): string => text(value).toLocaleLowerCase('zh-CN')
const list = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value : [])
  .map(item => text(item)).filter(Boolean))].sort()
const token = (kind: string, values: unknown[]): string => crypto.createHash('sha256')
  .update(JSON.stringify([`structured-memory-${kind}-scope-v1`, ...values])).digest('hex')

export const buildClaimPageScopeToken = (options: ScopeOptions = {}): string => token('claim', [
  text(options.entityId), text(options.sourceId), text(options.status), text(options.reasonCode),
  folded(options.predicate), text(options.from), text(options.to)
])

export const buildEventPageScopeToken = (options: ScopeOptions = {}): string => token('event', [
  text(options.entityId), list(options.eventTypes), text(options.sourceId), text(options.status),
  text(options.reasonCode), folded(options.query), text(options.from), text(options.to)
])

export const buildRelationPageScopeToken = (options: ScopeOptions = {}): string => token('relation', [
  text(options.entityId), text(options.direction), text(options.status), text(options.sourceId),
  folded(options.query)
])

export const buildIdentityAnchorPageScopeToken = (options: ScopeOptions = {}): string =>
  token('identity-anchor', [
    text(options.entityId), text(options.kind), text(options.identityScope),
    folded(options.platform), folded(options.query)
  ])

export const buildEntityEvidencePageScopeToken = (options: ScopeOptions = {}): string =>
  token('entity-evidence', [
    text(options.entityId), text(options.sourceId), text(options.memoryKind),
    text(options.evidenceState), text(options.evidenceRole), folded(options.query),
    text(options.from), text(options.to)
  ])
