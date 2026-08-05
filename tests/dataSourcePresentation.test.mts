import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConnectorPickerSnapshot,
  markSelectedConnectorItems,
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
    config: {
      calendarIds: ['selected-calendar-secret-id'],
      folderPath: '/Users/private/Documents',
      allowModelAnalysis: true
    },
    mutationToken: 'opaque-mutation-token',
    lastError: '读取 /Users/private/Documents/customer-plan.docx 时邮箱 owner@example.com 和 sk-supersecret123456789 失败'
  })
  assert.equal('checkpoint' in presented, false)
  assert.equal(presented.checkpointStatus.stored, true)
  assert.equal(presented.checkpointStatus.bytes, new TextEncoder().encode(checkpoint).byteLength)
  assert.equal(presented.checkpointStatus.policy, 'sqlcipher-internal-only')
  assert.equal(presented.mutationToken, 'opaque-mutation-token')
  assert.deepEqual(presented.config, {})
  assert.equal(presented.lastError.includes('/Users/private'), false)
  assert.equal(presented.lastError.includes('owner@example.com'), false)
  assert.equal(presented.lastError.includes('sk-supersecret'), false)
  const serialized = JSON.stringify(presented)
  assert.equal(serialized.includes('mail-secret-local-id'), false)
  assert.equal(serialized.includes('private calendar notes'), false)
  assert.equal(serialized.includes('owner@example.com'), false)
  assert.equal(serialized.includes('selected-calendar-secret-id'), false)
  assert.equal(serialized.includes('/Users/private/Documents'), false)
  assert.ok(serialized.length < 500)

  assert.deepEqual(presentDataSourcesForRenderer(null), [])
  assert.equal(presentDataSourcesForRenderer([{ id: 'empty', checkpoint: '' }])[0]
    .checkpointStatus.stored, false)
  assert.deepEqual(presentDataSourceForRenderer({
    id: 'documents',
    config: { folderPath: '/Users/private/Documents' }
  }).config, { folderConfigured: true })
  assert.deepEqual(presentDataSourceForRenderer({
    id: 'mail',
    config: {
      mailboxIds: ['private-mailbox-id'],
      allowModelAnalysis: true
    }
  }).config, { allowModelAnalysis: true })
})

test('connector picker snapshot binds selected identities and save token together', () => {
  const snapshot = buildConnectorPickerSnapshot([
    { id: 'mailbox-a', displayName: '收件箱' },
    { id: 'mailbox-b', displayName: '收件箱' }
  ], {
    config: { mailboxIds: ['mailbox-b'] },
    mutationToken: 'current-source-token'
  }, 'mailboxIds')
  assert.equal(snapshot.mutationToken, 'current-source-token')
  assert.deepEqual(snapshot.items.map(item => [item.id, item.selected]), [
    ['mailbox-a', false],
    ['mailbox-b', true]
  ])
  assert.deepEqual(buildConnectorPickerSnapshot([], null, 'calendarIds'), {
    items: [],
    mutationToken: ''
  })
})

test('connector picker selection binds stable ids instead of duplicate display names', () => {
  const items = markSelectedConnectorItems([
    { id: 'calendar-personal', title: '工作' },
    { id: 'calendar-shared', title: '工作' },
    { id: 42, title: '数字身份' }
  ], ['calendar-shared', '42'])
  assert.deepEqual(items.map(item => ({
    id: item.id,
    selected: item.selected
  })), [
    { id: 'calendar-personal', selected: false },
    { id: 'calendar-shared', selected: true },
    { id: 42, selected: true }
  ])
  assert.deepEqual(markSelectedConnectorItems(null, null), [])
})
