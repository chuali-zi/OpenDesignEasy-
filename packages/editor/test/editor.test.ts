import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommand, createDeckDocument, textToString, validateDocument,
  type CommandEnvelope, type DeckDocument, type DocumentOperation,
} from '@oeydesign/document';
import { makeCoverOperations, makePageInsert, makeShapeInsert, makeTextInsert, makeTextReplacementSteps } from '../src/operations.ts';

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
