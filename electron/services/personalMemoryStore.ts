import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

type MemoryGraph = {
  entities: any[]
  relations: any[]
  reviewQueue: any[]
}

export class PersonalMemoryStore {
  private db: DatabaseSync | null = null

  initialize(databasePath: string): void {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(type, canonical_name);

      CREATE TABLE IF NOT EXISTS aliases (
        id INTEGER PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        alias_type TEXT NOT NULL DEFAULT 'name',
        confidence REAL NOT NULL DEFAULT 1,
        valid_from TEXT,
        valid_to TEXT,
        UNIQUE(entity_id, normalized_value, alias_type)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON aliases(normalized_value);

      CREATE TABLE IF NOT EXISTS identities (
        id INTEGER PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 1,
        valid_from TEXT,
        valid_to TEXT,
        UNIQUE(platform, account_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        subject_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        predicate TEXT NOT NULL,
        object_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        object_value TEXT,
        value_type TEXT NOT NULL DEFAULT 'text',
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        valid_from TEXT,
        valid_to TEXT,
        search_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_claims_subject_predicate ON claims(subject_id, predicate);

      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY,
        claim_id TEXT REFERENCES claims(id) ON DELETE CASCADE,
        relation_id TEXT,
        event_id TEXT,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        excerpt TEXT NOT NULL,
        evidence_role TEXT NOT NULL DEFAULT 'support',
        UNIQUE(message_id, claim_id, relation_id, event_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_evidence_message ON evidence(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        predicate TEXT NOT NULL,
        object_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        search_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relations_subject ON relations(subject_id, predicate);
      CREATE INDEX IF NOT EXISTS idx_relations_object ON relations(object_id, predicate);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_at TEXT,
        end_at TEXT,
        location TEXT,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        search_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS event_participants (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'participant',
        PRIMARY KEY(event_id, entity_id, role)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS review_queue (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS merge_history (
        id INTEGER PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reverted_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ingestion_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        entity_count INTEGER NOT NULL DEFAULT 0,
        relation_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '',
        prompt_version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        error TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS conversation_policy (
        session_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        session_type TEXT NOT NULL,
        analysis_enabled INTEGER NOT NULL,
        resume_policy TEXT NOT NULL DEFAULT 'from_now',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS search_documents (
        id TEXT PRIMARY KEY,
        document_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        search_text TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        embedding_model TEXT,
        embedding_dimensions INTEGER,
        embedding_json TEXT,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(document_type, source_id)
      ) STRICT;

      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        document_id UNINDEXED,
        title,
        search_text,
        tokenize='unicode61'
      );
    `)
    this.db.prepare(`
      INSERT INTO schema_meta(key, value, updated_at) VALUES('schema_version', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(new Date().toISOString())
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  syncGraph(graph: MemoryGraph): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const upsertEntity = this.db.prepare(`
        INSERT INTO entities(id,type,canonical_name,summary,confidence,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET type=excluded.type, canonical_name=excluded.canonical_name,
          summary=excluded.summary, confidence=excluded.confidence, updated_at=excluded.updated_at, deleted_at=NULL
      `)
      const insertAlias = this.db.prepare(`INSERT OR IGNORE INTO aliases(entity_id,value,normalized_value,alias_type,confidence) VALUES(?,?,?,?,?)`)
      const insertIdentity = this.db.prepare(`INSERT INTO identities(entity_id,platform,account_id,display_name,confidence) VALUES(?,?,?,?,?)
        ON CONFLICT(platform,account_id) DO UPDATE SET entity_id=excluded.entity_id, display_name=excluded.display_name, confidence=excluded.confidence`)
      for (const entity of graph.entities) {
        upsertEntity.run(entity.id, entity.type, entity.canonicalName, entity.summary || '', Number(entity.confidence || 0), entity.createdAt || now, entity.updatedAt || now)
        for (const alias of entity.aliases || []) insertAlias.run(entity.id, alias, String(alias).trim().toLowerCase(), 'name', 1)
        for (const accountId of entity.accountIds || []) insertIdentity.run(entity.id, 'wechat', accountId, entity.canonicalName, 1)
        this.upsertSearchDocument(`entity:${entity.id}`, 'entity', entity.id, entity.canonicalName,
          [entity.canonicalName, ...(entity.aliases || []), entity.summary || ''].join('；'),
          { entityType: entity.type, accountIds: entity.accountIds || [] }, now)
      }
      const entityNames = new Map(graph.entities.map(entity => [entity.id, entity.canonicalName]))
      const upsertRelation = this.db.prepare(`
        INSERT INTO relations(id,subject_id,predicate,object_id,confidence,status,search_text,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET confidence=excluded.confidence,status=excluded.status,
          search_text=excluded.search_text,updated_at=excluded.updated_at
      `)
      const insertEvidence = this.db.prepare(`INSERT OR IGNORE INTO evidence(relation_id,message_id,session_id,timestamp,excerpt) VALUES(?,?,?,?,?)`)
      for (const relation of graph.relations) {
        const searchText = `${entityNames.get(relation.subjectId) || relation.subjectId} ${relation.predicate} ${entityNames.get(relation.objectId) || relation.objectId}`
        upsertRelation.run(relation.id, relation.subjectId, relation.predicate, relation.objectId, Number(relation.confidence || 0), relation.status, searchText, relation.createdAt || now, relation.updatedAt || now)
        for (const evidence of relation.evidence || []) insertEvidence.run(relation.id, evidence.messageId, evidence.sessionId, Number(evidence.timestamp || 0), evidence.excerpt || '')
        this.upsertSearchDocument(`relation:${relation.id}`, 'relation', relation.id, relation.predicate, searchText,
          { subjectId: relation.subjectId, objectId: relation.objectId, status: relation.status }, now)
      }
      const upsertReview = this.db.prepare(`
        INSERT INTO review_queue(id,kind,title,detail,confidence,status,payload_json,created_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,confidence=excluded.confidence,
          status=excluded.status,payload_json=excluded.payload_json
      `)
      for (const review of graph.reviewQueue) {
        upsertReview.run(review.id, review.kind, review.title, review.detail || '', Number(review.confidence || 0), review.status, JSON.stringify(review), review.createdAt || now)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  searchText(query: string, limit = 20): any[] {
    if (!this.db || !query.trim()) return []
    return this.db.prepare(`
      SELECT d.*, bm25(search_fts) AS rank
      FROM search_fts JOIN search_documents d ON d.id = search_fts.document_id
      WHERE search_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(query.trim().replace(/["']/g, ' '), Math.max(1, Math.min(100, limit))) as any[]
  }

  getConversationPolicies(): Map<string, boolean> {
    if (!this.db) return new Map()
    const rows = this.db.prepare('SELECT session_id, analysis_enabled FROM conversation_policy').all() as Array<{ session_id: string; analysis_enabled: number }>
    return new Map(rows.map(row => [row.session_id, row.analysis_enabled === 1]))
  }

  setConversationPolicy(sessionId: string, displayName: string, sessionType: 'group' | 'private', enabled: boolean): void {
    if (!this.db) return
    this.db.prepare(`
      INSERT INTO conversation_policy(session_id,display_name,session_type,analysis_enabled,resume_policy,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET display_name=excluded.display_name,session_type=excluded.session_type,
        analysis_enabled=excluded.analysis_enabled,updated_at=excluded.updated_at
    `).run(sessionId, displayName, sessionType, enabled ? 1 : 0, 'from_now', new Date().toISOString())
  }

  private upsertSearchDocument(id: string, type: string, sourceId: string, title: string, searchText: string, metadata: any, now: string): void {
    if (!this.db) return
    const hash = Buffer.from(searchText).toString('base64').slice(0, 80)
    this.db.prepare(`
      INSERT INTO search_documents(id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,search_text=excluded.search_text,
        metadata_json=excluded.metadata_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at
    `).run(id, type, sourceId, title, searchText, JSON.stringify(metadata), hash, now)
    this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(id)
    this.db.prepare('INSERT INTO search_fts(document_id,title,search_text) VALUES(?,?,?)').run(id, title, searchText)
  }
}

export const personalMemoryStore = new PersonalMemoryStore()
