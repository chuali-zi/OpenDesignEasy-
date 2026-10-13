import {DocPageFrames,type DocPaginationOptions} from './DocPageFrames.tsx';
import {createDocFieldView} from './doc-page-layout.ts';
import { createDocFloatingView } from './DocFloatingView.ts';
import { baseKeymap, setBlockType } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { wrapInList, splitListItem, liftListItem } from 'prosemirror-schema-list';
import type { Schema } from 'prosemirror-model';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PMNodeJSON, ImageAsset } from '@oeydesign/document';
import { EditorState, NodeSelection, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { editorTextSchema } from './editor-text-schema.ts';

export type RichTextEditorProps = {
  schema?: Schema;
  docPagination?: DocPaginationOptions;
  assetUrl?: (id:string)=>string;
  onImportImage?: (file: File) => Promise<ImageAsset>;
  documentId: string;
  nodeId: string;
  content: PMNodeJSON;
  revision: number;
  disabled: boolean;
  focused?: boolean;
  baseStyle?: { fontFamily?: string; fontSize?: number; color?: string; lineHeight?: number };
  onCommit: (documentId: string, nodeId: string, steps: unknown[], label: string, baseRevision: number, assets?: ImageAsset[]) => Promise<boolean>;
  onConflict: (draft?: PMNodeJSON) => void;
  onDraftChange?: (draft: PMNodeJSON) => void;
};

const FONT_CHOICES = ['Noto Sans CJK SC', 'Segoe UI', 'Arial', 'Georgia', 'Aptos', 'Microsoft YaHei', 'Noto Sans'];
type PendingFocusRestore = { view: EditorView; selection: Selection; moved: boolean; cleanup: () => void };

export function RichTextEditor({ schema: requestedSchema = editorTextSchema, docPagination, assetUrl, onImportImage, documentId, nodeId, content, revision, disabled, focused = false, baseStyle, onCommit, onConflict, onDraftChange }: RichTextEditorProps) {
  const [schema,setSchema]=useState(requestedSchema);
  const selectionSnapshot=useRef<{documentId:string;nodeId:string;json:unknown;expectedDoc:string;focused:boolean}|null>(null);
  const docJson = (value: PMNodeJSON) => schema.nodeFromJSON(value);
  const docMode = !!schema.nodes.table;
  const plugins = () => docMode ? [keymap({'Enter':splitListItem(schema.nodes.list_item!),'Mod-[':liftListItem(schema.nodes.list_item!)}),keymap(baseKeymap)] : [];
  const assetsRef = useRef<ImageAsset[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const [pagination,setPagination]=useState<Record<string,boolean>>({});
  const [floatingImage,setFloatingImage]=useState(false);
  const [objectAttrs,setObjectAttrs]=useState<Record<string,any>|null>(null);
  const [importingImage, setImportingImage] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  useEffect(()=>{if(schema===requestedSchema)return;const view=viewRef.current;let frame=0;const apply=()=>{frame=requestAnimationFrame(()=>setSchema(requestedSchema));};if(view?.composing){view.dom.addEventListener('compositionend',apply,{once:true});return()=>{view.dom.removeEventListener('compositionend',apply);if(frame)cancelAnimationFrame(frame);};}setSchema(requestedSchema);},[requestedSchema,schema]);
  const stepsRef = useRef<unknown[]>([]);
  const committedDocRef = useRef(docJson(content));
  const baseRevisionRef = useRef(revision);
  const propsRef = useRef({ onCommit, onConflict, onDraftChange, disabled });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const focusRestoreRef = useRef<PendingFocusRestore | null>(null);
  const [saving, setSaving] = useState(false);
  const [fontFamily, setFontFamily] = useState(baseStyle?.fontFamily ?? 'Segoe UI');
  const [fontSize, setFontSize] = useState(String(baseStyle?.fontSize ?? 24));
  const [fontColor, setFontColor] = useState(baseStyle?.color ?? '#244b3a');
  const [lineHeight, setLineHeight] = useState(String(baseStyle?.lineHeight ?? (baseStyle?.fontSize ?? 24) * 1.2));
  const [spaceBefore, setSpaceBefore] = useState('0');
  const [spaceAfter, setSpaceAfter] = useState('0');
  const [indent, setIndent] = useState('0');
  const [firstLineIndent, setFirstLineIndent] = useState('0');
  const [align, setAlign] = useState<'left' | 'center' | 'right' | 'justify'>('left');

  propsRef.current = { onCommit, onConflict, onDraftChange, disabled };

  const flush = useCallback(async (closing = false) => {
    const view = viewRef.current;
    if (!view || view.isDestroyed || savingRef.current || !stepsRef.current.length || (propsRef.current.disabled && !closing)) return;
    if (view.composing && !closing) {
      timerRef.current = setTimeout(() => { void flush(); }, 180);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const steps = stepsRef.current.splice(0);
    const baseRevision = baseRevisionRef.current;
    const submittedDoc = view.state.doc;
    if (!closing && view.hasFocus()) {
      focusRestoreRef.current?.cleanup();
      const ownerDocument = view.dom.ownerDocument;
      const pending: PendingFocusRestore = { view, selection: view.state.selection, moved: false, cleanup: () => undefined };
      const onPointerDown = (event: PointerEvent) => {
        if (!(event.target instanceof Node) || !view.dom.contains(event.target)) pending.moved = true;
      };
      const onFocusIn = (event: FocusEvent) => {
        if (event.target instanceof Node && event.target !== ownerDocument.body && !view.dom.contains(event.target)) pending.moved = true;
      };
      ownerDocument.addEventListener('pointerdown', onPointerDown, true);
      ownerDocument.addEventListener('focusin', onFocusIn, true);
      pending.cleanup = () => {
        ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
        ownerDocument.removeEventListener('focusin', onFocusIn, true);
      };
      focusRestoreRef.current = pending;
    }
    savingRef.current = true;
    if (!closing) {
      setSaving(true);
      view.setProps({ editable: () => false });
    }
    let ok = false;
    const assets = assetsRef.current.splice(0);
    try { ok = await propsRef.current.onCommit(documentId, nodeId, steps, '编辑富文本', baseRevision, assets); }
    catch { ok = false; }
    const stillCurrent = viewRef.current === view && !view.isDestroyed;
    if (!ok && focusRestoreRef.current?.view === view) {
      focusRestoreRef.current.cleanup();
      focusRestoreRef.current = null;
    }
    if (ok && stillCurrent) {
      committedDocRef.current = submittedDoc;
      baseRevisionRef.current = baseRevision + 1;
    } else if (!ok && stillCurrent) {
      stepsRef.current = [];
      view.updateState(EditorState.create({ schema, doc: committedDocRef.current, plugins: plugins() }));
      propsRef.current.onConflict(submittedDoc.toJSON() as PMNodeJSON);
    }
    savingRef.current = false;
    if (stillCurrent) {
      setSaving(false);
    } else if (viewRef.current && !viewRef.current.isDestroyed) {
      setSaving(false);
    }
  }, [documentId, nodeId, schema]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, 520);
  }, [flush]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const doc = docJson(content);
    committedDocRef.current = doc;
    baseRevisionRef.current = revision;
    let selection:Selection|undefined;const previousSelection=selectionSnapshot.current;if(previousSelection?.documentId===documentId&&previousSelection.nodeId===nodeId){try{selection=Selection.fromJSON(doc,previousSelection.json);}catch{}}
    const state = EditorState.create({ schema, doc,selection, plugins: plugins() });
    const view = new EditorView(host, {
      state,
      ...(docMode?{nodeViews:{doc_field:createDocFieldView,floating_image:(node,view,getPos)=>createDocFloatingView(node,view,getPos,assetUrl ?? (()=>''),()=>{if(stepsRef.current.length){void flush();return false;}return !savingRef.current;}),floating_shape:(node,view,getPos)=>createDocFloatingView(node,view,getPos,assetUrl ?? (()=>''),()=>{if(stepsRef.current.length){void flush();return false;}return !savingRef.current;})}}:{}),
      editable: () => !propsRef.current.disabled && !savingRef.current,
      attributes: { class: 'editor-rich-text-surface', 'aria-label': '富文本内容' },
      handleDOMEvents: {
        keydown: () => {
          // Navigation/modifier keys may not create a ProseMirror transaction,
          // but they still mean the user has not finished editing yet.
          if (stepsRef.current.length) scheduleFlush();
          return false;
        },
      },
      dispatchTransaction(transaction) {
        let next = view.state.apply(transaction);
        if (docMode && transaction.docChanged) {
          const ids=new Set<string>(); const fix=next.tr;
          next.doc.descendants((node,pos)=>{ if (!node.type.spec.attrs?.id) return; const current=node.attrs.id; if (!current || ids.has(current)) { const id=crypto.randomUUID(); ids.add(id); fix.setNodeMarkup(pos,undefined,{...node.attrs,id}); } else ids.add(current); });
          if (fix.steps.length) { next=next.apply(fix); stepsRef.current.push(...transaction.steps.map(step=>step.toJSON())); transaction=fix; }
        }
        view.updateState(next);view.dom.dispatchEvent(new CustomEvent('doc-pagination-content',{bubbles:true}));
        syncToolbar(next);
        if (transaction.steps.length) {
          stepsRef.current.push(...transaction.steps.map(step => step.toJSON()));
          propsRef.current.onDraftChange?.(next.doc.toJSON() as PMNodeJSON);
        }
        // Selecting recently typed text is still active editing. Do not start
        // an idle save in the middle of keyboard range selection.
        if (stepsRef.current.length) scheduleFlush();
      },
    });
    viewRef.current = view;if(previousSelection?.documentId===documentId&&previousSelection.nodeId===nodeId&&previousSelection.focused)view.focus();
    if(previousSelection?.expectedDoc===JSON.stringify(doc.toJSON())&&(!previousSelection.focused||view.hasFocus()))selectionSnapshot.current=null;
    syncToolbar(view.state);
    const onBlur = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } void flush(); };
    view.dom.addEventListener('blur', onBlur, true);
    view.dom.addEventListener('compositionend', scheduleFlush);
    return () => {
      selectionSnapshot.current={documentId,nodeId,json:view.state.selection.toJSON(),expectedDoc:JSON.stringify(view.state.doc.toJSON()),focused:view.hasFocus()};
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      // Selection changes can unmount this editor before the debounce fires. Start
      // the commit while this view is still live; flush captures its steps/doc and
      // ignores its result once a replacement view is mounted.
      if (stepsRef.current.length) void flush(true);
      if (focusRestoreRef.current?.view === view) {
        focusRestoreRef.current.cleanup();
        focusRestoreRef.current = null;
      }
      view.dom.removeEventListener('blur', onBlur, true);
      view.dom.removeEventListener('compositionend', scheduleFlush);
      view.destroy();
      viewRef.current = null;
    };
    // nodeId intentionally owns an editor instance; external document changes are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, nodeId, flush, schema]);

  const editorDocumentIdRef = useRef(documentId);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const incoming = docJson(content);
    if (editorDocumentIdRef.current !== documentId) {
      if (focusRestoreRef.current) {
        focusRestoreRef.current.cleanup();
        focusRestoreRef.current = null;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      stepsRef.current = [];
      editorDocumentIdRef.current = documentId;
      committedDocRef.current = incoming;
      baseRevisionRef.current = revision;
      view.updateState(EditorState.create({ schema, doc: incoming, plugins: plugins() }));
      syncToolbar(view.state);
      return;
    }
    if (revision === baseRevisionRef.current) return;
    const incomingJson = JSON.stringify(incoming.toJSON());
    const committedJson = JSON.stringify(committedDocRef.current.toJSON());
    const localJson = JSON.stringify(view.state.doc.toJSON());
    if (incomingJson === committedJson || incomingJson === localJson) {
      committedDocRef.current = incoming;
      baseRevisionRef.current = revision;
      syncToolbar(view.state);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (focusRestoreRef.current) {
      focusRestoreRef.current.cleanup();
      focusRestoreRef.current = null;
    }
    stepsRef.current = [];
    committedDocRef.current = incoming;
    baseRevisionRef.current = revision;
    let restoredSelection:Selection|undefined;const pendingSelection=selectionSnapshot.current;
    if(pendingSelection?.documentId===documentId&&pendingSelection.nodeId===nodeId&&pendingSelection.expectedDoc===incomingJson){try{restoredSelection=Selection.fromJSON(incoming,pendingSelection.json);if(!pendingSelection.focused)selectionSnapshot.current=null;}catch{}}
    view.updateState(EditorState.create({ schema, doc: incoming, selection:restoredSelection, plugins: plugins() }));
    syncToolbar(view.state);
    propsRef.current.onConflict();
  }, [content, documentId, revision, schema]);

  useEffect(() => { if (focused) viewRef.current?.focus(); }, [focused]);

  function syncToolbar(state: EditorState) {
    const selected=(state.selection as Selection & {node?: typeof state.doc}).node;setObjectAttrs(selected && ['inline_image','floating_image','floating_shape'].includes(selected.type.name)?{...selected.attrs,kind:selected.type.name}:null);
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const style = marks.find(mark => mark.type === schema.marks.textStyle);
    const font = style?.attrs.fontFamily;
    const size = style?.attrs.fontSize;
    const color = style?.attrs.color;
    if (typeof font === 'string' && font.trim()) setFontFamily(font);
    else if (baseStyle?.fontFamily) setFontFamily(baseStyle.fontFamily);
    if (typeof size === 'number' && Number.isFinite(size)) setFontSize(String(size));
    else if (baseStyle?.fontSize) setFontSize(String(baseStyle.fontSize));
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) setFontColor(color);
    else if (baseStyle?.color) setFontColor(baseStyle.color);
    const block = state.selection.$from.parent;
    setPagination(Object.fromEntries(['pageBreakBefore','keepNext','keepLines','widowControl'].map(key=>[key,block.attrs[key]===true])));
    const currentAlign = block.attrs.align;
    if (currentAlign === 'left' || currentAlign === 'center' || currentAlign === 'right' || currentAlign === 'justify') setAlign(currentAlign);
    else setAlign('left');
    const currentLineHeight = block.attrs.lineHeight;
    if (typeof currentLineHeight === 'number') setLineHeight(String(currentLineHeight));
    else setLineHeight(String(baseStyle?.lineHeight ?? (baseStyle?.fontSize ?? 24) * 1.2));
    setSpaceBefore(typeof block.attrs.spaceBefore === 'number' ? String(block.attrs.spaceBefore) : '0');
    setSpaceAfter(typeof block.attrs.spaceAfter === 'number' ? String(block.attrs.spaceAfter) : '0');
    setIndent(typeof block.attrs.indent === 'number' ? String(block.attrs.indent) : '0');
    setFirstLineIndent(typeof block.attrs.firstLineIndent === 'number' ? String(block.attrs.firstLineIndent) : '0');
  }

  useEffect(() => {
    const view = viewRef.current;
    view?.setProps({ editable: () => !propsRef.current.disabled && !savingRef.current });
    const snapshot=selectionSnapshot.current;
    if(view&&!disabled&&!saving&&!savingRef.current&&snapshot?.focused&&snapshot.documentId===documentId&&snapshot.nodeId===nodeId&&snapshot.expectedDoc===JSON.stringify(view.state.doc.toJSON())){
      const active=view.dom.ownerDocument.activeElement;selectionSnapshot.current=null;
      if(!active||active===view.dom.ownerDocument.body||view.dom.contains(active)){try{view.dispatch(view.state.tr.setSelection(Selection.fromJSON(view.state.doc,snapshot.json)));view.focus();}catch{}}
    }
    const pending = focusRestoreRef.current;
    if (!pending || disabled || saving) return;
    pending.cleanup();
    focusRestoreRef.current = null;
    if (pending.moved || pending.view !== view || !view || view.isDestroyed) return;
    const active = view.dom.ownerDocument.activeElement;
    if (active && active !== view.dom.ownerDocument.body && !view.dom.contains(active)) return;
    if (!pending.selection.$from.doc.eq(view.state.doc)) return;
    view.focus();
    if (!view.state.selection.eq(pending.selection)) {
      view.dispatch(view.state.tr.setSelection(pending.selection));
    }
  }, [disabled, saving, revision, schema]);

  function toggleMark(name: 'strong' | 'em' | 'underline' | 'strike') {
    const view = viewRef.current;
    const mark = schema.marks[name];
    if (!view || !mark) return;
    const { from, to, empty } = view.state.selection;
    const transaction = view.state.tr;
    const active = empty
      ? (view.state.storedMarks ?? view.state.selection.$from.marks()).some(item => item.type === mark)
      : view.state.doc.rangeHasMark(from, to, mark);
    if (empty) {
      const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
      transaction.setStoredMarks(active ? marks.filter(item => item.type !== mark) : [...marks, mark.create()]);
    } else if (active) transaction.removeMark(from, to, mark);
    else transaction.addMark(from, to, mark.create());
    view.dispatch(transaction); view.focus();
  }

  function applyTextStyle(attrs: Record<string, string | number>) {
    const view = viewRef.current;
    const mark = schema.marks.textStyle;
    if (!view || !mark) return;
    const { from, to, empty } = view.state.selection;
    const transaction = view.state.tr;
    const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
    const previous = marks.find(item => item.type === mark);
    const next = mark.create({ ...previous?.attrs, ...attrs });
    if (empty) transaction.setStoredMarks([...marks.filter(item => item.type !== mark), next]);
    else transaction.removeMark(from, to, mark).addMark(from, to, next);
    view.dispatch(transaction);
  }

  function applyParagraphAttr(key: 'align' | 'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'indent' | 'firstLineIndent' | 'pageBreakBefore' | 'keepNext' | 'keepLines' | 'widowControl', value: string | number | boolean) {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection;
    const transaction = view.state.tr;
    const blocks: Array<{ pos: number; node: typeof transaction.doc }> = [];
    if (from === to) {
      const $from = view.state.doc.resolve(from);
      for (let depth = $from.depth; depth > 0; depth--) {
        const parent = $from.node(depth);
        if (parent.type.name === 'paragraph' || parent.type.name === 'heading') {
          blocks.push({ pos: $from.before(depth), node: parent as typeof transaction.doc }); break;
        }
      }
    } else {
      view.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') blocks.push({ pos, node: node as typeof transaction.doc });
      });
    }
    for (const block of blocks) transaction.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, [key]: value });
    if (blocks.length) view.dispatch(transaction);
  }

  function insertTable() {
    const view=viewRef.current;if (!view) return;
    const paragraph=()=>schema.nodes.paragraph!.create();
    const cell=()=>schema.nodes.table_cell!.create(null,paragraph());
    const row=()=>schema.nodes.table_row!.create(null,[cell(),cell(),cell()]);
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.table!.create(null,[row(),row(),row()])));view.focus();
  }
  function insertFloating(type:'floating_image'|'floating_shape',attrs:Record<string,unknown>={}){const view=viewRef.current;if(!view)return;const $from=view.state.selection.$from;let pos=$from.pos;for(let d=$from.depth;d>0;d--)if(['paragraph','heading'].includes($from.node(d).type.name)){pos=$from.start(d);break;}view.dispatch(view.state.tr.insert(pos,schema.nodes[type]!.create(attrs)));view.focus();}
  function updateObject(key:string,value:unknown){const view=viewRef.current;if(!view||!objectAttrs)return;const selected=(view.state.selection as Selection & {node?:typeof view.state.doc}).node;if(!selected||!['inline_image','floating_image','floating_shape'].includes(selected.type.name)||selected.attrs.locked&&key!=='locked')return;const pos=view.state.selection.from,tr=view.state.tr.setNodeMarkup(pos,undefined,{...selected.attrs,[key]:value});tr.setSelection(NodeSelection.create(tr.doc,pos));view.dispatch(tr);view.focus();}
  function blockType(type:string) { const view=viewRef.current;if(!view)return;setBlockType(schema.nodes[type==='p'?'paragraph':'heading']!,type==='p'?{}:{level:Number(type)})(view.state,tr=>view.dispatch(tr));view.focus(); }
  return <section className="editor-rich-text" aria-label="富文本编辑器">
    <div className="editor-rich-toolbar" role="toolbar" aria-label="文字格式">
      <select aria-label="字体" title="字体" value={fontFamily} disabled={disabled || saving} onChange={event => { const value = event.currentTarget.value; setFontFamily(value); applyTextStyle({ fontFamily: value }); }}>
        {!FONT_CHOICES.includes(fontFamily) && <option value={fontFamily}>{fontFamily}</option>}
        {FONT_CHOICES.map(font => <option key={font} value={font}>{font}</option>)}
      </select>
      <input aria-label="字号" title="字号（px）" type="number" min="6" max="240" value={fontSize} disabled={disabled || saving}
        onChange={event => setFontSize(event.currentTarget.value)} onBlur={() => { const value = Number(fontSize); if (Number.isFinite(value) && value >= 6 && value <= 240) applyTextStyle({ fontSize: value }); }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <input aria-label="文字颜色" title="文字颜色" type="color" value={fontColor} disabled={disabled || saving}
        onChange={event => { setFontColor(event.currentTarget.value); applyTextStyle({ color: event.currentTarget.value }); }} />
      <button type="button" aria-label="粗体" title="粗体" disabled={disabled || saving} onMouseDown={event => event.preventDefault()} onClick={() => toggleMark('strong')}><b>B</b></button>
      <button type="button" aria-label="斜体" title="斜体" disabled={disabled || saving} onMouseDown={event => event.preventDefault()} onClick={() => toggleMark('em')}><i>I</i></button>
      <button type="button" aria-label="下划线" title="下划线" disabled={disabled || saving} onMouseDown={event => event.preventDefault()} onClick={() => toggleMark('underline')}><u>U</u></button>
      <button type="button" aria-label="删除线" title="删除线" disabled={disabled || saving} onMouseDown={event => event.preventDefault()} onClick={() => toggleMark('strike')}><s>S</s></button>
    </div>
    <div className="editor-rich-paragraph-tools">
      <label>对齐<select aria-label="段落对齐" value={align} disabled={disabled || saving} onChange={event => { const value = event.currentTarget.value as typeof align; setAlign(value); applyParagraphAttr('align', value); }}>
        <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option>
      </select></label>
      <label>行距 px<input aria-label="行距" type="number" min="6" max="1000" step="1" value={lineHeight} disabled={disabled || saving}
        onChange={event => setLineHeight(event.currentTarget.value)} onBlur={() => { const value = Number(lineHeight); if (Number.isFinite(value) && value > 0) applyParagraphAttr('lineHeight', value); }} /></label>
      <details className="editor-paragraph-menu"><summary>间距⌄</summary><div>
        <label>段前 px<input aria-label="段前间距" type="number" min="0" max="1000" value={spaceBefore} disabled={disabled || saving} onChange={event => setSpaceBefore(event.currentTarget.value)} onBlur={() => applyParagraphAttr('spaceBefore', Number(spaceBefore) || 0)} /></label>
        <label>段后 px<input aria-label="段后间距" type="number" min="0" max="1000" value={spaceAfter} disabled={disabled || saving} onChange={event => setSpaceAfter(event.currentTarget.value)} onBlur={() => applyParagraphAttr('spaceAfter', Number(spaceAfter) || 0)} /></label>
        <label>缩进 px<input aria-label="段落缩进" type="number" min="0" max="1000" value={indent} disabled={disabled || saving} onChange={event => setIndent(event.currentTarget.value)} onBlur={() => applyParagraphAttr('indent', Number(indent) || 0)} /></label>
        <label>首行 px<input aria-label="首行缩进" type="number" min="-1000" max="1000" value={firstLineIndent} disabled={disabled || saving} onChange={event => setFirstLineIndent(event.currentTarget.value)} onBlur={() => applyParagraphAttr('firstLineIndent', Number(firstLineIndent) || 0)} /></label>
      </div></details>
    </div>
    {docMode && <div className="editor-rich-toolbar" aria-label="文档结构">
      {(['pageBreakBefore','keepNext','keepLines','widowControl'] as const).map((key,i)=><label key={key}><input aria-label={['段前分页','与下段同页','段内不分页','孤行控制'][i]} type="checkbox" checked={!!pagination[key]} disabled={disabled||saving} onChange={e=>applyParagraphAttr(key,e.currentTarget.checked)} />{['段前分页','与下段同页','段内不分页','孤行控制'][i]}</label>)}
      <select aria-label="正文样式" defaultValue="p" disabled={disabled||saving} onChange={e=>blockType(e.currentTarget.value)}><option value="p">正文</option>{[1,2,3].map(n=><option key={n} value={n}>标题 {n}</option>)}</select>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={()=>{const view=viewRef.current;if(view){wrapInList(schema.nodes.bullet_list!)(view.state,tr=>view.dispatch(tr));view.focus();}}}>无序列表</button>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={()=>{const view=viewRef.current;if(view){wrapInList(schema.nodes.ordered_list!)(view.state,tr=>view.dispatch(tr));view.focus();}}}>有序列表</button>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={()=>insertFloating('floating_shape')}>浮动文字框</button>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={()=>insertFloating('floating_shape',{shape:'ellipse',text:'',width:140,height:140})}>浮动图形</button>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={insertTable}>插入表格</button>
      <button disabled={disabled||saving} onMouseDown={e=>e.preventDefault()} onClick={()=>{const view=viewRef.current;if(view){view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.page_break!.create()));view.focus();}}}>分页符</button>
      {onImportImage && <><label><input type="checkbox" aria-label="图片作为浮动对象" checked={floatingImage} onChange={e=>setFloatingImage(e.currentTarget.checked)} />浮动图片</label><button disabled={disabled||saving||importingImage} onMouseDown={e=>e.preventDefault()} onClick={()=>imageInput.current?.click()}>{importingImage?'正在插入…':'插入图片'}</button>
      <input ref={imageInput} hidden aria-label="插入文档图片" type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';const view=viewRef.current;if(!file||!view)return;setImportingImage(true);void onImportImage(file).then(asset=>{if(view.isDestroyed||viewRef.current!==view)return;assetsRef.current.push(asset);const width=Math.min(360,asset.width);if(floatingImage)insertFloating('floating_image',{assetId:asset.id,width,height:width*asset.height/asset.width,alt:asset.name ?? ''});else view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.inline_image!.create({assetId:asset.id,width,height:width*asset.height/asset.width,alt:asset.name ?? ''})));view.focus();}).catch(()=>propsRef.current.onConflict()).finally(()=>setImportingImage(false));}} /></>}
    </div>}
    {objectAttrs&&<div className="doc-object-properties" aria-label="浮动对象属性">
      <strong>{objectAttrs.kind==='inline_image'?'行内图片':objectAttrs.kind==='floating_image'?'浮动图片':'浮动图形 / 文字框'}</strong>
      {(objectAttrs.kind==='inline_image'?['width','height']:['x','y','width','height','rotation']).map(key=><label key={`${objectAttrs.id}-${key}-${objectAttrs[key]}`}>{({x:'X',y:'Y',width:'宽',height:'高',rotation:'旋转'} as Record<string,string>)[key]}<input aria-label={`${objectAttrs.kind==='inline_image'?'行内图片':'浮动'}${key}`} type="number" defaultValue={objectAttrs[key]} disabled={disabled||saving||objectAttrs.locked} onBlur={e=>{const value=Number(e.currentTarget.value);if(Number.isFinite(value)&&value!==objectAttrs[key])updateObject(key,value);}} /></label>)}
      {objectAttrs.kind!=='inline_image'&&<><select aria-label="浮动环绕" value={objectAttrs.wrap} disabled={disabled||saving||objectAttrs.locked} onChange={e=>updateObject('wrap',e.currentTarget.value)}><option value="topBottom">上下环绕</option><option value="none">覆盖正文</option></select>
      <label><input aria-label="锁定浮动对象" type="checkbox" checked={objectAttrs.locked} disabled={disabled||saving} onChange={e=>updateObject('locked',e.currentTarget.checked)} />锁定</label></>}
      {['inline_image','floating_image'].includes(objectAttrs.kind)&&<label>图片说明<input key={`${objectAttrs.id}-${objectAttrs.alt}`} aria-label="图片说明" defaultValue={objectAttrs.alt} disabled={disabled||saving||objectAttrs.locked} onBlur={e=>{if(e.currentTarget.value!==objectAttrs.alt)updateObject('alt',e.currentTarget.value);}}/></label>}
      {objectAttrs.kind==='floating_shape'&&<><textarea key={`${objectAttrs.id}-${objectAttrs.text}`} aria-label="浮动文字" defaultValue={objectAttrs.text} disabled={disabled||saving||objectAttrs.locked} onBlur={e=>{if(e.currentTarget.value!==objectAttrs.text)updateObject('text',e.currentTarget.value);}} />{['fill','stroke','color'].map(key=><label key={key}>{key}<input aria-label={`${objectAttrs.kind==='inline_image'?'行内图片':'浮动'}${key}`} type="color" value={objectAttrs[key]} disabled={disabled||saving||objectAttrs.locked} onChange={e=>updateObject(key,e.currentTarget.value)} /></label>)}</>}
    </div>}
    <DocPageFrames hostRef={hostRef} schema={schema} options={docPagination}/>
    <small className="editor-rich-status">{saving ? '正在保存文字…' : '支持段落、中文输入和所选文字格式'}</small>
  </section>;
}
