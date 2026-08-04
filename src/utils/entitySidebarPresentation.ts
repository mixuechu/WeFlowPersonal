export type EntitySidebarSection = {
  total: number
  preview: number
  truncated: boolean
}

function section(total: unknown, loaded: unknown[], visibleLimit: number): EntitySidebarSection {
  const loadedCount = Array.isArray(loaded) ? loaded.length : 0
  const safeTotal = Math.max(loadedCount, Math.floor(Number(total) || 0))
  const preview = Math.min(visibleLimit, loadedCount)
  return { total: safeTotal, preview, truncated: safeTotal > preview }
}

export function buildEntitySidebarPresentation(input: {
  claimTotal?: unknown
  claims?: unknown[]
  relationTotal?: unknown
  relations?: unknown[]
  eventTotal?: unknown
  events?: unknown[]
  relationHistoryTotal?: unknown
  relationHistory?: unknown[]
}): {
  claims: EntitySidebarSection
  relations: EntitySidebarSection
  events: EntitySidebarSection
  relationHistory: EntitySidebarSection
} {
  return {
    claims: section(input.claimTotal, input.claims || [], 6),
    relations: section(input.relationTotal, input.relations || [], 6),
    events: section(input.eventTotal, input.events || [], 5),
    relationHistory: section(input.relationHistoryTotal, input.relationHistory || [], 8)
  }
}
