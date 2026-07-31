import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fuzzyEntityScore, pinyinEntityScore } from './fuzzyEntitySearch.ts'
import {
  LOCAL_ANN_DEFAULT_BITS,
  LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS,
  LOCAL_ANN_DEFAULT_TABLES,
  LOCAL_ANN_INDEX_VERSION,
  computeAnnSignatures,
  listMultiProbeSignatures
} from './localAnnIndex.ts'
import type { MemorySearchOptions } from './memorySearchFilters.ts'
import { MEMORY_CARD_EVIDENCE_LIMIT } from '../../shared/evidencePayload.ts'

type MemoryGraph = {
  entities: any[]
  relations: any[]
  reviewQueue: any[]
}

function sanitizeMemoryDeletionImpact(value: unknown): {
  evidence: number
  related: number
  searchDocuments: number
  assistantMessages: number
} {
  let parsed: any = {}
  try {
    parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value || {}
  } catch {}
  const boundedCount = (input: unknown) =>
    Math.max(0, Math.min(1_000_000_000, Math.floor(Number(input) || 0)))
  return {
    evidence: boundedCount(parsed.evidence),
    related: boundedCount(parsed.related),
    searchDocuments: boundedCount(parsed.searchDocuments),
    assistantMessages: boundedCount(parsed.assistantMessages)
  }
}

export class PersonalMemoryStore {
  private db: Database.Database | null = null
  private databasePath = ''
  private encryptionKey: Buffer | null = null
  private encryptionMigrated = false

