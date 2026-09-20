import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeckNode } from '@oeydesign/document';
import { alignNodes, distributeNodes, snapGeometry } from '../src/layout.ts';

function shape(id: string, x: number, y: number, width = 20, height = 10, parentId = 'page'): DeckNode {
  return { id, kind: 'shape', parentId, geometry: { x, y, width, height, rotation: 0 }, style: {}, locked: false, hidden: false };
}

test('alignment produces a single batched position update per changed node', () => {
  const nodes = [shape('a', 10, 10), shape('b', 70, 35), shape('c', 130, 15)];
  const operations = alignNodes(nodes, 'center-y');
  assert.deepEqual(operations, [
    { type: 'geometry.update', nodeId: 'a', geometry: { y: 22.5 } },
    { type: 'geometry.update', nodeId: 'b', geometry: { y: 22.5 } },
    { type: 'geometry.update', nodeId: 'c', geometry: { y: 22.5 } },
  ]);
  assert.deepEqual(alignNodes([nodes[0]!, shape('other', 0, 0, 10, 10, 'another-parent')], 'left'), []);
});

test('distribution preserves the first and last object and creates even gaps', () => {
  const nodes = [shape('a', 0, 0, 20), shape('b', 55, 0, 10), shape('c', 160, 0, 20)];
  assert.deepEqual(distributeNodes(nodes, 'x'), [
    { type: 'geometry.update', nodeId: 'b', geometry: { x: 85 } },
  ]);
});

test('preview snapping uses grid and object centers without mutating inputs', () => {
  const sibling = shape('fixed', 95, 84, 40, 40);
  const moving = { x: 54, y: 63, width: 40, height: 40 };
  const result = snapGeometry('moving', moving, [sibling], { tolerance: 6, useGrid: true, useObjects: true });
  assert.deepEqual(result, { x: 55, y: 64, guides: [
    { axis: 'x', position: 95, from: 60, to: 124 },
    { axis: 'y', position: 84, from: 60, to: 135 },
  ] });
  assert.deepEqual(moving, { x: 54, y: 63, width: 40, height: 40 });
});
