import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const service = readFileSync(new URL('../electron/services/aiAssistantService.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AiAssistantPage.tsx', import.meta.url), 'utf8')

test('personal-memory diagnostics include local-secret health without secret material', () => {
  assert.match(service, /localSecretStorage: this\.config\.getLocalSecretStorageStatus\(\)/)
  assert.match(page, /本机主密钥：/)
  assert.match(page, /无旧钥匙串格式/)
  assert.match(page, /主密钥恢复副本：/)
  assert.match(page, /recoveredThisStart/)
  assert.match(page, /系统不会在该状态下覆盖已加密个人记忆/)
  assert.doesNotMatch(page, /localSecretStorage\?\.keyPath/)
})
