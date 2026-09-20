import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { ProjectRuntime, ProjectAssets } from '@oeydesign/runtime';
import { textFromString, type DeckNode, type DocumentOperation } from '@oeydesign/document';
import { exportDeckPptx, exportDeckPdf, renderDeckPng } from '@oeydesign/media';

const root = resolve(process.argv[2] ?? `.tmp/r2-acceptance-${Date.now()}`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let png: Buffer;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<style>body{margin:0}svg{display:block}</style><svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#315646"/><rect x="400" width="400" height="300" fill="#bcd5ac"/><rect y="300" width="400" height="300" fill="#d4aa72"/><rect x="400" y="300" width="400" height="300" fill="#ecede5"/><circle cx="400" cy="300" r="175" fill="none" stroke="white" stroke-width="6"/><path d="M0 0L800 600M800 0L0 600" stroke="white" stroke-width="3"/><text x="400" y="305" text-anchor="middle" font-size="34" fill="white">Original image · 800 × 600</text></svg>`);
  png = await page.screenshot();
} finally { await browser.close(); }
const runtime = ProjectRuntime.create(root, { name: 'R2 mixed Deck acceptance' });
try {
  const assets = new ProjectAssets(runtime);
  const asset = await assets.importImage(png, 'four-quadrants.png');
  const document = runtime.createDocument({ name: 'Shared ideas / 可编辑作品' });
  const first = document.pages[0]!.id;
  const base = (id: string, kind: DeckNode['kind'], parentId: string, x: number, y: number, width: number, height: number, rotation = 0): DeckNode => ({ id, kind, parentId, geometry: { x, y, width, height, rotation }, style: {}, hidden: false, locked: false });
  const text = (id: string, parent: string, value: string, x: number, y: number, size: number, width = 1000): DeckNode => ({ ...base(id, 'text', parent, x, y, width, size * 2.5), style: { fill: '#244d3b', fontFamily: 'Microsoft YaHei', fontSize: size }, content: textFromString(value) });
  const operations: DocumentOperation[] = [
    { type: 'asset.register', asset },
    { type: 'document.theme', theme: { name: 'Forest editorial', bodyFontFamily: 'Microsoft YaHei', colors: { accent1: '#315646', accent2: '#d4aa72', background1: '#ffffff' } } },
    { type: 'page.insert', page: { id: 'page-two', name: 'Evidence / 证据', width: 1280, height: 720, children: [] } },
    { type: 'page.insert', page: { id: 'page-three', name: 'Data / 数据', width: 1280, height: 720, children: [] } },
    { type: 'node.insert', node: text('title', first, 'Shared ideas.\n共同创作，从这里开始。', 72, 100, 48, 570) },
    { type: 'node.insert', node: { ...text('rich', first, '', 72, 315, 26, 520), content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { align: 'left', lineHeight: 38 }, content: [ { type: 'text', text: '可编辑的 ', marks: [{ type: 'strong' }] }, { type: 'text', text: '文字 · 图片 · 数据', marks: [{ type: 'em' }, { type: 'textStyle', attrs: { color: '#ac763f', fontSize: 28 } }] } ] },
      { type: 'paragraph', content: [{ type: 'text', text: '每次人工调整都保留在共享文档里。' }] },
    ] } } },
    { type: 'node.insert', node: { ...base('photo', 'image', first, 710, 130, 455, 440, 4), assetId: asset.id, image: { fit: 'cover', crop: { left: .1, top: .08, right: .15, bottom: .04 }, opacity: .88 } } },
    { type: 'node.insert', node: text('table-title', 'page-two', '让信息保持可修改', 72, 50, 42) },
    { type: 'node.insert', node: { ...base('table', 'table', 'page-two', 72, 170, 800, 360), table: { headerRows: 1, borderColor: '#ccd7c7', borderWidth: 1, cellPadding: 12, rows: [
      ['能力', '人工操作', '交付对象'], ['文字', '选区、字重与中文输入', '原生文本框'], ['图片', '裁切、透明度与替换', '原生图片'], ['数据', '表格单元格与系列编辑', '原生表格 / 图表'],
    ].map((row, r) => ({ id: `row-${r}`, height: 90, cells: row.map((value, c) => ({ id: `cell-${r}-${c}`, content: textFromString(value), style: { fontSize: 23, fill: r ? '#f2f5ed' : '#315646', color: r ? '#244d3b' : '#ffffff' } })) })) } } },
    { type: 'node.insert', node: { ...base('rotated-group', 'group', 'page-two', 965, 280, 220, 200, 15), children: [] } },
    { type: 'node.insert', node: { ...base('group-shape', 'shape', 'rotated-group', 0, 0, 210, 150), style: { fill: '#d4aa72', cornerRadius: 20 } } },
    { type: 'node.insert', node: text('group-text', 'rotated-group', '同一份历史', 16, 40, 28, 180) },
    { type: 'node.insert', node: text('charts-title', 'page-three', '让数据继续说话', 72, 50, 42) },
    ...(['bar', 'line', 'pie'] as const).map((type, index): DocumentOperation => ({ type: 'node.insert', node: { ...base(`chart-${type}`, 'chart', 'page-three', 60 + index * 410, 190, 380, 380), chart: { type, title: type.toUpperCase(), categories: ['第一阶段', '第二阶段', '第三阶段'], series: [{ id: 'series-main', name: '覆盖能力', values: [12, 24, 38], color: '#315646' }], legend: true, dataLabels: true } } })),
  ];
  runtime.submit(runtime.makeCommand(document.documentId, operations, { label: 'Three-page acceptance fixture' }));
  const final = runtime.readDocument(document.documentId);
  await mkdir(join(root, 'exports'), { recursive: true });
  await writeFile(join(root, 'exports', 'mixed.pptx'), await exportDeckPptx(final, assets.resolve));
  await writeFile(join(root, 'exports', 'mixed.pdf'), await exportDeckPdf(final, assets.resolve));
  for (const page of final.pages) await writeFile(join(root, 'exports', `${page.id}.png`), await renderDeckPng(final, page.id, assets.resolve));
  await writeFile(join(root, 'fixture.json'), JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ root, documentId: final.documentId, revision: final.revision, pages: final.pages.length, pptx: join(root, 'exports', 'mixed.pptx') }));
} finally { runtime.close(); }
