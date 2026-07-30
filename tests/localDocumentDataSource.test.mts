import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalDocumentDataSource } from '../electron/services/localDocumentDataSource.ts'
import { runPersonalDataSourceBatch } from '../electron/services/personalDataSources.ts'

test('local document connector incrementally extracts supported files with stable evidence IDs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weflow-document-source-test-'))
  const markdownPath = join(directory, 'project-notes.md')
  const outsidePath = join(tmpdir(), `weflow-document-outside-${process.pid}.txt`)
  try {
    writeFileSync(markdownPath, '# Project Alpha\n\nDeliver the prototype on Friday.')
    writeFileSync(join(directory, 'ignored.bin'), Buffer.from([1, 2, 3]))
    writeFileSync(outsidePath, 'must not follow this symlink')
    symlinkSync(outsidePath, join(directory, 'outside-link.txt'))

    const connector = new LocalDocumentDataSource(directory)
    let checkpoint = ''
    const first = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
      assert.equal(items.length, 1)
      assert.equal(items[0].title, 'project-notes.md')
      assert.match(items[0].content, /Deliver the prototype/)
      assert.equal(items[0].metadata?.extractionStatus, 'indexed')
      assert.match(String(items[0].externalId), /^[a-f0-9]{32}$/)
    })
    checkpoint = first.checkpoint
    assert.equal(first.pulled, 1)

    const unchanged = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
      assert.equal(items.length, 0)
    })
    assert.equal(unchanged.pulled, 0)

    writeFileSync(markdownPath, '# Project Alpha\n\nPrototype delivered; schedule the review.')
    const future = new Date(Date.now() + 2000)
    utimesSync(markdownPath, future, future)
    const changed = await runPersonalDataSourceBatch(connector, checkpoint, async items => {
      assert.equal(items.length, 1)
      assert.match(items[0].content, /schedule the review/)
    })
    assert.equal(changed.pulled, 1)
    assert.notEqual(changed.checkpoint, checkpoint)
    assert.equal(readFileSync(outsidePath, 'utf8'), 'must not follow this symlink')
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(outsidePath, { force: true })
  }
})
