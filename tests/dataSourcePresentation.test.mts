import test from 'node:test'
import assert from 'node:assert/strict'
import {
  presentDataSourceForRenderer,
  presentDataSourcesForRenderer
} from '../electron/services/dataSourcePresentation.ts'

test('data source presentation keeps raw connector checkpoints out of renderer payloads', () => {
  const checkpoint = JSON.stringify({
    localPath: '/Users/private/Documents/customer-plan.docx',
    mailLocalId: 'mail-secret-local-id',
    calendarNotes: 'private calendar notes',
    events: Array.from({ length: 2_000 }, (_, index) => ({
      id: `event-${index}`,
      notes: `private-${index}`
    }))
  })
  const presented = presentDataSourceForRenderer({
    id: 'calendar',
    displayName: 'macOS 日历',
    checkpoint,
    config: { calendarIds: ['selected-calendar'] },
    mutationToken: 'opaque-mutation-token',
    lastError: '读取 /Users/private/Documents/customer-plan.docx 时邮箱 owner@example.com 和 sk-supersecret123456789 失败'
  })
  assert.equal('checkpoint' in presented, false)
  assert.equal(presented.checkpointStatus.stored, true)
  assert.equal(presented.checkpointStatus.bytes, new TextEncoder().encode(checkpoint).byteLength)
  assert.equal(presented.checkpointStatus.policy, 'sqlcipher-internal-only')
  assert.equal(presented.mutationToken, 'opaque-mutation-token')
  assert.deepEqual(presented.config, { calendarIds: ['selected-calendar'] })
  assert.equal(presented.lastError.includes('/Users/private'), false)
  assert.equal(presented.lastError.includes('owner@example.com'), false)
  assert.equal(presented.lastError.includes('sk-supersecret'), false)
  const serialized = JSON.stringify(presented)
  assert.equal(serialized.includes('mail-secret-local-id'), false)
  assert.equal(serialized.includes('private calendar notes'), false)
  assert.equal(serialized.includes('owner@example.com'), false)
  assert.ok(serialized.length < 500)

  assert.deepEqual(presentDataSourcesForRenderer(null), [])
  assert.equal(presentDataSourcesForRenderer([{ id: 'empty', checkpoint: '' }])[0]
    .checkpointStatus.stored, false)
})
