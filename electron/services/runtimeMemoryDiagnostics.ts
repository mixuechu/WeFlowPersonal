export type RuntimeProcessMetric = {
  pid?: number
  type?: string
  memory?: {
    workingSetSize?: number
    peakWorkingSetSize?: number
  }
}

export type SupplementalRuntimeProcess = {
  pid?: number
  type: 'utility' | 'other'
  workingSetBytes?: number
}

export type RuntimeNodeMemory = {
  rss?: number
  heapUsed?: number
  heapTotal?: number
  external?: number
  arrayBuffers?: number
}

type RuntimeMemoryBucket = {
  processes: number
  workingSetBytes: number
}

export type RuntimeMemoryDiagnostics = {
  version: 'runtime-memory-v1'
  available: boolean
  measuredAt: string
  processes: number
  workingSetBytes: number
  peakObservedBytes: number
  byType: Record<'browser' | 'renderer' | 'utility' | 'gpu' | 'other', RuntimeMemoryBucket>
  mainNode: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
    arrayBuffersBytes: number
  }
  units: 'bytes'
  scope: 'electron_and_registered_worker_working_sets'
  supplementalProcesses: number
}

const emptyBucket = (): RuntimeMemoryBucket => ({ processes: 0, workingSetBytes: 0 })

const finiteNonNegative = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

const metricBucket = (type: unknown): keyof RuntimeMemoryDiagnostics['byType'] => {
  switch (String(type || '').toLowerCase()) {
    case 'browser': return 'browser'
    case 'tab': return 'renderer'
    case 'utility': return 'utility'
    case 'gpu': return 'gpu'
    default: return 'other'
  }
}

export function collectRuntimeMemoryDiagnostics(
  metrics: RuntimeProcessMetric[],
  nodeMemory: RuntimeNodeMemory,
  previousPeakBytes = 0,
  measuredAt = new Date().toISOString(),
  supplementalProcesses: SupplementalRuntimeProcess[] = []
): RuntimeMemoryDiagnostics {
  const byType: RuntimeMemoryDiagnostics['byType'] = {
    browser: emptyBucket(),
    renderer: emptyBucket(),
    utility: emptyBucket(),
    gpu: emptyBucket(),
    other: emptyBucket()
  }
  let workingSetBytes = 0
  let processes = 0
  const includedPids = new Set<number>()
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    const workingSet = finiteNonNegative(metric?.memory?.workingSetSize) * 1024
    const bucket = byType[metricBucket(metric?.type)]
    bucket.processes += 1
    bucket.workingSetBytes += workingSet
    workingSetBytes += workingSet
    processes += 1
    const pid = finiteNonNegative(metric?.pid)
    if (pid) includedPids.add(pid)
  }
  const electronMetricsAvailable = processes > 0 && workingSetBytes > 0
  let supplementalCount = 0
  for (const process of Array.isArray(supplementalProcesses) ? supplementalProcesses : []) {
    const pid = finiteNonNegative(process?.pid)
    if (pid && includedPids.has(pid)) continue
    const workingSet = finiteNonNegative(process?.workingSetBytes)
    if (!workingSet) continue
    const bucket = byType[process.type === 'utility' ? 'utility' : 'other']
    bucket.processes += 1
    bucket.workingSetBytes += workingSet
    workingSetBytes += workingSet
    processes += 1
    supplementalCount += 1
    if (pid) includedPids.add(pid)
  }
  const mainNode = {
    rssBytes: finiteNonNegative(nodeMemory?.rss),
    heapUsedBytes: finiteNonNegative(nodeMemory?.heapUsed),
    heapTotalBytes: finiteNonNegative(nodeMemory?.heapTotal),
    externalBytes: finiteNonNegative(nodeMemory?.external),
    arrayBuffersBytes: finiteNonNegative(nodeMemory?.arrayBuffers)
  }
  // Some platforms may temporarily return no Electron process metrics. Keep the
  // main process RSS visible alongside explicitly registered child processes.
  if (!electronMetricsAvailable && mainNode.rssBytes > 0) {
    byType.browser.processes += 1
    byType.browser.workingSetBytes += mainNode.rssBytes
    workingSetBytes += mainNode.rssBytes
    processes += 1
  }
  const available = electronMetricsAvailable
  return {
    version: 'runtime-memory-v1',
    available,
    measuredAt,
    processes,
    workingSetBytes,
    peakObservedBytes: Math.max(
      finiteNonNegative(previousPeakBytes),
      workingSetBytes
    ),
    byType,
    mainNode,
    units: 'bytes',
    scope: 'electron_and_registered_worker_working_sets',
    supplementalProcesses: supplementalCount
  }
}
