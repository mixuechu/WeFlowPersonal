export type DataSourceCheckpointStatus = {
  stored: boolean
  bytes: number
  policy: 'sqlcipher-internal-only'
}

export function presentDataSourceForRenderer(source: any): any {
  const {
    checkpoint: rawCheckpoint,
    ...publicSource
  } = source || {}
  const checkpoint = String(rawCheckpoint || '')
  return {
    ...publicSource,
    checkpointStatus: {
      stored: Boolean(checkpoint),
      bytes: new TextEncoder().encode(checkpoint).byteLength,
      policy: 'sqlcipher-internal-only'
    } satisfies DataSourceCheckpointStatus
  }
}

export function presentDataSourcesForRenderer(sources: unknown): any[] {
  return (Array.isArray(sources) ? sources : []).map(presentDataSourceForRenderer)
}
