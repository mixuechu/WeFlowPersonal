export type OcrStructure = {
  kind: 'chat' | 'table' | 'form' | 'document'
  confidence: number
  keyValues: Array<{ key: string; value: string }>
  dates: string[]
  amounts: string[]
  urls: string[]
  lineCount: number
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, limit)
}

export function structureOcrText(input: string): OcrStructure {
  const text = String(input || '').replace(/\r/g, '')
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 200)
  const keyValues = lines.flatMap(line => {
    if (/^\d{1,2}:\d{2}\b/.test(line)) return []
    const match = line.match(/^([^:：]{1,24})[:：]\s*(.{1,200})$/)
    return match ? [{ key: match[1].trim(), value: match[2].trim() }] : []
  }).slice(0, 30)
  const dates = unique(
    [...text.matchAll(/(?:20\d{2}[年./-])?\d{1,2}[月./-]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?/g)].map(match => match[0]),
    20
  )
  const amounts = unique(
    [...text.matchAll(/(?:人民币|RMB|CNY|¥|￥)\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*元/g)].map(match => match[0]),
    20
  )
  const urls = unique(
    [...text.matchAll(/https?:\/\/[^\s<>"'，。]+/gi)].map(match => match[0]),
    20
  )
  const chatSignals = lines.filter(line =>
    /^\d{1,2}:\d{2}\b/.test(line) ||
    /^.{1,20}[:：]\s*\S+/.test(line) ||
    /^(昨天|今天|星期[一二三四五六日天])\s*\d{1,2}:\d{2}/.test(line)
  ).length
  const tableSignals = lines.filter(line => /\t| {3,}/.test(line)).length
  let kind: OcrStructure['kind'] = 'document'
  let confidence = 0.58
  if (keyValues.length >= 3) {
    kind = 'form'
    confidence = Math.min(0.92, 0.62 + keyValues.length * 0.04)
  } else if (tableSignals >= 3) {
    kind = 'table'
    confidence = Math.min(0.9, 0.6 + tableSignals * 0.04)
  } else if (chatSignals >= 3) {
    kind = 'chat'
    confidence = Math.min(0.88, 0.58 + chatSignals * 0.04)
  }
  return {
    kind,
    confidence,
    keyValues,
    dates,
    amounts,
    urls,
    lineCount: lines.length
  }
}
