import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWebCommand, createWebDocument } from '@oeydesign/document';
import type { CommandEnvelope } from '@oeydesign/document';
import { snapWebMove } from '../src/web-snap.ts';
import { webAlignmentPreconditions, webPositionedMoveOperations } from '../src/web-selection.ts';

test('snap selection envelope to closest edges/centers without changing internal distances; outside tolerance stays free', () => {
  const moving = [{ x: 20, y: 30, width: 100, height: 80 }, { x: 160, y: 30, width: 100, height: 80 }];
  const target = [{ x: 300, y: 180, width: 100, height: 80 }];
  const result = snapWebMove(moving, target, 44, 146);
  assert.equal(result.dx, 40); assert.equal(result.dy, 150);
  assert.deepEqual(result.guides, [{ axis: 'x', coordinate: 300 }, { axis: 'y', coordinate: 180 }]);
  assert.deepEqual(snapWebMove(moving, target, 60, 160), { dx: 60, dy: 160, guides: [] });
  assert.throws(() => snapWebMove(moving, target, Infinity, 0));
});

test('multi-position movement corrects margins, scopes breakpoint and rejects stale measured sibling geometry atomically', () => {
  const doc = createWebDocument({ documentId: 'snap', name: 'Snap' }), root = doc.pages[0]!.rootId;
  for (const [id, left] of [['a', 20], ['b', 160], ['target', 300]] as const) {
    doc.nodes[root]!.children.push(id); doc.nodes[id] = { id, parentId: root, tag: 'div', children: [], layout: { mode: 'position', position: 'absolute' }, style: { left, top: 30, width: 100, height: 80 } };
  }
  doc.breakpoints = [{ id: 'mobile', maxWidth: 767 }];
  const bounds = { a: { x: 30, y: 40, width: 100, height: 80, marginLeft: 10, marginTop: 10 }, b: { x: 160, y: 30, width: 100, height: 80, marginLeft: 0, marginTop: 0 } };
  const ops = webPositionedMoveOperations(doc, ['a', 'b'], bounds, 40, 20, 'mobile');
  const command: CommandEnvelope = { commandId: 'drag', projectId: 'project', documentId: doc.documentId, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: doc.revision, preconditions: webAlignmentPreconditions(doc, ['a', 'b', 'target']), label: 'Snap move', operations: ops };
  const next = applyWebCommand(doc, command, doc).document;
  assert.equal(next.nodes.a!.responsive!.mobile!.style!.left, 60); assert.equal(next.nodes.b!.responsive!.mobile!.style!.left, 200); assert.equal(next.nodes.a!.style.left, 20);
  const changed = structuredClone(doc); changed.revision++; changed.nodes.target!.style.left = 310;
  assert.throws(() => applyWebCommand(changed, command, doc), /precondition/); assert.equal(changed.nodes.a!.responsive, undefined);
});
