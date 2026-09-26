import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AgentMessage, AgentContext } from '@earendil-works/pi-agent-core';
import type { Api, ImageContent, Model } from '@earendil-works/pi-ai';
import type { AgentSession, ModelRuntime, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ProjectRuntime } from './project-runtime.ts';
import type { ProjectStore } from './storage/project-store.ts';
import type { AgentDesignServices } from './design-services.ts';
import { RuntimeError } from './errors.ts';
import { webOperationSchema } from './web-schema.ts';
import type {
  AgentAcceptedInputOptions, AgentInputKind, AgentInputRecord, AgentProviderConfig, AgentQuestionRecord,
  AgentRunRecord, AgentRunStart, AgentSelection, AgentServiceEvent, AgentSessionOptions, AgentSessionRecord,
  PublicAgentConfig,
} from './agent-types.ts';

type ConfiguredModel = { modelRuntime: ModelRuntime; model: Model<Api> };
export interface AgentServiceOptions {
  /** Public SDK injection point used by deterministic faux-provider integration tests. */
  createModelRuntime?: (config: AgentProviderConfig) => Promise<ConfiguredModel>;
}

interface PiSdk {
  createAgentSession: typeof import('@earendil-works/pi-coding-agent').createAgentSession;
  DefaultResourceLoader: typeof import('@earendil-works/pi-coding-agent').DefaultResourceLoader;
  ModelRuntime: typeof import('@earendil-works/pi-coding-agent').ModelRuntime;
  SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager;
  SettingsManager: typeof import('@earendil-works/pi-coding-agent').SettingsManager;
  defineTool: typeof import('@earendil-works/pi-coding-agent').defineTool;
  Type: typeof import('@earendil-works/pi-ai').Type;
  InMemoryCredentialStore: typeof import('@earendil-works/pi-ai').InMemoryCredentialStore;
}

interface LoadedSession {
  session: AgentSession;
  manager: SessionManager;
  modelRuntime: ModelRuntime;
  disposeEvents: () => void;
}

interface DecisionRecord {
  decisionId: string;
  sessionId: string;
  runId: string;
  documentId?: string;
  text: string;
  createdAt: string;
}

const SYSTEM_PROMPT = `You are OEYdesign, a collaborative design agent. The project document and its revisions are the source of truth. Use the supplied read tools before editing, apply edits through document_apply, and use its exact current base revision. Preserve human edits and report conflicts instead of overwriting them. Discuss without changing the document when asked. Ask a focused question with user_ask only when an important design decision is missing; after asking, stop and wait. Do not claim an asset, preview, export, or document change succeeded unless the corresponding tool confirms it. Use only the supplied design tools; do not invent filesystem or shell access.`;

function systemPrompt(context: string): string {
  return `${SYSTEM_PROMPT}\n\nCurrent project design context (refresh from tools before editing if anything changed):\n${context}`;
}

let piSdkPromise: Promise<PiSdk> | undefined;
function loadPiSdk(): Promise<PiSdk> {
  piSdkPromise ??= Promise.all([
    import('@earendil-works/pi-coding-agent'),
    import('@earendil-works/pi-ai'),
  ]).then(([coding, ai]) => ({
    createAgentSession: coding.createAgentSession,
    DefaultResourceLoader: coding.DefaultResourceLoader,
    ModelRuntime: coding.ModelRuntime,
    SessionManager: coding.SessionManager,
    SettingsManager: coding.SettingsManager,
    defineTool: coding.defineTool,
    Type: ai.Type,
    InMemoryCredentialStore: ai.InMemoryCredentialStore,
  }));
  return piSdkPromise;
}

function now(): string { return new Date().toISOString(); }
function textResult(text: string, details: unknown = {}): { content: Array<{ type: 'text'; text: string }>; details: unknown } {
  return { content: [{ type: 'text', text }], details };
}
function toImageContent(mimeType: string, data: string): ImageContent {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new RuntimeError('invalid', 'Unsupported image type from asset service.');
  return { type: 'image', mimeType, data };
}

export class AgentService {
  private readonly runtime: ProjectRuntime;
  private readonly store: ProjectStore;
  private readonly options: AgentServiceOptions;
  private config: AgentProviderConfig;
  private services?: AgentDesignServices;
  private closed = false;
  private readonly sessions = new Map<string, LoadedSession>();
  private readonly sessionLoads = new Map<string, Promise<LoadedSession>>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly activeRunBySession = new Map<string, string>();
  private readonly queuedInputs = new Map<string, AgentInputRecord[]>();
  private readonly flushingSessions = new Set<string>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly selections = new Map<string, AgentSelection>();
  private readonly listeners = new Set<(event: AgentServiceEvent) => void>();

  constructor(runtime: ProjectRuntime, store: ProjectStore, options: AgentServiceOptions = {}) {
    this.runtime = runtime;
    this.store = store;
    this.options = options;
    const providerId = process.env.PROVIDER_ID || process.env.PROVIDER || 'kimi-coding';
    this.config = {
      providerId,
      providerName: process.env.PROVIDER_NAME || providerId,
      modelId: process.env.MODEL || undefined,
      baseUrl: process.env.BASE_URL || undefined,
      apiKeyEnv: process.env.API_KEY_ENV || 'API_KEY',
      thinkingLevel: 'high',
      userAgent: process.env.PI_USER_AGENT || undefined,
    };
    const savedConfig = store.getRecord<AgentProviderConfig>('agent-config', 'current');
    if (savedConfig) this.config = { ...this.config, ...savedConfig, apiKey: undefined };
    for (const saved of store.agentSessions<AgentSessionRecord>()) {
      if (saved.status === 'running') {
        saved.status = 'interrupted';
        saved.updatedAt = now();
        store.saveAgentSession(saved);
        for (const run of store.agentRuns<AgentRunRecord>(saved.sessionId)) {
          if (run.status === 'running') {
            run.status = 'interrupted';
            run.updatedAt = now();
            run.completedAt = run.updatedAt;
            store.saveAgentRun(run);
            this.persistEvent({ type: 'run.interrupted', sessionId: saved.sessionId, runId: run.runId, record: run });
          }
        }
        for (const input of store.agentInputs<AgentInputRecord>(saved.sessionId)) {
          if (input.status === 'accepted' || input.status === 'delivered') {
            input.status = 'interrupted';
            store.saveAgentInput(input);
          }
        }
      }
      const selection = store.getRecord<AgentSelection>('agent-selections', saved.sessionId);
      if (selection) this.selections.set(saved.sessionId, selection);
    }
  }

