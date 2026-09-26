import { useCallback, useEffect, useRef, useState } from 'react';
import type { PMNodeJSON } from '@oeydesign/document';
import { EditorState } from 'prosemirror-state';
import type { Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { editorTextSchema } from './editor-text-schema.ts';

export type RichTextEditorProps = {
  documentId: string;
  nodeId: string;
  content: PMNodeJSON;
  revision: number;
  disabled: boolean;
  focused?: boolean;
  baseStyle?: { fontFamily?: string; fontSize?: number; color?: string };
  onCommit: (documentId: string, nodeId: string, steps: unknown[], label: string, baseRevision: number) => Promise<boolean>;
  onConflict: () => void;
};

const FONT_CHOICES = ['Segoe UI', 'Arial', 'Georgia', 'Aptos', 'Microsoft YaHei', 'Noto Sans'];
const docJson = (value: PMNodeJSON) => editorTextSchema.nodeFromJSON(value);
type PendingFocusRestore = { view: EditorView; selection: Selection; moved: boolean; cleanup: () => void };

export function RichTextEditor({ documentId, nodeId, content, revision, disabled, focused = false, baseStyle, onCommit, onConflict }: RichTextEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const stepsRef = useRef<unknown[]>([]);
  const committedDocRef = useRef(docJson(content));
  const baseRevisionRef = useRef(revision);
  const propsRef = useRef({ onCommit, onConflict, disabled });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const focusRestoreRef = useRef<PendingFocusRestore | null>(null);
  const [saving, setSaving] = useState(false);
  const [fontFamily, setFontFamily] = useState(baseStyle?.fontFamily ?? 'Segoe UI');
  const [fontSize, setFontSize] = useState(String(baseStyle?.fontSize ?? 24));
  const [fontColor, setFontColor] = useState(baseStyle?.color ?? '#244b3a');
  const [lineHeight, setLineHeight] = useState(String((baseStyle?.fontSize ?? 24) * 1.2));
  const [spaceBefore, setSpaceBefore] = useState('0');
  const [spaceAfter, setSpaceAfter] = useState('0');
  const [indent, setIndent] = useState('0');
  const [firstLineIndent, setFirstLineIndent] = useState('0');
  const [align, setAlign] = useState<'left' | 'center' | 'right' | 'justify'>('left');

  propsRef.current = { onCommit, onConflict, disabled };

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
    try { ok = await propsRef.current.onCommit(documentId, nodeId, steps, '编辑富文本', baseRevision); }
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
      view.updateState(EditorState.create({ schema: editorTextSchema, doc: committedDocRef.current }));
      propsRef.current.onConflict();
    }
    savingRef.current = false;
    if (stillCurrent) {
      setSaving(false);
    } else if (viewRef.current && !viewRef.current.isDestroyed) {
      setSaving(false);
    }
  }, [documentId, nodeId]);

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
    const state = EditorState.create({ schema: editorTextSchema, doc });
    const view = new EditorView(host, {
      state,
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
        const next = view.state.apply(transaction);
        view.updateState(next);
        syncToolbar(next);
        if (transaction.steps.length) {
          stepsRef.current.push(...transaction.steps.map(step => step.toJSON()));
        }
        // Selecting recently typed text is still active editing. Do not start
        // an idle save in the middle of keyboard range selection.
        if (stepsRef.current.length) scheduleFlush();
      },
    });
    viewRef.current = view;
    syncToolbar(view.state);
    const onBlur = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } void flush(); };
    view.dom.addEventListener('blur', onBlur, true);
    view.dom.addEventListener('compositionend', scheduleFlush);
    return () => {
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
  }, [documentId, nodeId, flush]);

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
      view.updateState(EditorState.create({ schema: editorTextSchema, doc: incoming }));
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
    view.updateState(EditorState.create({ schema: editorTextSchema, doc: incoming }));
    syncToolbar(view.state);
    propsRef.current.onConflict();
  }, [content, documentId, revision]);

  useEffect(() => { if (focused) viewRef.current?.focus(); }, [focused]);

  function syncToolbar(state: EditorState) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const style = marks.find(mark => mark.type === editorTextSchema.marks.textStyle);
    const font = style?.attrs.fontFamily;
    const size = style?.attrs.fontSize;
    const color = style?.attrs.color;
    if (typeof font === 'string' && FONT_CHOICES.includes(font)) setFontFamily(font);
    else if (baseStyle?.fontFamily) setFontFamily(baseStyle.fontFamily);
    if (typeof size === 'number' && Number.isFinite(size)) setFontSize(String(size));
    else if (baseStyle?.fontSize) setFontSize(String(baseStyle.fontSize));
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) setFontColor(color);
    else if (baseStyle?.color) setFontColor(baseStyle.color);
    const block = state.selection.$from.parent;
    const currentAlign = block.attrs.align;
    if (currentAlign === 'left' || currentAlign === 'center' || currentAlign === 'right' || currentAlign === 'justify') setAlign(currentAlign);
    else setAlign('left');
    const currentLineHeight = block.attrs.lineHeight;
    if (typeof currentLineHeight === 'number') setLineHeight(String(currentLineHeight));
    else setLineHeight(String((baseStyle?.fontSize ?? 24) * 1.2));
    setSpaceBefore(typeof block.attrs.spaceBefore === 'number' ? String(block.attrs.spaceBefore) : '0');
    setSpaceAfter(typeof block.attrs.spaceAfter === 'number' ? String(block.attrs.spaceAfter) : '0');
    setIndent(typeof block.attrs.indent === 'number' ? String(block.attrs.indent) : '0');
    setFirstLineIndent(typeof block.attrs.firstLineIndent === 'number' ? String(block.attrs.firstLineIndent) : '0');
  }

  useEffect(() => {
    const view = viewRef.current;
    view?.setProps({ editable: () => !propsRef.current.disabled && !savingRef.current });
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
  }, [disabled, saving]);

  function toggleMark(name: 'strong' | 'em' | 'underline' | 'strike') {
    const view = viewRef.current;
    const mark = editorTextSchema.marks[name];
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
    const mark = editorTextSchema.marks.textStyle;
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

  function applyParagraphAttr(key: 'align' | 'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'indent' | 'firstLineIndent', value: string | number) {
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

  return <section className="editor-rich-text" aria-label="富文本编辑器">
    <div className="editor-rich-toolbar" role="toolbar" aria-label="文字格式">
      <select aria-label="字体" title="字体" value={fontFamily} disabled={disabled || saving} onChange={event => { const value = event.currentTarget.value; setFontFamily(value); applyTextStyle({ fontFamily: value }); }}>
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
    <div ref={hostRef} className="editor-rich-host" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void flush(); }} />
    <small className="editor-rich-status">{saving ? '正在保存文字…' : '支持段落、中文输入和所选文字格式'}</small>
  </section>;
}
