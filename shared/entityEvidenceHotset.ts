export const ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT = 500

export function compactEntityEvidenceMessageIds(
  values: unknown[],
  limit = ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT
): string[] {
  const boundedLimit = Math.max(1, Math.min(ENTITY_EVIDENCE_MESSAGE_HOT_LIMIT, Math.floor(limit || 0)))
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]
    .slice(-boundedLimit)
}
