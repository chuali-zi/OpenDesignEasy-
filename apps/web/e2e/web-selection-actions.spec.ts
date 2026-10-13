import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('tree ranges, keyboard, rectangle selection and batch tree actions share atomic history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  const editor = page.getByRole('main', { name: 'Web 编辑器' }); await expect(editor).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue();
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const initial = await read(), root = initial.pages[0]!.rootId, project = (await (await page.request.get('/api/project')).json()).project;
  const response = await page.request.post('/api/commands', { data: { commandId: 'selection-actions-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic tree actions', operations: [
    { type: 'web.layout.update', nodeId: root, layout: { mode: 'position', position: 'relative' } },
    { type: 'web.style.update', nodeId: root, style: { width: 650, height: 450, padding: 0 } },
    ...['a', 'b', 'c'].map((nodeId, i) => ({ type: 'web.node.insert', node: { id: nodeId, parentId: root, tag: 'div', text: `Range ${nodeId}`, children: [], layout: { mode: 'position', position: 'absolute' }, style: { left: 30 + i * 170, top: 50, width: 120, height: 90, backgroundColor: '#cfe1d4' } } })),
    { type: 'web.node.insert', node: { id: 'child', parentId: 'a', tag: 'p', text: 'Nested child', children: [], layout: { mode: 'flow' }, style: {} } },
  ] } }); expect(response.ok()).toBe(true);
  const tree = (text: string) => page.locator('.web-editor-tree-select').filter({ hasText: text });
  const frame = page.frameLocator('iframe[title="隔离网页预览"]'); await expect(frame.locator('[data-web-id="c"]')).toBeVisible();
  await tree('Range a').click(); await tree('Range b').click({ modifiers: ['Shift'] });
  await expect(page.getByText('已选择 3 个元素', { exact: true })).toBeVisible();
  const beforeCopy = await read(); await page.getByRole('button', { name: '复制选中元素', exact: true }).click();
  await expect.poll(async () => Object.keys((await read()).nodes).length).toBe(Object.keys(beforeCopy.nodes).length + 3);
  expect((await read()).revision).toBe(beforeCopy.revision + 1);
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await editor.focus(); await page.keyboard.press('Delete');
  await expect.poll(async () => Object.keys((await read()).nodes).length).toBe(Object.keys(beforeCopy.nodes).length);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => Object.keys((await read()).nodes).length).toBe(Object.keys(beforeCopy.nodes).length + 3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => Object.keys((await read()).nodes).length).toBe(Object.keys(beforeCopy.nodes).length);
  await expect(tree('Range a')).toHaveCount(1);
  await tree('Range a').click(); await page.keyboard.press('ArrowDown');
  await expect(tree('Nested child')).toHaveAttribute('aria-pressed', 'true');
  await frame.locator('body').press('Control+d');
  await expect(tree('Nested child')).toHaveCount(2);
  const copiedChild = (await read()).nodes.a!.children.find(nodeId => nodeId !== 'child')!;
  await expect(frame.locator(`[data-web-id="${copiedChild}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
  await frame.locator('body').press('Delete');
  await expect(tree('Nested child')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(frame.locator('[data-selected="true"]')).toHaveCount(0);
  const revision = (await read()).revision;
  await page.getByRole('button', { name: '框选', exact: true }).click();
  const iframe = await page.locator('iframe[title="隔离网页预览"]').boundingBox(); expect(iframe).not.toBeNull();
  await page.mouse.move(iframe!.x + 10, iframe!.y + 20); await page.mouse.down(); await page.mouse.move(iframe!.x + 330, iframe!.y + 170, { steps: 8 }); await page.mouse.up();
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  await expect(frame.locator('[data-web-id="a"]')).toHaveAttribute('data-selected', 'true');
  await expect(frame.locator('[data-web-id="b"]')).toHaveAttribute('data-selected', 'true');
  await expect(frame.locator('[data-web-id="child"]')).not.toHaveAttribute('data-selected', 'true');
  expect((await read()).revision).toBe(revision);
  await page.getByRole('button', { name: '锁定 Nested child' }).click();
  const lockedRevision = (await read()).revision; await page.getByRole('button', { name: '删除选中元素', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('锁定子树'); expect((await read()).revision).toBe(lockedRevision);
  await page.getByRole('button', { name: '解锁 Nested child' }).click();
  await page.getByRole('button', { name: '删除选中元素', exact: true }).click();
  await expect.poll(async () => (await read()).nodes[root]!.children).toEqual(['c']);
  await page.reload(); await expect(frame.locator('[data-web-id="c"]')).toBeVisible();
  expect((await read()).nodes.child).toBeUndefined(); expect(errors).toEqual([]);
});
