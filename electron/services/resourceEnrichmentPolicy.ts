export const RESOURCE_ENRICHMENT_KINDS = [
  'attachment_index',
  'image_ocr',
  'voice_transcript',
  'image_semantics',
  'web_snapshot',
  'pdf_ocr',
  'attachment_structure'
] as const

export type ResourceEnrichmentKind = typeof RESOURCE_ENRICHMENT_KINDS[number]

export function selectDueResourceEnrichmentKind(
  due: Partial<Record<ResourceEnrichmentKind, boolean>>,
  nowMs: number
): ResourceEnrichmentKind | null {
  const start = Math.abs(Math.floor(Number(nowMs || 0) / 60_000)) % RESOURCE_ENRICHMENT_KINDS.length
  for (let offset = 0; offset < RESOURCE_ENRICHMENT_KINDS.length; offset += 1) {
    const kind = RESOURCE_ENRICHMENT_KINDS[(start + offset) % RESOURCE_ENRICHMENT_KINDS.length]
    if (due[kind]) return kind
  }
  return null
}
