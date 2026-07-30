import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runPersonalDataSourceBatch,
  type PersonalDataSourceConnector
} from '../electron/services/personalDataSources.ts'

function fakeConnector(): PersonalDataSourceConnector {
  return {
    id: 'test-source',
    kind: 'document',
    displayName: '测试数据源',
    description: 'test',
    available: true,
    localOnly: true,
    capabilities: ['incremental', 'original-evidence'],
    async pull({ checkpoint }) {
      return {
        items: [
          {
            sourceId: 'test-source',
            externalId: 'doc-1',
            kind: 'document',
            occurredAt: '2026-07-30T00:00:00.000Z',
            title: '第一份文档',
            content: '正文'
          },
          {
            sourceId: 'test-source',
            externalId: 'doc-1',
            kind: 'document',
            occurredAt: '2026-07-30T00:00:00.000Z',
            title: '重复文档',
            content: '以最后一次为准'
          }
        ],
        nextCheckpoint: `${checkpoint}-next`,
        hasMore: false
      }
    }
  }
}

test('data source checkpoint advances only after deduplicated items are consumed', async () => {
  const consumed: any[] = []
  const result = await runPersonalDataSourceBatch(fakeConnector(), 'cursor-1', async items => {
    consumed.push(...items)
  })
  assert.equal(consumed.length, 1)
  assert.equal(consumed[0].title, '重复文档')
  assert.deepEqual(result, { checkpoint: 'cursor-1-next', pulled: 1, hasMore: false, warnings: [] })

  let committedCheckpoint = 'cursor-1'
  await assert.rejects(
    runPersonalDataSourceBatch(fakeConnector(), committedCheckpoint, async () => {
      throw new Error('consumer transaction failed')
    }),
    /consumer transaction failed/
  )
  assert.equal(committedCheckpoint, 'cursor-1')
})

test('data source contract rejects invalid attribution before consumption', async () => {
  const connector = fakeConnector()
  connector.pull = async () => ({
    items: [{
      sourceId: 'another-source',
      externalId: 'bad-1',
      kind: 'document',
      occurredAt: '2026-07-30T00:00:00.000Z',
      title: '错误归属',
      content: '正文'
    }],
    nextCheckpoint: 'bad',
    hasMore: false
  })
  await assert.rejects(
    runPersonalDataSourceBatch(connector, '', async () => undefined),
    /错误的 sourceId/
  )
})
