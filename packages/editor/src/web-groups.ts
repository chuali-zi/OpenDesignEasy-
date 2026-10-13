import type { WebDocument, WebNode, WebOperation } from '@oeydesign/document';
import { webAlignmentPreconditions, webDeleteSelection, webPixelCoordinate, webSelectionRoots } from './web-selection.ts';
import type { WebBounds } from './web-selection.ts';

const round = (value: number) => Math.round(value * 100) / 100;
const geometry = /^(?:left|right|top|bottom|width|height|min|max|margin|padding|border|transform|translate|scale|rotate|position|display|boxSizing)/;
function box(document: WebDocument, node: WebNode) {
  const s = node.style, layout = node.layout;
  if (document.sourceModules?.some(module => module.language === 'css' && module.source.trim()) || node.hidden || layout.mode !== 'position' || layout.position && layout.position !== 'absolute'
    || Object.keys(layout).some(key => !['mode', 'position'].includes(key)) || s.order != null
    || s.transform || s.translate || s.scale || s.rotate && !['0', '0deg', 0].includes(s.rotate as string)
    || Object.values(node.responsive ?? {}).some(override => Object.keys(override.style ?? {}).some(key => geometry.test(key)) || Object.keys(override.layout ?? {}).length)) throw new Error('组操作仅支持无外部 CSS、几何断点覆盖或变换的原生绝对定位元素。');
  const [x, y, width, height] = ['left', 'top', 'width', 'height'].map(key => webPixelCoordinate(s[key]));
  if ([x, y, width, height].some(value => value === undefined) || width! <= 0 || height! <= 0) throw new Error('组操作需要明确的像素坐标与尺寸。');
  return { x: x!, y: y!, width: width!, height: height! };
}
function groupBox(document: WebDocument, group: WebNode, ungroup = false) {
  if (!group.group || !group.parentId || group.props && Object.keys(group.props).some(key => key !== 'aria-label')) throw new Error('请选择原生组；附加属性不能无损解组。');
  const result = box(document, group);
  const allowed = new Set(['left', 'top', 'width', 'height', 'padding', 'margin', 'border', 'boxSizing', 'display', 'overflow', 'right', 'bottom', 'rotate']);
  if (ungroup && Object.entries(group.style).some(([key, value]) => value != null && !allowed.has(key)) || ['padding', 'margin', 'border'].some(key => group.style[key] !== 0)
    || group.style.boxSizing !== 'border-box' || group.style.display !== 'block' || group.style.overflow !== 'visible') throw new Error('组外观或布局已更改，先恢复无装饰原生组再执行此操作。');
  return result;
}

export function webGroupSelection(document: WebDocument, ids: string[], bounds: Record<string, WebBounds>, groupId: string) {
  webDeleteSelection(document, ids); // Reject roots and locked descendants before any edit.
  const nodes = webSelectionRoots(document, ids);
  if (nodes.length < 2 || !nodes[0]!.parentId || nodes.some(node => node.parentId !== nodes[0]!.parentId)) throw new Error('分组需要同父级的至少两个元素。');
  const parentId = nodes[0]!.parentId!, siblings = document.nodes[parentId]!.children;
  const ordered = [...nodes].sort((a, b) => siblings.indexOf(a.id) - siblings.indexOf(b.id));
  const first = siblings.indexOf(ordered[0]!.id);
  if (ordered.some((node, i) => siblings[first + i] !== node.id)) throw new Error('请选择连续兄弟元素，避免分组改变其他对象的叠放顺序。');
  nodes.forEach(node => { box(document, node); const b = bounds[node.id]; if (!b || !Object.values(b).every(Number.isFinite) || b.width <= 0 || b.height <= 0) throw new Error('无法可靠测量组边界。'); });
  const x = Math.min(...nodes.map(node => bounds[node.id]!.x)), y = Math.min(...nodes.map(node => bounds[node.id]!.y));
  const width = Math.max(...nodes.map(node => bounds[node.id]!.x + bounds[node.id]!.width)) - x;
  const height = Math.max(...nodes.map(node => bounds[node.id]!.y + bounds[node.id]!.height)) - y;
  const operations: WebOperation[] = [{ type: 'web.node.insert', index: first, node: { id: groupId, group: true, parentId, tag: 'div', children: [], props: { 'aria-label': '组' }, style: { left: x, top: y, width, height, padding: 0, margin: 0, border: 0, boxSizing: 'border-box', display: 'block', overflow: 'visible' }, layout: { mode: 'position', position: 'absolute' } } }];
  for (const node of ordered) {
    const b = bounds[node.id]!;
    operations.push({ type: 'web.node.reparent', nodeId: node.id, parentId: groupId }, { type: 'web.style.update', nodeId: node.id, style: { left: round(b.x - x - b.marginLeft), top: round(b.y - y - b.marginTop), right: null, bottom: null } });
  }
  return { operations, selectedIds: [groupId], preconditions: webAlignmentPreconditions(document, ids) };
}

export function webUngroup(document: WebDocument, id: string) {
  webDeleteSelection(document, [id]); const group = document.nodes[id]!, origin = groupBox(document, group, true);
  const parentId = group.parentId!, index = document.nodes[parentId]!.children.indexOf(id);
  const operations: WebOperation[] = [];
  group.children.forEach((id, i) => {
    const child = document.nodes[id]!, b = box(document, child);
    operations.push({ type: 'web.node.reparent', nodeId: id, parentId, index: index + i }, { type: 'web.style.update', nodeId: id, style: { left: round(origin.x + b.x), top: round(origin.y + b.y), right: null, bottom: null } });
  });
  operations.push({ type: 'web.node.remove', nodeId: group.id });
  return { operations, selectedIds: [...group.children], preconditions: webAlignmentPreconditions(document, [id, ...group.children]) };
}

export function webGroupResizeMembers(document: WebDocument, id: string): string[] {
  const group = document.nodes[id]; if (!group?.group) throw new Error('请选择原生组。');
  return group.children.flatMap(id => [id, ...(document.nodes[id]!.group ? webGroupResizeMembers(document, id) : [])]);
}

export function webResizeGroup(document: WebDocument, id: string, width: number, height: number, bounds: Record<string, WebBounds>) {
  webDeleteSelection(document, [id]); const group = document.nodes[id]!, old = groupBox(document, group);
  if (![width, height].every(value => Number.isFinite(value) && value >= 16)) throw new Error('组尺寸不能小于 16px。');
  const sx = width / old.width, sy = height / old.height, operations: WebOperation[] = [], groups = [group.id];
  const visit = (parent: WebNode) => {
    for (const id of parent.children) {
      const child = document.nodes[id]!, b = box(document, child);
      const measured = bounds[id];
      if (!measured || !Object.values(measured).every(Number.isFinite) || measured.width <= 0 || measured.height <= 0) throw new Error('无法可靠测量组内元素。');
      if (child.group) { groupBox(document, child); groups.push(child.id); visit(child); }
      operations.push({ type: 'web.style.update', nodeId: id, style: { left: round(measured.x * sx - measured.marginLeft), top: round(measured.y * sy - measured.marginTop), width: round(b.width * sx), height: round(b.height * sy), right: null, bottom: null } });
    }
  };
  visit(group); operations.push({ type: 'web.style.update', nodeId: id, style: { width, height } });
  return { operations, preconditions: [...webAlignmentPreconditions(document, [id, ...operations.flatMap(op => 'nodeId' in op ? [op.nodeId] : [])]),
    ...groups.map(nodeId => ({ type: 'node.property' as const, nodeId, path: 'children', value: [...document.nodes[nodeId]!.children] }))] };
}
