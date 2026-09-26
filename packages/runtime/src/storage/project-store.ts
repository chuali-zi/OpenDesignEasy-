import { DatabaseSync } from 'node:sqlite';
import type { EditableDocument } from '@oeydesign/document';
import type { CommandResult, DesignVersion, ProjectEvent, ProjectInfo, StoredCommand, StoredDocument } from '../types.ts';
import { RuntimeError } from '../errors.ts';

type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class ProjectStore {
  private readonly db: DatabaseSync;

  constructor(path: string, create = false) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON');
      if (create) this.db.exec(`
        CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY, data TEXT NOT NULL, undo_stack TEXT NOT NULL, redo_stack TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          document_id TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL,
          data TEXT NOT NULL, PRIMARY KEY(document_id, revision)
        );
        CREATE TABLE IF NOT EXISTS commands (
          id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
          request TEXT NOT NULL, result TEXT NOT NULL, before_revision INTEGER, after_revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS versions (
          id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), data TEXT NOT NULL
        );
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS records (
          namespace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY(namespace, id)
        );
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id), data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_runs_session ON agent_runs(session_id);
        CREATE TABLE IF NOT EXISTS agent_inputs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id), run_id TEXT,
          data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_inputs_session ON agent_inputs(session_id);
        CREATE TABLE IF NOT EXISTS agent_questions (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id), run_id TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_questions_session ON agent_questions(session_id);
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  project(): ProjectInfo | undefined {
    const row = this.db.prepare('SELECT data FROM project WHERE id = 1').get();
    return row ? parse<ProjectInfo>(row.data) : undefined;
  }

  createProject(project: ProjectInfo): void {
    this.db.prepare('INSERT INTO project(id, data) VALUES (1, ?)').run(JSON.stringify(project));
  }

  listDocuments(): EditableDocument[] {
    return this.db.prepare('SELECT data FROM documents ORDER BY rowid').all().map(row => parse<EditableDocument>(row.data));
  }

  document(id: string): StoredDocument {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!row) throw new RuntimeError('not_found', `Document ${id} does not exist.`);
    return { document: parse<EditableDocument>(row.data), undo: parse<string[]>(row.undo_stack), redo: parse<string[]>(row.redo_stack) };
  }

  snapshot(id: string, revision: number): EditableDocument {
    const row = this.db.prepare('SELECT data FROM snapshots WHERE document_id = ? AND revision = ?').get(id, revision);
    if (!row) throw new RuntimeError('conflict', `Base revision ${revision} is not available. Read the current document and retry.`, { documentId: id, baseRevision: revision });
    return parse<EditableDocument>(row.data);
  }

  saveDocument(state: StoredDocument): void {
    const doc = state.document;
    this.db.prepare(`INSERT INTO documents(id, data, undo_stack, redo_stack) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, undo_stack=excluded.undo_stack, redo_stack=excluded.redo_stack`)
      .run(doc.documentId, JSON.stringify(doc), JSON.stringify(state.undo), JSON.stringify(state.redo));
    this.db.prepare('INSERT INTO snapshots(document_id, revision, data) VALUES (?, ?, ?)')
      .run(doc.documentId, doc.revision, JSON.stringify(doc));
  }

  command(id: string): StoredCommand | undefined {
    const row = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(id);
    return row ? {
      request: String(row.request), result: parse<CommandResult>(row.result),
      beforeRevision: row.before_revision === null ? null : Number(row.before_revision), afterRevision: Number(row.after_revision),
    } : undefined;
  }

  saveCommand(request: string, result: CommandResult, beforeRevision: number | null): void {
    this.db.prepare('INSERT INTO commands(id, document_id, request, result, before_revision, after_revision) VALUES (?, ?, ?, ?, ?, ?)')
      .run(result.commandId, result.documentId, request, JSON.stringify(result), beforeRevision, result.revision);
  }

  appendEvent(event: Omit<ProjectEvent, 'seq'>): ProjectEvent {
    const result = this.db.prepare('INSERT INTO events(data) VALUES (?)').run(JSON.stringify(event));
    return { ...event, seq: Number(result.lastInsertRowid) };
  }

  events(afterSeq: number): ProjectEvent[] {
    return this.db.prepare('SELECT seq, data FROM events WHERE seq > ? ORDER BY seq').all(afterSeq)
      .map(row => ({ ...parse<Omit<ProjectEvent, 'seq'>>(row.data), seq: Number(row.seq) }));
  }

  saveVersion(version: DesignVersion): void {
    this.db.prepare('INSERT INTO versions(id, document_id, data) VALUES (?, ?, ?)')
      .run(version.versionId, version.documentId, JSON.stringify(version));
  }

  versions(documentId: string): DesignVersion[] {
    return this.db.prepare('SELECT data FROM versions WHERE document_id = ? ORDER BY rowid').all(documentId)
      .map(row => parse<DesignVersion>(row.data));
  }

  putRecord(namespace: string, id: string, value: unknown): void {
    this.db.prepare(`INSERT INTO records(namespace, id, data) VALUES (?, ?, ?)
      ON CONFLICT(namespace, id) DO UPDATE SET data=excluded.data`).run(namespace, id, JSON.stringify(value));
  }

  getRecord<T>(namespace: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE namespace = ? AND id = ?').get(namespace, id);
    return row ? parse<T>(row.data) : undefined;
  }

  listRecords<T>(namespace: string): Array<{ id: string; value: T }> {
    return this.db.prepare('SELECT id, data FROM records WHERE namespace = ? ORDER BY rowid').all(namespace)
      .map(row => ({ id: String(row.id), value: parse<T>(row.data) }));
  }

  saveAgentSession<T extends { sessionId: string }>(session: T): void {
    this.db.prepare(`INSERT INTO agent_sessions(id, data) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(session.sessionId, JSON.stringify(session));
  }

  agentSession<T>(sessionId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM agent_sessions WHERE id = ?').get(sessionId);
    return row ? parse<T>(row.data) : undefined;
  }

  agentSessions<T>(): T[] {
    return this.db.prepare('SELECT data FROM agent_sessions ORDER BY rowid').all().map(row => parse<T>(row.data));
  }

  saveAgentRun<T extends { runId: string; sessionId: string }>(run: T): void {
    this.db.prepare(`INSERT INTO agent_runs(id, session_id, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(run.runId, run.sessionId, JSON.stringify(run));
  }

  agentRun<T>(runId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM agent_runs WHERE id = ?').get(runId);
    return row ? parse<T>(row.data) : undefined;
  }

  agentRuns<T>(sessionId: string): T[] {
    return this.db.prepare('SELECT data FROM agent_runs WHERE session_id = ? ORDER BY rowid').all(sessionId)
      .map(row => parse<T>(row.data));
  }

  agentRunsAll<T>(): T[] {
    return this.db.prepare('SELECT data FROM agent_runs ORDER BY rowid').all().map(row => parse<T>(row.data));
  }

  saveAgentInput<T extends { inputId: string; sessionId: string; runId?: string }>(input: T): void {
    this.db.prepare(`INSERT INTO agent_inputs(id, session_id, run_id, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, data=excluded.data`).run(input.inputId, input.sessionId, input.runId ?? null, JSON.stringify(input));
  }

  insertAgentInput<T extends { inputId: string; sessionId: string; runId?: string }>(input: T): void {
    this.db.prepare('INSERT INTO agent_inputs(id, session_id, run_id, data) VALUES (?, ?, ?, ?)')
      .run(input.inputId, input.sessionId, input.runId ?? null, JSON.stringify(input));
  }

  agentInput<T>(inputId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM agent_inputs WHERE id = ?').get(inputId);
    return row ? parse<T>(row.data) : undefined;
  }

  agentInputs<T>(sessionId: string): T[] {
    return this.db.prepare('SELECT data FROM agent_inputs WHERE session_id = ? ORDER BY rowid').all(sessionId)
      .map(row => parse<T>(row.data));
  }

  saveAgentQuestion<T extends { questionId: string; sessionId: string; runId: string }>(question: T): void {
    this.db.prepare(`INSERT INTO agent_questions(id, session_id, run_id, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(question.questionId, question.sessionId, question.runId, JSON.stringify(question));
  }

  agentQuestion<T>(questionId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM agent_questions WHERE id = ?').get(questionId);
    return row ? parse<T>(row.data) : undefined;
  }

  agentQuestions<T>(sessionId: string): T[] {
    return this.db.prepare('SELECT data FROM agent_questions WHERE session_id = ? ORDER BY rowid').all(sessionId)
      .map(row => parse<T>(row.data));
  }

  version(versionId: string): DesignVersion {
    const row: Row | undefined = this.db.prepare('SELECT data FROM versions WHERE id = ?').get(versionId);
    if (!row) throw new RuntimeError('not_found', `Version ${versionId} does not exist.`);
    return parse<DesignVersion>(row.data);
  }

  close(): void { this.db.close(); }
}
