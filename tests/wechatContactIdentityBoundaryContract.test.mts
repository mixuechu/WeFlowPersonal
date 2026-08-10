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
