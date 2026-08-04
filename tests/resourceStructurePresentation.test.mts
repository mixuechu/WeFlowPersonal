import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResourceStructurePresentation } from '../src/utils/resourceStructurePresentation.ts'

test('resource dossiers expose every structure already retained by bounded extractors', () => {
  const make = (count: number, field: string) =>
    Array.from({ length: count }, (_, index) => ({ [field]: index + 1 }))
  const presentation = buildResourceStructurePresentation({
    attachmentStructure: {
      sheets: Array.from({ length: 15 }, (_, index) => ({
        name: `工作表 ${index + 1}`,
        charts: make(2, 'index')
      })),
      headings: make(18, 'level'),
      tables: make(11, 'index'),
      charts: make(13, 'index'),
      slides: Array.from({ length: 17 }, (_, index) => ({
        number: index + 1,
        title: `幻灯片 ${index + 1}`,
        charts: make(2, 'index')
      })),
      pages: make(21, 'number')
    },
    ocrStructure: { keyValues: make(14, 'key') },
    visualLabels: make(16, 'identifier')
  })
  assert.equal(presentation.sheets.length, 15)
  assert.equal(presentation.sheetCharts.length, 30)
  assert.equal(presentation.headings.length, 18)
  assert.equal(presentation.tables.length, 11)
  assert.equal(presentation.documentCharts.length, 13)
  assert.equal(presentation.titledSlides.length, 17)
  assert.equal(presentation.slideCharts.length, 34)
  assert.equal(presentation.pages.length, 21)
  assert.equal(presentation.keyValues.length, 14)
  assert.equal(presentation.visualLabels.length, 16)
  assert.equal(presentation.sheetCharts.at(-1)?.parentName, '工作表 15')
  assert.equal(presentation.slideCharts.at(-1)?.parentNumber, 17)
})
