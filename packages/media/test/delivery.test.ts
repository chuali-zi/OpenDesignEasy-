import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditableCommand, createDeckDocument, createDocDocument, createWebDocument, textFromString } from '@oeydesign/document';
import type { DocumentOperation, EditableDocument } from '@oeydesign/document';
import { inspectDelivery } from '../src/delivery.ts';

function apply<T extends EditableDocument>(document: T, operations: DocumentOperation[]): T {
  return applyEditableCommand(document, { commandId: crypto.randomUUID(), projectId: 'p', documentId: document.documentId, actorId: 'test', actorKind: 'human', clientId: 'test', baseRevision: document.revision, preconditions: [], label: 'Fixture', operations }, document).document as T;
}

test('Deck checks rotated nested world geometry and ignores hidden placeholder content', () => {
  let document = createDeckDocument({ documentId: 'd', name: 'Geometry', pageId: 'p' });
  document = apply(document, [
    { type: 'node.insert', node: { id: 'group', kind: 'group', parentId: 'p', children: [], geometry: { x: 100, y: 200, width: 100, height: 100, rotation: 90 }, style: {}, hidden: false, locked: false } },
    { type: 'node.insert', node: { id: 'rotated', kind: 'shape', parentId: 'group', geometry: { x: 0, y: 0, width: 50, height: 200, rotation: 0 }, style: {}, hidden: false, locked: false } },
    { type: 'node.insert', node: { id: 'hidden', kind: 'text', parentId: 'p', geometry: { x: -100, y: -100, width: 100, height: 100, rotation: 0 }, style: {}, hidden: true, locked: false, content: textFromString('TODO') } },
  ]);
  const report = inspectDelivery(document, 'pptx');
  assert.deepEqual(report.map(item => [item.code, item.location.nodeId]), [['deck.page-overflow', 'rotated']]);
});

test('Doc checks section body width, formatted placeholder runs, tables and header/footer locations', () => {
  let document = createDocDocument({ documentId: 'doc', name: 'Width' }); const sectionId = document.sections[0]!.id;
  document = apply(document, [
    { type: 'doc.text.apply', sectionId, steps: [{ stepType: 'replace', from: 0, to: 2, slice: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TO' }, { type: 'text', text: 'DO', marks: [{ type: 'strong' }] }] }, { type: 'table', attrs: { columnWidths: [400, 400] }, content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph' }] }, { type: 'table_cell', content: [{ type: 'paragraph' }] }] }] }] } }] },
    { type: 'doc.text.apply', sectionId, part: 'footer', steps: [{ stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: '待核实' }] } }] },
  ]);
  const report = inspectDelivery(document, 'docx');
  assert.ok(report.some(item => item.code === 'doc.body-overflow'));
  assert.equal(report.filter(item => item.code === 'content.placeholder').length, 2);
  assert.ok(report.some(item => item.location.part === 'footer'));
});

test('Web warns about placeholder actions and single-page export without claiming responsive layout was measured', () => {
  let document = createWebDocument({ documentId: 'web', name: 'Web', pageId: 'home', rootId: 'root' });
  document = apply(document, [
    { type: 'web.node.insert', node: { id: 'link', parentId: 'root', tag: 'a', children: [], layout: { mode: 'flow' }, style: {}, props: { href: '#' }, text: '联系' } },
    { type: 'web.page.insert', page: { id: 'about', name: 'About', route: '/about', rootId: 'about-root' }, root: { id: 'about-root', parentId: null, tag: 'main', children: [], layout: { mode: 'flow' }, style: {} } },
  ]);
  assert.deepEqual(inspectDelivery(document, 'html').map(item => item.code), ['web.link-placeholder', 'web.single-page-export']);
  assert.equal(inspectDelivery(document, 'zip').some(item => item.code === 'web.single-page-export'), false);
});
