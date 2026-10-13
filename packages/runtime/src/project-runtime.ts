import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { imageSize } from 'image-size';
import { prepareWebSourceImport, prepareWebStructureImport, prepareDocxImport, docFingerprint } from '@oeydesign/media';
import type { StoredAsset } from './assets.ts';
import { applyEditableCommand, createDocDocument, createDeckDocument, createWebDocument, restoreEditableDocument, validateEditableDocument } from '@oeydesign/document';
import type { CommandEnvelope, DocDocument, DeckDocument, EditableDocument, WebDocument, ImageAsset } from '@oeydesign/document';
import { RuntimeError } from './errors.ts';
import { AgentService } from './agent-service.ts';
import type { AgentServiceOptions } from './agent-service.ts';
import type { AgentInputRecord, AgentQuestionRecord, AgentRunRecord, AgentSessionRecord } from './agent-types.ts';
import { acquireOwner } from './storage/owner.ts';
import { ProjectStore } from './storage/project-store.ts';
import type { CommandOptions, CommandResult, DesignVersion, HistoryOptions, ProjectEvent, ProjectInfo, StoredDocument } from './types.ts';

/** Stable JSON identity for retries, independent of object key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new RuntimeError('invalid', 'Commands require finite numbers.');
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    }
    return item;
  });
}

function actor(options: CommandOptions) {
  return { actorId: options.actorId ?? 'local-user', actorKind: options.actorKind ?? 'human', clientId: options.clientId ?? 'local' };
}

export class ProjectRuntime {
  readonly root: string;
  private readonly store: ProjectStore;
  private readonly owner: ReturnType<typeof acquireOwner>;
  private readonly info: ProjectInfo;
  readonly agent: AgentService;
  private readonly listeners = new Set<(event: ProjectEvent) => void>();
  private closed = false;

  private constructor(root: string, store: ProjectStore, owner: ReturnType<typeof acquireOwner>, info: ProjectInfo, agentOptions: AgentServiceOptions = {}) {
    this.root = root;
    this.store = store;
    this.owner = owner;
    this.info = info;
    this.agent = new AgentService(this, store, agentOptions);
  }

  static create(directory: string, options: { name?: string; agentService?: AgentServiceOptions } = {}): ProjectRuntime {
    const absolute = resolve(directory);
    const name = options.name ?? basename(absolute);
    if (!name.trim()) throw new RuntimeError('invalid', 'Project name must not be empty.');
    mkdirSync(absolute, { recursive: true });
    const root = realpathSync(absolute);
    const owner = acquireOwner(root);
    let store: ProjectStore | undefined;
    try {
      if (existsSync(join(root, 'project.sqlite'))) throw new RuntimeError('invalid', 'A project database already exists here. Open it or choose a new directory.');
      store = new ProjectStore(join(root, 'project.sqlite'), true);
      const info: ProjectInfo = { schemaVersion: 1, projectId: randomUUID(), name, createdAt: new Date().toISOString() };
      for (const directoryName of ['assets', 'cache', 'exports', 'sessions']) mkdirSync(join(root, directoryName), { recursive: true });
      store.transaction(() => {
        store!.createProject(info);
        store!.appendEvent({ projectId: info.projectId, eventId: randomUUID(), type: 'project.created', payload: { name: info.name }, createdAt: info.createdAt });
      });
      return new ProjectRuntime(root, store, owner, info, options.agentService);
    } catch (error) {
      store?.close();
      owner.close();
      throw error;
    }
  }

  static open(directory: string, options: { agentService?: AgentServiceOptions } = {}): ProjectRuntime {
    const absolute = resolve(directory);
    if (!existsSync(join(absolute, 'project.sqlite'))) throw new RuntimeError('not_found', 'No TypeScript project database exists in this directory.', { root: absolute });
    const root = realpathSync(absolute);
    const owner = acquireOwner(root);
    let store: ProjectStore | undefined;
    try {
      store = new ProjectStore(join(root, 'project.sqlite'));
      const info = store.project();
      if (!info || info.schemaVersion !== 1 || typeof info.projectId !== 'string') throw new RuntimeError('invalid', 'Unsupported or incomplete project schema.');
      return new ProjectRuntime(root, store, owner, info, options.agentService);
    } catch (error) {
      store?.close();
      owner.close();
      throw error;
    }
  }

  get project(): ProjectInfo { this.ensureOpen(); return structuredClone(this.info); }

  listDocuments(): EditableDocument[] { this.ensureOpen(); return this.store.listDocuments(); }

  getRecord<T>(namespace: string, id: string): T | undefined {
    this.ensureOpen();
    return this.store.getRecord<T>(namespace, id);
  }

  listRecords<T>(namespace: string): Array<{ id: string; value: T }> {
    this.ensureOpen();
    return this.store.listRecords<T>(namespace);
  }

  putRecord(namespace: string, id: string, value: unknown): void {
    this.ensureOpen();
    this.store.putRecord(namespace, id, value);
  }

  getAgentSessions(): AgentSessionRecord[] { this.ensureOpen(); return this.agent.listSessions(); }
  getAgentRuns(sessionId: string): AgentRunRecord[] { this.ensureOpen(); return this.agent.listRuns(sessionId); }
  getAgentInputs(sessionId: string): AgentInputRecord[] { this.ensureOpen(); return this.agent.listInputs(sessionId); }
  getAgentQuestions(sessionId: string): AgentQuestionRecord[] { this.ensureOpen(); return this.agent.listQuestions(sessionId); }

  readDocument(documentId: string, revision?: number): EditableDocument {
    this.ensureOpen();
    const document = revision === undefined ? this.store.document(documentId).document : this.store.snapshot(documentId, revision);
    validateEditableDocument(document);
    return document;
  }

  readDeckDocument(documentId: string, revision?: number): DeckDocument {
    const document = this.readDocument(documentId, revision);
    if (document.kind !== 'deck') throw new RuntimeError('invalid', `Document ${documentId} is not a Deck.`);
    return document;
  }

  readWebDocument(documentId: string, revision?: number): WebDocument {
    const document = this.readDocument(documentId, revision);
    if (document.kind !== 'web') throw new RuntimeError('invalid', `Document ${documentId} is not a Web document.`);
    return document;
  }

  readDocDocument(documentId: string, revision?: number): DocDocument {
    const document = this.readDocument(documentId, revision);
    if (document.kind !== 'doc') throw new RuntimeError('invalid', 'Document is not a Doc.');
    return document;
  }

  createDocument(options: { name?: string; documentId?: string; kind: 'doc' }, commandOptions?: CommandOptions): DocDocument;
  createDocument(options?: { name?: string; documentId?: string; kind?: 'deck' }, commandOptions?: CommandOptions): DeckDocument;
  createDocument(options: { name?: string; documentId?: string; kind: 'web' }, commandOptions?: CommandOptions): WebDocument;
  createDocument(options: { name?: string; documentId?: string; kind: 'deck' | 'web' | 'doc' }, commandOptions?: CommandOptions): EditableDocument;
  createDocument(options: { name?: string; documentId?: string; kind?: 'deck' | 'web' | 'doc' } = {}, commandOptions: CommandOptions = {}): EditableDocument {
    this.ensureOpen();
    if (options.kind !== undefined && options.kind !== 'deck' && options.kind !== 'web' && options.kind !== 'doc') throw new RuntimeError('invalid', 'Document kind must be deck, web or doc.');
    const commandId = commandOptions.commandId ?? randomUUID();
    const documentId = options.documentId ?? `document-${commandId}`;
    const request = canonicalJson({ type: 'document.create', commandId, options, actor: actor(commandOptions) });
    const previous = this.retry(commandId, request);
    if (previous) return this.readDocument(previous.documentId, previous.revision);
    if (this.store.listDocuments().some(document => document.documentId === documentId)) throw new RuntimeError('invalid', 'Document ID already exists.', { documentId });
    const document = options.kind === 'doc' ? createDocDocument({ documentId, name: options.name ?? 'Untitled document' }) : options.kind === 'web'
      ? createWebDocument({ documentId, name: options.name ?? 'Untitled website', pageId: `page-${documentId}`, rootId: `root-${documentId}` })
      : createDeckDocument({ documentId, name: options.name ?? 'Untitled deck', pageId: `page-${documentId}` });
    validateEditableDocument(document);
    const event = this.store.transaction(() => {
      this.store.saveDocument({ document, undo: [], redo: [] });
      const event = this.changeEvent(document, commandId, document.kind === 'doc' ? 'Create document' : document.kind === 'web' ? 'Create website' : 'Create deck', actor(commandOptions), []);
      this.store.saveCommand(request, { commandId, documentId, revision: document.revision, changedNodeIds: [], seq: event.seq }, null);
      return event;
    });
    this.broadcast(event);
    return document;
  }

  makeCommand(documentId: string, operations: CommandEnvelope['operations'], options: CommandOptions = {}): CommandEnvelope {
    const document = this.readDocument(documentId);
    return {
      commandId: options.commandId ?? randomUUID(), projectId: this.info.projectId, documentId,
      ...actor(options), ...(options.runId ? { runId: options.runId } : {}),
      baseRevision: options.baseRevision ?? document.revision, preconditions: [], operations,
      label: options.label ?? 'Edit document',
    };
  }

  /** Import a supported source project as a new design, never overwrite a design
   * or execute archive code. Asset records and the document commit atomically. */
  async importWebSource(bytes: Uint8Array, options: { name?: string } = {}, commandOptions: CommandOptions = {}) {
    this.ensureOpen();
    let prepared: Awaited<ReturnType<typeof prepareWebSourceImport>>;
    try { prepared = await prepareWebSourceImport(bytes); }
    catch (error) { throw new RuntimeError('invalid', error instanceof Error && error.message.startsWith('Cannot import source ZIP:') ? error.message : 'Invalid OEY source project structure.'); }
    const document = structuredClone(prepared.document);
    const source = { documentId: document.documentId, revision: document.revision };
    const name = options.name ?? `${document.name.slice(0, 230)}（导入）`;
    if (typeof name !== 'string' || !name.trim() || name.length > 240) throw new RuntimeError('invalid', 'Imported design name must contain 1–240 characters.');
    const commandId = randomUUID(); document.documentId = `document-${commandId}`; document.revision = 0; document.name = name;
    const staged: Array<{ record: StoredAsset; bytes: Uint8Array }> = [];
    for (const image of prepared.images) {
      let dimensions: ReturnType<typeof imageSize>;
      try { dimensions = imageSize(image.bytes); } catch { throw new RuntimeError('invalid', 'Imported image cannot be decoded.'); }
      const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[dimensions.type ?? ''];
      if (!mime || mime !== image.asset.mimeType || dimensions.width !== image.asset.width || dimensions.height !== image.asset.height || dimensions.width * dimensions.height > 100_000_000) throw new RuntimeError('invalid', 'Imported image bytes do not match their metadata.');
      const id = `asset-${randomUUID()}`;
      const record: StoredAsset = { id, kind: 'image', name: 'Imported image', mimeType: mime, width: dimensions.width, height: dimensions.height, sizeBytes: image.bytes.length, createdAt: new Date().toISOString() };
      for (const node of Object.values(document.nodes)) if (node.props?.assetId === image.asset.id) node.props.assetId = id;
      staged.push({ record, bytes: image.bytes });
    }
    document.assets = staged.map(({ record }) => ({ id: record.id, kind: 'image' as const, mimeType: record.mimeType as ImageAsset['mimeType'], width: record.width!, height: record.height! }));
    validateEditableDocument(document);
    const written: string[] = [];
    try {
      for (const asset of staged) {
        const path = join(this.root, 'assets', `${asset.record.id}.bin`);
        const file = await open(path, 'wx'); written.push(path);
        try { await file.writeFile(asset.bytes); } finally { await file.close(); }
      }
      this.ensureOpen();
      const provenance = { source, changedModules: prepared.changedModules, warnings: prepared.warnings };
      const event = this.store.transaction(() => {
        for (const asset of staged) this.store.putRecord('assets', asset.record.id, asset.record);
        this.store.saveDocument({ document, undo: [], redo: [] });
        this.store.putRecord('source-imports', document.documentId, provenance);
        return this.changeEvent(document, commandId, 'Import source project', actor(commandOptions), Object.keys(document.nodes));
      });
      this.broadcast(event);
      return { document, ...provenance };
    } catch (error) { await Promise.all(written.map(path => unlink(path).catch(() => {}))); throw error; }
  }

  async importDocx(bytes: Uint8Array, fileName: string, commandOptions: CommandOptions = {}) {
    this.ensureOpen();
    if(typeof fileName!=='string'||!fileName.trim()||fileName.length>160||/[\\/\x00-\x1f]/.test(fileName)||!/\.docx$/i.test(fileName)||!bytes.length||bytes.length>8*1024*1024)throw new RuntimeError('invalid','Use a DOCX template up to 8 MiB with a simple filename.');
    const commandId=commandOptions.commandId ?? randomUUID();
    const request=canonicalJson({type:'document.import-docx',commandId,fileName,hash:createHash('sha256').update(bytes).digest('hex'),actor:actor(commandOptions)});
    const previous=this.retry(commandId,request);if(previous)return {document:this.readDocDocument(previous.documentId),warnings:['重复导入已复用现有文档。']};
    const documentId=`document-${commandId}`,referenceId=`reference-${randomUUID()}`;
    let prepared:ReturnType<typeof prepareDocxImport>;try{prepared=prepareDocxImport(bytes,{documentId,assetId:referenceId,fileName});}catch(error){throw new RuntimeError('invalid',error instanceof Error?error.message:'Unsupported DOCX template');}
    const document=prepared.document;if(this.store.listDocuments().some(d=>d.documentId===documentId))throw new RuntimeError('invalid','Imported document ID already exists');
    const staged:Array<{record:StoredAsset;bytes:Uint8Array}>=[{record:{id:referenceId,kind:'reference',name:fileName,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:bytes.length,createdAt:new Date().toISOString()},bytes}];
    const remap=new Map<string,string>();
    for(const image of prepared.images){const id=`asset-${randomUUID()}`;remap.set(image.asset.id,id);staged.push({record:{id,kind:'image',name:image.asset.name ?? 'Imported image',mimeType:image.asset.mimeType,width:image.asset.width,height:image.asset.height,sizeBytes:image.bytes.length,createdAt:new Date().toISOString()},bytes:image.bytes});}
    const update=(node:import('@oeydesign/document').PMNodeJSON)=>{if(node.type==='inline_image'||node.type==='floating_image'){node.attrs!.assetId=remap.get(String(node.attrs!.assetId))!;if(node.attrs?.id&&document.templateSource?.blocks[String(node.attrs.id)])document.templateSource.blocks[String(node.attrs.id)]!.attrs=structuredClone(node.attrs);}for(const n of node.content ?? [])update(n);};
    for(const section of document.sections)for(const content of [section.content,section.header,section.footer])if(content)update(content);
    document.assets=prepared.images.map(image=>({...image.asset,id:remap.get(image.asset.id)!}));
    document.content={type:'doc',content:document.sections.flatMap(s=>structuredClone(s.content.content ?? []))};document.templateSource!.fingerprint=docFingerprint(document);validateEditableDocument(document);
    const written:string[]=[];
    try{
      for(const item of staged){const path=join(this.root,'assets',`${item.record.id}.bin`);const file=await open(path,'wx');written.push(path);try{await file.writeFile(item.bytes);}finally{await file.close();}}
      this.ensureOpen();const concurrent=this.retry(commandId,request);if(concurrent){await Promise.all(written.map(path=>unlink(path)));return {document:this.readDocDocument(concurrent.documentId),warnings:['重复导入已复用现有文档。']};}
      const event=this.store.transaction(()=>{for(const item of staged)this.store.putRecord('assets',item.record.id,item.record);this.store.saveDocument({document,undo:[],redo:[]});const event=this.changeEvent(document,commandId,'Import DOCX template',actor(commandOptions),document.sections.map(s=>s.id));this.store.saveCommand(request,{commandId,documentId,revision:0,changedNodeIds:document.sections.map(s=>s.id),seq:event.seq},null);return event;});this.broadcast(event);return {document,warnings:prepared.warnings};
    }catch(error){await Promise.all(written.map(path=>unlink(path).catch(()=>{})));throw error;}
  }

  async importWebStructure(source: string, format: 'html' | 'tsx', fileName: string, commandOptions: CommandOptions = {}) {
    this.ensureOpen();
    const commandId = commandOptions.commandId ?? randomUUID();
    const request = canonicalJson({ type: 'document.import-structure', source, format, fileName, commandId, actor: actor(commandOptions) });
    const previous = this.retry(commandId, request);
    if (previous) return { document: this.readWebDocument(previous.documentId), warnings: ['重复导入请求已复用现有文档。'] };
    let document: WebDocument;
    try { document = await prepareWebStructureImport(source, format, fileName); }
    catch (error) { throw new RuntimeError('invalid', error instanceof Error ? error.message : 'Unsupported static structure.'); }
    document.documentId = `document-${commandId}`;
    this.ensureOpen();
    const concurrent = this.retry(commandId, request);
    if (concurrent) return { document: this.readWebDocument(concurrent.documentId), warnings: ['重复导入请求已复用现有文档。'] };
    if (this.store.listDocuments().some(item => item.documentId === document.documentId)) throw new RuntimeError('invalid', 'Imported document ID already exists.');
    validateEditableDocument(document);
    const event = this.store.transaction(() => {
      this.store.saveDocument({ document, undo: [], redo: [] });
      const event = this.changeEvent(document, commandId, 'Import static website structure', actor(commandOptions), Object.keys(document.nodes));
      this.store.saveCommand(request, { commandId, documentId: document.documentId, revision: 0, changedNodeIds: Object.keys(document.nodes), seq: event.seq }, null);
      return event;
    });
    this.broadcast(event);
    return { document, warnings: ['仅导入静态原生结构；源文件与React导入均未执行，原文保存在源码导出的original目录。'] };
  }

  submit(command: CommandEnvelope): CommandResult {
    this.ensureOpen();
    if (!command || typeof command !== 'object' || !command.commandId || command.projectId !== this.info.projectId) throw new RuntimeError('invalid', 'Command must identify this project and have a command ID.');
    const request = canonicalJson(command);
    const previous = this.retry(command.commandId, request);
    if (previous) return previous;
    if (command.runId && !this.agent.canWrite(command.runId, command.documentId)) {
      throw new RuntimeError('cancelled', 'No active agent run owns this command.', { runId: command.runId });
    }
    if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) throw new RuntimeError('invalid', 'baseRevision must be a non-negative integer.');
    const state = this.store.document(command.documentId);
    const base = this.store.snapshot(command.documentId, command.baseRevision);
    let next: ReturnType<typeof applyEditableCommand>;
    try {
      next = applyEditableCommand(state.document, command, base);
    } catch (error) {
      if (error && typeof error === 'object') Object.assign(error, { revision: state.document.revision });
      throw error;
    }
    return this.commit({ document: next.document, undo: [...state.undo, command.commandId], redo: [] }, state.document,
      command.commandId, request, command.label, actor(command), next.changedNodeIds);
  }

  undo(documentId: string, options: HistoryOptions = {}): CommandResult { return this.moveHistory(documentId, 'undo', options); }
  redo(documentId: string, options: HistoryOptions = {}): CommandResult { return this.moveHistory(documentId, 'redo', options); }

  private moveHistory(documentId: string, direction: 'undo' | 'redo', options: HistoryOptions): CommandResult {
    this.ensureOpen();
    const commandId = options.commandId ?? randomUUID();
    const request = canonicalJson({ type: direction, commandId, documentId, options });
    const previous = this.retry(commandId, request);
    if (previous) return previous;
    if (options.runId && !this.agent.canWrite(options.runId, documentId)) throw new RuntimeError('cancelled', 'No active agent run owns this history change.', { runId: options.runId });
    const state = this.store.document(documentId);
    this.checkHistoryBase(state.document, options);
    const stack = direction === 'undo' ? state.undo : state.redo;
    const targetId = stack.at(-1);
    if (!targetId) throw new RuntimeError('invalid', `Nothing to ${direction}.`, { documentId, revision: state.document.revision });
    const target = this.store.command(targetId)!;
    const targetRevision = direction === 'undo' ? target.beforeRevision : target.afterRevision;
    if (targetRevision === null) throw new RuntimeError('invalid', 'Document creation cannot be undone.');
    const document = restoreEditableDocument(state.document, this.store.snapshot(documentId, targetRevision));
    const next = direction === 'undo'
      ? { document, undo: state.undo.slice(0, -1), redo: [...state.redo, targetId] }
      : { document, undo: [...state.undo, targetId], redo: state.redo.slice(0, -1) };
    return this.commit(next, state.document, commandId, request, `${direction}: ${targetId}`, actor(options));
  }

  createVersion(documentId: string, name: string): DesignVersion {
    const document = this.readDocument(documentId);
    if (!name.trim()) throw new RuntimeError('invalid', 'Version name must not be empty.');
    const version: DesignVersion = { versionId: randomUUID(), documentId, revision: document.revision, name, createdAt: new Date().toISOString() };
    const event = this.store.transaction(() => {
      this.store.saveVersion(version);
      return this.store.appendEvent({ projectId: this.info.projectId, eventId: randomUUID(), type: 'version.created', documentId,
        revision: document.revision, payload: { ...version }, createdAt: version.createdAt });
    });
    this.broadcast(event);
    return version;
  }

  listVersions(documentId: string): DesignVersion[] { this.readDocument(documentId); return this.store.versions(documentId); }

  restoreVersion(versionId: string, options: HistoryOptions = {}): CommandResult {
    this.ensureOpen();
    const commandId = options.commandId ?? randomUUID();
    const request = canonicalJson({ type: 'version.restore', commandId, versionId, options });
    const previous = this.retry(commandId, request);
    if (previous) return previous;
    const version = this.store.version(versionId);
    if (options.runId && !this.agent.canWrite(options.runId, version.documentId)) throw new RuntimeError('cancelled', 'No active agent run owns this version restore.', { runId: options.runId });
    const state = this.store.document(version.documentId);
    this.checkHistoryBase(state.document, options);
    const document = restoreEditableDocument(state.document, this.store.snapshot(version.documentId, version.revision));
    return this.commit({ document, undo: [...state.undo, commandId], redo: [] }, state.document, commandId, request, `Restore ${version.name}`, actor(options));
  }

  events(afterSeq = 0): ProjectEvent[] {
    this.ensureOpen();
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new RuntimeError('invalid', 'Event cursor must be a non-negative integer.');
    return this.store.events(afterSeq);
  }

  subscribe(listener: (event: ProjectEvent) => void): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close(): void {
    if (this.closed) return;
    this.agent.close();
    this.closed = true;
    this.listeners.clear();
    try { this.store.close(); } finally { this.owner.close(); }
  }

  private commit(state: StoredDocument, before: EditableDocument, commandId: string, request: string, label: string,
    who: ReturnType<typeof actor>, changedNodeIds = [...new Set([...(before.kind === 'doc' ? before.sections.map(s => s.id) : Object.keys(before.nodes)), ...(state.document.kind === 'doc' ? state.document.sections.map(s => s.id) : Object.keys(state.document.nodes))])]): CommandResult {
    const { result, event } = this.store.transaction(() => {
      this.store.saveDocument(state);
      const event = this.changeEvent(state.document, commandId, label, who, changedNodeIds);
      const result: CommandResult = { commandId, documentId: state.document.documentId, revision: state.document.revision, changedNodeIds, seq: event.seq };
      this.store.saveCommand(request, result, before.revision);
      return { result, event };
    });
    this.broadcast(event);
    return result;
  }

  private changeEvent(document: EditableDocument, commandId: string, label: string, who: ReturnType<typeof actor>, changedNodeIds: string[]): ProjectEvent {
    return this.store.appendEvent({ projectId: this.info.projectId, eventId: randomUUID(), type: 'document.changed',
      documentId: document.documentId, revision: document.revision,
      payload: { commandId, label, ...who, changedNodeIds }, createdAt: new Date().toISOString() });
  }

  private retry(commandId: string, request: string): CommandResult | undefined {
    const existing = this.store.command(commandId);
    if (existing && existing.request !== request) throw new RuntimeError('invalid', 'This command ID was already used for a different request.', { commandId });
    return existing?.result;
  }

  private checkHistoryBase(document: EditableDocument, options: HistoryOptions): void {
    if (options.baseRevision !== undefined && options.baseRevision !== document.revision) throw new RuntimeError('conflict', 'History changed. Read the current document before restoring.', { revision: document.revision });
  }

  private broadcast(event: ProjectEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Committed events can be replayed through events(seq). */ }
    }
  }

  private ensureOpen(): void { if (this.closed) throw new RuntimeError('invalid', 'Project runtime is closed.'); }
}
