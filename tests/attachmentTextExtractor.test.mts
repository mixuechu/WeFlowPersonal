import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { ATTACHMENT_TEXT_LIMITS, extractAttachmentText } from '../electron/services/attachmentTextExtractor.ts'

function createMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  const stream = text
    ? `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
    : '0 0 100 100 re S'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

function createPositionedPdf(items: Array<{ x: number, y: number, text: string }>): Buffer {
  const stream = items.map(item => {
    const escaped = item.text.replace(/([\\()])/g, '\\$1')
    return `BT /F1 12 Tf ${item.x} ${item.y} Td (${escaped}) Tj ET`
  }).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

test('attachment text extractor reads bounded UTF-8 text and rejects oversized input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-text-'))
  try {
    const filePath = join(directory, '项目说明.md')
    writeFileSync(filePath, '# 验收安排\n周五前完成第一轮验收。\n')
    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.equal(result.status, 'indexed')
    assert.match(result.text, /周五前完成第一轮验收/)

    const oversized = await extractAttachmentText(filePath, ATTACHMENT_TEXT_LIMITS.maxFileBytes + 1)
    assert.equal(oversized.status, 'too_large')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor recovers DOCX body text without cloud services', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-docx-'))
  try {
    const archive = new JSZip()
    archive.file('word/document.xml', [
      '<w:document><w:body>',
      '<w:p><w:r><w:t>客户交付清单</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>需要补齐测试报告</w:t></w:r></w:p>',
      '</w:body></w:document>'
    ].join(''))
    const filePath = join(directory, '交付清单.docx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))
    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.match(result.text, /客户交付清单/)
    assert.match(result.text, /需要补齐测试报告/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor preserves DOCX headings, lists, tables and headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-docx-structure-'))
  try {
    const archive = new JSZip()
    archive.file('word/document.xml', [
      '<w:document><w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>项目计划</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>确认需求</w:t></w:r></w:p>',
      '<w:tbl>',
      '<w:tr><w:tc><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>事项</w:t></w:r></w:p></w:tc></w:tr>',
      '<w:tr><w:tc><w:p><w:r><w:t>李金石</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>提交方案</w:t></w:r></w:p></w:tc></w:tr>',
      '</w:tbl>',
      '</w:body></w:document>'
    ].join(''))
    archive.file('word/header1.xml', '<w:hdr><w:p><w:r><w:t>Onyx Devs Lab</w:t></w:r></w:p></w:hdr>')
    const filePath = join(directory, '项目计划.docx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))

    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.match(result.text, /# 项目计划/)
    assert.match(result.text, /- 确认需求/)
    assert.match(result.text, /\[表格 1\]/)
    assert.match(result.text, /负责人=李金石/)
    assert.match(result.text, /\[页眉\] Onyx Devs Lab/)
    assert.equal(result.structure?.kind, 'document')
    if (result.structure?.kind === 'document') {
      assert.equal(result.structure.headingCount, 1)
      assert.equal(result.structure.listItemCount, 1)
      assert.equal(result.structure.tableCount, 1)
      assert.equal(result.structure.tables[0].layout, 'grid')
      assert.deepEqual(result.structure.tables[0].headers, ['负责人', '事项'])
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor preserves PPTX slide order, titles and tables', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-pptx-structure-'))
  try {
    const archive = new JSZip()
    const slide = (title: string, body: string, table = '') => [
      '<p:sld><p:cSld><p:spTree>',
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`,
      `<p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`,
      table,
      '</p:spTree></p:cSld></p:sld>'
    ].join('')
    archive.file('ppt/slides/slide1.xml', slide('项目总览', '本周完成需求确认',
      '<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>负责人</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>李金石</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>'))
    archive.file('ppt/slides/slide2.xml', slide('下一步', '提交测试报告'))
    archive.file('ppt/slides/slide10.xml', slide('附录', '历史记录').replace('type="title"', 'type="body"'))
    const filePath = join(directory, '项目汇报.pptx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))

    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.ok(result.text.indexOf('[幻灯片 2：下一步]') < result.text.indexOf('[幻灯片 3：附录]'))
    assert.match(result.text, /\[幻灯片 1 · 表格 1\]/)
    assert.match(result.text, /李金石/)
    assert.equal(result.structure?.kind, 'presentation')
    if (result.structure?.kind === 'presentation') {
      assert.equal(result.structure.slideCount, 3)
      assert.equal(result.structure.slides[0].title, '项目总览')
      assert.equal(result.structure.slides[0].titleSource, 'placeholder')
      assert.equal(result.structure.slides[2].title, '附录')
      assert.equal(result.structure.slides[2].titleSource, 'layout-inference')
      assert.equal(result.structure.tableCount, 1)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor indexes text-layer PDFs and marks image-only PDFs for OCR', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-pdf-'))
  try {
    const textPdf = join(directory, 'text.pdf')
    const imageOnlyPdf = join(directory, 'scan.pdf')
    writeFileSync(textPdf, createMinimalPdf('WeFlow PDF attachment index test'))
    writeFileSync(imageOnlyPdf, createMinimalPdf(''))
    const indexed = await extractAttachmentText(textPdf)
    assert.equal(indexed.status, 'indexed')
    assert.match(indexed.text, /WeFlow PDF attachment index test/)
    assert.equal(indexed.structure?.kind, 'pdf')
    if (indexed.structure?.kind === 'pdf') {
      assert.equal(indexed.structure.pages[0].columnCount, 1)
      assert.equal(indexed.structure.multiColumnPageCount, 0)
    }
    const scan = await extractAttachmentText(imageOnlyPdf)
    assert.equal(scan.status, 'ocr_required')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor preserves two-column PDF reading order and layout evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-pdf-columns-'))
  try {
    const filePath = join(directory, 'two-columns.pdf')
    writeFileSync(filePath, createPositionedPdf([
      { x: 220, y: 740, text: 'PROJECT STATUS HEADER' },
      { x: 72, y: 690, text: 'LEFT ITEM ONE' },
      { x: 72, y: 660, text: 'LEFT ITEM TWO' },
      { x: 340, y: 690, text: 'RIGHT ITEM ONE' },
      { x: 340, y: 660, text: 'RIGHT ITEM TWO' }
    ]))
    const result = await extractAttachmentText(filePath)
    assert.equal(result.status, 'indexed')
    assert.equal(result.structure?.kind, 'pdf')
    assert.match(result.text, /双栏阅读顺序/)
    assert.ok(result.text.indexOf('LEFT ITEM TWO') < result.text.indexOf('RIGHT ITEM ONE'))
    if (result.structure?.kind === 'pdf') {
      assert.equal(result.structure.pageCount, 1)
      assert.equal(result.structure.multiColumnPageCount, 1)
      assert.equal(result.structure.pages[0].columnCount, 2)
      assert.ok(result.structure.pages[0].columnConfidence >= 0.7)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor preserves XLSX sheets, headers, formulas, dates and links', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-xlsx-'))
  try {
    const workbook = new ExcelJS.Workbook()
    const tasks = workbook.addWorksheet('客户待办')
    tasks.addRow(['负责人', '事项', '截止日期', '预算'])
    tasks.addRow(['李金石', '确认交付范围', new Date('2026-08-03T00:00:00.000Z'), 12000])
    tasks.addRow([
      '王小明',
      { text: '查看需求文档', hyperlink: 'https://example.com/spec' },
      new Date('2026-08-05T00:00:00.000Z'),
      { formula: 'D2*1.1', result: 13200 }
    ])
    const contacts = workbook.addWorksheet('联系人')
    contacts.addRow(['姓名', '公司'])
    contacts.addRow(['邢爱妮', 'Onyx Devs Lab'])
    const filePath = join(directory, '项目台账.xlsx')
    await workbook.xlsx.writeFile(filePath)

    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.equal(result.status, 'indexed')
    assert.match(result.text, /\[工作表：客户待办\]/)
    assert.match(result.text, /负责人=李金石/)
    assert.match(result.text, /查看需求文档（https:\/\/example\.com\/spec）/)
    assert.match(result.text, /13200（公式：D2\*1\.1）/)
    assert.match(result.text, /\[工作表：联系人\]/)
    assert.equal(result.structure?.kind, 'spreadsheet')
    assert.equal(result.structure?.sheetCount, 2)
    assert.equal(result.structure?.indexedSheetCount, 2)
    assert.deepEqual(result.structure?.sheets[0].headers, ['负责人', '事项', '截止日期', '预算'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor applies explicit XLSX row budgets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-xlsx-budget-'))
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('大量数据')
    sheet.addRow(['序号', '事项'])
    for (let index = 1; index <= ATTACHMENT_TEXT_LIMITS.maxSpreadsheetRowsPerSheet + 10; index += 1) {
      sheet.addRow([index, `事项 ${index}`])
    }
    const filePath = join(directory, '大量数据.xlsx')
    await workbook.xlsx.writeFile(filePath)

    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.equal(result.structure?.truncated, true)
    assert.equal(result.structure?.sheets[0].truncated, true)
    assert.ok((result.structure?.sheets[0].indexedRows || 0) <= ATTACHMENT_TEXT_LIMITS.maxSpreadsheetRowsPerSheet)
    assert.doesNotMatch(result.text, /事项 510/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attachment text extractor falls back for prefixed OOXML without shifting sparse cells', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-attachment-xlsx-prefixed-'))
  try {
    const archive = new JSZip()
    archive.file('xl/workbook.xml',
      '<x:workbook><x:sheets><x:sheet name="预算" r:id="R1" /></x:sheets></x:workbook>')
    archive.file('xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="R1" Target="/xl/worksheets/sheet1.xml" /></Relationships>')
    archive.file('xl/styles.xml', [
      '<x:styleSheet><x:cellXfs>',
      '<x:xf numFmtId="0" />',
      '<x:xf numFmtId="14" />',
      '</x:cellXfs></x:styleSheet>'
    ].join(''))
    archive.file('xl/worksheets/sheet1.xml', [
      '<x:worksheet><x:sheetData>',
      '<x:row r="1"><x:c r="A1" t="str"><x:v>事项</x:v></x:c><x:c r="C1" t="str"><x:v>日期</x:v></x:c><x:c r="D1" t="str"><x:v>金额</x:v></x:c></x:row>',
      '<x:row r="2"><x:c r="A2" t="str"><x:v>交付</x:v></x:c><x:c r="B2" /><x:c r="C2" s="1" t="n"><x:v>46237</x:v></x:c><x:c r="D2" t="n"><x:f>6000*2</x:f><x:v>12000.000000000002</x:v></x:c></x:row>',
      '</x:sheetData></x:worksheet>'
    ].join(''))
    const filePath = join(directory, '精简导出.xlsx')
    writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }))

    const result = await extractAttachmentText(filePath)
    assert.equal(result.success, true)
    assert.match(result.text, /\[工作表：预算\]/)
    assert.match(result.text, /事项=交付/)
    assert.match(result.text, /日期=2026-08-03T00:00:00.000Z/)
    assert.match(result.text, /金额=12000（公式：6000\*2）/)
    assert.doesNotMatch(result.text, /金额=12000\.000000000002/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
