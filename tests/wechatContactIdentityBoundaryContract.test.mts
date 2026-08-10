import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const service = readFileSync(
  join(process.cwd(), 'electron/services/aiAssistantService.ts'),
  'utf8'
)
const assistantPage = readFileSync(
  join(process.cwd(), 'src/pages/AiAssistantPage.tsx'),
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

test('raw voice and image resources survive first-pass enrichment failure for durable retry', () => {
  const persistStart = service.indexOf('private persistMessageResources(')
  const persistEnd = service.indexOf('\n  private ', persistStart + 1)
  const persistResources = service.slice(persistStart, persistEnd)
  assert.doesNotMatch(persistResources, /semanticType === 'image'[^\n]*return \[\]/)
  assert.doesNotMatch(persistResources, /semanticType === 'voice'[^\n]*return \[\]/)
  assert.match(persistResources, /voiceTranscriptionStatus:/)
  assert.match(persistResources, /localId: message\.localId/)

  const syncOrder = [
    service.indexOf('this.persistMessageResources(fresh, createdAt, runId)'),
    service.indexOf('await this.continuePendingAttachmentIndexes(runId)'),
    service.indexOf('await this.continuePendingImageOcr(runId)'),
    service.indexOf('await this.continuePendingVoiceTranscripts(runId)'),
    service.indexOf('await this.continuePendingImageSemantics(runId)'),
    service.indexOf('await this.continuePendingWebSnapshots(runId)')
  ]
  assert.ok(syncOrder.every(index => index >= 0))
  assert.deepEqual([...syncOrder].sort((a, b) => a - b), syncOrder)
})

test('media migration progress distinguishes paused features from active retries', () => {
  assert.match(service, /imageOcrMigration: \{[\s\S]*?enabled: Boolean\(this\.config\.get\('aiAssistantOcrImages'\)\)/)
  assert.match(service, /voiceTranscriptionMigration: \{[\s\S]*?enabled: Boolean\(this\.config\.get\('autoTranscribeVoice'\)\)/)
  assert.match(assistantPage, /图片 OCR 当前未启用/)
  assert.match(assistantPage, /自动语音转写当前未启用/)
  assert.match(assistantPage, /图片视觉理解当前未启用/)
  assert.match(assistantPage, /扫描 PDF 等待启用图片 OCR/)
  assert.match(assistantPage, /网页正文索引当前未启用/)
})
