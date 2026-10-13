import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('native groups preserve visual placement through grouping, drag, proportional resize, undo, ungroup and source import', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue();
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const initial = await read(), root = initial.pages[0]!.rootId, project = (await (await page.request.get('/api/project')).json()).project;
  const response = await page.request.post('/api/commands', { data: { commandId: 'groups-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic groups', operations: [
    { type: 'web.layout.update', nodeId: root, layout: { mode: 'position', position: 'relative' } },
    { type: 'web.style.update', nodeId: root, style: { width: 700, height: 470, padding: 0 } },
    ...[['a', 30, 40], ['b', 190, 100], ['c', 360, 100]].map(([nodeId, left, top]) => ({ type: 'web.node.insert', node: { id: nodeId, parentId: root, tag: 'div', text: `Group ${nodeId}`, children: [], layout: { mode: 'position', position: 'absolute' }, style: { left, top, width: 120, height: 80, backgroundColor: '#cfe1d4' } } })),
  ] } }); expect(response.ok()).toBe(true);
  const frame = page.frameLocator('iframe[title="隔离网页预览"]'), a = frame.locator('[data-web-id="a"]'), b = frame.locator('[data-web-id="b"]');
  await expect(b).toBeVisible(); const original = await b.boundingBox();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'Group a' }).click();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'Group b' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await expect(page.getByRole('button', { name: '解组', exact: true })).toBeVisible();
  const groupId = Object.values((await read()).nodes).find(node => node.group)!.id;
  const group = frame.locator(`[data-web-id="${groupId}"]`); await expect(group).toHaveCSS('width', '280px');
  const grouped = await b.boundingBox(); expect(grouped!.x).toBeCloseTo(original!.x); expect(grouped!.y).toBeCloseTo(original!.y);
  const beforeDrag = await read(), start = (await a.boundingBox())!;
  await page.mouse.move(start.x + 30, start.y + 20); await page.mouse.down(); await page.mouse.move(start.x + 60, start.y + 40, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes[groupId]!.style.left).toBe(60);
  expect((await read()).nodes[groupId]!.style.top).toBe(60); expect((await read()).revision).toBe(beforeDrag.revision + 1);
  await expect(group).toHaveCSS('left', '60px'); expect((await read()).nodes.b!.style.left).toBe(160);
  const handle = frame.getByRole('button', { name: '调整元素尺寸' }); await expect(handle).toBeVisible();
  const corner = (await handle.boundingBox())!, beforeResize = await read();
  await page.mouse.move(corner.x + 6, corner.y + 6); await page.mouse.down(); await page.mouse.move(corner.x + 286, corner.y + 146, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes[groupId]!.style.width).toBe(560);
  expect((await read()).nodes[groupId]!.style.height).toBe(280); expect((await read()).nodes.b!.style.left).toBe(320); expect((await read()).nodes.b!.style.width).toBe(240);
  expect((await read()).revision).toBe(beforeResize.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await read()).nodes.b!.style.width).toBe(120);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(async () => (await read()).nodes.b!.style.width).toBe(240);
  // An interrupted gesture restores all member previews without a history entry.
  await expect(group).toHaveCSS('width', '560px'); const beforeCancel = await read(), cancelCorner = (await handle.boundingBox())!;
  await page.mouse.move(cancelCorner.x + 6, cancelCorner.y + 6); await page.mouse.down(); await page.mouse.move(cancelCorner.x - 30, cancelCorner.y - 20, { steps: 4 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(b).toHaveCSS('width', '240px'); expect((await read()).revision).toBe(beforeCancel.revision);
  await page.locator('.web-editor-tree-select').filter({ hasText: '组' }).click();
  await page.getByLabel('旋转角度').fill('12deg'); await page.getByLabel('旋转角度').blur(); await expect(group).toHaveCSS('rotate', '12deg');
  const beforeRefusal = await read(); await page.getByRole('button', { name: '解组', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('变换'); expect((await read()).revision).toBe(beforeRefusal.revision);
  await page.getByLabel('旋转角度').fill('0deg'); await page.getByLabel('旋转角度').blur(); await expect(group).toHaveCSS('rotate', '0deg');
  const globalBefore = await b.boundingBox(); await page.getByRole('button', { name: '解组', exact: true }).click();
  await expect.poll(async () => (await read()).nodes[groupId]).toBeUndefined();
  await expect(b).toHaveCSS('left', '380px'); const globalAfter = await b.boundingBox(); expect(globalAfter!.x).toBeCloseTo(globalBefore!.x); expect(globalAfter!.y).toBeCloseTo(globalBefore!.y);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(group).toHaveCSS('width', '560px');
  const exported = await page.request.get(`/api/documents/${id}/export.source.zip`); expect(exported.ok()).toBe(true);
  await page.getByLabel('导入 OEY 源码 ZIP').setInputFiles({ name: 'group.source.zip', mimeType: 'application/zip', buffer: await exported.body() });
  await expect.poll(() => page.getByLabel('选择文档').inputValue()).not.toBe(id);
  await expect(group).toHaveCSS('width', '560px'); await page.reload(); await expect(b).toHaveCSS('width', '240px');
  const importedId = await page.getByLabel('选择文档').inputValue();
  expect((await (await page.request.get(`/api/documents/${importedId}`)).json()).document.nodes[groupId].group).toBe(true);
  expect(errors).toEqual([]);
});
