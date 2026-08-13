export type DetachedEventEditorTarget = {
  id?: string | null
  origin?: string | null
}

export const shouldRenderDetachedEventEditor = <T extends DetachedEventEditorTarget>(
  editingEvent: T | null | undefined,
  visibleEventIds: ReadonlySet<string>
): editingEvent is T & { id: string } => {
  const id = String(editingEvent?.id || '').trim()
  return Boolean(id) && editingEvent?.origin !== 'citation' && !visibleEventIds.has(id)
}
