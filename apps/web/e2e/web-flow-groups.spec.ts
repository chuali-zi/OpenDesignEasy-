import { expect, test } from '@playwright/test';
import type { WebDocument } from '@oeydesign/document';

test('flow groups preserve Flex/Grid and responsive geometry, reorder as one object and recover through history/reopen', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue(), read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  const initial = await read(), root = initial.pages[0]!.rootId, project = (await (await page.request.get('/api/project')).json()).project;
  const response = await page.request.post('/api/commands', { data: { commandId: 'flow-groups-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: 0, preconditions: [], label: 'Synthetic flow groups', operations: [
    { type: 'web.breakpoints.update', breakpoints: [{ id: 'mobile', maxWidth: 767 }] },
    { type: 'web.layout.update', nodeId: root, layout: { mode: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
    { type: 'web.style.update', nodeId: root, style: { width: 550, height: 440, padding: 16, gap: 12 } },
    { type: 'web.layout.update', nodeId: root, breakpointId: 'mobile', layout: { flexDirection: 'column' } },
    { type: 'web.style.update', nodeId: root, breakpointId: 'mobile', style: { width: '100%' } },
    ...['a', 'b', 'c'].map(nodeId => ({ type: 'web.node.insert', node: { id: nodeId, parentId: root, tag: 'div', text: `Flow ${nodeId}`, children: [], layout: { mode: 'flow' }, style: { width: 100, height: 70, margin: 0, backgroundColor: '#cfe1d4' } } })),
  ] } }); expect(response.ok()).toBe(true);
  const frame = page.frameLocator('iframe[title="隔离网页预览"]'), a = frame.locator('[data-web-id="a"]'), c = frame.locator('[data-web-id="c"]');
  await expect(c).toBeVisible();
  const boxes = async () => Promise.all(['a', 'b', 'c'].map(id => frame.locator(`[data-web-id="${id}"]`).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })));
  const baseline = await boxes(), beforeGroup = await read();
  const tree = (name: string) => page.locator('.web-editor-tree-select').filter({ hasText: name });
  await tree('Flow a').click(); await tree('Flow b').click({ modifiers: ['Shift'] }); await page.getByRole('button', { name: '分组', exact: true }).click();
  const groupId = Object.values((await read()).nodes).find(node => node.group)!.id, group = frame.locator(`[data-web-id="${groupId}"]`);
  await expect(group).toHaveCSS('display', 'contents'); expect(await boxes()).toEqual(baseline); expect((await read()).revision).toBe(beforeGroup.revision + 1);
  await expect(frame.locator('[data-flow-group-selected="true"]')).toHaveCount(2);
  await expect(frame.getByRole('button', { name: '调整元素尺寸' })).toHaveCount(0); await expect(page.getByLabel('样式宽度')).toBeDisabled();
  const start = (await a.boundingBox())!, drop = (await c.boundingBox())!, beforeMove = await read();
  await page.mouse.move(start.x + 25, start.y + 20); await page.mouse.down(); await page.mouse.move(drop.x + 75, drop.y + 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes[root]!.children).toEqual(['c', groupId]);
  expect((await read()).revision).toBe(beforeMove.revision + 1); expect((await read()).nodes.a!.layout.mode).toBe('flow'); expect((await read()).nodes.a!.style.left).toBeUndefined();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await read()).nodes[root]!.children).toEqual([groupId, 'c']);
  await expect.poll(boxes).toEqual(baseline);
  await page.getByLabel('预览宽度').focus(); await page.getByLabel('预览宽度').press('Home');
  await expect(frame.locator(`[data-web-id="${root}"]`)).toHaveCSS('flex-direction', 'column');
  const mobile = await boxes(); await page.getByRole('button', { name: '解组', exact: true }).click();
  await expect(group).toHaveCount(0); expect(await boxes()).toEqual(mobile);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(group).toHaveCSS('display', 'contents'); expect(await boxes()).toEqual(mobile);
  await page.reload(); await expect(group).toHaveCSS('display', 'contents');
  expect((await read()).nodes[groupId]!.children).toEqual(['a', 'b']); expect((await read()).nodes[root]!.responsive!.mobile!.layout!.flexDirection).toBe('column');
  await tree('流式组').click(); await page.getByRole('button', { name: '解组', exact: true }).click(); await expect(group).toHaveCount(0);
  await tree('main').click(); await page.getByLabel('布局模式').selectOption('grid'); await expect(page.getByLabel('网格列')).toBeVisible();
  await page.getByLabel('网格列').fill('repeat(3, 1fr)'); await page.getByLabel('网格列').blur();
  await expect.poll(async () => (await read()).nodes[root]!.layout.gridTemplateColumns).toBe('repeat(3, 1fr)');
  await page.getByLabel('网格水平对齐').selectOption('center'); await expect(frame.locator(`[data-web-id="${root}"]`)).toHaveCSS('justify-items', 'center');
  const grid = await boxes(); await tree('Flow a').click(); await tree('Flow b').click({ modifiers: ['Shift'] }); await page.getByRole('button', { name: '分组', exact: true }).click();
  const gridGroupId = Object.values((await read()).nodes).find(node => node.group)!.id;
  await expect(frame.locator(`[data-web-id="${gridGroupId}"]`)).toHaveCSS('display', 'contents'); expect(await boxes()).toEqual(grid);
  await page.getByRole('button', { name: '锁定 Flow b' }).click(); await expect(page.getByRole('button', { name: '解组', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '解锁 Flow b' }).click(); await expect(page.getByRole('button', { name: '解组', exact: true })).toBeEnabled();
  const html = await (await page.request.get(`/api/documents/${id}/export.html`)).text(); expect(html).toContain('display:contents');
  await page.getByRole('button', { name: '解组', exact: true }).click(); await expect(frame.locator(`[data-web-id="${gridGroupId}"]`)).toHaveCount(0);
  await tree('main').click(); await page.getByLabel('布局模式').selectOption('flow'); await expect(frame.locator(`[data-web-id="${root}"]`)).toHaveCSS('display', 'block');
  const latest = await read(); expect((await page.request.post('/api/commands', { data: { commandId: 'flow-margin-' + id, projectId: project.projectId, documentId: id, actorId: 'human', actorKind: 'human', clientId: 'test', baseRevision: latest.revision, preconditions: [], label: 'Synthetic collapsing margins', operations: ['a', 'b'].map(nodeId => ({ type: 'web.style.update', nodeId, style: { marginTop: 30, marginBottom: 20 } })) } })).ok()).toBe(true);
  await expect(a).toHaveCSS('margin-top', '30px'); const flow = await boxes();
  await tree('Flow a').click(); await tree('Flow b').click({ modifiers: ['Shift'] }); await page.getByRole('button', { name: '分组', exact: true }).click();
  const flowGroupId = Object.values((await read()).nodes).find(node => node.group)!.id;
  await expect(frame.locator(`[data-web-id="${flowGroupId}"]`)).toHaveCSS('display', 'contents'); expect(await boxes()).toEqual(flow);
  expect(errors).toEqual([]);
});
