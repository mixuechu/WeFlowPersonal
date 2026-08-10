import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelJsonParseError, parseModelJsonObject } from '../electron/services/modelJsonParser.ts'

test('model JSON parser accepts one strict object', () => {
  assert.deepEqual(parseModelJsonObject('{"tasks":[],"summary":"ok"}'), {
    tasks: [],
    summary: 'ok'
  })
})

test('model JSON parser selects the final fenced object after explanatory examples', () => {
  const value = `示例：\n\`\`\`json\n{"example":true}\n\`\`\`\n最终答案：\n\`\`\`json\n{"tasks":[{"title":"跟进"}]}\n\`\`\``
  assert.deepEqual(parseModelJsonObject(value), { tasks: [{ title: '跟进' }] })
})

test('model JSON parser finds the final balanced object without confusing braces in strings', () => {
  const value = '分析 {不完整\n最终：{"summary":"保留 {花括号} 和 \\\"引号\\\"","tasks":[]}'
  assert.deepEqual(parseModelJsonObject(value), {
    summary: '保留 {花括号} 和 "引号"',
    tasks: []
  })
})

test('model JSON parser repairs a bounded final object but rejects arrays and prose', () => {
  assert.deepEqual(parseModelJsonObject('最终结果：```json\n{tasks: [], summary: "ok",}\n```'), {
    tasks: [],
    summary: 'ok'
  })
  assert.throws(() => parseModelJsonObject('[{"task":1}]'), ModelJsonParseError)
  assert.throws(() => parseModelJsonObject('没有结构化结果'), ModelJsonParseError)
})
