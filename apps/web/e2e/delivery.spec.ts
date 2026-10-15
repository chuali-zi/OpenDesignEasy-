import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import type { EditableDocument, DocumentOperation } from '@oeydesign/document';
import { evidencePath } from './evidence.ts';
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const bodyText = '三种媒介共用同一套文档命令。人工修改和智能体修改进入同一条历史，检查报告随版本更新，交付时明确列出尚未核实的内容。';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

for (const kind of ['doc', 'deck', 'web'] as const) test(`${kind}: actual browser checks, refreshes a stale report and downloads a matching native bundle`, async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1920, height: 1300 });
  await page.goto('/');
  const project = (await (await page.request.get('/api/project')).json()).project;
  const document = (await (await page.request.post('/api/documents', { data: { name: `${kind} · 合成发布说明`, kind } })).json()).document as EditableDocument;
  const id = document.documentId;
  const operations: DocumentOperation[] = document.kind === 'doc' ? [{ type: 'doc.text.apply', sectionId: document.sections[0]!.id, steps: [{ stepType: 'replace', from: 0, to: 2, slice: { content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '持续创作，可靠交付' }] }, paragraph(bodyText),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '交付前的共同检查' }] },
    paragraph('结构、素材与版本已经检查。视觉、事实与目标软件仍需审阅。'),
    { type: 'table', attrs: { headerRows: 1 }, content: [['媒介', '交付格式'], ['文档', 'DOCX / PDF'], ['演示', 'PPTX'], ['网页', '源码 / HTML']].map(row => ({ type: 'table_row', content: row.map(value => ({ type: 'table_cell', content: [paragraph(value)] })) })) },
  ] } }] }] : document.kind === 'deck' ? [
    { type: 'node.insert', node: { id: 'title', kind: 'text', parentId: document.pages[0]!.id, geometry: { x: 80, y: 90, width: 1120, height: 100, rotation: 0 }, style: { fontSize: 48, color: '#000000' }, hidden: false, locked: false, content: { type: 'doc', content: [paragraph('持续创作，可靠交付')] } } },
    { type: 'node.insert', node: { id: 'body', kind: 'text', parentId: document.pages[0]!.id, geometry: { x: 80, y: 240, width: 1120, height: 280, rotation: 0 }, style: { fontSize: 28, color: '#000000' }, hidden: false, locked: false, content: { type: 'doc', content: [paragraph(bodyText), paragraph('结构、素材与版本已经检查。视觉、事实与目标软件仍需审阅。')] } } },
  ] : [
    { type: 'web.style.update', nodeId: document.pages[0]!.rootId, style: { padding: '64px 32px', maxWidth: '960px', margin: '0 auto', fontFamily: 'sans-serif', color: '#000000' } },
    { type: 'web.node.insert', node: { id: 'title', parentId: document.pages[0]!.rootId, tag: 'h1', children: [], text: '持续创作，可靠交付', style: { fontSize: '40px' }, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'body', parentId: document.pages[0]!.rootId, tag: 'p', children: [], text: bodyText, style: { fontSize: '18px', lineHeight: 1.8 }, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'link', parentId: document.pages[0]!.rootId, tag: 'a', children: [], props: { href: '#' }, text: '待补充：发布详情', style: {}, layout: { mode: 'flow' } } },
  ];
  const applied = await page.request.post('/api/commands', { data: { commandId: crypto.randomUUID(), projectId: project.projectId, documentId: id, actorId: 'synthetic', actorKind: 'human', clientId: 'browser-test', baseRevision: 0, preconditions: [], label: '合成交付夹具', operations } });
  expect(applied.status()).toBe(200);
  await expect(page.getByLabel('选择文档').locator(`option[value="${id}"]`)).toHaveCount(1);
  await page.getByLabel('选择文档').selectOption(id);
  await page.getByRole('button', { name: '交付检查', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '交付检查', exact: true });
  await expect(dialog).toContainText('当前修订 1'); await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeEnabled();
  await expect(dialog).toContainText('未在 Microsoft Word/PowerPoint');
  if (kind === 'web') await expect(dialog).toContainText('链接没有实际目标');
  const edit: DocumentOperation = document.kind === 'doc' ? { type: 'doc.section.update', sectionId: document.sections[0]!.id, name: '正文（人工确认）' } : document.kind === 'deck' ? { type: 'geometry.update', nodeId: 'body', geometry: { x: 81 } } : { type: 'web.node.update', nodeId: 'body', text: `${bodyText} 保留人工补充。` };
  expect((await page.request.post('/api/commands', { data: { commandId: crypto.randomUUID(), projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'other-client', baseRevision: 1, preconditions: [], label: '保留人工修改', operations: [edit] } })).status()).toBe(200);
  await expect(dialog).toContainText('检查已过期'); await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新检查' }).click(); await expect(dialog).toContainText('修订 2 ·');
  await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeEnabled();
  const directory = evidencePath('r6-delivery'); await mkdir(directory, { recursive: true });
  await dialog.screenshot({ path: `${directory}/${kind}-delivery-panel.png` });
  const downloadEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载交付包' }).click(); const download = await downloadEvent;
  await download.saveAs(`${directory}/${kind}.delivery.zip`);
  const zip = await JSZip.loadAsync(await readFile(`${directory}/${kind}.delivery.zip`)), manifest = JSON.parse(await zip.file('delivery.json')!.async('string'));
  expect(manifest.report.revision).toBe(2); const artifact = await zip.file(manifest.artifact.filename)!.async('uint8array'); expect(hash(artifact)).toBe(manifest.artifact.sha256);
  await writeFile(`${directory}/${manifest.artifact.filename}`, artifact); await writeFile(`${directory}/${kind}-delivery.json`, JSON.stringify(manifest, null, 2));
  await dialog.getByRole('button', { name: '关闭交付检查' }).click(); await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: `${directory}/${kind}-editor.png`, fullPage: true });
  if (kind === 'doc') {
    const metrics = await page.getByLabel('富文本内容').locator('p').filter({ hasText: bodyText }).evaluate(element => {
      const text = element.firstChild!, tops = new Set<number>();
      for (let offset = 0; offset < (text.textContent?.length ?? 0); offset++) { const range = window.document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1); tops.add(Math.round(range.getBoundingClientRect().top)); }
      return { lines: tops.size, width: element.getBoundingClientRect().width, font: getComputedStyle(element).fontFamily, fontSize: getComputedStyle(element).fontSize, text: element.textContent };
    });
    await writeFile(`${directory}/browser-doc-lines.json`, JSON.stringify(metrics, null, 2));
  }
  if (kind === 'web') {
    const html = await page.request.get(`/api/documents/${id}/export.html`); await writeFile(`${directory}/web-r2.html`, await html.body());
    for (const width of [1280, 390]) {
      const preview = await page.context().newPage(); await preview.setViewportSize({ width, height: 900 }); await preview.goto(`/api/documents/${id}/preview.html`);
      expect(await preview.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await preview.screenshot({ path: `${directory}/web-preview-${width}.png`, fullPage: true }); await preview.close();
    }
  }
  await page.reload(); await page.getByRole('button', { name: '交付检查', exact: true }).click(); await expect(page.getByRole('dialog', { name: '交付检查', exact: true })).toContainText('修订 2 ·');
});

test('cancel and close abort delayed checks, and reopening checks again without changing the design', async ({ page }) => {
  await page.goto('/');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/delivery-check?**', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: '交付检查', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '交付检查', exact: true }); await expect(dialog.getByRole('button', { name: '取消操作' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消操作' }).click(); await expect(dialog).toContainText('操作已取消');
  await dialog.getByRole('button', { name: '关闭交付检查' }).click(); release(); await page.unroute('**/delivery-check?**');
  await page.getByRole('button', { name: '交付检查', exact: true }).click(); await expect(dialog.getByRole('button', { name: '下载交付包' })).toBeEnabled();
});
