import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectStableCursorPages,
  paginateByStableStringCursor
} from '../shared/stableCursorPagination.ts'

test('stable cursor pagination reaches every session beyond ten thousand', async () => {
  const sessions = Array.from({ length: 20_505 }, (_, index) => ({
    username: `session-${String(index).padStart(6, '0')}`,
    displayName: `会话 ${index}`
  }))
  sessions.push({ ...sessions[10_000], displayName: '重复身份的最新目录值' })
  const collected = await collectStableCursorPages(
    async cursor => {
      const page = paginateByStableStringCursor(sessions, {
        key: item => item.username,
        cursor,
        limit: 10_000
      })
      return page
    },
    item => item.username
  )
  assert.equal(collected.length, 20_505)
  assert.equal(new Set(collected.map(item => item.username)).size, 20_505)
  assert.equal(collected[10_000].displayName, '重复身份的最新目录值')
  assert.equal(collected.at(-1)?.username, 'session-020504')
})

test('the same cursor contract preserves contact identity fields beyond ten thousand', async () => {
  const contacts = Array.from({ length: 10_025 }, (_, index) => ({
    username: `wxid_${String(index).padStart(6, '0')}`,
    remark: `备注 ${index}`,
    nickname: `昵称 ${index}`,
    alias: `alias_${index}`
  }))
  const collected = await collectStableCursorPages(
    async cursor => paginateByStableStringCursor(contacts, {
      key: contact => contact.username,
      cursor,
      limit: 10_000
    }),
    contact => contact.username
  )
  const tail = collected.find(contact => contact.username === 'wxid_010024')
  assert.equal(collected.length, 10_025)
  assert.deepEqual(tail, {
    username: 'wxid_010024',
    remark: '备注 10024',
    nickname: '昵称 10024',
    alias: 'alias_10024'
  })
})

test('cursor collection rejects empty, repeated and backwards continuations', async () => {
  for (const nextCursor of ['', 'same', 'before']) {
    await assert.rejects(
      collectStableCursorPages(
        async cursor => ({
          items: [{ id: cursor || 'same' }],
          total: 2,
          hasMore: true,
          nextCursor
        }),
        item => item.id
      ),
      /稳定游标分页未向前推进/
    )
  }
})
