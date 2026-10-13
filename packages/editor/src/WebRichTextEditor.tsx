import { useRef, useState } from 'react';
import { textFromString, textToString, textSchema, validateTextContent } from '@oeydesign/document';
import type { PMNodeJSON, WebDocument, WebNode, WebOperation } from '@oeydesign/document';
import { RichTextEditor } from './RichTextEditor.tsx';

function same(a: PMNodeJSON, b: PMNodeJSON) { return JSON.stringify(textSchema.nodeFromJSON(a).toJSON()) === JSON.stringify(textSchema.nodeFromJSON(b).toJSON()); }
export function WebRichTextEditor({ document, node, disabled, commit }: {
  document: WebDocument; node: WebNode; disabled: boolean;
  commit: (operations: WebOperation[], label: string, base: number, target: string) => Promise<boolean>;
}) {
  const content = node.content ?? textFromString(node.text ?? '');
  const key = `oey:web-text-draft:${document.documentId}:${node.id}`;
  const [storageError, setStorageError] = useState(false);
  const read = (): PMNodeJSON | null => {
    try {
      const raw = localStorage.getItem(key); if (!raw) return null;
      const draft: PMNodeJSON = JSON.parse(raw); validateTextContent(draft);
      if (same(draft, content)) { localStorage.removeItem(key); return null; }
      return draft;
    } catch { return null; }
  };
  const [recovery, setRecovery] = useState<PMNodeJSON | null>(read);
  const lastDraft = useRef<PMNodeJSON | null>(null);
  const clear = () => { try { localStorage.removeItem(key); } catch {} setRecovery(null); lastDraft.current = null; };
  const remember = (draft: PMNodeJSON) => {
    lastDraft.current = draft;
    try { localStorage.setItem(key, JSON.stringify(draft)); setStorageError(false); } catch { setStorageError(true); }
  };
  return <section className="web-editor-rich-panel" aria-label="网页富文本编辑">
    {storageError && <p role="status">浏览器草稿存储不可用，请先复制当前文案。</p>}
    {recovery && <div className="web-editor-rich-recovery" role="status"><strong>有未保存的文字草稿</strong><p>最新项目内容已保留；恢复会替换此元素文字。</p>
      <pre aria-label="未保存文字草稿">{textToString(recovery)}</pre>
      <button disabled={disabled} onClick={() => {
        if (same(recovery, content)) { clear(); return; }
        void commit([{ type: 'web.node.update', nodeId: node.id, content: recovery }], '恢复未保存富文本', document.revision, document.documentId).then(ok => { if (ok) clear(); });
      }}>恢复文字草稿</button><button disabled={disabled} onClick={clear}>丢弃文字草稿</button>
    </div>}
    <RichTextEditor documentId={document.documentId} nodeId={node.id} content={content} revision={document.revision}
      disabled={disabled || Boolean(recovery)} focused baseStyle={{ fontFamily: String(node.style.fontFamily ?? 'Georgia'), fontSize: typeof node.style.fontSize === 'number' ? node.style.fontSize : 20, color: String(node.style.color ?? '#244b3a') }}
      onDraftChange={remember}
      onCommit={async (id, nodeId, steps, label, base) => {
        const ok = await commit([{ type: 'text.apply', nodeId, steps }], label, base, id);
        if (ok) clear(); return ok;
      }}
      onConflict={draft => { if (draft) remember(draft); setRecovery(draft ?? lastDraft.current); }} />
  </section>;
}
