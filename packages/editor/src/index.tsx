import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import { Arc, Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type { Node as KonvaNode } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import type { ChartData, DeckDocument, DeckNode, DeckTheme, DocumentAsset, DocumentOperation, Geometry, ImageAsset, ImageSettings, TableData } from '@oeydesign/document';
import { normalizeKonvaTransform, textToString } from '@oeydesign/document';
import {
  makeChartInsert, makeCoverOperations, makeImageInsert, makePageInsert, makeShapeInsert, makeTableInsert, makeTextInsert, makeTextReplacementSteps, scaleRichTextContent,
} from './operations.ts';
import { alignNodes, distributeNodes, snapGeometry, type Alignment, type SnapGuide } from './layout.ts';
import { RichTextEditor } from './RichTextEditor.tsx';
import { RichTextPreview } from './RichTextPreview.tsx';
import { ImageProperties } from './ImageProperties.tsx';
import { TableProperties } from './TableProperties.tsx';
import { ChartProperties } from './ChartProperties.tsx';

export type DeckEditorProps = {
  document: DeckDocument;
  onApply: (operations: DocumentOperation[], label: string, baseRevision: number) => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onSelectionChange?: (ids: string[]) => void;
  onImportAsset?: (file: File) => Promise<DocumentAsset>;
  assetUrl?: (assetId: string) => string;
  disabled?: boolean;
};

type ViewPoint = { x: number; y: number };
type CanvasSize = { width: number; height: number };
type LayerEntry = { node: DeckNode; depth: number };
type SelectionBox = { x: number; y: number; width: number; height: number };
type ClipboardSnapshot = { roots: string[]; nodes: DeckNode[] };
type MarqueeStart = { x: number; y: number; additive: boolean };
type Gesture = {
  kind: 'drag' | 'transform';
  revision: number;
  ids: string[];
  parentId: string;
  before: Map<string, Geometry>;
  cancelled: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const asString = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback;
const asNumber = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const sameGeometry = (left: Geometry, right: Geometry) =>
  Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01 &&
  Math.abs(left.width - right.width) < 0.01 && Math.abs(left.height - right.height) < 0.01 &&
  Math.abs(left.rotation - right.rotation) < 0.01;

const THEME_PRESETS: Array<{ name: string; theme: DeckTheme }> = [
  { name: '松林', theme: { name: '松林', headingFontFamily: 'Georgia', bodyFontFamily: 'Segoe UI', fontFamily: 'Segoe UI', colors: { accent1: '#315d4b', accent2: '#c07e4d', accent3: '#6e87a1', accent4: '#9cae79', accent5: '#855f71', accent6: '#d1a866', text1: '#263d30', text2: '#66766b', background1: '#ffffff', background2: '#e8efe9' } } },
  { name: '暖纸', theme: { name: '暖纸', headingFontFamily: 'Georgia', bodyFontFamily: 'Aptos', fontFamily: 'Aptos', colors: { accent1: '#9e593d', accent2: '#c69756', accent3: '#617b77', accent4: '#b78379', accent5: '#6e6b8a', accent6: '#8f9e62', text1: '#44352e', text2: '#85756a', background1: '#fffdf8', background2: '#f3eadd' } } },
  { name: '雾蓝', theme: { name: '雾蓝', headingFontFamily: 'Georgia', bodyFontFamily: 'Segoe UI', fontFamily: 'Segoe UI', colors: { accent1: '#416b81', accent2: '#b57b63', accent3: '#6d8d7b', accent4: '#9d95ba', accent5: '#bfaa66', accent6: '#657a9a', text1: '#2f414b', text2: '#657882', background1: '#ffffff', background2: '#e8f0f3' } } },
];

function childrenFor(document: DeckDocument, parentId: string): string[] {
  const page = document.pages.find(candidate => candidate.id === parentId);
  if (page) return page.children;
  return document.nodes[parentId]?.children ?? [];
}

function flattenLayers(document: DeckDocument, parentId: string, depth = 0): LayerEntry[] {
  return [...childrenFor(document, parentId)].reverse().flatMap(id => {
    const node = document.nodes[id];
    if (!node) return [];
    return [{ node, depth }, ...(node.kind === 'group' ? flattenLayers(document, node.id, depth + 1) : [])];
  });
}

function isEffectivelyLocked(document: DeckDocument, nodeId: string): boolean {
  let current = document.nodes[nodeId];
  while (current) {
    if (current.locked) return true;
    current = document.nodes[current.parentId];
  }
  return false;
}

function isEffectivelyHidden(document: DeckDocument, nodeId: string): boolean {
  let current = document.nodes[nodeId];
  while (current) {
    if (current.hidden) return true;
    current = document.nodes[current.parentId];
  }
  return false;
}

function isOnPage(document: DeckDocument, nodeId: string, pageId: string): boolean {
  let current = document.nodes[nodeId];
  while (current) {
    if (current.parentId === pageId) return true;
    current = document.nodes[current.parentId];
  }
  return false;
}

function labelFor(node: DeckNode): string {
  const named = node.style.name;
  if (typeof named === 'string' && named.trim()) return `${named.trim()} · ${node.id.slice(-4)}`;
  if (node.kind === 'text' && node.content) {
    const value = textToString(node.content).split('\n')[0]?.trim();
    return `${value || '文字'} · ${node.id.slice(-4)}`;
  }
  const kind = node.kind === 'shape' ? '矩形' : node.kind === 'image' ? '图片' : node.kind === 'group' ? '图层组' : node.kind === 'table' ? '表格' : node.kind === 'chart' ? '图表' : '文字';
  return `${kind} · ${node.id.slice(-4)}`;
}

function localColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#dce9df';
}

function NumberField({
  label, value, revision, disabled, min, onCommit,
}: {
  label: string; value: number; revision: number; disabled: boolean; min?: number;
  onCommit: (value: number, baseRevision: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const baseRevision = useRef<number | null>(null);
  useEffect(() => { setDraft(String(Math.round(value * 100) / 100)); baseRevision.current = null; }, [value, revision]);
  const finish = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min)) {
      setDraft(String(value)); baseRevision.current = null; return;
    }
    if (parsed !== value && baseRevision.current !== null) onCommit(parsed, baseRevision.current);
    baseRevision.current = null;
  };
  return <label className="editor-number-field">
    <span>{label}</span>
    <input aria-label={label} type="number" step="1" min={min} value={draft} disabled={disabled}
      onFocus={() => { baseRevision.current = revision; }}
      onChange={event => setDraft(event.currentTarget.value)} onBlur={finish}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
  </label>;
}

function TextProperty({
  node, revision, disabled, focused, onCommit,
}: {
  node: DeckNode; revision: number; disabled: boolean; focused: boolean;
  onCommit: (nodeId: string, value: string, baseRevision: number) => void;
}) {
  const value = node.content ? textToString(node.content) : '';
  const [draft, setDraft] = useState(value);
  const baseRevision = useRef<number | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setDraft(value); baseRevision.current = null; }, [value, revision, node.id]);
  useEffect(() => { if (focused) input.current?.focus(); }, [focused, node.id]);
  const finish = () => {
    if (draft !== value && baseRevision.current !== null) onCommit(node.id, draft, baseRevision.current);
    baseRevision.current = null;
  };
  return <label className="editor-property-block">
    <span>文字内容</span>
    <textarea ref={input} aria-label="文字内容" value={draft} disabled={disabled}
      onFocus={() => { baseRevision.current = revision; }} onChange={event => setDraft(event.currentTarget.value)}
      onBlur={finish} placeholder="输入文字…" rows={4} />
    <small>按 Enter 换行，离开输入框后保存</small>
  </label>;
}

function ColorProperty({
  value, revision, disabled, mixed, onCommit,
}: {
  value: unknown; revision: number; disabled: boolean; mixed: boolean;
  onCommit: (color: string, baseRevision: number) => void;
}) {
  const color = localColor(value);
  const [draft, setDraft] = useState(color);
  const baseRevision = useRef<number | null>(null);
  useEffect(() => { setDraft(color); baseRevision.current = null; }, [color, revision]);
  const presets = ['#244b3a', '#dce9df', '#d7a969', '#bd5d3b', '#527e9b', '#f4f1e8'];
  return <div className="editor-property-block">
    <span>填充颜色</span>
    <div className="editor-color-control">
      <input aria-label="填充颜色" type="color" value={draft} disabled={disabled} title="填充颜色"
        onFocus={() => { baseRevision.current = revision; }} onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => { if (draft !== color && baseRevision.current !== null) onCommit(draft, baseRevision.current); baseRevision.current = null; }} />
      <code>{mixed ? '混合颜色' : draft.toUpperCase()}</code>
    </div>
    <div className="editor-swatches" aria-label="颜色预设">
      {presets.map(preset => <button key={preset} type="button" aria-label={`填充颜色 ${preset}`} title={preset} disabled={disabled}
        className={color.toLowerCase() === preset ? 'is-current' : ''} style={{ '--swatch': preset } as CSSProperties}
        onClick={() => onCommit(preset, revision)} />)}
    </div>
  </div>;
}

