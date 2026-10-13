import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('native 2D rotated resize follows local axes, preserves the opposite corner and supports undo/reopen', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click(); await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue(), read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const doc = await read(), root = doc.pages[0]!.rootId, project = (await (await page.request.get('/api/project')).json()).project;
  const seeded = await page.request.post('/api/commands', { data: { commandId: 'rotate-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic rotated box', operations: [
    { type: 'web.layout.update', nodeId: root, layout: { mode: 'position', position: 'relative' } },
    { type: 'web.style.update', nodeId: root, style: { padding: 0 } },
    { type: 'web.node.insert', node: { id: 'box', parentId: root, tag: 'div', text: 'Rotated', children: [], style: { left: 120, top: 100, width: 120, height: 80, rotate: '30deg', backgroundColor: '#cfe1d4' }, layout: { mode: 'position', position: 'absolute' } } },
  ] } }); expect(seeded.ok()).toBe(true);
  const frame = page.frameLocator('iframe[title="隔离网页预览"]'), box = frame.locator('[data-web-id="box"]'); await box.click();
  const corner = async () => box.evaluate(el => { const rect = el.getBoundingClientRect(), angle = Math.PI / 6; return { x: rect.x + rect.width / 2 - Math.cos(angle) * (el as HTMLElement).offsetWidth / 2 + Math.sin(angle) * (el as HTMLElement).offsetHeight / 2, y: rect.y + rect.height / 2 - Math.sin(angle) * (el as HTMLElement).offsetWidth / 2 - Math.cos(angle) * (el as HTMLElement).offsetHeight / 2 }; });
  const original = await corner(), handle = frame.getByRole('button', { name: '调整元素尺寸' }); await expect(handle).toBeVisible(); const point = (await handle.boundingBox())!;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 40 * Math.cos(Math.PI / 6) - 20 * Math.sin(Math.PI / 6), point.y + point.height / 2 + 40 * Math.sin(Math.PI / 6) + 20 * Math.cos(Math.PI / 6), { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes.box!.style.width).toBe(160); expect((await read()).nodes.box!.style.height).toBe(100); expect((await read()).nodes.box!.style.rotate).toBe('30deg');
  await expect(box).toHaveCSS('width', '160px'); const after = await corner(); expect(after.x).toBeCloseTo(original.x, 1); expect(after.y).toBeCloseTo(original.y, 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(box).toHaveCSS('width', '120px'); expect((await read()).nodes.box!.style.left).toBe(120);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(box).toHaveCSS('width', '160px'); await page.reload(); await expect(box).toHaveCSS('rotate', '30deg'); await expect(box).toHaveCSS('width', '160px');
});
