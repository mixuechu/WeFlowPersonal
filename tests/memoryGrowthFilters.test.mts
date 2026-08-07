import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectMemoryGrowthConnectorOperation,
  selectMemoryGrowthOrigin,
  selectMemoryGrowthSource
} from '../src/utils/memoryGrowthFilters.ts'

test('memory growth connector filters keep origin and source mutually consistent', () => {
  assert.deepEqual(selectMemoryGrowthConnectorOperation('wechat_pdf_ocr'), {
    connectorOperation: 'wechat_pdf_ocr',
    origin: 'connector_page',
    source: 'wechat'
  })
  assert.deepEqual(selectMemoryGrowthConnectorOperation('document_analysis_failed'), {
    connectorOperation: 'document_analysis_failed',
    origin: 'connector_page',
    source: 'documents'
  })
  assert.deepEqual(selectMemoryGrowthConnectorOperation('all'), {
    connectorOperation: 'all'
  })
  assert.deepEqual(
    selectMemoryGrowthOrigin('model_batch', 'wechat_pdf_ocr'),
    { origin: 'model_batch', connectorOperation: 'all' }
  )
  assert.deepEqual(
    selectMemoryGrowthOrigin('connector_page', 'wechat_pdf_ocr'),
    { origin: 'connector_page', connectorOperation: 'wechat_pdf_ocr' }
  )
  assert.deepEqual(
    selectMemoryGrowthSource('documents', 'wechat_pdf_ocr'),
    { source: 'documents', connectorOperation: 'all' }
  )
  assert.deepEqual(
    selectMemoryGrowthSource('all', 'wechat_pdf_ocr'),
    { source: 'all', connectorOperation: 'wechat_pdf_ocr' }
  )
  assert.deepEqual(
    selectMemoryGrowthSource('wechat', 'wechat_pdf_ocr'),
    { source: 'wechat', connectorOperation: 'wechat_pdf_ocr' }
  )
})
