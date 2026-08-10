import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const service = readFileSync(
  join(process.cwd(), 'electron/services/aiAssistantService.ts'),
  'utf8'
)

test('wechat extraction fails closed when the contact identity directory cannot be read', () => {
  const collectStart = service.indexOf('private async collectMessages(')
  const collectEnd = service.indexOf('\n  private ', collectStart + 1)
  assert.ok(collectStart >= 0)
  assert.ok(collectEnd > collectStart)

  const collectMessages = service.slice(collectStart, collectEnd)
  assert.match(
    collectMessages,
    /const contacts = await this\.listAllWechatContacts\(\)/
  )
  assert.doesNotMatch(
    collectMessages,
    /listAllWechatContacts\(\)\.catch\([^\n]*(?:\[\]|null)/
  )

  const contactLoad = collectMessages.indexOf(
    'const contacts = await this.listAllWechatContacts()'
  )
  const policyMutation = collectMessages.indexOf(
    'this.state.cursor.sessionCursors[session.username] = end'
  )
  assert.ok(contactLoad >= 0)
  assert.ok(policyMutation > contactLoad)
})

test('a failed group member directory pauses only that session instead of degrading sender identity', () => {
  const collectStart = service.indexOf('private async collectMessages(')
  const collectEnd = service.indexOf('\n  private ', collectStart + 1)
  const collectMessages = service.slice(collectStart, collectEnd)

  assert.match(
    collectMessages,
    /\? await this\.api\('\/api\/v1\/group-members', \{ chatroomId: session\.username \}\)/
  )
  assert.doesNotMatch(
    collectMessages,
    /group-members[^\n]*\.catch\([^\n]*members: \[\]/
  )
  assert.match(
    collectMessages,
    /const results = await settleWithConcurrency\(sessions, 8, async \(session: any\) => \{/
  )
  assert.match(
    collectMessages,
    /if \(result\.status === 'fulfilled'\)[\s\S]*?else \{\s*failed\.push\(sessions\[index\]\?\.username\)/
  )
})
