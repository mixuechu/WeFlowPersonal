import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEMORY_MAINTENANCE_AUDIT_OUTBOX_LIMIT,
  normalizeMemoryMaintenanceAuditOutbox
} from '../electron/services/memoryMaintenanceAuditOutbox.ts'

const event = (index: number, patch: Record<string, unknown> = {}) => ({
  eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  operation: 'backup_create',
  trigger: 'manual',
  artifactCount: 2,
  bytes: 1_024,
  portable: null,
  completedAt: '2026-08-11T00:00:00.000Z',
  ...patch
})

test('maintenance audit outbox projects only fixed privacy-minimal fields', () => {
  const result = normalizeMemoryMaintenanceAuditOutbox([
    event(1, { path: '/Users/customer/secret.sqlite', passphrase: 'do-not-copy' })
  ])
  assert.equal(result.pending.length, 1)
  assert.deepEqual(Object.keys(result.pending[0]).sort(), [
    'artifactCount', 'bytes', 'completedAt', 'eventId', 'operation', 'portable', 'trigger'
  ])
  assert.equal(JSON.stringify(result.pending).includes('secret.sqlite'), false)
  assert.equal(JSON.stringify(result.pending).includes('do-not-copy'), false)
})

test('maintenance audit outbox rejects malformed rows, deduplicates, and stays bounded', () => {
  const rows = [
    event(1),
    event(1),
    event(2, { operation: 'unknown' }),
    event(3, { bytes: -1 }),
    ...Array.from({ length: MEMORY_MAINTENANCE_AUDIT_OUTBOX_LIMIT + 5 }, (_, index) =>
      event(index + 10))
  ]
  const result = normalizeMemoryMaintenanceAuditOutbox(rows)
  assert.equal(result.pending.length, MEMORY_MAINTENANCE_AUDIT_OUTBOX_LIMIT)
  assert.equal(result.duplicate, 1)
  assert.equal(result.invalid, 2)
  assert.equal(result.overflow, 6)
})
