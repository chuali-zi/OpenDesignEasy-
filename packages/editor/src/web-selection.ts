import type { WebDocument, WebOperation, WebNode, JSONValue, EditPrecondition } from '@oeydesign/document';

export function nextWebSelection(ids: string[], id: string, additive = false): string[] {
  if (!id) return [];
  if (!additive) return [id];
  return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
}

export function webNodeLocked(document: WebDocument, id: string): boolean {
  const seen = new Set<string>();
  for (let node = document.nodes[id]; node; node = document.nodes[node.parentId ?? '']!) {
    if (seen.has(node.id) || node.locked) return true; seen.add(node.id);
  }
  return false;
}

export function selectedWebNodes(document: WebDocument, ids: string[]): WebNode[] {
  const nodes = [...new Set(ids)].map(id => document.nodes[id]);
  if (!nodes.length || nodes.some(node => !node)) throw new Error('请选择仍存在的元素。');
  return nodes as WebNode[];
}

export function webBatchStyles(document: WebDocument, ids: string[], style: Record<string, JSONValue | null>, breakpointId?: string): WebOperation[] {
  const nodes = selectedWebNodes(document, ids);
  if (nodes.some(node => webNodeLocked(document, node.id))) throw new Error('选择包含锁定元素，未修改任何元素。');
  return nodes.map(node => ({ type: 'web.style.update', nodeId: node.id, breakpointId, style }));
}

export type WebBounds = { x: number; y: number; width: number; height: number; marginLeft: number; marginTop: number };
export type WebAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'distribute-x' | 'distribute-y';
const pixels = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 || typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value) && parseFloat(value) > 0;
const round = (n: number) => Math.round(n * 100) / 100;
export const webPixelCoordinate = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?\d+(?:\.\d+)?px$/.test(value) ? parseFloat(value) : undefined;

export function webAlignmentPreconditions(document: WebDocument, ids: string[]): EditPrecondition[] {
  const nodes = selectedWebNodes(document, ids), dependencies = new Set<string>();
  for (const selected of nodes) for (let node: WebNode | undefined = selected; node; node = document.nodes[node.parentId ?? '']) dependencies.add(node.id);
  const result: EditPrecondition[] = [];
  for (const id of dependencies) for (const path of ['parentId', 'style', 'layout', 'responsive', 'hidden']) {
    result.push({ type: 'node.property', nodeId: id, path, value: structuredClone(document.nodes[id]![path as keyof WebNode]) });
  }
  result.push({ type: 'document.property', path: 'sourceModules', value: structuredClone(document.sourceModules) },
    { type: 'document.property', path: 'breakpoints', value: structuredClone(document.breakpoints) });
  return result;
}

/** Preserve CSS layout semantics: only absolute siblings with explicit pixel
 * sizes can be positioned together. Coordinates are local border-box bounds. */
export function webAlignmentOperations(document: WebDocument, ids: string[], bounds: Record<string, WebBounds>, alignment: WebAlignment, breakpointId?: string): WebOperation[] {
  const nodes = selectedWebNodes(document, ids);
  if (nodes.length < (alignment.startsWith('distribute') ? 3 : 2)) throw new Error('对齐需要至少两个元素，分布需要至少三个元素。');
  const parent = nodes[0]!.parentId;
  if (!parent || nodes.some(node => node.parentId !== parent || webNodeLocked(document, node.id) || node.hidden)) throw new Error('请选择同一父级内未锁定、可见的定位元素。');
  for (const node of nodes) {
    const override = breakpointId ? node.responsive?.[breakpointId] : undefined;
    const layout = { ...node.layout, ...override?.layout }, style = { ...node.style, ...override?.style };
    if (layout.mode !== 'position' || layout.position && layout.position !== 'absolute' || !pixels(style.width) || !pixels(style.height) || webPixelCoordinate(style.left) === undefined || webPixelCoordinate(style.top) === undefined
      || style.transform || style.translate || style.scale || style.rotate && !['0', '0deg', 0].includes(style.rotate as string)) throw new Error('对齐仅支持绝对定位、像素尺寸且无旋转/变换的元素；流式布局保持原样。');
    const box = bounds[node.id];
    if (!box || !Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new Error('无法取得可靠的元素边界，请等待预览载入。');
  }
  const horizontal = ['left', 'center-x', 'right', 'distribute-x'].includes(alignment);
  const position = horizontal ? 'x' : 'y', length = horizontal ? 'width' : 'height';
  const margin = horizontal ? 'marginLeft' : 'marginTop';
  const start = Math.min(...nodes.map(node => bounds[node.id]![position]));
  const end = Math.max(...nodes.map(node => bounds[node.id]![position] + bounds[node.id]![length]));
  const desired = new Map<string, number>();
  if (alignment.startsWith('distribute')) {
    const sorted = [...nodes].sort((a, b) => bounds[a.id]![position] - bounds[b.id]![position]);
    const gap = (end - start - sorted.reduce((sum, node) => sum + bounds[node.id]![length], 0)) / (sorted.length - 1);
    let cursor = start;
    sorted.forEach(node => { desired.set(node.id, cursor); cursor += bounds[node.id]![length] + gap; });
  } else {
    for (const node of nodes) {
      const size = bounds[node.id]![length];
      desired.set(node.id, alignment.startsWith('center') ? (start + end - size) / 2 : ['right', 'bottom'].includes(alignment) ? end - size : start);
    }
  }
  return nodes.map(node => ({ type: 'web.style.update', nodeId: node.id, breakpointId,
    style: horizontal ? { left: round(desired.get(node.id)! - bounds[node.id]![margin]), right: null } : { top: round(desired.get(node.id)! - bounds[node.id]![margin]), bottom: null } }));
}