export function DeckEditor({ document, onApply, onUndo, onRedo, onSelectionChange, onImportAsset, assetUrl, disabled = false }: DeckEditorProps) {
  const initialPage = document.pages[0]?.id ?? '';
  const [activePageId, setActivePageId] = useState(initialPage);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [groupScale, setGroupScale] = useState('1.1');
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<ViewPoint>({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [focusTextId, setFocusTextId] = useState('');
  const [imageElements, setImageElements] = useState<Map<string, HTMLImageElement>>(new Map());
  const [textMatrices, setTextMatrices] = useState<Map<string, number[]>>(new Map());
  const [editingGroupId, setEditingGroupId] = useState('');
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapObjects, setSnapObjects] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const replacingImageIdRef = useRef('');
  const stageRef = useRef<KonvaStage | null>(null);
  const transformerRef = useRef<KonvaTransformer | null>(null);
  const nodeRefs = useRef(new Map<string, KonvaNode>());
  const selectionRef = useRef<string[]>([]);
  const documentRef = useRef(document);
  const previousDocumentId = useRef(document.documentId);
  const onApplyRef = useRef(onApply);
  const disabledRef = useRef(disabled);
  const pendingRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const spaceDownRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  const marqueeRef = useRef<MarqueeStart | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const clipboardRef = useRef<ClipboardSnapshot | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const importAssetRef = useRef(onImportAsset);
  const assetUrlRef = useRef(assetUrl);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const imageUrlsRef = useRef(new Map<string, string>());

  documentRef.current = document;
  onApplyRef.current = onApply;
  selectionChangeRef.current = onSelectionChange;
  importAssetRef.current = onImportAsset;
  assetUrlRef.current = assetUrl;
  disabledRef.current = disabled;
  zoomRef.current = zoom;
  panRef.current = pan;

  const setSelection = (ids: string[]) => {
    const unique = [...new Set(ids)];
    const previous = selectionRef.current;
    selectionRef.current = unique;
    setSelectedIds(unique);
    if (previous.length !== unique.length || previous.some((id, index) => id !== unique[index])) selectionChangeRef.current?.(unique);
  };

  const selectedNodes = selectedIds.map(id => document.nodes[id]).filter((node): node is DeckNode => Boolean(node));
  const page = document.pages.find(candidate => candidate.id === activePageId) ?? document.pages[0];
  const imageAssetSignature = Object.values(document.nodes).filter(node => node.kind === 'image' && node.assetId).map(node => `${node.id}:${node.assetId}`).join('|');
  const pageLayers = useMemo(() => page ? flattenLayers(document, page.id) : [], [document, page]);
  const activePageChildren = page?.children ?? [];
  const busy = disabled || pending;

  function refreshTextMatrices() {
    const next = new Map<string, number[]>();
    for (const { node } of pageLayers) {
      if (node.kind !== 'text' || isEffectivelyHidden(documentRef.current, node.id)) continue;
      const rendered = nodeRefs.current.get(node.id);
      if (rendered?.getStage()) next.set(node.id, [...rendered.getAbsoluteTransform().getMatrix()]);
    }
    setTextMatrices(next);
  }

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setCanvasSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const byAsset = new Map<string, string>();
    for (const node of Object.values(documentRef.current.nodes)) {
      if (node.kind !== 'image' || !node.assetId) continue;
      const url = assetUrlRef.current?.(node.assetId);
      if (url) byAsset.set(node.assetId, url);
    }
    for (const [assetId, url] of byAsset) {
      const existing = imageCacheRef.current.get(assetId);
      if (existing && imageUrlsRef.current.get(assetId) === url) {
        if (existing.complete && existing.naturalWidth > 0) setImageElements(current => new Map(current).set(assetId, existing));
        continue;
      }
      const image = new window.Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (cancelled) return;
        imageCacheRef.current.set(assetId, image); imageUrlsRef.current.set(assetId, url);
        setImageElements(current => new Map(current).set(assetId, image));
      };
      image.onerror = () => { if (!cancelled) setNotice('有图片资产无法载入预览。'); };
      image.src = url;
    }
    return () => { cancelled = true; };
  }, [imageAssetSignature, assetUrl]);

  useEffect(() => {
    if (!document.pages.some(candidate => candidate.id === activePageId)) {
      setActivePageId(document.pages[0]?.id ?? '');
      setSelection([]);
    }
  }, [activePageId, document.pages]);

  useEffect(() => {
    if (previousDocumentId.current === document.documentId) return;
    previousDocumentId.current = document.documentId;
    gestureRef.current = null;
    setSelection([]);
    setActivePageId(document.pages[0]?.id ?? '');
    setEditingGroupId('');
    setFocusTextId('');
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 };
    setZoom(1); setPan({ x: 0, y: 0 }); setNotice('');
    setCanvasEpoch(epoch => epoch + 1);
  }, [document.documentId]);

  useEffect(() => {
    const current = gestureRef.current;
    if (current && current.revision !== document.revision) {
      current.cancelled = true;
      gestureRef.current = null;
      marqueeRef.current = null; selectionBoxRef.current = null; setSelectionBox(null); setSnapGuides([]);
      setCanvasEpoch(epoch => epoch + 1);
      setNotice('作品在操作期间已更新，未提交的预演已取消。');
    }
    const stillVisible = selectionRef.current.filter(id => Boolean(document.nodes[id] && isOnPage(document, id, activePageId)));
    if (stillVisible.length !== selectionRef.current.length) setSelection(stillVisible);
  }, [document.revision, activePageId]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = selectionRef.current
      .map(id => nodeRefs.current.get(id))
      .filter((node): node is KonvaNode => Boolean(node && node.getStage()));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, canvasEpoch, activePageId, document.revision]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(refreshTextMatrices);
    return () => window.cancelAnimationFrame(frame);
  }, [pageLayers, activePageId, zoom, pan, canvasSize, canvasEpoch, document.revision, snapGuides, selectionBox]);

  useEffect(() => {
    const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inRichText = Boolean(target?.closest('.editor-rich-text'));
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z' && inRichText) {
        event.preventDefault(); if (busy) return; if (event.shiftKey) onRedo(); else onUndo(); return;
      }
      if (modifier && event.key.toLowerCase() === 'y' && inRichText) { event.preventDefault(); if (!busy) onRedo(); return; }
      if (editableTarget(event.target)) return;
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault(); spaceDownRef.current = true; setSpaceDown(true); return;
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (busy) return; if (event.shiftKey) onRedo(); else onUndo(); return;
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); if (!busy) onRedo(); return; }
      if (modifier && event.key.toLowerCase() === 'c' && selectionRef.current.length) { event.preventDefault(); copySelected(); return; }
      if (modifier && event.key.toLowerCase() === 'v' && (clipboardRef.current?.roots.length ?? 0) > 0) { event.preventDefault(); pasteClipboard(); return; }
      if (modifier && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && selectionRef.current.length) {
        event.preventDefault(); if (!busy) reorderSelection(event.key === 'ArrowUp' ? 'front' : 'back'); return;
      }
      if (modifier && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && selectionRef.current.length) {
        event.preventDefault(); if (!busy) reorderSelection(event.key === 'ArrowUp' ? 1 : -1); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectionRef.current.length && !busy) {
        event.preventDefault(); void removeSelected();
      }
      if (event.key === 'Escape') {
        if (editingGroupId) {
          const group = documentRef.current.nodes[editingGroupId];
          const parent = group ? documentRef.current.nodes[group.parentId] : undefined;
          const parentGroupId = parent?.kind === 'group' ? parent.id : '';
          setEditingGroupId(parentGroupId); setSelection(parentGroupId ? [] : [editingGroupId]);
        } else setSelection([]);
        setFocusTextId('');
      }
      if (event.key === 'Enter' && selectedIds.length === 1 && documentRef.current.nodes[selectedIds[0]!]?.kind === 'group') {
        event.preventDefault(); enterSelectedGroup(); return;
      }
      if (event.key === 'Tab' && pageLayers.length) {
        event.preventDefault(); cycleLayer(event.shiftKey ? -1 : 1); return;
      }
      if (!modifier && selectionRef.current.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); nudgeSelection(event.key, event.shiftKey ? 10 : 1); return;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') { spaceDownRef.current = false; setSpaceDown(false); }
    };
    const blur = () => { spaceDownRef.current = false; setSpaceDown(false); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [busy, editingGroupId, onRedo, onUndo, pageLayers, selectedIds]);

  const submit = useCallback(async (operations: DocumentOperation[], label: string, baseRevision = documentRef.current.revision): Promise<boolean> => {
    if (disabledRef.current || pendingRef.current || operations.length === 0) return false;
    pendingRef.current = true;
    setPending(true);
    setNotice('');
    try {
      await onApplyRef.current(operations, label, baseRevision);
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
      setNotice(code === 'conflict' ? '作品已更新，这次修改没有应用。请重新选择后再试。' : error instanceof Error ? error.message : '修改未能保存。');
      setCanvasEpoch(epoch => epoch + 1);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, []);

  function chooseNode(id: string, additive: boolean) {
    const current = documentRef.current;
    const node = current.nodes[id];
    if (!node) return;
    if (editingGroupId && id !== editingGroupId && !isInsideGroup(current, id, editingGroupId)) {
      setEditingGroupId('');
    }
    if (!additive) { setSelection([id]); return; }
    const existing = selectionRef.current;
    if (existing.includes(id)) { setSelection(existing.filter(candidate => candidate !== id)); return; }
    const anchor = current.nodes[existing[0] ?? ''];
    if (anchor && anchor.parentId !== node.parentId) {
      setNotice('多选目前仅支持同一父级中的图层。');
      return;
    }
    setSelection([...existing, id]);
  }

  function isInsideGroup(current: DeckDocument, nodeId: string, groupId: string): boolean {
    let parent = current.nodes[nodeId]?.parentId;
    while (parent && current.nodes[parent]) {
      if (parent === groupId) return true;
      parent = current.nodes[parent]?.parentId;
    }
    return false;
  }

  function enterSelectedGroup() {
    const current = documentRef.current;
    const id = selectionRef.current.length === 1 ? selectionRef.current[0] : undefined;
    if (!id || current.nodes[id]?.kind !== 'group') return;
    setEditingGroupId(id);
    setSelection([]);
    setNotice('已进入图层组；Escape 返回上一级。');
  }

  function stagePointer() {
    const stage = stageRef.current;
    return stage?.getRelativePointerPosition() ?? null;
  }

  function startMarquee(additive = false) {
    if (busy || spaceDownRef.current) return;
    const pointer = stagePointer();
    if (!pointer) return;
    marqueeRef.current = { x: pointer.x, y: pointer.y, additive };
    const nextBox = { x: pointer.x, y: pointer.y, width: 0, height: 0 };
    selectionBoxRef.current = nextBox; setSelectionBox(nextBox);
    setSnapGuides([]);
  }

  function updateMarquee() {
    const origin = marqueeRef.current;
    const pointer = origin && stagePointer();
    if (!origin || !pointer) return;
    const nextBox = { x: Math.min(origin.x, pointer.x), y: Math.min(origin.y, pointer.y),
      width: Math.abs(pointer.x - origin.x), height: Math.abs(pointer.y - origin.y) };
    selectionBoxRef.current = nextBox; setSelectionBox(nextBox);
  }

  function finishMarquee() {
    const origin = marqueeRef.current;
    const box = selectionBoxRef.current;
    marqueeRef.current = null;
    selectionBoxRef.current = null;
    setSelectionBox(null);
    if (!origin) return;
    if (!box || box.width < 2 || box.height < 2) {
      if (!origin.additive) setSelection([]);
      return;
    }
    const current = documentRef.current;
    const parentId = editingGroupId && current.nodes[editingGroupId]?.kind === 'group' ? editingGroupId : activePageId;
    const bounds = { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
    const hits = childrenFor(current, parentId).filter(id => {
      const node = current.nodes[id];
      const rendered = nodeRefs.current.get(id);
      if (!node || node.hidden || !rendered) return false;
      const rect = rendered.getClientRect({ relativeTo: stageRef.current ?? undefined });
      return rect.x < bounds.right && rect.x + rect.width > bounds.left && rect.y < bounds.bottom && rect.y + rect.height > bounds.top;
    });
    const selected = origin.additive ? [...selectionRef.current, ...hits] : hits;
    setSelection(selected);
  }

  function beginGesture(kind: Gesture['kind'], initiatingId?: string) {
    if (busy || disabledRef.current) return;
    const current = documentRef.current;
    const activeIds = initiatingId && !selectionRef.current.includes(initiatingId) ? [initiatingId] : selectionRef.current;
    const nodes = activeIds.map(id => current.nodes[id]).filter((node): node is DeckNode => Boolean(node));
    if (!nodes.length || nodes.some(node => isEffectivelyLocked(current, node.id))) return;
    const parentId = nodes[0]!.parentId;
    if (nodes.some(node => node.parentId !== parentId)) return;
    const before = new Map(nodes.map(node => [node.id, structuredClone(node.geometry)]));
    gestureRef.current = { kind, revision: current.revision, ids: nodes.map(node => node.id), parentId, before, cancelled: false };
  }

  function moveGesture(initiatingId: string, target: KonvaNode) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.cancelled || gesture.kind !== 'drag' || !gesture.ids.includes(initiatingId)) return;
    const initial = gesture.before.get(initiatingId);
    if (!initial) return;
    const current = documentRef.current;
    const moving = current.nodes[initiatingId];
    if (moving && (snapGrid || snapObjects)) {
      const snap = snapGeometry(initiatingId, { x: target.x(), y: target.y(), width: moving.geometry.width, height: moving.geometry.height },
        childrenFor(current, moving.parentId).map(id => current.nodes[id]).filter((node): node is DeckNode => Boolean(node)),
        { grid: 20, tolerance: 7 / Math.max(0.1, zoomRef.current), useGrid: snapGrid, useObjects: snapObjects });
      target.position({ x: snap.x, y: snap.y });
      setSnapGuides(snap.guides);
    } else setSnapGuides([]);
    const dx = target.x() - initial.x;
    const dy = target.y() - initial.y;
    for (const id of gesture.ids) {
      if (id === initiatingId) continue;
      const original = gesture.before.get(id);
      const sibling = nodeRefs.current.get(id);
      if (original && sibling) sibling.position({ x: original.x + dx, y: original.y + dy });
    }
    target.getLayer()?.batchDraw();
  }

  async function finishGesture() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    const current = documentRef.current;
    if (gesture.cancelled || current.revision !== gesture.revision) {
      setCanvasEpoch(epoch => epoch + 1);
      setNotice('作品在操作期间已更新，未提交的预演已取消。');
      return;
    }
    const operations: DocumentOperation[] = [];
    for (const id of gesture.ids) {
      const node = current.nodes[id];
      const rendered = nodeRefs.current.get(id);
      const before = gesture.before.get(id);
      if (!node || !rendered || !before) continue;
      const geometry = node.kind === 'group'
        ? { ...before, x: rendered.x(), y: rendered.y(), rotation: rendered.rotation() }
        : normalizeKonvaTransform({ x: rendered.x(), y: rendered.y(), width: rendered.width(), height: rendered.height(), rotation: rendered.rotation(), scaleX: rendered.scaleX(), scaleY: rendered.scaleY(), offsetX: rendered.offsetX(), offsetY: rendered.offsetY() });
      rendered.scale({ x: 1, y: 1 });
      rendered.offset({ x: 0, y: 0 });
      if (!sameGeometry(before, geometry)) operations.push({ type: 'geometry.update', nodeId: id, geometry });
    }
    if (operations.length) await submit(operations, gesture.kind === 'drag' ? '移动图层' : '调整图层', gesture.revision);
  }

  async function removeSelected() {
    const current = documentRef.current;
    const ids = selectionRef.current.filter(id => current.nodes[id] && !isEffectivelyLocked(current, id));
    if (!ids.length) return;
    if (await submit(ids.map(nodeId => ({ type: 'node.remove', nodeId })), ids.length > 1 ? '删除多个图层' : '删除图层', current.revision)) setSelection([]);
  }

  function resetView() { zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; setZoom(1); setPan({ x: 0, y: 0 }); }

  function addText() {
    if (!page) return;
    const operation = makeTextInsert(page.id, { x: Math.round(page.width / 2 - 180), y: Math.round(page.height / 2 - 42) });
    if (operation.type !== 'node.insert') return;
    operation.node.style.fontFamily = asString(document.theme?.bodyFontFamily ?? document.theme?.fontFamily, 'Segoe UI');
    operation.node.style.fill = asString(document.theme?.colors?.text1, '#244b3a');
    void submit([operation], '添加文字').then(ok => { if (ok) setSelection([operation.node.id]); });
  }

  function addShape() {
    if (!page) return;
    const operation = makeShapeInsert(page.id, { x: Math.round(page.width / 2 - 140), y: Math.round(page.height / 2 - 75) });
    if (operation.type !== 'node.insert') return;
    operation.node.style.fill = asString(document.theme?.colors?.accent1, '#dce9df');
    void submit([operation], '添加形状').then(ok => { if (ok) setSelection([operation.node.id]); });
  }

  function addTable() {
    if (!page) return;
    const operation = makeTableInsert(page.id, { x: Math.round(page.width / 2 - 205), y: Math.round(page.height / 2 - 78) }, {
      fill: asString(document.theme?.colors?.background2, '#e8efe9'), textColor: asString(document.theme?.colors?.text1, '#244b3a'),
    });
    if (operation.type !== 'node.insert') return;
    void submit([operation], '添加表格').then(ok => { if (ok) setSelection([operation.node.id]); });
  }

  function addChart() {
    if (!page) return;
    const colors = ['accent1', 'accent2', 'accent3'].map((key, index) => asString(document.theme?.colors?.[key as keyof NonNullable<DeckTheme['colors']>], ['#315d4b', '#c07e4d', '#6e87a1'][index]!));
    const operation = makeChartInsert(page.id, { x: Math.round(page.width / 2 - 240), y: Math.round(page.height / 2 - 150) }, {
      colors, textColor: asString(document.theme?.colors?.text1, '#304238'),
    });
    if (operation.type !== 'node.insert') return;
    void submit([operation], '添加图表').then(ok => { if (ok) setSelection([operation.node.id]); });
  }

  function openImagePicker(replaceNodeId = '') {
    replacingImageIdRef.current = replaceNodeId;
    assetInputRef.current?.click();
  }

  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const importer = importAssetRef.current;
    if (!file || !importer) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setNotice('请选择 PNG、JPEG 或 WebP 图片。'); return; }
    const current = documentRef.current;
    const pageId = activePageId;
    const replacementId = replacingImageIdRef.current;
    const baseRevision = current.revision;
    setNotice('正在导入图片…');
    try {
      const asset = await importer(file);
      if (documentRef.current.documentId !== current.documentId) { setNotice('作品已切换，图片没有加入当前页面。'); return; }
      if (!asset || asset.kind !== 'image' || !asset.id || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
        setNotice('图片服务返回了无效的资产信息。'); return;
      }
      if (replacementId && documentRef.current.nodes[replacementId]?.kind === 'image') {
        const ok = await submit([{ type: 'asset.replace', nodeId: replacementId, asset }], '替换图片', baseRevision);
        if (ok) { setSelection([replacementId]); setNotice('图片已替换，原资产仍保留在作品中。'); }
        return;
      }
      const targetPage = documentRef.current.pages.find(candidate => candidate.id === pageId) ?? documentRef.current.pages[0];
      if (!targetPage) { setNotice('当前没有可放置图片的页面。'); return; }
      const scale = Math.min(1, targetPage.width * 0.62 / asset.width, targetPage.height * 0.62 / asset.height);
      const width = asset.width * scale; const height = asset.height * scale;
      const operations = makeImageInsert(targetPage.id, { x: Math.round((targetPage.width - width) / 2), y: Math.round((targetPage.height - height) / 2) }, asset, { width, height });
      const imageNode = operations.find((operation): operation is Extract<DocumentOperation, { type: 'node.insert' }> => operation.type === 'node.insert')?.node;
      const ok = await submit(operations, '插入图片', baseRevision);
      if (ok && imageNode) setSelection([imageNode.id]);
    } catch (error) {
      setNotice(error instanceof Error ? `图片导入失败：${error.message}` : '图片导入失败。');
    }
  }

  function addPage() {
    const addition = makePageInsert(documentRef.current);
    void submit([addition.operation], '新增页面').then(ok => { if (ok) { setActivePageId(addition.pageId); setSelection([]); resetView(); } });
  }

  function addCover() {
    if (!page) return;
    const cover = makeCoverOperations(page.id, page.width, page.height);
    void submit(cover.operations, '插入示例封面').then(ok => { if (ok) setSelection([cover.focusNodeId]); });
  }

  function applyTheme(theme: DeckTheme) {
    const current = documentRef.current;
    const colors = theme.colors ?? {};
    const accents = [colors.accent1, colors.accent2, colors.accent3, colors.accent4, colors.accent5, colors.accent6].filter((color): color is string => typeof color === 'string');
    const operations: DocumentOperation[] = [{ type: 'document.theme', theme }];
    let accentIndex = 0;
    for (const node of Object.values(current.nodes)) {
      if (node.kind === 'group' || isEffectivelyLocked(current, node.id)) continue;
      if (node.kind === 'text') {
        const firstBlock = node.content?.content?.[0]?.type;
        operations.push({ type: 'style.update', nodeId: node.id, style: {
          fill: colors.text1 ?? '#263d30',
          fontFamily: firstBlock === 'heading' ? theme.headingFontFamily ?? theme.fontFamily ?? 'Georgia' : theme.bodyFontFamily ?? theme.fontFamily ?? 'Segoe UI',
        } });
      } else if (node.kind === 'shape') {
        const accent = accents[accentIndex++ % Math.max(1, accents.length)];
        operations.push({ type: 'style.update', nodeId: node.id, style: { fill: accent ?? '#315d4b', stroke: colors.accent1 ?? accent ?? '#315d4b' } });
      } else if (node.kind === 'table' && node.table) {
        const table: TableData = structuredClone(node.table);
        table.rows = table.rows.map((row, rowIndex) => ({ ...row, cells: row.cells.map(cell => ({ ...cell, style: {
          ...cell.style, ...(rowIndex < (table.headerRows ?? 0) ? { fill: colors.background2 ?? '#e8efe9' } : {}), color: colors.text1 ?? '#263d30',
          fontFamily: theme.bodyFontFamily ?? theme.fontFamily ?? 'Segoe UI',
        } })) }));
        operations.push({ type: 'table.update', nodeId: node.id, table });
      } else if (node.kind === 'chart' && node.chart) {
        const chart: ChartData = structuredClone(node.chart);
        chart.series = chart.series.map((series, index) => ({ ...series, color: accents[index % Math.max(1, accents.length)] ?? '#315d4b' }));
        operations.push({ type: 'chart.update', nodeId: node.id, chart });
      }
    }
    void submit(operations, `应用「${theme.name ?? '自定义'}」主题`, current.revision);
  }

  function commitGeometry(nodeId: string, key: keyof Geometry, value: number, baseRevision: number) {
    void submit([{ type: 'geometry.update', nodeId, geometry: { [key]: value } }], '修改属性', baseRevision);
  }

  function commitText(nodeId: string, value: string, baseRevision: number) {
    const node = documentRef.current.nodes[nodeId];
    if (!node?.content) return;
    void submit([{ type: 'text.apply', nodeId, steps: makeTextReplacementSteps(node.content, value) }], '编辑文字', baseRevision);
  }

  function commitRichText(documentId: string, nodeId: string, steps: unknown[], label: string, baseRevision: number) {
    if (documentRef.current.documentId !== documentId) return Promise.resolve(false);
    return submit([{ type: 'text.apply', nodeId, steps }], label, baseRevision);
  }

  function commitColor(color: string, baseRevision = documentRef.current.revision) {
    const ids = selectionRef.current.filter(id => documentRef.current.nodes[id] && documentRef.current.nodes[id]!.kind !== 'group');
    if (!ids.length) return;
    void submit(ids.map(nodeId => ({ type: 'style.update', nodeId, style: { fill: color } })), ids.length > 1 ? '修改多个图层颜色' : '修改填充颜色', baseRevision);
  }

  function commitImageSettings(nodeId: string, image: Partial<ImageSettings>, baseRevision: number) {
    void submit([{ type: 'image.update', nodeId, image }], '调整图片显示', baseRevision);
  }

  function commitTable(nodeId: string, table: TableData, baseRevision: number) {
    void submit([{ type: 'table.update', nodeId, table }], '编辑表格数据', baseRevision);
  }

  function commitChart(nodeId: string, chart: ChartData, baseRevision: number) {
    void submit([{ type: 'chart.update', nodeId, chart }], '编辑图表数据', baseRevision);
  }

  function reorderNode(node: DeckNode, direction: -1 | 1) {
    const siblings = childrenFor(documentRef.current, node.parentId);
    const index = siblings.indexOf(node.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return;
    void submit([{ type: 'node.reorder', nodeId: node.id, index: nextIndex }], direction < 0 ? '上移图层' : '下移图层');
  }

  function selectedRootIds(current: DeckDocument): string[] {
    const chosen = new Set(selectionRef.current.filter(id => current.nodes[id]));
    return [...chosen].filter(id => {
      let parent = current.nodes[id]?.parentId;
      while (parent && current.nodes[parent]) {
        if (chosen.has(parent)) return false;
        parent = current.nodes[parent]?.parentId;
      }
      return true;
    });
  }

  function copySelected() {
    const current = documentRef.current;
    const roots = selectedRootIds(current);
    if (!roots.length) return;
    const nodes: DeckNode[] = [];
    const visit = (id: string) => {
      const node = current.nodes[id];
      if (!node) return;
      nodes.push(structuredClone(node));
      for (const childId of node.children ?? []) visit(childId);
    };
    roots.forEach(visit);
    clipboardRef.current = { roots, nodes };
    setNotice(`${roots.length} 个图层已复制，可用 Ctrl+V 粘贴。`);
  }

  function pasteClipboard() {
    const current = documentRef.current;
    const clipboard = clipboardRef.current;
    if (!clipboard || busy) return;
    const rootSet = new Set(clipboard.roots);
    const idMap = new Map(clipboard.nodes.map(node => [node.id, `node-${globalThis.crypto.randomUUID()}`]));
    const pasteParent = editingGroupId && current.nodes[editingGroupId]?.kind === 'group' ? editingGroupId : undefined;
    const operations: DocumentOperation[] = [];
    for (const source of clipboard.nodes) {
      const id = idMap.get(source.id)!;
      const parentId = rootSet.has(source.id)
        ? pasteParent ?? (current.nodes[source.parentId]?.kind === 'group' || current.pages.some(candidate => candidate.id === source.parentId) ? source.parentId : activePageId)
        : idMap.get(source.parentId) ?? source.parentId;
      const copy: DeckNode = {
        ...structuredClone(source), id, parentId,
        geometry: { ...source.geometry, ...(rootSet.has(source.id) ? { x: source.geometry.x + 24, y: source.geometry.y + 24 } : {}) },
        ...(source.kind === 'group' ? { children: [] } : {}),
      };
      operations.push({ type: 'node.insert', node: copy });
    }
    const pastedRoots = clipboard.roots.map(id => idMap.get(id)!).filter(Boolean);
    void submit(operations, pastedRoots.length > 1 ? '粘贴多个图层' : '粘贴图层', current.revision).then(ok => { if (ok) setSelection(pastedRoots); });
  }

  function reorderSelection(direction: -1 | 1 | 'front' | 'back') {
    const current = documentRef.current;
    const ids = selectedRootIds(current);
    const nodes = ids.map(id => current.nodes[id]).filter((node): node is DeckNode => Boolean(node));
    if (nodes.length === 0 || nodes.some(node => isEffectivelyLocked(current, node.id)) || nodes.some(node => node.parentId !== nodes[0]!.parentId)) return;
    const parentId = nodes[0]!.parentId;
    const order = [...childrenFor(current, parentId)];
    const selected = new Set(ids);
    if (direction === 'front') {
      const next = [...order.filter(id => !selected.has(id)), ...order.filter(id => selected.has(id))];
      commitSiblingOrder(order, next, parentId);
      return;
    }
    if (direction === 'back') {
      const next = [...order.filter(id => selected.has(id)), ...order.filter(id => !selected.has(id))];
      commitSiblingOrder(order, next, parentId);
      return;
    }
    const indices = order.map((id, index) => selected.has(id) ? index : -1).filter(index => index >= 0);
    if (direction > 0) {
      for (const index of [...indices].reverse()) if (index < order.length - 1 && !selected.has(order[index + 1]!)) [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
    } else {
      for (const index of indices) if (index > 0 && !selected.has(order[index - 1]!)) [order[index], order[index - 1]] = [order[index - 1]!, order[index]!];
    }
    commitSiblingOrder(childrenFor(current, parentId), order, parentId);
  }

  function commitSiblingOrder(currentOrder: string[], desiredOrder: string[], parentId: string) {
    if (currentOrder.length !== desiredOrder.length || currentOrder.every((id, index) => desiredOrder[index] === id)) return;
    const working = [...currentOrder];
    const operations: DocumentOperation[] = [];
    desiredOrder.forEach((id, index) => {
      const currentIndex = working.indexOf(id);
      if (currentIndex === index) return;
      working.splice(currentIndex, 1); working.splice(index, 0, id);
      operations.push({ type: 'node.reorder', nodeId: id, index, parentId });
    });
    void submit(operations, '调整图层顺序', documentRef.current.revision);
  }

  function nudgeSelection(key: string, distance: number) {
    const current = documentRef.current;
    const nodes = selectionRef.current.map(id => current.nodes[id]).filter((node): node is DeckNode => Boolean(node));
    if (!nodes.length || nodes.some(node => isEffectivelyLocked(current, node.id))) return;
    const delta = key === 'ArrowLeft' ? { x: -distance } : key === 'ArrowRight' ? { x: distance } : key === 'ArrowUp' ? { y: -distance } : { y: distance };
    void submit(nodes.map(node => ({ type: 'geometry.update', nodeId: node.id, geometry: delta })), '微调位置', current.revision);
  }

  function cycleLayer(direction: -1 | 1) {
    const ids = pageLayers.filter(({ node }) => !isEffectivelyHidden(documentRef.current, node.id)).map(({ node }) => node.id);
    if (!ids.length) return;
    const currentIndex = ids.indexOf(selectionRef.current[0] ?? '');
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + ids.length) % ids.length;
    setSelection([ids[nextIndex]!]);
  }

  function arrangeSelection(kind: Alignment | 'distribute-x' | 'distribute-y') {
    const current = documentRef.current;
    const nodes = selectionRef.current.map(id => current.nodes[id]).filter((node): node is DeckNode => Boolean(node));
    if (nodes.some(node => isEffectivelyLocked(current, node.id))) return;
    const operations = kind === 'distribute-x' ? distributeNodes(nodes, 'x') : kind === 'distribute-y' ? distributeNodes(nodes, 'y') : alignNodes(nodes, kind);
    if (operations.length) void submit(operations, '排列图层', current.revision);
  }

  function scaleSelectedGroup() {
    const current = documentRef.current;
    const group = selectedNodes.length === 1 ? current.nodes[selectedIds[0]!] : undefined;
    const factor = Number(groupScale);
    if (!group || group.kind !== 'group' || !Number.isFinite(factor) || factor <= 0.05 || factor > 10 || isEffectivelyLocked(current, group.id)) return;
    const operations: DocumentOperation[] = [{ type: 'geometry.update', nodeId: group.id, geometry: { width: group.geometry.width * factor, height: group.geometry.height * factor } }];
    const visit = (nodeId: string) => {
      const node = current.nodes[nodeId];
      if (!node) return;
      const geometry = { x: node.geometry.x * factor, y: node.geometry.y * factor,
        width: node.geometry.width * factor, height: node.geometry.height * factor };
      operations.push({ type: 'geometry.update', nodeId, geometry });
      const style: DeckNode['style'] = {};
      for (const key of ['fontSize', 'strokeWidth', 'cornerRadius']) {
        const value = node.style[key];
        if (typeof value === 'number') style[key] = value * factor;
      }
      if (Object.keys(style).length) operations.push({ type: 'style.update', nodeId, style });
      if (node.content) {
        const scaled = scaleRichTextContent(node.content, factor);
        if (scaled.steps.length) operations.push({ type: 'text.apply', nodeId, steps: scaled.steps });
      }
      if (node.table) {
        const table: TableData = structuredClone(node.table);
        if (table.columnWidths) table.columnWidths = table.columnWidths.map(value => value * factor);
        if (typeof table.borderWidth === 'number') table.borderWidth *= factor;
        if (typeof table.cellPadding === 'number') table.cellPadding *= factor;
        table.rows = table.rows.map(row => ({ ...row, ...(typeof row.height === 'number' ? { height: row.height * factor } : {}), cells: row.cells.map(cell => ({
          ...cell, content: scaleRichTextContent(cell.content, factor).content,
          ...(cell.style?.fontSize ? { style: { ...cell.style, fontSize: cell.style.fontSize * factor } } : {}),
        })) }));
        operations.push({ type: 'table.update', nodeId, table });
      }
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of group.children ?? []) visit(child);
    void submit(operations, '等比缩放组及内部样式', current.revision);
  }

  function toggleFlag(node: DeckNode, flag: 'hidden' | 'locked') {
    void submit([{ type: 'node.flags.update', nodeId: node.id, flags: { [flag]: !node[flag] } }], flag === 'hidden' ? (node.hidden ? '显示图层' : '隐藏图层') : (node.locked ? '解锁图层' : '锁定图层'));
  }

  function groupSelected() {
    const current = documentRef.current;
    const ids = selectionRef.current.filter(id => current.nodes[id]);
    const nodes = ids.map(id => current.nodes[id]!);
    if (nodes.length < 2 || nodes.some(node => isEffectivelyLocked(current, node.id)) || nodes.some(node => node.parentId !== nodes[0]!.parentId)) return;
    const parentId = nodes[0]!.parentId;
    const xs = nodes.map(node => node.geometry.x); const ys = nodes.map(node => node.geometry.y);
    const rights = nodes.map(node => node.geometry.x + node.geometry.width); const bottoms = nodes.map(node => node.geometry.y + node.geometry.height);
    const x = Math.min(...xs); const y = Math.min(...ys);
    const width = Math.max(...rights) - x; const height = Math.max(...bottoms) - y;
    const siblings = childrenFor(current, parentId);
    const insertionIndex = Math.min(...nodes.map(node => siblings.indexOf(node.id)).filter(index => index >= 0));
    const group: DeckNode = { id: `group-${globalThis.crypto.randomUUID()}`, kind: 'group', parentId,
      geometry: { x, y, width: Math.max(width, 1), height: Math.max(height, 1), rotation: 0 },
      style: { name: '圖層組' }, locked: false, hidden: false, children: [] };
    const operations: DocumentOperation[] = [
      { type: 'node.insert', node: group, index: insertionIndex },
      ...nodes.map(node => ({ type: 'node.reparent', nodeId: node.id, parentId: group.id } as DocumentOperation)),
    ];
    void submit(operations, '编组图层', current.revision).then(ok => { if (ok) setSelection([group.id]); });
  }

  function ungroupSelected() {
    const current = documentRef.current;
    const group = selectedNodes.length === 1 ? current.nodes[selectedIds[0]!] : undefined;
    if (!group || group.kind !== 'group' || isEffectivelyLocked(current, group.id)) return;
    const siblings = childrenFor(current, group.parentId);
    const groupIndex = siblings.indexOf(group.id);
    const operations: DocumentOperation[] = [
      ...(group.children ?? []).map((nodeId, index) => ({ type: 'node.reparent', nodeId, parentId: group.parentId, index: Math.max(groupIndex, 0) + index } as DocumentOperation)),
      { type: 'node.remove', nodeId: group.id },
    ];
    void submit(operations, '取消编组', current.revision).then(ok => { if (ok) setSelection([...(group.children ?? [])]); });
  }

  function duplicateSelected() {
    const current = documentRef.current;
    const ids = selectionRef.current.filter(id => current.nodes[id]);
    const roots = ids.map(id => current.nodes[id]!).filter(node => !ids.some(otherId => current.nodes[otherId]?.children?.includes(node.id)));
    if (!roots.length || roots.some(node => isEffectivelyLocked(current, node.id))) return;
    const operations: DocumentOperation[] = [];
    const duplicateRoots: string[] = [];
    const copySubtree = (sourceId: string, newParentId: string, topLevel: boolean): string => {
      const source = current.nodes[sourceId]!;
      const id = `node-${globalThis.crypto.randomUUID()}`;
      const copy: DeckNode = { ...structuredClone(source), id, parentId: newParentId,
        geometry: { ...source.geometry, ...(topLevel ? { x: source.geometry.x + 24, y: source.geometry.y + 24 } : {}) },
        ...(source.kind === 'group' ? { children: [] } : {}) };
      operations.push({ type: 'node.insert', node: copy });
      for (const childId of source.children ?? []) copySubtree(childId, id, false);
      return id;
    };
    for (const source of roots) duplicateRoots.push(copySubtree(source.id, source.parentId, true));
    void submit(operations, roots.length > 1 ? '复制多个图层' : '复制图层', current.revision).then(ok => { if (ok) setSelection(duplicateRoots); });
  }

  function zoomAt(factor: number, pointer?: ViewPoint) {
    if (!page) return;
    const margin = 54;
    const baseScale = Math.max(0.05, Math.min((canvasSize.width - margin * 2) / page.width, (canvasSize.height - margin * 2) / page.height, 1));
    const centerX = (canvasSize.width - page.width * baseScale) / 2;
    const centerY = (canvasSize.height - page.height * baseScale) / 2;
    const nextZoom = clamp(zoomRef.current * factor, 0.18, 4);
    const cursor = pointer ?? { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const currentScale = baseScale * zoomRef.current;
    const currentOffset = panRef.current;
    const pagePoint = { x: (cursor.x - centerX - currentOffset.x) / currentScale, y: (cursor.y - centerY - currentOffset.y) / currentScale };
    const nextOffset = { x: cursor.x - centerX - pagePoint.x * baseScale * nextZoom, y: cursor.y - centerY - pagePoint.y * baseScale * nextZoom };
    zoomRef.current = nextZoom; panRef.current = nextOffset;
    setZoom(nextZoom); setPan(nextOffset);
  }

  const fitMargin = 54;
  const fitScale = page ? Math.max(0.05, Math.min((canvasSize.width - fitMargin * 2) / page.width, (canvasSize.height - fitMargin * 2) / page.height, 1)) : 1;
  const stageScale = fitScale * zoom;
  const stageX = page ? (canvasSize.width - page.width * fitScale) / 2 + pan.x : 0;
  const stageY = page ? (canvasSize.height - page.height * fitScale) / 2 + pan.y : 0;
  const selectedFill = selectedNodes[0]?.style.fill;
  const hasMixedFill = selectedNodes.some(node => node.style.fill !== selectedFill);
  const singleNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const isGroupTransform = selectedNodes.some(node => node.kind === 'group');

  function nodeInteractionProps(node: DeckNode) {
    const locked = isEffectivelyLocked(document, node.id);
    const editable = !busy && !locked && !(node.kind === 'group' && editingGroupId === node.id);
    return {
      id: node.id,
      draggable: editable,
      onMouseDown: (event: { evt: MouseEvent; cancelBubble: boolean }) => {
        event.cancelBubble = true;
        chooseNode(node.id, event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey);
      },
      onClick: (event: { cancelBubble: boolean }) => { event.cancelBubble = true; },
      onDblClick: () => {
        if (node.kind === 'group') { setEditingGroupId(node.id); setSelection([]); return; }
        chooseNode(node.id, false); if (node.kind === 'text') setFocusTextId(node.id);
      },
      onDragStart: () => beginGesture('drag', node.id),
      onDragMove: (event: { target: KonvaNode }) => moveGesture(node.id, event.target),
      onDragEnd: () => { void finishGesture(); },
    };
  }

  function renderImageNode(node: DeckNode, interaction: ReturnType<typeof nodeInteractionProps>): ReactNode {
    const geometry = node.geometry;
    const image = node.assetId ? imageElements.get(node.assetId) : undefined;
    const settings = node.image;
    if (!image || !image.naturalWidth || !image.naturalHeight) {
      return <Group key={node.id} ref={shape => { if (shape) nodeRefs.current.set(node.id, shape); else nodeRefs.current.delete(node.id); }}
        {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>
        <Rect width={geometry.width} height={geometry.height} fill="#f3f5f1" stroke="#9eaea3" strokeWidth={1} dash={[5, 4]} />
        <Text width={geometry.width} height={geometry.height} text={node.assetId ? '载入图片…' : '尚未指定图片'} align="center" verticalAlign="middle" fill="#718078" fontSize={13} lineHeight={1.4} listening={false} />
      </Group>;
    }
    const crop = settings?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
    let sourceX = clamp(crop.left, 0, 0.95) * image.naturalWidth;
    let sourceY = clamp(crop.top, 0, 0.95) * image.naturalHeight;
    let sourceWidth = Math.max(1, image.naturalWidth * (1 - clamp(crop.left, 0, 0.95) - clamp(crop.right, 0, 0.95)));
    let sourceHeight = Math.max(1, image.naturalHeight * (1 - clamp(crop.top, 0, 0.95) - clamp(crop.bottom, 0, 0.95)));
    const fit = settings?.fit ?? 'contain';
    let drawX = 0; let drawY = 0; let drawWidth = geometry.width; let drawHeight = geometry.height;
    if (fit === 'cover') {
      const targetRatio = geometry.width / geometry.height;
      const sourceRatio = sourceWidth / sourceHeight;
      if (sourceRatio > targetRatio) {
        const nextWidth = sourceHeight * targetRatio;
        sourceX += (sourceWidth - nextWidth) / 2; sourceWidth = nextWidth;
      } else {
        const nextHeight = sourceWidth / targetRatio;
        sourceY += (sourceHeight - nextHeight) / 2; sourceHeight = nextHeight;
      }
    } else if (fit === 'contain') {
      const ratio = sourceWidth / sourceHeight;
      if (ratio > geometry.width / geometry.height) {
        drawHeight = geometry.width / ratio; drawY = (geometry.height - drawHeight) / 2;
      } else {
        drawWidth = geometry.height * ratio; drawX = (geometry.width - drawWidth) / 2;
      }
    }
    return <Group key={node.id} ref={shape => { if (shape) nodeRefs.current.set(node.id, shape); else nodeRefs.current.delete(node.id); }}
      {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>
      <Rect width={geometry.width} height={geometry.height} fill="rgba(0,0,0,0)" stroke="transparent" listening={false} />
      <KonvaImage image={image} x={drawX} y={drawY} width={drawWidth} height={drawHeight}
        crop={{ x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight }} opacity={settings?.opacity ?? 1} />
      {selectedIds.includes(node.id) && <Rect width={geometry.width} height={geometry.height} fill="rgba(0,0,0,0)" stroke="#43876b" strokeWidth={1} listening={false} />}
    </Group>;
  }

  function renderTableNode(node: DeckNode, interaction: ReturnType<typeof nodeInteractionProps>): ReactNode {
    const geometry = node.geometry;
    const table = node.table;
    if (!table?.rows.length) return <Group key={node.id} {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>
      <Rect width={geometry.width} height={geometry.height} fill="#fff" stroke="#a8b6aa" dash={[4, 3]} /><Text text="空表格" x={10} y={10} fill="#728178" />
    </Group>;
    const columnCount = Math.max(1, ...table.rows.map(row => row.cells.length));
    const rawWidths = Array.from({ length: columnCount }, (_, index) => Math.max(1, table.columnWidths?.[index] ?? geometry.width / columnCount));
    const widthTotal = rawWidths.reduce((sum, value) => sum + value, 0);
    const widths = rawWidths.map(value => value * geometry.width / widthTotal);
    const rawHeights = table.rows.map(row => Math.max(1, row.height ?? geometry.height / table.rows.length));
    const heightTotal = rawHeights.reduce((sum, value) => sum + value, 0);
    const heights = rawHeights.map(value => value * geometry.height / heightTotal);
    let y = 0;
    const cells: ReactNode[] = [];
    table.rows.forEach((row, rowIndex) => {
      let x = 0;
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const cell = row.cells[columnIndex];
        const width = widths[columnIndex]!; const height = heights[rowIndex]!;
        const fillColor = cell?.style?.fill ?? (rowIndex < (table.headerRows ?? 0) ? asString(document.theme?.colors?.background2, '#e8efe9') : '#ffffff');
        cells.push(<Group key={cell?.id ?? `${row.id}-${columnIndex}`}>
          <Rect x={x} y={y} width={width} height={height} fill={fillColor} stroke={table.borderColor ?? '#d9e2da'} strokeWidth={table.borderWidth ?? 1} />
          {cell && <Text x={x + (table.cellPadding ?? 8)} y={y + 2} width={Math.max(1, width - 2 * (table.cellPadding ?? 8))} height={Math.max(1, height - 4)}
            text={textToString(cell.content)} fill={cell.style?.color ?? asString(document.theme?.colors?.text1, '#35473b')}
            fontFamily={cell.style?.fontFamily ?? asString(document.theme?.bodyFontFamily, 'Segoe UI')} fontSize={cell.style?.fontSize ?? 13}
            align={cell.style?.align ?? 'left'} verticalAlign="middle" wrap="word" listening={false} />}
        </Group>);
        x += width;
      }
      y += heights[rowIndex]!;
    });
    return <Group key={node.id} ref={shape => { if (shape) nodeRefs.current.set(node.id, shape); else nodeRefs.current.delete(node.id); }}
      {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>{cells}</Group>;
  }

  function renderChartNode(node: DeckNode, interaction: ReturnType<typeof nodeInteractionProps>): ReactNode {
    const geometry = node.geometry;
    const chart = node.chart;
    if (!chart) return <Group key={node.id} {...interaction} x={geometry.x} y={geometry.y}><Rect width={geometry.width} height={geometry.height} fill="#fff" stroke="#a8b6aa" dash={[4, 3]} /><Text text="图表数据缺失" x={10} y={10} fill="#728178" /></Group>;
    const width = geometry.width; const height = geometry.height;
    const title = chart.title ?? '';
    const series = chart.series;
    const palette = ['#315d4b', '#c07e4d', '#6e87a1', '#9cae79', '#855f71', '#d1a866'];
    const plotX = 37; const plotY = title ? 35 : 18; const plotWidth = Math.max(50, width - 52);
    const legendHeight = chart.legend === false ? 0 : 24;
    const plotHeight = Math.max(45, height - plotY - 43 - legendHeight);
    const values = series.flatMap(item => item.values).filter(Number.isFinite);
    const minValue = Math.min(0, ...values); const maxValue = Math.max(1, ...values);
    const yFor = (value: number) => plotY + (maxValue - value) / Math.max(1, maxValue - minValue) * plotHeight;
    const elements: ReactNode[] = [<Rect key="background" width={width} height={height} fill={asString(node.style.fill, '#ffffff')} stroke="#dce5de" strokeWidth={1} />];
    if (title) elements.push(<Text key="title" x={14} y={10} width={width - 28} text={title} fontSize={15} fontStyle="bold" fill={asString(node.style.textColor, '#304238')} listening={false} />);

    if (chart.type === 'pie') {
      const values = (series[0]?.values ?? []).map(value => Math.max(0, value));
      const total = values.reduce((sum, value) => sum + value, 0) || 1;
      const radius = Math.max(20, Math.min(plotWidth * 0.28, plotHeight * 0.43));
      let rotation = -90;
      values.forEach((value, index) => {
        const angle = value / total * 360;
        const color = series[0]?.color ?? palette[index % palette.length]!;
        elements.push(<Arc key={`slice-${index}`} x={width / 2} y={plotY + plotHeight / 2} innerRadius={0} outerRadius={radius}
          angle={angle} rotation={rotation} fill={color} stroke="#fff" strokeWidth={1} />);
        if (chart.dataLabels && chart.categories[index]) {
          const mid = (rotation + angle / 2) * Math.PI / 180;
          const labelX = width / 2 + Math.cos(mid) * radius * 0.62 - 27;
          const labelY = plotY + plotHeight / 2 + Math.sin(mid) * radius * 0.62 - 6;
          elements.push(<Text key={`slice-label-${index}`} x={labelX} y={labelY} width={54} text={`${Math.round(value / total * 100)}%`} align="center" fontSize={10} fill="#fff" listening={false} />);
        }
        rotation += angle;
      });
    } else {
      for (let lineIndex = 1; lineIndex <= 3; lineIndex++) {
        const y = plotY + plotHeight * lineIndex / 4;
        elements.push(<Line key={`grid-${lineIndex}`} points={[plotX, y, plotX + plotWidth, y]} stroke="#e8ede8" strokeWidth={1} listening={false} />);
      }
      const zeroY = yFor(0);
      elements.push(<Line key="axis-x" points={[plotX, zeroY, plotX + plotWidth, zeroY]} stroke="#aab6ad" strokeWidth={1} listening={false} />);
      const categoryCount = Math.max(1, chart.categories.length);
      const step = plotWidth / categoryCount;
      if (chart.type === 'bar') {
        chart.categories.forEach((category, categoryIndex) => {
          const groupWidth = step * 0.74;
          const barWidth = Math.max(5, Math.min(34, groupWidth / Math.max(1, series.length)));
          series.forEach((item, seriesIndex) => {
            const value = item.values[categoryIndex] ?? 0;
            const y = yFor(value); const base = yFor(0);
            const x = plotX + step * categoryIndex + (step - groupWidth) / 2 + barWidth * seriesIndex;
            elements.push(<Rect key={`bar-${item.id}-${categoryIndex}`} x={x} y={Math.min(y, base)} width={barWidth - 2} height={Math.max(1, Math.abs(base - y))}
              fill={item.color ?? palette[seriesIndex % palette.length]!} cornerRadius={2} />);
            if (chart.dataLabels) elements.push(<Text key={`value-${item.id}-${categoryIndex}`} x={x - 6} y={value >= 0 ? y - 15 : y + 2} width={barWidth + 10} text={String(value)} align="center" fontSize={9} fill="#596b60" listening={false} />);
          });
          elements.push(<Text key={`category-${categoryIndex}`} x={plotX + step * categoryIndex} y={plotY + plotHeight + 7} width={step} text={category} align="center" fontSize={9} fill="#728178" listening={false} />);
        });
      } else {
        series.forEach((item, seriesIndex) => {
          const points = chart.categories.map((_, categoryIndex) => [plotX + step * (categoryIndex + 0.5), yFor(item.values[categoryIndex] ?? 0)]).flat();
          if (points.length >= 4) elements.push(<Line key={`series-${item.id}`} points={points} stroke={item.color ?? palette[seriesIndex % palette.length]!} strokeWidth={2} lineCap="round" lineJoin="round" />);
          chart.categories.forEach((category, categoryIndex) => {
            const x = plotX + step * (categoryIndex + 0.5); const y = yFor(item.values[categoryIndex] ?? 0);
            elements.push(<Circle key={`point-${item.id}-${categoryIndex}`} x={x} y={y} radius={3.5} fill={item.color ?? palette[seriesIndex % palette.length]!} />);
            if (chart.dataLabels) elements.push(<Text key={`value-${item.id}-${categoryIndex}`} x={x - 20} y={y - 17} width={40} text={String(item.values[categoryIndex] ?? 0)} align="center" fontSize={9} fill="#596b60" listening={false} />);
          });
        });
        chart.categories.forEach((category, categoryIndex) => elements.push(<Text key={`category-${categoryIndex}`} x={plotX + step * categoryIndex} y={plotY + plotHeight + 7} width={step} text={category} align="center" fontSize={9} fill="#728178" listening={false} />));
      }
    }
    if (chart.legend !== false) {
      let x = 14; const y = height - 16;
      for (const [index, item] of series.entries()) {
        elements.push(<Rect key={`legend-color-${item.id}`} x={x} y={y + 2} width={8} height={8} fill={item.color ?? palette[index % palette.length]!} cornerRadius={2} listening={false} />);
        elements.push(<Text key={`legend-label-${item.id}`} x={x + 12} y={y - 1} text={item.name} fontSize={9} fill="#64746a" listening={false} />);
        x += 20 + item.name.length * 7;
      }
    }
    return <Group key={node.id} ref={shape => { if (shape) nodeRefs.current.set(node.id, shape); else nodeRefs.current.delete(node.id); }}
      {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>{elements}</Group>;
  }

  function renderNode(id: string): ReactNode {
    const node = document.nodes[id];
    if (!node || node.hidden) return null;
    const geometry = node.geometry;
    const interaction = nodeInteractionProps(node);
    const fill = asString(node.style.fill, node.kind === 'text' ? '#244b3a' : '#dce9df');
    const stroke = asString(node.style.stroke, 'transparent');
    const strokeWidth = asNumber(node.style.strokeWidth, 0);
    if (node.kind === 'group') {
      return <Group key={id} ref={shape => { if (shape) nodeRefs.current.set(id, shape); else nodeRefs.current.delete(id); }}
        {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>
        <Rect x={0} y={0} width={geometry.width} height={geometry.height} fill="rgba(0,0,0,0)"
          stroke={selectedIds.includes(id) ? '#3d8063' : '#b3c4b8'} strokeWidth={1} dash={[5, 5]} listening={false} />
        {(node.children ?? []).map(child => renderNode(child))}
      </Group>;
    }
    if (node.kind === 'text') {
      return <Text key={id} ref={shape => { if (shape) nodeRefs.current.set(id, shape); else nodeRefs.current.delete(id); }}
        {...interaction} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} rotation={geometry.rotation}
        text={node.content ? textToString(node.content) : ''} fill={textMatrices.has(id) ? 'rgba(0,0,0,0)' : fill} fontSize={asNumber(node.style.fontSize, 24)}
        fontFamily={asString(node.style.fontFamily, 'Segoe UI')} fontStyle={node.style.fontWeight === 'bold' ? 'bold' : 'normal'}
        align={asString(node.style.textAlign, 'left') as 'left' | 'center' | 'right'} verticalAlign="top" lineHeight={1.18}
        wrap="word" ellipsis={false} padding={0} />;
    }
    if (node.kind === 'image') return renderImageNode(node, interaction);
    if (node.kind === 'table') return renderTableNode(node, interaction);
    if (node.kind === 'chart') return renderChartNode(node, interaction);
    return <Rect key={id} ref={shape => { if (shape) nodeRefs.current.set(id, shape); else nodeRefs.current.delete(id); }}
      {...interaction} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} rotation={geometry.rotation}
      fill={fill} stroke={stroke} strokeWidth={strokeWidth} cornerRadius={asNumber(node.style.cornerRadius, 0)} />;
  }

  return <main className={`deck-editor${spaceDown ? ' is-panning' : ''}`} aria-label="Deck 编辑器">
    <aside className="editor-sidebar editor-left" aria-label="页面与图层">
      <section className="editor-sidebar-section editor-pages-section">
        <div className="editor-section-heading"><span>页面</span><button type="button" aria-label="新增页面" title="新增页面" disabled={busy} onClick={addPage}>＋</button></div>
        <div className="editor-page-list">
          {document.pages.map((candidate, index) => <button key={candidate.id} type="button"
            className={`editor-page-item${candidate.id === page?.id ? ' is-active' : ''}`} disabled={busy}
            aria-label={`选择页面 ${candidate.name}`} onClick={() => { setActivePageId(candidate.id); setEditingGroupId(''); setSelection([]); resetView(); }}>
            <span className="editor-page-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="editor-page-name">{candidate.name}</span>
            <span className="editor-page-dimensions">{candidate.width} × {candidate.height}</span>
          </button>)}
        </div>
      </section>
      <section className="editor-sidebar-section editor-layers-section">
        <div className="editor-section-heading"><span>图层</span><span className="editor-count">{pageLayers.length}</span></div>
        {editingGroupId && document.nodes[editingGroupId] && <div className="editor-layer-editing-group"><span>组内：{labelFor(document.nodes[editingGroupId]!)}</span><button type="button" onClick={() => { const group = documentRef.current.nodes[editingGroupId]; const parent = group ? documentRef.current.nodes[group.parentId] : undefined; setEditingGroupId(parent?.kind === 'group' ? parent.id : ''); setSelection([]); }}>返回上级</button></div>}
        {!pageLayers.length ? <p className="editor-muted-note">添加对象后，会在这里显示页面结构。</p> : <div className="editor-layer-list">
          {pageLayers.map(({ node, depth }) => {
            const locked = node.locked;
            const inheritedLocked = isEffectivelyLocked(document, node.id) && !locked;
            return <div key={node.id} className={`editor-layer-row${selectedIds.includes(node.id) ? ' is-selected' : ''}${isEffectivelyHidden(document, node.id) ? ' is-hidden' : ''}`} style={{ '--depth': depth } as CSSProperties}>
              <button type="button" className="editor-layer-select" aria-pressed={selectedIds.includes(node.id)} title={`选择 ${labelFor(node)}`}
                onClick={event => chooseNode(node.id, event.shiftKey || event.ctrlKey || event.metaKey)} disabled={busy}>
                <span className={`editor-layer-kind kind-${node.kind}`}>{node.kind === 'text' ? 'T' : node.kind === 'group' ? '▦' : node.kind === 'image' ? '▧' : node.kind === 'table' ? '▤' : node.kind === 'chart' ? '▥' : '□'}</span>
                <span className="editor-layer-name">{labelFor(node)}</span>
              </button>
              <button type="button" className="editor-layer-action" aria-label={`${node.hidden ? '显示' : '隐藏'} ${labelFor(node)}`} title={node.hidden ? '显示图层' : '隐藏图层'} disabled={busy || isEffectivelyLocked(document, node.id)} onClick={() => toggleFlag(node, 'hidden')}>
                {node.hidden ? '◌' : '◉'}
              </button>
              <button type="button" className="editor-layer-action" aria-label={`${locked ? '解锁' : '锁定'} ${labelFor(node)}`} title={inheritedLocked ? '由上级图层锁定' : locked ? '解锁图层' : '锁定图层'} disabled={busy || inheritedLocked} onClick={() => toggleFlag(node, 'locked')}>
                {locked || inheritedLocked ? '▣' : '⌑'}
              </button>
              <span className="editor-layer-order">
                <button type="button" aria-label={`上移图层 ${labelFor(node)}`} title="上移图层" disabled={busy || isEffectivelyLocked(document, node.id) || childrenFor(document, node.parentId).at(-1) === node.id} onClick={() => reorderNode(node, 1)}>↑</button>
                <button type="button" aria-label={`下移图层 ${labelFor(node)}`} title="下移图层" disabled={busy || isEffectivelyLocked(document, node.id) || childrenFor(document, node.parentId)[0] === node.id} onClick={() => reorderNode(node, -1)}>↓</button>
              </span>
            </div>;
          })}
        </div>}
      </section>
      <div className="editor-left-footnote"><span className="editor-footnote-dot" /> 点击选择 · Shift 多选</div>
    </aside>

    <section className="editor-center" aria-label="画布工作区">
      <div className="editor-toolbar" role="toolbar" aria-label="编辑工具">
        <div className="editor-tool-group">
          <button type="button" className="editor-tool-button" aria-label="增加文字" title="增加文字" disabled={busy || !page} onClick={addText}><b>T</b><span>文字</span></button>
          <button type="button" className="editor-tool-button" aria-label="增加形状" title="增加形状" disabled={busy || !page} onClick={addShape}><span className="tool-shape-icon"/><span>形状</span></button>
          <details className="editor-arrange-menu">
            <summary className="editor-toolbar-toggle" aria-label="插入其他对象" title="插入其他对象">插入⌄</summary>
            <div className="editor-arrange-popover">
              <button type="button" disabled={busy || !page || !onImportAsset} onClick={() => openImagePicker()}>添加图片</button>
              <button type="button" disabled={busy || !page} onClick={addTable}>添加表格</button>
              <button type="button" disabled={busy || !page} onClick={addChart}>添加图表</button>
            </div>
          </details>
          <details className="editor-arrange-menu">
            <summary className="editor-toolbar-toggle" aria-label="选择主题" title="选择主题">主题⌄</summary>
            <div className="editor-arrange-popover editor-theme-popover">
              {THEME_PRESETS.map(({ name, theme }) => <button key={name} type="button" disabled={busy} onClick={event => { applyTheme(theme); const details = event.currentTarget.closest('details'); if (details) details.open = false; }}>
                <span className="editor-theme-dots">{['accent1', 'accent2', 'accent3'].map(key => <i key={key} style={{ background: theme.colors?.[key as keyof NonNullable<DeckTheme['colors']>] }} />)}</span>{name}
              </button>)}
            </div>
          </details>
          <span className="editor-toolbar-divider" />
          <button type="button" className="editor-icon-button" aria-label="撤销" title="撤销 · Ctrl Z" disabled={busy} onClick={onUndo}>↶</button>
          <button type="button" className="editor-icon-button" aria-label="重做" title="重做 · Ctrl Shift Z" disabled={busy} onClick={onRedo}>↷</button>
          <span className="editor-toolbar-divider" />
          <button type="button" className="editor-icon-button" aria-label="复制图层" title="复制图层" disabled={busy || !selectedNodes.length} onClick={duplicateSelected}>⧉</button>
          {selectedNodes.length > 1 && <button type="button" className="editor-icon-button" aria-label="编组图层" title="编组" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={groupSelected}>▦</button>}
          {selectedNodes.length === 1 && selectedNodes[0]?.kind === 'group' && <button type="button" className="editor-icon-button" aria-label="取消编组" title="取消编组" disabled={busy || isEffectivelyLocked(document, selectedNodes[0].id)} onClick={ungroupSelected}>▤</button>}
          <button type="button" className="editor-icon-button editor-delete-tool" aria-label="删除所选" title="删除所选 · Delete" disabled={busy || !selectedNodes.length || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={() => { void removeSelected(); }}>⌫</button>
          {selectedNodes.length > 1 && <details className="editor-arrange-menu">
            <summary className="editor-toolbar-toggle" aria-label="排列所选" title="排列所选">排列⌄</summary>
            <div className="editor-arrange-popover">
              <button type="button" disabled={busy} onClick={() => arrangeSelection('left')}>左对齐</button>
              <button type="button" disabled={busy} onClick={() => arrangeSelection('center-x')}>水平居中</button>
              <button type="button" disabled={busy} onClick={() => arrangeSelection('right')}>右对齐</button>
              <button type="button" disabled={busy} onClick={() => arrangeSelection('top')}>顶端对齐</button>
              <button type="button" disabled={busy} onClick={() => arrangeSelection('center-y')}>垂直居中</button>
              <button type="button" disabled={busy} onClick={() => arrangeSelection('bottom')}>底端对齐</button>
              <button type="button" disabled={busy || selectedNodes.length < 3} onClick={() => arrangeSelection('distribute-x')}>水平分布</button>
              <button type="button" disabled={busy || selectedNodes.length < 3} onClick={() => arrangeSelection('distribute-y')}>垂直分布</button>
            </div>
          </details>}
          <button type="button" className={`editor-toolbar-toggle${snapGrid ? ' is-active' : ''}`} aria-label="网格吸附" aria-pressed={snapGrid} title="网格吸附" onClick={() => setSnapGrid(value => !value)}>网格</button>
          <button type="button" className={`editor-toolbar-toggle${snapObjects ? ' is-active' : ''}`} aria-label="对象吸附" aria-pressed={snapObjects} title="对象吸附" onClick={() => setSnapObjects(value => !value)}>对象</button>
          <button type="button" className={`editor-toolbar-toggle${showGuides ? ' is-active' : ''}`} aria-label="显示参考线" aria-pressed={showGuides} title="显示参考线" onClick={() => setShowGuides(value => !value)}>参考线</button>
        </div>
        <div className="editor-tool-group editor-zoom-tools">
          <button type="button" className="editor-icon-button" aria-label="缩小画布" title="缩小画布" onClick={() => zoomAt(1 / 1.2)} disabled={!page}>−</button>
          <span className="editor-zoom-value">{Math.round(zoom * 100)}%</span>
          <button type="button" className="editor-icon-button" aria-label="放大画布" title="放大画布" onClick={() => zoomAt(1.2)} disabled={!page}>＋</button>
          <button type="button" className="editor-fit-button" aria-label="适应页面" title="适应页面" onClick={resetView}>适应</button>
        </div>
      </div>

      <input ref={assetInputRef} className="editor-hidden-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择图片文件" onChange={event => { void importImage(event); }} />
      <div ref={canvasRef} className="editor-canvas-wrap" onWheel={event => {
        if (!page) return;
        event.preventDefault();
        const bounds = canvasRef.current?.getBoundingClientRect();
        if (!bounds) return;
        zoomAt(Math.exp(-event.deltaY * 0.0012), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      }}>
        {page && <Stage ref={stageRef} width={canvasSize.width} height={canvasSize.height} x={stageX} y={stageY} scaleX={stageScale} scaleY={stageScale}
          onMouseMove={updateMarquee} onMouseUp={finishMarquee} onTouchMove={updateMarquee} onTouchEnd={finishMarquee}
          draggable={spaceDown} onDragEnd={event => {
            if (!spaceDownRef.current) return;
            const baseX = (canvasSize.width - page.width * fitScale) / 2; const baseY = (canvasSize.height - page.height * fitScale) / 2;
            const next = { x: event.target.x() - baseX, y: event.target.y() - baseY };
            panRef.current = next; setPan(next);
          }}
          onWheel={event => { event.evt.preventDefault(); }}
          onMouseDown={event => { if (event.target === event.target.getStage()) startMarquee(event.evt.shiftKey); }}>
          <Layer key={canvasEpoch}>
            <Rect x={0} y={0} width={page.width} height={page.height} fill={document.theme?.colors?.background1 ?? '#fff'} shadowColor="#183327" shadowBlur={22} shadowOpacity={0.14} shadowOffset={{ x: 0, y: 8 }}
              onMouseDown={event => { event.cancelBubble = true; startMarquee(event.evt.shiftKey); }} />
            {activePageChildren.map(id => renderNode(id))}
          </Layer>
          <Layer>
            {showGuides && snapGuides.map((guide, index) => <Line key={`guide-${index}`} points={guide.axis === 'x' ? [guide.position, guide.from, guide.position, guide.to] : [guide.from, guide.position, guide.to, guide.position]}
              stroke="#4d9d76" strokeWidth={1 / stageScale} dash={[4 / stageScale, 3 / stageScale]} listening={false} />)}
            {selectionBox && <Rect x={selectionBox.x} y={selectionBox.y} width={selectionBox.width} height={selectionBox.height}
              fill="rgba(71, 139, 102, 0.12)" stroke="#4c936c" strokeWidth={1 / stageScale} dash={[4 / stageScale, 3 / stageScale]} listening={false} />}
            <Transformer ref={transformerRef} rotateEnabled resizeEnabled enabledAnchors={isGroupTransform ? [] : undefined} flipEnabled={false}
              keepRatio={false} shiftBehavior="keepRatio" rotationSnaps={[0, 45, 90, 135, 180, -45, -90, -135]} rotationSnapTolerance={4}
              borderStroke="#43876b" borderStrokeWidth={1} borderDash={[4, 3]} anchorFill="#ffffff" anchorStroke="#43876b" anchorStrokeWidth={1.2} anchorSize={8}
              boundBoxFunc={(oldBox, newBox) => newBox.width < 12 || newBox.height < 12 ? oldBox : newBox}
              onTransformStart={() => beginGesture('transform')}
              onTransform={refreshTextMatrices}
              onTransformEnd={() => { void finishGesture(); }} />
          </Layer>
        </Stage>}
        <div className="editor-rich-preview-layer" aria-hidden="true">
          {pageLayers.map(({ node }) => node.kind === 'text' && textMatrices.has(node.id)
            ? <RichTextPreview key={node.id} node={node} matrix={textMatrices.get(node.id)!} /> : null)}
        </div>
        {page && activePageChildren.length === 0 && <div className="editor-empty-card">
          <span className="editor-empty-mark">o.</span>
          <div className="editor-empty-kicker">从一张空白页开始</div>
          <h2>先放下一个想法。</h2>
          <p>添加文字和形状，或用一张可继续编辑的封面作为起点。</p>
          <div className="editor-empty-actions"><button type="button" className="editor-primary-button" disabled={busy} onClick={addCover}>插入示例封面 <span>↗</span></button>
            <button type="button" className="editor-secondary-button" disabled={busy} onClick={addText}>添加文字</button></div>
        </div>}
        {notice && <div className="editor-toast" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        <div className="editor-canvas-hint">滚轮缩放 <span>·</span> 按住 Space 拖动画布</div>
      </div>
    </section>

    <aside className="editor-sidebar editor-right" aria-label="属性面板">
      <div className="editor-inspector-heading"><span>属性</span>{selectedNodes.length > 1 && <span className="editor-selection-count">{selectedNodes.length} 已选</span>}</div>
      {!selectedNodes.length ? <div className="editor-inspector-empty"><span className="editor-inspector-empty-icon">＋</span><strong>选择一个对象</strong><p>在画布或图层列表中选择对象，就能调整它的位置、尺寸和样式。</p><div className="editor-page-meta"><span>当前页面</span><strong>{page?.name ?? '—'}</strong><small>{page ? `${page.width} × ${page.height} px` : ''}</small></div></div> : <>
        <div className="editor-selection-title"><span className={`editor-selection-kind kind-${selectedNodes[0]!.kind}`}>{selectedNodes[0]!.kind === 'text' ? 'T' : selectedNodes[0]!.kind === 'group' ? '▦' : selectedNodes[0]!.kind === 'image' ? '▧' : selectedNodes[0]!.kind === 'table' ? '▤' : selectedNodes[0]!.kind === 'chart' ? '▥' : '□'}</span>
          <div><strong>{selectedNodes.length === 1 ? labelFor(selectedNodes[0]!) : `${selectedNodes.length} 个对象`}</strong><small>{selectedNodes.length === 1 ? selectedNodes[0]!.kind === 'text' ? '文字对象' : selectedNodes[0]!.kind === 'group' ? '图层组' : selectedNodes[0]!.kind === 'image' ? '图片对象' : selectedNodes[0]!.kind === 'table' ? '可编辑数据表格' : selectedNodes[0]!.kind === 'chart' ? '可编辑数据图表' : '形状对象' : '同一父级的多选'}</small></div></div>
        <div className="editor-inspector-block">
          <div className="editor-property-heading">位置与尺寸 <span>px</span></div>
          {singleNode && <div className="editor-number-grid">
            <NumberField label="属性 X" value={singleNode.geometry.x} revision={document.revision} disabled={busy} onCommit={(value, revision) => commitGeometry(singleNode.id, 'x', value, revision)} />
            <NumberField label="属性 Y" value={singleNode.geometry.y} revision={document.revision} disabled={busy} onCommit={(value, revision) => commitGeometry(singleNode.id, 'y', value, revision)} />
            <NumberField label="属性 宽度" value={singleNode.geometry.width} revision={document.revision} min={8} disabled={busy || singleNode.kind === 'group'} onCommit={(value, revision) => commitGeometry(singleNode.id, 'width', value, revision)} />
            <NumberField label="属性 高度" value={singleNode.geometry.height} revision={document.revision} min={8} disabled={busy || singleNode.kind === 'group'} onCommit={(value, revision) => commitGeometry(singleNode.id, 'height', value, revision)} />
            <NumberField label="属性 旋转" value={singleNode.geometry.rotation} revision={document.revision} disabled={busy} onCommit={(value, revision) => commitGeometry(singleNode.id, 'rotation', value, revision)} />
          </div>}
          {!singleNode && <p className="editor-muted-note">拖动或旋转可以同时调整所选对象。</p>}
        </div>
        {selectedNodes.every(node => node.kind !== 'group' && node.kind !== 'image') && <div className="editor-inspector-block">
          <div className="editor-property-heading">外观</div>
          <ColorProperty value={selectedFill} revision={document.revision} disabled={busy} mixed={hasMixedFill} onCommit={commitColor} />
        </div>}
        {singleNode?.kind === 'text' && singleNode.content && <div className="editor-inspector-block">
          <div className="editor-property-heading">文本</div>
          <RichTextEditor key={singleNode.id} documentId={document.documentId} nodeId={singleNode.id} content={singleNode.content} revision={document.revision}
            disabled={busy} focused={focusTextId === singleNode.id}
            baseStyle={{ fontFamily: asString(singleNode.style.fontFamily, 'Segoe UI'), fontSize: asNumber(singleNode.style.fontSize, 24), color: asString(singleNode.style.fill, '#244b3a') }}
            onCommit={commitRichText} onConflict={() => setNotice('文字已在其他操作中更新，当前输入已重新载入。')} />
          <NumberField label="字号" value={asNumber(singleNode.style.fontSize, 24)} revision={document.revision} min={6} disabled={busy}
            onCommit={(value, revision) => { void submit([{ type: 'style.update', nodeId: singleNode.id, style: { fontSize: value } }], '修改字号', revision); }} />
        </div>}
        {singleNode?.kind === 'image' && <div className="editor-inspector-block">
          <div className="editor-property-heading">图片</div>
          <p className="editor-muted-note">{singleNode.assetId ? `资产 ${singleNode.assetId.slice(-8)}` : '尚未关联图片资产'}</p>
          <button type="button" className="editor-data-button" aria-label="替换图片" disabled={busy || !onImportAsset} onClick={() => openImagePicker(singleNode.id)}>替换图片</button>
          <ImageProperties settings={singleNode.image} revision={document.revision} disabled={busy} onCommit={(image, revision) => commitImageSettings(singleNode.id, image, revision)} />
        </div>}
        {singleNode?.kind === 'table' && singleNode.table && <div className="editor-inspector-block"><TableProperties table={singleNode.table} revision={document.revision} disabled={busy} onCommit={(table, revision) => commitTable(singleNode.id, table, revision)} /></div>}
        {singleNode?.kind === 'chart' && singleNode.chart && <div className="editor-inspector-block"><ChartProperties chart={singleNode.chart} revision={document.revision} disabled={busy} onCommit={(chart, revision) => commitChart(singleNode.id, chart, revision)} /></div>}
        <div className="editor-inspector-actions">
          {singleNode?.kind === 'group' ? <><button type="button" disabled={busy} onClick={enterSelectedGroup}>进入组</button><button type="button" disabled={busy || isEffectivelyLocked(document, singleNode.id)} onClick={ungroupSelected}>取消编组</button></> : selectedNodes.length > 1 ? <button type="button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={groupSelected}>编组</button> : null}
          <button type="button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={duplicateSelected}>复制</button>
          <button type="button" className="editor-danger-button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={() => { void removeSelected(); }}>删除</button>
        </div>
        {singleNode?.kind === 'group' && <div className="editor-group-scale"><span>等比缩放组</span><input aria-label="组缩放比例" type="number" min="0.1" max="10" step="0.1" value={groupScale} disabled={busy} onChange={event => setGroupScale(event.currentTarget.value)} /><button type="button" disabled={busy || isEffectivelyLocked(document, singleNode.id)} onClick={scaleSelectedGroup}>应用</button></div>}
      </>}
      <div className="editor-inspector-footer"><span>{pending ? '正在保存…' : '更改会同步到作品历史'}</span><span className="editor-sync-check">✓</span></div>
    </aside>
  </main>;
}

export default DeckEditor;

export { WebEditor } from './WebEditor.tsx';
