import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Group, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import type { Node as KonvaNode } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import type { DeckDocument, DeckNode, DocumentOperation, Geometry } from '@oeydesign/document';
import { normalizeKonvaTransform, textToString } from '@oeydesign/document';
import {
  makeCoverOperations, makePageInsert, makeShapeInsert, makeTextInsert, makeTextReplacementSteps,
} from './operations.ts';

export type DeckEditorProps = {
  document: DeckDocument;
  onApply: (operations: DocumentOperation[], label: string, baseRevision: number) => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
};

type ViewPoint = { x: number; y: number };
type CanvasSize = { width: number; height: number };
type LayerEntry = { node: DeckNode; depth: number };
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
  const kind = node.kind === 'shape' ? '矩形' : node.kind === 'image' ? '图片预览' : node.kind === 'group' ? '图层组' : '文字';
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

export function DeckEditor({ document, onApply, onUndo, onRedo, disabled = false }: DeckEditorProps) {
  const initialPage = document.pages[0]?.id ?? '';
  const [activePageId, setActivePageId] = useState(initialPage);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<ViewPoint>({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [focusTextId, setFocusTextId] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
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

  documentRef.current = document;
  onApplyRef.current = onApply;
  disabledRef.current = disabled;
  zoomRef.current = zoom;
  panRef.current = pan;

  const setSelection = (ids: string[]) => {
    const unique = [...new Set(ids)];
    selectionRef.current = unique;
    setSelectedIds(unique);
  };

  const selectedNodes = selectedIds.map(id => document.nodes[id]).filter((node): node is DeckNode => Boolean(node));
  const page = document.pages.find(candidate => candidate.id === activePageId) ?? document.pages[0];
  const pageLayers = useMemo(() => page ? flattenLayers(document, page.id) : [], [document, page]);
  const activePageChildren = page?.children ?? [];
  const busy = disabled || pending;

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
    const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const keydown = (event: KeyboardEvent) => {
      if (editableTarget(event.target)) return;
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault(); spaceDownRef.current = true; setSpaceDown(true); return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (busy) return; if (event.shiftKey) onRedo(); else onUndo(); return;
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); if (!busy) onRedo(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectionRef.current.length && !busy) {
        event.preventDefault(); void removeSelected();
      }
      if (event.key === 'Escape') { setSelection([]); setFocusTextId(''); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') { spaceDownRef.current = false; setSpaceDown(false); }
    };
    const blur = () => { spaceDownRef.current = false; setSpaceDown(false); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [busy, onRedo, onUndo]);

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
    void submit([operation], '添加文字').then(ok => { if (ok) setSelection([operation.node.id]); });
  }

  function addShape() {
    if (!page) return;
    const operation = makeShapeInsert(page.id, { x: Math.round(page.width / 2 - 140), y: Math.round(page.height / 2 - 75) });
    if (operation.type !== 'node.insert') return;
    void submit([operation], '添加形状').then(ok => { if (ok) setSelection([operation.node.id]); });
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

  function commitGeometry(nodeId: string, key: keyof Geometry, value: number, baseRevision: number) {
    void submit([{ type: 'geometry.update', nodeId, geometry: { [key]: value } }], '修改属性', baseRevision);
  }

  function commitText(nodeId: string, value: string, baseRevision: number) {
    const node = documentRef.current.nodes[nodeId];
    if (!node?.content) return;
    void submit([{ type: 'text.apply', nodeId, steps: makeTextReplacementSteps(node.content, value) }], '编辑文字', baseRevision);
  }

  function commitColor(color: string, baseRevision = documentRef.current.revision) {
    const ids = selectionRef.current.filter(id => documentRef.current.nodes[id] && documentRef.current.nodes[id]!.kind !== 'group');
    if (!ids.length) return;
    void submit(ids.map(nodeId => ({ type: 'style.update', nodeId, style: { fill: color } })), ids.length > 1 ? '修改多个图层颜色' : '修改填充颜色', baseRevision);
  }

  function reorderNode(node: DeckNode, direction: -1 | 1) {
    const siblings = childrenFor(documentRef.current, node.parentId);
    const index = siblings.indexOf(node.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return;
    void submit([{ type: 'node.reorder', nodeId: node.id, index: nextIndex }], direction < 0 ? '上移图层' : '下移图层');
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
    const editable = !busy && !locked;
    return {
      id: node.id,
      draggable: editable,
      onMouseDown: (event: { evt: MouseEvent; cancelBubble: boolean }) => {
        event.cancelBubble = true;
        chooseNode(node.id, event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey);
      },
      onClick: (event: { cancelBubble: boolean }) => { event.cancelBubble = true; },
      onDblClick: () => { chooseNode(node.id, false); if (node.kind === 'text') setFocusTextId(node.id); },
      onDragStart: () => beginGesture('drag', node.id),
      onDragMove: (event: { target: KonvaNode }) => moveGesture(node.id, event.target),
      onDragEnd: () => { void finishGesture(); },
    };
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
        text={node.content ? textToString(node.content) : ''} fill={fill} fontSize={asNumber(node.style.fontSize, 24)}
        fontFamily={asString(node.style.fontFamily, 'Segoe UI')} fontStyle={node.style.fontWeight === 'bold' ? 'bold' : 'normal'}
        align={asString(node.style.textAlign, 'left') as 'left' | 'center' | 'right'} verticalAlign="middle" lineHeight={1.18}
        wrap="word" ellipsis={false} padding={0} />;
    }
    if (node.kind === 'image') {
      return <Group key={id} ref={shape => { if (shape) nodeRefs.current.set(id, shape); else nodeRefs.current.delete(id); }}
        {...interaction} x={geometry.x} y={geometry.y} rotation={geometry.rotation}>
        <Rect width={geometry.width} height={geometry.height} fill="#f3f5f1" stroke="#9eaea3" strokeWidth={1} dash={[5, 4]} listening={false} />
        <Text width={geometry.width} height={geometry.height} text="IMAGE\n预览暂不可用" align="center" verticalAlign="middle" fill="#718078" fontSize={13} lineHeight={1.4} listening={false} />
      </Group>;
    }
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
            aria-label={`选择页面 ${candidate.name}`} onClick={() => { setActivePageId(candidate.id); setSelection([]); resetView(); }}>
            <span className="editor-page-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="editor-page-name">{candidate.name}</span>
            <span className="editor-page-dimensions">{candidate.width} × {candidate.height}</span>
          </button>)}
        </div>
      </section>
      <section className="editor-sidebar-section editor-layers-section">
        <div className="editor-section-heading"><span>图层</span><span className="editor-count">{pageLayers.length}</span></div>
        {!pageLayers.length ? <p className="editor-muted-note">添加对象后，会在这里显示页面结构。</p> : <div className="editor-layer-list">
          {pageLayers.map(({ node, depth }) => {
            const locked = node.locked;
            const inheritedLocked = isEffectivelyLocked(document, node.id) && !locked;
            return <div key={node.id} className={`editor-layer-row${selectedIds.includes(node.id) ? ' is-selected' : ''}${isEffectivelyHidden(document, node.id) ? ' is-hidden' : ''}`} style={{ '--depth': depth } as CSSProperties}>
              <button type="button" className="editor-layer-select" aria-pressed={selectedIds.includes(node.id)} title={`选择 ${labelFor(node)}`}
                onClick={event => chooseNode(node.id, event.shiftKey || event.ctrlKey || event.metaKey)} disabled={busy}>
                <span className={`editor-layer-kind kind-${node.kind}`}>{node.kind === 'text' ? 'T' : node.kind === 'group' ? '▦' : node.kind === 'image' ? '▧' : '□'}</span>
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
          <span className="editor-toolbar-divider" />
          <button type="button" className="editor-icon-button" aria-label="撤销" title="撤销 · Ctrl Z" disabled={busy} onClick={onUndo}>↶</button>
          <button type="button" className="editor-icon-button" aria-label="重做" title="重做 · Ctrl Shift Z" disabled={busy} onClick={onRedo}>↷</button>
          <span className="editor-toolbar-divider" />
          <button type="button" className="editor-icon-button" aria-label="复制图层" title="复制图层" disabled={busy || !selectedNodes.length} onClick={duplicateSelected}>⧉</button>
          {selectedNodes.length > 1 && <button type="button" className="editor-icon-button" aria-label="编组图层" title="编组" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={groupSelected}>▦</button>}
          {selectedNodes.length === 1 && selectedNodes[0]?.kind === 'group' && <button type="button" className="editor-icon-button" aria-label="取消编组" title="取消编组" disabled={busy || isEffectivelyLocked(document, selectedNodes[0].id)} onClick={ungroupSelected}>▤</button>}
          <button type="button" className="editor-icon-button editor-delete-tool" aria-label="删除所选" title="删除所选 · Delete" disabled={busy || !selectedNodes.length || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={() => { void removeSelected(); }}>⌫</button>
        </div>
        <div className="editor-tool-group editor-zoom-tools">
          <button type="button" className="editor-icon-button" aria-label="缩小画布" title="缩小画布" onClick={() => zoomAt(1 / 1.2)} disabled={!page}>−</button>
          <span className="editor-zoom-value">{Math.round(zoom * 100)}%</span>
          <button type="button" className="editor-icon-button" aria-label="放大画布" title="放大画布" onClick={() => zoomAt(1.2)} disabled={!page}>＋</button>
          <button type="button" className="editor-fit-button" aria-label="适应页面" title="适应页面" onClick={resetView}>适应</button>
        </div>
      </div>

      <div ref={canvasRef} className="editor-canvas-wrap" onWheel={event => {
        if (!page) return;
        event.preventDefault();
        const bounds = canvasRef.current?.getBoundingClientRect();
        if (!bounds) return;
        zoomAt(Math.exp(-event.deltaY * 0.0012), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      }}>
        {page && <Stage ref={stageRef} width={canvasSize.width} height={canvasSize.height} x={stageX} y={stageY} scaleX={stageScale} scaleY={stageScale}
          draggable={spaceDown} onDragEnd={event => {
            if (!spaceDownRef.current) return;
            const baseX = (canvasSize.width - page.width * fitScale) / 2; const baseY = (canvasSize.height - page.height * fitScale) / 2;
            const next = { x: event.target.x() - baseX, y: event.target.y() - baseY };
            panRef.current = next; setPan(next);
          }}
          onWheel={event => { event.evt.preventDefault(); }}
          onMouseDown={event => { if (event.target === event.target.getStage()) setSelection([]); }}>
          <Layer key={canvasEpoch}>
            <Rect x={0} y={0} width={page.width} height={page.height} fill="#fff" shadowColor="#183327" shadowBlur={22} shadowOpacity={0.14} shadowOffset={{ x: 0, y: 8 }}
              onMouseDown={() => setSelection([])} onClick={() => setSelection([])} />
            {activePageChildren.map(id => renderNode(id))}
          </Layer>
          <Layer>
            <Transformer ref={transformerRef} rotateEnabled resizeEnabled enabledAnchors={isGroupTransform ? [] : undefined} flipEnabled={false}
              keepRatio={false} shiftBehavior="keepRatio" rotationSnaps={[0, 45, 90, 135, 180, -45, -90, -135]} rotationSnapTolerance={4}
              borderStroke="#43876b" borderStrokeWidth={1} borderDash={[4, 3]} anchorFill="#ffffff" anchorStroke="#43876b" anchorStrokeWidth={1.2} anchorSize={8}
              boundBoxFunc={(oldBox, newBox) => newBox.width < 12 || newBox.height < 12 ? oldBox : newBox}
              onTransformStart={() => beginGesture('transform')}
              onTransformEnd={() => { void finishGesture(); }} />
          </Layer>
        </Stage>}
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
        <div className="editor-selection-title"><span className={`editor-selection-kind kind-${selectedNodes[0]!.kind}`}>{selectedNodes[0]!.kind === 'text' ? 'T' : selectedNodes[0]!.kind === 'group' ? '▦' : selectedNodes[0]!.kind === 'image' ? '▧' : '□'}</span>
          <div><strong>{selectedNodes.length === 1 ? labelFor(selectedNodes[0]!) : `${selectedNodes.length} 个对象`}</strong><small>{selectedNodes.length === 1 ? selectedNodes[0]!.kind === 'text' ? '文字对象' : selectedNodes[0]!.kind === 'group' ? '图层组' : selectedNodes[0]!.kind === 'image' ? '图片对象' : '形状对象' : '同一父级的多选'}</small></div></div>
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
          <TextProperty node={singleNode} revision={document.revision} disabled={busy} focused={focusTextId === singleNode.id} onCommit={commitText} />
          <NumberField label="字号" value={asNumber(singleNode.style.fontSize, 24)} revision={document.revision} min={6} disabled={busy}
            onCommit={(value, revision) => { void submit([{ type: 'style.update', nodeId: singleNode.id, style: { fontSize: value } }], '修改字号', revision); }} />
        </div>}
        {singleNode?.kind === 'image' && <div className="editor-inspector-block"><p className="editor-muted-note">图片资产可移动和调整大小；当前画布暂不渲染图片预览。</p></div>}
        <div className="editor-inspector-actions">
          {singleNode?.kind === 'group' ? <button type="button" disabled={busy || isEffectivelyLocked(document, singleNode.id)} onClick={ungroupSelected}>取消编组</button> : selectedNodes.length > 1 ? <button type="button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={groupSelected}>编组</button> : null}
          <button type="button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={duplicateSelected}>复制</button>
          <button type="button" className="editor-danger-button" disabled={busy || selectedNodes.some(node => isEffectivelyLocked(document, node.id))} onClick={() => { void removeSelected(); }}>删除</button>
        </div>
      </>}
      <div className="editor-inspector-footer"><span>{pending ? '正在保存…' : '更改会同步到作品历史'}</span><span className="editor-sync-check">✓</span></div>
    </aside>
  </main>;
}

export default DeckEditor;
