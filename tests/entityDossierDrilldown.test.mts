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

test('entity audit metrics map to their complete pageable ledgers', () => {
  assert.deepEqual(entityDossierDrilldown('relationHistory'), {
    sectionId: 'entity-dossier-relation-history'
  })
  assert.deepEqual(entityDossierDrilldown('entityCorrections'), {
    sectionId: 'entity-dossier-entity-corrections'
  })
  assert.deepEqual(entityDossierDrilldown('relationCorrections'), {
    sectionId: 'entity-dossier-relation-corrections'
  })
  assert.deepEqual(entityDossierDrilldown('profileCorrections'), {
    sectionId: 'entity-dossier-profile-corrections'
  })
})

test('entity candidate metrics map to exact review presets', () => {
  assert.deepEqual(entityDossierDrilldown('candidateClaims'), {
    sectionId: 'entity-dossier-claims',
    claimPreset: 'candidate'
  })
  assert.deepEqual(entityDossierDrilldown('candidateRelations'), {
    sectionId: 'entity-dossier-relations',
    relationPreset: 'candidate'
  })
  assert.deepEqual(entityDossierDrilldown('candidateEvents'), {
    sectionId: 'entity-dossier-events',
    eventPreset: 'candidate'
  })
})
