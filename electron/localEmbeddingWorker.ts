type WorkerInput = {
  type: 'initialize' | 'embed' | 'dispose'
  id?: number
  texts?: string[]
  cacheDirectory?: string
  model?: string
  revision?: string
}

const send = (message: Record<string, unknown>) => {
  if (typeof process.send === 'function') process.send(message)
}

let extractorPromise: Promise<any> | null = null
let queue = Promise.resolve()

process.on('message', (message: WorkerInput) => {
  queue = queue.then(async () => {
    const id = Number(message?.id || 0)
    if (message?.type === 'initialize') {
      if (extractorPromise) throw new Error('本地向量子进程已经初始化')
      extractorPromise = import('@huggingface/transformers').then(({ env, pipeline }) => {
        env.cacheDir = String(message.cacheDirectory || '')
        env.allowLocalModels = true
        env.allowRemoteModels = true
        return pipeline('feature-extraction', String(message.model || ''), {
          dtype: 'q8',
          revision: String(message.revision || '')
        })
      })
      await extractorPromise
      send({ type: 'ready' })
      return
    }
    if (!extractorPromise) throw new Error('本地向量子进程尚未初始化')
    if (message?.type === 'dispose') {
      const extractor: any = await extractorPromise
      if (typeof extractor?.dispose === 'function') await extractor.dispose()
      send({ type: 'disposed', id })
      return
    }
    if (message?.type !== 'embed') throw new Error('无效的本地向量 worker 请求')
    const texts = Array.isArray(message.texts)
      ? message.texts.map(text => String(text || '').slice(0, 4_000)).slice(0, 64)
      : []
    if (!texts.length) throw new Error('本地向量 worker 收到空批次')
    const extractor: any = await extractorPromise
    const tensor = await extractor(texts, { pooling: 'mean', normalize: true })
    const dimensions = Number(tensor.dims?.[tensor.dims.length - 1] || 0)
    if (!dimensions) throw new Error('本地向量模型返回了无效维度')
    const values = Array.from(tensor.data as Float32Array, Number)
    const vectors = texts.map((_, index) =>
      values.slice(index * dimensions, (index + 1) * dimensions))
    send({ type: 'result', id, vectors })
  }).catch(error => {
    send({
      type: 'error',
      id: Number(message?.id || 0),
      error: error instanceof Error ? error.message : String(error)
    })
  })
})

process.on('disconnect', () => process.exit(0))