  configure(config: AgentProviderConfig): PublicAgentConfig {
    this.ensureOpen();
    if (this.listRuns().some(run => run.status === 'running' || run.status === 'waiting_input')) {
      throw new RuntimeError('busy', 'Stop or finish the active agent run before changing its model configuration.');
    }
    if (!config || typeof config !== 'object') throw new RuntimeError('invalid', 'Model configuration must be an object.');
    const providerId = config.providerId ?? config.provider ?? this.config.providerId;
    const modelId = config.modelId ?? config.model ?? this.config.modelId;
    const baseUrl = config.baseUrl === undefined ? this.config.baseUrl : config.baseUrl.trim() || undefined;
    const apiKeyEnv = config.apiKeyEnv?.trim() || this.config.apiKeyEnv || 'API_KEY';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new RuntimeError('invalid', 'apiKeyEnv must be an environment variable name.');
    if (baseUrl) {
      let endpoint: URL;
      try { endpoint = new URL(baseUrl); } catch { throw new RuntimeError('invalid', 'Model endpoint must be a valid URL.'); }
      if (endpoint.protocol !== 'https:' && endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost') {
        throw new RuntimeError('invalid', 'Model endpoints require HTTPS.');
      }
    }
    if (config.apiKey !== undefined && typeof config.apiKey !== 'string') throw new RuntimeError('invalid', 'apiKey must be a string.');
    const sameBackend = providerId === this.config.providerId && baseUrl === this.config.baseUrl;
    this.config = {
      ...(sameBackend ? this.config : {}),
      ...config,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      baseUrl,
      apiKey: config.apiKey ?? (sameBackend ? this.config.apiKey : undefined),
      apiKeyEnv,
    };
    const { apiKey: _secret, ...safeConfig } = this.config;
    this.runtime.putRecord('agent-config', 'current', safeConfig);
    for (const [sessionId, loaded] of this.sessions) {
      loaded.disposeEvents();
      loaded.session.dispose();
      this.sessions.delete(sessionId);
    }
    return this.getConfig();
  }

  getConfig(): PublicAgentConfig {
    const keyAvailable = Boolean(this.config.apiKey || (this.config.apiKeyEnv && process.env[this.config.apiKeyEnv]));
    return {
      configured: Boolean(this.config.providerId && this.config.modelId && keyAvailable),
      ...(this.config.providerId ? { providerId: this.config.providerId } : {}),
      ...(this.config.providerName ? { providerName: this.config.providerName } : {}),
      ...(this.config.modelId ? { modelId: this.config.modelId } : {}),
      ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
      ...(this.config.apiKeyEnv ? { apiKeyEnv: this.config.apiKeyEnv } : {}),
      ...(this.config.thinkingLevel ? { thinkingLevel: this.config.thinkingLevel } : {}),
    };
  }

  configureTools(services: AgentDesignServices): void { this.ensureOpen(); this.services = services; }

  async createSession(options: AgentSessionOptions = {}): Promise<AgentSessionRecord> {
    this.ensureOpen();
    const createdAt = now();
    const session: AgentSessionRecord = {
      sessionId: `agent-${randomUUID()}`,
      title: options.title?.trim().slice(0, 200) || undefined,
      piSessionId: randomUUID(),
      status: 'idle',
      createdAt,
      updatedAt: createdAt,
    };
    this.store.transaction(() => this.store.saveAgentSession(session));
    this.persistEvent({ type: 'session.created', sessionId: session.sessionId, record: session });
    return structuredClone(session);
  }

  getSession(sessionId: string): AgentSessionRecord | undefined {
    const record = this.store.agentSession<AgentSessionRecord>(sessionId);
    return record ? structuredClone(record) : undefined;
  }

  listSessions(): AgentSessionRecord[] {
    return this.store.agentSessions<AgentSessionRecord>().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(record => structuredClone(record));
  }

  getRun(runId: string): AgentRunRecord | undefined {
    const record = this.store.agentRun<AgentRunRecord>(runId);
    return record ? structuredClone(record) : undefined;
  }

  listRuns(sessionId?: string): AgentRunRecord[] {
    const runs = sessionId ? this.store.agentRuns<AgentRunRecord>(sessionId) : this.store.agentRunsAll<AgentRunRecord>();
    return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(run => structuredClone(run));
  }

