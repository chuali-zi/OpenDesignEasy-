import type { WebDocument, WebOperation, WebNode, JSONValue, EditPrecondition } from '@oeydesign/document';

export function nextWebSelection(ids: string[], id: string, additive = false): string[] {
  if (!id) return [];
  if (!additive) return [id];
  return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
}

export function webRangeSelection(order: string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor), b = order.indexOf(target);
  return b < 0 ? [] : a < 0 ? [target] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Nested selections operate on their outermost tree once. */
export function webSelectionRoots(document: WebDocument, ids: string[]): WebNode[] {
  const nodes = selectedWebNodes(document, ids), chosen = new Set(ids);
  return nodes.filter(node => {
    for (let parent = node.parentId; parent; parent = document.nodes[parent]?.parentId ?? null) if (chosen.has(parent)) return false;
    return true;
  });
}

function editableTrees(document: WebDocument, ids: string[]): { roots: WebNode[]; trees: WebNode[] } {
  const roots = webSelectionRoots(document, ids), trees: WebNode[] = [];
  const visit = (node: WebNode) => { trees.push(node); node.children.forEach(id => visit(document.nodes[id]!)); };
  roots.forEach(visit);
  if (roots.some(node => !node.parentId) || trees.some(node => webNodeLocked(document, node.id))) throw new Error('选择包含页面根或锁定子树，未修改任何元素。');
  return { roots, trees };
}

export function webDeleteSelection(document: WebDocument, ids: string[]): WebOperation[] {
  return editableTrees(document, ids).roots.map(node => ({ type: 'web.node.remove', nodeId: node.id }));
}

export function webDuplicateSelection(document: WebDocument, ids: string[], makeId: (tag: string) => string): { operations: WebOperation[]; selectedIds: string[]; preconditions: EditPrecondition[] } {
  const { roots, trees } = editableTrees(document, ids);
  const mapping = new Map(trees.map(node => [node.id, makeId(node.tag)]));
  if (new Set(mapping.values()).size !== trees.length || [...mapping.values()].some(id => document.nodes[id])) throw new Error('复制元素 ID 必须唯一。');
  const htmlIds = new Map(trees.filter(node => typeof node.props?.id === 'string').map(node => [node.props!.id as string, `copy-${mapping.get(node.id)!}`]));
  const preconditions: EditPrecondition[] = trees.flatMap(node => ['id', 'parentId', 'tag', 'children', 'style', 'layout', 'props', 'text', 'content', 'group', 'locked', 'hidden', 'responsive', 'component'].map(path => ({ type: 'node.property' as const, nodeId: node.id, path, value: structuredClone(node[path as keyof WebNode]) })));
  const operations: WebOperation[] = [];
  const copy = (original: WebNode, parentId: string, index?: number) => {
    const node = structuredClone(original); node.id = mapping.get(original.id)!; node.parentId = parentId; node.children = [];
    if (node.props) for (const [key, value] of Object.entries(node.props)) {
      if (typeof value !== 'string') continue;
      if (key === 'id') node.props[key] = htmlIds.get(value) ?? value;
      else if (['for', 'htmlFor', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'headers'].includes(key)) node.props[key] = value.split(/\s+/).map(id => htmlIds.get(id) ?? id).join(' ');
      else if (key === 'href' && value.startsWith('#') && htmlIds.has(value.slice(1))) node.props[key] = `#${htmlIds.get(value.slice(1))}`;
    }
    operations.push({ type: 'web.node.insert', node, ...(index === undefined ? {} : { index }) });
    original.children.forEach(id => copy(document.nodes[id]!, node.id));
  };
  // Descending indices keep every copy directly after its source sibling.
  [...roots].sort((a, b) => a.parentId === b.parentId ? document.nodes[a.parentId!]!.children.indexOf(b.id) - document.nodes[a.parentId!]!.children.indexOf(a.id) : a.parentId!.localeCompare(b.parentId!)).forEach(node => copy(node, node.parentId!, document.nodes[node.parentId!]!.children.indexOf(node.id) + 1));
  return { operations, selectedIds: roots.map(node => mapping.get(node.id)!), preconditions };
}

export function webNodeLocked(document: WebDocument, id: string): boolean {
  const seen = new Set<string>();
  for (let node = document.nodes[id]; node; node = document.nodes[node.parentId ?? '']!) {
    if (seen.has(node.id) || node.locked) return true; seen.add(node.id);
  }
  return false;
}
export function webNodeTreeLocked(document: WebDocument, id: string): boolean {
  const node = document.nodes[id]; return !node || webNodeLocked(document, id) || node.children.some(id => webNodeTreeLocked(document, id));
}

export function selectedWebNodes(document: WebDocument, ids: string[]): WebNode[] {
  const nodes = [...new Set(ids)].map(id => document.nodes[id]);
  if (!nodes.length || nodes.some(node => !node)) throw new Error('请选择仍存在的元素。');
  return nodes as WebNode[];
}

export function webBatchStyles(document: WebDocument, ids: string[], style: Record<string, JSONValue | null>, breakpointId?: string): WebOperation[] {
  const nodes = selectedWebNodes(document, ids);
  if (nodes.some(node => webNodeLocked(document, node.id))) throw new Error('选择包含锁定元素，未修改任何元素。');
  if (nodes.some(node => node.group && node.layout.mode === 'flow' && node.style.display === 'contents') && Object.keys(style).some(key => ['width', 'height', 'backgroundColor'].includes(key))) throw new Error('选择包含流式组，框尺寸与背景请编辑成员。');
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
