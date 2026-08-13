import type { MemorySearchOptions } from './memorySearchFilters'

type PlannerEntity = {
  id: string
  canonicalName: string
  aliases?: string[]
  accountIds?: string[]
}

export type MemoryQueryPlan = {
  queries: string[]
  inferredOptions: MemorySearchOptions
  matchedEntities: Array<{ id: string; name: string }>
  explanation: string[]
}

export function buildContextualMemoryQuestion(
  question: string,
  history: Array<{ role?: string; content?: string }>
): { query: string; usedHistory: boolean } {
  const current = String(question || '').trim()
  const needsContext = /(?:^|[，。？！\s])(他|她|它|他们|她们|这个|那个|这件事|那件事|对方|后来|然后|之后|前面|上述|呢)(?:$|[，。？！\s])/.test(current) ||
    /^(那|所以|还有|后来|然后|之后|呢)/.test(current)
  if (!needsContext) return { query: current, usedHistory: false }
  const previousQuestion = [...(history || [])].reverse()
    .find(message => message?.role === 'user' && String(message.content || '').trim())
  if (!previousQuestion) return { query: current, usedHistory: false }
  return {
    query: `${String(previousQuestion.content).trim().slice(0, 500)}\n追问：${current}`,
    usedHistory: true
  }
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value)
}

function addShanghaiDays(date: Date, days: number): string {
  const current = new Date(`${shanghaiDate(date)}T12:00:00+08:00`)
  current.setUTCDate(current.getUTCDate() + days)
  return shanghaiDate(current)
}

function inferDateRange(query: string, now: Date): Pick<MemorySearchOptions, 'from' | 'to'> {
  const today = shanghaiDate(now)
  if (/今天|今日/.test(query)) return { from: today, to: today }
  if (/昨天|昨日/.test(query)) {
    const yesterday = addShanghaiDays(now, -1)
    return { from: yesterday, to: yesterday }
  }
  const recentDays = query.match(/(?:最近|过去|近)([一二两三四五六七八九十\\d]+)天/)
  if (recentDays) {
    const chineseNumbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
    const days = Number(recentDays[1]) || chineseNumbers[recentDays[1]] || 0
    if (days > 0) return { from: addShanghaiDays(now, -(days - 1)), to: today }
  }
  if (/本周|这周/.test(query)) {
    const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
      .format(now).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, value => String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value)))) || 0
    return { from: addShanghaiDays(now, -(weekday === 0 ? 6 : weekday - 1)), to: today }
  }
  if (/上周/.test(query)) {
    const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
      .format(now).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, value => String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value)))) || 0
    const thisMondayOffset = -(weekday === 0 ? 6 : weekday - 1)
    return { from: addShanghaiDays(now, thisMondayOffset - 7), to: addShanghaiDays(now, thisMondayOffset - 1) }
  }
  if (/本月|这个月/.test(query)) return { from: `${today.slice(0, 7)}-01`, to: today }
  if (/上个月|上月/.test(query)) {
    const [year, month] = today.split('-').map(Number)
    const firstThisMonth = new Date(Date.UTC(year, month - 1, 1, 4))
    const lastPreviousMonth = new Date(firstThisMonth.getTime() - 86_400_000)
    const previous = shanghaiDate(lastPreviousMonth)
    return { from: `${previous.slice(0, 7)}-01`, to: previous }
  }
  return {}
}

function inferDocumentTypes(query: string): string[] {
  const types = new Set<string>()
  if (/待办|任务|要做|需要做|跟进|回复/.test(query)) types.add('task')
  if (/事件|发生|会议|见面|交付|旅行|付款|承诺/.test(query)) types.add('event')
  if (/事实|信息|资料|住址|公司|职位|偏好/.test(query)) types.add('claim')
  if (/关系|认识|同事|朋友|客户|服务对象|合作/.test(query)) types.add('relation')
  return [...types]
}

function inferSourceIds(query: string): string[] {
  const sources = new Set<string>()
  if (/微信|聊天记录|群聊|私聊/.test(query)) sources.add('wechat')
  if (/本机文档|文档里|文件里|PDF|Word|PPT|Excel/i.test(query)) sources.add('documents')
  if (/日历|Calendar/i.test(query)) sources.add('calendar')
  if (/邮件|邮箱|Mail/i.test(query)) sources.add('mail')
  return [...sources]
}

export function buildMemoryQueryPlan(query: string, entities: PlannerEntity[], now = new Date()): MemoryQueryPlan {
  const normalized = String(query || '').trim()
  const matchedEntities = entities.filter(entity => {
    const names = [entity.canonicalName, ...(entity.aliases || []), ...(entity.accountIds || [])]
      .map(value => String(value || '').trim()).filter(value => value.length >= 2)
    return names.some(name => normalized.toLowerCase().includes(name.toLowerCase()))
  }).map(entity => ({ id: entity.id, name: entity.canonicalName }))
  const dates = inferDateRange(normalized, now)
  const documentTypes = inferDocumentTypes(normalized)
  const sourceIds = inferSourceIds(normalized)
  const relationTypes = ['服务对象', '客户', '同事', '朋友', '合作', '家人', '父亲', '母亲', '伴侣']
    .filter(predicate => normalized.includes(predicate))
  const inferredOptions: MemorySearchOptions = {
    ...dates,
    entityId: matchedEntities.length === 1 ? matchedEntities[0].id : undefined,
    sourceIds: sourceIds.length ? sourceIds : undefined,
    documentTypes: documentTypes.length ? documentTypes : undefined,
    relationTypes: relationTypes.length ? relationTypes : undefined
  }
  const queries = [...new Set([
    normalized,
    ...matchedEntities.map(entity => entity.name),
    documentTypes.includes('task') ? '待办 跟进 回复 承诺' : '',
    documentTypes.includes('relation') ? '关系 合作 客户 同事 朋友 服务对象' : ''
  ].filter(Boolean))]
  const explanation: string[] = []
  if (matchedEntities.length) explanation.push(`识别实体：${matchedEntities.map(item => item.name).join('、')}`)
  if (dates.from || dates.to) explanation.push(`时间：${dates.from || '不限'} 至 ${dates.to || '不限'}`)
  if (documentTypes.length) explanation.push(`记忆类型：${documentTypes.join('、')}`)
  if (sourceIds.length) {
    const labels: Record<string, string> = {
      wechat: '微信',
      documents: '本机文档',
      calendar: 'macOS 日历',
      mail: 'macOS Mail'
    }
    explanation.push(`数据来源：${sourceIds.map(source => labels[source] || source).join('、')}`)
  }
  if (relationTypes.length) explanation.push(`关系类型：${relationTypes.join('、')}`)
  if (queries.length > 1) explanation.push(`并行召回 ${queries.length} 个检索表达`)
  return { queries, inferredOptions, matchedEntities, explanation }
}
