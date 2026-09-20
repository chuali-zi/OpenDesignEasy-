import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommand, createDeckDocument, textFromString, textSchema, textToString, validateDocument,
  type CommandEnvelope, type DeckDocument, type DocumentOperation,
} from '@oeydesign/document';
import { Transform } from 'prosemirror-transform';
import { makeChartInsert, makeCoverOperations, makeImageInsert, makePageInsert, makeShapeInsert, makeTableInsert, makeTextInsert, makeTextReplacementSteps } from '../src/operations.ts';

function command(document: DeckDocument, operations: DocumentOperation[]): CommandEnvelope {
  return {
    commandId: crypto.randomUUID(), projectId: 'project', documentId: document.documentId,
    actorId: 'editor', actorKind: 'human', clientId: 'editor-test', baseRevision: document.revision,
    preconditions: [], operations, label: 'editor test',
  };
}

test('editor inserts editable text and shapes through document operations', () => {
  const document = createDeckDocument({ documentId: 'deck', name: 'Editor' });
  const pageId = document.pages[0]!.id;
  const text = makeTextInsert(pageId, { x: 160, y: 90 }, 'First line\nSecond line');
  const shape = makeShapeInsert(pageId, { x: 100, y: 260 });
  assert.equal(text.type, 'node.insert');
  assert.equal(shape.type, 'node.insert');
  const result = applyCommand(document, command(document, [text, shape]), document).document;
  validateDocument(result);
  assert.equal(result.revision, 1);
  assert.equal(result.pages[0]!.children.length, 2);
  assert.equal(Object.values(result.nodes).filter(node => node.kind === 'text').length, 1);
  assert.equal(Object.values(result.nodes).filter(node => node.kind === 'shape').length, 1);
});

test('plain text editing replaces ProseMirror content while preserving paragraph breaks', () => {
  const document = createDeckDocument({ documentId: 'deck', name: 'Editor' });
  const pageId = document.pages[0]!.id;
  const inserted = applyCommand(document, command(document, [makeTextInsert(pageId, { x: 40, y: 50 }, 'before')]), document).document;
  const textNode = Object.values(inserted.nodes).find(node => node.kind === 'text')!;
  const steps = makeTextReplacementSteps(textNode.content!, 'A new heading\nWith a second line');
  const updated = applyCommand(inserted, command(inserted, [{ type: 'text.apply', nodeId: textNode.id, steps }]), inserted).document;
  validateDocument(updated);
  assert.equal(textToString(updated.nodes[textNode.id]!.content!), 'A new heading\nWith a second line');
});

test('the sample cover is a valid single-batch editable design and pages inherit the deck size', () => {
  const document = createDeckDocument({ documentId: 'deck', name: 'Editor' });
  const page = document.pages[0]!;
  const cover = makeCoverOperations(page.id, page.width, page.height);
  const designed = applyCommand(document, command(document, cover.operations), document).document;
  validateDocument(designed);
  assert.equal(designed.revision, 1);
  assert.ok(designed.nodes[cover.focusNodeId]);
  assert.equal(designed.pages[0]!.children.length, cover.operations.length);

  const addition = makePageInsert(designed, 'Page 2');
  const withPage = applyCommand(designed, command(designed, [addition.operation]), designed).document;
  assert.deepEqual(withPage.pages[1], { id: addition.pageId, name: 'Page 2', width: page.width, height: page.height, children: [] });
});

test('rich-text marks and paragraph attributes serialize as kernel-compatible steps', () => {
  const document = createDeckDocument({ documentId: 'deck', name: 'Editor' });
  const pageId = document.pages[0]!.id;
  const inserted = applyCommand(document, command(document, [makeTextInsert(pageId, { x: 20, y: 30 }, 'Styled text')]), document).document;
  const node = Object.values(inserted.nodes).find(candidate => candidate.kind === 'text')!;
  const content = textSchema.nodeFromJSON(node.content!);
  const transform = new Transform(content);
  transform.addMark(1, content.firstChild!.content.size + 1, textSchema.marks.strong.create());
  transform.addMark(1, content.firstChild!.content.size + 1, textSchema.marks.textStyle.create({ color: '#a5422f', fontFamily: 'Georgia', fontSize: 31, backgroundColor: null }));
  transform.setNodeMarkup(0, undefined, { ...transform.doc.firstChild!.attrs, align: 'center', lineHeight: 36, spaceAfter: 12, indent: 8, firstLineIndent: 4 });
  const result = applyCommand(inserted, command(inserted, [{ type: 'text.apply', nodeId: node.id, steps: transform.steps.map(step => step.toJSON()) }]), inserted).document;
  validateDocument(result);
  const paragraph = result.nodes[node.id]!.content!.content![0]!;
  assert.deepEqual({ ...paragraph.attrs }, { align: 'center', lineHeight: 36, spaceBefore: null, spaceAfter: 12, indent: 8, firstLineIndent: 4 });
  assert.deepEqual(paragraph.content![0]!.marks?.map(mark => ({ type: mark.type, ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}) })), [
    { type: 'strong' }, { type: 'textStyle', attrs: { color: '#a5422f', fontFamily: 'Georgia', fontSize: 31, backgroundColor: null } },
  ]);
});

test('tables, charts, and images use structured data operations and immutable asset metadata', () => {
  const document = createDeckDocument({ documentId: 'deck', name: 'Editor' });
  const page = document.pages[0]!;
  const asset = { id: 'cover-image', kind: 'image' as const, mimeType: 'image/png' as const, width: 640, height: 480, name: 'cover.png' };
  const operations = [
    makeTableInsert(page.id, { x: 40, y: 50 }),
    makeChartInsert(page.id, { x: 470, y: 50 }),
    ...makeImageInsert(page.id, { x: 140, y: 360 }, asset),
  ];
  const result = applyCommand(document, command(document, operations), document).document;
  validateDocument(result);
  assert.equal(Object.values(result.nodes).filter(node => node.kind === 'table').length, 1);
  assert.equal(Object.values(result.nodes).find(node => node.kind === 'table')!.table!.rows.length, 3);
  assert.equal(Object.values(result.nodes).find(node => node.kind === 'chart')!.chart!.series.length, 2);
  assert.equal(result.nodes[Object.values(result.nodes).find(node => node.kind === 'image')!.id]!.assetId, asset.id);
  const assetIds = Array.isArray(result.assets) ? result.assets.map(item => item.id) : Object.keys(result.assets ?? {});
  assert.ok(assetIds.includes(asset.id));

  const replacement = { ...asset, id: 'cover-image-v2', width: 800, height: 600 };
  const imageNode = Object.values(result.nodes).find(node => node.kind === 'image')!;
  const replaced = applyCommand(result, command(result, [{ type: 'asset.replace', nodeId: imageNode.id, asset: replacement }]), result).document;
  validateDocument(replaced);
  assert.equal(replaced.nodes[imageNode.id]!.assetId, replacement.id);
  const replacedAssetIds = Array.isArray(replaced.assets) ? replaced.assets.map(item => item.id) : Object.keys(replaced.assets ?? {});
  assert.ok(replacedAssetIds.includes(asset.id));
  assert.ok(replacedAssetIds.includes(replacement.id));
});
