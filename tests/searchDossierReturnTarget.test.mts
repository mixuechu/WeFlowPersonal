import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSearchDossierReturnTarget,
  resolveSearchDossierReturn
} from '../src/utils/searchDossierReturnTarget.ts'

test('search dossier return targets retain only kind and stable document id', () => {
  assert.deepEqual(buildSearchDossierReturnTarget('project', ' document-1 '), {
    kind: 'project',
    documentId: 'document-1'
  })
  assert.equal(buildSearchDossierReturnTarget('entity', '  '), null)
})

test('only the matching dossier kind consumes a direct return target', () => {
  const target = buildSearchDossierReturnTarget('structured', 'claim:1')
  assert.equal(resolveSearchDossierReturn(target, 'structured'), 'claim:1')
  assert.equal(resolveSearchDossierReturn(target, 'entity'), '')
  assert.equal(resolveSearchDossierReturn(null, 'structured'), '')
})

test('a terminal evidence archive may consume its parent search return target', () => {
  const target = buildSearchDossierReturnTarget('task', 'task:1')
  assert.equal(resolveSearchDossierReturn(target), 'task:1')
})
