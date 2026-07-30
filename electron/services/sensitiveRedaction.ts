export type SensitiveRedactionLevel = 'credentials' | 'standard' | 'strict'

export type SensitiveRedactionSummary = {
  level: SensitiveRedactionLevel
  total: number
  counts: Record<string, number>
}

type RedactionContext = {
  level: SensitiveRedactionLevel
  values: Map<string, string>
  counters: Map<string, number>
  counts: Map<string, number>
}

export function createSensitiveRedactionContext(level: SensitiveRedactionLevel = 'standard'): RedactionContext {
  return { level, values: new Map(), counters: new Map(), counts: new Map() }
}

function placeholder(context: RedactionContext, type: string, raw: string): string {
  const normalized = raw.replace(/\s+/g, '').toLowerCase()
  const key = `${type}:${normalized}`
  context.counts.set(type, (context.counts.get(type) || 0) + 1)
  const existing = context.values.get(key)
  if (existing) return existing
  const index = (context.counters.get(type) || 0) + 1
  const value = `[${type}#${index}]`
  context.counters.set(type, index)
  context.values.set(key, value)
  return value
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 16 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

export function redactSensitiveText(
  text: string,
  level: SensitiveRedactionLevel = 'standard',
  sharedContext?: RedactionContext
): { text: string, summary: SensitiveRedactionSummary, context: RedactionContext } {
  const context = sharedContext || createSensitiveRedactionContext(level)
  let output = String(text || '')
  const replace = (pattern: RegExp, type: string, predicate?: (value: string) => boolean) => {
    output = output.replace(pattern, value => predicate && !predicate(value) ? value : placeholder(context, type, value))
  }

  replace(/\bsk-[A-Za-z0-9._-]{12,}\b/g, 'API密钥')
  replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, '访问令牌')
  replace(/\b[A-Fa-f0-9]{32,}\b/g, '长令牌')
  output = output.replace(
    /(?<![?&])((?:password|passwd|pwd|secret|token|api[_ -]?key|密码|口令|密钥)\s*[:=：]\s*)([^\s,，;；"'<>?&#\[\]]{6,})/gi,
    (_full, label, value) => `${label}${placeholder(context, '凭证', value)}`
  )

  if (level !== 'credentials') {
    replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '邮箱')
    replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '手机号')
    replace(/(?<![A-Za-z0-9])\d{17}[\dXx](?![A-Za-z0-9])/g, '身份证')
    replace(/(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, '银行卡', luhnValid)
  }
  if (level === 'strict') {
    replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, 'IP地址')
    output = output.replace(
      /([?&](?:access_token|token|api_key|apikey|secret|signature|sig)=)([^&#\s]+)/gi,
      (_full, prefix, value) => `${prefix}${placeholder(context, '链接凭证', value)}`
    )
  }
  const counts = Object.fromEntries(context.counts)
  return {
    text: output,
    summary: { level: context.level, total: Object.values(counts).reduce((sum, count) => sum + count, 0), counts },
    context
  }
}

export function redactLocalSecrets(text: string): string {
  return redactSensitiveText(text, 'credentials').text
}
