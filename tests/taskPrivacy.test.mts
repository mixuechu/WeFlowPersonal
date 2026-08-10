import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeTaskForPersistence } from '../electron/services/taskPrivacy.ts'

test('task persistence projection removes credentials from every narrative field', () => {
  const task = sanitizeTaskForPersistence({
    title: '配置 VPN',
    detail: '密码是 secret-pass-8899，地址 vmess://opaque-private-payload',
    owner: '我',
    source: '项目群',
    project: '2026-08-10 发布',
    assignmentEvidence: 'token: abcdefghijklmnop',
    lifecycleEvidence: '已经发送 vmess://second-private-payload',
    collaborators: ['同事'],
    evidence: [{ sender: '同事', excerpt: '口令为 pass-7788' }]
  })
  const serialized = JSON.stringify(task)
  for (const secret of ['secret-pass-8899', 'opaque-private-payload', 'abcdefghijklmnop', 'second-private-payload', 'pass-7788']) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.match(serialized, /\[凭证#1\]|\[代理凭证#1\]/)
  assert.match(task.project, /2026-08-10/)
})

