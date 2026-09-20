import type { CommandEnvelope, DeckDocument } from '@oeydesign/document';

export interface ProjectInfo {
  schemaVersion: 1;
  projectId: string;
  name: string;
  createdAt: string;
}

export interface CommandResult {
  commandId: string;
  documentId: string;
  revision: number;
  changedNodeIds: string[];
  seq: number;
}

export interface ProjectEvent {
  projectId: string;
  seq: number;
  eventId: string;
  type: 'project.created' | 'document.changed' | 'version.created';
  documentId?: string;
  revision?: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Actor {
  actorId?: string;
  actorKind?: CommandEnvelope['actorKind'];
  clientId?: string;
}

export interface CommandOptions extends Actor {
  commandId?: string;
  label?: string;
  baseRevision?: number;
  runId?: string;
}

export interface HistoryOptions extends CommandOptions {}

export interface StoredDocument {
  document: DeckDocument;
  undo: string[];
  redo: string[];
}

export interface StoredCommand {
  request: string;
  result: CommandResult;
  beforeRevision: number | null;
  afterRevision: number;
}

export interface DesignVersion {
  versionId: string;
  documentId: string;
  revision: number;
  name: string;
  createdAt: string;
}
