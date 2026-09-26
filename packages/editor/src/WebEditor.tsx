import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DocumentAsset, WebBreakpoint, WebDocument, WebLayout, WebNode, WebOperation, WebSourceModule } from '@oeydesign/document';
import { escapeWebText, renderWebMarkup, renderWebStyles, webVoidTags } from '@oeydesign/media/web-markup';
import { WebDraftField } from './WebDraftField.tsx';
import './web-editor.css';

type Props = {
  document: WebDocument;
  onApply: (operations: WebOperation[], label: string, baseRevision: number) => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onImportAsset?: (file: File) => Promise<DocumentAsset>;
  disabled?: boolean;
  onSelectionChange?: (ids: string[]) => void;
};
const BREAKPOINTS: WebBreakpoint[] = [{ id: 'mobile', maxWidth: 767 }, { id: 'tablet', minWidth: 768, maxWidth: 1199 }];
const containers = new Set(['main', 'section', 'div', 'article', 'aside', 'header', 'footer', 'nav', 'form', 'figure', 'fieldset']);
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const labelFor = (node: WebNode) => String(node.props?.['aria-label'] ?? node.props?.title ?? node.text ?? node.tag).slice(0, 42) || node.tag;
const cssValue = (value: string) => !value.trim() ? null : /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value.trim();
function locked(doc: WebDocument, id: string): boolean {
  const node = doc.nodes[id];
  return Boolean(node && (node.locked || (node.parentId && locked(doc, node.parentId))));
}
function contains(doc: WebDocument, ancestor: string, id: string): boolean {
  for (let node = doc.nodes[id]; node; node = doc.nodes[node.parentId ?? '']!) if (node.id === ancestor) return true;
  return false;
}
function projection(node: WebNode, breakpoint?: string) {
  const override = breakpoint ? node.responsive?.[breakpoint] : undefined;
  return { style: { ...node.style, ...override?.style }, layout: { ...node.layout, ...override?.layout } };
}

