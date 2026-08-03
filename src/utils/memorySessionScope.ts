export interface MemorySessionSelection {
  sessionId?: string
  displayName?: string
  displayNameCollisionCount?: number
  legacyNameFallbackSafe?: boolean
}

export function buildMemorySessionScope(selection: MemorySessionSelection | null | undefined): {
  sessionId?: string
  sessionName?: string
  precision: 'none' | 'id_only' | 'id_only_due_to_name_collision'
} {
  const sessionId = String(selection?.sessionId || '').trim()
  if (!sessionId) return { precision: 'none' }
  const collision = selection?.legacyNameFallbackSafe !== true ||
    Number(selection?.displayNameCollisionCount || 1) > 1
  return {
    sessionId,
    sessionName: undefined,
    precision: collision ? 'id_only_due_to_name_collision' : 'id_only'
  }
}
