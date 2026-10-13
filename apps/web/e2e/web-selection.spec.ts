import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('Web multi-select batches styles and local alignment in one history step, scopes mobile overrides and protects flow/locks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue();
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const initial = await read(); const project = (await (await page.request.get('/api/project')).json()).project;
  const root = initial.pages[0]!.rootId;
  const response = await page.request.post('/api/commands', { data: {
    commandId: 'multi-seed-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic selection demo', operations: [
      { type: 'web.layout.update', nodeId: root, layout: { mode: 'position', position: 'relative' } },
      { type: 'web.style.update', nodeId: root, style: { width: 700, height: 480, padding: 0 } },
      ...[['a', 30, 50, '#476d58'], ['b', 190, 120, '#769480'], ['c', 390, 210, '#a5b7a6']].map(([nodeId, left, top, backgroundColor]) => ({ type: 'web.node.insert', node: { id: nodeId, parentId: root, tag: 'div', text: `${String(nodeId).toUpperCase()} card`, children: [], style: { left, top, width: 120, height: 80, backgroundColor, color: '#ffffff', padding: 12, boxSizing: 'border-box' }, layout: { mode: 'position', position: 'absolute' } } })),
      { type: 'web.node.insert', node: { id: 'flow', parentId: root, tag: 'p', text: 'Flow stays flow', children: [], style: { marginTop: 350 }, layout: { mode: 'flow' } } },
    ],
  } }); expect(response.ok()).toBe(true);
  const frame = page.frameLocator('iframe[title="隔离网页预览"]');
  await frame.locator('[data-web-id="a"]').click(); await frame.locator('[data-web-id="b"]').click({ modifiers: ['Shift'] });
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'C card' }).click({ modifiers: ['Control'] });
  await expect(page.getByText('已选择 3 个元素', { exact: true })).toBeVisible();
  await expect(frame.locator('[data-selected="true"]')).toHaveCount(3);
  const beforeColor = await read();
  await page.getByLabel('批量背景色').fill('#315b49'); await page.getByLabel('批量背景色').blur();
  await expect.poll(async () => { const d = await read(); return ['a', 'b', 'c'].every(nodeId => d.nodes[nodeId]!.style.backgroundColor === '#315b49'); }).toBe(true);
  expect((await read()).revision).toBe(beforeColor.revision + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await read()).nodes.b!.style.backgroundColor).toBe('#769480');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(async () => (await read()).nodes.c!.style.backgroundColor).toBe('#315b49');
  const beforeAlign = await read(); await page.getByRole('button', { name: '顶对齐', exact: true }).click();
  await expect.poll(async () => { const d = await read(); return ['a', 'b', 'c'].map(nodeId => d.nodes[nodeId]!.style.top); }).toEqual([50, 50, 50]);
  expect((await read()).revision).toBe(beforeAlign.revision + 1);
  await page.getByRole('button', { name: '水平等间距', exact: true }).click();
  await expect.poll(async () => (await read()).nodes.b!.style.left).toBe(210);
  const y = await frame.locator('[data-web-id="a"]').evaluate(el => el.getBoundingClientRect().top);
  expect(await frame.locator('[data-web-id="c"]').evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(y);
  await page.reload(); await expect(frame.locator('[data-web-id="b"]')).toBeVisible();
  expect((await read()).nodes.b!.style.left).toBe(210);
  // Modifier selection is local, persists through document updates, and can toggle off.
  await page.locator('.web-editor-tree-select').filter({ hasText: 'A card' }).click();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'B card' }).click({ modifiers: ['Control'] });
  await page.locator('.web-editor-tree-select').filter({ hasText: 'C card' }).click({ modifiers: ['Control'] });
  await page.getByLabel('预览宽度').focus(); await page.getByLabel('预览宽度').press('Home');
  await page.getByRole('button', { name: '为 mobile 创建样式覆盖' }).click();
  await page.getByLabel('批量文字颜色').fill('#112233'); await page.getByLabel('批量文字颜色').blur();
  await expect.poll(async () => (await read()).nodes.a!.responsive?.mobile?.style?.color).toBe('#112233');
  expect((await read()).nodes.a!.style.color).toBe('#ffffff');
  await page.locator('.web-editor-tree-select').filter({ hasText: 'C card' }).click({ modifiers: ['Control'] });
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'Flow stays flow' }).click({ modifiers: ['Control'] });
  const beforeFlow = await read(); await page.getByRole('button', { name: '左对齐', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('流式布局保持原样');
  expect((await read()).revision).toBe(beforeFlow.revision); expect((await read()).nodes.flow!.layout.mode).toBe('flow');
  await page.locator('.web-editor-tree-select').filter({ hasText: 'Flow stays flow' }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: '锁定 A card' }).click();
  await expect(page.getByLabel('批量文字颜色')).toBeDisabled();
  await page.getByRole('button', { name: '解锁 A card' }).click();
  await expect(page.getByLabel('批量文字颜色')).toBeEnabled();
  // Remote deletion removes a selected object without crashing or targeting ghosts.
  const latest = await read(); await page.request.post('/api/commands', { data: { commandId: 'remove-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: latest.revision, preconditions: [], label: 'Remove selected', operations: [{ type: 'web.node.remove', nodeId: 'b' }] } });
  await expect(page.getByLabel('元素标签')).toBeVisible();
  await page.getByLabel('预览宽度').focus(); await page.getByLabel('预览宽度').press('End');
  await page.locator('.web-editor-tree-select').filter({ hasText: 'C card' }).click({ modifiers: ['Control'] });
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await mkdir('.tmp', { recursive: true }); await page.screenshot({ path: '.tmp/r4-web-multiselect.png', fullPage: true });
  expect(errors).toEqual([]);
});