export function WebEditor({ document, onApply, onUndo, onRedo, onImportAsset, disabled = false, onSelectionChange }: Props) {
  const [pageId, setPageId] = useState(document.pages[0]?.id ?? '');
  const [selection, setSelection] = useState('');
  const [width, setWidth] = useState(1200);
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [frameEpoch, setFrameEpoch] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [previewDocument, setPreviewDocument] = useState(document);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [modulePath, setModulePath] = useState('styles/custom.css');
  const [moduleLanguage, setModuleLanguage] = useState<'ts' | 'tsx' | 'css'>('css');
  const sourceRevision = useRef(document.revision);
  const sourceChanged = useRef(false);
  const pending = useRef(false);
  const imagePicker = useRef<HTMLInputElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const page = document.pages.find(item => item.id === pageId) ?? document.pages[0];
  const node = document.nodes[selection];
  const matching = document.breakpoints?.filter(item => (item.minWidth === undefined || width >= item.minWidth) && (item.maxWidth === undefined || width <= item.maxWidth)).at(-1);
  const breakpoint = matching?.id ?? (width < 768 ? 'mobile' : width < 1200 ? 'tablet' : undefined);
  const overrideEnabled = !breakpoint || Boolean(document.breakpoints?.some(item => item.id === breakpoint));
  const selectedSource = document.sourceModules?.find(item => item.id === sourceId);
  const blocked = busy || disabled;
  const act = useCallback(async (operations: WebOperation[], label: string, base = document.revision) => {
    if (pending.current || disabled) return false;
    pending.current = true; setBusy(true);
    try { await onApply(operations, label, base); setEditorError(''); return true; }
    catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); return false; }
    finally { pending.current = false; setBusy(false); }
  }, [disabled, document.revision, onApply]);
  const live = useRef({ act, selection, blocked, breakpoint, overrideEnabled });
  live.current = { act, selection, blocked, breakpoint, overrideEnabled };
  useEffect(() => { if (!dragging) setPreviewDocument(document); }, [document, dragging]);
  useEffect(() => {
    if (!document.pages.some(item => item.id === pageId)) setPageId(document.pages[0]?.id ?? '');
    if (selection && (!document.nodes[selection] || (page && !contains(document, page.rootId, selection)))) setSelection('');
  }, [document, pageId, selection, page]);
  useEffect(() => { onSelectionChange?.(selection && node ? [selection] : []); }, [selection, Boolean(node), onSelectionChange]);
  useEffect(() => {
    if (!sourceDirty) { setSourceDraft(selectedSource?.source ?? ''); sourceRevision.current = document.revision; }
  }, [selectedSource?.source, sourceId, sourceDirty, document.revision]);
  const flatNodes = useMemo(() => {
    const result: Array<{ node: WebNode; depth: number }> = [];
    const visit = (id: string, depth: number) => { const item = document.nodes[id]; if (!item) return; result.push({ node: item, depth }); item.children.forEach(child => visit(child, depth + 1)); };
    if (page) visit(page.rootId, 0);
    return result;
  }, [document, page]);
  const previewPage = previewDocument.pages.find(item => item.id === page?.id) ?? previewDocument.pages[0];
  const sourceDoc = useMemo(() => {
    if (!previewPage) return '';
    try {
      const imageUrls = Object.fromEntries(Object.values(previewDocument.assets ?? {}).map(asset => [asset.id, `/api/assets/${encodeURIComponent(asset.id)}`]));
      const markup = renderWebMarkup(previewDocument, previewPage.id, imageUrls, { editing: true });
      return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${renderWebStyles(previewDocument)}</style><style>html,body{min-height:100%;font-family:Georgia,serif}[data-page-root]{min-height:420px}[data-web-id]{cursor:pointer}[data-selected=true]{outline:2px solid #398568;outline-offset:2px}[data-oey-resize-handle]{position:fixed;width:12px;height:12px;background:#398568;border:2px solid white;z-index:2147483647;cursor:nwse-resize;padding:0}a{color:#39745e}button,input{font:inherit}</style></head><body>${markup}</body></html>`;
    } catch (error) {
      return `<!doctype html><html><body><p role="alert">无法显示预览：${escapeWebText(error instanceof Error ? error.message : String(error))}</p></body></html>`;
    }
  }, [previewDocument, previewPage]);

  // Keep one snapshot for the entire pointer gesture; commit once on release.
  useEffect(() => {
    const frame = iframe.current, dom = frame?.contentDocument, body = dom?.body;
    if (!frame || !dom || !body || !previewPage) return;
    type Gesture = { id: string; target: HTMLElement; pointerId: number; x: number; y: number; moved: boolean; resize: boolean; width: number; height: number; left: number; top: number; breakpoint?: string; originalStyle: string | null };
    let gesture: Gesture | undefined;
    let suppressClick = false;
    const restore = (done: Gesture) => { if (done.originalStyle === null) done.target.removeAttribute('style'); else done.target.setAttribute('style', done.originalStyle); };
    const cancel = () => { if (gesture) restore(gesture); gesture = undefined; setDragging(false); };
    const click = (event: MouseEvent) => {
      if ((event.target as Element)?.closest('a,button,input,select,textarea')) event.preventDefault();
      if (suppressClick) { suppressClick = false; return; }
      const target = (event.target as Element)?.closest<HTMLElement>('[data-web-id]');
      setSelection(target?.dataset.webId ?? '');
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || live.current.blocked) return;
      const handle = (event.target as Element)?.closest<HTMLElement>('[data-oey-resize-handle]');
      const target = handle ? dom.querySelector<HTMLElement>(`[data-web-id="${CSS.escape(handle.dataset.nodeId!)}"]`) : (event.target as Element)?.closest<HTMLElement>('[data-web-id]');
      const id = target?.dataset.webId, current = id ? previewDocument.nodes[id] : undefined;
      if (!target || !id || !current || id === previewPage.rootId || locked(previewDocument, id)) return;
      const projected = projection(current, live.current.breakpoint);
      if ((handle || projected.layout.mode === 'position') && !live.current.overrideEnabled) return;
      const bounds = target.getBoundingClientRect();
      gesture = { id, target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, resize: Boolean(handle), width: bounds.width, height: bounds.height, left: target.offsetLeft, top: target.offsetTop, breakpoint: live.current.breakpoint, originalStyle: target.getAttribute('style') };
      target.setPointerCapture(event.pointerId);
      setDragging(true); setSelection(id); event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!gesture) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) < 5 && !gesture.moved) return;
      gesture.moved = true;
      gesture.target.style.opacity = '.7';
      if (gesture.resize) { gesture.target.style.width = `${Math.max(16, gesture.width + dx)}px`; gesture.target.style.height = `${Math.max(16, gesture.height + dy)}px`; }
      else if (projection(previewDocument.nodes[gesture.id]!, gesture.breakpoint).layout.mode === 'position') {
        gesture.target.style.left = `${gesture.left + dx}px`; gesture.target.style.top = `${gesture.top + dy}px`;
      }
      event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      const done = gesture; if (!done) return;
      gesture = undefined; restore(done); setDragging(false);
      if (done.target.hasPointerCapture(done.pointerId)) done.target.releasePointerCapture(done.pointerId);
      if (!done.moved) return;
      suppressClick = true;
      const current = previewDocument.nodes[done.id]!;
      const dx = event.clientX - done.x, dy = event.clientY - done.y;
      const submit = (operations: WebOperation[], label: string) => void live.current.act(operations, label, previewDocument.revision);
      if (done.resize) submit([{ type: 'web.style.update', nodeId: done.id, breakpointId: done.breakpoint, style: { width: Math.max(16, Math.round(done.width + dx)), height: Math.max(16, Math.round(done.height + dy)) } }], '调整网页元素尺寸');
      else if (projection(current, done.breakpoint).layout.mode === 'position') submit([{ type: 'web.style.update', nodeId: done.id, breakpointId: done.breakpoint, style: { left: Math.round(done.left + dx), top: Math.round(done.top + dy) } }], '移动网页元素');
      else {
        const target = dom.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-web-id]');
        const under = target?.dataset.webId ? previewDocument.nodes[target.dataset.webId] : undefined;
        if (!target || !under || contains(previewDocument, done.id, under.id)) return;
        // Drop on a sibling to reorder. Drop on a different container to reparent.
        const parentId = under.parentId === current.parentId ? current.parentId : containers.has(under.tag) ? under.id : under.parentId;
        if (!parentId || locked(previewDocument, parentId)) return;
        const siblings = previewDocument.nodes[parentId]!.children.filter(id => id !== done.id);
        let index = siblings.length;
        if (siblings.includes(under.id)) {
          const bounds = target.getBoundingClientRect();
          const layout = projection(previewDocument.nodes[parentId]!, done.breakpoint).layout;
          const horizontal = layout.mode === 'flex' && layout.flexDirection !== 'column';
          const after = horizontal ? event.clientX > bounds.x + bounds.width / 2 : event.clientY > bounds.y + bounds.height / 2;
          index = siblings.indexOf(under.id) + Number(after);
        }
        submit([{ type: 'web.node.reparent', nodeId: done.id, parentId, index }], '调整网页层级');
      }
    };
    const submit = (event: Event) => event.preventDefault();
    body.addEventListener('click', click); body.addEventListener('submit', submit);
    body.addEventListener('pointerdown', start); body.addEventListener('pointermove', move); body.addEventListener('pointerup', end); body.addEventListener('pointercancel', cancel);
    return () => {
      body.removeEventListener('click', click); body.removeEventListener('submit', submit);
      body.removeEventListener('pointerdown', start); body.removeEventListener('pointermove', move); body.removeEventListener('pointerup', end); body.removeEventListener('pointercancel', cancel);
      if (gesture) restore(gesture);
    };
  }, [sourceDoc, frameEpoch, previewDocument, previewPage]);
  useEffect(() => {
    const dom = iframe.current?.contentDocument, win = iframe.current?.contentWindow;
    if (!dom || !win) return;
    const elements = dom.querySelectorAll<HTMLElement>('[data-web-id]');
    elements.forEach(item => { if (item.dataset.webId === selection) item.dataset.selected = 'true'; else delete item.dataset.selected; });
    const target = Array.from(elements).find(item => item.dataset.webId === selection);
    if (!target || !node || !page || node.id === page.rootId || locked(document, node.id) || !overrideEnabled || blocked) return;
    const handle = dom.createElement('button'); handle.dataset.oeyResizeHandle = ''; handle.dataset.nodeId = node.id; handle.setAttribute('aria-label', '调整元素尺寸');
    const position = () => { const rect = target.getBoundingClientRect(); handle.style.left = `${rect.right - 6}px`; handle.style.top = `${rect.bottom - 6}px`; };
    dom.body.append(handle); position();
    win.addEventListener('scroll', position); win.addEventListener('resize', position);
    const observer = new ResizeObserver(position); observer.observe(target);
    return () => { handle.remove(); observer.disconnect(); win.removeEventListener('scroll', position); win.removeEventListener('resize', position); };
  }, [selection, sourceDoc, frameEpoch, node, page, document, overrideEnabled, blocked]);

  if (!page) return <main className="web-editor"><div className="web-editor-empty">正在载入 Web 页面…</div></main>;
  const insertionParent = () => node && containers.has(node.tag) && !node.component ? node : document.nodes[node?.parentId ?? page.rootId]!;
  const addNode = (tag: string, text?: string) => {
    const parent = insertionParent(); if (!parent) return;
    const id = uid(tag);
    const added: WebNode = { id, parentId: parent.id, tag, children: [], style: tag === 'section' ? { minHeight: 96, padding: 16 } : {}, layout: { mode: 'flow' }, ...(text ? { text } : {}), props: tag === 'a' ? { href: '#' } : {} };
    void act([{ type: 'web.node.insert', node: added }], `添加${text || tag}`).then(ok => { if (ok) setSelection(id); });
  };
  const addPage = () => {
    const id = uid('page'), rootId = uid('root');
    let number = document.pages.length + 1;
    while (document.pages.some(item => item.route === `/page-${number}`)) number++;
    void act([{ type: 'web.page.insert', page: { id, name: `页面 ${number}`, route: `/page-${number}`, rootId }, root: { id: rootId, parentId: null, tag: 'main', children: [], style: { minHeight: '100vh', padding: 48, color: '#28382f' }, layout: { mode: 'flow' } } }], '新建页面').then(ok => { if (ok) { setPageId(id); setSelection(''); } });
  };
  const importImage = async (file: File) => {
    if (!onImportAsset || blocked) return;
    const parent = insertionParent(); if (!parent) return;
    const asset = await onImportAsset(file), id = uid('image');
    const operations: WebOperation[] = Object.values(document.assets ?? {}).some(item => item.id === asset.id) ? [] : [{ type: 'asset.register', asset }];
    operations.push({ type: 'web.node.insert', node: { id, parentId: parent.id, tag: 'img', children: [], style: { maxWidth: '100%', height: 'auto' }, layout: { mode: 'flow' }, props: { assetId: asset.id, alt: asset.name ?? '网页图片' } } });
    if (await act(operations, '插入网页图片')) setSelection(id);
  };
  const enableOverride = () => {
    const preset = BREAKPOINTS.find(item => item.id === breakpoint);
    if (preset) void act([{ type: 'web.breakpoints.update', breakpoints: [...(document.breakpoints ?? []), preset] }], `启用${breakpoint}样式覆盖`);
  };
  const selectSource = (id: string) => { setSourceId(id); setSourceDraft(document.sourceModules?.find(item => item.id === id)?.source ?? ''); setSourceDirty(false); sourceChanged.current = false; sourceRevision.current = document.revision; };
  const saveSource = () => {
    if (selectedSource) void act([{ type: 'source.update', module: { ...selectedSource, source: sourceDraft } }], '更新受管源码', sourceRevision.current).then(ok => { if (ok) { sourceChanged.current = false; setSourceDirty(false); } });
  };
  const createSource = () => {
    const path = modulePath.trim(); if (!path) return;
    const module: WebSourceModule = { id: uid('source'), path, language: moduleLanguage, source: moduleLanguage === 'css' ? '/* 页面样式 */\n' : moduleLanguage === 'tsx' ? 'export function Component() {\n  return <div>新组件</div>;\n}\n' : 'export const pageTitle = "New page";\n', ...(moduleLanguage === 'tsx' ? { exports: ['Component'] } : {}) };
    void act([{ type: 'source.update', module }], '创建受管源码').then(ok => { if (ok) { setSourceId(module.id); setSourceDraft(module.source); sourceChanged.current = false; setSourceDirty(false); } });
  };
  const duplicateNode = (source: WebNode) => {
    if (!source.parentId) return;
    const operations: WebOperation[] = [];
    const copyTree = (original: WebNode, parentId: string): string => {
      const id = uid(original.tag); operations.push({ type: 'web.node.insert', node: { ...original, id, parentId, children: [] } });
      original.children.forEach(child => copyTree(document.nodes[child]!, id)); return id;
    };
    const id = copyTree(source, source.parentId);
    void act(operations, '复制元素').then(ok => { if (ok) setSelection(id); });
  };
  const editable = node && !locked(document, node.id) && !blocked;
  const projected = node ? projection(node, breakpoint) : undefined;
  const field = (label: string, value: string, commit: (value: string, base: number) => Promise<boolean>, options: { multiline?: boolean; disabled?: boolean; placeholder?: string; type?: 'text' | 'color' } = {}) =>
    <WebDraftField key={`${page.id}/${node?.id ?? 'page'}/${breakpoint}/${label}`} label={label} value={value} revision={document.revision} onCommit={commit} disabled={blocked || Boolean(node && !editable)} {...options} />;
  const styleField = (label: string, key: string, fallback = '', type: 'text' | 'color' = 'text') => field(label, String(projected?.style[key] ?? fallback), (value, base) => {
    const parsed = cssValue(value);
    return act([{ type: 'web.style.update', nodeId: node!.id, breakpointId: breakpoint, style: { [key]: key === 'rotate' && typeof parsed === 'number' ? `${parsed}deg` : parsed } }], `修改${label}`, base);
  }, { disabled: !editable || !overrideEnabled, type });
  const moveLayer = (direction: number) => {
    if (!node?.parentId) return;
    const siblings = document.nodes[node.parentId]!.children;
    const index = Math.max(0, Math.min(siblings.length - 1, siblings.indexOf(node.id) + direction));
    void act([{ type: 'web.node.reparent', nodeId: node.id, parentId: node.parentId, index }], '调整图层顺序');
  };
  return <main className="web-editor" aria-label="Web 编辑器">
    <aside className="web-editor-side web-editor-structure">
      <div className="web-editor-heading"><div><span>DOCUMENT</span><strong>页面与图层</strong></div><button onClick={addPage} disabled={blocked}>＋ 页面</button></div>
      <div className="web-editor-pages">{document.pages.map((item, i) => <button key={item.id} className={item.id === page.id ? 'is-active' : ''} disabled={blocked || dragging} onClick={() => { setPageId(item.id); setSelection(''); }}><i>{String(i + 1).padStart(2, '0')}</i><span>{item.name}</span><small>{item.route}</small></button>)}</div>
      <div className="web-editor-heading web-editor-layer-heading"><div><span>STRUCTURE</span><strong>页面图层</strong></div><span>{flatNodes.length}</span></div>
      <div className="web-editor-tree">{flatNodes.map(({ node: item, depth }) => <div key={item.id} className={`web-editor-tree-row ${selection === item.id ? 'is-selected' : ''}`} style={{ '--depth': depth } as CSSProperties}>
        <button className="web-editor-tree-select" disabled={blocked} onClick={() => setSelection(item.id)}><i>{item.tag.slice(0, 1).toUpperCase()}</i><span>{labelFor(item)}</span></button>
        <button aria-label={`${item.hidden ? '显示' : '隐藏'} ${labelFor(item)}`} onClick={() => void act([{ type: 'web.node.update', nodeId: item.id, flags: { hidden: !item.hidden } }], '切换显示')} disabled={blocked || locked(document, item.id)}>{item.hidden ? '◌' : '◉'}</button>
        <button aria-label={`${item.locked ? '解锁' : '锁定'} ${labelFor(item)}`} onClick={() => void act([{ type: 'web.node.update', nodeId: item.id, flags: { locked: !item.locked } }], '切换锁定')} disabled={blocked || Boolean(item.parentId && locked(document, item.parentId))}>{item.locked ? '▣' : '▢'}</button>
      </div>)}</div>
      <fieldset className="web-editor-add" disabled={blocked}><legend>添加元素</legend><div><button onClick={() => addNode('section')}>区段</button><button onClick={() => addNode('h2', '新标题')}>标题</button><button onClick={() => addNode('p', '在这里写下内容。')}>段落</button><button onClick={() => addNode('a', '了解更多')}>链接</button><button onClick={() => addNode('input')}>输入框</button><button onClick={() => imagePicker.current?.click()} disabled={!onImportAsset}>图片</button></div><input ref={imagePicker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importImage(file).catch(error => setEditorError(String(error))); }} /></fieldset>
    </aside>
    <section className="web-editor-stage">
      <div className="web-editor-toolbar"><div><span className="web-editor-live-dot"/>网页预览 <small>· 修订 {document.revision}</small></div><div className="web-editor-stage-controls"><label>视口 <input aria-label="预览宽度" type="range" min="320" max="1440" value={width} disabled={dragging} onChange={event => setWidth(Number(event.currentTarget.value))}/><strong>{width}px</strong></label><button aria-label="撤销" onClick={onUndo} disabled={blocked}>↶</button><button aria-label="重做" onClick={onRedo} disabled={blocked}>↷</button></div></div>
      <div className="web-editor-browser"><div className="web-editor-browser-bar"><i/><i/><i/><span>{page.route}</span><small>{breakpoint ?? '基础'}</small></div><div className="web-editor-viewport" style={{ '--preview-width': `${width}px` } as CSSProperties}><iframe ref={iframe} title="隔离网页预览" sandbox="allow-same-origin" srcDoc={sourceDoc} onLoad={() => setFrameEpoch(epoch => epoch + 1)} /></div></div>
      <div className="web-editor-stage-foot"><span><b>提示</b> 拖动重排 · 右下角缩放 · 定位元素自由移动</span><button onClick={() => setSourceOpen(!sourceOpen)}>{sourceOpen ? '关闭源码' : '源码模块'}</button></div>
      {editorError && <div className="web-editor-error" role="status">{editorError}</div>}
      {sourceOpen && <section className="web-editor-source"><header><strong>源码模块</strong><select aria-label="选择源码模块" value={sourceId} disabled={blocked || sourceDirty} onChange={event => selectSource(event.currentTarget.value)}><option value="">选择已有模块…</option>{document.sourceModules?.map(item => <option key={item.id} value={item.id}>{item.path}</option>)}</select><button disabled={!selectedSource || blocked || !sourceDirty} onClick={saveSource}>保存模块</button>{sourceDirty && <button disabled={blocked} onClick={() => selectSource(sourceId)}>恢复已保存源码</button>}</header>
        <div className="web-editor-new-source"><input aria-label="新模块路径" value={modulePath} onChange={event => setModulePath(event.currentTarget.value)} placeholder="styles/custom.css"/><select aria-label="新模块语言" value={moduleLanguage} onChange={event => setModuleLanguage(event.currentTarget.value as 'ts' | 'tsx' | 'css')}><option value="css">CSS</option><option value="tsx">TSX</option><option value="ts">TS</option></select><button onClick={createSource} disabled={blocked || sourceDirty || !modulePath.trim()}>新建模块</button></div>
        {selectedSource ? <textarea aria-label="源码模块内容" disabled={blocked} value={sourceDraft} onChange={event => { if (!sourceChanged.current) sourceRevision.current = document.revision; sourceChanged.current = true; setSourceDraft(event.currentTarget.value); setSourceDirty(true); }} spellCheck={false} /> : <p>添加 TS、TSX 或 CSS；模块路径相对于源码包的 src 目录。</p>}</section>}
    </section>
    <aside className="web-editor-side web-editor-inspector"><div className="web-editor-heading"><div><span>INSPECTOR</span><strong>{node ? labelFor(node) : '页面属性'}</strong></div></div>
      <div className="web-editor-fields">{!node ? <>
        {field('页面名称', page.name, (name, base) => act([{ type: 'web.page.update', pageId: page.id, page: { name } }], '修改页面名称', base))}
        {field('页面路由', page.route, (route, base) => act([{ type: 'web.page.update', pageId: page.id, page: { route } }], '修改页面路由', base))}
        <div className="web-editor-inspector-empty">从图层或预览中选择元素。</div>
      </> : <>
        <label>元素标签<input value={node.tag} aria-label="元素标签" readOnly /></label>
        {!overrideEnabled && <button className="web-editor-override" onClick={enableOverride} disabled={blocked}>为 {breakpoint} 创建样式覆盖</button>}
        {!webVoidTags.has(node.tag) && !node.component && field('元素文案', node.text ?? '', (text, base) => act([{ type: 'web.node.update', nodeId: node.id, text }], '修改网页文案', base), { multiline: true })}
        <label>布局<select aria-label="布局模式" value={projected!.layout.mode} onChange={event => void act([{ type: 'web.layout.update', nodeId: node.id, breakpointId: breakpoint, layout: { mode: event.currentTarget.value as WebLayout['mode'] } }], '修改布局')} disabled={!editable || !overrideEnabled}><option value="flow">流式</option><option value="flex">Flex</option><option value="grid">Grid</option><option value="position">定位</option></select></label>
        <div className="web-editor-field-grid">{styleField('样式宽度', 'width')}{styleField('样式高度', 'height')}{styleField('内边距', 'padding')}{styleField('元素间距', 'gap')}{styleField('旋转角度', 'rotate', '0deg')}</div>
        {projected!.layout.mode === 'position' && <div className="web-editor-field-grid">{styleField('定位左侧', 'left', '0')}{styleField('定位顶部', 'top', '0')}</div>}
        <div className="web-editor-field-grid">{styleField('背景色', 'backgroundColor', '#ffffff', 'color')}{styleField('文字颜色', 'color', '#28382f', 'color')}</div>
        {node.tag === 'a' && field('链接地址', String(node.props?.href ?? ''), (href, base) => act([{ type: 'web.node.update', nodeId: node.id, props: { href } }], '修改链接', base))}
        {node.tag === 'input' && field('输入提示', String(node.props?.placeholder ?? ''), (placeholder, base) => act([{ type: 'web.node.update', nodeId: node.id, props: { placeholder } }], '修改输入提示', base))}
        {node.tag === 'img' && field('图片说明', String(node.props?.alt ?? ''), (alt, base) => act([{ type: 'web.node.update', nodeId: node.id, props: { alt } }], '修改图片说明', base))}
        {containers.has(node.tag) && <label>绑定组件<select aria-label="绑定组件" value={node.component?.moduleId ?? ''} disabled={!editable} onChange={event => {
          const module = document.sourceModules?.find(item => item.id === event.currentTarget.value);
          void act([{ type: 'web.node.update', nodeId: node.id, component: module ? { moduleId: module.id, exportName: module.exports?.[0] ?? 'default' } : null }], '绑定网页组件');
        }}><option value="">原生容器</option>{document.sourceModules?.filter(item => item.language === 'tsx').map(item => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>}
        {node.component && <>
          {field('组件导出名称', node.component.exportName, (exportName, base) => act([{ type: 'web.node.update', nodeId: node.id, component: { ...node.component!, exportName } }], '修改组件导出', base))}
          {field('组件属性 JSON', JSON.stringify(node.props ?? {}, null, 2), async (value, base) => {
            try {
              const props: unknown = JSON.parse(value);
              if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('组件属性必须是 JSON 对象');
              const removed = Object.fromEntries(Object.keys(node.props ?? {}).filter(key => !Object.hasOwn(props, key)).map(key => [key, null]));
              return act([{ type: 'web.node.update', nodeId: node.id, props: { ...removed, ...props } }], '修改组件属性', base);
            } catch (error) { setEditorError(error instanceof Error ? error.message : String(error)); return false; }
          }, { multiline: true })}
          <small className="web-editor-breakpoint-note">预览显示组件边界；在“构建应用 ZIP”中运行组件交互。</small>
        </>}
        {node.parentId && <label>父级容器<select aria-label="父级容器" value={node.parentId} disabled={!editable} onChange={event => void act([{ type: 'web.node.reparent', nodeId: node.id, parentId: event.currentTarget.value }], '移动到容器')}>{flatNodes.filter(item => containers.has(item.node.tag) && !item.node.component && !contains(document, node.id, item.node.id)).map(item => <option key={item.node.id} value={item.node.id}>{labelFor(item.node)}</option>)}</select></label>}
        <div className="web-editor-node-actions"><button onClick={() => moveLayer(-1)} disabled={!editable || !node.parentId}>上移</button><button onClick={() => moveLayer(1)} disabled={!editable || !node.parentId}>下移</button></div>
        <div className="web-editor-node-actions"><button onClick={() => duplicateNode(node)} disabled={!editable || !node.parentId}>复制</button><button className="is-danger" onClick={() => void act([{ type: 'web.node.remove', nodeId: node.id }], '删除元素').then(ok => { if (ok) setSelection(''); })} disabled={!editable || !node.parentId}>删除</button></div>
        <small className="web-editor-breakpoint-note">{breakpoint ? `${breakpoint} · ${overrideEnabled ? '保存到此断点' : '继承基础样式'}` : '基础样式'} · {width}px</small>
      </>}</div>
    </aside>
  </main>;
}

export default WebEditor;
