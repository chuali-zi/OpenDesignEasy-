import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebDocument, applyWebCommand } from '@oeydesign/document';
import type { CommandEnvelope } from '@oeydesign/document';
import { nextWebSelection, webBatchStyles, webAlignmentOperations, webAlignmentPreconditions } from '../src/web-selection.ts';

function fixture() {
  const doc = createWebDocument({ documentId: 'web-selection', name: 'Selection' });
  const root = doc.pages[0]!.rootId;
  for (const [id, left, top] of [['a', 20, 20], ['b', 160, 80], ['c', 320, 150]] as const) {
    doc.nodes[root]!.children.push(id);
    doc.nodes[id] = { id, parentId: root, tag: 'div', children: [], style: { left, top, width: 100, height: 60 }, layout: { mode: 'position', position: 'absolute' } };
  }
  return doc;
}
const boxes = { a: { x: 20, y: 20, width: 100, height: 60, marginLeft: 0, marginTop: 0 }, b: { x: 160, y: 80, width: 100, height: 60, marginLeft: 0, marginTop: 0 }, c: { x: 320, y: 150, width: 100, height: 60, marginLeft: 0, marginTop: 0 } };

test('additive selection toggles membership and ordinary selection replaces it', () => {
  assert.deepEqual(nextWebSelection(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(nextWebSelection(['a', 'b'], 'a', true), ['b']);
  assert.deepEqual(nextWebSelection(['a', 'b'], 'c'), ['c']);
  assert.deepEqual(nextWebSelection(['a'], ''), []);
});

test('alignment and distribution preserve layout/dimensions and form one document command', () => {
  const doc = fixture();
  const operations = webAlignmentOperations(doc, ['a', 'b', 'c'], boxes, 'top');
  const command: CommandEnvelope = { commandId: 'align', projectId: 'project', documentId: doc.documentId, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Align three', operations };
  const next = applyWebCommand(doc, command, doc).document;
  assert.equal(next.revision, 1);
  for (const id of ['a', 'b', 'c']) { assert.equal(next.nodes[id]!.style.top, 20); assert.equal(next.nodes[id]!.style.width, 100); assert.deepEqual(next.nodes[id]!.layout, doc.nodes[id]!.layout); }
  const distributed = webAlignmentOperations(doc, ['a', 'b', 'c'], boxes, 'distribute-x');
  assert.deepEqual(distributed.map(op => op.type === 'web.style.update' && op.style.left), [20, 170, 320]);
  const margin = { ...boxes, b: { ...boxes.b, marginLeft: 10 } };
  const marginOp = webAlignmentOperations(doc, ['a', 'b'], margin, 'left')[1]!;
  assert.equal(marginOp.type, 'web.style.update');
  if (marginOp.type === 'web.style.update') assert.equal(marginOp.style.left, 10);
});

test('mixed flow, rotated, hidden, locked, different-parent and missing selections refuse alignment', () => {
  for (const kind of ['flow', 'rotate', 'hidden', 'locked', 'parent', 'relative', 'percent'] as const) {
    const doc = fixture(); const b = doc.nodes.b!;
    if (kind === 'flow') b.layout.mode = 'flow';
    if (kind === 'rotate') b.style.rotate = '10deg';
    if (kind === 'hidden') b.hidden = true;
    if (kind === 'locked') doc.nodes[doc.pages[0]!.rootId]!.locked = true;
    if (kind === 'parent') b.parentId = 'another-parent';
    if (kind === 'relative') b.layout.position = 'relative';
    if (kind === 'percent') b.style.width = '50%';
    assert.throws(() => webAlignmentOperations(doc, ['a', 'b'], boxes, 'left'));
  }
  assert.throws(() => webAlignmentOperations(fixture(), ['a', 'missing'], boxes, 'left'));
});

test('batch style respects responsive scope, refuses locks, and concurrent conflicts remain atomic', () => {
  const base = fixture(); base.breakpoints = [{ id: 'mobile', maxWidth: 767 }];
  const ops = webBatchStyles(base, ['a', 'b'], { color: '#225544' }, 'mobile');
  assert.ok(ops.every(op => op.type === 'web.style.update' && op.breakpointId === 'mobile'));
  const command: CommandEnvelope = { commandId: 'batch', projectId: 'project', documentId: base.documentId, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Batch colors', operations: ops };
  const next = applyWebCommand(base, command, base).document;
  assert.equal(next.nodes.a!.responsive!.mobile!.style!.color, '#225544'); assert.equal(next.nodes.a!.style.color, undefined);
  const latest = structuredClone(base); latest.revision = 1; latest.nodes.b!.responsive = { mobile: { style: { color: '#991122' } } };
  assert.throws(() => applyWebCommand(latest, command, base), /conflict|changed/i);
  assert.equal(latest.nodes.a!.responsive?.mobile?.style?.color, undefined);
  latest.nodes.a!.locked = true; assert.throws(() => webBatchStyles(latest, ['a', 'b'], { color: '#123456' }));
});

test('measured alignment rejects changed dimensions, ancestor layouts or CSS before updating any member', () => {
  const base = fixture();
  const command: CommandEnvelope = { commandId: 'measured', projectId: 'project', documentId: base.documentId, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0,
    preconditions: webAlignmentPreconditions(base, ['a', 'b']), label: 'Measured align', operations: webAlignmentOperations(base, ['a', 'b'], boxes, 'left') };
  for (const change of ['width', 'parent', 'css'] as const) {
    const latest = structuredClone(base); latest.revision = 1;
    if (change === 'width') latest.nodes.b!.style.width = 140;
    if (change === 'parent') latest.nodes[base.pages[0]!.rootId]!.style.padding = 20;
    if (change === 'css') latest.sourceModules = [{ id: 'styles', path: 'styles.css', language: 'css', source: 'div{margin-left:10px}' }];
    assert.throws(() => applyWebCommand(latest, command, base), /precondition|projection/i);
    assert.equal(latest.nodes.b!.style.left, 160);
  }
  const unrelated = structuredClone(base); unrelated.revision = 1; unrelated.name = 'Unrelated title change';
  assert.equal(applyWebCommand(unrelated, command, base).document.nodes.b!.style.left, 20);
});
