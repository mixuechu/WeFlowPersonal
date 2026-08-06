import assert from 'node:assert/strict'
import test from 'node:test'
import { projectDossierDrilldown } from '../src/utils/projectDossierDrilldown.ts'

test('project overview metrics map to their authoritative dossier sections', () => {
  assert.deepEqual(projectDossierDrilldown('progress'), {
    sectionId: 'project-dossier-tasks'
  })
  assert.deepEqual(projectDossierDrilldown('tasks'), {
    sectionId: 'project-dossier-tasks'
  })
  assert.deepEqual(projectDossierDrilldown('risks'), {
    sectionId: 'project-dossier-risks'
  })
  assert.deepEqual(projectDossierDrilldown('reviews'), {
    sectionId: 'project-dossier-reviews'
  })
})

test('project memory metrics request unfiltered authoritative sections', () => {
  assert.deepEqual(projectDossierDrilldown('claims'), {
    sectionId: 'project-memory-claims',
    resetScope: 'claims'
  })
  assert.deepEqual(projectDossierDrilldown('events'), {
    sectionId: 'project-memory-events',
    resetScope: 'events'
  })
  assert.deepEqual(projectDossierDrilldown('evidence'), {
    sectionId: 'project-dossier-evidence',
    resetScope: 'evidence'
  })
})
