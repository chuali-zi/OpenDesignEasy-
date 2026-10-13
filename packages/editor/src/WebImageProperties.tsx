import { useRef, useState } from 'react';
import type { DocumentAsset, WebDocument, WebNode, WebOperation, WebStyle } from '@oeydesign/document';
import { WebDraftField } from './WebDraftField.tsx';

export function WebImageProperties({ document, node, style, breakpoint, disabled, scopeEnabled, importAsset, commit }: {
  document: WebDocument; node: WebNode; style: WebStyle; breakpoint?: string; disabled: boolean; scopeEnabled: boolean;
  importAsset?: (file: File) => Promise<DocumentAsset>;
  commit: (operations: WebOperation[], label: string, base: number, target: string) => Promise<boolean>;
}) {
  const picker = useRef<HTMLInputElement>(null), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const assetId = typeof node.props?.assetId === 'string' ? node.props.assetId : undefined;
  const asset = Object.values(document.assets ?? {}).find(asset => asset.id === assetId);
  const blocked = disabled || uploading;
  const update = (patch: WebStyle, label: string, base: number) => commit([{ type: 'web.style.update', nodeId: node.id, breakpointId: breakpoint, style: patch }], label, base, document.documentId);
  const replace = async (file: File) => {
    if (!importAsset || blocked) return;
    setUploading(true); setError('');
    const target = document.documentId, base = document.revision, originalNodeId = node.id;
    try {
      const replacement = await importAsset(file);
      const operations: WebOperation[] = Object.values(document.assets ?? {}).some(asset => asset.id === replacement.id) ? [] : [{ type: 'asset.register', asset: replacement }];
      operations.push({ type: 'web.node.update', nodeId: originalNodeId, props: { assetId: replacement.id, src: null } });
      if (!await commit(operations, '替换网页图片', base, target)) setError('图片未替换，原图已保留；请在最新项目上重新选择图片。');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  };
  return <section className="web-editor-image-properties" aria-label="网页图片属性">
    <header><strong>图片</strong><button disabled={blocked || !importAsset} onClick={() => picker.current?.click()}>{uploading ? '正在读取…' : '替换图片'}</button></header>
    <input ref={picker} type="file" aria-label="替换网页图片文件" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void replace(file);
    }} />
    {asset && <small>原图 {asset.width} × {asset.height} px · <a href={`/api/assets/${encodeURIComponent(asset.id)}`} target="_blank" rel="noopener noreferrer">查看原图</a></small>}
    <label>图片适配<select aria-label="网页图片适配" value={String(style.objectFit ?? 'fill')} disabled={blocked || !scopeEnabled}
      onChange={event => void update({ objectFit: event.currentTarget.value }, '修改图片适配', document.revision)}>
      <option value="contain">完整显示</option><option value="cover">填满裁切</option><option value="fill">拉伸填满</option><option value="none">原始尺寸</option><option value="scale-down">仅缩小</option>
    </select></label>
    <WebDraftField label="图片裁切焦点" value={String(style.objectPosition ?? '50% 50%')} placeholder="水平% 垂直%" revision={document.revision} disabled={blocked || !scopeEnabled}
      onCommit={async (value, base) => {
        const parts = value.trim().match(/^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
        if (!parts || Number(parts[1]) > 100 || Number(parts[2]) > 100) { setError('裁切焦点请填写两个 0%–100% 百分比，例如 25% 75%。'); return false; }
        setError(''); return update({ objectPosition: `${Number(parts[1])}% ${Number(parts[2])}%` }, '修改图片裁切焦点', base);
      }} />
    <WebDraftField label="图片不透明度 %" value={Number.isFinite(Number(style.opacity ?? 1)) ? String(Number(style.opacity ?? 1) * 100) : ''} placeholder="自定义" revision={document.revision} disabled={blocked || !scopeEnabled}
      onCommit={async (value, base) => {
        const opacity = Number(value.trim());
        if (!value.trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 100) { setError('不透明度应在 0–100% 之间。'); return false; }
        setError(''); return update({ opacity: opacity / 100 }, '修改图片不透明度', base);
      }} />
    <small>填满裁切需要固定框尺寸，原图完整保留。替换原图更新所有视口；适配、焦点与不透明度使用当前样式范围。</small>
    {error && <p role="status">{error}</p>}
  </section>;
}
