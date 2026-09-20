import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeckDocument, textFromString, type DeckNode } from '@oeydesign/document';
import { renderDeckSvg } from '../src/index.ts';

test('headless preview retains geometry, revision and escaped text without mutating the document', async () => {
  const document = createDeckDocument({ documentId: 'deck', name: '演示 <one>', pageId: 'page' });
  document.revision = 3;
  document.pages[0]!.children.push('title');
  document.nodes.title = { id: 'title', parentId: 'page', kind: 'text', geometry: { x: 20, y: 30, width: 500, height: 80, rotation: 15 },
    locked: false, hidden: false, style: {}, content: textFromString('中文 <script>&标题') };
  const before = structuredClone(document);
  const svg = await renderDeckSvg(document);
  assert.match(svg, /data-revision="3"/);
  assert.match(svg, /translate\(20 30\) rotate\(15\)/);
  assert.match(svg, /中文 &lt;script&gt;&amp;标题/);
  assert.doesNotMatch(svg, /<script>/);
  assert.deepEqual(document, before);
});

test('SVG previews rich text, resolved images, tables and all three editable chart types', async () => {
  const document = createDeckDocument({ documentId: 'r2-preview', name: 'R2 preview' });
  document.pages.push(
    { id: 'table-page', name: 'Table', width: 640, height: 360, children: [] },
    { id: 'chart-page', name: 'Charts', width: 1280, height: 360, children: [] },
  );
  document.theme = { fontFamily: 'Georgia', colors: { accent1: '#315646', text1: '#18221C' } };
  document.assets = [{ id: 'image-asset', kind: 'image', mimeType: 'image/png', width: 1, height: 1 }];
  const put = (node: DeckNode) => { document.nodes[node.id] = node; document.pages.find(page => page.id === node.parentId)!.children.push(node.id); };
  put({ id: 'image', kind: 'image', parentId: document.pages[0]!.id, assetId: 'image-asset', image: { fit: 'cover', opacity: 0.4 },
    geometry: { x: 20, y: 20, width: 120, height: 80, rotation: 4 }, style: {}, locked: false, hidden: false });
  put({ id: 'text', kind: 'text', parentId: document.pages[0]!.id, geometry: { x: 160, y: 20, width: 420, height: 140, rotation: 0 },
    style: { fontSize: 24, fontFamily: 'Georgia' }, locked: false, hidden: false,
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { align: 'center', lineHeight: 32 }, content: [
      { type: 'text', text: 'Styled', marks: [{ type: 'strong' }, { type: 'underline' }, { type: 'textStyle', attrs: { color: '#C05621', fontSize: 28 } }] },
    ] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] }] } });
  put({ id: 'table', kind: 'table', parentId: 'table-page', geometry: { x: 20, y: 20, width: 600, height: 250, rotation: 0 }, style: {}, locked: false, hidden: false,
    table: { headerRows: 1, rows: [{ id: 'row-1', cells: [
      { id: 'cell-1', content: textFromString('Head') },
      { id: 'cell-2', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich cell', marks: [{ type: 'em' }, { type: 'textStyle', attrs: { color: '#3182CE' } }] }] }] } },
    ] }, { id: 'row-2', cells: [{ id: 'cell-3', content: textFromString('Q1') }, { id: 'cell-4', content: textFromString('42') }] }] } });
  for (const [index, type] of (['bar', 'line', 'pie'] as const).entries()) {
    put({ id: `chart-${type}`, kind: 'chart', parentId: 'chart-page', geometry: { x: index * 420, y: 20, width: 400, height: 320, rotation: 0 }, style: {}, locked: false, hidden: false,
      chart: { type, title: type, categories: ['A', 'B', 'C'], series: [{ id: 's', name: 'Sales', values: [10, 20, 30], color: '#315646' }], legend: true, dataLabels: true } });
  }
  const svg = await renderDeckSvg(document, document.pages[0]!.id, async id => {
    assert.equal(id, 'image-asset');
    return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ks8AAAAASUVORK5CYII=', 'base64'));
  });
  assert.match(svg, /<image href="data:image\/png;base64,/);
  assert.match(svg, /opacity="0.4"/);
  assert.match(svg, /font-family:Georgia/);
  assert.match(svg, /<span style="color:#C05621;font-family:Georgia;font-size:28px;font-weight:700;text-decoration-line:underline">Styled<\/span>/);
  assert.match(svg, /text-decoration-line:underline/);
  assert.match(svg, /<p style="margin:0">/);

  const tableSvg = await renderDeckSvg(document, 'table-page');
  assert.match(tableSvg, /data-cell-id="cell-2"/);
  assert.match(tableSvg, /<span style="color:#3182CE;font-family:Georgia;font-size:16px;font-weight:700;font-style:italic">Rich cell<\/span>/);
  const chartsSvg = await renderDeckSvg(document, 'chart-page');
  assert.match(chartsSvg, /data-category="A"/);
  assert.match(chartsSvg, /<polyline/);
  assert.match(chartsSvg, /<path d="M/);
  assert.match(chartsSvg, /data-legend-item="Sales"/);
  assert.match(chartsSvg, /data-legend-item="A"/);
  assert.match(chartsSvg, />30<\/text>/);
});
