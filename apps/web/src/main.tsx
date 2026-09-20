import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeckEditor } from '@oeydesign/editor';
import type { DeckDocument, DocumentOperation } from '@oeydesign/document';
import type { DesignVersion } from '@oeydesign/runtime';
import * as api from './api.ts';
import './style.css';
import { AgentPanel } from './AgentPanel.tsx';

function App() {
  const [project, setProject] = useState<api.ProjectSnapshot | null>(null);
  const [document, setDocument] = useState<DeckDocument | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [versions, setVersions] = useState<DesignVersion[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const current = useRef<DeckDocument | null>(null);
  const sequence = useRef(0);
  const snapshotSequence = useRef(-1);
  const activeRequests = useRef(0);
  const accept = useCallback((next: DeckDocument) => {
    const previous = current.current;
    if (previous?.documentId === next.documentId && previous.revision > next.revision) return;
    current.current = next;
    setDocument(next);
  }, []);

  useEffect(() => {
    let active = true;
    let stream: EventSource | undefined;
    const refresh = async () => {
      const snapshot = await api.readProject();
      if (!active || snapshot.seq < snapshotSequence.current) return;
      snapshotSequence.current = snapshot.seq;
      setProject(snapshot);
      sequence.current = Math.max(sequence.current, snapshot.seq);
      const id = current.current?.documentId;
      const selected = snapshot.documents.find(item => item.documentId === id) ?? snapshot.documents[0];
      if (selected) accept(selected);
    };
    void refresh().then(() => {
      if (!active) return;
      stream = new EventSource(`/api/events?after=${sequence.current}`);
      stream.onopen = () => { setConnected(true); void refresh().catch(error => setNotice(String(error))); };
      stream.onerror = () => setConnected(false);
      stream.addEventListener('project', event => {
        const update = JSON.parse((event as MessageEvent).data) as { seq: number; documentId?: string; type: string };
        if (update.seq <= sequence.current) return;
        sequence.current = update.seq;
        if (update.type === 'document.changed') void refresh().catch(error => setNotice(String(error)));
      });
    }).catch(error => setNotice(`无法打开项目：${error.message}`));
    return () => { active = false; stream?.close(); };
  }, [accept]);

  const act = async (action: () => Promise<{ document: DeckDocument }>) => {
    if (activeRequests.current) throw new Error('请等待当前修改保存');
    activeRequests.current += 1; setSaving(true); setNotice('');
    try { const result = await action(); accept(result.document); }
    catch (error) {
      setNotice(error instanceof api.ApiError && error.code === 'conflict' ? '作品已更新，这次修改与新内容冲突。已重新加载，请再试一次。' : error instanceof Error ? error.message : String(error));
      if (current.current) { const fresh = await api.readDocument(current.current.documentId); accept(fresh.document); }
      throw error;
    } finally { activeRequests.current -= 1; setSaving(false); }
  };
  const apply = async (operations: DocumentOperation[], label: string, baseRevision: number) => {
    if (!project || !current.current) return;
    const documentId = current.current.documentId;
    await act(() => api.submitOperations(project.project.projectId, documentId, operations, label, baseRevision));
  };
  const history = (direction: 'undo' | 'redo') => {
    if (current.current) {
      const { documentId, revision } = current.current;
      void act(() => api.moveHistory(documentId, direction, revision)).catch(() => {});
    }
  };
  const loadVersions = async (documentId: string) => {
    const result = await api.listVersions(documentId);
    if (current.current?.documentId === documentId) setVersions(result.versions);
  };
  const download = async (format: 'pptx' | 'pdf' | 'png' = 'pptx') => {
    if (!current.current) return;
    setExporting(true); setNotice('');
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(current.current.documentId)}/export.${format}`);
      if (!response.ok) throw new Error((await response.json()).error?.message ?? '导出失败');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement('a');
      link.href = objectUrl; link.download = `deck-r${response.headers.get('X-Document-Revision') ?? current.current.revision}.${format}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };
  return <div className="workbench">
    <header className="app-header">
      <div className="brand"><span className="brand-symbol">o.</span><span>OEY<span className="brand-light">design</span></span></div>
      <span className="header-divider"/>
      <button aria-label="切换设计对话" onClick={() => setChatOpen(!chatOpen)}>对话</button>
      <div className="project-name">{project?.project.name ?? '打开项目…'}</div>
      <select aria-label="选择文档" className="document-select" value={document?.documentId ?? ''} disabled={saving} onChange={event => {
        const selected = project?.documents.find(item => item.documentId === event.target.value); if (selected) { accept(selected); setVersions(null); }
      }}>{project?.documents.map(item => <option key={item.documentId} value={item.documentId}>{item.name}</option>)}</select>
      <span className={`save-state ${connected ? 'connected' : ''}`}><i/>{saving ? '正在保存' : connected ? '已保存到项目' : '正在连接'}</span>
      <button disabled={!document || saving} onClick={() => { if (document) void loadVersions(document.documentId).catch(error => setNotice(error.message)); }}>版本</button>
      <button disabled={!document} onClick={() => { if (document) window.open(`/api/documents/${encodeURIComponent(document.documentId)}/preview.svg`, '_blank', 'noopener'); }}>预览 SVG</button>
      <select aria-label="其他导出格式" value="" disabled={!document || exporting} onChange={event => { if (event.target.value) void download(event.target.value as 'pdf' | 'png'); }}><option value="">更多导出</option><option value="pdf">PDF 全部页面</option><option value="png">PNG 首页</option></select>
      <button className="export-button" disabled={!document || saving || exporting} onClick={() => { void download(); }}>{exporting ? '正在导出…' : '导出 PPTX'} <span>↗</span></button>
    </header>
    {notice && <div role="alert" className="notice">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
    {versions && document && <section className="version-panel" aria-label="文档版本"><div><strong>保存的版本</strong><button onClick={() => setVersions(null)}>关闭</button></div>
      <button onClick={() => { const name = window.prompt('版本名称', `版本 ${document.revision}`); if (name) void api.createVersion(document.documentId, name).then(() => loadVersions(document.documentId)).catch(error => setNotice(error.message)); }}>＋ 保存当前版本</button>
      {!versions.length && <p>将值得保留的设计存为一个版本。</p>}
      {versions.map(version => <button key={version.versionId} disabled={saving} onClick={() => { void act(() => api.restoreVersion(version.versionId, document.revision)).then(() => setVersions(null)).catch(() => {}); }}>{version.name}<small>修订 {version.revision} · 恢复</small></button>)}
    </section>}
    <div className="workspace-body">{chatOpen && <AgentPanel documentId={document?.documentId} selectedIds={selectedIds} />}
    {document ? <DeckEditor document={document} onApply={apply} onUndo={() => history('undo')} onRedo={() => history('redo')} disabled={saving} onImportAsset={api.importAsset} assetUrl={api.assetUrl} onSelectionChange={setSelectedIds} /> : <div className="loading">{notice ? '项目暂不可用' : '正在打开设计工作台…'}</div>}</div>
    <footer className="app-footer"><span>DECK WORKSPACE <span className="footer-dot">·</span> 人工与 Agent 共享作品历史</span><span>{document?.pages.length ?? 0} 页 <span className="footer-dot">·</span> 修订 {document?.revision ?? 0}</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
