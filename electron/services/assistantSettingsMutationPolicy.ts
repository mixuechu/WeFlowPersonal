import crypto from 'node:crypto'

export type AssistantSettingsMutationIdentity = {
  configured: boolean
  apiKeySecret: string
  baseUrl: unknown
  model: unknown
  scheduleTime: unknown
  quietStart: unknown
  quietEnd: unknown
  inputCostPerMillion: unknown
  outputCostPerMillion: unknown
  enabled: unknown
  ownerName: unknown
  ownerAliases: unknown
  ownerBackground: unknown
  transcribeVoice: unknown
  ocrImages: unknown
  analyzeImages: unknown
  indexWebLinks: unknown
  resourceTrashRetentionDays: unknown
  sensitiveRedactionLevel: unknown
}

export function buildAssistantSettingsMutationToken(
  identity: AssistantSettingsMutationIdentity
): string {
  const { apiKeySecret, ...visible } = identity
  return crypto.createHash('sha256').update(JSON.stringify({
    ...visible,
    apiKeySha256: crypto.createHash('sha256').update(String(apiKeySecret || '')).digest('hex')
  })).digest('hex')
}

export function assertAssistantSettingsMutationToken(
  current: AssistantSettingsMutationIdentity,
  expectedMutationToken: unknown
): void {
  if (!String(expectedMutationToken || '') ||
      expectedMutationToken !== buildAssistantSettingsMutationToken(current)) {
    throw new Error('AI 助理设置在展示后发生了变化，请刷新后重新核对')
  }
}