  listInputs(sessionId: string): AgentInputRecord[] {
    this.requireSession(sessionId);
    return this.store.agentInputs<AgentInputRecord>(sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(input => structuredClone(input));
  }

  listQuestions(sessionId: string): AgentQuestionRecord[] {
    this.requireSession(sessionId);
    return this.store.agentQuestions<AgentQuestionRecord>(sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(question => structuredClone(question));
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    const record = this.requireSession(sessionId);
    const active = this.sessions.get(sessionId);
    if (active) return active.session.messages.map(message => structuredClone(message));
    if (!record.piSessionFile || !existsSync(record.piSessionFile)) return [];
    const sessionDir = join(this.runtime.root, 'sessions');
    const candidate = resolve(record.piSessionFile);
    const pathFromSessionDir = relative(sessionDir, candidate);
    if (pathFromSessionDir.startsWith('..') || isAbsolute(pathFromSessionDir)) return [];
    const { SessionManager } = await loadPiSdk();
    const manager = SessionManager.open(candidate, sessionDir, this.runtime.root);
    return manager.buildSessionContext().messages.map(message => structuredClone(message));
  }

  setSelection(sessionId: string, value: { documentId: string; nodeIds: string[] }): void {
    this.ensureOpen();
    this.requireSession(sessionId);
    this.runtime.readDocument(value.documentId);
    const selection: AgentSelection = { documentId: value.documentId, nodeIds: [...new Set(value.nodeIds)].slice(0, 100), updatedAt: now() };
    this.selections.set(sessionId, selection);
    this.store.putRecord('agent-selections', sessionId, selection);
  }

  async send(sessionId: string, text: string, options: AgentAcceptedInputOptions & { documentId?: string } = {}): Promise<AgentRunStart> {
    return this.startInput(sessionId, 'message', text, options);
  }

  async steer(sessionId: string, text: string, options: AgentAcceptedInputOptions = {}): Promise<AgentRunStart> {
    return this.queueInput(sessionId, 'steer', text, options);
  }

  async followUp(sessionId: string, text: string, options: AgentAcceptedInputOptions = {}): Promise<AgentRunStart> {
    return this.queueInput(sessionId, 'follow_up', text, options);
  }

  async answer(sessionId: string, questionId: string, text: string, options: AgentAcceptedInputOptions = {}): Promise<AgentRunStart> {
    this.ensureOpen();
    const session = this.requireSession(sessionId);
    const existing = options.inputId ? this.existingInput(options.inputId, sessionId, 'answer', text, options.assetIds, questionId) : undefined;
    if (existing) return { runId: existing.runId!, inputId: existing.inputId };
    const question = this.store.agentQuestion<AgentQuestionRecord>(questionId);
    if (!question || question.sessionId !== sessionId || question.status !== 'pending') throw new RuntimeError('not_found', 'There is no pending question with this ID.');
    if (!text.trim()) throw new RuntimeError('invalid', 'An answer must not be empty.');
    if (!question.allowFreeText && question.options.length && !question.options.includes(text)) throw new RuntimeError('invalid', 'Choose one of the available answers.');
    const previousRun = this.store.agentRun<AgentRunRecord>(question.runId);
    if (!previousRun || previousRun.status !== 'waiting_input') throw new RuntimeError('conflict', 'This question is no longer waiting for an answer.');
    const createdAt = now();
    const runId = `run-${randomUUID()}`;
    const inputId = options.inputId ?? `input-${randomUUID()}`;
    const input: AgentInputRecord = { inputId, sessionId, runId, parentRunId: previousRun.runId, questionId, kind: 'answer', text, assetIds: options.assetIds, status: 'accepted', createdAt };
    const run: AgentRunRecord = { runId, sessionId, parentRunId: previousRun.runId, status: 'running', inputIds: [inputId], startedAt: createdAt, updatedAt: createdAt };
    question.status = 'answered'; question.answeredAt = createdAt; question.answerInputId = inputId;
    previousRun.status = 'completed'; previousRun.completedAt = createdAt; previousRun.updatedAt = createdAt;
    session.status = 'running'; session.lastRunId = runId; session.updatedAt = createdAt;
    this.store.transaction(() => {
      this.store.insertAgentInput(input);
      this.store.saveAgentRun(previousRun);
      this.store.saveAgentQuestion(question);
      this.store.saveAgentRun(run);
      this.store.saveAgentSession(session);
    });
    this.runAbortControllers.set(runId, new AbortController());
    this.persistEvent({ type: 'question.answered', sessionId, runId: previousRun.runId, questionId, inputId, record: question });
    this.persistEvent({ type: 'input.accepted', sessionId, runId, inputId, record: input });
    this.persistEvent({ type: 'run.started', sessionId, runId, inputId, record: run });
    this.dispatch(sessionId, input, run, true);
    return { runId, inputId };
  }

  async cancel(sessionId: string, requestedRunId?: string): Promise<AgentRunRecord> {
    this.ensureOpen();
    this.requireSession(sessionId);
    const runId = requestedRunId ?? this.activeRunBySession.get(sessionId)
      ?? this.listRuns(sessionId).find(run => run.status === 'waiting_input')?.runId;
    if (!runId) throw new RuntimeError('not_found', 'There is no active agent run to stop.');
    const run = this.store.agentRun<AgentRunRecord>(runId);
    if (!run || run.sessionId !== sessionId || !['running', 'waiting_input'].includes(run.status)) throw new RuntimeError('conflict', 'This run is no longer active.', { runId });
    const timestamp = now();
    run.status = 'cancelled'; run.completedAt = timestamp; run.updatedAt = timestamp;
    const session = this.requireSession(sessionId); session.status = 'idle'; session.updatedAt = timestamp;
    this.store.transaction(() => {
      this.store.saveAgentRun(run);
      this.store.saveAgentSession(session);
      for (const question of this.store.agentQuestions<AgentQuestionRecord>(sessionId)) {
        if (question.runId === runId && question.status === 'pending') {
          question.status = 'cancelled';
          this.store.saveAgentQuestion(question);
        }
      }
      for (const input of this.store.agentInputs<AgentInputRecord>(sessionId)) {
        if (input.runId === runId && input.status === 'accepted') { input.status = 'cancelled'; this.store.saveAgentInput(input); }
      }
    });
    this.activeRunBySession.delete(sessionId);
    this.runAbortControllers.get(runId)?.abort();
    this.persistEvent({ type: 'run.cancelled', sessionId, runId, record: run });
    const loaded = this.sessions.get(sessionId);
    if (loaded && !loaded.session.isIdle) {
      const settleWithin = async (operation: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            operation.catch(() => undefined),
            new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      await settleWithin(loaded.session.abort());
      await settleWithin(loaded.session.waitForIdle());
    }
    this.runAbortControllers.delete(runId);
    return structuredClone(run);
  }

  subscribe(listener: (event: AgentServiceEvent) => void): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForIdle(sessionId: string): Promise<void> {
    this.requireSession(sessionId);
    const task = this.tasks.get(sessionId);
    if (task) await task;
    const loaded = this.sessions.get(sessionId);
    if (loaded) await loaded.session.waitForIdle();
  }

  async compact(sessionId: string): Promise<void> {
    const loaded = await this.loadSession(sessionId);
    if (!loaded.session.isIdle) throw new RuntimeError('busy', 'Wait for the current run to finish before compacting its conversation.');
    await loaded.session.compact('Keep the project goal, confirmed decisions, unresolved questions and relevant design rationale. The current document, selection and recent human edits will be reloaded before the next model turn.');
  }

  private existingInput(inputId: string, sessionId: string, kind: AgentInputKind, text: string, assetIds?: string[], questionId?: string): AgentInputRecord | undefined {
    const existing = this.store.agentInput<AgentInputRecord>(inputId);
    if (!existing) return undefined;
    const sameAssets = [...(existing.assetIds ?? [])].sort().join('\0') === [...(assetIds ?? [])].sort().join('\0');
    if (existing.sessionId !== sessionId || existing.kind !== kind || existing.text !== text || existing.questionId !== questionId || !sameAssets) {
      throw new RuntimeError('invalid', 'This input ID was already used for a different request.', { inputId });
    }
    if (!existing.runId) throw new RuntimeError('conflict', 'This input ID has no associated run.', { inputId });
    return existing;
  }

  /** Called by ProjectRuntime before any command carrying runId is committed. */
  canWrite(runId: string, documentId: string): boolean {
    if (this.closed) return false;
    const run = this.store.agentRun<AgentRunRecord>(runId);
    if (!run || run.status !== 'running' || this.activeRunBySession.get(run.sessionId) !== runId) return false;
    const session = this.store.agentSession<AgentSessionRecord>(run.sessionId);
    return session?.status === 'running' && (!documentId || this.runtime.listDocuments().some(document => document.documentId === documentId));
  }

  /** Keep saves from callback tails from touching SQLite after close(). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const timestamp = now();
    for (const session of this.listSessions()) {
      const activeId = this.activeRunBySession.get(session.sessionId);
      if (activeId) {
        const run = this.store.agentRun<AgentRunRecord>(activeId);
        if (run && run.status === 'running') {
          run.status = 'interrupted'; run.completedAt = timestamp; run.updatedAt = timestamp;
          this.store.saveAgentRun(run);
          for (const input of this.store.agentInputs<AgentInputRecord>(session.sessionId)) {
            if (input.runId === run.runId && (input.status === 'accepted' || input.status === 'delivered')) {
              input.status = 'interrupted'; this.store.saveAgentInput(input);
            }
          }
          session.status = 'interrupted'; session.updatedAt = timestamp;
          this.store.saveAgentSession(session);
        }
      }
    }
    for (const loaded of this.sessions.values()) {
      if (!loaded.session.isIdle) void loaded.session.abort().catch(() => {});
      loaded.disposeEvents();
      loaded.session.dispose();
    }
    for (const controller of this.runAbortControllers.values()) controller.abort();
    this.runAbortControllers.clear();
    this.sessions.clear();
    this.listeners.clear();
  }

  private async startInput(sessionId: string, kind: 'message' | 'answer', text: string, options: AgentAcceptedInputOptions & { documentId?: string }): Promise<AgentRunStart> {
    this.ensureOpen();
    const session = this.requireSession(sessionId);
    if (!text.trim()) throw new RuntimeError('invalid', 'Input text must not be empty.');
    if (options.inputId) {
      const existing = this.existingInput(options.inputId, sessionId, kind, text, options.assetIds);
      if (existing) return { runId: existing.runId!, inputId: existing.inputId };
    }
    const loaded = this.sessions.get(sessionId);
    if (this.tasks.has(sessionId) || (loaded && !loaded.session.isIdle)) throw new RuntimeError('busy', 'The previous agent run is still stopping. Wait for it to become idle before sending another message.');
    if (session.status === 'waiting_input') throw new RuntimeError('conflict', 'Answer or cancel the pending question before starting another message.');
    if (session.status === 'running' || this.activeRunBySession.has(sessionId)) throw new RuntimeError('busy', 'This session already has an active run. Use steer or follow-up to add a message.');
    const createdAt = now();
    const runId = `run-${randomUUID()}`;
    const inputId = options.inputId ?? `input-${randomUUID()}`;
    const input: AgentInputRecord = { inputId, sessionId, runId, kind, text, assetIds: options.assetIds, status: 'accepted', createdAt };
    if (options.documentId) {
      const current = this.selections.get(sessionId);
      this.setSelection(sessionId, { documentId: options.documentId, nodeIds: current?.documentId === options.documentId ? current.nodeIds : [] });
    }
    const run: AgentRunRecord = { runId, sessionId, status: 'running', inputIds: [inputId], startedAt: createdAt, updatedAt: createdAt };
    session.status = 'running'; session.lastRunId = runId; session.updatedAt = createdAt;
    this.store.transaction(() => {
      this.store.insertAgentInput(input);
      this.store.saveAgentRun(run);
      this.store.saveAgentSession(session);
    });
    this.runAbortControllers.set(runId, new AbortController());
    this.activeRunBySession.set(sessionId, runId);
    this.persistEvent({ type: 'input.accepted', sessionId, runId, inputId, record: input });
    this.persistEvent({ type: 'run.started', sessionId, runId, inputId, record: run });
    this.dispatch(sessionId, input, run);
    return { runId, inputId };
  }

  private async queueInput(sessionId: string, kind: 'steer' | 'follow_up', text: string, options: AgentAcceptedInputOptions): Promise<AgentRunStart> {
    this.ensureOpen();
    const session = this.requireSession(sessionId);
    if (options.inputId) {
      const existing = this.existingInput(options.inputId, sessionId, kind, text, options.assetIds);
      if (existing) return { runId: existing.runId!, inputId: existing.inputId };
    }
    const runId = this.activeRunBySession.get(sessionId);
    if (!runId) throw new RuntimeError('conflict', 'There is no active run to receive this message.');
    const run = this.store.agentRun<AgentRunRecord>(runId);
    if (!run || run.status !== 'running') throw new RuntimeError('conflict', 'This run no longer accepts messages.');
    if (!text.trim()) throw new RuntimeError('invalid', 'Input text must not be empty.');
    const createdAt = now();
    const inputId = options.inputId ?? `input-${randomUUID()}`;
    const input: AgentInputRecord = { inputId, sessionId, runId, kind, text, assetIds: options.assetIds, status: 'accepted', createdAt };
    run.inputIds.push(inputId); run.updatedAt = createdAt;
    this.store.transaction(() => { this.store.insertAgentInput(input); this.store.saveAgentRun(run); });
    const queued = this.queuedInputs.get(sessionId) ?? [];
    queued.push(input); this.queuedInputs.set(sessionId, queued);
    this.persistEvent({ type: 'input.accepted', sessionId, runId, inputId, record: input });
    const loaded = this.sessions.get(sessionId);
    if (loaded) void this.flushQueued(sessionId, loaded, runId);
    return { runId, inputId };
  }

  private dispatch(sessionId: string, input: AgentInputRecord, run: AgentRunRecord, afterIdle = false): void {
    const task = this.executeRun(sessionId, input, run, afterIdle).catch(error => this.failRun(sessionId, run.runId, input.inputId, error));
    this.tasks.set(sessionId, task);
    void task.finally(() => { if (this.tasks.get(sessionId) === task) this.tasks.delete(sessionId); });
  }

  private async executeRun(sessionId: string, input: AgentInputRecord, run: AgentRunRecord, afterIdle: boolean): Promise<void> {
    const loaded = await this.loadSession(sessionId);
    if (afterIdle && !loaded.session.isIdle) await loaded.session.waitForIdle();
    if (this.closed || this.store.agentRun<AgentRunRecord>(run.runId)?.status !== 'running') return;
    this.activeRunBySession.set(sessionId, run.runId);
    const sessionRecord = this.requireSession(sessionId);
    sessionRecord.status = 'running'; sessionRecord.lastRunId = run.runId; sessionRecord.updatedAt = now();
    this.store.saveAgentSession(sessionRecord);
    const content = await this.inputContent(input, this.runAbortControllers.get(run.runId)?.signal);
    if (this.closed || this.store.agentRun<AgentRunRecord>(run.runId)?.status !== 'running') return;
    loaded.session.agent.state.systemPrompt = systemPrompt(await this.contextText(sessionId));
    const messages = [{ type: 'text' as const, text: content.text }, ...content.images];
    input.status = 'delivered'; input.deliveredAt = now();
    this.store.saveAgentInput(input);
    this.emit({ type: 'input.delivered', sessionId, runId: run.runId, inputId: input.inputId, record: input });
    const prompt = loaded.session.sendCustomMessage({
      customType: 'oey_input', content: messages, display: true,
      details: { inputId: input.inputId, runId: run.runId, kind: input.kind, assetIds: input.assetIds ?? [] },
    }, { triggerTurn: true });
    void this.flushQueued(sessionId, loaded, run.runId);
    await prompt;
    await loaded.session.waitForIdle();
    const currentRun = this.store.agentRun<AgentRunRecord>(run.runId);
    if (currentRun?.status === 'waiting_input') {
      this.activeRunBySession.delete(sessionId);
      this.runAbortControllers.delete(run.runId);
      return;
    }
    this.finishRun(sessionId, run.runId, loaded.session.agent.state.errorMessage);
  }

  private async flushQueued(sessionId: string, loaded: LoadedSession, runId: string): Promise<void> {
    if (this.flushingSessions.has(sessionId)) return;
    this.flushingSessions.add(sessionId);
    try {
    while (!this.closed && this.activeRunBySession.get(sessionId) === runId) {
      const queue = this.queuedInputs.get(sessionId);
      const next = queue?.shift();
      if (!next) return;
      if (queue?.length === 0) this.queuedInputs.delete(sessionId);
      if (next.runId !== runId) {
        next.status = 'interrupted';
        this.store.saveAgentInput(next);
        continue;
      }
      const run = this.store.agentRun<AgentRunRecord>(runId);
      if (!run || run.status !== 'running') return;
      const content = await this.inputContent(next, this.runAbortControllers.get(runId)?.signal);
      const currentRun = this.store.agentRun<AgentRunRecord>(runId);
      if (this.closed || !currentRun || currentRun.status !== 'running') return;
      const customContent = [{ type: 'text' as const, text: `\n\n${next.kind === 'steer' ? 'Steering correction' : 'Follow-up'} (${next.inputId}):\n${content.text}` }, ...content.images];
      const delivery = next.kind === 'steer' ? 'steer' : 'followUp';
      const isStreaming = loaded.session.isStreaming;
      if (!isStreaming) {
        queue?.unshift(next);
        if (queue) this.queuedInputs.set(sessionId, queue);
        await new Promise(resolve => setTimeout(resolve, 15));
        continue;
      }
      next.status = 'delivered'; next.deliveredAt = now();
      this.store.saveAgentInput(next);
      this.emit({ type: 'input.delivered', sessionId, runId, inputId: next.inputId, record: next });
      await loaded.session.sendCustomMessage({
        customType: 'oey_input', content: customContent, display: true,
        details: { inputId: next.inputId, runId, kind: next.kind, assetIds: next.assetIds ?? [] },
      }, { deliverAs: delivery });
    }
    } catch (error) {
      const currentRun = this.closed ? undefined : this.store.agentRun<AgentRunRecord>(runId);
      if (currentRun?.status === 'running') {
        const pendingInput = this.store.agentInputs<AgentInputRecord>(sessionId).find(input => input.runId === runId && input.status === 'accepted');
        this.failRun(sessionId, runId, pendingInput?.inputId ?? currentRun.inputIds[0] ?? '', error);
        this.runAbortControllers.get(runId)?.abort();
      }
    }
    finally {
      this.flushingSessions.delete(sessionId);
    }
  }

  private async loadSession(sessionId: string): Promise<LoadedSession> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    const pending = this.sessionLoads.get(sessionId);
    if (pending) return pending;
    const load = this.createPiSession(sessionId).finally(() => this.sessionLoads.delete(sessionId));
    this.sessionLoads.set(sessionId, load);
    return load;
  }

  private async createPiSession(sessionId: string): Promise<LoadedSession> {
    this.ensureOpen();
    const record = this.requireSession(sessionId);
    const [sdk, configured] = await Promise.all([loadPiSdk(), this.createModelRuntime()]);
    const sessionDir = join(this.runtime.root, 'sessions');
    await mkdir(sessionDir, { recursive: true });
    let manager: SessionManager;
    const sessionPath = record.piSessionFile ? resolve(record.piSessionFile) : '';
    const withinSessions = sessionPath && !relative(sessionDir, sessionPath).startsWith('..') && !isAbsolute(relative(sessionDir, sessionPath));
    if (withinSessions && existsSync(sessionPath)) manager = sdk.SessionManager.open(sessionPath, sessionDir, this.runtime.root);
    else manager = sdk.SessionManager.create(this.runtime.root, sessionDir, { id: record.piSessionId });
    const sessionFile = manager.getSessionFile();
    record.piSessionFile = sessionFile;
    record.updatedAt = now();
    this.store.saveAgentSession(record);
    const settingsManager = sdk.SettingsManager.inMemory();
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: this.runtime.root,
      agentDir: join(this.runtime.root, 'sessions', '.agent-config-disabled'),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: SYSTEM_PROMPT,
    });
    await resourceLoader.reload();
    const tools = await this.createTools(sessionId, sdk);
    const { session } = await sdk.createAgentSession({
      cwd: this.runtime.root,
      agentDir: join(this.runtime.root, 'sessions', '.agent-config-disabled'),
      model: configured.model,
      thinkingLevel: this.config.thinkingLevel ?? 'high',
      modelRuntime: configured.modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager: manager,
      noTools: 'all',
      customTools: tools,
      tools: tools.map(tool => tool.name),
    });
    session.agent.toolExecution = 'sequential';
    session.agent.beforeToolCall = async () => {
      const activeRun = this.activeRunBySession.get(sessionId);
      const status = activeRun ? this.store.agentRun<AgentRunRecord>(activeRun)?.status : undefined;
      if (!activeRun || status !== 'running') return { block: true, terminate: true, reason: 'This run is no longer allowed to execute tools.' };
      return undefined;
    };
    session.agent.shouldStopAfterTurn = async () => {
      const activeRun = this.activeRunBySession.get(sessionId);
      const status = activeRun ? this.store.agentRun<AgentRunRecord>(activeRun)?.status : undefined;
      return status !== 'running';
    };
    session.agent.prepareNextTurnWithContext = async context => {
      if (this.closed) return undefined;
      const current = await this.contextText(sessionId);
      return { context: { ...context.context, systemPrompt: systemPrompt(current) } };
    };
    const disposeEvents = session.subscribe(event => {
      if (this.closed) return;
      if (event.type === 'entry_appended' && event.entry.type === 'message') {
        const message = event.entry.message;
        if (message.role === 'custom' && message.customType === 'oey_input') {
          const details = message.details as { inputId?: string } | undefined;
          const input = details?.inputId ? this.store.agentInput<AgentInputRecord>(details.inputId) : undefined;
          if (input && input.status === 'accepted') {
            input.status = 'delivered'; input.deliveredAt = now(); input.piEntryId = event.entry.id;
            this.store.saveAgentInput(input);
            this.emit({ type: 'input.delivered', sessionId, runId: input.runId, inputId: input.inputId, record: input });
          } else if (input && !input.piEntryId) {
            input.piEntryId = event.entry.id;
            this.store.saveAgentInput(input);
          }
        }
      }
      this.emit({ type: 'agent.event', sessionId, runId: this.activeRunBySession.get(sessionId), event });
    });
    const loaded = { session, manager, modelRuntime: configured.modelRuntime, disposeEvents };
    this.sessions.set(sessionId, loaded);
    return loaded;
  }

  private async createModelRuntime(): Promise<ConfiguredModel> {
    const config = { ...this.config };
    if (this.options.createModelRuntime) return this.options.createModelRuntime(config);
    if (!config.providerId || !config.modelId) throw new RuntimeError('invalid', 'Configure a model provider and model before starting an agent run.');
    const sdk = await loadPiSdk();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new sdk.InMemoryCredentialStore(), modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false,
    });
    const secret = config.apiKey || (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);
    if (config.baseUrl) {
      if (!secret) throw new RuntimeError('invalid', `Set ${config.apiKeyEnv ?? 'API_KEY'} to use the configured model service.`);
      const api = config.api ?? 'openai-completions';
      runtime.registerProvider(config.providerId, {
        name: config.providerName ?? config.providerId,
        baseUrl: config.baseUrl,
        api,
        apiKey: secret,
        ...(config.userAgent ? { headers: { 'User-Agent': config.userAgent } } : {}),
        models: [{
          id: config.modelId,
          name: config.modelId,
          api,
          baseUrl: config.baseUrl,
          reasoning: config.reasoning ?? true,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: config.contextWindow ?? 128_000,
          maxTokens: config.maxTokens ?? 8_192,
          // The existing compatible service rejects OpenAI's `developer` role.
          // Pi defaults this compatibility flag to true, so opt into `system`
          // unless a caller has explicitly supplied a different override.
          compat: { supportsDeveloperRole: false, ...config.compat },
        }],
      });
      const model = runtime.getModel(config.providerId, config.modelId);
      if (!model) throw new RuntimeError('invalid', 'Pi did not register the configured compatible model.');
      return { modelRuntime: runtime, model };
    }
    const model = runtime.getModel(config.providerId, config.modelId);
    if (!model) throw new RuntimeError('invalid', `Pi does not provide model ${config.providerId}/${config.modelId}.`);
    if (secret) await runtime.setRuntimeApiKey(config.providerId, secret);
    return { modelRuntime: runtime, model };
  }

  private async createTools(sessionId: string, sdk: PiSdk): Promise<ToolDefinition[]> {
    const { Type } = sdk;
    const define = sdk.defineTool;
    const sequential = { executionMode: 'sequential' as const };
    const tools: ToolDefinition[] = [];
    const thisService = this;
    tools.push(define({
      name: 'project_read', label: 'Read project', description: 'Read project information, documents and registered asset metadata.',
      parameters: Type.Object({}), ...sequential,
      async execute() {
        const project = thisService.runtime.project;
        const documents = thisService.runtime.listDocuments().map(document => ({ documentId: document.documentId, kind: document.kind, name: document.name, revision: document.revision, pages: document.pages.map(page => ({ id: page.id, name: page.name })) }));
        const assets = thisService.runtime.listRecords<{ id: string; kind: string; name: string; mimeType: string; sizeBytes: number }>('assets').map(record => record.value);
        return textResult(JSON.stringify({ project, documents, assets }, null, 2), { project, documents, assets });
      },
    }));
    tools.push(define({
      name: 'document_read', label: 'Read document', description: 'Read a document snapshot at its current revision.',
      parameters: Type.Object({ documentId: Type.String() }), ...sequential,
      async execute(_id, args) {
        const document = thisService.runtime.readDocument(args.documentId);
        return textResult(JSON.stringify(document, null, 2), { documentId: document.documentId, revision: document.revision });
      },
    }));
    tools.push(define({
      name: 'document_query', label: 'Query document', description: 'Find nodes by ID or text in the current document, optionally restricted to selected nodes.',
      parameters: Type.Object({ documentId: Type.String(), query: Type.String(), selectedOnly: Type.Optional(Type.Boolean()) }), ...sequential,
      async execute(_id, args) {
        const document = thisService.runtime.readDocument(args.documentId);
        const selection = thisService.selections.get(sessionId);
        const query = args.query.toLocaleLowerCase();
        const nodes = Object.values(document.nodes).filter(node => {
          if (args.selectedOnly && selection?.documentId === document.documentId && !selection.nodeIds.includes(node.id)) return false;
          return node.id.toLocaleLowerCase().includes(query) || JSON.stringify(node).toLocaleLowerCase().includes(query);
        }).slice(0, 100);
        return textResult(JSON.stringify({ documentId: document.documentId, revision: document.revision, nodes }, null, 2), { revision: document.revision, count: nodes.length });
      },
    }));
    tools.push(define({
      name: 'document_schema', label: 'Read document operation schema',
      description: 'Read exact node and operation fields for a document kind. Pass documentId or kind:web for Web nodes, layouts and managed source modules. Defaults to Deck.',
      parameters: Type.Object({ documentId: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal('deck'), Type.Literal('web')])) }), ...sequential,
      async execute(_id, args) {
        const kind = args.documentId ? thisService.runtime.readDocument(args.documentId).kind : args.kind ?? 'deck';
        if (kind === 'web') return textResult(JSON.stringify(webOperationSchema, null, 2), webOperationSchema);
        const exampleTextNode = { id: 'title-1', kind: 'text', parentId: 'page-id-from-document_read', geometry: { x: 80, y: 60, width: 900, height: 140, rotation: 0 }, style: {}, locked: false, hidden: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Headline' }] }] } };
        const cellDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] };
        const nodeExamples = {
          text: exampleTextNode,
          shape: { id: 'shape-1', kind: 'shape', parentId: 'page-id-from-document_read', geometry: { x: 80, y: 220, width: 320, height: 180, rotation: 0 }, style: { fill: '#DDEBDD', stroke: '#2F855A', strokeWidth: 2 }, locked: false, hidden: false },
          image: { id: 'image-1', kind: 'image', parentId: 'page-id-from-document_read', geometry: { x: 440, y: 220, width: 320, height: 180, rotation: 0 }, style: {}, locked: false, hidden: false, assetId: 'asset-id-from-project_read', image: { fit: 'cover', opacity: 1 } },
          group: { id: 'group-1', kind: 'group', parentId: 'page-id-from-document_read', geometry: { x: 80, y: 430, width: 400, height: 220, rotation: 0 }, style: {}, locked: false, hidden: false, children: [] },
          table: { id: 'table-1', kind: 'table', parentId: 'page-id-from-document_read', geometry: { x: 80, y: 220, width: 560, height: 240, rotation: 0 }, style: {}, locked: false, hidden: false, table: { rows: [{ id: 'row-1', cells: [{ id: 'cell-1', content: cellDoc }, { id: 'cell-2', content: cellDoc }] }, { id: 'row-2', cells: [{ id: 'cell-3', content: cellDoc }, { id: 'cell-4', content: cellDoc }] }], columnWidths: [280, 280], headerRows: 1, borderColor: '#CBD5D1', borderWidth: 1, cellPadding: 8 } },
          chart: { id: 'chart-1', kind: 'chart', parentId: 'page-id-from-document_read', geometry: { x: 80, y: 220, width: 640, height: 360, rotation: 0 }, style: {}, locked: false, hidden: false, chart: { type: 'bar', title: 'Quarterly trend', categories: ['Q1', 'Q2', 'Q3'], series: [{ id: 'series-1', name: 'Revenue', values: [12, 18, 16], color: '#2F855A' }], legend: true, dataLabels: false } },
        };
        const schema = {
          revisionRule: 'Read the current document; pass that revision as baseRevision. Every node has id, kind (text|shape|image|group|table|chart), parentId, geometry {x,y,width,height,rotation}, style object, locked boolean, hidden boolean. A new group starts empty; insert its children in later operations.',
          insertionNotes: 'Insert each page or node using a unique stable id. For a node, set parentId to its page id or group id; for an image, register the imported asset first and use its asset id. Nodes are placed in the parent child list at index (default: append). Shape currently exports as a rectangle.',
          nodeExamples,
          operations: {
            'page.insert': { page: { id: 'page-2', name: 'Slide 2', width: 1280, height: 720, children: [] }, index: 1 },
            'page.update': { pageId: 'page-id', page: { name: 'New name', width: 1280, height: 720 } },
            'page.reorder': { pageId: 'page-id', index: 0 },
            'node.insert': { node: nodeExamples.text, index: 0 },
            'node.remove': { nodeId: 'node-id' },
            'node.reorder': { nodeId: 'node-id', index: 0, parentId: 'page-or-group-id' },
            'node.reparent': { nodeId: 'node-id', parentId: 'page-or-group-id', index: 0 },
            'geometry.update': { nodeId: 'node-id', geometry: { x: 80, y: 60, width: 900, height: 140, rotation: 0 } },
            'style.update': { nodeId: 'node-id', style: { fill: '#FFFFFF', color: '#18221C', fontSize: 32, fontFamily: 'Aptos' } },
            'node.flags.update': { nodeId: 'node-id', flags: { locked: false, hidden: false } },
            'text.apply': { nodeId: 'text-node-id', steps: [{ stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: 'Hello' }] } }] },
            'image.update': { nodeId: 'image-node-id', image: { fit: 'cover', crop: { left: 0, top: 0, right: 0, bottom: 0 }, opacity: 1 } },
            'asset.register': { asset: { id: 'asset-id-from-project_read', kind: 'image', mimeType: 'image/png', width: 640, height: 480, name: 'image.png' } },
            'asset.replace': { nodeId: 'image-node-id', asset: { id: 'asset-id', kind: 'image', mimeType: 'image/png', width: 640, height: 480 } },
            'table.update': { nodeId: 'table-node-id', table: { rows: [{ id: 'row-1', cells: [{ id: 'cell-1', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] } }] }], columnWidths: [260], headerRows: 1, borderColor: '#CCD4DD', borderWidth: 1, cellPadding: 8 } },
            'chart.update': { nodeId: 'chart-node-id', chart: { type: 'bar', categories: ['Q1', 'Q2'], series: [{ id: 'sales', name: 'Sales', values: [120, 150], color: '#2F855A' }], legend: true, dataLabels: false } },
            'document.theme': { theme: { name: 'Forest', fontFamily: 'Aptos', headingFontFamily: 'Aptos Display', bodyFontFamily: 'Aptos', colors: { accent1: '#2F855A', text1: '#18221C', background1: '#FFFFFF' } } },
          },
        };
        return textResult(JSON.stringify(schema, null, 2), schema);
      },
    }));
    tools.push(define({
      name: 'document_apply', label: 'Apply design changes', description: 'Apply a sequential batch of shared document operations. Supply the revision you read as baseRevision. Before creating nodes or rich content, call document_schema for exact node, text, image, table, chart and theme shapes.',
      parameters: Type.Object({ documentId: Type.String(), baseRevision: Type.Integer(), operations: Type.Array(Type.Any()), label: Type.Optional(Type.String()) }), ...sequential,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const runId = thisService.requireActiveRun(sessionId);
        const command = thisService.runtime.makeCommand(args.documentId, args.operations as never, {
          actorId: `agent:${sessionId}`, actorKind: 'agent', clientId: `agent:${sessionId}`,
          runId, baseRevision: args.baseRevision, label: args.label ?? 'Agent design edit',
        });
        signal?.throwIfAborted();
        const result = thisService.runtime.submit(command);
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'document_undo', label: 'Undo design change', description: 'Undo the latest shared document change, preserving normal revision checks.',
      parameters: Type.Object({ documentId: Type.String(), baseRevision: Type.Optional(Type.Integer()) }), ...sequential,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const runId = thisService.requireActiveRun(sessionId);
        const result = thisService.runtime.undo(args.documentId, { actorId: `agent:${sessionId}`, actorKind: 'agent', clientId: `agent:${sessionId}`, runId, baseRevision: args.baseRevision });
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'document_redo', label: 'Redo design change', description: 'Redo the latest shared document change, preserving normal revision checks.',
      parameters: Type.Object({ documentId: Type.String(), baseRevision: Type.Optional(Type.Integer()) }), ...sequential,
      async execute(_id, args, signal) {
        signal?.throwIfAborted();
        const runId = thisService.requireActiveRun(sessionId);
        const result = thisService.runtime.redo(args.documentId, { actorId: `agent:${sessionId}`, actorKind: 'agent', clientId: `agent:${sessionId}`, runId, baseRevision: args.baseRevision });
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'design_decide', label: 'Record design decision', description: 'Save a confirmed design decision for later turns and recovery.',
      parameters: Type.Object({ text: Type.String(), documentId: Type.Optional(Type.String()) }), ...sequential,
      async execute(_id, args) {
        const runId = thisService.requireActiveRun(sessionId);
        if (args.documentId) thisService.runtime.readDocument(args.documentId);
        const decision: DecisionRecord = { decisionId: `decision-${randomUUID()}`, sessionId, runId, documentId: args.documentId, text: args.text, createdAt: now() };
        thisService.runtime.putRecord('agent-decisions', decision.decisionId, decision);
        return textResult('Decision saved.', decision);
      },
    }));
    tools.push(define({
      name: 'reference_read', label: 'Read reference', description: 'Read an imported text or image reference by asset ID. Image references are returned visually.',
      parameters: Type.Object({ assetId: Type.String(), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }), ...sequential,
      async execute(_id, args, signal) {
        const service = thisService.requireServices().readReference;
        const result = await service({ assetId: args.assetId, offset: args.offset, limit: args.limit }, signal ?? new AbortController().signal) as { asset?: unknown; mimeType?: string; data?: string; text?: string };
        if (result.mimeType && result.data) {
          const image = toImageContent(result.mimeType, result.data);
          return { content: [image, { type: 'text', text: JSON.stringify(result.asset ?? { assetId: args.assetId }) }], details: result.asset ?? { assetId: args.assetId } };
        }
        return textResult(result.text ?? JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'asset_import', label: 'Import asset', description: 'Import a file already placed in the project references folder; returns its asset ID.',
      parameters: Type.Object({ path: Type.String() }), ...sequential,
      async execute(_id, args, signal) {
        const result = await thisService.requireServices().importAsset({ path: args.path }, signal ?? new AbortController().signal);
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'asset_generate', label: 'Generate image asset', description: 'Generate an image from a prompt and return the stored asset ID. This does not insert it into the document.',
      parameters: Type.Object({ prompt: Type.String() }), ...sequential,
      async execute(_id, args, signal) {
        const result = await thisService.requireServices().generateAsset({ prompt: args.prompt }, signal ?? new AbortController().signal);
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'render_preview', label: 'Render preview', description: 'Render the current document or a page and return an image for visual inspection.',
      parameters: Type.Object({ documentId: Type.String(), pageId: Type.Optional(Type.String()) }), ...sequential,
      async execute(_id, args, signal) {
        const result = await thisService.requireServices().preview({ documentId: args.documentId, pageId: args.pageId }, signal ?? new AbortController().signal);
        const image = toImageContent(result.mimeType, result.data);
        return { content: [image, { type: 'text', text: `Preview at revision ${result.revision}.` }], details: { revision: result.revision, mimeType: result.mimeType } };
      },
    }));
    tools.push(define({
      name: 'artifact_export', label: 'Export artifact', description: 'Export the committed revision. Deck: pptx/pdf/png. Web: html/zip/source.zip/build.zip/pdf/png.',
      parameters: Type.Object({ documentId: Type.String(), format: Type.Union([Type.Literal('pptx'), Type.Literal('pdf'), Type.Literal('png'), Type.Literal('html'), Type.Literal('zip'), Type.Literal('source.zip'), Type.Literal('build.zip')]) }), ...sequential,
      async execute(_id, args, signal) {
        const result = await thisService.requireServices().exportArtifact({ documentId: args.documentId, format: args.format }, signal ?? new AbortController().signal);
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'version_create', label: 'Create design version', description: 'Save a named design version at the current document revision.',
      parameters: Type.Object({ documentId: Type.String(), name: Type.String() }), ...sequential,
      async execute(_id, args) {
        thisService.requireActiveRun(sessionId);
        const version = thisService.runtime.createVersion(args.documentId, args.name);
        return textResult(JSON.stringify(version), version);
      },
    }));
    tools.push(define({
      name: 'version_restore', label: 'Restore design version', description: 'Restore a design version as a new document revision.',
      parameters: Type.Object({ versionId: Type.String(), baseRevision: Type.Optional(Type.Integer()) }), ...sequential,
      async execute(_id, args) {
        const runId = thisService.requireActiveRun(sessionId);
        const result = thisService.runtime.restoreVersion(args.versionId, { actorId: `agent:${sessionId}`, actorKind: 'agent', clientId: `agent:${sessionId}`, runId, baseRevision: args.baseRevision });
        return textResult(JSON.stringify(result), result);
      },
    }));
    tools.push(define({
      name: 'user_ask', label: 'Ask user', description: 'Ask one question when an important decision is missing; the current run stops and waits for an answer.',
      parameters: Type.Object({ prompt: Type.String(), options: Type.Optional(Type.Array(Type.String())), allowFreeText: Type.Optional(Type.Boolean()) }), ...sequential,
      async execute(_id, args) {
        const runId = thisService.requireActiveRun(sessionId);
        const run = thisService.store.agentRun<AgentRunRecord>(runId)!;
        const session = thisService.requireSession(sessionId);
        const createdAt = now();
        const question: AgentQuestionRecord = { questionId: `question-${randomUUID()}`, sessionId, runId, status: 'pending', prompt: args.prompt, options: args.options ?? [], allowFreeText: args.allowFreeText ?? true, createdAt };
        run.status = 'waiting_input'; run.updatedAt = createdAt;
        session.status = 'waiting_input'; session.updatedAt = createdAt;
        thisService.store.transaction(() => {
          thisService.store.saveAgentQuestion(question);
          thisService.store.saveAgentRun(run);
          thisService.store.saveAgentSession(session);
          for (const input of thisService.store.agentInputs<AgentInputRecord>(sessionId)) {
            if (input.runId === runId && input.kind !== 'message' && input.status === 'accepted') {
              input.status = 'interrupted';
              thisService.store.saveAgentInput(input);
            }
          }
        });
        thisService.queuedInputs.delete(sessionId);
        thisService.persistEvent({ type: 'question.created', sessionId, runId, questionId: question.questionId, record: question });
        return { ...textResult('Waiting for the user to answer this question.', question), terminate: true };
      },
    }));
    return tools;
  }

  private async inputContent(input: AgentInputRecord, signal?: AbortSignal): Promise<{ text: string; images: ImageContent[] }> {
    const images: ImageContent[] = [];
    let text = input.text;
    if (input.assetIds?.length) {
      const read = this.services?.readReference;
      if (!read) throw new RuntimeError('invalid', 'Asset attachments are unavailable until design services are configured.');
      for (const assetId of input.assetIds.slice(0, 10)) {
        signal?.throwIfAborted();
        const result = await read({ assetId, limit: 12000 }, signal ?? new AbortController().signal) as { asset?: { name?: string }; mimeType?: string; data?: string; text?: string };
        signal?.throwIfAborted();
        if (result.mimeType && result.data) images.push(toImageContent(result.mimeType, result.data));
        else if (result.text) text += `\n\nReference: ${result.asset?.name ?? assetId}\n${result.text}`;
      }
    }
    return { text, images };
  }

  private async contextText(sessionId: string): Promise<string> {
    const project = this.runtime.project;
    const documents = this.runtime.listDocuments().map(document => ({ documentId: document.documentId, kind: document.kind, name: document.name, revision: document.revision, pages: document.pages.map(page => ({ id: page.id, name: page.name })) }));
    const selection = this.selections.get(sessionId) ?? this.store.getRecord<AgentSelection>('agent-selections', sessionId);
    const decisions = this.runtime.listRecords<DecisionRecord>('agent-decisions').map(record => record.value).filter(item => item.sessionId === sessionId).slice(-20);
    const recentHumanChanges = this.runtime.events().filter(event => event.type === 'document.changed' && event.payload.actorKind === 'human')
      .slice(-5).map(event => ({ documentId: event.documentId, revision: event.revision, changedNodeIds: event.payload.changedNodeIds }));
    return JSON.stringify({ project: { id: project.projectId, name: project.name }, documents, selection, recentHumanChanges, decisions }, null, 2);
  }

  private requireActiveRun(sessionId: string): string {
    const runId = this.activeRunBySession.get(sessionId);
    if (!runId || this.store.agentRun<AgentRunRecord>(runId)?.status !== 'running') throw new RuntimeError('cancelled', 'No active agent run may perform this action.');
    return runId;
  }

  private requireServices(): AgentDesignServices {
    if (!this.services) throw new RuntimeError('invalid', 'Design services have not been configured for this runtime.');
    return this.services;
  }

  private requireSession(sessionId: string): AgentSessionRecord {
    this.ensureOpen();
    const record = this.store.agentSession<AgentSessionRecord>(sessionId);
    if (!record) throw new RuntimeError('not_found', 'Agent session does not exist.', { sessionId });
    return record;
  }

  private finishRun(sessionId: string, runId: string, errorMessage?: string): void {
    if (this.closed) return;
    const run = this.store.agentRun<AgentRunRecord>(runId);
    if (!run || run.status !== 'running') return;
    const timestamp = now();
    run.status = errorMessage ? 'failed' : 'completed'; run.error = errorMessage; run.completedAt = timestamp; run.updatedAt = timestamp;
    const session = this.requireSession(sessionId);
    session.status = 'idle'; session.updatedAt = timestamp;
    this.store.transaction(() => {
      this.store.saveAgentRun(run);
      this.store.saveAgentSession(session);
      for (const input of this.store.agentInputs<AgentInputRecord>(sessionId)) {
        if (input.runId === runId && input.status === 'delivered') { input.status = 'resolved'; this.store.saveAgentInput(input); }
        else if (input.runId === runId && input.status === 'accepted') { input.status = 'interrupted'; this.store.saveAgentInput(input); }
      }
    });
    this.activeRunBySession.delete(sessionId);
    this.runAbortControllers.delete(runId);
    this.persistEvent({ type: errorMessage ? 'run.failed' : 'run.completed', sessionId, runId, record: run });
  }

  private failRun(sessionId: string, runId: string, inputId: string, error: unknown): void {
    if (this.closed) return;
    const run = this.store.agentRun<AgentRunRecord>(runId);
    if (!run || run.status !== 'running') return;
    const message = error instanceof Error ? error.message : String(error);
    const timestamp = now();
    run.status = 'failed'; run.error = message; run.completedAt = timestamp; run.updatedAt = timestamp;
    const session = this.requireSession(sessionId); session.status = 'idle'; session.updatedAt = timestamp;
    const input = this.store.agentInput<AgentInputRecord>(inputId);
    if (input && input.status === 'accepted') input.status = 'interrupted';
    this.store.transaction(() => {
      this.store.saveAgentRun(run); this.store.saveAgentSession(session);
      if (input) this.store.saveAgentInput(input);
    });
    this.activeRunBySession.delete(sessionId);
    this.runAbortControllers.delete(runId);
    this.persistEvent({ type: 'run.failed', sessionId, runId, inputId, record: run });
  }

  private emit(event: Omit<AgentServiceEvent, 'createdAt'> & { createdAt?: string }): void {
    if (this.closed) return;
    const value: AgentServiceEvent = { ...event, createdAt: event.createdAt ?? now() };
    for (const listener of this.listeners) { try { listener(structuredClone(value)); } catch { /* Subscribers can reconnect from current records. */ } }
  }

  private persistEvent(event: Omit<AgentServiceEvent, 'createdAt'> & { createdAt?: string }): void {
    if (this.closed) return;
    const value: AgentServiceEvent = { ...event, createdAt: event.createdAt ?? now() };
    this.store.putRecord('agent-events', `event-${randomUUID()}`, value);
    for (const listener of this.listeners) { try { listener(structuredClone(value)); } catch { /* Subscribers can reconnect from current records. */ } }
  }

  private ensureOpen(): void { if (this.closed) throw new RuntimeError('invalid', 'Agent service is closed.'); }
}
