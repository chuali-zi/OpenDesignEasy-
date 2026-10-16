import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { EditableDocument, DocumentOperation } from '@oeydesign/document';
import type { DeliveryReport } from '@oeydesign/media';
import { evidencePath } from './evidence.ts';

const chinese = '中文字体检查：正文与黑色加粗标题。';
const mixed = '中英混排 English 2026：编辑后重新检查，保留原文。';
const content = { type: 'doc', content: [chinese, mixed].map((text, index) => ({ type: 'paragraph', attrs: { id: `font-block-${index}` }, content: [{ type: 'text', text, marks: [...(index ? [{ type: 'strong' }] : []), { type: 'textStyle', attrs: { fontFamily: 'OEY Missing Synthetic' } }] }] })) };

for (const kind of ['doc', 'deck', 'web'] as const) test(`${kind}: locate font substitution, repair in UI, undo, reopen and recheck real glyph evidence`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1920, height: 1250 }); await page.goto('/');
  const project = (await (await page.request.get('/api/project')).json()).project;
  const document = (await (await page.request.post('/api/documents', { data: { kind, name: `${kind} · 中文与中英混排字体检查` } })).json()).document as EditableDocument;
  const id = document.documentId, directory = evidencePath('font-delivery'); await mkdir(directory, { recursive: true });
  const operations: DocumentOperation[] = document.kind === 'doc' ? [{ type: 'doc.text.apply', sectionId: document.sections[0]!.id, steps: [{ stepType: 'replace', from: 0, to: 2, slice: { content: content.content } }] }]
    : document.kind === 'deck' ? [{ type: 'node.insert', node: { id: 'font-issue', kind: 'text', parentId: document.pages[0]!.id, geometry: { x: 80, y: 120, width: 1100, height: 400, rotation: 0 }, style: { fontFamily: 'Noto Sans CJK SC', fontSize: 32, color: '#000000' }, hidden: false, locked: false, content } }]
      : [{ type: 'web.style.update', nodeId: document.pages[0]!.rootId, style: { padding: 48, maxWidth: 960, margin: '0 auto', color: '#000000' } }, { type: 'web.node.insert', node: { id: 'font-issue', parentId: document.pages[0]!.rootId, tag: 'div', children: [], style: { fontFamily: 'Noto Sans CJK SC', fontSize: 20 }, layout: { mode: 'flow' }, content } }];
  expect((await page.request.post('/api/commands', { data: { commandId: crypto.randomUUID(), projectId: project.projectId, documentId: id, actorId: 'synthetic', actorKind: 'human', clientId: 'font-test', baseRevision: 0, preconditions: [], label: '固定离线字体样例', operations } })).status()).toBe(200);
  const read = async (): Promise<EditableDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const check = async (): Promise<DeliveryReport> => (await (await page.request.get(`/api/documents/${id}/delivery-check`)).json()).report;
  await expect(page.getByLabel('选择文档').locator(`option[value="${id}"]`)).toHaveCount(1); await page.getByLabel('选择文档').selectOption(id);
  const before = await read(), original = await check();
  expect(original.fonts?.probe).toBe('measured'); expect(original.fonts?.complete).toBe(true);
  expect(original.fonts?.runs.some(run => run.sample === chinese && run.fallback)).toBe(true);
  expect(original.fonts?.runs.some(run => run.sample === mixed && run.weight === '700')).toBe(true);
  const dialog = page.getByRole('dialog', { name: '交付检查', exact: true });
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '交付检查', exact: true }).click();
    await expect(dialog.getByLabel('字体检查')).toContainText('声明字体不等于实际使用字体');
    await expect(dialog.getByLabel('字体检查')).toContainText('Chromium');
    await expect(dialog.getByLabel('交付渲染器')).toContainText(kind === 'doc' ? 'docx / OOXML' : kind === 'deck' ? 'PptxGenJS / OOXML' : 'OEY HTML / source');
    const finding = dialog.locator('.delivery-findings li').filter({ hasText: '声明 "OEY Missing Synthetic"' }).first();
    await expect(finding.getByRole('button', { name: '定位问题' })).toBeEnabled();
    if (!index) await dialog.screenshot({ path: `${directory}/${kind}-font-warning.png` });
    await finding.getByRole('button', { name: '定位问题' }).click(); await expect(dialog).not.toBeVisible();
    expect(await read()).toEqual(before);
  }
  if (kind === 'web') await page.getByRole('button', { name: '编辑富文本', exact: true }).click();
  const editor = page.getByLabel('富文本内容'); await expect(editor).toContainText(chinese);
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.getByLabel('字体', { exact: true }).selectOption('Noto Sans CJK SC');
  await expect.poll(async () => (await read()).revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await read()).revision).toBe(before.revision + 2);
  expect((await check()).findings.some(finding => finding.code === 'font.substitution')).toBe(true);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await read()).revision).toBe(before.revision + 3);
  const fixed = await read();
  if (fixed.kind === 'doc' && before.kind === 'doc') { expect(fixed.pageSettings).toEqual(before.pageSettings); expect(fixed.styles).toEqual(before.styles); }
  if (fixed.kind === 'deck' && before.kind === 'deck') expect(fixed.pages).toEqual(before.pages);
  await page.reload(); await page.getByRole('button', { name: '交付检查', exact: true }).click();
  await expect(dialog).toContainText('未发现已知结构问题');
  const repaired = await check(); expect(repaired.fonts?.runs.every(run => !run.fallback && run.actual.every(font => font.family === 'Noto Sans CJK SC'))).toBe(true);
  await dialog.getByRole('button', { name: '关闭交付检查' }).click();
  await page.screenshot({ path: `${directory}/${kind}-font-repaired-editor.png`, fullPage: true });
  await page.getByRole('button', { name: '交付检查', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeEnabled();
  const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载交付包' }).dblclick();
  const download = await downloaded, bytes = await readFile((await download.path())!), zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file('delivery.json')!.async('string')), artifact = await zip.file(manifest.artifact.filename)!.async('uint8array');
  expect(manifest.report.renderer.phase).toBe('generated'); expect(manifest.report.revision).toBe(fixed.revision);
  expect(manifest.report.fonts.probe).toBe('measured'); expect(manifest.report.findings).toHaveLength(0);
  expect(createHash('sha256').update(artifact).digest('hex')).toBe(manifest.artifact.sha256);
  await expect(dialog.getByLabel('交付渲染器')).toContainText('本次已生成');
  await dialog.screenshot({ path: `${directory}/${kind}-font-rechecked.png` });
  await writeFile(`${directory}/${kind}-font-report.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${directory}/${manifest.artifact.filename}`, artifact);
  // An external edit while the report is open invalidates both navigation and export.
  const edit: DocumentOperation = fixed.kind === 'doc' ? { type: 'doc.section.update', sectionId: fixed.sections[0]!.id, name: '人工保留章节' } : fixed.kind === 'deck' ? { type: 'geometry.update', nodeId: 'font-issue', geometry: { x: 81 } } : { type: 'web.style.update', nodeId: 'font-issue', style: { padding: 8 } };
  expect((await page.request.post('/api/commands', { data: { commandId: crypto.randomUUID(), projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'font-test', baseRevision: fixed.revision, preconditions: [], label: '并发人工修改', operations: [edit] } })).status()).toBe(200);
  await expect(dialog).toContainText('检查已过期'); await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeDisabled();
  const stale = await page.request.post(`/api/documents/${id}/delivery.zip`, { data: { expectedRevision: original.revision } }); expect(stale.status()).toBe(409);
  await dialog.getByRole('button', { name: '重新检查' }).dblclick(); await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeEnabled();
  expect((await read()).revision).toBe(fixed.revision + 1);
});
