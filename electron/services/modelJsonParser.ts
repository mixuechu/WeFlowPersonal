import { jsonrepair } from 'jsonrepair'

export class ModelJsonParseError extends Error {
  code = 'model_invalid_json' as const

  constructor() {
    super('模型没有返回有效 JSON')
    this.name = 'ModelJsonParseError'
  }
}

function balancedObjectCandidates(text: string, limit = 64): string[] {
  const result: string[] = []
  let cursor = 0
  while (result.length < limit) {
    const start = text.indexOf('{', cursor)
    if (start < 0) break
    let depth = 0
    let quoted = false
    let escaped = false
    let completed = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth += 1
      else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          result.push(text.slice(start, index + 1))
          cursor = index + 1
          completed = true
          break
        }
      }
    }
    if (!completed) cursor = start + 1
  }
  return result
}

function parseObject(candidate: string, repair: boolean): any | null {
  try {
    const parsed = JSON.parse(repair ? jsonrepair(candidate) : candidate)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseModelJsonObject(value: unknown): any {
  const raw = String(value || '').trim()
  if (!raw) throw new ModelJsonParseError()
  const exact = parseObject(raw, false)
  if (exact) return exact
  if (raw.startsWith('[') && raw.endsWith(']')) throw new ModelJsonParseError()

  const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map(match => String(match[1] || '').trim())
    .filter(Boolean)
    .reverse()
  const balanced = balancedObjectCandidates(raw).reverse()
  for (const candidate of [...fences, ...balanced]) {
    const parsed = parseObject(candidate, false) || parseObject(candidate, true)
    if (parsed) return parsed
  }
  const repaired = parseObject(raw, true)
  if (repaired) return repaired
  throw new ModelJsonParseError()
}
