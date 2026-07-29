import test from 'node:test'
import assert from 'node:assert/strict'
import { structureOcrText } from '../electron/services/imageOcrStructuring.ts'

test('OCR structuring extracts reusable fields, dates, amounts and links locally', () => {
  const result = structureOcrText([
    '项目：WeFlow Personal OS',
    '负责人：李金石',
    '交付日期：2026-08-05',
    '报价：￥12,800.00',
    '资料：https://example.com/spec'
  ].join('\n'))
  assert.equal(result.kind, 'form')
  assert.ok(result.confidence >= 0.8)
  assert.deepEqual(result.keyValues.slice(0, 2), [
    { key: '项目', value: 'WeFlow Personal OS' },
    { key: '负责人', value: '李金石' }
  ])
  assert.ok(result.dates.includes('2026-08-05'))
  assert.ok(result.amounts.includes('￥12,800.00'))
  assert.ok(result.urls.includes('https://example.com/spec'))
})

test('OCR structuring recognizes chat-like screenshots without inventing fields', () => {
  const result = structureOcrText([
    '10:21 小王：方案我发群里了',
    '10:22 李总：收到',
    '10:25 小王：周五前再改一版'
  ].join('\n'))
  assert.equal(result.kind, 'chat')
  assert.equal(result.keyValues.length, 0)
  assert.equal(result.lineCount, 3)
})
