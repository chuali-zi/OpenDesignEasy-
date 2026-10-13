import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('Web zoom/pan stay local and scaled pointer gestures preserve margins, move selection atomically and snap with visible guides', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click(); await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue(), read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const initial = await read(), root = initial.pages[0]!.rootId, project = (await (await page.request.get('/api/project')).json()).project;
  const response = await page.request.post('/api/commands', { data: { commandId: 'view-snap-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic view/snap', operations: [
    { type: 'web.layout.update', nodeId: root, layout: { mode: 'position', position: 'relative' } },
    { type: 'web.style.update', nodeId: root, style: { width: 600, height: 480, padding: 0 } },
    ...[['a', 30, 40], ['b', 190, 100], ['c', 390, 210]].map(([nodeId, left, top]) => ({ type: 'web.node.insert', node: { id: nodeId, parentId: root, tag: 'div', text: `Snap ${nodeId}`, children: [], layout: { mode: 'position', position: 'absolute' }, style: { left, top, width: 100, height: 80, marginLeft: nodeId === 'a' ? 10 : 0, marginTop: nodeId === 'a' ? 15 : 0, backgroundColor: '#cfe1d4' } } })),
  ] } }); expect(response.ok()).toBe(true);
  const frame = page.frameLocator('iframe[title="隔离网页预览"]'), a = frame.locator('[data-web-id="a"]');
  await expect(a).toBeVisible(); const seed = await read(); await page.getByLabel('网页缩放').selectOption('0.5');
  expect((await read()).revision).toBe(seed.revision); expect(await frame.locator('body').evaluate(el => el.ownerDocument.defaultView!.innerWidth)).toBe(1200);
  const start = (await a.boundingBox())!; expect(start.width).toBeCloseTo(50);
  await page.mouse.move(start.x + 15, start.y + 10); await page.mouse.down(); await page.mouse.move(start.x + 35, start.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes.a!.style.left).toBe(70); expect((await read()).nodes.a!.style.top).toBe(60);
  expect((await read()).nodes.a!.style.marginLeft).toBe(10); expect((await read()).nodes.a!.style.marginTop).toBe(15);
  const tree = (name: string) => page.locator('.web-editor-tree-select').filter({ hasText: name });
  await tree('Snap a').click(); await tree('Snap b').click({ modifiers: ['Control'] });
  const multi = (await a.boundingBox())!, beforeMulti = await read();
  await page.mouse.move(multi.x + 15, multi.y + 10); await page.mouse.down(); await page.mouse.move(multi.x + 25, multi.y + 25, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes.b!.style.left).toBe(210);
  expect((await read()).nodes.a!.style.left).toBe(90); expect((await read()).nodes.a!.style.top).toBe(90); expect((await read()).nodes.b!.style.top).toBe(130); expect((await read()).revision).toBe(beforeMulti.revision + 1);
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await page.getByLabel('网页缩放').selectOption('1'); await tree('Snap a').click(); await page.getByRole('button', { name: '吸附', exact: true }).click();
  const snapStart = (await a.boundingBox())!, beforeSnap = await read();
  await page.mouse.move(snapStart.x + 20, snapStart.y + 20); await page.mouse.down(); await page.mouse.move(snapStart.x + 126, snapStart.y + 41, { steps: 6 });
  await expect(frame.locator('[data-oey-snap-guide]')).toHaveCount(2); expect((await read()).revision).toBe(beforeSnap.revision);
  await page.mouse.up(); await expect.poll(async () => (await read()).nodes.a!.style.left).toBe(200); expect((await read()).nodes.a!.style.top).toBe(115);
  await expect(frame.locator('[data-oey-snap-guide]')).toHaveCount(0); expect((await read()).revision).toBe(beforeSnap.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await read()).nodes.a!.style.left).toBe(90);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(a).toHaveCSS('left', '200px');
  // a now sits behind b after snapping; drive the visible topmost object.
  await tree('Snap b').click(); await page.keyboard.down('Alt'); const free = (await frame.locator('[data-web-id="b"]').boundingBox())!;
  await page.mouse.move(free.x + 20, free.y + 20); await page.mouse.down(); await page.mouse.move(free.x + 24, free.y + 23, { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect.poll(async () => (await read()).nodes.b!.style.left).toBe(214); expect((await read()).nodes.b!.style.top).toBe(133);
  await page.getByLabel('网页缩放').selectOption('0.5');
  const handle = frame.getByRole('button', { name: '调整元素尺寸' }); await expect(handle).toBeVisible(); const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 10, corner.y + corner.height / 2 + 10, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes.b!.style.width).toBe(120); expect((await read()).nodes.b!.style.height).toBe(100);
  // A measured sibling changed by another actor rejects the old snapped move.
  await tree('Snap b').click(); const conflict = (await frame.locator('[data-web-id="b"]').boundingBox())!, beforeConflict = await read();
  await page.mouse.move(conflict.x + 20, conflict.y + 20); await page.mouse.down(); await page.mouse.move(conflict.x + 35, conflict.y + 20, { steps: 5 });
  expect((await page.request.post('/api/commands', { data: { commandId: 'snap-neighbor-' + id, projectId: project.projectId, documentId: id, actorId: 'test-agent', actorKind: 'agent', clientId: 'test', baseRevision: beforeConflict.revision, preconditions: [], label: 'Synthetic concurrent neighbor change', operations: [{ type: 'web.style.update', nodeId: 'c', style: { top: 230 } }] } })).ok()).toBe(true);
  await page.mouse.up(); await expect(page.locator('.web-editor-error')).toContainText('precondition');
  expect((await read()).nodes.b!.style.left).toBe(214); expect((await read()).nodes.c!.style.top).toBe(230);
  const beforeView = await read(); await page.getByLabel('网页缩放').selectOption('fit'); expect((await read()).revision).toBe(beforeView.revision);
  await page.getByLabel('网页缩放').selectOption('1'); await page.getByRole('button', { name: '平移', exact: true }).click();
  const panStart = (await a.boundingBox())!;
  await page.mouse.move(panStart.x + 20, panStart.y + 20); await page.mouse.down(); await page.mouse.move(panStart.x - 30, panStart.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => page.locator('.web-editor-viewport').evaluate(el => el.scrollLeft)).toBeGreaterThan(40); expect((await read()).revision).toBe(beforeView.revision);
  await frame.locator('body').press('Escape'); await expect(page.getByRole('button', { name: '平移', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.reload(); await expect(a).toHaveCSS('left', '200px'); expect((await read()).nodes.a!.style.top).toBe(115); expect((await read()).nodes.b!.style.left).toBe(214);
  expect(errors).toEqual([]);
});
