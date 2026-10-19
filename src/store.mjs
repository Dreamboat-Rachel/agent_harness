import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";

export class Store {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.db = new DatabaseSync(path.join(dataRoot, "harness.db"));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        history_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
      CREATE TABLE IF NOT EXISTS subagents (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at TEXT NOT NULL,
        last_run_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'fact',
        subject TEXT NOT NULL DEFAULT '',
        predicate TEXT NOT NULL DEFAULT '',
        object_value TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        source_message_id TEXT,
        source_document_id TEXT,
        source_document_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_facts_status ON memory_facts(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_fact_documents (
        fact_id TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL,
        document_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (fact_id, document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_documents_document ON memory_fact_documents(document_id);
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        fact_id TEXT PRIMARY KEY REFERENCES memory_facts(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
      CREATE TABLE IF NOT EXISTS knowledge_entities (
        id TEXT PRIMARY KEY,
        normalized_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        attributes_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        source_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        predicate TEXT NOT NULL,
        target_entity_id TEXT REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        target_value TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.7,
        source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relations_source ON knowledge_relations(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON knowledge_relations(target_entity_id);
      CREATE TABLE IF NOT EXISTS knowledge_relation_facts (
        relation_id TEXT NOT NULL REFERENCES knowledge_relations(id) ON DELETE CASCADE,
        fact_id TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
        PRIMARY KEY (relation_id, fact_id)
      );
      CREATE VIEW IF NOT EXISTS active_knowledge_relations AS
        SELECT r.* FROM knowledge_relations r WHERE
        NOT EXISTS (SELECT 1 FROM knowledge_relation_facts l WHERE l.relation_id=r.id)
        OR EXISTS (SELECT 1 FROM knowledge_relation_facts l JOIN memory_facts f ON f.id=l.fact_id WHERE l.relation_id=r.id AND f.status='active');
      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        input_excerpt TEXT NOT NULL DEFAULT '',
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
    const memoryColumns = new Set(this.db.prepare("PRAGMA table_info(memory_facts)").all().map((column) => column.name));
    if (!memoryColumns.has("source_document_id")) this.db.exec("ALTER TABLE memory_facts ADD COLUMN source_document_id TEXT");
    if (!memoryColumns.has("source_document_name")) this.db.exec("ALTER TABLE memory_facts ADD COLUMN source_document_name TEXT");
    this.db.exec(`INSERT OR IGNORE INTO memory_fact_documents(fact_id,document_id,document_name,created_at)
      SELECT id,source_document_id,source_document_name,updated_at FROM memory_facts
      WHERE source_document_id IS NOT NULL AND source_document_name IS NOT NULL`);
    this.db.exec(`INSERT OR IGNORE INTO knowledge_relation_facts(relation_id,fact_id)
      SELECT r.id,f.id FROM knowledge_relations r
      JOIN knowledge_entities s ON s.id=r.source_entity_id
      LEFT JOIN knowledge_entities t ON t.id=r.target_entity_id
      JOIN memory_facts f ON lower(trim(f.subject))=s.normalized_name
        AND lower(trim(f.predicate))=lower(trim(r.predicate))
        AND lower(trim(f.object_value))=lower(trim(COALESCE(t.name,r.target_value)))`);
    this.db.prepare("UPDATE sessions SET status = 'idle' WHERE status != 'idle'").run();
  }

  sessionRows() {
    return this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
  }

  messageRows(sessionId) {
    return this.db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, rowid").all(sessionId);
  }

  insertSession(session) {
    this.db.prepare("INSERT INTO sessions(id,title,status,created_at,updated_at,history_json,summary) VALUES(?,?,?,?,?,?,?)")
      .run(session.id, session.title, session.status, session.createdAt, session.updatedAt, JSON.stringify(session.history || []), session.summary || "");
  }

  updateSession(session) {
    session.updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET title=?, status=?, updated_at=?, history_json=?, summary=? WHERE id=?")
      .run(session.title, session.status, session.updatedAt, JSON.stringify(session.history || []), session.summary || "", session.id);
  }

  deleteSession(id) {
    return this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes > 0;
  }

  insertMessage(sessionId, message) {
    const { id, role, content, createdAt, ...extra } = message;
    this.db.prepare("INSERT OR IGNORE INTO messages(id,session_id,role,content,created_at,extra_json) VALUES(?,?,?,?,?,?)")
      .run(id, sessionId, role, content, createdAt, JSON.stringify(extra));
  }

  updateMessageContent(id, content) {
    this.db.prepare("UPDATE messages SET content=? WHERE id=?").run(content, id);
  }

  insertSubagent(row) {
    this.db.prepare("INSERT INTO subagents(id,parent_session_id,status,prompt,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(row.id, row.parentSessionId, row.status, row.prompt, row.result || "", row.createdAt, row.updatedAt);
  }

  updateSubagent(row) {
    row.updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE subagents SET status=?,result=?,updated_at=? WHERE id=?").run(row.status, row.result || "", row.updatedAt, row.id);
  }

  subagents(parentSessionId) {
    return this.db.prepare("SELECT id,parent_session_id AS parentSessionId,status,prompt,result,created_at AS createdAt,updated_at AS updatedAt FROM subagents WHERE parent_session_id=? ORDER BY created_at DESC").all(parentSessionId);
  }

  schedules() {
    return this.db.prepare("SELECT id,name,prompt,interval_minutes AS intervalMinutes,session_id AS sessionId,enabled,next_run_at AS nextRunAt,last_run_at AS lastRunAt,created_at AS createdAt FROM schedules ORDER BY created_at DESC").all().map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  insertSchedule(row) {
    this.db.prepare("INSERT INTO schedules(id,name,prompt,interval_minutes,session_id,enabled,next_run_at,last_run_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.name, row.prompt, row.intervalMinutes, row.sessionId || null, row.enabled ? 1 : 0, row.nextRunAt, row.lastRunAt || null, row.createdAt);
  }

  updateScheduleRun(id, nextRunAt, lastRunAt) {
    this.db.prepare("UPDATE schedules SET next_run_at=?,last_run_at=? WHERE id=?").run(nextRunAt, lastRunAt, id);
  }

  deleteSchedule(id) {
    return this.db.prepare("DELETE FROM schedules WHERE id=?").run(id).changes > 0;
  }

  close() {
    this.db.close();
  }

  upsertMemoryFact(row) {
    const identity = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[。.!！]+$/, "");
    const existing = this.db.prepare("SELECT id FROM memory_facts WHERE fingerprint=?").get(row.fingerprint)
      || this.db.prepare("SELECT id,kind,subject,predicate,object_value AS object FROM memory_facts WHERE status='active'").all().find((fact) => ["kind", "subject", "predicate", "object"].every((key) => identity(fact[key]) === identity(row[key])));
    if (existing) {
      this.db.prepare("UPDATE memory_facts SET kind=?,subject=?,predicate=?,object_value=?,content=?,confidence=MAX(confidence,?),source_session_id=COALESCE(?,source_session_id),source_message_id=COALESCE(?,source_message_id),source_document_id=COALESCE(?,source_document_id),source_document_name=COALESCE(?,source_document_name),status='active',updated_at=? WHERE id=?")
        .run(row.kind, row.subject, row.predicate, row.object, row.content, row.confidence, row.sourceSessionId || null, row.sourceMessageId || null, row.sourceDocumentId || null, row.sourceDocumentName || null, row.updatedAt, existing.id);
      this.#linkFactDocument(existing.id, row);
      return { ...row, id: existing.id, created: false };
    }
    this.db.prepare("INSERT INTO memory_facts(id,fingerprint,kind,subject,predicate,object_value,content,confidence,source_session_id,source_message_id,source_document_id,source_document_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?)")
      .run(row.id, row.fingerprint, row.kind, row.subject, row.predicate, row.object, row.content, row.confidence, row.sourceSessionId || null, row.sourceMessageId || null, row.sourceDocumentId || null, row.sourceDocumentName || null, row.createdAt, row.updatedAt);
    this.#linkFactDocument(row.id, row);
    return { ...row, created: true };
  }

  #linkFactDocument(factId, row) {
    if (!row.sourceDocumentId || !row.sourceDocumentName) return;
    this.db.prepare("INSERT OR IGNORE INTO memory_fact_documents(fact_id,document_id,document_name,created_at) VALUES(?,?,?,?)")
      .run(factId, row.sourceDocumentId, row.sourceDocumentName, row.createdAt || row.updatedAt || new Date().toISOString());
  }

  removeDocumentFacts(documentId) {
    this.db.prepare("DELETE FROM memory_fact_documents WHERE document_id=?").run(documentId);
    this.db.prepare(`UPDATE memory_facts SET status='deleted',source_document_id=NULL,source_document_name=NULL,updated_at=?
      WHERE source_document_id=? AND NOT EXISTS (SELECT 1 FROM memory_fact_documents l WHERE l.fact_id=memory_facts.id)
      AND source_session_id IS NULL AND source_message_id IS NULL`).run(new Date().toISOString(), documentId);
    this.db.prepare(`UPDATE memory_facts SET source_document_id=NULL,source_document_name=NULL
      WHERE source_document_id=? AND NOT EXISTS (SELECT 1 FROM memory_fact_documents l WHERE l.fact_id=memory_facts.id)`).run(documentId);
  }

  memoryFacts({ limit = 200, status = "active" } = {}) {
    return this.db.prepare(`SELECT f.id,f.fingerprint,f.kind,f.subject,f.predicate,f.object_value AS object,f.content,f.confidence,f.source_session_id AS sourceSessionId,f.source_message_id AS sourceMessageId,f.source_document_id AS sourceDocumentId,f.source_document_name AS sourceDocumentName,(SELECT group_concat(document_name, ', ') FROM memory_fact_documents l WHERE l.fact_id=f.id) AS sourceDocuments,f.status,f.access_count AS accessCount,f.last_accessed_at AS lastAccessedAt,f.created_at AS createdAt,f.updated_at AS updatedAt FROM memory_facts f WHERE status=? ORDER BY updated_at DESC LIMIT ?`)
      .all(status, Math.max(1, Math.min(Number(limit) || 200, 1000)));
  }

  memoryCandidates() {
    return this.db.prepare("SELECT f.id,f.kind,f.subject,f.predicate,f.object_value AS object,f.content,f.confidence,f.access_count AS accessCount,f.updated_at AS updatedAt,(SELECT group_concat(document_name, ', ') FROM memory_fact_documents l WHERE l.fact_id=f.id) AS sourceDocuments FROM memory_facts f WHERE status='active' ORDER BY updated_at DESC").all();
  }

  touchMemoryFacts(ids) {
    const now = new Date().toISOString();
    const update = this.db.prepare("UPDATE memory_facts SET access_count=access_count+1,last_accessed_at=? WHERE id=?");
    this.db.exec("BEGIN");
    try {
      for (const id of ids) update.run(now, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteMemoryFact(id) {
    return this.db.prepare("UPDATE memory_facts SET status='deleted',updated_at=? WHERE id=? AND status='active'").run(new Date().toISOString(), id).changes > 0;
  }

  memoryEmbeddings(model) {
    return this.db.prepare("SELECT fact_id AS factId,model,dimensions,vector_json AS vectorJson,updated_at AS updatedAt FROM memory_embeddings WHERE model=?").all(model)
      .map((row) => ({ ...row, vector: JSON.parse(row.vectorJson) }));
  }

  upsertMemoryEmbedding({ factId, model, vector, updatedAt = new Date().toISOString() }) {
    this.db.prepare("INSERT INTO memory_embeddings(fact_id,model,dimensions,vector_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(fact_id) DO UPDATE SET model=excluded.model,dimensions=excluded.dimensions,vector_json=excluded.vector_json,updated_at=excluded.updated_at")
      .run(factId, model, vector.length, JSON.stringify(vector), updatedAt);
  }

  upsertEntity(row) {
    const existing = this.db.prepare("SELECT id FROM knowledge_entities WHERE normalized_name=?").get(row.normalizedName);
    if (existing) {
      this.db.prepare("UPDATE knowledge_entities SET name=?,type=?,attributes_json=?,updated_at=? WHERE id=?")
        .run(row.name, row.type, JSON.stringify(row.attributes || {}), row.updatedAt, existing.id);
      return { ...row, id: existing.id, created: false };
    }
    this.db.prepare("INSERT INTO knowledge_entities(id,normalized_name,name,type,attributes_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(row.id, row.normalizedName, row.name, row.type, JSON.stringify(row.attributes || {}), row.createdAt, row.updatedAt);
    return { ...row, created: true };
  }

  entityByNormalizedName(normalizedName) {
    return this.db.prepare("SELECT id,normalized_name AS normalizedName,name,type,attributes_json AS attributesJson,created_at AS createdAt,updated_at AS updatedAt FROM knowledge_entities WHERE normalized_name=?").get(normalizedName);
  }

  upsertRelation(row) {
    const existing = this.db.prepare("SELECT id FROM knowledge_relations WHERE fingerprint=?").get(row.fingerprint);
    if (existing) {
      this.db.prepare("UPDATE knowledge_relations SET confidence=MAX(confidence,?),source_session_id=COALESCE(?,source_session_id),updated_at=? WHERE id=?")
        .run(row.confidence, row.sourceSessionId || null, row.updatedAt, existing.id);
      return { ...row, id: existing.id, created: false };
    }
    this.db.prepare("INSERT INTO knowledge_relations(id,fingerprint,source_entity_id,predicate,target_entity_id,target_value,confidence,source_session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.fingerprint, row.sourceEntityId, row.predicate, row.targetEntityId || null, row.targetValue || "", row.confidence, row.sourceSessionId || null, row.createdAt, row.updatedAt);
    return { ...row, created: true };
  }

  linkRelationFact(relationId, factId) {
    this.db.prepare("INSERT OR IGNORE INTO knowledge_relation_facts(relation_id,fact_id) VALUES(?,?)").run(relationId, factId);
  }

  deleteRelation(id) {
    return this.db.prepare("DELETE FROM knowledge_relations WHERE id=?").run(id).changes > 0;
  }

  knowledgeGraph({ limit = 300 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 300, 1000));
    const entities = this.db.prepare("SELECT id,normalized_name AS normalizedName,name,type,attributes_json AS attributesJson,created_at AS createdAt,updated_at AS updatedAt FROM knowledge_entities e WHERE EXISTS (SELECT 1 FROM active_knowledge_relations r WHERE r.source_entity_id=e.id OR r.target_entity_id=e.id) OR EXISTS (SELECT 1 FROM memory_facts f WHERE f.status='active' AND lower(trim(f.subject))=e.normalized_name) ORDER BY updated_at DESC LIMIT ?").all(bounded).map((row) => ({ ...row, attributes: JSON.parse(row.attributesJson || "{}") }));
    const entityIds = new Set(entities.map((entity) => entity.id));
    const relations = this.db.prepare("SELECT r.id,r.source_entity_id AS sourceEntityId,s.name AS source,r.predicate,r.target_entity_id AS targetEntityId,t.name AS target,r.target_value AS targetValue,r.confidence,r.source_session_id AS sourceSessionId,(SELECT group_concat(DISTINCT l.document_name) FROM knowledge_relation_facts rf JOIN memory_fact_documents l ON l.fact_id=rf.fact_id WHERE rf.relation_id=r.id) AS sourceDocuments,r.created_at AS createdAt,r.updated_at AS updatedAt FROM active_knowledge_relations r JOIN knowledge_entities s ON s.id=r.source_entity_id LEFT JOIN knowledge_entities t ON t.id=r.target_entity_id ORDER BY r.updated_at DESC LIMIT ?").all(bounded * 2).filter((row) => entityIds.has(row.sourceEntityId) || entityIds.has(row.targetEntityId));
    return { entities, relations };
  }

  insertMemoryEvent(row) {
    this.db.prepare("INSERT INTO memory_events(id,session_id,event_type,input_excerpt,result_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(row.id, row.sessionId || null, row.eventType, row.inputExcerpt || "", JSON.stringify(row.result || {}), row.createdAt);
  }

  memoryStats() {
    const facts = this.db.prepare("SELECT COUNT(*) AS count FROM memory_facts WHERE status='active'").get().count;
    const entities = this.db.prepare("SELECT COUNT(*) AS count FROM knowledge_entities e WHERE EXISTS (SELECT 1 FROM active_knowledge_relations r WHERE r.source_entity_id=e.id OR r.target_entity_id=e.id) OR EXISTS (SELECT 1 FROM memory_facts f WHERE f.status='active' AND lower(trim(f.subject))=e.normalized_name)").get().count;
    const relations = this.db.prepare("SELECT COUNT(*) AS count FROM active_knowledge_relations").get().count;
    const events = this.db.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count;
    return { facts, entities, relations, events };
  }

  async importLegacyTraces(traceRoot) {
    let files = [];
    try { files = (await fs.readdir(traceRoot)).filter((name) => name.endsWith(".jsonl")); } catch { return; }
    const exists = this.db.prepare("SELECT 1 FROM sessions WHERE id=?");
    for (const name of files) {
      const id = name.slice(0, -6);
      if (exists.get(id)) continue;
      let records;
      try {
        records = (await fs.readFile(path.join(traceRoot, name), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      } catch { continue; }
      const messages = [];
      const seen = new Set();
      for (const record of records) {
        if (record.type !== "message" || !record.payload?.id || seen.has(record.payload.id)) continue;
        seen.add(record.payload.id);
        messages.push(record.payload);
      }
      if (messages.length === 0) continue;
      const createdAt = messages[0].createdAt || records[0]?.ts || new Date().toISOString();
      const title = messages.find((message) => message.role === "user")?.content?.slice(0, 42) || "Recovered Session";
      const history = messages.filter((message) => message.role === "user" || message.role === "assistant").map(({ role, content }) => ({ role, content }));
      const session = { id, title, status: "idle", createdAt, updatedAt: messages.at(-1)?.createdAt || createdAt, history, summary: "" };
      this.insertSession(session);
      for (const message of messages) this.insertMessage(id, message);
    }
  }
}

export function hydrateSessions(store, createChannel, traceRoot) {
  const map = new Map();
  for (const row of store.sessionRows()) {
    const messages = store.messageRows(row.id).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
      ...JSON.parse(message.extra_json || "{}")
    }));
    map.set(row.id, {
      id: row.id,
      title: row.title,
      status: "idle",
      messages,
      history: JSON.parse(row.history_json || "[]"),
      summary: row.summary || "",
      approvals: new Map(),
      channel: createChannel(),
      abort: null,
      tracePath: path.join(traceRoot, `${row.id}.jsonl`),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }
  return map;
}
