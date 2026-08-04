export function buildResourceStructurePresentation(metadata: any): {
  sheets: any[]
  sheetCharts: any[]
  headings: any[]
  tables: any[]
  documentCharts: any[]
  titledSlides: any[]
  slideCharts: any[]
  pages: any[]
  keyValues: any[]
  visualLabels: any[]
} {
  const structure = metadata?.attachmentStructure || {}
  const sheets = Array.isArray(structure.sheets) ? structure.sheets : []
  const slides = Array.isArray(structure.slides) ? structure.slides : []
  return {
    sheets,
    sheetCharts: sheets.flatMap((sheet: any) =>
      (Array.isArray(sheet?.charts) ? sheet.charts : [])
        .map((chart: any) => ({ ...chart, parentName: sheet.name }))),
    headings: Array.isArray(structure.headings) ? structure.headings : [],
    tables: Array.isArray(structure.tables) ? structure.tables : [],
    documentCharts: Array.isArray(structure.charts) ? structure.charts : [],
    titledSlides: slides.filter((slide: any) => slide?.title),
    slideCharts: slides.flatMap((slide: any) =>
      (Array.isArray(slide?.charts) ? slide.charts : [])
        .map((chart: any) => ({ ...chart, parentNumber: slide.number }))),
    pages: Array.isArray(structure.pages) ? structure.pages : [],
    keyValues: Array.isArray(metadata?.ocrStructure?.keyValues)
      ? metadata.ocrStructure.keyValues
      : [],
    visualLabels: Array.isArray(metadata?.visualLabels) ? metadata.visualLabels : []
  }
}
