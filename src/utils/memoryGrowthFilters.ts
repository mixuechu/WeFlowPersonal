export type MemoryGrowthOrigin =
  | 'all'
  | 'model_batch'
  | 'connector_page'
  | 'human_action'
  | 'system'
  | 'legacy_unknown'

export type MemoryGrowthSource =
  | 'all'
  | 'wechat'
  | 'documents'
  | 'calendar'
  | 'mail'
  | 'local'
  | 'system'
  | 'legacy'

export type MemoryGrowthConnectorOperation =
  | 'all'
  | 'documents_page'
  | 'mail_page'
  | 'calendar_page'
  | 'wechat_resources'
  | 'wechat_pdf_ocr'
  | 'wechat_image_semantics'
  | 'wechat_attachment_structure'
  | 'document_analysis_running'
  | 'document_analysis_failed'

const CONNECTOR_OPERATION_SOURCE: Record<
  Exclude<MemoryGrowthConnectorOperation, 'all'>,
  Extract<MemoryGrowthSource, 'wechat' | 'documents' | 'calendar' | 'mail'>
> = {
  documents_page: 'documents',
  mail_page: 'mail',
  calendar_page: 'calendar',
  wechat_resources: 'wechat',
  wechat_pdf_ocr: 'wechat',
  wechat_image_semantics: 'wechat',
  wechat_attachment_structure: 'wechat',
  document_analysis_running: 'documents',
  document_analysis_failed: 'documents'
}

export const selectMemoryGrowthConnectorOperation = (
  connectorOperation: MemoryGrowthConnectorOperation
): {
  connectorOperation: MemoryGrowthConnectorOperation
  origin?: MemoryGrowthOrigin
  source?: MemoryGrowthSource
} => connectorOperation === 'all'
  ? { connectorOperation }
  : {
      connectorOperation,
      origin: 'connector_page',
      source: CONNECTOR_OPERATION_SOURCE[connectorOperation]
    }

export const selectMemoryGrowthOrigin = (
  origin: MemoryGrowthOrigin,
  connectorOperation: MemoryGrowthConnectorOperation
): {
  origin: MemoryGrowthOrigin
  connectorOperation: MemoryGrowthConnectorOperation
} => ({
  origin,
  connectorOperation: origin === 'connector_page' ? connectorOperation : 'all'
})

export const selectMemoryGrowthSource = (
  source: MemoryGrowthSource,
  connectorOperation: MemoryGrowthConnectorOperation
): {
  source: MemoryGrowthSource
  connectorOperation: MemoryGrowthConnectorOperation
} => ({
  source,
  connectorOperation:
    connectorOperation === 'all' ||
    source === 'all' ||
    CONNECTOR_OPERATION_SOURCE[connectorOperation] === source
      ? connectorOperation
      : 'all'
})
