import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { isEncryptedDurableJson } from '../electron/services/encryptedDurableJsonState.ts'

test('legacy group summary index and separated model log migrate together', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-group-summary-encryption-'))
  const previous = {
    userData: process.env.WEFLOW_USER_DATA_PATH,
    config: process.env.WEFLOW_CONFIG_CWD,
    worker: process.env.WEFLOW_WORKER
  }
  process.env.WEFLOW_USER_DATA_PATH = directory
  process.env.WEFLOW_CONFIG_CWD = directory
  process.env.WEFLOW_WORKER = '1'
  const indexPath = join(directory, 'weflow-group-summary-records.json')
  const logPath = join(directory, 'weflow-group-summary-logs', 'summary-private-1.json')
  try {
    writeFileSync(indexPath, JSON.stringify({ version: 2, records: [{
      id: 'summary-private-1',
      accountScope: 'default',
      createdAt: 1,
      sessionId: 'private-group@chatroom',
      displayName: '机密项目群',
      triggerType: 'manual',
      periodStart: 1,
      periodEnd: 2,
      messageCount: 3,
      readableMessageCount: 3,
      topics: [{
        title: '机密议题',
        participants: ['隐私成员'],
        keyPoints: ['不得明文保存'],
        conclusion: '迁移到密文'
      }],
      summaryText: '需要加密的群聊总结',
      rawOutput: '旧模型原始输出',
      log: {
        model: 'fixture-model',
        systemPrompt: '旧系统提示',
        userPrompt: '旧群聊原文',
        rawOutput: '旧模型原始输出',
        finalSummary: '需要加密的群聊总结'
      }
    }] }))

    const { groupSummaryRecordService } = await import(
      '../electron/services/groupSummaryRecordService.ts'
    )
    groupSummaryRecordService.migratePrivacy()
    assert.equal(isEncryptedDurableJson(readFileSync(indexPath)), true)
    assert.equal(isEncryptedDurableJson(readFileSync(logPath)), true)
    for (const forbidden of [
      'private-group@chatroom', '机密项目群', '需要加密的群聊总结', '旧群聊原文'
    ]) {
      assert.equal(readFileSync(indexPath).toString('utf8').includes(forbidden), false)
      assert.equal(readFileSync(logPath).toString('utf8').includes(forbidden), false)
    }
    const privacy = groupSummaryRecordService.getPrivacyStatus() as any
    assert.equal(privacy.encrypted, true)
    assert.equal(privacy.migratedPlaintext, true)
    assert.equal(privacy.entries, 1)
    assert.equal(privacy.logFiles, 1)
    assert.equal(privacy.logsEncrypted, true)
  } finally {
    if (previous.userData === undefined) delete process.env.WEFLOW_USER_DATA_PATH
    else process.env.WEFLOW_USER_DATA_PATH = previous.userData
    if (previous.config === undefined) delete process.env.WEFLOW_CONFIG_CWD
    else process.env.WEFLOW_CONFIG_CWD = previous.config
    if (previous.worker === undefined) delete process.env.WEFLOW_WORKER
    else process.env.WEFLOW_WORKER = previous.worker
    rmSync(directory, { recursive: true, force: true })
  }
})

test('group summary index and every separated log participate in privacy diagnostics', () => {
  const service = readFileSync(
    new URL('../electron/services/groupSummaryRecordService.ts', import.meta.url),
    'utf8'
  )
  const assistant = readFileSync(
    new URL('../electron/services/aiAssistantService.ts', import.meta.url),
    'utf8'
  )
  const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(service, /loadEncryptedSensitiveCache/)
  assert.match(service, /writeEncryptedSensitiveCache/)
  assert.match(service, /logsEncrypted: logAudits\.every/)
  assert.match(service, /pendingLogFiles: this\.pendingLogs\.size/)
  assert.match(service, /clearRuntimeCache\(\): void \{[\s\S]{0,320}this\.pendingLogs\.clear\(\)/)
  assert.match(assistant, /groupSummaryRecords: groupSummaryRecordService\.getPrivacyStatus\(\)/)
  assert.match(page, /群聊总结与诊断/)
  assert.match(page, /cache\.logsEncrypted !== false/)
})
