import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODEL_RESPONSE_MAX_BYTES,
  ModelRequestCoordinator,
  ModelResponseLimitError,
  RequestCoordinator
} from '../electron/services/modelRequestCoordinator.ts'

test('model request coordinator aborts active requests and rejects new work after stop', async () => {
  const coordinator = new ModelRequestCoordinator((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  const request = coordinator.fetch('https://example.invalid/model')
  await Promise.resolve()
  assert.deepEqual(coordinator.getStatus(), { accepting: true, active: 1 })
  assert.equal(coordinator.stop('test shutdown'), 1)
  await assert.rejects(request, /test shutdown/)
  assert.deepEqual(coordinator.getStatus(), { accepting: false, active: 0 })
  await assert.rejects(
    coordinator.fetch('https://example.invalid/model'),
    /正在安全退出/
  )
})

test('model request coordinator enforces its own bounded deadline', async () => {
  const coordinator = new ModelRequestCoordinator((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  await assert.rejects(
    coordinator.fetch('https://example.invalid/model', {}, 5),
    /超过 1 秒/
  )
  assert.equal(coordinator.getStatus().active, 0)
})

test('model request coordinator relays an in-flight caller abort without waiting for its deadline', async () => {
  const upstream = new AbortController()
  let observedSignal: AbortSignal | undefined
  const coordinator = new ModelRequestCoordinator((_input, init) => new Promise((_resolve, reject) => {
    observedSignal = init?.signal || undefined
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  const request = coordinator.fetch('https://example.invalid/model', { signal: upstream.signal }, 60_000)
  await Promise.resolve()
  const reason = new Error('scope changed')
  upstream.abort(reason)
  await assert.rejects(request, /scope changed/)
  assert.equal(observedSignal?.aborted, true)
  assert.equal(observedSignal?.reason, reason)
  assert.deepEqual(coordinator.getStatus(), { accepting: true, active: 0 })
})

test('model request coordinator preserves a caller signal already aborted before fetch', async () => {
  const upstream = new AbortController()
  const reason = new Error('privacy policy changed')
  upstream.abort(reason)
  const coordinator = new ModelRequestCoordinator((_input, init) => {
    assert.equal(init?.signal?.aborted, true)
    return Promise.reject(init?.signal?.reason)
  })
  await assert.rejects(
    coordinator.fetch('https://example.invalid/model', { signal: upstream.signal }),
    /privacy policy changed/
  )
  assert.equal(coordinator.getStatus().active, 0)
})

test('generic request coordinator identifies local API timeouts and stops retries', async () => {
  const coordinator = new RequestCoordinator(
    'WeFlow 本机数据请求',
    (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  )
  const request = coordinator.fetch('http://127.0.0.1:5031/api', {}, 5)
  await assert.rejects(request, /WeFlow 本机数据请求超过 1 秒/)
  assert.equal(coordinator.stop(), 0)
  await assert.rejects(
    coordinator.fetch('http://127.0.0.1:5031/api'),
    /不能开始新的WeFlow 本机数据请求/
  )
})

test('request deadline remains active while a response body is still streaming', async () => {
  const coordinator = new RequestCoordinator(
    '慢正文请求',
    (_input, init) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    } as Response)
  )
  await assert.rejects(
    coordinator.fetchJson('https://example.invalid/slow-body', {}, 5),
    /慢正文请求超过 1 秒/
  )
  assert.deepEqual(coordinator.getStatus(), { accepting: true, active: 0 })
})

test('invalid model JSON can be tolerated without hiding transport failures', async () => {
  const coordinator = new ModelRequestCoordinator(() => Promise.resolve({
    ok: true,
    json: async () => { throw new SyntaxError('invalid json') }
  } as Response))
  const tolerant = await coordinator.fetchJson(
    'https://example.invalid/model',
    {},
    100,
    true
  )
  assert.deepEqual(tolerant.payload, {})
  await assert.rejects(
    coordinator.fetchJson('https://example.invalid/model', {}, 100),
    /invalid json/
  )

  const stalled = new ModelRequestCoordinator((_input, init) => Promise.resolve({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  } as Response))
  await assert.rejects(
    stalled.fetchJson('https://example.invalid/model', {}, 5, true),
    /模型请求超过 1 秒/
  )
})

test('model JSON responses are bounded while their body stream is consumed', async () => {
  assert.equal(MODEL_RESPONSE_MAX_BYTES, 8 * 1024 * 1024)
  const coordinator = new ModelRequestCoordinator(() => Promise.resolve(new Response(
    JSON.stringify({ content: 'x'.repeat(128) }),
    { headers: { 'content-type': 'application/json' } }
  )))
  await assert.rejects(
    coordinator.fetchJson('https://example.invalid/model', {}, 1_000, false, 64),
    (error: unknown) => error instanceof ModelResponseLimitError && error.maxBytes === 64
  )
  assert.deepEqual(coordinator.getStatus(), { accepting: true, active: 0 })
})

test('declared oversized model responses are rejected before parsing', async () => {
  const coordinator = new ModelRequestCoordinator(() => Promise.resolve(new Response('{}', {
    headers: { 'content-length': '4096', 'content-type': 'application/json' }
  })))
  await assert.rejects(
    coordinator.fetchJson('https://example.invalid/model', {}, 1_000, false, 128),
    (error: unknown) => error instanceof ModelResponseLimitError && error.code === 'model_response_too_large'
  )
})

test('bounded model JSON keeps tolerant parsing semantics below the limit', async () => {
  const coordinator = new ModelRequestCoordinator(() => Promise.resolve(new Response('not-json')))
  const result = await coordinator.fetchJson('https://example.invalid/model', {}, 1_000, true, 128)
  assert.deepEqual(result.payload, {})
})
