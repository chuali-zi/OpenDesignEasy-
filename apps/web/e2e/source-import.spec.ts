import { readFile, mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import type { WebDocument } from '@oeydesign/document';

test('source project returns as a new editable design, runs edited components, and roundtrips without overwriting the original', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const originalId = await page.getByLabel('选择文档').inputValue();
  const original: WebDocument = (await (await page.request.get(`/api/documents/${originalId}`)).json()).document;
  const project = (await (await page.request.get('/api/project')).json()).project;
  const root = original.pages[0]!.rootId;
  const response = await page.request.post('/api/commands', { data: { commandId: 'seed-' + originalId, projectId: project.projectId, documentId: originalId, actorId: 'local-user', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic import demo', operations: [
    { type: 'web.node.insert', node: { id: 'import-title', parentId: root, tag: 'h1', text: 'Source project · round trip', children: [], style: { fontSize: 38, color: '#294c3d', marginBottom: 24 }, layout: { mode: 'flow' } } },
    { type: 'source.update', module: { id: 'counter', path: 'components/Counter.tsx', language: 'tsx', exports: ['default'], source: "import {useState} from 'react'; export default function Counter(){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>Imported count {n}</button>}" } },
    { type: 'web.node.insert', node: { id: 'counter-node', parentId: root, tag: 'div', component: { moduleId: 'counter', exportName: 'default' }, children: [], style: {}, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'about-link', parentId: root, tag: 'a', props: { href: '/about' }, text: 'About the project', children: [], style: {}, layout: { mode: 'flow' } } },
    { type: 'web.page.insert', page: { id: 'about', name: 'About', route: '/about', rootId: 'about-root' }, root: { id: 'about-root', parentId: null, tag: 'main', children: [], style: {}, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'about-title', parentId: 'about-root', tag: 'h1', text: 'Returned project', children: [], style: {}, layout: { mode: 'flow' } } },
  ] } }); expect(response.ok()).toBe(true);
  const snapshot = (await (await page.request.get(`/api/documents/${originalId}`)).json()).document;
  const exported = await page.request.get(`/api/documents/${originalId}/export.source.zip`); expect(exported.ok()).toBe(true);
  const zip = await JSZip.loadAsync(await exported.body());
  const module = await zip.file('src/components/Counter.tsx')!.async('string'); zip.file('src/components/Counter.tsx', module.replace('useState(0)', 'useState(7)'));
  await page.getByLabel('导入 OEY 源码 ZIP').setInputFiles({ name: 'workshop.source.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.getByRole('alert')).toContainText('已导入 2 个页面，同步 1 个外部修改的模块');
  const importedId = await page.getByLabel('选择文档').inputValue(); expect(importedId).not.toBe(originalId);
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${importedId}`)).json()).document;
  expect((await read()).sourceModules![0]!.source).toContain('useState(7)');
  expect((await (await page.request.get(`/api/documents/${originalId}`)).json()).document).toEqual(snapshot);
  await page.getByRole('button', { name: '运行应用' }).click();
  const preview = page.frameLocator('iframe[title="构建应用预览"]');
  await expect(preview.getByRole('button', { name: 'Imported count 7' })).toBeVisible();
  await preview.getByRole('button', { name: 'Imported count 7' }).click(); await expect(preview.getByRole('button', { name: 'Imported count 8' })).toBeVisible();
  await preview.getByRole('link', { name: 'About the project' }).click(); await expect(preview.getByRole('heading', { name: 'Returned project' })).toBeVisible();
  await page.getByRole('button', { name: '关闭应用预览' }).click();
  await expect(page.getByRole('dialog', { name: '应用交互预览' })).not.toBeVisible();
  // The imported native title remains a real editable object, not a screenshot.
  await page.frameLocator('iframe[title="隔离网页预览"]').locator('[data-web-id="import-title"]').click();
  await page.getByLabel('元素文案').fill('Human edit after source import'); await page.getByLabel('元素文案').blur();
  await expect.poll(async () => (await read()).nodes['import-title']!.text).toBe('Human edit after source import');
  await page.getByRole('button', { name: '撤销' }).click(); await expect.poll(async () => (await read()).nodes['import-title']!.text).toBe('Source project · round trip');
  await page.getByRole('button', { name: '重做' }).click(); await page.reload();
  await expect(page.getByLabel('选择文档')).toHaveValue(importedId);
  await expect(page.frameLocator('iframe[title="隔离网页预览"]').locator('[data-web-id="import-title"]')).toHaveText('Human edit after source import');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: /导出源码 ZIP/ }).click();
  const download = await downloadEvent; const roundtrip = await readFile((await download.path())!);
  await page.getByLabel('导入 OEY 源码 ZIP').setInputFiles({ name: 'returned.source.zip', mimeType: 'application/zip', buffer: roundtrip });
  await expect.poll(() => page.getByLabel('选择文档').inputValue()).not.toBe(importedId);
  await expect(page.frameLocator('iframe[title="隔离网页预览"]').locator('[data-web-id="import-title"]')).toHaveText('Human edit after source import');
  // Unsupported changes stay explicit and preserve the current selection/design.
  const currentId = await page.getByLabel('选择文档').inputValue(); const invalid = await JSZip.loadAsync(roundtrip); invalid.file('src/App.tsx', 'unsupported external generated edit');
  await page.getByLabel('导入 OEY 源码 ZIP').setInputFiles({ name: 'unsupported.zip', mimeType: 'application/zip', buffer: await invalid.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.getByRole('alert')).toContainText('generated entry changed'); expect(await page.getByLabel('选择文档').inputValue()).toBe(currentId);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await mkdir('.tmp', { recursive: true }); await page.screenshot({ path: '.tmp/r4-source-import.png', fullPage: true });
  expect(errors).toEqual([]);
});
