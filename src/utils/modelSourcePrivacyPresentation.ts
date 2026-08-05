const SOURCE_LABELS: Record<string, string> = {
  wechat: '微信',
  documents: '本机文档',
  calendar: '日历',
  mail: 'Mail',
  legacy: '旧版未知来源',
  unknown: '未知来源'
}

function sourceList(value: unknown): string {
  const ids = (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
  return ids.length
    ? ids.map(id => SOURCE_LABELS[id] || '未知来源').join('、')
    : '无'
}

export function presentModelSourcePrivacyAudit(audit: any): {
  valid: boolean
  summary: string
  detail: string
} {
  if (audit?.version !== 'model-source-privacy-v2') {
    return { valid: false, summary: '', detail: '' }
  }
  const contextDocuments = Math.max(0, Math.floor(Number(audit.contextDocuments) || 0))
  const privacyExcluded = Math.max(0, Math.floor(Number(audit.privacyExcludedDocuments) || 0))
  const budgetOmitted = Math.max(0, Math.floor(Number(audit.budgetOmittedDocuments) || 0))
  const incomplete = Math.max(0, Math.floor(Number(audit.incompleteSourceDocuments) || 0))
  const boundaryChecks = new Set(
    (Array.isArray(audit.boundaryChecks) ? audit.boundaryChecks : []).map(String)
  )
  const boundaryVerified = boundaryChecks.has('before_send') && boundaryChecks.has('after_response')
  const digest = /^[a-f0-9]{64}$/i.test(String(audit.outboundSha256 || ''))
    ? String(audit.outboundSha256).slice(0, 12)
    : '缺失'
  return {
    valid: true,
    summary: `模型来源审计：发送 ${contextDocuments} 份；隐私隔离 ${privacyExcluded} 份；Mail ${audit?.policy?.mail === true ? '已授权' : '未授权'}`,
    detail: [
      `进入模型：${sourceList(audit.contextSourceIds)}`,
      `被隐私门禁隔离：${sourceList(audit.excludedSourceIds)}`,
      budgetOmitted ? `上下文预算另省略 ${budgetOmitted} 份已授权资料` : '',
      incomplete ? `${incomplete} 份资料的来源证明不完整，已从严隔离` : '',
      `发送前脱敏 ${Math.max(0, Math.floor(Number(audit?.redaction?.total) || 0))} 处`,
      `请求指纹 ${digest}`,
      boundaryVerified ? '发送前与回答后边界均已核验' : '边界核验记录不完整'
    ].filter(Boolean).join('；')
  }
}
