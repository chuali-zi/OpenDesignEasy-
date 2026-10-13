import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWebCommand, createWebDocument } from '@oeydesign/document';
import type { CommandEnvelope, EditPrecondition, WebDocument, WebOperation } from '@oeydesign/document';
import { webGroupSelection, webResizeGroup, webUngroup } from '../src/web-groups.ts';

function fixture() {
  const doc = createWebDocument({ documentId: 'groups', name: 'Groups' }), root = doc.pages[0]!.rootId;
  doc.nodes[root]!.layout = { mode: 'position', position: 'relative' };
  for (const [id, left, top] of [['a', 30, 40], ['b', 190, 100], ['c', 360, 100]] as const) {
    doc.nodes[root]!.children.push(id); doc.nodes[id] = { id, parentId: root, tag: 'div', text: id, children: [], style: { left, top, width: 120, height: 80 }, layout: { mode: 'position', position: 'absolute' } };
  }
  return doc;
}
const bounds = { a: { x: 30, y: 40, width: 120, height: 80, marginLeft: 0, marginTop: 0 }, b: { x: 190, y: 100, width: 120, height: 80, marginLeft: 0, marginTop: 0 } };
function apply(doc: WebDocument, operations: WebOperation[], preconditions: EditPrecondition[], base = doc) {
  const command: CommandEnvelope = { commandId: `group-${doc.revision}`, projectId: 'project', documentId: doc.documentId, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: base.revision, preconditions, label: 'Group operation', operations };
  return applyWebCommand(doc, command, base).document;
}

test('group and ungroup preserve local geometry, DOM sibling order and snapshot dependency conflicts', () => {
  const doc = fixture(), batch = webGroupSelection(doc, ['b', 'a'], bounds, 'group');
  const grouped = apply(doc, batch.operations, batch.preconditions);
  assert.deepEqual(grouped.nodes[doc.pages[0]!.rootId]!.children, ['group', 'c']);
  assert.deepEqual(grouped.nodes.group!.children, ['a', 'b']); assert.equal(grouped.nodes.b!.style.left, 160); assert.equal(grouped.nodes.b!.style.top, 60);
  assert.equal(grouped.nodes.group!.style.width, 280); assert.equal(grouped.nodes.group!.style.height, 140);
  const ungroup = webUngroup(grouped, 'group'), restored = apply(grouped, ungroup.operations, ungroup.preconditions);
  assert.deepEqual(restored.nodes[doc.pages[0]!.rootId]!.children, ['a', 'b', 'c']);
  for (const id of ['a', 'b']) { assert.equal(restored.nodes[id]!.style.left, doc.nodes[id]!.style.left); assert.equal(restored.nodes[id]!.style.top, doc.nodes[id]!.style.top); }
  const changed = structuredClone(doc); changed.revision = 1; changed.nodes.b!.style.width = 121;
  assert.throws(() => apply(changed, batch.operations, batch.preconditions, doc), /precondition/);
  const unrelated = structuredClone(doc); unrelated.revision = 1; unrelated.name = 'New name';
  assert.equal(apply(unrelated, batch.operations, batch.preconditions, doc).nodes.group!.group, true);
});

test('group resize scales child boxes with margin correction and guards children added after measurement', () => {
  const doc = fixture(); const batch = webGroupSelection(doc, ['a', 'b'], bounds, 'group');
  const grouped = apply(doc, batch.operations, batch.preconditions);
  const local = { a: { ...bounds.a, x: 10, y: 15, marginLeft: 10, marginTop: 15 }, b: { ...bounds.b, x: 160, y: 60 } };
  const resize = webResizeGroup(grouped, 'group', 560, 280, local);
  const result = apply(grouped, resize.operations, resize.preconditions);
  assert.equal(result.nodes.a!.style.left, 10); assert.equal(result.nodes.a!.style.top, 15);
  assert.equal(result.nodes.b!.style.left, 320); assert.equal(result.nodes.b!.style.top, 120); assert.equal(result.nodes.b!.style.width, 240);
  assert.equal(result.nodes.group!.style.width, 560); assert.equal(result.revision, grouped.revision + 1);
  const changed = structuredClone(grouped); changed.revision++;
  changed.nodes.extra = { ...changed.nodes.a!, id: 'extra', parentId: 'group' }; changed.nodes.group!.children.push('extra');
  assert.throws(() => apply(changed, resize.operations, resize.preconditions, grouped), /precondition/);
});

test('unsupported grouping never mutates flow, responsive geometry, external CSS, order or locked trees', () => {
  for (const kind of ['flow', 'breakpoint', 'css', 'locked', 'transform'] as const) {
    const doc = fixture();
    if (kind === 'flow') doc.nodes.a!.layout.mode = 'flow';
    if (kind === 'breakpoint') { doc.breakpoints = [{ id: 'mobile', maxWidth: 767 }]; doc.nodes.a!.responsive = { mobile: { style: { width: 150 } } }; }
    if (kind === 'css') doc.sourceModules = [{ id: 'css', path: 'custom.css', language: 'css', source: 'div{padding:10px}' }];
    if (kind === 'locked') doc.nodes.b!.locked = true;
    if (kind === 'transform') doc.nodes.a!.style.rotate = '10deg';
    const before = structuredClone(doc); assert.throws(() => webGroupSelection(doc, ['a', 'b'], bounds, 'group')); assert.deepEqual(doc, before);
  }
  assert.throws(() => webGroupSelection(fixture(), ['a', 'c'], bounds, 'group'), /连续/);
  const doc = fixture(), batch = webGroupSelection(doc, ['a', 'b'], bounds, 'group'), grouped = apply(doc, batch.operations, batch.preconditions);
  grouped.nodes.group!.style.backgroundColor = '#ffffff'; assert.throws(() => webUngroup(grouped, 'group'), /外观/);
  grouped.nodes.b!.locked = true;
  assert.throws(() => apply(grouped, [{ type: 'web.style.update', nodeId: 'group', style: { left: 100 } }], []), /locked/);
});
