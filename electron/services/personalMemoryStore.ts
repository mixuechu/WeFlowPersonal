import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fuzzyEntityScore, pinyinEntityScore } from './fuzzyEntitySearch.ts'

type MemoryGraph = {
  entities: any[]
  relations: any[]
  reviewQueue: any[]
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
    this.ensureColumn('ingestion_batches', 'model', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'prompt_version', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'schema_version', `TEXT NOT NULL DEFAULT ''`)
    this.ensureColumn('ingestion_batches', 'input_tokens', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'output_tokens', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'duration_ms', `INTEGER NOT NULL DEFAULT 0`)
    this.ensureColumn('ingestion_batches', 'redaction_summary_json', `TEXT NOT NULL DEFAULT '{}'`)
    this.ensureColumn('memory_item_suppressions', 'semantic_fingerprint', `TEXT NOT NULL DEFAULT ''`)
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
      this.db.prepare('DELETE FROM review_queue WHERE payload_json LIKE ?').run(`%${entityId}%`)
      this.db.prepare('DELETE FROM merge_history WHERE source_entity_id=? OR target_entity_id=?').run(entityId, entityId)
      this.db.prepare('DELETE FROM identity_decisions WHERE left_entity_id=? OR right_entity_id=?').run(entityId, entityId)
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

  registerImportedBackup(databaseBytes: Uint8Array, stateText: string, sourceEncryptionKey?: Buffer | string): any {
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
      writeFileSync(`${backupPath}.state.json`, stateText, 'utf8')
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
      const insertIdentity = this.db.prepare(`INSERT INTO identities(entity_id,platform,account_id,display_name,confidence) VALUES(?,?,?,?,?)
        ON CONFLICT(platform,account_id) DO UPDATE SET entity_id=excluded.entity_id, display_name=excluded.display_name, confidence=excluded.confidence`)
      for (const entity of graph.entities) {
        upsertEntity.run(entity.id, entity.type, entity.canonicalName, entity.summary || '', Number(entity.confidence || 0), entity.createdAt || now, entity.updatedAt || now, Number(entity.identityVersion || 1), entity.lastDisambiguatedAt || null)
        for (const alias of entity.aliases || []) insertAlias.run(entity.id, alias, String(alias).trim().toLowerCase(), 'name', 1)
        for (const accountId of entity.accountIds || []) insertIdentity.run(entity.id, 'wechat', accountId, entity.canonicalName, 1)
        this.upsertSearchDocument(`entity:${entity.id}`, 'entity', entity.id, entity.canonicalName,
          [entity.canonicalName, ...(entity.aliases || []), ...(entity.accountIds || []), entity.summary || ''].join('；'),
          { entityType: entity.type, accountIds: entity.accountIds || [] }, now)
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
      const insertEvidence = this.db.prepare(`INSERT OR IGNORE INTO evidence(relation_id,message_id,session_id,timestamp,excerpt,evidence_role) VALUES(?,?,?,?,?,'direct')`)
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
        for (const evidence of relation.evidence || []) insertEvidence.run(relation.id, evidence.messageId, evidence.sessionId, Number(evidence.timestamp || 0), evidence.excerpt || '')
        this.upsertSearchDocument(`relation:${relation.id}`, 'relation', relation.id, relation.predicate, searchText,
          { subjectId: relation.subjectId, objectId: relation.objectId, predicate: relation.predicate, status: relation.status }, now)
      }
      const upsertReview = this.db.prepare(`
        INSERT INTO review_queue(id,kind,title,detail,confidence,status,payload_json,created_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,confidence=excluded.confidence,
          status=excluded.status,payload_json=excluded.payload_json
      `)
      for (const review of graph.reviewQueue) {
        if (review.kind === 'relation' && review.relationId && this.isMemoryItemSuppressed('relation', review.relationId)) continue
        upsertReview.run(review.id, review.kind, review.title, review.detail || '', Number(review.confidence || 0), review.status, JSON.stringify(review), review.createdAt || now)
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
    const result = this.db.prepare('INSERT INTO merge_history(source_entity_id,target_entity_id,snapshot_json,created_at) VALUES(?,?,?,?)')
      .run(sourceId, targetId, JSON.stringify(snapshot), new Date().toISOString())
    return Number(result.lastInsertRowid)
  }

  listActiveMerges(limit = 20): any[] {
    if (!this.db) return []
    return this.db.prepare('SELECT id,source_entity_id,target_entity_id,created_at FROM merge_history WHERE reverted_at IS NULL ORDER BY id DESC LIMIT ?').all(limit) as any[]
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
      INSERT OR IGNORE INTO evidence(claim_id,message_id,session_id,timestamp,excerpt,evidence_role)
      VALUES(?,?,?,?,?,?)
    `)
    for (const claim of claims) {
      if (this.isMemoryItemSuppressed('claim', claim.id, this.memoryItemSemanticFingerprint('claim', claim))) continue
      const sourceNature = claim.sourceNature || 'inference'
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
        evidence.run(claim.id, item.messageId, item.sessionId, item.timestamp, item.excerpt, evidenceRole)
      }
      for (const prior of conflicting) {
        for (const item of claim.evidence || []) {
          evidence.run(prior.id, item.messageId, item.sessionId, item.timestamp, item.excerpt, 'contradiction')
        }
        const priorEvidence = this.db.prepare(`
          SELECT message_id,session_id,timestamp,excerpt FROM evidence
          WHERE claim_id=? AND evidence_role!='contradiction'
        `).all(prior.id) as any[]
        for (const item of priorEvidence) {
          evidence.run(claim.id, item.message_id, item.session_id, item.timestamp, item.excerpt, 'contradiction')
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
      INSERT INTO events(id,event_type,title,description,start_at,end_at,location,confidence,status,search_text,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description,start_at=COALESCE(excluded.start_at,start_at),
        end_at=COALESCE(excluded.end_at,end_at),location=COALESCE(excluded.location,location),
        confidence=MAX(confidence,excluded.confidence),status=excluded.status,search_text=excluded.search_text,updated_at=excluded.updated_at
    `)
    const participant = this.db.prepare('INSERT OR IGNORE INTO event_participants(event_id,entity_id,role) VALUES(?,?,?)')
    const evidence = this.db.prepare(`
      INSERT OR IGNORE INTO evidence(event_id,message_id,session_id,timestamp,excerpt,evidence_role)
      VALUES(?,?,?,?,?,?)
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
      upsert.run(event.id, event.eventType, event.title, event.description || '', event.startAt || null, event.endAt || null,
        event.location || null, event.confidence, event.status || 'candidate', event.searchText, event.createdAt || now, now)
      for (const item of event.participants || []) participant.run(event.id, item.entityId, item.role || 'participant')
      for (const item of event.evidence || []) evidence.run(event.id, item.messageId, item.sessionId, item.timestamp, item.excerpt,
        item.role && item.role !== 'support' ? item.role : 'direct')
      this.upsertSearchDocument(`event:${event.id}`, 'event', event.id, event.title, event.searchText,
        { eventType: event.eventType, startAt: event.startAt, endAt: event.endAt, participantIds: (event.participants || []).map((item: any) => item.entityId), status: event.status }, now)
    }
  }

  getMemoryStats(): any {
    if (!this.db) return { claims: 0, events: 0, resources: 0 }
    const count = (table: string) => Number((this.db!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
    return { claims: count('claims'), events: count('events'), resources: count('memory_resources') }
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
    const existing = this.db.prepare(`SELECT id FROM search_documents WHERE document_type='task'`).all() as Array<{ id: string }>
    for (const { id } of existing) {
      if (activeIds.has(id)) continue
      this.db.prepare('DELETE FROM search_document_evidence WHERE document_id=?').run(id)
      this.db.prepare('DELETE FROM search_fts WHERE document_id=?').run(id)
      this.db.prepare('DELETE FROM search_documents WHERE id=?').run(id)
    }
    for (const task of tasks) {
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

  getMemoryFeed(limit = 100): { claims: any[]; events: any[]; resources: any[] } {
    if (!this.db) return { claims: [], events: [], resources: [] }
    const claims = this.db.prepare(`
      SELECT c.*,s.canonical_name AS subject_name,o.canonical_name AS object_entity_name
      FROM claims c
      LEFT JOIN entities s ON s.id=c.subject_id
      LEFT JOIN entities o ON o.id=c.object_entity_id
      ORDER BY c.updated_at DESC LIMIT ?
    `).all(limit) as any[]
    const events = this.db.prepare(`
      SELECT * FROM events ORDER BY COALESCE(start_at,updated_at) DESC LIMIT ?
    `).all(limit) as any[]
    const evidenceStatement = this.db.prepare(`
      SELECT message_id,session_id,timestamp,excerpt,evidence_role
      FROM evidence WHERE claim_id=? OR event_id=? ORDER BY timestamp
    `)
    const participantStatement = this.db.prepare(`
      SELECT ep.entity_id,ep.role,e.canonical_name
      FROM event_participants ep JOIN entities e ON e.id=ep.entity_id WHERE ep.event_id=?
    `)
    const resources = this.db.prepare(`
      SELECT * FROM memory_resources ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as any[]
    const resourceEvidence = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt
      FROM search_document_evidence WHERE document_id=? ORDER BY timestamp
    `)
    return {
      claims: claims.map(claim => ({
        ...claim,
        evidence: evidenceStatement.all(claim.id, '') as any[]
      })),
      events: events.map(event => ({
        ...event,
        participants: participantStatement.all(event.id) as any[],
        evidence: evidenceStatement.all('', event.id) as any[]
      })),
      resources: resources.map(resource => ({
        ...resource,
        metadata: JSON.parse(resource.metadata_json || '{}'),
        evidence: resourceEvidence.all(`resource:${resource.id}`) as any[]
      }))
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
      impact: JSON.parse(row.impact_json || '{}')
    }))
  }

  updateMemoryItemStatus(kind: 'claim' | 'event', id: string, status: 'confirmed' | 'rejected'): any {
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
    this.db.prepare(`
      UPDATE claims SET object_entity_id=NULL,object_value=?,polarity='positive',valid_from=?,valid_to=?,status='confirmed',
        source_nature='human_confirmation',conflict_group=NULL,updated_at=? WHERE id=?
    `).run(after.object_value, after.valid_from, after.valid_to, now, id)
    this.db.prepare(`
      INSERT INTO memory_corrections(item_kind,item_id,before_json,after_json,created_at) VALUES('claim',?,?,?,?)
    `).run(id, JSON.stringify(before), JSON.stringify(after), now)
    const subject = this.db.prepare('SELECT canonical_name FROM entities WHERE id=?').get(before.subject_id) as { canonical_name?: string } | undefined
    this.upsertSearchDocument(`claim:${id}`, 'claim', id, before.predicate,
      `${subject?.canonical_name || ''} ${before.predicate} ${after.object_value}`.trim(),
      { subjectId: before.subject_id, polarity: 'positive', status: 'confirmed', validFrom: after.valid_from, validTo: after.valid_to }, now)
    return this.db.prepare('SELECT * FROM claims WHERE id=?').get(id) || null
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
    } = {}
  ): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO ingestion_batches(run_id,batch_index,message_count,status,error,started_at,finished_at,
        model,prompt_version,schema_version,input_tokens,output_tokens,duration_ms,redaction_summary_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id,batch_index) DO UPDATE SET status=excluded.status,error=excluded.error,
        attempts=CASE WHEN excluded.status='running' THEN ingestion_batches.attempts+1 ELSE ingestion_batches.attempts END,
        finished_at=excluded.finished_at,
        model=CASE WHEN excluded.model!='' THEN excluded.model ELSE ingestion_batches.model END,
        prompt_version=CASE WHEN excluded.prompt_version!='' THEN excluded.prompt_version ELSE ingestion_batches.prompt_version END,
        schema_version=CASE WHEN excluded.schema_version!='' THEN excluded.schema_version ELSE ingestion_batches.schema_version END,
        input_tokens=CASE WHEN excluded.input_tokens>0 THEN excluded.input_tokens ELSE ingestion_batches.input_tokens END,
        output_tokens=CASE WHEN excluded.output_tokens>0 THEN excluded.output_tokens ELSE ingestion_batches.output_tokens END,
        duration_ms=CASE WHEN excluded.duration_ms>0 THEN excluded.duration_ms ELSE ingestion_batches.duration_ms END,
        redaction_summary_json=CASE WHEN excluded.redaction_summary_json!='{}' THEN excluded.redaction_summary_json ELSE ingestion_batches.redaction_summary_json END
    `).run(
      runId, batchIndex, messageCount, status, error || null, now, status === 'running' ? null : now,
      String(metrics.model || ''), String(metrics.promptVersion || ''), String(metrics.schemaVersion || ''),
      Math.max(0, Number(metrics.inputTokens || 0)), Math.max(0, Number(metrics.outputTokens || 0)),
      Math.max(0, Number(metrics.durationMs || 0)), JSON.stringify(metrics.sensitiveRedaction || {})
    )
  }

  finishIngestionRun(id: string, input: { status: 'completed' | 'partial' | 'failed'; messageCount: number; entityCount: number; relationCount: number; error?: string }): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE ingestion_runs SET finished_at=?,message_count=?,entity_count=?,relation_count=?,status=?,error=? WHERE id=?
    `).run(new Date().toISOString(), input.messageCount, input.entityCount, input.relationCount, input.status, input.error || null, id)
  }

  getIngestionStatus(): any {
    if (!this.db) return null
    const latest = this.db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 1').get() as any
    if (!latest) return null
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
    return { ...latest, batches, usage }
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
          try { sensitiveRedaction = JSON.parse(batch.redaction_summary_json || '{}') } catch {}
          return { ...batch, sensitiveRedaction }
        }),
        usage
      }
    })
  }

  getMergeSnapshot(id: number): any | null {
    if (!this.db) return null
    const row = this.db.prepare('SELECT snapshot_json FROM merge_history WHERE id=? AND reverted_at IS NULL').get(id) as { snapshot_json: string } | undefined
    return row ? JSON.parse(row.snapshot_json) : null
  }

  markMergeReverted(id: number): void {
    this.db?.prepare('UPDATE merge_history SET reverted_at=? WHERE id=? AND reverted_at IS NULL').run(new Date().toISOString(), id)
  }

  searchText(query: string, limit = 20): any[] {
    if (!this.db || !query.trim()) return []
    const safeLimit = Math.max(1, Math.min(500, limit))
    const normalized = query.trim().replace(/["']/g, ' ')
    let exactMatches: any[] = []
    try {
      const matches = this.db.prepare(`
        SELECT d.*, bm25(search_fts) AS rank
        FROM search_fts JOIN search_documents d ON d.id = search_fts.document_id
        WHERE search_fts MATCH ?
        ORDER BY rank LIMIT ?
      `).all(normalized, safeLimit) as any[]
      exactMatches = matches
    } catch {}
    if (!exactMatches.length) {
      exactMatches = this.db.prepare(`
        SELECT *,0 AS rank FROM search_documents
        WHERE title LIKE ? OR search_text LIKE ? ORDER BY updated_at DESC LIMIT ?
      `).all(`%${normalized}%`, `%${normalized}%`, safeLimit) as any[]
    }
    if (exactMatches.length >= safeLimit) return exactMatches
    const knownIds = new Set(exactMatches.map(item => item.id))
    const fuzzyMatches = (this.db.prepare(`
      SELECT *,0 AS rank FROM search_documents WHERE document_type='entity'
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
    if (!this.db) return { total: 0, indexed: 0, pending: 0, model }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN embedding_model=? AND embedding_json IS NOT NULL THEN 1 ELSE 0 END) AS indexed
      FROM search_documents
    `).get(model) as { total: number; indexed: number }
    return { total: Number(row.total || 0), indexed: Number(row.indexed || 0), pending: Number(row.total || 0) - Number(row.indexed || 0), model }
  }

  searchVector(vector: number[], model: string, limit = 20): any[] {
    if (!this.db || !vector.length) return []
    const rows = this.db.prepare(`
      SELECT * FROM search_documents WHERE embedding_model=? AND embedding_dimensions=? AND embedding_json IS NOT NULL
    `).all(model, vector.length) as any[]
    return rows.map(row => {
      let candidate: number[] = []
      try { candidate = JSON.parse(row.embedding_json) } catch {}
      let score = 0
      for (let index = 0; index < vector.length && index < candidate.length; index += 1) score += vector[index] * candidate[index]
      return { ...row, semantic_score: score }
    }).sort((left, right) => right.semantic_score - left.semantic_score).slice(0, Math.max(1, Math.min(500, limit)))
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

  getDocumentEvidence(documentType: string, sourceId: string): any[] {
    if (!this.db) return []
    const generic = this.db.prepare(`
      SELECT message_id,session_id,timestamp,sender,excerpt
      FROM search_document_evidence WHERE document_id=? ORDER BY timestamp LIMIT 10
    `).all(`${documentType}:${sourceId}`) as any[]
    if (generic.length) return generic
    if (documentType === 'claim') return this.db.prepare('SELECT message_id,session_id,timestamp,excerpt,evidence_role FROM evidence WHERE claim_id=? ORDER BY timestamp LIMIT 10').all(sourceId) as any[]
    if (documentType === 'event') return this.db.prepare('SELECT message_id,session_id,timestamp,excerpt,evidence_role FROM evidence WHERE event_id=? ORDER BY timestamp LIMIT 10').all(sourceId) as any[]
    if (documentType === 'relation') return this.db.prepare('SELECT message_id,session_id,timestamp,excerpt,evidence_role FROM evidence WHERE relation_id=? ORDER BY timestamp LIMIT 10').all(sourceId) as any[]
    return []
  }

  saveAssistantExchange(question: string, answer: string, citations: any[], conversationId?: string): string {
    if (!this.db) return ''
    const now = new Date().toISOString()
    const id = conversationId || `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`
    this.db.prepare(`
      INSERT INTO assistant_conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(id, question.slice(0, 80), now, now)
    const insert = this.db.prepare('INSERT INTO assistant_messages(id,conversation_id,role,content,citations_json,created_at) VALUES(?,?,?,?,?,?)')
    insert.run(`msg_${Date.now()}_q`, id, 'user', question, '[]', now)
    insert.run(`msg_${Date.now()}_a`, id, 'assistant', answer, JSON.stringify(citations || []), now)
    return id
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
