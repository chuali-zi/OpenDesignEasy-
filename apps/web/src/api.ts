import type { CommandEnvelope, DeckDocument, DocumentOperation } from '@oeydesign/document';
import type { DesignVersion, ProjectInfo } from '@oeydesign/runtime';

export interface ProjectSnapshot { project: ProjectInfo; documents: DeckDocument[]; seq: number }

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error?.code ?? 'failed', data.error?.message ?? '请求失败');
  return data as T;
}

export const readProject = (): Promise<ProjectSnapshot> => request('/api/project');
export const readDocument = (id: string): Promise<{ document: DeckDocument }> => request(`/api/documents/${encodeURIComponent(id)}`);
export const createDocument = (name: string): Promise<{ document: DeckDocument }> => request('/api/documents', { name, commandId: crypto.randomUUID() });
export const listVersions = (id: string): Promise<{ versions: DesignVersion[] }> => request(`/api/documents/${encodeURIComponent(id)}/versions`);
export const createVersion = (id: string, name: string): Promise<{ version: DesignVersion }> => request(`/api/documents/${encodeURIComponent(id)}/versions`, { name });
export const restoreVersion = (id: string, baseRevision: number): Promise<{ document: DeckDocument }> => request(`/api/versions/${encodeURIComponent(id)}/restore`, { baseRevision, commandId: crypto.randomUUID() });
export const moveHistory = (id: string, direction: 'undo' | 'redo', baseRevision: number): Promise<{ document: DeckDocument }> =>
  request(`/api/documents/${encodeURIComponent(id)}/${direction}`, { baseRevision, commandId: crypto.randomUUID() });

export function submitOperations(projectId: string, documentId: string, operations: DocumentOperation[], label: string, baseRevision: number): Promise<{ document: DeckDocument }> {
  const command: CommandEnvelope = { commandId: crypto.randomUUID(), projectId, documentId, actorId: 'local-user', actorKind: 'human',
    clientId: 'web', baseRevision, preconditions: [], operations, label };
  return request('/api/commands', command);
}
