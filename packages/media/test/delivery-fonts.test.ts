import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeckDocument, createDocDocument, createWebDocument, textFromString } from '@oeydesign/document';
import { classifyFont, deliveryRenderer, fontFindings, inspectDeliveryFonts } from '../src/delivery-fonts.ts';
import { exportDocDocx } from '../src/doc.ts';
import { exportDeckPptx } from '../src/pptx.ts';
import JSZip from 'jszip';

const actual = (family: string) => [{ family, postScriptName: family, glyphs: 8 }];
test('font inventory distinguishes exact names, aliases, generic choice, missing families and per-script fallback', () => {
  const inventory = [['noto sans cjk sc'], ['latin family', 'localized alias']];
  assert.deepEqual(classifyFont('Missing, "Noto Sans CJK SC"', actual('Noto Sans CJK SC'), inventory), { availability: 'missing', fallback: true });
  assert.deepEqual(classifyFont('Latin Family, sans-serif', actual('Noto Sans CJK SC'), inventory), { availability: 'available', fallback: true });
  assert.deepEqual(classifyFont('Latin Family', [...actual('Latin Family'), ...actual('Noto Sans CJK SC')], inventory), { availability: 'available', fallback: true });
  assert.deepEqual(classifyFont('"Localized Alias"', actual('Latin Family'), inventory), { availability: 'available', fallback: false });
  assert.deepEqual(classifyFont('system-ui, sans-serif', actual('Device Font'), inventory), { availability: 'generic', fallback: false });
  assert.equal(classifyFont('Windows Font', actual('Windows Font')).availability, 'unknown');
});

test('renderer disclosure distinguishes OOXML generation, browser rendering and configured native PDF without claiming a completed export', () => {
  const doc = createDocDocument({ documentId: 'renderer', name: 'Renderer' });
  assert.match(deliveryRenderer(doc, 'docx').detail, /不渲染文字/);
  assert.equal(deliveryRenderer(doc, 'png').engine, 'Chromium');
  const previous = process.env.OEY_DOCX_RENDERER;
  try {
    process.env.OEY_DOCX_RENDERER = '/synthetic/unused/soffice';
    const planned = deliveryRenderer(doc, 'pdf');
    assert.equal(planned.engine, 'LibreOffice'); assert.equal(planned.phase, 'planned');
    assert.match(planned.detail, /不是 Microsoft Word/);
  } finally { if (previous === undefined) delete process.env.OEY_DOCX_RENDERER; else process.env.OEY_DOCX_RENDERER = previous; }
});

for (const kind of ['doc', 'deck', 'web'] as const) test(`${kind}: real Chromium glyph evidence preserves mixed Chinese text, overrides, locations and editable declarations`, async () => {
  const document = kind === 'doc' ? createDocDocument({ documentId: 'font-doc', name: '字体报告' }) : kind === 'deck'
    ? createDeckDocument({ documentId: 'font-deck', name: '字体幻灯片', pageId: 'p' }) : createWebDocument({ documentId: 'font-web', name: '字体网页', pageId: 'p', rootId: 'root' });
  const mixed = '中文排版 English 2026，标点与 Bold 粗体。';
  if (document.kind === 'doc') {
    document.sections[0]!.content = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: mixed, marks: [{ type: 'strong' }, { type: 'textStyle', attrs: { fontFamily: 'OEY Missing Synthetic' } }] }] }] };
    document.sections[0]!.footer = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'footer' }, content: [{ type: 'text', text: '页脚中文 English' }] }] };
    document.content = document.sections[0]!.content;
  } else if (document.kind === 'deck') {
    document.nodes.title = { id: 'title', kind: 'text', parentId: 'p', geometry: { x: 60, y: 60, width: 1000, height: 300, rotation: 0 }, style: { fontFamily: 'OEY Missing Synthetic', fontSize: 32 }, hidden: false, locked: false, content: textFromString(mixed) };
    document.pages[0]!.children.push('title');
  } else {
    document.nodes.root!.children.push('title');
    document.nodes.root!.style = { fontFamily: 'OEY Missing Synthetic' };
    document.nodes.title = { id: 'title', parentId: 'root', tag: 'p', children: [], layout: { mode: 'flow' }, style: { marginTop: 1800 }, text: mixed };
  }
  const before = structuredClone(document);
  const fonts = await inspectDeliveryFonts(document);
  assert.equal(fonts.probe, 'measured', fonts.detail); assert.equal(fonts.complete, true, fonts.detail);
  const run = fonts.runs.find(run => run.sample === mixed)!;
  assert.ok(run); assert.match(run.declared, /OEY Missing Synthetic/); assert.ok(run.actual.some(font => font.glyphs > 0));
  assert.ok(!run.actual.some(font => font.family === 'OEY Missing Synthetic'));
  assert.equal(run.fallback, true);
  if (process.platform === 'linux' && fonts.inventory === 'fontconfig') assert.equal(run.availability, 'missing');
  assert.equal(run.location.nodeId, kind === 'doc' ? 'paragraph' : 'title');
  assert.ok(fontFindings(fonts).some(finding => finding.code === 'font.substitution' && finding.location.nodeId === run.location.nodeId));
  if (kind === 'doc') {
    assert.equal(run.weight, '700');
    assert.ok(fonts.runs.some(run => run.location.part === 'footer' && run.location.nodeId === 'footer'));
  }
  if (document.kind !== 'web') {
    const bytes = document.kind === 'doc' ? await exportDocDocx(document) : await exportDeckPptx(document);
    const zip = await JSZip.loadAsync(bytes);
    assert.match(await zip.file(document.kind === 'doc' ? 'word/document.xml' : 'ppt/slides/slide1.xml')!.async('string'), /OEY Missing Synthetic/);
    const renderer = deliveryRenderer(document, document.kind === 'doc' ? 'docx' : 'pptx');
    assert.equal(renderer.phase, 'planned'); assert.match(renderer.detail, /不渲染文字/);
  }
  assert.deepEqual(document, before);
});

test('font measurement reports explicit limits for hidden text, unmanaged components, run limits and cancellation', async () => {
  const document = createWebDocument({ documentId: 'limits', name: 'Limits', pageId: 'p', rootId: 'root' });
  document.nodes.root!.text = '可见中文 English';
  document.nodes.root!.children.push('hidden');
  document.nodes.hidden = { id: 'hidden', parentId: 'root', tag: 'p', children: [], layout: { mode: 'flow' }, style: {}, hidden: true, text: '隐藏文字' };
  let fonts = await inspectDeliveryFonts(document);
  assert.ok(!fonts.runs.some(run => run.sample.includes('隐藏')));
  document.nodes.root!.content = { type: 'doc', content: [{ type: 'paragraph', content: Array.from({ length: 260 }, (_, index) => ({ type: 'text', text: `中文${index}`, marks: index % 2 ? [{ type: 'strong' }] : [] })) }] };
  delete document.nodes.root!.text;
  fonts = await inspectDeliveryFonts(document);
  assert.equal(fonts.runs.length, 256); assert.equal(fonts.complete, false);
  assert.ok(fontFindings(fonts).some(finding => finding.code === 'font.unverified'));
  document.nodes.root!.component = { moduleId: 'component', exportName: 'App' };
  fonts = await inspectDeliveryFonts(document);
  assert.equal(fonts.probe, 'not-run'); assert.equal(fonts.complete, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectDeliveryFonts(document, undefined, controller.signal), /abort/i);
});
