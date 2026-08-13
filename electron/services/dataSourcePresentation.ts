export type DataSourceCheckpointStatus = {
  stored: boolean
  bytes: number
  policy: 'sqlcipher-internal-only'
}

export function presentDataSourceForRenderer(source: any): any {
  const {
    checkpoint: rawCheckpoint,
    config: rawConfig,
    ...publicSource
  } = source || {}
  const checkpoint = String(rawCheckpoint || '')
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  const publicConfig = publicSource.id === 'documents'
    ? { folderConfigured: Boolean(config.folderPath) }
    : publicSource.id === 'mail'
      ? { allowModelAnalysis: Boolean(config.allowModelAnalysis) }
      : {}
  return {
    ...publicSource,
    config: publicConfig,
    lastError: publicSource.lastError
      ? sanitizeDiagnosticText(publicSource.lastError)
      : null,
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

export function markSelectedConnectorItems(items: unknown, selectedIds: unknown): any[] {
  const selected = new Set(
    (Array.isArray(selectedIds) ? selectedIds : []).map(value => String(value))
  )
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    ...item,
    selected: selected.has(String(item?.id || ''))
  }))
}

export function buildConnectorPickerSnapshot(
  items: unknown,
  source: any,
  selectionKey: 'calendarIds' | 'mailboxIds'
): { items: any[]; mutationToken: string } {
  return {
    items: markSelectedConnectorItems(items, source?.config?.[selectionKey]),
    mutationToken: String(source?.mutationToken || '')
  }
}

export function buildMailConnectorPickerSnapshot(
  items: unknown,
  source: any
): { items: any[]; mutationToken: string; allowModelAnalysis: boolean } {
  return {
    ...buildConnectorPickerSnapshot(items, source, 'mailboxIds'),
    allowModelAnalysis: Boolean(source?.config?.allowModelAnalysis)
  }
}
import { sanitizeDiagnosticText } from './diagnosticRedaction.ts'
