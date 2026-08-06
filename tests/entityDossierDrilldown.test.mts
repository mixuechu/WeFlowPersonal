import assert from 'node:assert/strict'
import test from 'node:test'
import { entityDossierDrilldown } from '../src/utils/entityDossierDrilldown.ts'

test('entity identity metrics map to exact identity groups', () => {
  assert.deepEqual(entityDossierDrilldown('aliases'), {
    sectionId: 'entity-dossier-identities',
    identityKind: 'alias'
  })
  assert.deepEqual(entityDossierDrilldown('wechat'), {
    sectionId: 'entity-dossier-identities',
    identityKind: 'wechat'
  })
  assert.deepEqual(entityDossierDrilldown('external'), {
    sectionId: 'entity-dossier-identities',
    identityKind: 'external'
  })
})

test('entity overview metrics map to authoritative dossier sections', () => {
  assert.deepEqual(entityDossierDrilldown('evidence'), {
    sectionId: 'entity-dossier-evidence',
    resetScope: 'evidence'
  })
  assert.deepEqual(entityDossierDrilldown('currentEvidence'), {
    sectionId: 'entity-dossier-evidence',
    resetScope: 'currentEvidence'
  })
  assert.deepEqual(entityDossierDrilldown('relationships'), {
    sectionId: 'entity-dossier-relations',
    resetScope: 'relationships'
  })
  assert.deepEqual(entityDossierDrilldown('claims'), {
    sectionId: 'entity-dossier-claims',
    resetScope: 'claims'
  })
  assert.deepEqual(entityDossierDrilldown('events'), {
    sectionId: 'entity-dossier-events',
    resetScope: 'events'
  })
  assert.deepEqual(entityDossierDrilldown('tasks'), {
    sectionId: 'entity-dossier-tasks'
  })
  assert.deepEqual(entityDossierDrilldown('pendingCommitments'), {
    sectionId: 'entity-dossier-events',
    eventPreset: 'pendingCommitments'
  })
})
