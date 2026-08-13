import test from 'node:test'
import assert from 'node:assert/strict'

import {
  unsupportedWcdbQueryParameterReason
} from '../electron/services/wcdbQueryPolicy.ts'

test('WCDB fallback queries without parameters remain supported', () => {
  assert.equal(unsupportedWcdbQueryParameterReason([]), null)
  assert.equal(unsupportedWcdbQueryParameterReason(undefined), null)
})

test('WCDB fallback queries fail closed instead of silently ignoring parameters', () => {
  const reason = unsupportedWcdbQueryParameterReason([
    'private contact name',
    { secret: 'must not appear in the error' }
  ])
  assert.equal(reason, 'WCDB 原生查询尚不支持参数绑定，已拒绝执行 2 个未绑定参数')
  assert.doesNotMatch(String(reason), /private contact name|must not appear/)
})
