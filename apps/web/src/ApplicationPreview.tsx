import { useEffect, useRef, useState } from 'react';

type Preview = { url: string; documentId: string; revision: number };
export function ApplicationPreview({ documentId, revision, onClose }: { documentId: string; revision: number; onClose(): void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const [generation, setGeneration] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const request = new AbortController(); controller.current = request;
    setBuilding(true); setError('');
    void fetch(`/api/documents/${encodeURIComponent(documentId)}/application-preview`, {
      method: 'POST', signal: AbortSignal.any([request.signal, AbortSignal.timeout(125_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? '构建预览失败');
      if (!request.signal.aborted) setPreview(result);
    }).catch(error => { if (!request.signal.aborted) setError(error instanceof Error ? error.message : '构建预览失败'); })
      .finally(() => { if (!request.signal.aborted) setBuilding(false); });
    return () => { request.abort(); };
  }, [documentId, generation]);
  return <dialog ref={dialog} className="application-preview" aria-label="应用交互预览" onCancel={onClose}>
    <header><div><strong>应用交互预览</strong><p>{building ? '正在构建已保存的作品…' : preview ? `预览修订 ${preview.revision}${preview.revision !== revision ? ` · 作品已更新至修订 ${revision}` : ''}` : '构建后可操作组件和页面导航'}</p></div>
      <button disabled={building} onClick={() => setGeneration(value => value + 1)}>重新构建预览</button>
      <button onClick={() => { controller.current?.abort(); onClose(); }}>关闭应用预览</button></header>
    {error && <p role="alert">{error}</p>}
    {preview && <iframe key={preview.url} title="构建应用预览" src={preview.url} sandbox="allow-scripts" />}
  </dialog>;
}
