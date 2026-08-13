export type MemoryMaintenanceAuditOperation =
  | 'backup_create'
  | 'backup_restore'
  | 'backup_delete'
  | 'bundle_export'
  | 'bundle_import'
  | 'import_staging_discard'
  | 'backup_trash_restore'
  | 'backup_trash_discard'

export type MemoryMaintenanceAuditEvent = {
  eventId: string
  operation: MemoryMaintenanceAuditOperation
  trigger: 'manual' | 'automatic' | 'recovery'
  artifactCount: number
  bytes: number
  portable: boolean | null
  completedAt: string
}

export const MEMORY_MAINTENANCE_AUDIT_OUTBOX_LIMIT = 256

const OPERATIONS = new Set<MemoryMaintenanceAuditOperation>([
  'backup_create', 'backup_restore', 'backup_delete', 'bundle_export',
  'bundle_import', 'import_staging_discard', 'backup_trash_restore',
  'backup_trash_discard'
])

export function normalizeMemoryMaintenanceAuditOutbox(input: unknown): {
  pending: MemoryMaintenanceAuditEvent[]
  invalid: number
  duplicate: number
  overflow: number
} {
  const rows = Array.isArray(input) ? input : []
  const pending: MemoryMaintenanceAuditEvent[] = []
  const seen = new Set<string>()
  let invalid = 0
  let duplicate = 0
  let overflow = 0
  for (const raw of rows) {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    const eventId = String(item?.eventId || '')
    const operation = String(item?.operation || '') as MemoryMaintenanceAuditOperation
    const trigger = String(item?.trigger || '')
    const artifactCount = Number(item?.artifactCount)
    const bytes = Number(item?.bytes)
    const completedAt = String(item?.completedAt || '')
    const portable = item?.portable
    if (!item || !/^[a-f0-9-]{16,64}$/i.test(eventId) || !OPERATIONS.has(operation) ||
        !['manual', 'automatic', 'recovery'].includes(trigger) ||
        !Number.isSafeInteger(artifactCount) || artifactCount < 0 || artifactCount > 1_000_000 ||
        !Number.isSafeInteger(bytes) || bytes < 0 ||
        !Number.isFinite(Date.parse(completedAt)) ||
        !(portable === null || portable === undefined || typeof portable === 'boolean')) {
      invalid += 1
      continue
    }
    if (seen.has(eventId)) {
      duplicate += 1
      continue
    }
    seen.add(eventId)
    if (pending.length >= MEMORY_MAINTENANCE_AUDIT_OUTBOX_LIMIT) {
      overflow += 1
      continue
    }
    pending.push({
      eventId,
      operation,
      trigger: trigger as MemoryMaintenanceAuditEvent['trigger'],
      artifactCount,
      bytes,
      portable: typeof portable === 'boolean' ? portable : null,
      completedAt: new Date(completedAt).toISOString()
    })
  }
  return { pending, invalid, duplicate, overflow }
}