  initialize(databasePath: string, encryptionKey?: Buffer | string): void {
    mkdirSync(dirname(databasePath), { recursive: true })
    try { chmodSync(dirname(databasePath), 0o700) } catch {}
    this.databasePath = databasePath
    if (encryptionKey !== undefined) {
      this.encryptionKey = Buffer.isBuffer(encryptionKey)
        ? Buffer.from(encryptionKey)
        : Buffer.from(String(encryptionKey), 'hex')
    }
    if (this.encryptionKey && this.encryptionKey.length !== 32) throw new Error('个人记忆数据库密钥长度无效')
    this.encryptionMigrated = false
    if (this.encryptionKey) this.prepareEncryptedDatabase(databasePath, this.encryptionKey)
    this.db = this.openDatabase(databasePath, false)
    try { chmodSync(databasePath, 0o600) } catch {}
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
        polarity TEXT NOT NULL DEFAULT 'positive',
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
        sender TEXT NOT NULL DEFAULT '',
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

      CREATE TABLE IF NOT EXISTS relation_history (
        id INTEGER PRIMARY KEY,
        relation_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_id TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        change_type TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relation_history_subject ON relation_history(subject_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_relation_history_object ON relation_history(object_id, created_at);
      INSERT INTO relation_history(
        relation_id,subject_id,predicate,object_id,status,confidence,change_type,snapshot_json,created_at
      )
      SELECT r.id,r.subject_id,r.predicate,r.object_id,r.status,r.confidence,'created','{}',r.created_at
      FROM relations r
      WHERE NOT EXISTS (SELECT 1 FROM relation_history h WHERE h.relation_id=r.id);

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
        source_nature TEXT NOT NULL DEFAULT 'inference',
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
        source_name TEXT NOT NULL DEFAULT '',
        target_name TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reverted_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_merge_history_activity
        ON merge_history(COALESCE(reverted_at,created_at) DESC,id DESC);

      CREATE TABLE IF NOT EXISTS identity_decisions (
        pair_key TEXT PRIMARY KEY,
        left_entity_id TEXT NOT NULL,
        right_entity_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        left_version INTEGER NOT NULL DEFAULT 1,
        right_version INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS memory_corrections (
        id INTEGER PRIMARY KEY,
        item_kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS entity_corrections (
        id INTEGER PRIMARY KEY,
        entity_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        before_name TEXT NOT NULL,
        after_name TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'review_correction',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_entity_corrections_entity ON entity_corrections(entity_id,created_at);

      CREATE TABLE IF NOT EXISTS relation_corrections (
        id INTEGER PRIMARY KEY,
        review_id TEXT NOT NULL,
        before_relation_id TEXT NOT NULL,
        after_relation_id TEXT NOT NULL,
        before_subject_id TEXT NOT NULL,
        before_predicate TEXT NOT NULL,
        before_object_id TEXT NOT NULL,
        after_subject_id TEXT NOT NULL,
        after_predicate TEXT NOT NULL,
        after_object_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relation_corrections_before ON relation_corrections(before_subject_id,before_object_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_relation_corrections_after ON relation_corrections(after_subject_id,after_object_id,created_at);

      CREATE TABLE IF NOT EXISTS entity_profile_corrections (
        id INTEGER PRIMARY KEY,
        entity_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        field TEXT NOT NULL,
        suggested_value TEXT NOT NULL,
        final_value TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_entity_profile_corrections_entity ON entity_profile_corrections(entity_id,created_at);

      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        field TEXT NOT NULL,
        before_value TEXT NOT NULL DEFAULT '',
        after_value TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id,created_at);

      CREATE TABLE IF NOT EXISTS task_directory (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        classification TEXT NOT NULL,
        priority TEXT NOT NULL,
        due TEXT,
        project TEXT NOT NULL DEFAULT '',
        task_kind TEXT NOT NULL DEFAULT 'action',
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        evidence_fingerprint TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_task_directory_status_updated
        ON task_directory(classification,status,updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_directory_project
        ON task_directory(project,updated_at);

      CREATE TABLE IF NOT EXISTS task_review_decisions (
        evidence_fingerprint TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('mine','rejected')),
        title TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        task_json TEXT NOT NULL DEFAULT '{}',
        suppression_count INTEGER NOT NULL DEFAULT 0,
        reconciliation_count INTEGER NOT NULL DEFAULT 0,
        last_suppressed_at TEXT,
        last_reconciled_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_task_review_decisions_updated ON task_review_decisions(updated_at);

      CREATE TABLE IF NOT EXISTS task_review_history (
        id INTEGER PRIMARY KEY,
        evidence_fingerprint TEXT NOT NULL,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('mine','rejected','revoked')),
        task_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_task_review_history_fingerprint
        ON task_review_history(evidence_fingerprint,created_at);

      CREATE TABLE IF NOT EXISTS assistant_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_assistant_conversations_updated
        ON assistant_conversations(updated_at DESC,id);
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_time
        ON assistant_messages(conversation_id,created_at DESC,id DESC);

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

      CREATE TABLE IF NOT EXISTS ingestion_batches (
        run_id TEXT NOT NULL,
        batch_index INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        model TEXT NOT NULL DEFAULT '',
        prompt_version TEXT NOT NULL DEFAULT '',
        schema_version TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(run_id,batch_index)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ingestion_batches_status ON ingestion_batches(status,started_at);

      CREATE TABLE IF NOT EXISTS ingestion_batch_commits (
        commit_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        batch_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        digest_json TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        checkpoint_keys_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        prepared_at TEXT NOT NULL,
        applied_at TEXT,
        recovery_attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        source_kind TEXT NOT NULL DEFAULT 'wechat',
        resource_id TEXT NOT NULL DEFAULT '',
        resource_content_hash TEXT NOT NULL DEFAULT '',
        completion_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ingestion_batch_commits_pending
        ON ingestion_batch_commits(status,prepared_at);

      CREATE TABLE IF NOT EXISTS processed_ingestion_messages (
        message_key TEXT PRIMARY KEY,
        commit_id TEXT NOT NULL,
        processed_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_processed_ingestion_messages_time
        ON processed_ingestion_messages(processed_at);

      CREATE TABLE IF NOT EXISTS conversation_policy (
        session_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        session_type TEXT NOT NULL,
        analysis_enabled INTEGER NOT NULL,
        resume_policy TEXT NOT NULL DEFAULT 'from_now',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS data_source_connectors (
        source_id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL DEFAULT 0,
        local_only INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        checkpoint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
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

      CREATE TABLE IF NOT EXISTS vector_ann_entries (
        document_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        table_id INTEGER NOT NULL,
        signature INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(document_id,model,table_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_vector_ann_bucket
        ON vector_ann_entries(model,dimensions,table_id,signature);

      CREATE TABLE IF NOT EXISTS vector_ann_state (
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        index_version TEXT NOT NULL,
        table_count INTEGER NOT NULL,
        bit_count INTEGER NOT NULL,
        indexed_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready',
        last_built_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(model,dimensions)
      ) STRICT;

      DROP TRIGGER IF EXISTS trg_search_documents_ann_content_update;
      CREATE TRIGGER trg_search_documents_ann_content_update
      AFTER UPDATE OF content_hash,embedding_model,embedding_dimensions,embedding_json ON search_documents
      WHEN OLD.content_hash IS NOT NEW.content_hash
        OR OLD.embedding_model IS NOT NEW.embedding_model
        OR OLD.embedding_dimensions IS NOT NEW.embedding_dimensions
        OR OLD.embedding_json IS NOT NEW.embedding_json
      BEGIN
        DELETE FROM vector_ann_entries WHERE document_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_search_documents_ann_delete
      AFTER DELETE ON search_documents
      BEGIN
        DELETE FROM vector_ann_entries WHERE document_id=OLD.id;
      END;

      CREATE TABLE IF NOT EXISTS memory_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        file_ext TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_memory_resources_type_updated
        ON memory_resources(resource_type, updated_at);

      CREATE TABLE IF NOT EXISTS resource_suppressions (
        resource_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT 'manual_delete',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS resource_trash (
        resource_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'manual_delete',
        deleted_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS memory_item_suppressions (
        item_kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        semantic_fingerprint TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT 'manual_delete',
        created_at TEXT NOT NULL,
        PRIMARY KEY(item_kind,item_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS memory_deletion_audit (
        id INTEGER PRIMARY KEY,
        item_kind TEXT NOT NULL,
        item_fingerprint TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'manual_delete',
        impact_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_memory_deletion_audit_created
        ON memory_deletion_audit(created_at DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        document_id UNINDEXED,
        title,
        search_text,
        tokenize='unicode61'
      );

      CREATE TABLE IF NOT EXISTS search_document_evidence (
        document_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL DEFAULT 0,
        sender TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(document_id,message_id)
      ) STRICT;
    `)
    this.ensureColumn('entities', 'identity_version', 'INTEGER NOT NULL DEFAULT 1')
    this.ensureColumn('entities', 'last_disambiguated_at', 'TEXT')
    this.ensureColumn('claims', 'source_nature', `TEXT NOT NULL DEFAULT 'inference'`)
    this.ensureColumn('claims', 'conflict_group', 'TEXT')
    this.ensureColumn('claims', 'polarity', `TEXT NOT NULL DEFAULT 'positive'`)
    this.ensureColumn('events', 'source_nature', `TEXT NOT NULL DEFAULT 'inference'`)
    this.ensureColumn('evidence', 'sender', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'model', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'prompt_version', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'schema_version', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'input_tokens', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'output_tokens', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'duration_ms', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'redaction_summary_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('ingestion_batches', 'evidence_validation_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('ingestion_batches', 'extraction_context_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('ingestion_runs', 'recovered_at', 'TEXT')
    this.ensureColumn('ingestion_runs', 'recovered_batch_count', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('ingestion_runs', 'interrupted_batch_count', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('ingestion_batch_commits', 'source_kind', `TEXT NOT NULL DEFAULT 'wechat'`)
    this.ensureColumn('ingestion_batch_commits', 'resource_id', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batch_commits', 'resource_content_hash', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batch_commits', 'completion_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('memory_item_suppressions', 'semantic_fingerprint', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('data_source_connectors', 'config_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('task_review_decisions', 'task_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('task_review_decisions', 'reconciliation_count', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('task_review_decisions', 'last_reconciled_at', 'TEXT')
    this.ensureColumn('task_review_decisions', 'revoked_at', 'TEXT')
    this.ensureColumn('task_directory', 'evidence_fingerprint', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('merge_history', 'source_name', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('merge_history', 'target_name', `TEXT NOT NULL DEFAULT ''`)
    this.repairStructuredEvidenceIdentity()
    this.backfillMergeHistoryNames()
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_corrections_item
      ON memory_corrections(item_kind,item_id,created_at DESC)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_item_suppressions_semantic
      ON memory_item_suppressions(item_kind,semantic_fingerprint)`)
    this.db.prepare(`UPDATE claims SET status='candidate' WHERE source_nature!='self_statement' AND status='confirmed'`).run()
    this.db.prepare(`
      UPDATE evidence SET evidence_role=CASE
        WHEN claim_id IS NOT NULL AND claim_id!='' AND EXISTS(
          SELECT 1 FROM claims WHERE claims.id=evidence.claim_id AND claims.source_nature='self_statement'
        ) THEN 'direct'
        WHEN claim_id IS NOT NULL AND claim_id!='' THEN 'indirect'
        ELSE 'direct'
      END
      WHERE evidence_role='support'
    `).run()
    this.repairDuplicateEvents()
    this.db.prepare(`
      INSERT INTO schema_meta(key, value, updated_at) VALUES('schema_version', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(new Date().toISOString())
    if (this.encryptionKey) this.encryptLegacyBackups()
  }

  private isPlaintextDatabase(path: string): boolean {
    if (!existsSync(path) || statSync(path).size < 16) return false
    return readFileSync(path).subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
  }

  private openDatabase(path: string, readonly: boolean): Database.Database {
    const db = new Database(path, { readonly, fileMustExist: readonly })
    if (this.encryptionKey) {
      db.pragma('cipher=sqlcipher')
      db.pragma('legacy=4')
      db.key(this.encryptionKey)
    }
    try {
      db.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get()
      return db
    } catch (error) {
      try { db.close() } catch {}
      throw error
    }
  }

  private verifyDatabase(path: string): void {
    const verification = this.openDatabase(path, true)
    try {
      const integrity = verification.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`数据库一致性检查失败：${String(integrity || 'unknown')}`)
    } finally {
      verification.close()
    }
  }

  private prepareEncryptedDatabase(path: string, key: Buffer): void {
    const temporary = `${path}.encrypting`
    const plaintextBackup = `${path}.plaintext-migration-backup`
    if (existsSync(plaintextBackup)) {
      if (!existsSync(path)) {
        renameSync(plaintextBackup, path)
      } else if (!this.isPlaintextDatabase(path)) {
        try {
          this.verifyDatabase(path)
          unlinkSync(plaintextBackup)
        } catch {
          const recovery = `${path}.recovery`
          copyFileSync(plaintextBackup, recovery)
          renameSync(recovery, path)
          unlinkSync(plaintextBackup)
        }
      } else {
        unlinkSync(plaintextBackup)
      }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (existsSync(`${temporary}${suffix}`)) unlinkSync(`${temporary}${suffix}`) } catch {}
    }
    if (!existsSync(path) || !this.isPlaintextDatabase(path)) return

    const plaintext = new Database(path)
    try {
      plaintext.pragma('wal_checkpoint(TRUNCATE)')
      const integrity = plaintext.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`明文数据库迁移前检查失败：${String(integrity || 'unknown')}`)
    } finally {
      plaintext.close()
    }
    copyFileSync(path, temporary)
    try { chmodSync(temporary, 0o600) } catch {}
    const migrating = new Database(temporary)
    try {
      migrating.pragma('cipher=sqlcipher')
      migrating.pragma('legacy=4')
      migrating.rekey(key)
    } finally {
      migrating.close()
    }
    if (this.isPlaintextDatabase(temporary)) throw new Error('数据库加密迁移失败：文件头仍为明文 SQLite')
    this.verifyDatabase(temporary)
    renameSync(path, plaintextBackup)
    try {
      renameSync(temporary, path)
      this.verifyDatabase(path)
      unlinkSync(plaintextBackup)
      for (const suffix of ['-wal', '-shm', '.encrypting-wal', '.encrypting-shm']) {
        try { unlinkSync(`${path}${suffix}`) } catch {}
      }
      this.encryptionMigrated = true
    } catch (error) {
      try { if (existsSync(path)) unlinkSync(path) } catch {}
      if (existsSync(plaintextBackup)) renameSync(plaintextBackup, path)
      throw error
    }
  }

  private encryptLegacyBackups(): void {
    if (!this.encryptionKey || !this.databasePath) return
    const backupDirectory = join(dirname(this.databasePath), 'personal-memory-backups')
    for (const backup of this.listBackups(backupDirectory)) {
      if (this.isPlaintextDatabase(backup.path)) this.prepareEncryptedDatabase(backup.path, this.encryptionKey)
      this.verifyDatabase(backup.path)
    }
  }

  getEncryptionMetadata(): any {
    return {
      enabled: Boolean(this.encryptionKey),
      cipher: this.encryptionKey ? 'sqlcipher' : 'none',
      keyFingerprint: this.encryptionKey
        ? createHash('sha256').update(this.encryptionKey).digest('hex').slice(0, 24)
        : null
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    if (!this.db) return
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  private repairStructuredEvidenceIdentity(): void {
    if (!this.db) return
    const migrationVersion = String((this.db.prepare(`
      SELECT value FROM schema_meta WHERE key='structured_evidence_identity_version'
    `).get() as any)?.value || '')
    let migrationAudit: any = {}
    try { migrationAudit = JSON.parse(migrationVersion) } catch {}
    const previousVersion = migrationVersion === '1'
      ? 1
      : Number(migrationAudit?.version || 0)
    const expectedIndexes = [
      { name: 'idx_evidence_claim_message', foreignKey: 'claim_id' },
      { name: 'idx_evidence_relation_message', foreignKey: 'relation_id' },
      { name: 'idx_evidence_event_message', foreignKey: 'event_id' }
    ]
    const constraintState = expectedIndexes.map(expected => {
      const index = this.db!.prepare(`
        SELECT name,"unique" AS is_unique,partial
        FROM pragma_index_list('evidence') WHERE name=?
      `).get(expected.name) as any
      const columns = index
        ? (this.db!.prepare(`PRAGMA index_info(${expected.name})`).all() as Array<{ name: string }>)
          .map(item => item.name)
        : []
      const sql = String((this.db!.prepare(`
        SELECT sql FROM sqlite_master WHERE type='index' AND name=?
      `).get(expected.name) as any)?.sql || '').toLowerCase().replace(/\s+/g, ' ')
      return Boolean(
        Number(index?.is_unique || 0) === 1
        && Number(index?.partial || 0) === 1
        && columns.length === 2
        && columns[0] === expected.foreignKey
        && columns[1] === 'message_id'
        && sql.includes(`where ${expected.foreignKey} is not null`)
      )
    })
    const constraintsHealthyBefore = constraintState.every(Boolean)
    if (previousVersion >= 2 && constraintsHealthyBefore) {
      if (migrationAudit?.driftDetectedThisStart) {
        const checkedAt = new Date().toISOString()
        this.db.prepare(`
          UPDATE schema_meta SET value=?,updated_at=?
          WHERE key='structured_evidence_identity_version'
        `).run(JSON.stringify({
          ...migrationAudit,
          constraintsHealthy: true,
          driftDetectedThisStart: false
        }), checkedAt)
      }
      return
    }
    const driftDetected = previousVersion >= 1 && !constraintsHealthyBefore
    const before = this.db.prepare(`
      SELECT COUNT(*) AS evidence_count,
        SUM(CASE WHEN sender!='' THEN 1 ELSE 0 END) AS sender_count
      FROM evidence
    `).get() as any
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_search_document_evidence_message
        ON search_document_evidence(session_id,message_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_claim_message_lookup
        ON evidence(claim_id,message_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_relation_message_lookup
        ON evidence(relation_id,message_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_event_message_lookup
        ON evidence(event_id,message_id);
    `)
    const transaction = this.db.transaction(() => {
      for (const expected of expectedIndexes) {
        this.db!.exec(`DROP INDEX IF EXISTS ${expected.name}`)
      }
      this.db!.exec(`
        UPDATE evidence
        SET sender=COALESCE((
          SELECT indexed_evidence.sender
          FROM search_document_evidence indexed_evidence
          WHERE indexed_evidence.session_id=evidence.session_id
            AND indexed_evidence.message_id=evidence.message_id
            AND indexed_evidence.sender!=''
          ORDER BY indexed_evidence.document_id
          LIMIT 1
        ),sender)
        WHERE sender='';
      `)
      for (const foreignKey of ['claim_id', 'relation_id', 'event_id']) {
        this.db!.exec(`
          UPDATE evidence AS keeper
          SET
            sender=COALESCE(NULLIF((
              SELECT duplicate.sender FROM evidence duplicate
              WHERE duplicate.${foreignKey}=keeper.${foreignKey}
                AND duplicate.message_id=keeper.message_id
                AND duplicate.sender!=''
              ORDER BY duplicate.id DESC LIMIT 1
            ),''),keeper.sender),
            excerpt=COALESCE(NULLIF((
              SELECT duplicate.excerpt FROM evidence duplicate
              WHERE duplicate.${foreignKey}=keeper.${foreignKey}
                AND duplicate.message_id=keeper.message_id
              ORDER BY length(duplicate.excerpt) DESC,duplicate.id DESC LIMIT 1
            ),''),keeper.excerpt),
            evidence_role=CASE
              WHEN EXISTS(
                SELECT 1 FROM evidence duplicate
                WHERE duplicate.${foreignKey}=keeper.${foreignKey}
                  AND duplicate.message_id=keeper.message_id
                  AND duplicate.evidence_role='contradiction'
              ) THEN 'contradiction'
              WHEN EXISTS(
                SELECT 1 FROM evidence duplicate
                WHERE duplicate.${foreignKey}=keeper.${foreignKey}
                  AND duplicate.message_id=keeper.message_id
                  AND duplicate.evidence_role='direct'
              ) THEN 'direct'
              WHEN EXISTS(
                SELECT 1 FROM evidence duplicate
                WHERE duplicate.${foreignKey}=keeper.${foreignKey}
                  AND duplicate.message_id=keeper.message_id
                  AND duplicate.evidence_role='indirect'
              ) THEN 'indirect'
              ELSE keeper.evidence_role
            END
          WHERE keeper.${foreignKey} IS NOT NULL
            AND keeper.id=(
              SELECT MIN(first.id) FROM evidence first
              WHERE first.${foreignKey}=keeper.${foreignKey}
                AND first.message_id=keeper.message_id
            );
          DELETE FROM evidence
          WHERE ${foreignKey} IS NOT NULL
            AND id NOT IN(
              SELECT MIN(id) FROM evidence
              WHERE ${foreignKey} IS NOT NULL
              GROUP BY ${foreignKey},message_id
            );
        `)
      }
      this.db!.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_claim_message
          ON evidence(claim_id,message_id) WHERE claim_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_relation_message
          ON evidence(relation_id,message_id) WHERE relation_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_event_message
          ON evidence(event_id,message_id) WHERE event_id IS NOT NULL;
        DROP INDEX IF EXISTS idx_evidence_claim_message_lookup;
        DROP INDEX IF EXISTS idx_evidence_relation_message_lookup;
        DROP INDEX IF EXISTS idx_evidence_event_message_lookup;
      `)
      const after = this.db!.prepare(`
        SELECT COUNT(*) AS evidence_count,
          SUM(CASE WHEN sender!='' THEN 1 ELSE 0 END) AS sender_count
        FROM evidence
      `).get() as any
      const migratedAt = new Date().toISOString()
      const previousDuplicatesRemoved = Number(migrationAudit?.duplicatesRemoved || 0)
      const previousSendersRecovered = Number(migrationAudit?.sendersRecovered || 0)
      const audit = {
        version: 2,
        migratedAt,
        evidenceBefore: Number(before?.evidence_count || 0),
        evidenceAfter: Number(after?.evidence_count || 0),
        duplicatesRemoved: previousDuplicatesRemoved + Math.max(
          0,
          Number(before?.evidence_count || 0) - Number(after?.evidence_count || 0)
        ),
        sendersBefore: Number(before?.sender_count || 0),
        sendersAfter: Number(after?.sender_count || 0),
        sendersRecovered: previousSendersRecovered + Math.max(
          0,
          Number(after?.sender_count || 0) - Number(before?.sender_count || 0)
        ),
        repairRuns: Math.max(0, Number(migrationAudit?.repairRuns || (previousVersion >= 1 ? 1 : 0))) + 1,
        constraintDriftRepairs: Math.max(0, Number(migrationAudit?.constraintDriftRepairs || 0))
          + (driftDetected ? 1 : 0),
        constraintsHealthy: true,
        driftDetectedThisStart: driftDetected
      }
      this.db!.prepare(`
        INSERT INTO schema_meta(key,value,updated_at) VALUES('structured_evidence_identity_version',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
      `).run(JSON.stringify(audit), migratedAt)
    })
    transaction()
  }

  private backfillMergeHistoryNames(): void {
    if (!this.db) return
    const rows = this.db.prepare(`
      SELECT id,snapshot_json FROM merge_history
      WHERE source_name='' OR target_name=''
    `).all() as Array<{ id: number; snapshot_json: string }>
    if (!rows.length) return
    const update = this.db.prepare(`
      UPDATE merge_history SET source_name=?,target_name=? WHERE id=?
    `)
    this.db.transaction(() => {
      for (const row of rows) {
        let snapshot: any = {}
        try { snapshot = JSON.parse(String(row.snapshot_json || '{}')) } catch {}
        update.run(
          String(snapshot?.source?.canonicalName || '').slice(0, 500),
          String(snapshot?.target?.canonicalName || '').slice(0, 500),
          row.id
        )
      }
    })()
  }

  private repairDuplicateEvents(): void {
    if (!this.db) return
    const rows = this.db.prepare(`
      SELECT e.message_id,ev.id,ev.title,ev.start_at
      FROM evidence e JOIN events ev ON ev.id=e.event_id
      WHERE e.event_id IS NOT NULL AND e.event_id!=''
      ORDER BY e.message_id
    `).all() as Array<{ message_id: string; id: string; title: string; start_at?: string }>
    const groups = new Map<string, typeof rows>()
    for (const row of rows) groups.set(row.message_id, [...(groups.get(row.message_id) || []), row])
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const candidates = [...group]
      while (candidates.length > 1) {
        const left = candidates.shift()!
        const rightIndex = candidates.findIndex(right => !left.start_at || !right.start_at || left.start_at === right.start_at)
        if (rightIndex < 0) continue
        const right = candidates.splice(rightIndex, 1)[0]
        const leftScore = (left.start_at ? 1000 : 0) + left.title.length
        const [target, source] = leftScore >= ((right.start_at ? 1000 : 0) + right.title.length) ? [left, right] : [right, left]
        this.db.prepare('INSERT OR IGNORE INTO event_participants(event_id,entity_id,role) SELECT ?,entity_id,role FROM event_participants WHERE event_id=?').run(target.id, source.id)
        this.db.prepare('UPDATE OR IGNORE evidence SET event_id=? WHERE event_id=?').run(target.id, source.id)
        this.db.prepare('DELETE FROM evidence WHERE event_id=?').run(source.id)
        this.db.prepare('DELETE FROM event_participants WHERE event_id=?').run(source.id)
        this.db.prepare('DELETE FROM events WHERE id=?').run(source.id)
        this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(`event:${source.id}`)
        this.db.prepare('DELETE FROM search_documents WHERE id=?').run(`event:${source.id}`)
      }
    }
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  getDiagnostics(): any {
    if (!this.db || !this.databasePath) return { healthy: false, integrity: 'not_initialized' }
    const integrityRows = this.db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
    const integrity = integrityRows.map(row => row.integrity_check).join('; ')
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL) AS entities,
        (SELECT COUNT(*) FROM relations WHERE status!='rejected') AS relations,
        (SELECT COUNT(*) FROM claims WHERE status!='rejected') AS claims,
        (SELECT COUNT(*) FROM events WHERE status!='rejected') AS events,
        (SELECT COUNT(*) FROM search_documents) AS searchDocuments,
        (SELECT COUNT(*) FROM evidence) AS evidence
    `).get() as any
    const backupDirectory = join(dirname(this.databasePath), 'personal-memory-backups')
    const backups = this.listBackups(backupDirectory)
    const structuredEvidenceMigration = (() => {
      const row = this.db!.prepare(`
        SELECT value,updated_at FROM schema_meta
        WHERE key='structured_evidence_identity_version'
      `).get() as any
      try {
        const audit = JSON.parse(String(row?.value || '{}'))
        return {
          version: Number(audit.version || 0),
          migratedAt: String(audit.migratedAt || row?.updated_at || ''),
          evidenceBefore: Number(audit.evidenceBefore || 0),
          evidenceAfter: Number(audit.evidenceAfter || 0),
          duplicatesRemoved: Number(audit.duplicatesRemoved || 0),
          sendersBefore: Number(audit.sendersBefore || 0),
          sendersAfter: Number(audit.sendersAfter || 0),
          sendersRecovered: Number(audit.sendersRecovered || 0),
          repairRuns: Number(audit.repairRuns || 0),
          constraintDriftRepairs: Number(audit.constraintDriftRepairs || 0),
          constraintsHealthy: audit.constraintsHealthy !== false,
          driftDetectedThisStart: Boolean(audit.driftDetectedThisStart)
        }
      } catch {
        return {
          version: String(row?.value || '') === '1' ? 1 : 0,
          migratedAt: String(row?.updated_at || ''),
          evidenceBefore: Number(counts.evidence || 0),
          evidenceAfter: Number(counts.evidence || 0),
          duplicatesRemoved: 0,
          sendersBefore: 0,
          sendersAfter: 0,
          sendersRecovered: 0,
          repairRuns: 0,
          constraintDriftRepairs: 0,
          constraintsHealthy: String(row?.value || '') === '1',
          driftDetectedThisStart: false
        }
      }
    })()
    return {
      healthy: integrity === 'ok',
      integrity,
      encryption: {
        enabled: Boolean(this.encryptionKey),
        cipher: this.encryptionKey ? String(this.db.pragma('cipher', { simple: true }) || '') : 'none',
        plaintextHeader: this.isPlaintextDatabase(this.databasePath),
        migratedThisStart: this.encryptionMigrated
      },
      databasePath: this.databasePath,
      databaseBytes: statSync(this.databasePath).size,
      counts,
      structuredEvidenceMigration,
      backups
    }
  }

  previewForgetEntity(entityId: string): any {
    if (!this.db) return null
    const entity = this.db.prepare('SELECT id,canonical_name FROM entities WHERE id=? AND deleted_at IS NULL').get(entityId) as any
    if (!entity) return null
    const aliases = this.db.prepare('SELECT value FROM aliases WHERE entity_id=?').all(entityId).map((item: any) => item.value)
    const identities = this.db.prepare('SELECT account_id,display_name FROM identities WHERE entity_id=?').all(entityId) as any[]
    const names = [...new Set([
      entity.canonical_name,
      ...aliases,
      ...identities.flatMap(item => [item.account_id, item.display_name])
    ].map(value => String(value || '').trim()).filter(Boolean))]
    const claims = this.db.prepare('SELECT id FROM claims WHERE subject_id=? OR object_entity_id=?').all(entityId, entityId) as any[]
    const relations = this.db.prepare('SELECT id FROM relations WHERE subject_id=? OR object_id=?').all(entityId, entityId) as any[]
    const events = this.db.prepare('SELECT DISTINCT event_id AS id FROM event_participants WHERE entity_id=?').all(entityId) as any[]
    return {
      entityId,
      canonicalName: entity.canonical_name,
      names,
      claimIds: claims.map(item => item.id),
      relationIds: relations.map(item => item.id),
      eventIds: events.map(item => item.id)
    }
  }

  recordEntityCorrection(
    entityId: string,
    reviewId: string,
    beforeName: string,
    afterName: string,
    reason = 'review_correction'
  ): void {
    if (!this.db || beforeName === afterName) return
    this.db.prepare(`
      INSERT INTO entity_corrections(entity_id,review_id,before_name,after_name,reason,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(entityId, reviewId, beforeName, afterName, reason, new Date().toISOString())
  }

  listEntityCorrections(entityId = '', limit = 300): any[] {
    if (!this.db) return []
    return entityId
      ? this.db.prepare('SELECT * FROM entity_corrections WHERE entity_id=? ORDER BY id DESC LIMIT ?').all(entityId, limit) as any[]
      : this.db.prepare('SELECT * FROM entity_corrections ORDER BY id DESC LIMIT ?').all(limit) as any[]
  }

  recordRelationCorrection(reviewId: string, before: any, after: any): void {
    if (!this.db || before.id === after.id) return
    this.db.prepare(`
      INSERT INTO relation_corrections(
        review_id,before_relation_id,after_relation_id,
        before_subject_id,before_predicate,before_object_id,
        after_subject_id,after_predicate,after_object_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      reviewId, before.id, after.id,
      before.subjectId, before.predicate, before.objectId,
      after.subjectId, after.predicate, after.objectId,
      new Date().toISOString()
    )
  }

  listRelationCorrections(entityId = '', limit = 300): any[] {
    if (!this.db) return []
    return entityId
      ? this.db.prepare(`
          SELECT * FROM relation_corrections
          WHERE before_subject_id=? OR before_object_id=? OR after_subject_id=? OR after_object_id=?
          ORDER BY id DESC LIMIT ?
        `).all(entityId, entityId, entityId, entityId, limit) as any[]
      : this.db.prepare('SELECT * FROM relation_corrections ORDER BY id DESC LIMIT ?').all(limit) as any[]
  }

  getRelationCorrectionByReview(reviewId: string): any | null {
    if (!this.db || !String(reviewId || '').trim()) return null
    return this.db.prepare(
      'SELECT * FROM relation_corrections WHERE review_id=? ORDER BY id DESC LIMIT 1'
    ).get(String(reviewId)) as any || null
  }

  recordEntityProfileCorrection(
    entityId: string,
    reviewId: string,
    field: 'summary' | 'alias',
    suggestedValue: string,
    finalValue: string
  ): void {
    if (!this.db || suggestedValue === finalValue) return
    this.db.prepare(`
      INSERT INTO entity_profile_corrections(entity_id,review_id,field,suggested_value,final_value,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(entityId, reviewId, field, suggestedValue, finalValue, new Date().toISOString())
  }

  listEntityProfileCorrections(entityId = '', limit = 300): any[] {
    if (!this.db) return []
    return entityId
      ? this.db.prepare('SELECT * FROM entity_profile_corrections WHERE entity_id=? ORDER BY id DESC LIMIT ?').all(entityId, limit) as any[]
      : this.db.prepare('SELECT * FROM entity_profile_corrections ORDER BY id DESC LIMIT ?').all(limit) as any[]
  }

  forgetEntity(entityId: string, taskIds: string[] = []): any {
    if (!this.db) return null
    const preview = this.previewForgetEntity(entityId)
    if (!preview) return null
    const documentIds = [
      `entity:${entityId}`,
      ...preview.claimIds.map((id: string) => `claim:${id}`),
      ...preview.relationIds.map((id: string) => `relation:${id}`),
      ...preview.eventIds.map((id: string) => `event:${id}`),
      ...taskIds.map(id => `task:${id}`)
    ]
    const deleteIds = (table: string, column: string, ids: string[]) => {
      if (!ids.length) return
      this.db!.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`).run(...ids)
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      deleteIds('search_fts', 'document_id', documentIds)
      deleteIds('search_documents', 'id', documentIds)
      deleteIds('search_document_evidence', 'document_id', documentIds)
      deleteIds('evidence', 'relation_id', preview.relationIds)
      this.db.prepare('DELETE FROM relation_history WHERE subject_id=? OR object_id=?').run(entityId, entityId)
      deleteIds('events', 'id', preview.eventIds)
      deleteIds('task_history', 'task_id', taskIds)
      deleteIds('task_review_decisions', 'task_id', taskIds)
      deleteIds('task_review_history', 'task_id', taskIds)
      this.db.prepare('DELETE FROM review_queue WHERE payload_json LIKE ?').run(`%${entityId}%`)
      this.db.prepare('DELETE FROM merge_history WHERE source_entity_id=? OR target_entity_id=?').run(entityId, entityId)
      this.db.prepare('DELETE FROM identity_decisions WHERE left_entity_id=? OR right_entity_id=?').run(entityId, entityId)
      this.db.prepare('DELETE FROM entity_corrections WHERE entity_id=?').run(entityId)
      this.db.prepare(`
        DELETE FROM relation_corrections
        WHERE before_subject_id=? OR before_object_id=? OR after_subject_id=? OR after_object_id=?
      `).run(entityId, entityId, entityId, entityId)
      this.db.prepare('DELETE FROM entity_profile_corrections WHERE entity_id=?').run(entityId)
      for (const name of preview.names) {
        const pattern = `%${name.replace(/[%_]/g, value => `\\${value}`)}%`
        this.db.prepare(`DELETE FROM assistant_messages
          WHERE content LIKE ? ESCAPE '\\' OR citations_json LIKE ? ESCAPE '\\'`).run(pattern, pattern)
        this.db.prepare(`DELETE FROM memory_corrections
          WHERE before_json LIKE ? ESCAPE '\\' OR after_json LIKE ? ESCAPE '\\'`).run(pattern, pattern)
      }
      this.db.prepare('DELETE FROM assistant_conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM assistant_messages)').run()
      this.db.prepare('DELETE FROM entities WHERE id=?').run(entityId)
      this.db.exec('COMMIT')
      return {
        success: true,
        canonicalName: preview.canonicalName,
        removed: {
          claims: preview.claimIds.length,
          relations: preview.relationIds.length,
          events: preview.eventIds.length,
          tasks: taskIds.length,
          searchDocuments: documentIds.length
        }
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  createBackup(): any {
    if (!this.db || !this.databasePath) throw new Error('个人记忆数据库尚未初始化')
    const diagnostics = this.getDiagnostics()
    if (!diagnostics.healthy) throw new Error(`数据库一致性检查失败：${diagnostics.integrity}`)
    const backupDirectory = join(dirname(this.databasePath), 'personal-memory-backups')
    mkdirSync(backupDirectory, { recursive: true })
    try { chmodSync(backupDirectory, 0o700) } catch {}
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(backupDirectory, `personal-memory-${timestamp}.sqlite`)
    const escapedPath = backupPath.replace(/'/g, "''")
    this.db.exec(`VACUUM INTO '${escapedPath}'`)
    try { chmodSync(backupPath, 0o600) } catch {}
    this.verifyDatabase(backupPath)
    if (this.encryptionKey && this.isPlaintextDatabase(backupPath)) throw new Error('备份验证失败：快照未加密')
    const backups = this.listBackups(backupDirectory)
    for (const stale of backups.slice(10)) {
      unlinkSync(stale.path)
      try { unlinkSync(`${stale.path}.state.json`) } catch {}
    }
    return {
      success: true,
      path: backupPath,
      bytes: statSync(backupPath).size,
      createdAt: new Date().toISOString(),
      retained: Math.min(backups.length, 10)
    }
  }

  restoreBackup(backupPath: string): any {
    if (!this.db || !this.databasePath) throw new Error('个人记忆数据库尚未初始化')
    const backupDirectory = join(dirname(this.databasePath), 'personal-memory-backups')
    const allowed = this.listBackups(backupDirectory).find(item => resolve(item.path) === resolve(String(backupPath || '')))
    if (!allowed) throw new Error('只能恢复由本应用创建的个人记忆快照')
    this.verifyDatabase(allowed.path)
    const safetyBackup = this.createBackup()
    const temporary = `${this.databasePath}.restore-${Date.now()}.tmp`
    this.db.close()
    this.db = null
    try {
      copyFileSync(allowed.path, temporary)
      renameSync(temporary, this.databasePath)
      this.initialize(this.databasePath)
      const diagnostics = this.getDiagnostics()
      if (!diagnostics.healthy) throw new Error(`恢复后的数据库验证失败：${diagnostics.integrity}`)
      return { success: true, restoredFrom: allowed.path, safetyBackup: safetyBackup.path, diagnostics }
    } catch (error) {
      try { this.db?.close() } catch {}
      this.db = null
      try {
        copyFileSync(safetyBackup.path, temporary)
        renameSync(temporary, this.databasePath)
      } catch {}
      this.initialize(this.databasePath)
      throw error
    }
  }

  registerImportedBackup(
    databaseBytes: Uint8Array,
    stateText: string,
    sourceEncryptionKey?: Buffer | string,
    storedStateText?: string
  ): any {
    if (!this.db || !this.databasePath) throw new Error('个人记忆数据库尚未初始化')
    JSON.parse(stateText)
    const backupDirectory = join(dirname(this.databasePath), 'personal-memory-backups')
    mkdirSync(backupDirectory, { recursive: true })
    try { chmodSync(backupDirectory, 0o700) } catch {}
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(backupDirectory, `personal-memory-imported-${timestamp}.sqlite`)
    const temporary = `${backupPath}.tmp`
    writeFileSync(temporary, databaseBytes)
    const sourceKey = sourceEncryptionKey === undefined
      ? null
      : Buffer.isBuffer(sourceEncryptionKey)
        ? Buffer.from(sourceEncryptionKey)
        : Buffer.from(String(sourceEncryptionKey), 'hex')
    if (sourceKey && sourceKey.length !== 32) {
      try { unlinkSync(temporary) } catch {}
      throw new Error('迁移包中的数据库密钥无效')
    }
    try {
      if (sourceKey && !this.isPlaintextDatabase(temporary)) {
        const imported = new Database(temporary)
        try {
          imported.pragma('cipher=sqlcipher')
          imported.pragma('legacy=4')
          imported.key(sourceKey)
          const integrity = imported.pragma('integrity_check', { simple: true })
          if (integrity !== 'ok') throw new Error('迁移包数据库一致性检查失败')
          if (!this.encryptionKey) throw new Error('当前个人记忆库没有可用的目标加密密钥')
          imported.rekey(this.encryptionKey)
        } finally {
          sourceKey.fill(0)
          imported.close()
        }
      } else if (this.encryptionKey && this.isPlaintextDatabase(temporary)) {
        this.prepareEncryptedDatabase(temporary, this.encryptionKey)
      }
      this.verifyDatabase(temporary)
      renameSync(temporary, backupPath)
      writeFileSync(`${backupPath}.state.json`, storedStateText || stateText, 'utf8')
      try {
        chmodSync(backupPath, 0o600)
        chmodSync(`${backupPath}.state.json`, 0o600)
      } catch {}
      return { path: backupPath, bytes: statSync(backupPath).size, createdAt: new Date().toISOString(), hasState: true }
    } catch (error) {
      try { unlinkSync(temporary) } catch {}
      throw error
    }
  }

  private listBackups(backupDirectory: string): Array<{ path: string; name: string; bytes: number; createdAt: string; hasState: boolean }> {
    try {
      return readdirSync(backupDirectory)
        .filter(name => /^personal-memory-.*\.sqlite$/.test(name))
        .map(name => {
          const path = join(backupDirectory, name)
          const stat = statSync(path)
          return { path, name, bytes: stat.size, createdAt: stat.mtime.toISOString(), hasState: existsSync(`${path}.state.json`) }
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    } catch {
      return []
    }
  }

  getFilePermissionAudit(): any {
    const mode = (path: string): string | null => {
      try { return (statSync(path).mode & 0o777).toString(8).padStart(3, '0') } catch { return null }
    }
    const databaseMode = this.databasePath ? mode(this.databasePath) : null
    const backupDirectory = this.databasePath ? join(dirname(this.databasePath), 'personal-memory-backups') : ''
    const backupDirectoryMode = backupDirectory ? mode(backupDirectory) : null
    return {
      databaseMode,
      backupDirectoryMode,
      secure: databaseMode === '600' && (!backupDirectoryMode || backupDirectoryMode === '700')
    }
  }

  syncGraph(graph: MemoryGraph): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const activeEntityIds = new Set(graph.entities.map(entity => entity.id))
      const storedEntityIds = this.db.prepare('SELECT id FROM entities WHERE deleted_at IS NULL').all() as Array<{ id: string }>
      for (const { id } of storedEntityIds) {
        if (activeEntityIds.has(id)) continue
        this.db.prepare('UPDATE entities SET deleted_at=? WHERE id=?').run(now, id)
        this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(`entity:${id}`)
        this.db.prepare('DELETE FROM search_documents WHERE id=?').run(`entity:${id}`)
      }
      const allowedRelations = graph.relations.filter(relation =>
        !this.isMemoryItemSuppressed('relation', relation.id, this.memoryItemSemanticFingerprint('relation', relation)))
      const activeRelationIds = new Set(allowedRelations.map(relation => relation.id))
      const storedRelationIds = this.db.prepare('SELECT id FROM relations').all() as Array<{ id: string }>
      for (const { id } of storedRelationIds) {
        if (activeRelationIds.has(id)) continue
        this.db.prepare('DELETE FROM evidence WHERE relation_id=?').run(id)
        this.db.prepare('DELETE FROM relations WHERE id=?').run(id)
        this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(`relation:${id}`)
        this.db.prepare('DELETE FROM search_documents WHERE id=?').run(`relation:${id}`)
      }
      const upsertEntity = this.db.prepare(`
        INSERT INTO entities(id,type,canonical_name,summary,confidence,created_at,updated_at,identity_version,last_disambiguated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET type=excluded.type, canonical_name=excluded.canonical_name,
          summary=excluded.summary, confidence=excluded.confidence, updated_at=excluded.updated_at,
          identity_version=excluded.identity_version,last_disambiguated_at=excluded.last_disambiguated_at,deleted_at=NULL
      `)
      const insertAlias = this.db.prepare(`INSERT OR IGNORE INTO aliases(entity_id,value,normalized_value,alias_type,confidence) VALUES(?,?,?,?,?)`)
      const deleteAliases = this.db.prepare('DELETE FROM aliases WHERE entity_id=?')
      const insertIdentity = this.db.prepare(`INSERT INTO identities(entity_id,platform,account_id,display_name,confidence) VALUES(?,?,?,?,?)
        ON CONFLICT(platform,account_id) DO UPDATE SET entity_id=excluded.entity_id, display_name=excluded.display_name, confidence=excluded.confidence`)
      const deleteIdentities = this.db.prepare('DELETE FROM identities WHERE entity_id=?')
      for (const entity of graph.entities) {
        const trustedSummary = entity.summaryStatus === 'confirmed' ? (entity.summary || '') : ''
        upsertEntity.run(entity.id, entity.type, entity.canonicalName, trustedSummary, Number(entity.confidence || 0), entity.createdAt || now, entity.updatedAt || now, Number(entity.identityVersion || 1), entity.lastDisambiguatedAt || null)
        deleteAliases.run(entity.id)
        deleteIdentities.run(entity.id)
        for (const alias of entity.aliases || []) insertAlias.run(entity.id, alias, String(alias).trim().toLowerCase(), 'name', 1)
        for (const accountId of entity.accountIds || []) insertIdentity.run(entity.id, 'wechat', accountId, entity.canonicalName, 1)
        for (const identity of entity.externalIdentities || []) {
          const platform = String(identity.platform || '').trim().toLowerCase()
          const accountId = String(identity.accountId || '').trim()
          if (!platform || !accountId || platform === 'wechat') continue
          insertIdentity.run(
            entity.id,
            platform,
            accountId,
            String(identity.displayName || entity.canonicalName),
            Math.max(0, Math.min(1, Number(identity.confidence ?? 1)))
          )
        }
        if (entity.trustStatus === 'confirmed') this.upsertSearchDocument(`entity:${entity.id}`, 'entity', entity.id, entity.canonicalName,
          [
            entity.canonicalName,
            ...(entity.aliases || []),
            ...(entity.accountIds || []),
            ...(entity.externalIdentities || []).flatMap((identity: any) => [identity.accountId, identity.displayName]),
            trustedSummary
          ].join('；'),
          {
            entityType: entity.type,
            accountIds: entity.accountIds || [],
            externalIdentities: entity.externalIdentities || [],
            summaryStatus: entity.summaryStatus || (entity.summary ? 'legacy_unverified' : 'empty')
          }, now)
        else {
          this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(`entity:${entity.id}`)
          this.db.prepare('DELETE FROM search_documents WHERE id=?').run(`entity:${entity.id}`)
        }
      }
      const entityNames = new Map(graph.entities.map(entity => [entity.id, entity.canonicalName]))
      const upsertRelation = this.db.prepare(`
        INSERT INTO relations(id,subject_id,predicate,object_id,confidence,status,search_text,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET confidence=excluded.confidence,status=excluded.status,
          search_text=excluded.search_text,updated_at=excluded.updated_at
      `)
      const getStoredRelation = this.db.prepare('SELECT * FROM relations WHERE id=?')
      const insertRelationHistory = this.db.prepare(`
        INSERT INTO relation_history(relation_id,subject_id,predicate,object_id,status,confidence,change_type,snapshot_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)
      `)
      const insertEvidence = this.db.prepare(`
        INSERT OR IGNORE INTO evidence(relation_id,message_id,session_id,timestamp,sender,excerpt,evidence_role)
        VALUES(?,?,?,?,?,?,'direct')
      `)
      const enrichEvidenceSender = this.db.prepare(`
        UPDATE evidence SET sender=CASE WHEN ?!='' THEN ? ELSE sender END
        WHERE relation_id=? AND message_id=?
      `)
      for (const relation of allowedRelations) {
        const searchText = `${entityNames.get(relation.subjectId) || relation.subjectId} ${relation.predicate} ${entityNames.get(relation.objectId) || relation.objectId}`
        const stored = getStoredRelation.get(relation.id) as any
        const nextSnapshot = {
          subjectId: relation.subjectId,
          predicate: relation.predicate,
          objectId: relation.objectId,
          confidence: Number(relation.confidence || 0),
          status: relation.status,
          evidenceCount: (relation.evidence || []).length
        }
        const changed = !stored || stored.subject_id !== relation.subjectId || stored.predicate !== relation.predicate ||
          stored.object_id !== relation.objectId || stored.status !== relation.status ||
          Math.abs(Number(stored.confidence || 0) - nextSnapshot.confidence) >= 0.01
        if (changed) {
          insertRelationHistory.run(
            relation.id, relation.subjectId, relation.predicate, relation.objectId, relation.status,
            nextSnapshot.confidence, stored ? (stored.status !== relation.status ? 'status_changed' : 'evidence_updated') : 'created',
            JSON.stringify(nextSnapshot), relation.updatedAt || now
          )
        }
        upsertRelation.run(relation.id, relation.subjectId, relation.predicate, relation.objectId, Number(relation.confidence || 0), relation.status, searchText, relation.createdAt || now, relation.updatedAt || now)
        for (const evidence of relation.evidence || []) {
          const sender = String(evidence.sender || '')
          insertEvidence.run(
            relation.id, evidence.messageId, evidence.sessionId,
            Number(evidence.timestamp || 0), sender, evidence.excerpt || ''
          )
          enrichEvidenceSender.run(sender, sender, relation.id, evidence.messageId)
        }
        this.upsertSearchDocument(`relation:${relation.id}`, 'relation', relation.id, relation.predicate, searchText,
          { subjectId: relation.subjectId, objectId: relation.objectId, predicate: relation.predicate, status: relation.status }, now)
      }
      const upsertReview = this.db.prepare(`
        INSERT INTO review_queue(id,kind,title,detail,confidence,status,payload_json,created_at,resolved_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,confidence=excluded.confidence,
          status=excluded.status,payload_json=excluded.payload_json,resolved_at=excluded.resolved_at
      `)
      const activeReviewIds = new Set(graph.reviewQueue.map(review => review.id))
      const storedPendingReviewIds = this.db.prepare(
        `SELECT id FROM review_queue WHERE status='pending'`
      ).all() as Array<{ id: string }>
      const deletePendingReview = this.db.prepare(`DELETE FROM review_queue WHERE id=? AND status='pending'`)
      for (const { id } of storedPendingReviewIds) {
        if (!activeReviewIds.has(id)) deletePendingReview.run(id)
      }
      for (const review of graph.reviewQueue) {
        if (review.kind === 'relation' && review.relationId && this.isMemoryItemSuppressed('relation', review.relationId)) continue
        upsertReview.run(
          review.id, review.kind, review.title, review.detail || '', Number(review.confidence || 0),
          review.status, JSON.stringify(review), review.createdAt || now, review.resolvedAt || null
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listRelationHistory(entityId = '', limit = 200): any[] {
    if (!this.db) return []
    const rows = entityId
      ? this.db.prepare(`
          SELECT h.*,subject.canonical_name AS subject_name,object.canonical_name AS object_name
          FROM relation_history h
          LEFT JOIN entities subject ON subject.id=h.subject_id
          LEFT JOIN entities object ON object.id=h.object_id
          WHERE h.subject_id=? OR h.object_id=?
          ORDER BY h.id DESC LIMIT ?
        `).all(entityId, entityId, limit)
      : this.db.prepare(`
          SELECT h.*,subject.canonical_name AS subject_name,object.canonical_name AS object_name
          FROM relation_history h
          LEFT JOIN entities subject ON subject.id=h.subject_id
          LEFT JOIN entities object ON object.id=h.object_id
          ORDER BY h.id DESC LIMIT ?
        `).all(limit)
    return rows as any[]
  }

  listReviewLedger(limit = 300): any[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT id,kind,title,detail,confidence,status,payload_json,created_at,resolved_at
      FROM review_queue ORDER BY COALESCE(resolved_at,created_at) DESC LIMIT ?
    `).all(limit) as any[]).map(row => {
      let payload: any = {}
      try { payload = JSON.parse(String(row.payload_json || '{}')) } catch {}
      return { ...row, payload }
    })
  }

  listReviewLedgerPage(options?: {
    status?: 'pending' | 'resolved' | 'all'
    kind?: string
    query?: string
    offset?: number
    limit?: number
  }): {
    items: any[]
    offset: number
    limit: number
    total: number
    hasMore: boolean
    counts: { pending: number; resolved: number; all: number }
  } {
    if (!this.db) return {
      items: [], offset: 0, limit: 40, total: 0, hasMore: false,
      counts: { pending: 0, resolved: 0, all: 0 }
    }
    const status = options?.status === 'resolved' || options?.status === 'all'
      ? options.status
      : 'pending'
    const kind = String(options?.kind || '').trim()
    const query = String(options?.query || '').trim().toLocaleLowerCase('zh-CN')
    const offset = Math.max(0, Math.min(100_000, Math.floor(Number(options?.offset) || 0)))
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options?.limit) || 40)))
    const scopeSql = `
      FROM review_queue
      WHERE (?='' OR kind=?)
        AND (?='' OR instr(lower(title || char(0) || detail || char(0) || payload_json), ?) > 0)
    `
    const scopeParams = [kind, kind, query, query]
    const countRows = this.db.prepare(`
      SELECT CASE WHEN status='pending' THEN 'pending' ELSE 'resolved' END AS bucket, COUNT(*) AS count
      ${scopeSql}
      GROUP BY bucket
    `).all(...scopeParams) as Array<{ bucket: 'pending' | 'resolved'; count: number }>
    const pending = Number(countRows.find(row => row.bucket === 'pending')?.count || 0)
    const resolved = Number(countRows.find(row => row.bucket === 'resolved')?.count || 0)
    const statusSql = status === 'all'
      ? ''
      : status === 'pending'
        ? ` AND status='pending'`
        : ` AND status<>'pending'`
    const total = status === 'all' ? pending + resolved : status === 'pending' ? pending : resolved
    const rows = this.db.prepare(`
      SELECT id,kind,title,detail,confidence,status,payload_json,created_at,resolved_at
      ${scopeSql}${statusSql}
      ORDER BY COALESCE(resolved_at,created_at) DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...scopeParams, limit, offset) as any[]
    const items = rows.map(row => {
      let payload: any = {}
      try { payload = JSON.parse(String(row.payload_json || '{}')) } catch {}
      return {
        ...payload,
        id: row.id,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        confidence: row.confidence,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at || payload.resolvedAt
      }
    })
    return {
      items,
      offset,
      limit,
      total,
      hasMore: offset + items.length < total,
      counts: { pending, resolved, all: pending + resolved }
    }
  }

  private pairKey(leftId: string, rightId: string): string {
    return [leftId, rightId].sort().join('|')
  }

  getIdentityDecision(leftId: string, rightId: string): any | null {
    return this.db?.prepare('SELECT * FROM identity_decisions WHERE pair_key=?').get(this.pairKey(leftId, rightId)) || null
  }

  recordIdentityDecision(leftId: string, rightId: string, decision: 'merged' | 'different', leftVersion: number, rightVersion: number, reason = ''): void {
    if (!this.db) return
    const now = new Date().toISOString()
    const ordered = leftId <= rightId
      ? { leftId, rightId, leftVersion, rightVersion }
      : { leftId: rightId, rightId: leftId, leftVersion: rightVersion, rightVersion: leftVersion }
    this.db.prepare(`
      INSERT INTO identity_decisions(pair_key,left_entity_id,right_entity_id,decision,left_version,right_version,reason,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pair_key) DO UPDATE SET decision=excluded.decision,left_version=excluded.left_version,
        right_version=excluded.right_version,reason=excluded.reason,updated_at=excluded.updated_at
    `).run(this.pairKey(leftId, rightId), ordered.leftId, ordered.rightId, decision, ordered.leftVersion, ordered.rightVersion, reason, now, now)
  }

  recordMerge(sourceId: string, targetId: string, snapshot: any): number {
    if (!this.db) return 0
    const result = this.db.prepare(`
      INSERT INTO merge_history(
        source_entity_id,target_entity_id,source_name,target_name,snapshot_json,created_at
      ) VALUES(?,?,?,?,?,?)
    `).run(
      sourceId,
      targetId,
      String(snapshot?.source?.canonicalName || '').slice(0, 500),
      String(snapshot?.target?.canonicalName || '').slice(0, 500),
      JSON.stringify(snapshot),
      new Date().toISOString()
    )
    return Number(result.lastInsertRowid)
  }

  listActiveMergeTargetIds(): string[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT DISTINCT target_entity_id FROM merge_history
      WHERE reverted_at IS NULL ORDER BY target_entity_id
    `).all() as Array<{ target_entity_id: string }>)
      .map(row => String(row.target_entity_id || ''))
      .filter(Boolean)
  }

  listMergeHistoryPage(options: {
    status?: 'active' | 'reverted' | 'all'
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): {
    items: any[]
    total: number
    hasMore: boolean
    counts: { active: number; reverted: number; all: number }
  } {
    const emptyCounts = { active: 0, reverted: 0, all: 0 }
    if (!this.db) return { items: [], total: 0, hasMore: false, counts: emptyCounts }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (options.status === 'active') conditions.push('reverted_at IS NULL')
    if (options.status === 'reverted') conditions.push('reverted_at IS NOT NULL')
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`instr(lower(
        source_name || char(0) || target_name || char(0) ||
        source_entity_id || char(0) || target_entity_id
      ),?)>0`)
      parameters.push(query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('COALESCE(reverted_at,created_at)>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('COALESCE(reverted_at,created_at)<=?')
      parameters.push(to)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM merge_history ${where}
    `).get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT id,source_entity_id,target_entity_id,source_name,target_name,created_at,reverted_at
      FROM merge_history
      ${where}
      ORDER BY COALESCE(reverted_at,created_at) DESC,id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const countsRow = this.db.prepare(`
      SELECT
        SUM(CASE WHEN reverted_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN reverted_at IS NOT NULL THEN 1 ELSE 0 END) AS reverted,
        COUNT(*) AS all_count
      FROM merge_history
    `).get() as any
    return {
      items: rows.map(row => ({ ...row, canRevert: !row.reverted_at })),
      total,
      hasMore: offset + rows.length < total,
      counts: {
        active: Number(countsRow?.active || 0),
        reverted: Number(countsRow?.reverted || 0),
        all: Number(countsRow?.all_count || 0)
      }
    }
  }

  getMergeHistoryArchiveStats(): {
    total: number
    active: number
    reverted: number
    latestId: number
    latestActivityAt: string
  } {
    if (!this.db) {
      return { total: 0, active: 0, reverted: 0, latestId: 0, latestActivityAt: '' }
    }
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN reverted_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN reverted_at IS NOT NULL THEN 1 ELSE 0 END) AS reverted,
        COALESCE(MAX(id),0) AS latest_id,
        COALESCE(MAX(COALESCE(reverted_at,created_at)),'') AS latest_activity_at
      FROM merge_history
    `).get() as any
    return {
      total: Number(row?.total || 0),
      active: Number(row?.active || 0),
      reverted: Number(row?.reverted || 0),
      latestId: Number(row?.latest_id || 0),
      latestActivityAt: String(row?.latest_activity_at || '')
    }
  }

  upsertClaims(claims: any[]): void {
    if (!this.db || !claims.length) return
    const now = new Date().toISOString()
    const upsert = this.db.prepare(`
      INSERT INTO claims(id,subject_id,predicate,object_entity_id,object_value,polarity,value_type,confidence,status,valid_from,valid_to,search_text,created_at,updated_at,source_nature,conflict_group)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET confidence=MAX(confidence,excluded.confidence),status=excluded.status,
        valid_from=COALESCE(excluded.valid_from,valid_from),valid_to=COALESCE(excluded.valid_to,valid_to),
        polarity=excluded.polarity,search_text=excluded.search_text,updated_at=excluded.updated_at,source_nature=excluded.source_nature,
        conflict_group=COALESCE(excluded.conflict_group,conflict_group)
    `)
    const evidence = this.db.prepare(`
      INSERT OR IGNORE INTO evidence(claim_id,message_id,session_id,timestamp,sender,excerpt,evidence_role)
      VALUES(?,?,?,?,?,?,?)
    `)
    const enrichEvidenceSender = this.db.prepare(`
      UPDATE evidence SET sender=CASE WHEN ?!='' THEN ? ELSE sender END
      WHERE claim_id=? AND message_id=?
    `)
    for (const claim of claims) {
      if (this.isMemoryItemSuppressed('claim', claim.id, this.memoryItemSemanticFingerprint('claim', claim))) continue
      const sourceNature = claim.sourceNature || 'inference'
      const manuallyCorrected = Boolean(this.db.prepare(`
        SELECT 1 FROM memory_corrections WHERE item_kind='claim' AND item_id=? LIMIT 1
      `).get(claim.id))
      if (manuallyCorrected) {
        for (const item of claim.evidence || []) {
          const evidenceRole = item.role && item.role !== 'support'
            ? item.role
            : sourceNature === 'self_statement' ? 'direct' : 'indirect'
          const sender = String(item.sender || '')
          evidence.run(claim.id, item.messageId, item.sessionId, item.timestamp, sender, item.excerpt, evidenceRole)
          enrichEvidenceSender.run(sender, sender, claim.id, item.messageId)
        }
        continue
      }
      const existingValues = this.db.prepare(`
        SELECT id,COALESCE(object_entity_id,object_value,'') AS value,polarity,valid_from,valid_to
        FROM claims WHERE subject_id=? AND predicate=? AND status!='rejected' AND id!=?
      `).all(claim.subjectId, claim.predicate, claim.id) as Array<{ id: string; value: string; polarity: string; valid_from?: string; valid_to?: string }>
      const incomingValue = String(claim.objectEntityId || claim.objectValue || '')
      const incomingPolarity = claim.polarity === 'negative' ? 'negative' : 'positive'
      const conflicting = existingValues.filter(item => {
        if (!item.value) return false
        if (item.value === incomingValue && item.polarity === incomingPolarity) return false
        if (item.valid_to && claim.validFrom && item.valid_to < claim.validFrom) return false
        if (claim.validTo && item.valid_from && claim.validTo < item.valid_from) return false
        return true
      })
      const conflictGroup = conflicting.length
        ? `conflict_${Buffer.from(`${claim.subjectId}|${claim.predicate}`).toString('base64url').slice(0, 24)}`
        : null
      if (conflictGroup) {
        const ids = conflicting.map(item => item.id)
        const placeholders = ids.map(() => '?').join(',')
        this.db.prepare(`UPDATE claims SET status='candidate',conflict_group=?,updated_at=? WHERE id IN (${placeholders})`)
          .run(conflictGroup, now, ...ids)
        for (const id of ids) {
          const documentId = `claim:${id}`
          const document = this.db.prepare('SELECT metadata_json FROM search_documents WHERE id=?').get(documentId) as any
          if (!document) continue
          let metadata: any = {}
          try { metadata = JSON.parse(document.metadata_json || '{}') } catch {}
          metadata.status = 'candidate'
          metadata.conflictGroup = conflictGroup
          this.db.prepare('UPDATE search_documents SET metadata_json=?,updated_at=? WHERE id=?')
            .run(JSON.stringify(metadata), now, documentId)
        }
        claim.status = 'candidate'
      }
      upsert.run(claim.id, claim.subjectId, claim.predicate, claim.objectEntityId || null, claim.objectValue || null,
        incomingPolarity, claim.valueType || 'text', claim.confidence, claim.status || 'candidate', claim.validFrom || null,
        claim.validTo || null, claim.searchText, claim.createdAt || now, now, sourceNature, conflictGroup)
      for (const item of claim.evidence || []) {
        const evidenceRole = item.role && item.role !== 'support'
          ? item.role
          : sourceNature === 'self_statement' || sourceNature === 'human_confirmation' ? 'direct' : 'indirect'
        const sender = String(item.sender || '')
        evidence.run(claim.id, item.messageId, item.sessionId, item.timestamp, sender, item.excerpt, evidenceRole)
        enrichEvidenceSender.run(sender, sender, claim.id, item.messageId)
      }
      for (const prior of conflicting) {
        for (const item of claim.evidence || []) {
          const sender = String(item.sender || '')
          evidence.run(prior.id, item.messageId, item.sessionId, item.timestamp, sender, item.excerpt, 'contradiction')
          enrichEvidenceSender.run(sender, sender, prior.id, item.messageId)
        }
        const priorEvidence = this.db.prepare(`
          SELECT message_id,session_id,timestamp,sender,excerpt FROM evidence
          WHERE claim_id=? AND evidence_role!='contradiction'
        `).all(prior.id) as any[]
        for (const item of priorEvidence) {
          evidence.run(
            claim.id, item.message_id, item.session_id, item.timestamp,
            item.sender, item.excerpt, 'contradiction'
          )
          enrichEvidenceSender.run(item.sender, item.sender, claim.id, item.message_id)
        }
      }
      this.upsertSearchDocument(`claim:${claim.id}`, 'claim', claim.id, claim.predicate, claim.searchText,
        { subjectId: claim.subjectId, objectEntityId: claim.objectEntityId, polarity: incomingPolarity, status: claim.status, validFrom: claim.validFrom, validTo: claim.validTo }, now)
    }
  }

  upsertEvents(events: any[]): void {
    if (!this.db || !events.length) return
    const now = new Date().toISOString()
    const upsert = this.db.prepare(`
      INSERT INTO events(
        id,event_type,title,description,start_at,end_at,location,confidence,status,source_nature,search_text,created_at,updated_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description,start_at=COALESCE(excluded.start_at,start_at),
        end_at=COALESCE(excluded.end_at,end_at),location=COALESCE(excluded.location,location),
        confidence=MAX(confidence,excluded.confidence),status=excluded.status,source_nature=excluded.source_nature,
        search_text=excluded.search_text,updated_at=excluded.updated_at
    `)
    const participant = this.db.prepare('INSERT OR IGNORE INTO event_participants(event_id,entity_id,role) VALUES(?,?,?)')
    const evidence = this.db.prepare(`
      INSERT OR IGNORE INTO evidence(event_id,message_id,session_id,timestamp,sender,excerpt,evidence_role)
      VALUES(?,?,?,?,?,?,?)
    `)
    const enrichEvidenceSender = this.db.prepare(`
      UPDATE evidence SET sender=CASE WHEN ?!='' THEN ? ELSE sender END
      WHERE event_id=? AND message_id=?
    `)
    for (const event of events) {
      const evidenceIds = (event.evidence || []).map((item: any) => item.messageId)
      if (evidenceIds.length) {
        const placeholders = evidenceIds.map(() => '?').join(',')
        const matches = this.db.prepare(`
          SELECT DISTINCT ev.id,ev.start_at FROM events ev
          JOIN evidence e ON e.event_id=ev.id WHERE e.message_id IN (${placeholders})
        `).all(...evidenceIds) as Array<{ id: string; start_at?: string }>
        const reusable = matches.find(match => !match.start_at || !event.startAt || match.start_at === event.startAt)
        if (reusable) event.id = reusable.id
      }
      if (this.isMemoryItemSuppressed('event', event.id, this.memoryItemSemanticFingerprint('event', event))) continue
      const manuallyCorrected = Boolean(this.db.prepare(`
        SELECT 1 FROM memory_corrections WHERE item_kind='event' AND item_id=? LIMIT 1
      `).get(event.id))
      if (manuallyCorrected) {
        for (const item of event.participants || []) participant.run(event.id, item.entityId, item.role || 'participant')
        for (const item of event.evidence || []) {
          const sender = String(item.sender || '')
          evidence.run(
            event.id, item.messageId, item.sessionId, item.timestamp, sender, item.excerpt,
            item.role && item.role !== 'support' ? item.role : 'indirect'
          )
          enrichEvidenceSender.run(sender, sender, event.id, item.messageId)
        }
        if (event.status === 'cancelled') {
          this.db.prepare(`UPDATE events SET status='cancelled',updated_at=? WHERE id=?`).run(now, event.id)
          const document = this.db.prepare('SELECT metadata_json FROM search_documents WHERE id=?')
            .get(`event:${event.id}`) as any
          if (document) {
            let metadata: any = {}
            try { metadata = JSON.parse(document.metadata_json || '{}') } catch {}
            metadata.status = 'cancelled'
            this.db.prepare('UPDATE search_documents SET metadata_json=?,updated_at=? WHERE id=?')
              .run(JSON.stringify(metadata), now, `event:${event.id}`)
          }
        }
        continue
      }
      upsert.run(event.id, event.eventType, event.title, event.description || '', event.startAt || null, event.endAt || null,
        event.location || null, event.confidence, event.status || 'candidate', event.sourceNature || 'inference',
        event.searchText, event.createdAt || now, now)
      for (const item of event.participants || []) participant.run(event.id, item.entityId, item.role || 'participant')
      for (const item of event.evidence || []) {
        const sender = String(item.sender || '')
        evidence.run(
          event.id, item.messageId, item.sessionId, item.timestamp, sender, item.excerpt,
          item.role && item.role !== 'support' ? item.role : 'direct'
        )
        enrichEvidenceSender.run(sender, sender, event.id, item.messageId)
      }
      this.upsertSearchDocument(`event:${event.id}`, 'event', event.id, event.title, event.searchText,
        { eventType: event.eventType, startAt: event.startAt, endAt: event.endAt, participantIds: (event.participants || []).map((item: any) => item.entityId), status: event.status }, now)
    }
  }

  getMemoryStats(): any {
    if (!this.db) return {
      claims: 0, events: 0, resources: 0,
      claimRevision: '', eventRevision: '', resourceRevision: ''
    }
    const stats = (table: string) => this.db!.prepare(`
      SELECT COUNT(*) AS count,COALESCE(MAX(updated_at),'') AS revision FROM ${table}
    `).get() as { count: number; revision: string }
    const claims = stats('claims')
    const events = stats('events')
    const resources = stats('memory_resources')
    return {
      claims: Number(claims.count),
      events: Number(events.count),
      resources: Number(resources.count),
      claimRevision: claims.revision,
      eventRevision: events.revision,
      resourceRevision: resources.revision
    }
  }

  listEntityEventParticipants(entityId: string): Array<{ eventId: string; role: string }> {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT event_id AS eventId,role FROM event_participants
      WHERE entity_id=? ORDER BY event_id,role
    `).all(entityId) as Array<{ eventId: string; role: string }>)
  }

  getEvent(id: string): any | null {
    if (!this.db) return null
    const event = this.db.prepare(`
      SELECT ev.*,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.event_id=ev.id) AS evidence_count,
        (SELECT mc.created_at FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id
          ORDER BY mc.id DESC LIMIT 1) AS corrected_at
      FROM events ev WHERE ev.id=?
    `).get(String(id || '')) as any
    if (!event) return null
    return {
      ...event,
      participants: this.db.prepare(`
        SELECT ep.entity_id,ep.role,e.canonical_name
        FROM event_participants ep JOIN entities e ON e.id=ep.entity_id WHERE ep.event_id=?
      `).all(event.id),
      evidence: this.db.prepare(`
        SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
        FROM evidence WHERE event_id=? ORDER BY timestamp
      `).all(event.id)
    }
  }

  mergeEntityEventParticipants(sourceId: string, targetId: string): void {
    if (!this.db || !sourceId || !targetId || sourceId === targetId) return
    const transaction = this.db.transaction(() => {
      this.db!.prepare(`
        INSERT OR IGNORE INTO event_participants(event_id,entity_id,role)
        SELECT event_id,?,role FROM event_participants WHERE entity_id=?
      `).run(targetId, sourceId)
      this.db!.prepare('DELETE FROM event_participants WHERE entity_id=?').run(sourceId)
    })
    transaction()
  }

  restoreMergedEventParticipants(
    sourceId: string,
    targetId: string,
    sourceParticipants: Array<{ eventId: string; role: string }>,
    targetParticipants: Array<{ eventId: string; role: string }>
  ): void {
    if (!this.db || !sourceId || !targetId) return
    const targetOriginal = new Set(targetParticipants.map(item => `${item.eventId}\0${item.role}`))
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO event_participants(event_id,entity_id,role) VALUES(?,?,?)'
    )
    const remove = this.db.prepare(
      'DELETE FROM event_participants WHERE event_id=? AND entity_id=? AND role=?'
    )
    const transaction = this.db.transaction(() => {
      for (const item of sourceParticipants) {
        insert.run(item.eventId, sourceId, item.role)
        if (!targetOriginal.has(`${item.eventId}\0${item.role}`)) {
          remove.run(item.eventId, targetId, item.role)
        }
      }
    })
    transaction()
  }

  upsertResources(resources: any[]): void {
    if (!this.db || !resources.length) return
    const upsert = this.db.prepare(`
      INSERT INTO memory_resources(
        id,resource_type,title,url,file_name,file_ext,content,metadata_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        resource_type=excluded.resource_type,title=excluded.title,url=excluded.url,
        file_name=excluded.file_name,file_ext=excluded.file_ext,content=excluded.content,
        metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    `)
    const insertEvidence = this.db.prepare(`
      INSERT OR IGNORE INTO search_document_evidence(document_id,message_id,session_id,timestamp,sender,excerpt)
      VALUES(?,?,?,?,?,?)
    `)
    for (const resource of resources) {
      const resourceId = String(resource.id)
      if (this.db.prepare('SELECT 1 FROM resource_suppressions WHERE resource_id=?').get(resourceId)) continue
      const now = String(resource.updatedAt || new Date().toISOString())
      const metadata = resource.metadata && typeof resource.metadata === 'object' ? resource.metadata : {}
      const existing = this.db.prepare('SELECT metadata_json FROM memory_resources WHERE id=?').get(resourceId) as any
      let existingMetadata: any = {}
      try { existingMetadata = JSON.parse(existing?.metadata_json || '{}') } catch {}
      if (!metadata.attachmentStructure && existingMetadata.attachmentStructure) {
        metadata.attachmentStructure = existingMetadata.attachmentStructure
        metadata.attachmentStructureParserVersion = existingMetadata.attachmentStructureParserVersion || ''
        metadata.attachmentStructureMigrationStatus = existingMetadata.attachmentStructureMigrationStatus || ''
        metadata.attachmentStructureMigratedAt = existingMetadata.attachmentStructureMigratedAt || ''
      }
      if (resource.resourceType === 'document' && metadata.contentHash &&
          metadata.contentHash === existingMetadata.contentHash) {
        for (const key of [
          'documentAnalysisStatus',
          'documentAnalysisVersion',
          'documentAnalysisContentHash',
          'documentAnalysisAttempts',
          'documentAnalysisLastAttemptAt',
          'documentAnalysisCompletedAt',
          'documentAnalysisNextAt',
          'documentAnalysisError'
        ]) {
          if (existingMetadata[key] !== undefined && metadata[key] === undefined) {
            metadata[key] = existingMetadata[key]
          }
        }
      }
      upsert.run(
        resourceId, String(resource.resourceType || 'resource'),
        String(resource.title || '未命名资源'), String(resource.url || ''),
        String(resource.fileName || ''), String(resource.fileExt || ''),
        String(resource.content || ''), JSON.stringify(metadata),
        String(resource.createdAt || now), now
      )
      const documentId = `resource:${resourceId}`
      const searchText = [
        resource.title, resource.content, resource.url, resource.fileName, resource.fileExt,
        metadata.sessionName, metadata.senderName, metadata.appMsgKind
      ].filter(Boolean).join('；')
      this.upsertSearchDocument(documentId, 'resource', resourceId, String(resource.title || '未命名资源'),
        searchText, { ...metadata, resourceType: resource.resourceType, url: resource.url || '', fileName: resource.fileName || '' }, now)
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(documentId)
      for (const item of resource.evidence || []) {
        if (!item.messageId) continue
        insertEvidence.run(documentId, String(item.messageId), String(item.sessionId || ''),
          Number(item.timestamp || 0), String(item.sender || ''), String(item.excerpt || '').slice(0, 2000))
      }
    }
  }

  deleteResource(id: string, reason = 'manual_delete'): any {
    if (!this.db) return { success: false, id }
    const resourceId = String(id || '').trim()
    if (!resourceId) return { success: false, id: resourceId }
    const documentId = `resource:${resourceId}`
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const resource = this.db.prepare('SELECT * FROM memory_resources WHERE id=?').get(resourceId) as any
      const evidence = this.db.prepare(`
        SELECT message_id,session_id,timestamp,sender,excerpt
        FROM search_document_evidence WHERE document_id=? ORDER BY timestamp
      `).all(documentId) as any[]
      if (resource) {
        this.db.prepare(`
          INSERT INTO resource_trash(resource_id,snapshot_json,reason,deleted_at) VALUES(?,?,?,?)
          ON CONFLICT(resource_id) DO UPDATE SET
            snapshot_json=excluded.snapshot_json,reason=excluded.reason,deleted_at=excluded.deleted_at
        `).run(resourceId, JSON.stringify({ resource, evidence }), String(reason || 'manual_delete').slice(0, 200), now)
      }
      this.db.prepare(`
        INSERT INTO resource_suppressions(resource_id,reason,created_at) VALUES(?,?,?)
        ON CONFLICT(resource_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at
      `).run(resourceId, String(reason || 'manual_delete').slice(0, 200), now)
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(documentId)
      this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(documentId)
      this.db.prepare('DELETE FROM search_documents WHERE id=?').run(documentId)
      const result = this.db.prepare('DELETE FROM memory_resources WHERE id=?').run(resourceId)
      this.db.exec('COMMIT')
      return { success: true, id: resourceId, deleted: Number(result.changes || 0), suppressed: true }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listResourceTrash(limit = 50): any[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT resource_id,snapshot_json,reason,deleted_at
      FROM resource_trash ORDER BY deleted_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(500, limit))) as any[]).flatMap(row => {
      try {
        const snapshot = JSON.parse(row.snapshot_json)
        return [{
          id: row.resource_id,
          title: snapshot.resource?.title || '未命名资源',
          resourceType: snapshot.resource?.resource_type || 'resource',
          deletedAt: row.deleted_at,
          reason: row.reason
        }]
      } catch {
        return []
      }
    })
  }

  restoreResource(id: string): any {
    if (!this.db) return { success: false, id }
    const resourceId = String(id || '').trim()
    const trash = this.db.prepare('SELECT snapshot_json FROM resource_trash WHERE resource_id=?').get(resourceId) as any
    if (!trash) return { success: false, id: resourceId, error: 'not_found' }
    const snapshot = JSON.parse(trash.snapshot_json || '{}')
    const row = snapshot.resource
    if (!row) return { success: false, id: resourceId, error: 'invalid_snapshot' }
    let metadata: any = {}
    try { metadata = JSON.parse(row.metadata_json || '{}') } catch {}
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM resource_suppressions WHERE resource_id=?').run(resourceId)
      this.upsertResources([{
        id: resourceId,
        resourceType: row.resource_type,
        title: row.title,
        url: row.url,
        fileName: row.file_name,
        fileExt: row.file_ext,
        content: row.content,
        metadata,
        createdAt: row.created_at,
        updatedAt: new Date().toISOString(),
        evidence: (snapshot.evidence || []).map((item: any) => ({
          messageId: item.message_id,
          sessionId: item.session_id,
          timestamp: item.timestamp,
          sender: item.sender,
          excerpt: item.excerpt
        }))
      }])
      this.db.prepare('DELETE FROM resource_trash WHERE resource_id=?').run(resourceId)
      this.db.exec('COMMIT')
      return { success: true, id: resourceId }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  purgeResourceTrash(id: string): any {
    if (!this.db) return { success: false, id }
    const resourceId = String(id || '').trim()
    if (!resourceId) return { success: false, id: resourceId }
    const result = this.db.prepare('DELETE FROM resource_trash WHERE resource_id=?').run(resourceId)
    return { success: true, id: resourceId, purged: Number(result.changes || 0), suppressed: true }
  }

  purgeExpiredResourceTrash(retentionDays: number, now = new Date()): any {
    if (!this.db) return { success: false, purged: 0 }
    const days = Math.max(0, Math.floor(Number(retentionDays || 0)))
    if (!days) return { success: true, purged: 0, retentionDays: 0 }
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
    const result = this.db.prepare('DELETE FROM resource_trash WHERE deleted_at<?').run(cutoff)
    return { success: true, purged: Number(result.changes || 0), retentionDays: days, cutoff }
  }

  listPendingPdfOcrResources(limit = 1): any[] {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT r.* FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='file' AND s.resource_id IS NULL
      ORDER BY r.updated_at ASC
    `).all() as any[]
    return rows.flatMap(row => {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        if (!metadata.attachmentPdfOcrTruncated || !metadata.attachmentLocalPath ||
          Number(metadata.attachmentPdfOcrNextPage || 0) < 2) return []
        return [{ ...row, metadata }]
      } catch {
        return []
      }
    }).slice(0, Math.max(1, Math.min(10, limit)))
  }

  listPendingAttachmentStructureResources(parserVersion: string, limit = 1, now = new Date()): any[] {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT r.* FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='file' AND s.resource_id IS NULL
      ORDER BY r.updated_at ASC
    `).all() as any[]
    return rows.flatMap(row => {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        const extension = String(metadata.attachmentFormat || row.file_ext || '').toLowerCase()
        if (!['.docx', '.pptx', '.xlsx', '.pdf'].includes(extension) || !metadata.attachmentLocalPath) return []
        if (metadata.attachmentStructureParserVersion === parserVersion && metadata.attachmentStructure) return []
        const nextAt = Date.parse(String(metadata.attachmentStructureMigrationNextAt || ''))
        if (Number.isFinite(nextAt) && nextAt > now.getTime()) return []
        return [{ ...row, metadata }]
      } catch {
        return []
      }
    }).slice(0, Math.max(1, Math.min(10, limit)))
  }

  listPendingImageSemanticResources(modelVersion: string, limit = 1, now = new Date()): any[] {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT r.* FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='image' AND s.resource_id IS NULL
      ORDER BY r.updated_at ASC
    `).all() as any[]
    return rows.flatMap(row => {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        if (!metadata.mediaLocalPath || metadata.visualModelVersion === modelVersion) return []
        const nextAt = Date.parse(String(metadata.visualMigrationNextAt || ''))
        if (Number.isFinite(nextAt) && nextAt > now.getTime()) return []
        return [{ ...row, metadata }]
      } catch {
        return []
      }
    }).slice(0, Math.max(1, Math.min(10, limit)))
  }

  getImageSemanticMigrationStats(modelVersion: string, now = new Date()): any {
    if (!this.db) return { total: 0, completed: 0, pending: 0, deferred: 0 }
    const rows = this.db.prepare(`
      SELECT r.metadata_json FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='image' AND s.resource_id IS NULL
    `).all() as any[]
    let total = 0
    let completed = 0
    let deferred = 0
    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        if (!metadata.mediaLocalPath) continue
        total += 1
        if (metadata.visualModelVersion === modelVersion) completed += 1
        else if (Date.parse(String(metadata.visualMigrationNextAt || '')) > now.getTime()) deferred += 1
      } catch {}
    }
    return { total, completed, pending: Math.max(0, total - completed - deferred), deferred }
  }

  getAttachmentStructureMigrationStats(parserVersion: string, now = new Date()): any {
    if (!this.db) return { total: 0, completed: 0, pending: 0, deferred: 0 }
    const rows = this.db.prepare(`
      SELECT r.file_ext,r.metadata_json FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='file' AND s.resource_id IS NULL
    `).all() as any[]
    let total = 0
    let completed = 0
    let deferred = 0
    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        const extension = String(metadata.attachmentFormat || row.file_ext || '').toLowerCase()
        if (!['.docx', '.pptx', '.xlsx', '.pdf'].includes(extension) || !metadata.attachmentLocalPath) continue
        total += 1
        if (metadata.attachmentStructureParserVersion === parserVersion && metadata.attachmentStructure) completed += 1
        else if (Date.parse(String(metadata.attachmentStructureMigrationNextAt || '')) > now.getTime()) deferred += 1
      } catch {}
    }
    return { total, completed, pending: Math.max(0, total - completed - deferred), deferred }
  }

  replaceResourceContent(id: string, content: string, metadataPatch: Record<string, any>): any {
    if (!this.db) return null
    const resourceId = String(id || '').trim()
    const row = this.db.prepare('SELECT * FROM memory_resources WHERE id=?').get(resourceId) as any
    if (!row || this.db.prepare('SELECT 1 FROM resource_suppressions WHERE resource_id=?').get(resourceId)) return null
    let metadata: any = {}
    try { metadata = JSON.parse(row.metadata_json || '{}') } catch {}
    metadata = { ...metadata, ...metadataPatch }
    const nextContent = String(content || '').trim().slice(0, 80_000)
    const now = new Date().toISOString()
    this.db.prepare('UPDATE memory_resources SET content=?,metadata_json=?,updated_at=? WHERE id=?')
      .run(nextContent, JSON.stringify(metadata), now, resourceId)
    this.upsertSearchDocument(
      `resource:${resourceId}`, 'resource', resourceId, String(row.title || '未命名资源'),
      [row.title, nextContent, row.url, row.file_name, row.file_ext, metadata.sessionName, metadata.senderName]
        .filter(Boolean).join('；'),
      { ...metadata, resourceType: row.resource_type, url: row.url || '', fileName: row.file_name || '' },
      now
    )
    return { id: resourceId, content: nextContent, metadata, updatedAt: now }
  }

  appendResourceContent(id: string, text: string, metadataPatch: Record<string, any>): any {
    if (!this.db) return null
    const resourceId = String(id || '').trim()
    const row = this.db.prepare('SELECT * FROM memory_resources WHERE id=?').get(resourceId) as any
    if (!row || this.db.prepare('SELECT 1 FROM resource_suppressions WHERE resource_id=?').get(resourceId)) return null
    let metadata: any = {}
    try { metadata = JSON.parse(row.metadata_json || '{}') } catch {}
    metadata = { ...metadata, ...metadataPatch }
    const content = [String(row.content || '').trim(), String(text || '').trim()].filter(Boolean).join('\n').slice(0, 80_000)
    const now = new Date().toISOString()
    this.db.prepare('UPDATE memory_resources SET content=?,metadata_json=?,updated_at=? WHERE id=?')
      .run(content, JSON.stringify(metadata), now, resourceId)
    this.upsertSearchDocument(
      `resource:${resourceId}`, 'resource', resourceId, String(row.title || '未命名资源'),
      [row.title, content, row.url, row.file_name, row.file_ext, metadata.sessionName, metadata.senderName]
        .filter(Boolean).join('；'),
      { ...metadata, resourceType: row.resource_type, url: row.url || '', fileName: row.file_name || '' },
      now
    )
    return { id: resourceId, content, metadata, updatedAt: now }
  }

  syncTasks(tasks: any[]): void {
    if (!this.db) return
    const now = new Date().toISOString()
    const activeIds = new Set(tasks.map(task => `task:${task.id}`))
    const activeTaskIds = new Set(tasks.map(task => String(task.id)))
    const storedTasks = this.db.prepare(
      `SELECT id,payload_json,evidence_fingerprint FROM task_directory`
    ).all() as Array<{ id: string; payload_json: string; evidence_fingerprint: string }>
    const storedTaskMap = new Map(storedTasks.map(task => [task.id, task]))
    const deleteTask = this.db.prepare(`DELETE FROM task_directory WHERE id=?`)
    for (const { id } of storedTasks) {
      if (!activeTaskIds.has(id)) deleteTask.run(id)
    }
    const upsertTask = this.db.prepare(`
      INSERT INTO task_directory(
        id,status,classification,priority,due,project,task_kind,title,payload_json,
        evidence_fingerprint,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,classification=excluded.classification,priority=excluded.priority,
        due=excluded.due,project=excluded.project,task_kind=excluded.task_kind,title=excluded.title,
        payload_json=excluded.payload_json,evidence_fingerprint=excluded.evidence_fingerprint,
        updated_at=excluded.updated_at
    `)
    const existing = this.db.prepare(`SELECT id FROM search_documents WHERE document_type='task'`).all() as Array<{ id: string }>
    for (const { id } of existing) {
      if (activeIds.has(id)) continue
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(id)
      this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(id)
      this.db.prepare('DELETE FROM search_documents WHERE id=?').run(id)
    }
    for (const task of tasks) {
      const {
        evidence: _evidence,
        sourceMessageIds: _sourceMessageIds,
        ...directoryTask
      } = task || {}
      const payloadJson = JSON.stringify(directoryTask)
      const evidenceFingerprint = createHash('sha256')
        .update(JSON.stringify((task.evidence || []).map((item: any) => [
          item.messageId || '', item.sessionId || '', Number(item.timestamp || 0),
          item.sender || '', item.excerpt || ''
        ])))
        .digest('hex')
      const storedTask = storedTaskMap.get(String(task.id))
      if (storedTask?.payload_json === payloadJson &&
          storedTask.evidence_fingerprint === evidenceFingerprint) continue
      upsertTask.run(
        String(task.id),
        String(task.status || 'todo'),
        String(task.classification || 'uncertain'),
        String(task.priority || 'medium'),
        String(task.due || '') || null,
        String(task.project || ''),
        String(task.taskKind || 'action'),
        String(task.title || ''),
        payloadJson,
        evidenceFingerprint,
        String(task.createdAt || now),
        String(task.updatedAt || task.createdAt || now)
      )
      const documentId = `task:${task.id}`
      this.upsertSearchDocument(documentId, 'task', task.id, task.title,
        [task.title, task.detail, task.owner, ...(task.collaborators || []), task.project, task.source, task.assignmentEvidence].filter(Boolean).join('；'),
        {
          status: task.status,
          priority: task.priority,
          due: task.due,
          classification: task.classification,
          sourceSessionId: task.sourceSessionId,
          owner: task.owner,
          collaborators: task.collaborators || [],
          project: task.project || '',
          dependsOnIds: task.dependsOnIds || [],
          taskKind: task.taskKind || 'action',
          ownershipPolicyReason: task.ownershipPolicyReason || ''
        }, now)
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(documentId)
      const insertEvidence = this.db.prepare(`
        INSERT OR IGNORE INTO search_document_evidence(document_id,message_id,session_id,timestamp,sender,excerpt)
        VALUES(?,?,?,?,?,?)
      `)
      for (const item of task.evidence || []) {
        const messageId = String(item.messageId || '')
        if (!messageId) continue
        insertEvidence.run(documentId, messageId, String(task.sourceSessionId || task.source || ''),
          Number(item.timestamp || 0), String(item.sender || ''), String(item.excerpt || '').slice(0, 2000))
      }
    }
  }

  listTaskArchive(options: {
    status?: 'done' | 'cancelled' | 'all'
    priority?: string
    project?: string
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): { items: any[]; total: number; hasMore: boolean; projects: string[] } {
    if (!this.db) return { items: [], total: 0, hasMore: false, projects: [] }
    const conditions = [`classification='mine'`]
    const parameters: Array<string | number> = []
    if (options.status === 'done' || options.status === 'cancelled') {
      conditions.push('status=?')
      parameters.push(options.status)
    } else {
      conditions.push(`status IN ('done','cancelled')`)
    }
    const priority = String(options.priority || '').trim()
    if (priority) {
      conditions.push('priority=?')
      parameters.push(priority)
    }
    const project = String(options.project || '').trim()
    if (project) {
      conditions.push('project=?')
      parameters.push(project)
    }
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`instr(lower(title || char(0) || payload_json),?)>0`)
      parameters.push(query)
    }
    const validFrom = options.from && Number.isFinite(Date.parse(options.from)) ? options.from : ''
    const validTo = options.to && Number.isFinite(Date.parse(options.to)) ? options.to : ''
    if (validFrom) {
      conditions.push('updated_at>=?')
      parameters.push(validFrom)
    }
    if (validTo) {
      conditions.push('updated_at<=?')
      parameters.push(validTo)
    }
    const where = conditions.join(' AND ')
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM task_directory WHERE ${where}`)
      .get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT td.*,
        (SELECT COUNT(*) FROM search_document_evidence sde
          WHERE sde.document_id='task:' || td.id) AS evidence_count,
        (SELECT COUNT(*) FROM task_history th WHERE th.task_id=td.id) AS history_count
      FROM task_directory td
      WHERE ${where}
      ORDER BY updated_at DESC,id ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const projects = (this.db.prepare(`
      SELECT DISTINCT project FROM task_directory
      WHERE classification='mine' AND status IN ('done','cancelled') AND project!=''
      ORDER BY project COLLATE NOCASE LIMIT 500
    `).all() as Array<{ project: string }>).map(row => row.project)
    return {
      items: rows.map(row => {
        let payload: any = {}
        try { payload = JSON.parse(String(row.payload_json || '{}')) } catch {}
        return {
          ...payload,
          id: row.id,
          title: row.title,
          status: row.status,
          priority: row.priority,
          due: row.due,
          project: row.project,
          taskKind: row.task_kind,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          evidenceTotal: Number(row.evidence_count || 0),
          historyTotal: Number(row.history_count || 0)
        }
      }),
      total,
      hasMore: offset + rows.length < total,
      projects
    }
  }

  listTaskOwnershipReviews(options: {
    classification?: string
    priority?: string
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): { items: any[]; total: number; hasMore: boolean; counts: Record<string, number> } {
    if (!this.db) return { items: [], total: 0, hasMore: false, counts: {} }
    const conditions = [`classification!='mine'`]
    const parameters: Array<string | number> = []
    const classification = String(options.classification || '').trim()
    if (classification && classification !== 'all') {
      conditions.push('classification=?')
      parameters.push(classification)
    }
    const priority = String(options.priority || '').trim()
    if (priority && priority !== 'all') {
      conditions.push('priority=?')
      parameters.push(priority)
    }
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`instr(lower(title || char(0) || payload_json),?)>0`)
      parameters.push(query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('updated_at>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('updated_at<=?')
      parameters.push(to)
    }
    const where = conditions.join(' AND ')
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM task_directory WHERE ${where}
    `).get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT td.*,
        (SELECT COUNT(*) FROM search_document_evidence sde
          WHERE sde.document_id='task:' || td.id) AS evidence_count,
        (SELECT COUNT(*) FROM task_history th WHERE th.task_id=td.id) AS history_count
      FROM task_directory td
      WHERE ${where}
      ORDER BY updated_at DESC,id ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const counts = Object.fromEntries((this.db.prepare(`
      SELECT classification,COUNT(*) AS count
      FROM task_directory WHERE classification!='mine'
      GROUP BY classification
    `).all() as Array<{ classification: string; count: number }>)
      .map(row => [row.classification, Number(row.count || 0)]))
    return {
      items: rows.map(row => {
        let payload: any = {}
        try { payload = JSON.parse(String(row.payload_json || '{}')) } catch {}
        return {
          ...payload,
          id: row.id,
          title: row.title,
          status: row.status,
          classification: row.classification,
          priority: row.priority,
          due: row.due,
          project: row.project,
          taskKind: row.task_kind,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          evidenceTotal: Number(row.evidence_count || 0),
          historyTotal: Number(row.history_count || 0)
        }
      }),
      total,
      hasMore: offset + rows.length < total,
      counts
    }
  }

  getTaskOwnershipReviewStats(): {
    total: number
    latestId: string
    latestUpdatedAt: string
    latestClassification: string
  } {
    if (!this.db) return { total: 0, latestId: '', latestUpdatedAt: '', latestClassification: '' }
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM task_directory WHERE classification!='mine'
    `).get() as any)?.count || 0)
    const latest = this.db.prepare(`
      SELECT id,updated_at,classification FROM task_directory
      WHERE classification!='mine'
      ORDER BY updated_at DESC,id ASC LIMIT 1
    `).get() as any
    return {
      total,
      latestId: String(latest?.id || ''),
      latestUpdatedAt: String(latest?.updated_at || ''),
      latestClassification: String(latest?.classification || '')
    }
  }

  getMemoryFeed(limit = 100): { claims: any[]; events: any[]; resources: any[] } {
    if (!this.db) return { claims: [], events: [], resources: [] }
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)))
    const claims = this.db.prepare(`
      SELECT c.*,s.canonical_name AS subject_name,o.canonical_name AS object_entity_name,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='claim' AND mc.item_id=c.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.claim_id=c.id) AS evidence_count
      FROM claims c
      LEFT JOIN entities s ON s.id=c.subject_id
      LEFT JOIN entities o ON o.id=c.object_entity_id
      ORDER BY c.updated_at DESC LIMIT ?
    `).all(safeLimit) as any[]
    const events = this.db.prepare(`
      SELECT ev.*,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.event_id=ev.id) AS evidence_count
      FROM events ev ORDER BY COALESCE(start_at,updated_at) DESC LIMIT ?
    `).all(safeLimit) as any[]
    const evidenceStatement = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
      FROM evidence WHERE claim_id=? OR event_id=?
      ORDER BY timestamp DESC,
        CASE WHEN evidence_role='contradiction' THEN 0 ELSE 1 END,
        message_id DESC LIMIT ?
    `)
    const participantStatement = this.db.prepare(`
      SELECT ep.entity_id,ep.role,e.canonical_name
      FROM event_participants ep JOIN entities e ON e.id=ep.entity_id WHERE ep.event_id=?
    `)
    const resources = this.db.prepare(`
      SELECT mr.*,
        (SELECT COUNT(*) FROM search_document_evidence sde
          WHERE sde.document_id='resource:' || mr.id) AS evidence_count
      FROM memory_resources mr ORDER BY updated_at DESC LIMIT ?
    `).all(safeLimit) as any[]
    const resourceEvidence = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt
      FROM search_document_evidence WHERE document_id=?
      ORDER BY timestamp DESC,message_id DESC LIMIT ?
    `)
    const latestEvidence = (rows: any[]): any[] => rows.reverse()
    return {
      claims: claims.map(claim => ({
        ...claim,
        evidence: latestEvidence(evidenceStatement.all(claim.id, '', MEMORY_CARD_EVIDENCE_LIMIT) as any[])
      })),
      events: events.map(event => ({
        ...event,
        participants: participantStatement.all(event.id) as any[],
        evidence: latestEvidence(evidenceStatement.all('', event.id, MEMORY_CARD_EVIDENCE_LIMIT) as any[])
      })),
      resources: resources.map(resource => ({
        ...resource,
        metadata: JSON.parse(resource.metadata_json || '{}'),
        evidence: latestEvidence(resourceEvidence.all(`resource:${resource.id}`, MEMORY_CARD_EVIDENCE_LIMIT) as any[])
      }))
    }
  }

  getEntityMemory(entityId: string, limit = 200): {
    claims: any[]
    events: any[]
    claimTotal: number
    eventTotal: number
  } {
    if (!this.db || !String(entityId || '').trim()) {
      return { claims: [], events: [], claimTotal: 0, eventTotal: 0 }
    }
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)))
    const claims = this.db.prepare(`
      SELECT c.*,s.canonical_name AS subject_name,o.canonical_name AS object_entity_name,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='claim' AND mc.item_id=c.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.claim_id=c.id) AS evidence_count
      FROM claims c
      LEFT JOIN entities s ON s.id=c.subject_id
      LEFT JOIN entities o ON o.id=c.object_entity_id
      WHERE c.status!='rejected' AND (c.subject_id=? OR c.object_entity_id=?)
      ORDER BY c.updated_at DESC LIMIT ?
    `).all(entityId, entityId, safeLimit) as any[]
    const events = this.db.prepare(`
      SELECT ev.*,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.event_id=ev.id) AS evidence_count
      FROM events ev
      WHERE ev.status!='rejected' AND EXISTS(
        SELECT 1 FROM event_participants ep WHERE ep.event_id=ev.id AND ep.entity_id=?
      )
      ORDER BY COALESCE(ev.start_at,ev.updated_at) DESC LIMIT ?
    `).all(entityId, safeLimit) as any[]
    const evidenceStatement = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
      FROM evidence WHERE claim_id=? OR event_id=?
      ORDER BY timestamp DESC,
        CASE WHEN evidence_role='contradiction' THEN 0 ELSE 1 END,
        message_id DESC LIMIT ?
    `)
    const participantStatement = this.db.prepare(`
      SELECT ep.entity_id,ep.role,e.canonical_name
      FROM event_participants ep JOIN entities e ON e.id=ep.entity_id WHERE ep.event_id=?
    `)
    const claimTotal = Number((this.db.prepare(
      `SELECT COUNT(*) AS count FROM claims
       WHERE status!='rejected' AND (subject_id=? OR object_entity_id=?)`
    ).get(entityId, entityId) as any)?.count || 0)
    const eventTotal = Number((this.db.prepare(`
      SELECT COUNT(DISTINCT ep.event_id) AS count
      FROM event_participants ep JOIN events ev ON ev.id=ep.event_id
      WHERE ep.entity_id=? AND ev.status!='rejected'
    `).get(entityId) as any)?.count || 0)
    return {
      claims: claims.map(claim => ({
        ...claim,
        evidence: (evidenceStatement.all(claim.id, '', MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
      })),
      events: events.map(event => ({
        ...event,
        participants: participantStatement.all(event.id) as any[],
        evidence: (evidenceStatement.all('', event.id, MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
      })),
      claimTotal,
      eventTotal
    }
  }

  getTrustedExtractionMemory(
    entityIds: string[],
    options: { claimLimit?: number; eventLimit?: number } = {}
  ): {
    claims: any[]
    events: any[]
    claimTotal: number
    eventTotal: number
  } {
    if (!this.db) return { claims: [], events: [], claimTotal: 0, eventTotal: 0 }
    const ids = [...new Set((entityIds || []).map(String).filter(Boolean))].slice(0, 40)
    if (!ids.length) return { claims: [], events: [], claimTotal: 0, eventTotal: 0 }
    const placeholders = ids.map(() => '?').join(',')
    const claimLimit = Math.max(1, Math.min(80, Number(options.claimLimit || 36)))
    const eventLimit = Math.max(1, Math.min(40, Number(options.eventLimit || 16)))
    const claimWhere = `c.status='confirmed' AND
      (c.subject_id IN (${placeholders}) OR c.object_entity_id IN (${placeholders}))`
    const claims = this.db.prepare(`
      SELECT c.id,c.subject_id,c.predicate,c.object_entity_id,c.object_value,c.polarity,
        c.value_type,c.source_nature,c.valid_from,c.valid_to,c.updated_at,
        s.canonical_name AS subject_name,o.canonical_name AS object_entity_name
      FROM claims c
      LEFT JOIN entities s ON s.id=c.subject_id
      LEFT JOIN entities o ON o.id=c.object_entity_id
      WHERE ${claimWhere}
      ORDER BY c.updated_at DESC,c.id LIMIT ?
    `).all(...ids, ...ids, claimLimit) as any[]
    const claimTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM claims c WHERE ${claimWhere}
    `).get(...ids, ...ids) as any)?.count || 0)
    const eventWhere = `ev.status='confirmed' AND EXISTS(
      SELECT 1 FROM event_participants ep
      WHERE ep.event_id=ev.id AND ep.entity_id IN (${placeholders})
    )`
    const events = this.db.prepare(`
      SELECT ev.id,ev.event_type,ev.title,ev.description,ev.start_at,ev.end_at,
        ev.location,ev.source_nature,ev.updated_at
      FROM events ev WHERE ${eventWhere}
      ORDER BY COALESCE(ev.start_at,ev.updated_at) DESC,ev.id LIMIT ?
    `).all(...ids, eventLimit) as any[]
    const eventTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM events ev WHERE ${eventWhere}
    `).get(...ids) as any)?.count || 0)
    const participants = this.db.prepare(`
      SELECT ep.event_id,ep.entity_id,ep.role,e.canonical_name
      FROM event_participants ep JOIN entities e ON e.id=ep.entity_id
      WHERE ep.event_id IN (${events.length ? events.map(() => '?').join(',') : "''"})
      ORDER BY ep.event_id,ep.entity_id,ep.role
    `).all(...events.map(event => event.id)) as any[]
    const participantsByEvent = new Map<string, any[]>()
    for (const participant of participants) {
      const rows = participantsByEvent.get(String(participant.event_id)) || []
      rows.push(participant)
      participantsByEvent.set(String(participant.event_id), rows)
    }
    return {
      claims,
      events: events.map(event => ({
        ...event,
        participants: participantsByEvent.get(String(event.id)) || []
      })),
      claimTotal,
      eventTotal
    }
  }

  listEventTimeline(options: {
    sourceId?: 'wechat' | 'documents' | 'calendar'
    status?: 'candidate' | 'confirmed' | 'cancelled'
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): { items: any[]; total: number; hasMore: boolean } {
    if (!this.db) return { items: [], total: 0, hasMore: false }
    const conditions = [`ev.status!='rejected'`]
    const parameters: Array<string | number> = []
    if (options.status) {
      conditions.push('ev.status=?')
      parameters.push(options.status)
    }
    const validFrom = options.from && Number.isFinite(Date.parse(options.from)) ? options.from : ''
    const validTo = options.to && Number.isFinite(Date.parse(options.to)) ? options.to : ''
    if (validFrom) {
      conditions.push('COALESCE(ev.start_at,ev.created_at)>=?')
      parameters.push(validFrom)
    }
    if (validTo) {
      conditions.push('COALESCE(ev.start_at,ev.created_at)<=?')
      parameters.push(validTo)
    }
    if (options.sourceId === 'calendar') {
      conditions.push(`EXISTS (
        SELECT 1 FROM evidence source_evidence
        WHERE source_evidence.event_id=ev.id AND source_evidence.session_id LIKE 'data-source:calendar:%'
      )`)
    } else if (options.sourceId === 'documents') {
      conditions.push(`EXISTS (
        SELECT 1 FROM evidence source_evidence
        WHERE source_evidence.event_id=ev.id AND source_evidence.session_id LIKE 'data-source:documents%'
      )`)
    } else if (options.sourceId === 'wechat') {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM evidence source_evidence
        WHERE source_evidence.event_id=ev.id AND source_evidence.session_id LIKE 'data-source:%'
      )`)
    }
    const where = conditions.join(' AND ')
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM events ev WHERE ${where}`)
      .get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(300, Number(options.limit || 100)))
    const offset = Math.max(0, Number(options.offset || 0))
    const rows = this.db.prepare(`
      SELECT ev.*,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id) AS correction_count,
        (SELECT COUNT(*) FROM evidence e WHERE e.event_id=ev.id) AS evidence_count,
        (SELECT mc.created_at FROM memory_corrections mc
          WHERE mc.item_kind='event' AND mc.item_id=ev.id
          ORDER BY mc.id DESC LIMIT 1) AS corrected_at,
        CASE
          WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.event_id=ev.id AND e.session_id LIKE 'data-source:calendar:%') THEN 'calendar'
          WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.event_id=ev.id AND e.session_id LIKE 'data-source:documents%') THEN 'documents'
          ELSE 'wechat'
        END AS source_id
      FROM events ev
      WHERE ${where}
      ORDER BY COALESCE(ev.start_at,ev.created_at) DESC,ev.id
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const evidenceStatement = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
      FROM evidence WHERE event_id=?
      ORDER BY timestamp DESC,
        CASE WHEN evidence_role='contradiction' THEN 0 ELSE 1 END,
        message_id DESC LIMIT ?
    `)
    const participantStatement = this.db.prepare(`
      SELECT ep.entity_id,ep.role,e.canonical_name
      FROM event_participants ep JOIN entities e ON e.id=ep.entity_id WHERE ep.event_id=?
    `)
    return {
      items: rows.map(event => ({
        ...event,
        participants: participantStatement.all(event.id) as any[],
        evidence: (evidenceStatement.all(event.id, MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
      })),
      total,
      hasMore: offset + rows.length < total
    }
  }

  listClaimArchive(options: {
    entityId?: string
    sourceId?: 'wechat' | 'documents'
    status?: 'candidate' | 'confirmed' | 'rejected'
    predicate?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): { items: any[]; total: number; hasMore: boolean } {
    if (!this.db) return { items: [], total: 0, hasMore: false }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (options.status) {
      conditions.push('c.status=?')
      parameters.push(options.status)
    } else {
      conditions.push(`c.status!='rejected'`)
    }
    const entityId = String(options.entityId || '').trim()
    if (entityId) {
      conditions.push('(c.subject_id=? OR c.object_entity_id=?)')
      parameters.push(entityId, entityId)
    }
    const predicate = String(options.predicate || '').trim().toLocaleLowerCase('zh-CN')
    if (predicate) {
      conditions.push(`instr(lower(c.predicate || char(0) || c.search_text),?)>0`)
      parameters.push(predicate)
    }
    const validFrom = options.from && Number.isFinite(Date.parse(options.from)) ? options.from : ''
    const validTo = options.to && Number.isFinite(Date.parse(options.to)) ? options.to : ''
    if (validFrom) {
      conditions.push(`COALESCE(c.valid_to,'9999-12-31T23:59:59.999Z')>=?`)
      parameters.push(validFrom)
    }
    if (validTo) {
      conditions.push(`COALESCE(c.valid_from,c.created_at)<=?`)
      parameters.push(validTo)
    }
    if (options.sourceId === 'documents') {
      conditions.push(`EXISTS (
        SELECT 1 FROM evidence source_evidence
        WHERE source_evidence.claim_id=c.id AND source_evidence.session_id LIKE 'data-source:documents%'
      )`)
    } else if (options.sourceId === 'wechat') {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM evidence source_evidence
        WHERE source_evidence.claim_id=c.id AND source_evidence.session_id LIKE 'data-source:%'
      )`)
    }
    const where = conditions.join(' AND ')
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM claims c WHERE ${where}`)
      .get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT c.*,s.canonical_name AS subject_name,o.canonical_name AS object_entity_name,
        (SELECT COUNT(*) FROM memory_corrections mc
          WHERE mc.item_kind='claim' AND mc.item_id=c.id) AS correction_count,
        (SELECT mc.created_at FROM memory_corrections mc
          WHERE mc.item_kind='claim' AND mc.item_id=c.id
          ORDER BY mc.id DESC LIMIT 1) AS corrected_at,
        (SELECT COUNT(*) FROM evidence e WHERE e.claim_id=c.id) AS evidence_count,
        CASE
          WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id=c.id AND e.session_id LIKE 'data-source:documents%') THEN 'documents'
          ELSE 'wechat'
        END AS source_id
      FROM claims c
      LEFT JOIN entities s ON s.id=c.subject_id
      LEFT JOIN entities o ON o.id=c.object_entity_id
      WHERE ${where}
      ORDER BY c.updated_at DESC,c.id ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const evidenceStatement = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
      FROM evidence WHERE claim_id=?
      ORDER BY timestamp DESC,
        CASE WHEN evidence_role='contradiction' THEN 0 ELSE 1 END,
        message_id DESC LIMIT ?
    `)
    return {
      items: rows.map(claim => ({
        ...claim,
        evidence: (evidenceStatement.all(claim.id, MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
      })),
      total,
      hasMore: offset + rows.length < total
    }
  }

  private memoryItemSemanticFingerprint(kind: 'claim' | 'event' | 'relation', item: any): string {
    const evidenceIds = [...new Set((item.evidence || []).map((entry: any) =>
      String(entry.messageId || entry.message_id || '')).filter(Boolean))].sort()
    const semanticKey = kind === 'claim'
      ? [kind, item.subjectId || item.subject_id || '', item.predicate || '', ...evidenceIds]
      : kind === 'event'
        ? [kind, item.eventType || item.event_type || '', ...evidenceIds]
        : [kind, item.subjectId || item.subject_id || '', item.predicate || '',
            item.objectId || item.object_id || '', ...evidenceIds]
    return createHash('sha256').update(semanticKey.join('|')).digest('hex')
  }

  isMemoryItemSuppressed(kind: 'claim' | 'event' | 'relation', id: string, semanticFingerprint = ''): boolean {
    if (!this.db) return false
    return Boolean(this.db.prepare(`
      SELECT 1 FROM memory_item_suppressions
      WHERE item_kind=? AND (item_id=? OR (?!='' AND semantic_fingerprint=?))
    `).get(kind, String(id || ''), semanticFingerprint, semanticFingerprint))
  }

  isExtractedMemoryItemSuppressed(kind: 'claim' | 'event' | 'relation', item: any): boolean {
    return this.isMemoryItemSuppressed(kind, String(item?.id || ''), this.memoryItemSemanticFingerprint(kind, item))
  }

  previewDeleteMemoryItem(kind: 'claim' | 'event' | 'relation', id: string): any | null {
    if (!this.db) return null
    const itemId = String(id || '').trim()
    if (!itemId) return null
    const table = kind === 'claim' ? 'claims' : kind === 'event' ? 'events' : 'relations'
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(itemId) as any
    if (!row) return null
    const documentId = `${kind}:${itemId}`
    const evidence = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM evidence
      WHERE ${kind === 'claim' ? 'claim_id' : kind === 'event' ? 'event_id' : 'relation_id'}=?
    `).get(itemId) as any)?.count || 0)
    const related = kind === 'claim'
      ? Number((this.db.prepare(`SELECT COUNT(*) AS count FROM memory_corrections WHERE item_kind='claim' AND item_id=?`).get(itemId) as any)?.count || 0)
      : kind === 'event'
        ? Number((this.db.prepare('SELECT COUNT(*) AS count FROM event_participants WHERE event_id=?').get(itemId) as any)?.count || 0)
        : Number((this.db.prepare('SELECT COUNT(*) AS count FROM relation_history WHERE relation_id=?').get(itemId) as any)?.count || 0)
    const assistantMessages = Number((this.db.prepare(`
      SELECT COUNT(DISTINCT conversation_id) AS count FROM assistant_messages WHERE citations_json LIKE ?
    `).get(`%${documentId}%`) as any)?.count || 0)
    const evidenceRows = this.db.prepare(`
      SELECT message_id FROM evidence
      WHERE ${kind === 'claim' ? 'claim_id' : kind === 'event' ? 'event_id' : 'relation_id'}=?
    `).all(itemId) as Array<{ message_id: string }>
    const semanticFingerprint = this.memoryItemSemanticFingerprint(kind, {
      ...row,
      evidence: evidenceRows
    })
    return {
      kind,
      id: itemId,
      label: kind === 'claim' ? String(row.predicate || '事实')
        : kind === 'event' ? String(row.title || '事件')
          : String(row.predicate || '关系'),
      documentId,
      fingerprint: createHash('sha256').update(`${kind}:${itemId}`).digest('hex').slice(0, 20),
      semanticFingerprint,
      counts: {
        evidence,
        related,
        searchDocuments: Number(Boolean(this.db.prepare('SELECT 1 FROM search_documents WHERE id=?').get(documentId))),
        assistantMessages
      }
    }
  }

  deleteMemoryItem(kind: 'claim' | 'event' | 'relation', id: string, reason = 'manual_delete'): any {
    if (!this.db) throw new Error('个人记忆库尚未初始化')
    const preview = this.previewDeleteMemoryItem(kind, id)
    if (!preview) throw new Error('该记忆不存在或已删除')
    const now = new Date().toISOString()
    const itemId = preview.id
    const documentId = preview.documentId
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO memory_item_suppressions(item_kind,item_id,semantic_fingerprint,reason,created_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(item_kind,item_id) DO UPDATE SET
          semantic_fingerprint=excluded.semantic_fingerprint,reason=excluded.reason
      `).run(kind, itemId, preview.semanticFingerprint, String(reason || 'manual_delete').slice(0, 200), now)
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(documentId)
      this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(documentId)
      this.db.prepare('DELETE FROM search_documents WHERE id=?').run(documentId)
      this.db.prepare(`
        DELETE FROM assistant_conversations WHERE id IN (
          SELECT conversation_id FROM assistant_messages WHERE citations_json LIKE ?
        )
      `).run(`%${documentId}%`)
      if (kind === 'claim') {
        this.db.prepare('DELETE FROM evidence WHERE claim_id=?').run(itemId)
        this.db.prepare(`DELETE FROM memory_corrections WHERE item_kind='claim' AND item_id=?`).run(itemId)
        this.db.prepare('DELETE FROM claims WHERE id=?').run(itemId)
      } else if (kind === 'event') {
        this.db.prepare('DELETE FROM evidence WHERE event_id=?').run(itemId)
        this.db.prepare('DELETE FROM event_participants WHERE event_id=?').run(itemId)
        this.db.prepare(`DELETE FROM memory_corrections WHERE item_kind='event' AND item_id=?`).run(itemId)
        this.db.prepare('DELETE FROM events WHERE id=?').run(itemId)
      } else {
        this.db.prepare('DELETE FROM evidence WHERE relation_id=?').run(itemId)
        this.db.prepare('DELETE FROM relation_history WHERE relation_id=?').run(itemId)
        this.db.prepare('DELETE FROM review_queue WHERE id=?').run(`review_rel_${itemId}`)
        this.db.prepare('DELETE FROM relations WHERE id=?').run(itemId)
      }
      this.db.prepare(`
        INSERT INTO memory_deletion_audit(item_kind,item_fingerprint,reason,impact_json,created_at)
        VALUES(?,?,?,?,?)
      `).run(
        kind,
        preview.fingerprint,
        String(reason || 'manual_delete').slice(0, 200),
        JSON.stringify(preview.counts),
        now
      )
      this.db.exec('COMMIT')
      return { success: true, kind, id: itemId, fingerprint: preview.fingerprint, removed: preview.counts, suppressed: true }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listMemoryDeletionAudit(limit = 50): any[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT id,item_kind,item_fingerprint,reason,impact_json,created_at
      FROM memory_deletion_audit ORDER BY id DESC LIMIT ?
    `).all(Math.max(1, Math.min(200, limit))) as any[]).map(row => ({
      ...row,
      impact: sanitizeMemoryDeletionImpact(row.impact_json)
    }))
  }

  listMemoryDeletionAuditPage(options: {
    kind?: 'claim' | 'event' | 'relation' | 'all'
    reason?: 'manual_delete' | 'not_important' | 'all'
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): {
    items: any[]
    total: number
    hasMore: boolean
    counts: {
      all: number
      claim: number
      event: number
      relation: number
      manual_delete: number
      not_important: number
    }
  } {
    const emptyCounts = {
      all: 0, claim: 0, event: 0, relation: 0, manual_delete: 0, not_important: 0
    }
    if (!this.db) return { items: [], total: 0, hasMore: false, counts: emptyCounts }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (options.kind === 'claim' || options.kind === 'event' || options.kind === 'relation') {
      conditions.push('item_kind=?')
      parameters.push(options.kind)
    }
    if (options.reason === 'manual_delete' || options.reason === 'not_important') {
      conditions.push('reason=?')
      parameters.push(options.reason)
    }
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push('instr(lower(item_fingerprint),?)>0')
      parameters.push(query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('created_at>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('created_at<=?')
      parameters.push(to)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_deletion_audit ${where}
    `).get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT id,item_kind,item_fingerprint,reason,impact_json,created_at
      FROM memory_deletion_audit
      ${where}
      ORDER BY created_at DESC,id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const countsRow = this.db.prepare(`
      SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN item_kind='claim' THEN 1 ELSE 0 END) AS claim_count,
        SUM(CASE WHEN item_kind='event' THEN 1 ELSE 0 END) AS event_count,
        SUM(CASE WHEN item_kind='relation' THEN 1 ELSE 0 END) AS relation_count,
        SUM(CASE WHEN reason='manual_delete' THEN 1 ELSE 0 END) AS manual_delete_count,
        SUM(CASE WHEN reason='not_important' THEN 1 ELSE 0 END) AS not_important_count
      FROM memory_deletion_audit
    `).get() as any
    return {
      items: rows.map(row => {
        const { impact_json: _impactJson, ...safeRow } = row
        return { ...safeRow, impact: sanitizeMemoryDeletionImpact(row.impact_json) }
      }),
      total,
      hasMore: offset + rows.length < total,
      counts: {
        all: Number(countsRow?.all_count || 0),
        claim: Number(countsRow?.claim_count || 0),
        event: Number(countsRow?.event_count || 0),
        relation: Number(countsRow?.relation_count || 0),
        manual_delete: Number(countsRow?.manual_delete_count || 0),
        not_important: Number(countsRow?.not_important_count || 0)
      }
    }
  }

  getMemoryDeletionAuditStats(): {
    total: number
    latestId: number
    latestCreatedAt: string
  } {
    if (!this.db) return { total: 0, latestId: 0, latestCreatedAt: '' }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,COALESCE(MAX(id),0) AS latest_id,
        COALESCE(MAX(created_at),'') AS latest_created_at
      FROM memory_deletion_audit
    `).get() as any
    return {
      total: Number(row?.total || 0),
      latestId: Number(row?.latest_id || 0),
      latestCreatedAt: String(row?.latest_created_at || '')
    }
  }

  updateMemoryItemStatus(kind: 'claim' | 'event', id: string, status: 'candidate' | 'confirmed' | 'rejected'): any {
    if (!this.db) return null
    const table = kind === 'claim' ? 'claims' : 'events'
    const now = new Date().toISOString()
    this.db.prepare(`UPDATE ${table} SET status=?,updated_at=? WHERE id=?`).run(status, now, id)
    const documentId = `${kind}:${id}`
    const document = this.db.prepare('SELECT metadata_json FROM search_documents WHERE id=?').get(documentId) as any
    if (document) {
      let metadata: any = {}
      try { metadata = JSON.parse(document.metadata_json || '{}') } catch {}
      metadata.status = status
      this.db.prepare('UPDATE search_documents SET metadata_json=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(metadata), now, documentId)
    }
    return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) || null
  }

  recordTaskChanges(taskId: string, before: any, after: any, reason = 'manual_edit', evidence: any[] = []): void {
    if (!this.db) return
    const fields = ['status', 'title', 'detail', 'owner', 'collaborators', 'project', 'dependsOnIds', 'taskKind', 'due', 'priority']
    const insert = this.db.prepare(`
      INSERT INTO task_history(task_id,field,before_value,after_value,reason,evidence_json,created_at)
      VALUES(?,?,?,?,?,?,?)
    `)
    const now = new Date().toISOString()
    for (const field of fields) {
      const left = JSON.stringify(before?.[field] ?? '')
      const right = JSON.stringify(after?.[field] ?? '')
      if (left === right) continue
      insert.run(taskId, field, left, right, reason, JSON.stringify(evidence || []), now)
    }
  }

  listTaskHistory(taskIds: string[], limit = 200): any[] {
    if (!this.db || !taskIds.length) return []
    const ids = [...new Set(taskIds.map(String))].slice(0, 500)
    const placeholders = ids.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT * FROM task_history WHERE task_id IN (${placeholders})
      ORDER BY created_at DESC,id DESC LIMIT ?
    `).all(...ids, Math.max(1, Math.min(1000, limit))) as any[]
  }

  countTaskHistory(taskId: string): number {
    if (!this.db || !taskId) return 0
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM task_history WHERE task_id=?').get(taskId) as any
    return Number(row?.count || 0)
  }

  recordTaskReviewDecision(input: {
    evidenceFingerprint: string
    taskId: string
    decision: 'mine' | 'rejected'
    title?: string
    source?: string
    evidence?: any[]
    task?: any
  }): any {
    if (!this.db) return null
    const now = new Date().toISOString()
    const taskJson = JSON.stringify(input.task || {})
    const transaction = this.db.transaction(() => {
      this.db!.prepare(`
        INSERT INTO task_review_decisions(
          evidence_fingerprint,task_id,decision,title,source,evidence_json,task_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(evidence_fingerprint) DO UPDATE SET
          task_id=excluded.task_id,decision=excluded.decision,title=excluded.title,source=excluded.source,
          evidence_json=excluded.evidence_json,task_json=excluded.task_json,revoked_at=NULL,updated_at=excluded.updated_at
      `).run(
        input.evidenceFingerprint, input.taskId, input.decision, String(input.title || ''),
        String(input.source || ''), JSON.stringify(input.evidence || []), taskJson, now, now
      )
      this.db!.prepare(`
        INSERT INTO task_review_history(evidence_fingerprint,task_id,action,task_json,created_at)
        VALUES(?,?,?,?,?)
      `).run(input.evidenceFingerprint, input.taskId, input.decision, taskJson, now)
    })
    transaction()
    return this.getTaskReviewDecision(input.evidenceFingerprint)
  }

  getTaskReviewDecision(evidenceFingerprint: string): any {
    if (!this.db) return null
    return this.db.prepare(`
      SELECT * FROM task_review_decisions WHERE evidence_fingerprint=? AND revoked_at IS NULL
    `).get(evidenceFingerprint) || null
  }

  listActiveTaskReviewDecisions(): any[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT * FROM task_review_decisions WHERE revoked_at IS NULL ORDER BY updated_at,evidence_fingerprint
    `).all() as any[]).map(row => {
      let task: any = {}
      try { task = JSON.parse(String(row.task_json || '{}')) } catch {}
      return { ...row, task }
    })
  }

  recordTaskReviewReconciliation(evidenceFingerprint: string): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE task_review_decisions
      SET reconciliation_count=reconciliation_count+1,last_reconciled_at=?,updated_at=?
      WHERE evidence_fingerprint=? AND revoked_at IS NULL
    `).run(now, now, evidenceFingerprint)
  }

  revokeTaskReviewDecision(evidenceFingerprint: string): any {
    if (!this.db || !String(evidenceFingerprint || '').trim()) return null
    const row = this.db.prepare(`
      SELECT * FROM task_review_decisions WHERE evidence_fingerprint=? AND revoked_at IS NULL
    `).get(evidenceFingerprint) as any
    if (!row) return null
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db!.prepare(`
        UPDATE task_review_decisions SET revoked_at=?,updated_at=? WHERE evidence_fingerprint=?
      `).run(now, now, evidenceFingerprint)
      this.db!.prepare(`
        INSERT INTO task_review_history(evidence_fingerprint,task_id,action,task_json,created_at)
        VALUES(?,?,?,?,?)
      `).run(evidenceFingerprint, row.task_id, 'revoked', row.task_json || '{}', now)
    })
    transaction()
    let task: any = {}
    try { task = JSON.parse(String(row.task_json || '{}')) } catch {}
    return { ...row, task, revoked_at: now, updated_at: now }
  }

  listTaskReviewHistory(evidenceFingerprint: string, limit = 100): any[] {
    if (!this.db) return []
    return this.db.prepare(`
      SELECT * FROM task_review_history WHERE evidence_fingerprint=?
      ORDER BY created_at DESC,id DESC LIMIT ?
    `).all(evidenceFingerprint, Math.max(1, Math.min(300, Number(limit) || 100))) as any[]
  }

  recordTaskReviewSuppression(evidenceFingerprint: string): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE task_review_decisions SET suppression_count=suppression_count+1,
        last_suppressed_at=?,updated_at=? WHERE evidence_fingerprint=? AND decision='rejected'
    `).run(now, now, evidenceFingerprint)
  }

  listTaskReviewDecisions(limit = 50): any[] {
    if (!this.db) return []
    return (this.db.prepare(`
      SELECT * FROM task_review_decisions ORDER BY updated_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(300, Number(limit) || 50))) as any[]).map(row => {
      let evidence: any[] = []
      let task: any = {}
      try { evidence = JSON.parse(String(row.evidence_json || '[]')) } catch {}
      try { task = JSON.parse(String(row.task_json || '{}')) } catch {}
      const { task_json: _taskJson, evidence_json: _evidenceJson, ...safeRow } = row
      return {
        ...safeRow,
        evidence,
        active: !row.revoked_at,
        can_restore_snapshot: Boolean(task?.id && task?.title)
      }
    })
  }

  listTaskReviewDecisionPage(options: {
    status?: 'active' | 'revoked' | 'all'
    decision?: 'mine' | 'rejected' | 'all'
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): {
    items: any[]
    total: number
    hasMore: boolean
    counts: { active: number; revoked: number; all: number }
  } {
    if (!this.db) {
      return { items: [], total: 0, hasMore: false, counts: { active: 0, revoked: 0, all: 0 } }
    }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (options.status === 'active') conditions.push('revoked_at IS NULL')
    if (options.status === 'revoked') conditions.push('revoked_at IS NOT NULL')
    if (options.decision === 'mine' || options.decision === 'rejected') {
      conditions.push('decision=?')
      parameters.push(options.decision)
    }
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`instr(lower(title || char(0) || source),?)>0`)
      parameters.push(query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('updated_at>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('updated_at<=?')
      parameters.push(to)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM task_review_decisions ${where}
    `).get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const rows = this.db.prepare(`
      SELECT evidence_fingerprint,task_id,decision,title,source,suppression_count,
        reconciliation_count,last_suppressed_at,last_reconciled_at,revoked_at,
        created_at,updated_at,task_json
      FROM task_review_decisions
      ${where}
      ORDER BY updated_at DESC,evidence_fingerprint ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const countsRow = this.db.prepare(`
      SELECT
        SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
        COUNT(*) AS all_count
      FROM task_review_decisions
    `).get() as any
    return {
      items: rows.map(row => {
        let task: any = {}
        try { task = JSON.parse(String(row.task_json || '{}')) } catch {}
        const { task_json: _taskJson, ...safeRow } = row
        return {
          ...safeRow,
          active: !row.revoked_at,
          can_restore_snapshot: Boolean(task?.id && task?.title)
        }
      }),
      total,
      hasMore: offset + rows.length < total,
      counts: {
        active: Number(countsRow?.active || 0),
        revoked: Number(countsRow?.revoked || 0),
        all: Number(countsRow?.all_count || 0)
      }
    }
  }

  getTaskReviewDecisionDossier(evidenceFingerprint: string, options: {
    historyOffset?: number
    historyLimit?: number
  } = {}): any {
    if (!this.db || !String(evidenceFingerprint || '').trim()) return null
    const row = this.db.prepare(`
      SELECT * FROM task_review_decisions WHERE evidence_fingerprint=?
    `).get(evidenceFingerprint) as any
    if (!row) return null
    let evidence: any[] = []
    let task: any = {}
    try { evidence = JSON.parse(String(row.evidence_json || '[]')) } catch {}
    try { task = JSON.parse(String(row.task_json || '{}')) } catch {}
    const historyOffset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.historyOffset) || 0)))
    const historyLimit = Math.max(1, Math.min(100, Math.floor(Number(options.historyLimit) || 50)))
    const historyTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM task_review_history WHERE evidence_fingerprint=?
    `).get(evidenceFingerprint) as any)?.count || 0)
    const historyRows = this.db.prepare(`
      SELECT id,action,created_at,task_json FROM task_review_history
      WHERE evidence_fingerprint=?
      ORDER BY created_at DESC,id DESC
      LIMIT ? OFFSET ?
    `).all(evidenceFingerprint, historyLimit, historyOffset) as any[]
    const { task_json: _taskJson, evidence_json: _evidenceJson, ...safeRow } = row
    return {
      ...safeRow,
      active: !row.revoked_at,
      can_restore_snapshot: Boolean(task?.id && task?.title),
      evidence: evidence.slice(-20),
      evidenceTotal: evidence.length,
      history: historyRows.map(item => {
        let snapshot: any = {}
        try { snapshot = JSON.parse(String(item.task_json || '{}')) } catch {}
        return {
          id: item.id,
          action: item.action,
          created_at: item.created_at,
          snapshotAvailable: Boolean(snapshot?.id && snapshot?.title)
        }
      }),
      historyTotal,
      historyOffset,
      historyLimit,
      historyHasMore: historyOffset + historyRows.length < historyTotal
    }
  }

  getTaskReviewArchiveStats(): {
    total: number
    latestFingerprint: string
    latestUpdatedAt: string
    latestActive: boolean
  } {
    if (!this.db) return { total: 0, latestFingerprint: '', latestUpdatedAt: '', latestActive: false }
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM task_review_decisions
    `).get() as any)?.count || 0)
    const latest = this.db.prepare(`
      SELECT evidence_fingerprint,updated_at,revoked_at FROM task_review_decisions
      ORDER BY updated_at DESC,evidence_fingerprint ASC LIMIT 1
    `).get() as any
    return {
      total,
      latestFingerprint: String(latest?.evidence_fingerprint || ''),
      latestUpdatedAt: String(latest?.updated_at || ''),
      latestActive: Boolean(latest && !latest.revoked_at)
    }
  }

  getTaskReviewFeedbackStats(): any {
    if (!this.db) return { mine: 0, rejected: 0, suppressed: 0, reconciled: 0 }
    return this.db.prepare(`
      SELECT
        SUM(CASE WHEN revoked_at IS NULL AND decision='mine' THEN 1 ELSE 0 END) AS mine,
        SUM(CASE WHEN revoked_at IS NULL AND decision='rejected' THEN 1 ELSE 0 END) AS rejected,
        COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN suppression_count ELSE 0 END),0) AS suppressed,
        COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN reconciliation_count ELSE 0 END),0) AS reconciled
      FROM task_review_decisions
    `).get() || { mine: 0, rejected: 0, suppressed: 0, reconciled: 0 }
  }

  correctClaim(id: string, input: { value: string; validFrom?: string; validTo?: string }): any {
    if (!this.db) return null
    const before = this.db.prepare('SELECT * FROM claims WHERE id=?').get(id) as any
    if (!before) return null
    const now = new Date().toISOString()
    const after = {
      ...before,
      object_entity_id: null,
      object_value: String(input.value || '').trim().slice(0, 1000),
      polarity: 'positive',
      valid_from: String(input.validFrom || '').trim() || null,
      valid_to: String(input.validTo || '').trim() || null,
      status: 'confirmed',
      source_nature: 'human_confirmation',
      conflict_group: null,
      updated_at: now
    }
    if (!after.object_value) return null
    const subject = this.db.prepare('SELECT canonical_name FROM entities WHERE id=?').get(before.subject_id) as { canonical_name?: string } | undefined
    const transaction = this.db.transaction(() => {
      this.db!.prepare(`
        UPDATE claims SET object_entity_id=NULL,object_value=?,polarity='positive',valid_from=?,valid_to=?,status='confirmed',
          source_nature='human_confirmation',conflict_group=NULL,updated_at=? WHERE id=?
      `).run(after.object_value, after.valid_from, after.valid_to, now, id)
      this.db!.prepare(`
        INSERT INTO memory_corrections(item_kind,item_id,before_json,after_json,created_at) VALUES('claim',?,?,?,?)
      `).run(id, JSON.stringify(before), JSON.stringify(after), now)
      this.upsertSearchDocument(`claim:${id}`, 'claim', id, before.predicate,
        `${subject?.canonical_name || ''} ${before.predicate} ${after.object_value}`.trim(),
        {
          subjectId: before.subject_id,
          polarity: 'positive',
          status: 'confirmed',
          sourceNature: 'human_confirmation',
          validFrom: after.valid_from,
          validTo: after.valid_to
        }, now)
    })
    transaction()
    return this.db.prepare('SELECT * FROM claims WHERE id=?').get(id) || null
  }

  correctEvent(id: string, input: {
    title: string
    eventType?: string
    description?: string
    startAt?: string
    endAt?: string
    location?: string
  }): any {
    if (!this.db) return null
    const before = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as any
    if (!before) return null
    const normalized = {
      title: String(input.title || '').trim().slice(0, 500),
      eventType: String(input.eventType || before.event_type || 'event').trim().slice(0, 120),
      description: String(input.description || '').trim().slice(0, 4_000),
      startAt: String(input.startAt || '').trim().slice(0, 100) || null,
      endAt: String(input.endAt || '').trim().slice(0, 100) || null,
      location: String(input.location || '').trim().slice(0, 500) || null
    }
    if (!normalized.title) throw new Error('事件标题不能为空')
    if (normalized.startAt && !Number.isFinite(Date.parse(normalized.startAt))) throw new Error('事件开始时间格式无效')
    if (normalized.endAt && !Number.isFinite(Date.parse(normalized.endAt))) throw new Error('事件结束时间格式无效')
    if (normalized.startAt && normalized.endAt &&
      Date.parse(normalized.endAt) < Date.parse(normalized.startAt)) throw new Error('事件结束时间不能早于开始时间')
    const now = new Date().toISOString()
    const after = {
      ...before,
      event_type: normalized.eventType,
      title: normalized.title,
      description: normalized.description,
      start_at: normalized.startAt,
      end_at: normalized.endAt,
      location: normalized.location,
      confidence: 1,
      status: 'confirmed',
      source_nature: 'human_confirmation',
      search_text: [
        normalized.title, normalized.eventType, normalized.description,
        normalized.startAt, normalized.endAt, normalized.location
      ].filter(Boolean).join('；'),
      updated_at: now
    }
    const transaction = this.db.transaction(() => {
      this.db!.prepare(`
        UPDATE events SET event_type=?,title=?,description=?,start_at=?,end_at=?,location=?,
          confidence=1,status='confirmed',source_nature='human_confirmation',search_text=?,updated_at=?
        WHERE id=?
      `).run(
        after.event_type, after.title, after.description, after.start_at, after.end_at,
        after.location, after.search_text, now, id
      )
      this.db!.prepare(`
        INSERT INTO memory_corrections(item_kind,item_id,before_json,after_json,created_at)
        VALUES('event',?,?,?,?)
      `).run(id, JSON.stringify(before), JSON.stringify(after), now)
      const participants = this.db!.prepare(`
        SELECT ep.entity_id,e.canonical_name,ep.role
        FROM event_participants ep LEFT JOIN entities e ON e.id=ep.entity_id
        WHERE ep.event_id=?
      `).all(id) as any[]
      const searchText = [
        after.search_text,
        ...participants.flatMap(participant => [participant.canonical_name, participant.role])
      ].filter(Boolean).join('；')
      this.upsertSearchDocument(`event:${id}`, 'event', id, after.title, searchText, {
        eventType: after.event_type,
        startAt: after.start_at,
        endAt: after.end_at,
        participantIds: participants.map(participant => participant.entity_id),
        status: 'confirmed',
        sourceNature: 'human_confirmation',
        correctionCount: Number((this.db!.prepare(`
          SELECT COUNT(*) AS count FROM memory_corrections WHERE item_kind='event' AND item_id=?
        `).get(id) as any)?.count || 0)
      }, now)
    })
    transaction()
    return this.db.prepare(`
      SELECT ev.*,
        (SELECT COUNT(*) FROM memory_corrections mc WHERE mc.item_kind='event' AND mc.item_id=ev.id) AS correction_count
      FROM events ev WHERE ev.id=?
    `).get(id) || null
  }

  startIngestionRun(id: string, model: string, promptVersion: string): void {
    if (!this.db) return
    this.db.prepare(`
      INSERT INTO ingestion_runs(id,started_at,model,prompt_version,status)
      VALUES(?,?,?,?,?)
    `).run(id, new Date().toISOString(), model, promptVersion, 'running')
  }

  recordIngestionBatch(
    runId: string,
    batchIndex: number,
    messageCount: number,
    status: 'running' | 'completed' | 'failed',
    error = '',
    metrics: {
      model?: string
      promptVersion?: string
      schemaVersion?: string
      inputTokens?: number
      outputTokens?: number
      durationMs?: number
      sensitiveRedaction?: any
      structuredEvidence?: any
      extractionContext?: any
    } = {}
  ): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO ingestion_batches(run_id,batch_index,message_count,status,error,started_at,finished_at,
        model,prompt_version,schema_version,input_tokens,output_tokens,duration_ms,redaction_summary_json,
        evidence_validation_json,extraction_context_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id,batch_index) DO UPDATE SET status=excluded.status,error=excluded.error,
        attempts=CASE WHEN excluded.status='running' THEN ingestion_batches.attempts+1 ELSE ingestion_batches.attempts END,
        finished_at=excluded.finished_at,
        model=CASE WHEN excluded.model!='' THEN excluded.model ELSE ingestion_batches.model END,
        prompt_version=CASE WHEN excluded.prompt_version!='' THEN excluded.prompt_version ELSE ingestion_batches.prompt_version END,
        schema_version=CASE WHEN excluded.schema_version!='' THEN excluded.schema_version ELSE ingestion_batches.schema_version END,
        input_tokens=CASE WHEN excluded.input_tokens>0 THEN excluded.input_tokens ELSE ingestion_batches.input_tokens END,
        output_tokens=CASE WHEN excluded.output_tokens>0 THEN excluded.output_tokens ELSE ingestion_batches.output_tokens END,
        duration_ms=CASE WHEN excluded.duration_ms>0 THEN excluded.duration_ms ELSE ingestion_batches.duration_ms END,
        redaction_summary_json=CASE WHEN excluded.redaction_summary_json!='{}' THEN excluded.redaction_summary_json ELSE ingestion_batches.redaction_summary_json END,
        evidence_validation_json=CASE WHEN excluded.evidence_validation_json!='{}' THEN excluded.evidence_validation_json ELSE ingestion_batches.evidence_validation_json END,
        extraction_context_json=CASE WHEN excluded.extraction_context_json!='{}' THEN excluded.extraction_context_json ELSE ingestion_batches.extraction_context_json END
    `).run(
      runId, batchIndex, messageCount, status, error || null, now, status === 'running' ? null : now,
      String(metrics.model || ''), String(metrics.promptVersion || ''), String(metrics.schemaVersion || ''),
      Math.max(0, Number(metrics.inputTokens || 0)), Math.max(0, Number(metrics.outputTokens || 0)),
      Math.max(0, Number(metrics.durationMs || 0)), JSON.stringify(metrics.sensitiveRedaction || {}),
      JSON.stringify(metrics.structuredEvidence || {}), JSON.stringify(metrics.extractionContext || {})
    )
  }

  prepareIngestionBatchCommit(input: {
    commitId: string
    runId: string
    batchIndex: number
    digest: any
    messages: any[]
    checkpointKeys: string[]
    createdAt: string
    sourceKind?: 'wechat' | 'document'
    resourceId?: string
    resourceContentHash?: string
    completion?: Record<string, any>
  }): void {
    if (!this.db) return
    this.db.prepare(`
      INSERT INTO ingestion_batch_commits(
        commit_id,run_id,batch_index,status,digest_json,messages_json,
        checkpoint_keys_json,created_at,prepared_at,source_kind,resource_id,
        resource_content_hash,completion_json
      ) VALUES(?,?,?,'prepared',?,?,?,?,?,?,?,?,?)
      ON CONFLICT(commit_id) DO UPDATE SET
        digest_json=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.digest_json ELSE excluded.digest_json END,
        messages_json=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.messages_json ELSE excluded.messages_json END,
        checkpoint_keys_json=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.checkpoint_keys_json ELSE excluded.checkpoint_keys_json END,
        source_kind=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.source_kind ELSE excluded.source_kind END,
        resource_id=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.resource_id ELSE excluded.resource_id END,
        resource_content_hash=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.resource_content_hash ELSE excluded.resource_content_hash END,
        completion_json=CASE WHEN ingestion_batch_commits.status='committed'
          THEN ingestion_batch_commits.completion_json ELSE excluded.completion_json END,
        last_error=NULL
    `).run(
      input.commitId,
      input.runId,
      input.batchIndex,
      JSON.stringify(input.digest),
      JSON.stringify(input.messages),
      JSON.stringify(input.checkpointKeys),
      input.createdAt,
      new Date().toISOString(),
      String(input.sourceKind || 'wechat'),
      String(input.resourceId || ''),
      String(input.resourceContentHash || ''),
      JSON.stringify(input.completion || {})
    )
  }

  listPreparedIngestionBatchCommits(limit = 100): Array<{
    commitId: string
    runId: string
    batchIndex: number
    digest: any
    messages: any[]
    checkpointKeys: string[]
    createdAt: string
    recoveryAttempts: number
    sourceKind: 'wechat' | 'document'
    resourceId: string
    resourceContentHash: string
    completion: Record<string, any>
  }> {
    if (!this.db) return []
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
    return (this.db.prepare(`
      SELECT * FROM ingestion_batch_commits
      WHERE status='prepared' ORDER BY prepared_at,commit_id LIMIT ?
    `).all(safeLimit) as any[]).map(row => ({
      commitId: String(row.commit_id),
      runId: String(row.run_id),
      batchIndex: Number(row.batch_index),
      digest: JSON.parse(String(row.digest_json || '{}')),
      messages: JSON.parse(String(row.messages_json || '[]')),
      checkpointKeys: JSON.parse(String(row.checkpoint_keys_json || '[]')),
      createdAt: String(row.created_at),
      recoveryAttempts: Number(row.recovery_attempts || 0),
      sourceKind: row.source_kind === 'document' ? 'document' : 'wechat',
      resourceId: String(row.resource_id || ''),
      resourceContentHash: String(row.resource_content_hash || ''),
      completion: JSON.parse(String(row.completion_json || '{}'))
    }))
  }

  markIngestionBatchCommitApplied(commitId: string): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE ingestion_batch_commits
      SET status='committed',applied_at=?,last_error=NULL,
        digest_json='{}',messages_json='[]'
      WHERE commit_id=?
    `).run(new Date().toISOString(), commitId)
  }

  recordProcessedIngestionMessageKeys(
    messageKeys: string[],
    commitId: string,
    processedAt = new Date().toISOString()
  ): number {
    if (!this.db) return 0
    const keys = [...new Set((Array.isArray(messageKeys) ? messageKeys : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))]
    if (!keys.length) return 0
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO processed_ingestion_messages(message_key,commit_id,processed_at)
      VALUES(?,?,?)
    `)
    const transaction = this.db.transaction(() => {
      let inserted = 0
      for (const key of keys) {
        inserted += Number(insert.run(key, String(commitId || 'unknown'), processedAt).changes || 0)
      }
      return inserted
    })
    return transaction()
  }

  getProcessedIngestionMessageKeys(messageKeys: string[]): Set<string> {
    if (!this.db) return new Set()
    const keys = [...new Set((Array.isArray(messageKeys) ? messageKeys : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))]
    const processed = new Set<string>()
    for (let offset = 0; offset < keys.length; offset += 400) {
      const chunk = keys.slice(offset, offset + 400)
      const placeholders = chunk.map(() => '?').join(',')
      for (const row of this.db.prepare(`
        SELECT message_key FROM processed_ingestion_messages
        WHERE message_key IN (${placeholders})
      `).all(...chunk) as Array<{ message_key: string }>) {
        processed.add(String(row.message_key))
      }
    }
    return processed
  }

  getProcessedIngestionMessageStats(): {
    total: number
    oldestProcessedAt: string | null
    latestProcessedAt: string | null
  } {
    if (!this.db) return { total: 0, oldestProcessedAt: null, latestProcessedAt: null }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,MIN(processed_at) AS oldest_processed_at,
        MAX(processed_at) AS latest_processed_at
      FROM processed_ingestion_messages
    `).get() as any
    return {
      total: Number(row?.total || 0),
      oldestProcessedAt: row?.oldest_processed_at ? String(row.oldest_processed_at) : null,
      latestProcessedAt: row?.latest_processed_at ? String(row.latest_processed_at) : null
    }
  }

  finalizeIngestionBatchCommit(
    commitId: string,
    metrics: {
      model?: string
      promptVersion?: string
      schemaVersion?: string
      inputTokens?: number
      outputTokens?: number
      durationMs?: number
      sensitiveRedaction?: any
      structuredEvidence?: any
      extractionContext?: any
    } = {}
  ): { resourceCheckpointApplied: boolean } {
    if (!this.db) return { resourceCheckpointApplied: false }
    let resourceCheckpointApplied = false
    const transaction = this.db.transaction(() => {
      const row = this.db!.prepare(`
        SELECT run_id,batch_index,messages_json,checkpoint_keys_json,status,source_kind,resource_id,
          resource_content_hash,completion_json
        FROM ingestion_batch_commits WHERE commit_id=?
      `).get(commitId) as any
      if (!row) throw new Error(`找不到待提交的记忆批次：${commitId}`)
      if (row.status === 'committed') return
      let messageCount = 0
      let checkpointKeys: string[] = []
      try { messageCount = JSON.parse(String(row.messages_json || '[]')).length } catch {}
      try {
        checkpointKeys = JSON.parse(String(row.checkpoint_keys_json || '[]'))
      } catch {}
      if (row.source_kind === 'document' && row.resource_id) {
        const resource = this.db!.prepare(`
          SELECT content,metadata_json FROM memory_resources WHERE id=?
        `).get(String(row.resource_id)) as any
        let metadata: any = {}
        let completion: any = {}
        try { metadata = JSON.parse(String(resource?.metadata_json || '{}')) } catch {}
        try { completion = JSON.parse(String(row.completion_json || '{}')) } catch {}
        if (resource && String(metadata.contentHash || '') === String(row.resource_content_hash || '')) {
          this.replaceResourceContent(String(row.resource_id), String(resource.content || ''), completion)
          resourceCheckpointApplied = true
        }
      }
      if (row.source_kind === 'wechat') {
        this.recordProcessedIngestionMessageKeys(checkpointKeys, commitId, new Date().toISOString())
      }
      this.markIngestionBatchCommitApplied(commitId)
      this.recordIngestionBatch(
        String(row.run_id),
        Number(row.batch_index),
        messageCount,
        'completed',
        '',
        metrics
      )
      if (row.source_kind === 'document') {
        this.db!.prepare(`
          UPDATE ingestion_runs
          SET finished_at=?,message_count=?,status='completed',error=NULL
          WHERE id=?
        `).run(new Date().toISOString(), messageCount, String(row.run_id))
      }
    })
    transaction()
    return { resourceCheckpointApplied }
  }

  recordIngestionBatchCommitRecoveryFailure(commitId: string, error: string): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE ingestion_batch_commits
      SET recovery_attempts=recovery_attempts+1,last_error=?
      WHERE commit_id=? AND status='prepared'
    `).run(String(error || '').slice(0, 1000), commitId)
  }

  getIngestionCommitHealth(): {
    prepared: number
    preparedWechat: number
    preparedDocuments: number
    committed: number
    recoveryFailures: number
    oldestPreparedAt: string | null
  } {
    if (!this.db) return {
      prepared: 0,
      preparedWechat: 0,
      preparedDocuments: 0,
      committed: 0,
      recoveryFailures: 0,
      oldestPreparedAt: null
    }
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status='prepared' THEN 1 ELSE 0 END) AS prepared,
        SUM(CASE WHEN status='prepared' AND source_kind='wechat' THEN 1 ELSE 0 END) AS prepared_wechat,
        SUM(CASE WHEN status='prepared' AND source_kind='document' THEN 1 ELSE 0 END) AS prepared_documents,
        SUM(CASE WHEN status='committed' THEN 1 ELSE 0 END) AS committed,
        SUM(CASE WHEN status='prepared' AND recovery_attempts>0 THEN 1 ELSE 0 END) AS recovery_failures,
        MIN(CASE WHEN status='prepared' THEN prepared_at END) AS oldest_prepared_at
      FROM ingestion_batch_commits
    `).get() as any
    return {
      prepared: Number(row?.prepared || 0),
      preparedWechat: Number(row?.prepared_wechat || 0),
      preparedDocuments: Number(row?.prepared_documents || 0),
      committed: Number(row?.committed || 0),
      recoveryFailures: Number(row?.recovery_failures || 0),
      oldestPreparedAt: row?.oldest_prepared_at ? String(row.oldest_prepared_at) : null
    }
  }

  finishIngestionRun(id: string, input: { status: 'completed' | 'partial' | 'failed'; messageCount: number; entityCount: number; relationCount: number; error?: string }): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE ingestion_runs SET finished_at=?,message_count=?,entity_count=?,relation_count=?,status=?,error=? WHERE id=?
    `).run(new Date().toISOString(), input.messageCount, input.entityCount, input.relationCount, input.status, input.error || null, id)
  }

  reconcileInterruptedIngestionRuns(input: {
    entityCount: number
    relationCount: number
  }): {
    runs: number
    interruptedBatches: number
    recoveredBatches: number
    pendingCommits: number
  } {
    const empty = { runs: 0, interruptedBatches: 0, recoveredBatches: 0, pendingCommits: 0 }
    if (!this.db) return empty
    const runningRuns = this.db.prepare(`
      SELECT id FROM ingestion_runs WHERE status='running' ORDER BY started_at
    `).all() as Array<{ id: string }>
    if (!runningRuns.length) return empty
    const result = { ...empty }
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      for (const run of runningRuns) {
        const counts = this.db!.prepare(`
          SELECT
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_batches,
            SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running_batches,
            SUM(CASE WHEN status='completed' THEN message_count ELSE 0 END) AS completed_messages
          FROM ingestion_batches WHERE run_id=?
        `).get(run.id) as any
        const pending = Number((this.db!.prepare(`
          SELECT COUNT(*) AS count FROM ingestion_batch_commits
          WHERE run_id=? AND status='prepared'
        `).get(run.id) as any)?.count || 0)
        const interrupted = Number(counts?.running_batches || 0)
        const recovered = Number(counts?.completed_batches || 0)
        const note = pending
          ? `应用在记忆处理期间退出；${recovered} 个批次已保存，${pending} 个加密批次仍等待自动恢复`
          : `应用在记忆处理期间退出；${recovered} 个成功批次已保存，未完成内容将按 checkpoint 继续`
        this.db!.prepare(`
          UPDATE ingestion_batches
          SET status='failed',finished_at=?,error=?
          WHERE run_id=? AND status='running'
        `).run(now, pending ? '应用退出中断；加密恢复载荷仍保留' : '应用退出中断；等待按 checkpoint 重试', run.id)
        this.db!.prepare(`
          UPDATE ingestion_runs
          SET finished_at=?,message_count=?,entity_count=?,relation_count=?,
            status='partial',error=?,recovered_at=?,recovered_batch_count=?,
            interrupted_batch_count=?
          WHERE id=? AND status='running'
        `).run(
          now,
          Number(counts?.completed_messages || 0),
          Math.max(0, Number(input.entityCount || 0)),
          Math.max(0, Number(input.relationCount || 0)),
          note,
          now,
          recovered,
          interrupted,
          run.id
        )
        result.runs += 1
        result.interruptedBatches += interrupted
        result.recoveredBatches += recovered
        result.pendingCommits += pending
      }
    })
    transaction()
    return result
  }

  getIngestionStatus(): any {
    if (!this.db) return null
    const latest = this.db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 1').get() as any
    if (!latest) return {
      status: 'idle',
      batches: [],
      usage: {},
      commitHealth: this.getIngestionCommitHealth(),
      messageLedger: this.getProcessedIngestionMessageStats()
    }
    const batches = this.db.prepare(`
      SELECT status,COUNT(*) AS count,SUM(message_count) AS messages
      FROM ingestion_batches WHERE run_id=? GROUP BY status
    `).all(latest.id) as any[]
    const usage = this.db.prepare(`
      SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(duration_ms),0) AS duration_ms,
        MAX(model) AS model,MAX(prompt_version) AS prompt_version,MAX(schema_version) AS schema_version
      FROM ingestion_batches WHERE run_id=?
    `).get(latest.id) as any
    return {
      ...latest,
      batches,
      usage,
      commitHealth: this.getIngestionCommitHealth(),
      messageLedger: this.getProcessedIngestionMessageStats()
    }
  }

  listIngestionRuns(limit = 20): any[] {
    if (!this.db) return []
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20))
    const runs = this.db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT ?').all(safeLimit) as any[]
    const batches = this.db.prepare(`
      SELECT * FROM ingestion_batches WHERE run_id=? ORDER BY batch_index
    `)
    return runs.map(run => {
      const runBatches = batches.all(run.id) as any[]
      const usage = runBatches.reduce((result, batch) => ({
        input_tokens: result.input_tokens + Number(batch.input_tokens || 0),
        output_tokens: result.output_tokens + Number(batch.output_tokens || 0),
        duration_ms: result.duration_ms + Number(batch.duration_ms || 0)
      }), { input_tokens: 0, output_tokens: 0, duration_ms: 0 })
      return {
        ...run,
        batches: runBatches.map(batch => {
          let sensitiveRedaction: any = {}
          let structuredEvidence: any = {}
          let extractionContext: any = {}
          try { sensitiveRedaction = JSON.parse(batch.redaction_summary_json || '{}') } catch {}
          try { structuredEvidence = JSON.parse(batch.evidence_validation_json || '{}') } catch {}
          try { extractionContext = JSON.parse(batch.extraction_context_json || '{}') } catch {}
          return { ...batch, sensitiveRedaction, structuredEvidence, extractionContext }
        }),
        usage
      }
    })
  }

  getIngestionArchiveSummary(): {
    runs: number
    completedRuns: number
    partialRuns: number
    failedRuns: number
    runningRuns: number
    messages: number
    inputTokens: number
    outputTokens: number
    durationMs: number
    failedBatches: number
    batches: number
    latestRunId: string
    latestActivityAt: string
  } {
    const empty = {
      runs: 0, completedRuns: 0, partialRuns: 0, failedRuns: 0, runningRuns: 0,
      messages: 0, inputTokens: 0, outputTokens: 0, durationMs: 0,
      failedBatches: 0, batches: 0, latestRunId: '', latestActivityAt: ''
    }
    if (!this.db) return empty
    const runs = this.db.prepare(`
      SELECT
        COUNT(*) AS runs,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_runs,
        SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial_runs,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_runs,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running_runs,
        COALESCE(SUM(message_count),0) AS messages
      FROM ingestion_runs
    `).get() as any
    const batches = this.db.prepare(`
      SELECT
        COUNT(*) AS batches,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_batches,
        COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(duration_ms),0) AS duration_ms
      FROM ingestion_batches
    `).get() as any
    const latest = this.db.prepare(`
      SELECT id,COALESCE(finished_at,recovered_at,started_at) AS activity_at
      FROM ingestion_runs
      ORDER BY COALESCE(finished_at,recovered_at,started_at) DESC,id ASC LIMIT 1
    `).get() as any
    return {
      runs: Number(runs?.runs || 0),
      completedRuns: Number(runs?.completed_runs || 0),
      partialRuns: Number(runs?.partial_runs || 0),
      failedRuns: Number(runs?.failed_runs || 0),
      runningRuns: Number(runs?.running_runs || 0),
      messages: Number(runs?.messages || 0),
      inputTokens: Number(batches?.input_tokens || 0),
      outputTokens: Number(batches?.output_tokens || 0),
      durationMs: Number(batches?.duration_ms || 0),
      failedBatches: Number(batches?.failed_batches || 0),
      batches: Number(batches?.batches || 0),
      latestRunId: String(latest?.id || ''),
      latestActivityAt: String(latest?.activity_at || '')
    }
  }

  listIngestionRunPage(options: {
    status?: 'running' | 'completed' | 'partial' | 'failed' | 'all'
    query?: string
    from?: string
    to?: string
    limit?: number
    offset?: number
  } = {}): {
    items: any[]
    total: number
    hasMore: boolean
    counts: { running: number; completed: number; partial: number; failed: number; all: number }
  } {
    const emptyCounts = { running: 0, completed: 0, partial: 0, failed: 0, all: 0 }
    if (!this.db) return { items: [], total: 0, hasMore: false, counts: emptyCounts }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (['running', 'completed', 'partial', 'failed'].includes(String(options.status || ''))) {
      conditions.push('r.status=?')
      parameters.push(String(options.status))
    }
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`instr(lower(
        r.id || char(0) || r.model || char(0) || r.prompt_version || char(0) || COALESCE(r.error,'')
      ),?)>0`)
      parameters.push(query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('r.started_at>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('r.started_at<=?')
      parameters.push(to)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM ingestion_runs r ${where}
    `).get(...parameters) as any)?.count || 0)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const items = this.db.prepare(`
      SELECT r.*,
        COUNT(b.batch_index) AS batch_count,
        SUM(CASE WHEN b.status='failed' THEN 1 ELSE 0 END) AS failed_batch_count,
        COALESCE(SUM(b.input_tokens),0) AS input_tokens,
        COALESCE(SUM(b.output_tokens),0) AS output_tokens,
        COALESCE(SUM(b.duration_ms),0) AS duration_ms
      FROM ingestion_runs r
      LEFT JOIN ingestion_batches b ON b.run_id=r.id
      ${where}
      GROUP BY r.id
      ORDER BY r.started_at DESC,r.id ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    const counts = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS all_count
      FROM ingestion_runs
    `).get() as any
    return {
      items: items.map(item => ({
        ...item,
        batch_count: Number(item.batch_count || 0),
        failed_batch_count: Number(item.failed_batch_count || 0),
        input_tokens: Number(item.input_tokens || 0),
        output_tokens: Number(item.output_tokens || 0),
        duration_ms: Number(item.duration_ms || 0)
      })),
      total,
      hasMore: offset + items.length < total,
      counts: {
        running: Number(counts?.running || 0),
        completed: Number(counts?.completed || 0),
        partial: Number(counts?.partial || 0),
        failed: Number(counts?.failed || 0),
        all: Number(counts?.all_count || 0)
      }
    }
  }

  getIngestionRunDossier(runId: string, options: {
    batchOffset?: number
    batchLimit?: number
  } = {}): any | null {
    if (!this.db || !String(runId || '').trim()) return null
    const run = this.db.prepare('SELECT * FROM ingestion_runs WHERE id=?').get(runId) as any
    if (!run) return null
    const batchOffset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.batchOffset) || 0)))
    const batchLimit = Math.max(1, Math.min(100, Math.floor(Number(options.batchLimit) || 40)))
    const batchTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM ingestion_batches WHERE run_id=?
    `).get(runId) as any)?.count || 0)
    const rows = this.db.prepare(`
      SELECT * FROM ingestion_batches WHERE run_id=?
      ORDER BY batch_index ASC LIMIT ? OFFSET ?
    `).all(runId, batchLimit, batchOffset) as any[]
    const batches = rows.map(batch => {
      let sensitiveRedaction: any = {}
      let structuredEvidence: any = {}
      let extractionContext: any = {}
      try { sensitiveRedaction = JSON.parse(String(batch.redaction_summary_json || '{}')) } catch {}
      try { structuredEvidence = JSON.parse(String(batch.evidence_validation_json || '{}')) } catch {}
      try { extractionContext = JSON.parse(String(batch.extraction_context_json || '{}')) } catch {}
      const {
        redaction_summary_json: _redactionJson,
        evidence_validation_json: _evidenceJson,
        extraction_context_json: _contextJson,
        ...safeBatch
      } = batch
      return { ...safeBatch, sensitiveRedaction, structuredEvidence, extractionContext }
    })
    return {
      ...run,
      batches,
      batchTotal,
      batchOffset,
      batchLimit,
      batchHasMore: batchOffset + batches.length < batchTotal
    }
  }

  getMergeSnapshot(id: number): any | null {
    if (!this.db) return null
    const row = this.db.prepare('SELECT snapshot_json FROM merge_history WHERE id=? AND reverted_at IS NULL').get(id) as { snapshot_json: string } | undefined
    return row ? JSON.parse(row.snapshot_json) : null
  }

  markMergeReverted(id: number): void {
    this.db?.prepare('UPDATE merge_history SET reverted_at=? WHERE id=? AND reverted_at IS NULL').run(new Date().toISOString(), id)
  }

  listScopedSearchDocumentIds(options: MemorySearchOptions = {}): Set<string> | null {
    if (!this.db) return new Set()
    const hasScope = Boolean(
      options.entityId ||
      options.sessionId ||
      options.from ||
      options.to ||
      options.documentTypes?.length ||
      options.relationTypes?.length
    )
    if (!hasScope) return null
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    const documentTypes = [...new Set((options.documentTypes || []).map(String).filter(Boolean))]
    if (documentTypes.length) {
      conditions.push(`d.document_type IN (${documentTypes.map(() => '?').join(',')})`)
      parameters.push(...documentTypes)
    }
    const relationTypes = [...new Set((options.relationTypes || [])
      .map(value => String(value).trim().toLowerCase()).filter(Boolean))]
    if (relationTypes.length) {
      conditions.push(`(
        d.document_type!='relation' OR (
          ${relationTypes.map(() => `(LOWER(d.title) LIKE ? OR LOWER(COALESCE(json_extract(d.metadata_json,'$.predicate'),'')) LIKE ?)`).join(' OR ')}
        )
      )`)
      for (const relationType of relationTypes) parameters.push(`%${relationType}%`, `%${relationType}%`)
    }
    if (options.sessionId) {
      const sessions = [...new Set([options.sessionId, options.sessionName].map(value => String(value || '')).filter(Boolean))]
      const placeholders = sessions.map(() => '?').join(',')
      conditions.push(`(
        EXISTS (SELECT 1 FROM search_document_evidence sde
          WHERE sde.document_id=d.id AND sde.session_id IN (${placeholders}))
        OR (d.document_type='claim' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.claim_id=d.source_id AND e.session_id IN (${placeholders})))
        OR (d.document_type='event' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.event_id=d.source_id AND e.session_id IN (${placeholders})))
        OR (d.document_type='relation' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.relation_id=d.source_id AND e.session_id IN (${placeholders})))
      )`)
      parameters.push(...sessions, ...sessions, ...sessions, ...sessions)
    }
    if (options.entityId) {
      const terms = [...new Set((options.entityTerms || []).map(value => String(value).trim().toLowerCase()).filter(Boolean))]
      const termConditions = terms.map(() => `(LOWER(d.title) LIKE ? OR LOWER(d.search_text) LIKE ?)`)
      conditions.push(`(
        (d.document_type='entity' AND d.source_id=?)
        OR COALESCE(json_extract(d.metadata_json,'$.subjectId'),'')=?
        OR COALESCE(json_extract(d.metadata_json,'$.objectId'),'')=?
        OR COALESCE(json_extract(d.metadata_json,'$.objectEntityId'),'')=?
        OR EXISTS (
          SELECT 1 FROM json_each(COALESCE(json_extract(d.metadata_json,'$.participantIds'),'[]'))
          WHERE CAST(json_each.value AS TEXT)=?
        )
        ${termConditions.length ? `OR ${termConditions.join(' OR ')}` : ''}
      )`)
      parameters.push(options.entityId, options.entityId, options.entityId, options.entityId, options.entityId)
      for (const term of terms) parameters.push(`%${term}%`, `%${term}%`)
    }
    const parseBoundary = (value: string | undefined, endOfDay: boolean): number | null => {
      const text = String(value || '').trim()
      if (!text) return null
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`
        : text
      const timestamp = Date.parse(normalized)
      return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
    }
    const from = parseBoundary(options.from, false)
    const to = parseBoundary(options.to, true)
    if (from !== null || to !== null) {
      const range = (expression: string) => [
        from === null ? '1=1' : `${expression}>=?`,
        to === null ? '1=1' : `${expression}<=?`
      ].join(' AND ')
      const addRangeParameters = () => {
        if (from !== null) parameters.push(from)
        if (to !== null) parameters.push(to)
      }
      const metadataExpressions = ['startAt', 'endAt', 'validFrom', 'validTo', 'due']
      conditions.push(`(
        EXISTS (SELECT 1 FROM search_document_evidence sde
          WHERE sde.document_id=d.id AND ${range('sde.timestamp')})
        OR (d.document_type='claim' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.claim_id=d.source_id AND ${range('e.timestamp')}))
        OR (d.document_type='event' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.event_id=d.source_id AND ${range('e.timestamp')}))
        OR (d.document_type='relation' AND EXISTS (SELECT 1 FROM evidence e
          WHERE e.relation_id=d.source_id AND ${range('e.timestamp')}))
        OR ${metadataExpressions.map(key =>
          `(json_extract(d.metadata_json,'$.${key}') IS NOT NULL AND ${range(`CAST(strftime('%s',json_extract(d.metadata_json,'$.${key}')) AS INTEGER)`)})`
        ).join(' OR ')}
      )`)
      for (let index = 0; index < 4 + metadataExpressions.length; index += 1) addRangeParameters()
    }
    if (!conditions.length) return null
    return new Set((this.db.prepare(`
      SELECT d.id FROM search_documents d WHERE ${conditions.join(' AND ')}
    `).all(...parameters) as Array<{ id: string }>).map(row => row.id))
  }

  private replaceActiveSearchScope(ids: Set<string>): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS active_memory_search_scope (
        id TEXT PRIMARY KEY
      ) WITHOUT ROWID;
      DELETE FROM active_memory_search_scope;
    `)
    const insert = this.db.prepare('INSERT INTO active_memory_search_scope(id) VALUES(?)')
    const transaction = this.db.transaction(() => {
      for (const id of ids) insert.run(id)
    })
    transaction()
  }

  listSearchDocumentsInScope(allowedIds: Set<string>, limit = 500): any[] {
    if (!this.db || !allowedIds.size) return []
    this.replaceActiveSearchScope(allowedIds)
    return this.db.prepare(`
      SELECT d.* FROM search_documents d
      JOIN active_memory_search_scope scope ON scope.id=d.id
      ORDER BY d.updated_at DESC,d.id LIMIT ?
    `).all(Math.max(1, Math.min(500, Number(limit) || 500))) as any[]
  }

  searchText(query: string, limit = 20, allowedIds: Set<string> | null = null): any[] {
    if (!this.db || !query.trim()) return []
    if (allowedIds && !allowedIds.size) return []
    const safeLimit = Math.max(1, Math.min(500, limit))
    const normalized = query.trim().replace(/["']/g, ' ')
    if (allowedIds) this.replaceActiveSearchScope(allowedIds)
    const scopeJoin = allowedIds ? 'JOIN active_memory_search_scope scope ON scope.id=d.id' : ''
    let exactMatches: any[] = []
    try {
      const matches = this.db.prepare(`
        SELECT d.*, bm25(search_fts) AS rank
        FROM search_fts JOIN search_documents d ON d.id = search_fts.document_id ${scopeJoin}
        WHERE search_fts MATCH ?
        ORDER BY rank LIMIT ?
      `).all(normalized, safeLimit) as any[]
      exactMatches = matches
    } catch {}
    if (!exactMatches.length) {
      exactMatches = this.db.prepare(`
        SELECT d.*,0 AS rank FROM search_documents d ${scopeJoin}
        WHERE d.title LIKE ? OR d.search_text LIKE ? ORDER BY d.updated_at DESC LIMIT ?
      `).all(`%${normalized}%`, `%${normalized}%`, safeLimit) as any[]
    }
    if (exactMatches.length >= safeLimit) return exactMatches
    const knownIds = new Set(exactMatches.map(item => item.id))
    const fuzzyMatches = (this.db.prepare(`
      SELECT d.*,0 AS rank FROM search_documents d ${scopeJoin} WHERE d.document_type='entity'
    `).all() as any[]).flatMap(item => {
      if (knownIds.has(item.id)) return []
      const terms = [item.title, ...String(item.search_text || '').split('；')]
      const phoneticScore = pinyinEntityScore(normalized, terms)
      const fuzzyScore = fuzzyEntityScore(normalized, terms)
      const score = phoneticScore === null ? fuzzyScore : phoneticScore
      return score === null ? [] : [{
        ...item,
        rank: 50 + score,
        match_reason: phoneticScore !== null
          ? 'pinyin_entity'
          : fuzzyScore === 0 ? 'entity_alias_or_account' : 'fuzzy_entity'
      }]
    }).sort((left, right) => left.rank - right.rank)
    return [...exactMatches, ...fuzzyMatches].slice(0, safeLimit)
  }

  listEmbeddingCandidates(model: string, limit = 100): any[] {
    if (!this.db) return []
    return this.db.prepare(`
      SELECT id,title,search_text,content_hash FROM search_documents
      WHERE embedding_json IS NULL OR embedding_model IS NULL OR embedding_model!=?
      ORDER BY updated_at DESC LIMIT ?
    `).all(model, Math.max(1, Math.min(1000, limit))) as any[]
  }

  saveEmbedding(id: string, model: string, vector: number[]): void {
    if (!this.db || !vector.length) return
    this.db.prepare(`
      UPDATE search_documents SET embedding_model=?,embedding_dimensions=?,embedding_json=? WHERE id=?
    `).run(model, vector.length, JSON.stringify(vector), id)
  }

  getEmbeddingStats(model: string): any {
    if (!this.db) return {
      total: 0, indexed: 0, pending: 0, model,
      ann: { mode: 'exact', active: false, indexed: 0, eligible: 0, coverage: 0 }
    }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN embedding_model=? AND embedding_json IS NOT NULL THEN 1 ELSE 0 END) AS indexed
      FROM search_documents
    `).get(model) as { total: number; indexed: number }
    const indexed = Number(row.indexed || 0)
    return {
      total: Number(row.total || 0),
      indexed,
      pending: Number(row.total || 0) - indexed,
      model,
      ann: this.getApproximateVectorIndexStats(model)
    }
  }

  getApproximateVectorIndexStats(model: string, dimensions?: number): any {
    if (!this.db) return { mode: 'exact', active: false, indexed: 0, eligible: 0, coverage: 0 }
    const eligible = this.db.prepare(`
      SELECT COUNT(*) AS count FROM search_documents
      WHERE embedding_model=? AND embedding_json IS NOT NULL
        AND (? IS NULL OR embedding_dimensions=?)
    `).get(model, dimensions ?? null, dimensions ?? null) as { count: number }
    const state = this.db.prepare(`
      SELECT * FROM vector_ann_state WHERE model=?
        AND (? IS NULL OR dimensions=?)
      ORDER BY indexed_count DESC LIMIT 1
    `).get(model, dimensions ?? null, dimensions ?? null) as any
    const eligibleCount = Number(eligible?.count || 0)
    const actual = state ? this.db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT e.document_id FROM vector_ann_entries e
        JOIN search_documents d ON d.id=e.document_id
          AND d.content_hash=e.content_hash
          AND d.embedding_model=e.model
          AND d.embedding_dimensions=e.dimensions
          AND d.embedding_json IS NOT NULL
        WHERE e.model=? AND e.dimensions=?
        GROUP BY e.document_id
        HAVING COUNT(DISTINCT e.table_id)=?
      )
    `).get(model, Number(state.dimensions), Number(state.table_count)) as { count: number } : { count: 0 }
    const indexedCount = Number(actual?.count || 0)
    const active = Boolean(
      state &&
      state.status === 'ready' &&
      state.index_version === LOCAL_ANN_INDEX_VERSION &&
      indexedCount === eligibleCount &&
      eligibleCount >= LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS
    )
    return {
      mode: active ? 'ann' : 'exact',
      active,
      status: state?.status || 'not_built',
      version: state?.index_version || LOCAL_ANN_INDEX_VERSION,
      dimensions: Number(state?.dimensions || dimensions || 0),
      tables: Number(state?.table_count || LOCAL_ANN_DEFAULT_TABLES),
      bits: Number(state?.bit_count || LOCAL_ANN_DEFAULT_BITS),
      indexed: indexedCount,
      eligible: eligibleCount,
      coverage: eligibleCount ? Math.min(1, indexedCount / eligibleCount) : 0,
      minimumDocuments: LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS,
      lastBuiltAt: state?.last_built_at || null
    }
  }

  ensureApproximateVectorIndex(
    model: string,
    options: {
      minimumDocuments?: number
      tables?: number
      bits?: number
      force?: boolean
    } = {}
  ): any {
    if (!this.db) return { rebuilt: false, ...this.getApproximateVectorIndexStats(model) }
    const minimumDocuments = Math.max(1, Number(options.minimumDocuments || LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS))
    const tables = Math.max(2, Math.min(12, Number(options.tables || LOCAL_ANN_DEFAULT_TABLES)))
    const bits = Math.max(4, Math.min(20, Number(options.bits || LOCAL_ANN_DEFAULT_BITS)))
    const groups = this.db.prepare(`
      SELECT embedding_dimensions AS dimensions,COUNT(*) AS count
      FROM search_documents
      WHERE embedding_model=? AND embedding_json IS NOT NULL
      GROUP BY embedding_dimensions ORDER BY count DESC
    `).all(model) as Array<{ dimensions: number; count: number }>
    const group = groups[0]
    if (!group || Number(group.count) < minimumDocuments) {
      return { rebuilt: false, ...this.getApproximateVectorIndexStats(model, Number(group?.dimensions || 0)) }
    }
    const dimensions = Number(group.dimensions)
    const existing = this.db.prepare(`
      SELECT * FROM vector_ann_state WHERE model=? AND dimensions=?
    `).get(model, dimensions) as any
    const currentStats = this.getApproximateVectorIndexStats(model, dimensions)
    if (!options.force &&
      existing?.status === 'ready' &&
      existing?.index_version === LOCAL_ANN_INDEX_VERSION &&
      Number(existing.table_count) === tables &&
      Number(existing.bit_count) === bits &&
      currentStats.indexed === Number(group.count)) {
      return { rebuilt: false, ...currentStats }
    }
    const documents = this.db.prepare(`
      SELECT id,content_hash,embedding_json FROM search_documents
      WHERE embedding_model=? AND embedding_dimensions=? AND embedding_json IS NOT NULL
      ORDER BY id
    `).all(model, dimensions) as Array<{ id: string; content_hash: string; embedding_json: string }>
    const now = new Date().toISOString()
    const replace = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM vector_ann_entries WHERE model=? AND dimensions=?').run(model, dimensions)
      const insert = this.db!.prepare(`
        INSERT INTO vector_ann_entries(
          document_id,model,dimensions,table_id,signature,content_hash,updated_at
        ) VALUES(?,?,?,?,?,?,?)
      `)
      for (const document of documents) {
        let vector: number[] = []
        try { vector = JSON.parse(document.embedding_json).map(Number) } catch {}
        if (vector.length !== dimensions) continue
        computeAnnSignatures(vector, model, tables, bits).forEach((signature, table) =>
          insert.run(document.id, model, dimensions, table, signature, document.content_hash, now))
      }
      this.db!.prepare(`
        INSERT INTO vector_ann_state(
          model,dimensions,index_version,table_count,bit_count,indexed_count,status,last_built_at,updated_at
        ) VALUES(?,?,?,?,?,?,'ready',?,?)
        ON CONFLICT(model,dimensions) DO UPDATE SET
          index_version=excluded.index_version,
          table_count=excluded.table_count,
          bit_count=excluded.bit_count,
          indexed_count=excluded.indexed_count,
          status='ready',
          last_built_at=excluded.last_built_at,
          updated_at=excluded.updated_at
      `).run(model, dimensions, LOCAL_ANN_INDEX_VERSION, tables, bits, documents.length, now, now)
    })
    replace()
    return { rebuilt: true, ...this.getApproximateVectorIndexStats(model, dimensions) }
  }

  private searchVectorExact(
    vector: number[],
    model: string,
    limit: number,
    allowedIds: Set<string> | null = null
  ): any[] {
    if (!this.db) return []
    if (allowedIds && !allowedIds.size) return []
    if (allowedIds) this.replaceActiveSearchScope(allowedIds)
    const scopeJoin = allowedIds ? 'JOIN active_memory_search_scope scope ON scope.id=d.id' : ''
    const rows = this.db.prepare(`
      SELECT d.* FROM search_documents d ${scopeJoin}
      WHERE d.embedding_model=? AND d.embedding_dimensions=? AND d.embedding_json IS NOT NULL
    `).all(model, vector.length) as any[]
    return this.rankVectorRows(rows, vector, limit, 'exact')
  }

  private rankVectorRows(rows: any[], vector: number[], limit: number, mode: 'exact' | 'ann'): any[] {
    return rows.map(row => {
      let candidate: number[] = []
      try { candidate = JSON.parse(row.embedding_json) } catch {}
      let score = 0
      for (let index = 0; index < vector.length && index < candidate.length; index += 1) score += vector[index] * candidate[index]
      return { ...row, semantic_score: score, semantic_search_mode: mode }
    }).sort((left, right) => right.semantic_score - left.semantic_score)
      .slice(0, Math.max(1, Math.min(500, limit)))
  }

  searchVector(
    vector: number[],
    model: string,
    limit = 20,
    options: {
      minimumDocuments?: number
      minimumCandidates?: number
      allowedIds?: Set<string> | null
    } = {}
  ): any[] {
    if (!this.db || !vector.length) return []
    const allowedIds = options.allowedIds ?? null
    if (allowedIds && !allowedIds.size) return []
    if (allowedIds) this.replaceActiveSearchScope(allowedIds)
    const minimumDocuments = Math.max(1, Number(options.minimumDocuments || LOCAL_ANN_DEFAULT_MINIMUM_DOCUMENTS))
    const stats = this.getApproximateVectorIndexStats(model, vector.length)
    const canUseAnn = stats.status === 'ready' &&
      stats.version === LOCAL_ANN_INDEX_VERSION &&
      stats.indexed === stats.eligible &&
      stats.eligible >= minimumDocuments
    if (!canUseAnn) return this.searchVectorExact(vector, model, limit, allowedIds)
    const signatures = computeAnnSignatures(vector, model, stats.tables, stats.bits)
    const candidateIds = new Set<string>()
    const lookup = this.db.prepare(`
      SELECT document_id FROM vector_ann_entries
      WHERE model=? AND dimensions=? AND table_id=? AND signature IN (${Array.from({ length: stats.bits + 1 }, () => '?').join(',')})
    `)
    signatures.forEach((signature, table) => {
      const probes = listMultiProbeSignatures(signature, stats.bits)
      for (const row of lookup.all(model, vector.length, table, ...probes) as Array<{ document_id: string }>) {
        if (!allowedIds || allowedIds.has(row.document_id)) candidateIds.add(row.document_id)
      }
    })
    const minimumCandidates = Math.max(
      limit,
      Number(options.minimumCandidates || Math.max(64, Math.min(256, limit * 2)))
    )
    const scopedEligible = allowedIds
      ? Number((this.db.prepare(`
          SELECT COUNT(*) AS count FROM search_documents d
          JOIN active_memory_search_scope scope ON scope.id=d.id
          WHERE d.embedding_model=? AND d.embedding_dimensions=? AND d.embedding_json IS NOT NULL
        `).get(model, vector.length) as any)?.count || 0)
      : stats.eligible
    if (candidateIds.size < Math.min(minimumCandidates, scopedEligible)) {
      return this.searchVectorExact(vector, model, limit, allowedIds)
    }
    const ids = [...candidateIds]
    const rows: any[] = []
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500)
      rows.push(...this.db.prepare(`
        SELECT d.* FROM search_documents d
        WHERE d.id IN (${chunk.map(() => '?').join(',')})
          AND d.embedding_model=? AND d.embedding_dimensions=? AND d.embedding_json IS NOT NULL
      `).all(...chunk, model, vector.length) as any[])
    }
    return this.rankVectorRows(rows, vector, limit, 'ann')
  }

  listSimilarEntityPairs(model: string, minimumScore = 0.88, limit = 200): Array<{ leftId: string; rightId: string; score: number }> {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT source_id,embedding_json FROM search_documents
      WHERE document_type='entity' AND embedding_model=? AND embedding_json IS NOT NULL
    `).all(model) as Array<{ source_id: string; embedding_json: string }>
    const vectors = rows.flatMap(row => {
      try {
        const vector = JSON.parse(row.embedding_json)
        return Array.isArray(vector) && vector.length ? [{ id: row.source_id, vector: vector.map(Number) }] : []
      } catch {
        return []
      }
    })
    const pairs: Array<{ leftId: string; rightId: string; score: number }> = []
    for (let leftIndex = 0; leftIndex < vectors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < vectors.length; rightIndex += 1) {
        let score = 0
        const dimensions = Math.min(vectors[leftIndex].vector.length, vectors[rightIndex].vector.length)
        for (let index = 0; index < dimensions; index += 1) {
          score += vectors[leftIndex].vector[index] * vectors[rightIndex].vector[index]
        }
        if (score >= minimumScore) pairs.push({
          leftId: vectors[leftIndex].id,
          rightId: vectors[rightIndex].id,
          score
        })
      }
    }
    return pairs.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(1000, limit)))
  }

  getDocumentEvidencePayload(documentType: string, sourceId: string): { evidence: any[]; evidenceTotal: number } {
    if (!this.db) return { evidence: [], evidenceTotal: 0 }
    const documentId = `${documentType}:${sourceId}`
    const genericTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM search_document_evidence WHERE document_id=?
    `).get(documentId) as any)?.count || 0)
    if (genericTotal) {
      const evidence = (this.db.prepare(`
        SELECT message_id,session_id,timestamp,sender,excerpt
        FROM search_document_evidence
        WHERE document_id=?
        ORDER BY timestamp DESC,message_id DESC
        LIMIT ?
      `).all(documentId, MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
      return { evidence, evidenceTotal: genericTotal }
    }
    const foreignKey = documentType === 'claim'
      ? 'claim_id'
      : documentType === 'event'
        ? 'event_id'
        : documentType === 'relation'
          ? 'relation_id'
          : ''
    if (!foreignKey) return { evidence: [], evidenceTotal: 0 }
    const evidenceTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM evidence WHERE ${foreignKey}=?
    `).get(sourceId) as any)?.count || 0)
    if (!evidenceTotal) return { evidence: [], evidenceTotal: 0 }
    const evidence = (this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
      FROM evidence
      WHERE ${foreignKey}=?
      ORDER BY timestamp DESC,
        CASE WHEN evidence_role='contradiction' THEN 0 ELSE 1 END,
        message_id DESC
      LIMIT ?
    `).all(sourceId, MEMORY_CARD_EVIDENCE_LIMIT) as any[]).reverse()
    return { evidence, evidenceTotal }
  }

  getDocumentEvidence(documentType: string, sourceId: string): any[] {
    return this.getDocumentEvidencePayload(documentType, sourceId).evidence
  }

  getDocumentEvidencePage(
    documentType: string,
    sourceId: string,
    options: { offset?: number; limit?: number } = {}
  ): {
    items: any[]
    total: number
    hasMore: boolean
    offset: number
    limit: number
    documentType: string
    sourceId: string
  } {
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)))
    const empty = {
      items: [],
      total: 0,
      hasMore: false,
      offset,
      limit,
      documentType,
      sourceId
    }
    if (!this.db) return empty
    const documentId = `${documentType}:${sourceId}`
    const genericTotal = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM search_document_evidence WHERE document_id=?
    `).get(documentId) as any)?.count || 0)
    if (genericTotal) {
      const items = this.db.prepare(`
        SELECT message_id,session_id,timestamp,sender,excerpt
        FROM search_document_evidence
        WHERE document_id=?
        ORDER BY timestamp DESC,message_id DESC
        LIMIT ? OFFSET ?
      `).all(documentId, limit, offset) as any[]
      return {
        ...empty,
        items,
        total: genericTotal,
        hasMore: offset + items.length < genericTotal
      }
    }
    const foreignKey = documentType === 'claim'
      ? 'claim_id'
      : documentType === 'event'
        ? 'event_id'
        : documentType === 'relation'
          ? 'relation_id'
          : ''
    if (!foreignKey) return empty
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM evidence WHERE ${foreignKey}=?
    `).get(sourceId) as any)?.count || 0)
    const items = total
      ? this.db.prepare(`
          SELECT message_id,session_id,timestamp,sender,excerpt,evidence_role
          FROM evidence
          WHERE ${foreignKey}=?
          ORDER BY timestamp DESC,
            CASE WHEN evidence_role='contradiction' THEN 1 ELSE 0 END,
            message_id DESC
          LIMIT ? OFFSET ?
        `).all(sourceId, limit, offset) as any[]
      : []
    return {
      ...empty,
      items,
      total,
      hasMore: offset + items.length < total
    }
  }

  saveAssistantExchange(question: string, answer: string, citations: any[], conversationId?: string): string {
    if (!this.db) return ''
    const existing = conversationId
      ? this.db.prepare('SELECT updated_at FROM assistant_conversations WHERE id=?').get(conversationId) as any
      : null
    const previousMs = Number.isFinite(Date.parse(String(existing?.updated_at || '')))
      ? Date.parse(String(existing.updated_at))
      : 0
    const questionMs = Math.max(Date.now(), previousMs + 1)
    const now = new Date(questionMs).toISOString()
    const answerAt = new Date(questionMs + 1).toISOString()
    const id = conversationId || `chat_${questionMs}_${Math.random().toString(16).slice(2)}`
    this.db.prepare(`
      INSERT INTO assistant_conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(id, question.slice(0, 80), now, answerAt)
    const insert = this.db.prepare('INSERT INTO assistant_messages(id,conversation_id,role,content,citations_json,created_at) VALUES(?,?,?,?,?,?)')
    const messageNonce = Math.random().toString(16).slice(2)
    insert.run(`msg_${Date.now()}_${messageNonce}_q`, id, 'user', question, '[]', now)
    insert.run(`msg_${Date.now()}_${messageNonce}_a`, id, 'assistant', answer, JSON.stringify(citations || []), answerAt)
    return id
  }

  listAssistantConversationsPage(options: {
    query?: string
    from?: string
    to?: string
    offset?: number
    limit?: number
  } = {}): { items: any[]; total: number; hasMore: boolean; offset: number; limit: number } {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 30)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.offset) || 0)))
    if (!this.db) return { items: [], total: 0, hasMore: false, offset, limit }
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN')
    if (query) {
      conditions.push(`(
        instr(lower(c.title),?)>0 OR EXISTS (
          SELECT 1 FROM assistant_messages searched
          WHERE searched.conversation_id=c.id AND instr(lower(searched.content),?)>0
        )
      )`)
      parameters.push(query, query)
    }
    const from = options.from && Number.isFinite(Date.parse(options.from)) ? String(options.from) : ''
    const to = options.to && Number.isFinite(Date.parse(options.to)) ? String(options.to) : ''
    if (from) {
      conditions.push('c.updated_at>=?')
      parameters.push(from)
    }
    if (to) {
      conditions.push('c.updated_at<=?')
      parameters.push(to)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM assistant_conversations c ${where}
    `).get(...parameters) as any)?.count || 0)
    const items = this.db.prepare(`
      SELECT c.id,c.title,c.created_at,c.updated_at,COUNT(m.id) AS message_count,
        COALESCE((
          SELECT content FROM assistant_messages latest
          WHERE latest.conversation_id=c.id
          ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
        ),'') AS preview
      FROM assistant_conversations c
      LEFT JOIN assistant_messages m ON m.conversation_id=c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as any[]
    return { items, total, hasMore: offset + items.length < total, offset, limit }
  }

  listAssistantConversations(limit = 30): any[] {
    return this.listAssistantConversationsPage({ limit }).items
  }

  getAssistantArchiveStats(): {
    total: number
    latestId: string
    latestUpdatedAt: string
    latestMessageCount: number
  } {
    if (!this.db) return { total: 0, latestId: '', latestUpdatedAt: '', latestMessageCount: 0 }
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM assistant_conversations
    `).get() as any)?.count || 0)
    const latest = this.db.prepare(`
      SELECT c.id,c.updated_at,COUNT(m.id) AS message_count
      FROM assistant_conversations c
      LEFT JOIN assistant_messages m ON m.conversation_id=c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC,c.id DESC LIMIT 1
    `).get() as any
    return {
      total,
      latestId: String(latest?.id || ''),
      latestUpdatedAt: String(latest?.updated_at || ''),
      latestMessageCount: Number(latest?.message_count || 0)
    }
  }

  getAssistantConversation(id: string, options: number | {
    offset?: number
    limit?: number
  } = 40): any {
    if (!this.db) return null
    const conversation = this.db.prepare(`
      SELECT id,title,created_at,updated_at FROM assistant_conversations WHERE id=?
    `).get(id) as any
    if (!conversation) return null
    const limit = Math.max(1, Math.min(200, Math.floor(Number(
      typeof options === 'number' ? options : options.limit
    ) || 40)))
    const offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(
      typeof options === 'number' ? 0 : options.offset
    ) || 0)))
    const total = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM assistant_messages WHERE conversation_id=?
    `).get(id) as any)?.count || 0)
    const rows = this.db.prepare(`
      SELECT id,role,content,citations_json,created_at FROM (
        SELECT id,role,content,citations_json,created_at
        FROM assistant_messages WHERE conversation_id=?
        ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?
      ) ORDER BY created_at,id
    `).all(id, limit, offset) as any[]
    return {
      ...conversation,
      total,
      offset,
      limit,
      hasOlder: offset + rows.length < total,
      messages: rows.map(row => {
        let citations: any[] = []
        try { citations = JSON.parse(String(row.citations_json || '[]')) } catch {}
        return { ...row, citations }
      })
    }
  }

  deleteAssistantConversation(id: string): boolean {
    if (!this.db) return false
    return this.db.prepare('DELETE FROM assistant_conversations WHERE id=?').run(id).changes > 0
  }

  getRecentAssistantExchanges(limit = 10): any[] {
    if (!this.db) return []
    return this.db.prepare(`
      SELECT m.*,c.title FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id
      ORDER BY m.created_at DESC LIMIT ?
    `).all(limit * 2) as any[]
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

  registerDataSources(catalog: readonly any[]): void {
    if (!this.db) return
    const now = new Date().toISOString()
    const statement = this.db.prepare(`
      INSERT INTO data_source_connectors(
        source_id,source_kind,display_name,description,enabled,available,local_only,
        capabilities_json,checkpoint,status,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'idle',?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_kind=excluded.source_kind,display_name=excluded.display_name,
        description=excluded.description,available=excluded.available,
        local_only=excluded.local_only,capabilities_json=excluded.capabilities_json,
        updated_at=excluded.updated_at
    `)
    const transaction = this.db.transaction(() => {
      for (const source of catalog) {
        statement.run(
          String(source.id), String(source.kind), String(source.displayName),
          String(source.description || ''), source.id === 'wechat' ? 1 : 0,
          source.available ? 1 : 0, source.localOnly ? 1 : 0,
          JSON.stringify(source.capabilities || []), '', now
        )
      }
    })
    transaction()
    this.db.prepare(`
      UPDATE data_source_connectors
      SET status='error',last_error='上次连接器运行被应用退出中断，将从原 checkpoint 重试',updated_at=?
      WHERE status='running'
    `).run(now)
  }

  listDataSources(): any[] {
    if (!this.db) return []
    const rows = this.db.prepare('SELECT * FROM data_source_connectors ORDER BY available DESC,source_id').all() as any[]
    return rows.map(row => ({
      id: row.source_id,
      kind: row.source_kind,
      displayName: row.display_name,
      description: row.description,
      enabled: row.enabled === 1,
      available: row.available === 1,
      localOnly: row.local_only === 1,
      capabilities: JSON.parse(row.capabilities_json || '[]'),
      config: JSON.parse(row.config_json || '{}'),
      checkpoint: row.checkpoint,
      status: row.status,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      updatedAt: row.updated_at
    }))
  }

  setDataSourceEnabled(sourceId: string, enabled: boolean): any {
    if (!this.db) throw new Error('个人记忆数据库尚未初始化')
    const source = this.db.prepare('SELECT available FROM data_source_connectors WHERE source_id=?').get(sourceId) as any
    if (!source) throw new Error('未知数据源')
    if (enabled && source.available !== 1) throw new Error('该数据源连接器尚未安装')
    this.db.prepare('UPDATE data_source_connectors SET enabled=?,updated_at=? WHERE source_id=?')
      .run(enabled ? 1 : 0, new Date().toISOString(), sourceId)
    return this.listDataSources().find(item => item.id === sourceId)
  }

  configureDataSource(sourceId: string, config: Record<string, unknown>, available: boolean): any {
    if (!this.db) throw new Error('个人记忆数据库尚未初始化')
    const source = this.db.prepare('SELECT 1 FROM data_source_connectors WHERE source_id=?').get(sourceId)
    if (!source) throw new Error('未知数据源')
    this.db.prepare(`
      UPDATE data_source_connectors
      SET config_json=?,available=?,enabled=?,checkpoint='',status='idle',
        last_error=NULL,updated_at=?
      WHERE source_id=?
    `).run(JSON.stringify(config || {}), available ? 1 : 0, available ? 1 : 0, new Date().toISOString(), sourceId)
    return this.listDataSources().find(item => item.id === sourceId)
  }

  setDataSourceAvailability(sourceId: string, available: boolean, error = ''): void {
    if (!this.db) return
    if (available) {
      this.db.prepare(`
        UPDATE data_source_connectors SET available=1,updated_at=? WHERE source_id=?
      `).run(new Date().toISOString(), sourceId)
      return
    }
    this.db.prepare(`
      UPDATE data_source_connectors SET available=0,status='error',last_error=?,updated_at=? WHERE source_id=?
    `).run(error || '该数据源连接器当前不可用', new Date().toISOString(), sourceId)
  }

  listPendingDocumentAnalysis(version: string, limit = 2, now = new Date()): any[] {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT r.* FROM memory_resources r
      LEFT JOIN resource_suppressions s ON s.resource_id=r.id
      WHERE r.resource_type='document' AND s.resource_id IS NULL
      ORDER BY r.updated_at ASC
    `).all() as any[]
    const evidence = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt
      FROM search_document_evidence WHERE document_id=? ORDER BY timestamp DESC LIMIT 1
    `)
    return rows.flatMap(row => {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        if (metadata.sourceId !== 'documents') return []
        if (metadata.documentAnalysisVersion === version &&
            metadata.documentAnalysisContentHash === metadata.contentHash &&
            metadata.documentAnalysisStatus === 'completed') return []
        if (metadata.documentAnalysisNextAt && Date.parse(metadata.documentAnalysisNextAt) > now.getTime()) return []
        return [{
          ...row,
          metadata,
          evidence: evidence.all(`resource:${row.id}`) as any[]
        }]
      } catch {
        return []
      }
    }).slice(0, Math.max(1, Math.min(10, limit)))
  }

  getDocumentAnalysisStats(version: string, now = new Date()): any {
    if (!this.db) return { total: 0, completed: 0, pending: 0, deferred: 0, failed: 0 }
    const rows = this.db.prepare(`
      SELECT metadata_json FROM memory_resources WHERE resource_type='document'
    `).all() as Array<{ metadata_json: string }>
    const stats = { total: 0, completed: 0, pending: 0, deferred: 0, failed: 0 }
    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata_json || '{}')
        if (metadata.sourceId !== 'documents') continue
        stats.total += 1
        const completed = metadata.documentAnalysisVersion === version &&
          metadata.documentAnalysisContentHash === metadata.contentHash &&
          metadata.documentAnalysisStatus === 'completed'
        if (completed) stats.completed += 1
        else if (metadata.documentAnalysisNextAt && Date.parse(metadata.documentAnalysisNextAt) > now.getTime()) {
          stats.deferred += 1
        } else {
          stats.pending += 1
        }
        if (metadata.documentAnalysisStatus === 'failed') stats.failed += 1
      } catch {}
    }
    return stats
  }

  updateDataSourceRun(sourceId: string, patch: {
    status: 'idle' | 'running' | 'healthy' | 'error'
    checkpoint?: string
    attemptedAt?: string
    succeededAt?: string
    error?: string
  }): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE data_source_connectors SET status=?,
        checkpoint=COALESCE(?,checkpoint),
        last_attempt_at=COALESCE(?,last_attempt_at),
        last_success_at=COALESCE(?,last_success_at),
        last_error=?,updated_at=?
      WHERE source_id=?
    `).run(
      patch.status, patch.checkpoint ?? null, patch.attemptedAt ?? null,
      patch.succeededAt ?? null, patch.error || null, new Date().toISOString(), sourceId
    )
  }

  private upsertSearchDocument(id: string, type: string, sourceId: string, title: string, searchText: string, metadata: any, now: string): void {
    if (!this.db) return
    const hash = createHash('sha256').update(searchText).digest('hex')
    this.db.prepare(`
      INSERT INTO search_documents(id,document_type,source_id,title,search_text,metadata_json,content_hash,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,search_text=excluded.search_text,
        metadata_json=excluded.metadata_json,
        embedding_model=CASE WHEN search_documents.content_hash=excluded.content_hash THEN search_documents.embedding_model ELSE NULL END,
        embedding_dimensions=CASE WHEN search_documents.content_hash=excluded.content_hash THEN search_documents.embedding_dimensions ELSE NULL END,
        embedding_json=CASE WHEN search_documents.content_hash=excluded.content_hash THEN search_documents.embedding_json ELSE NULL END,
        content_hash=excluded.content_hash,updated_at=excluded.updated_at
    `).run(id, type, sourceId, title, searchText, JSON.stringify(metadata), hash, now)
    this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(id)
    this.db.prepare('INSERT INTO search_fts(document_id,title,search_text) VALUES(?,?,?)').run(id, title, searchText)
  }
}

export const personalMemoryStore = new PersonalMemoryStore()
