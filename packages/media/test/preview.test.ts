import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeckDocument, textFromString } from '@oeydesign/document';
import { renderDeckSvg } from '../src/index.ts';

test('headless preview retains geometry, revision and escaped text without mutating the document', () => {
  const document = createDeckDocument({ documentId: 'deck', name: '演示 <one>', pageId: 'page' });
  document.revision = 3;
  document.pages[0]!.children.push('title');
  document.nodes.title = { id: 'title', parentId: 'page', kind: 'text', geometry: { x: 20, y: 30, width: 500, height: 80, rotation: 15 },
    locked: false, hidden: false, style: {}, content: textFromString('中文 <script>&标题') };
  const before = structuredClone(document);
  const svg = renderDeckSvg(document);
  assert.match(svg, /data-revision="3"/);
  assert.match(svg, /translate\(20 30\) rotate\(15\)/);
  assert.match(svg, /中文 &lt;script&gt;&amp;标题/);
  assert.doesNotMatch(svg, /<script>/);
  assert.deepEqual(document, before);
});
