import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMemoryEvidenceArchiveScopeToken,
  normalizeMemoryEvidenceArchiveScope
} from '../electron/services/memoryEvidenceArchiveScope.ts'

test('evidence archive scope normalization matches bounded authority filters', () => {
  assert.deepEqual(normalizeMemoryEvidenceArchiveScope({
    query: `  ${'甲'.repeat(510)}  `,
    source: ' WeChat ',
    session: ' 群聊 ',
    sender: ' 张三 ',
    role: 'DIRECT',
    fromTimestamp: 12.9,
    toTimestamp: -5
  }), {
    query: '甲'.repeat(500),
    source: 'wechat',
    session: '群聊',
    sender: '张三',
    role: 'direct',
    fromTimestamp: 12,
    toTimestamp: 0
  })
  assert.equal(normalizeMemoryEvidenceArchiveScope({ role: 'invented' }).role, '')
})

test('evidence archive tokens bind archive identity and every effective filter', () => {
  const base = buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', {
    query: '交付', source: 'wechat', session: '群聊', sender: '张三',
    role: 'direct', fromTimestamp: 10, toTimestamp: 20
  }).token
  const variants = [
    buildMemoryEvidenceArchiveScopeToken('memory', 'event', 'claim-1', { query: '交付', source: 'wechat', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-2', { query: '交付', source: 'wechat', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('graph_review', 'claim', 'claim-1', { query: '交付', source: 'wechat', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '延期', source: 'wechat', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '交付', source: 'documents', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '交付', source: 'wechat', session: '私聊', sender: '张三', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '交付', source: 'wechat', session: '群聊', sender: '李四', role: 'direct', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '交付', source: 'wechat', session: '群聊', sender: '张三', role: 'contradiction', fromTimestamp: 10, toTimestamp: 20 }).token,
    buildMemoryEvidenceArchiveScopeToken('memory', 'claim', 'claim-1', { query: '交付', source: 'wechat', session: '群聊', sender: '张三', role: 'direct', fromTimestamp: 11, toTimestamp: 20 }).token
  ]
  assert.equal(new Set([base, ...variants]).size, variants.length + 1)
})
