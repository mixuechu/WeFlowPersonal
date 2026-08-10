import { createHash, timingSafeEqual } from 'node:crypto'

export const RESOURCE_ENRICHMENT_BATCH_LIMIT = 25

export type ResourceEnrichmentBatchIdentity = {
  revision: string
  kind: string
  status: string
  filters: {
    resourceType: string
    sourceId: string
    query: string
    from: string
    to: string
  }
  items: Array<{ id: string; retryToken: string }>
}

const canonicalIdentity = (identity: ResourceEnrichmentBatchIdentity) => ({
  revision: String(identity.revision || ''),
  kind: String(identity.kind || ''),
  status: String(identity.status || ''),
  filters: {
    resourceType: String(identity.filters?.resourceType || ''),
    sourceId: String(identity.filters?.sourceId || ''),
    query: String(identity.filters?.query || '').trim(),
    from: String(identity.filters?.from || ''),
    to: String(identity.filters?.to || '')
  },
  items: (identity.items || []).slice(0, RESOURCE_ENRICHMENT_BATCH_LIMIT).map(item => ({
    id: String(item.id || ''),
    retryToken: String(item.retryToken || '')
  }))
})

export const buildResourceEnrichmentBatchToken = (
  identity: ResourceEnrichmentBatchIdentity
): string => createHash('sha256').update(JSON.stringify(canonicalIdentity(identity))).digest('hex')

export const assertResourceEnrichmentBatchToken = (
  identity: ResourceEnrichmentBatchIdentity,
  token: unknown
): void => {
  const expected = buildResourceEnrichmentBatchToken(identity)
  const actual = String(token || '')
  if (!/^[a-f0-9]{64}$/.test(actual) ||
      !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) {
    throw new Error('资源批量重试预览已过期，请刷新后重新确认')
  }
}
