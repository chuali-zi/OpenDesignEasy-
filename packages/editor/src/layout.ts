import type { DeckNode, DocumentOperation, Geometry } from '@oeydesign/document';

export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type Axis = 'x' | 'y';

/** Return one batched geometry command per changed object for the chosen common edge/center. */
export function alignNodes(nodes: readonly DeckNode[], alignment: Alignment): DocumentOperation[] {
  if (nodes.length < 2 || nodes.some(node => node.parentId !== nodes[0]!.parentId)) return [];
  const left = Math.min(...nodes.map(node => node.geometry.x));
  const top = Math.min(...nodes.map(node => node.geometry.y));
  const right = Math.max(...nodes.map(node => node.geometry.x + node.geometry.width));
  const bottom = Math.max(...nodes.map(node => node.geometry.y + node.geometry.height));
  return nodes.flatMap(node => {
    const geometry: Partial<Geometry> = {};
    if (alignment === 'left') geometry.x = left;
    if (alignment === 'center-x') geometry.x = (left + right - node.geometry.width) / 2;
    if (alignment === 'right') geometry.x = right - node.geometry.width;
    if (alignment === 'top') geometry.y = top;
    if (alignment === 'center-y') geometry.y = (top + bottom - node.geometry.height) / 2;
    if (alignment === 'bottom') geometry.y = bottom - node.geometry.height;
    const changed = Object.entries(geometry).some(([key, value]) => Math.abs(node.geometry[key as keyof Geometry] - value) > 0.01);
    return changed ? [{ type: 'geometry.update', nodeId: node.id, geometry } as DocumentOperation] : [];
  });
}

/** Evenly place the inner objects between the first and last object on the selected axis. */
export function distributeNodes(nodes: readonly DeckNode[], axis: Axis): DocumentOperation[] {
  if (nodes.length < 3 || nodes.some(node => node.parentId !== nodes[0]!.parentId)) return [];
  const sorted = [...nodes].sort((a, b) => a.geometry[axis] - b.geometry[axis]);
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  const edge = (node: DeckNode) => node.geometry[axis] + node.geometry[axis === 'x' ? 'width' : 'height'];
  const totalSize = sorted.reduce((sum, node) => sum + node.geometry[axis === 'x' ? 'width' : 'height'], 0);
  const gap = (edge(end) - start.geometry[axis] - totalSize) / (sorted.length - 1);
  let cursor = start.geometry[axis];
  const operations: DocumentOperation[] = [];
  for (const [index, node] of sorted.entries()) {
    const position = index === sorted.length - 1 ? node.geometry[axis] : cursor;
    if (Math.abs(position - node.geometry[axis]) > 0.01) {
      operations.push({ type: 'geometry.update', nodeId: node.id, geometry: { [axis]: position } });
    }
    cursor = position + node.geometry[axis === 'x' ? 'width' : 'height'] + gap;
  }
  return operations;
}

export type SnapGuide = { axis: Axis; position: number; from: number; to: number };
export type SnapResult = { x: number; y: number; guides: SnapGuide[] };

/**
 * Snap one preview geometry to page-local grid points, then to nearby sibling edges/centers.
 * The returned guides are transient canvas overlays and never become document operations.
 */
export function snapGeometry(
  movingId: string,
  geometry: Pick<Geometry, 'x' | 'y' | 'width' | 'height'>,
  siblings: readonly DeckNode[],
  options: { grid?: number; tolerance: number; useGrid: boolean; useObjects: boolean },
): SnapResult {
  let x = geometry.x;
  let y = geometry.y;
  const guides: SnapGuide[] = [];
  const grid = options.grid ?? 20;
  if (options.useGrid && grid > 0) {
    const gridX = Math.round(x / grid) * grid;
    const gridY = Math.round(y / grid) * grid;
    if (Math.abs(gridX - x) <= options.tolerance) x = gridX;
    if (Math.abs(gridY - y) <= options.tolerance) y = gridY;
  }
  if (!options.useObjects) return { x, y, guides };

  const movingX = [x, x + geometry.width / 2, x + geometry.width];
  const movingY = [y, y + geometry.height / 2, y + geometry.height];
  let nearestX: { delta: number; position: number; from: number; to: number } | undefined;
  let nearestY: { delta: number; position: number; from: number; to: number } | undefined;
  for (const sibling of siblings) {
    if (sibling.id === movingId || sibling.hidden) continue;
    const otherX = [sibling.geometry.x, sibling.geometry.x + sibling.geometry.width / 2, sibling.geometry.x + sibling.geometry.width];
    const otherY = [sibling.geometry.y, sibling.geometry.y + sibling.geometry.height / 2, sibling.geometry.y + sibling.geometry.height];
    for (const candidate of movingX) for (const target of otherX) {
      const delta = target - candidate;
      if (Math.abs(delta) <= options.tolerance && (!nearestX || Math.abs(delta) < Math.abs(nearestX.delta))) {
        nearestX = { delta, position: target, from: Math.min(y, sibling.geometry.y), to: Math.max(y + geometry.height, sibling.geometry.y + sibling.geometry.height) };
      }
    }
    for (const candidate of movingY) for (const target of otherY) {
      const delta = target - candidate;
      if (Math.abs(delta) <= options.tolerance && (!nearestY || Math.abs(delta) < Math.abs(nearestY.delta))) {
        nearestY = { delta, position: target, from: Math.min(x, sibling.geometry.x), to: Math.max(x + geometry.width, sibling.geometry.x + sibling.geometry.width) };
      }
    }
  }
  if (nearestX) {
    x += nearestX.delta;
    guides.push({ axis: 'x', position: nearestX.position, from: nearestX.from, to: nearestX.to });
  }
  if (nearestY) {
    y += nearestY.delta;
    guides.push({ axis: 'y', position: nearestY.position, from: nearestY.from, to: nearestY.to });
  }
  return { x, y, guides };
}
