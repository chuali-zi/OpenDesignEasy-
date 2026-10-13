import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { WebDocument } from '@oeydesign/document';

test('Web rich text edits selection formats, saves/reopens/exports, recovers interrupted drafts and flushes to the original document', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const id = await page.getByLabel('选择文档').inputValue();
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${id}`)).json()).document;
  await page.getByRole('button', { name: '段落', exact: true }).click();
  await expect(page.getByLabel('元素文案')).toBeVisible();
  const nodeId = Object.values((await read()).nodes).find(n => n.tag === 'p')!.id;
  await page.frameLocator('iframe[title="隔离网页预览"]').locator(`[data-web-id="${nodeId}"]`).dblclick();
  const editor = page.getByLabel('富文本内容'); await expect(editor).toBeVisible();
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Web rich text');
  await page.keyboard.press('ControlOrMeta+A'); await page.getByRole('button', { name: '粗体', exact: true }).click();
  await expect.poll(async () => (await read()).nodes[nodeId]!.content?.content?.[0]?.content?.[0]?.marks?.some(m => m.type === 'strong')).toBe(true);
  await expect(page.frameLocator('iframe[title="隔离网页预览"]').locator(`[data-web-id="${nodeId}"] strong`)).toHaveText('Web rich text');
  await page.reload(); await page.locator('.web-editor-tree-select').filter({ hasText: 'Web rich text' }).click();
  await page.getByRole('button', { name: '编辑富文本', exact: true }).click();
  await expect(editor).toContainText('Web rich text');
  const html = await page.request.get(`/api/documents/${id}/export.html`); expect(await html.text()).toContain('<strong>Web rich text</strong>');
  // Store the local draft before transport, then fail once without a provider/model request.
  await page.route('**/api/commands', route => route.abort('failed'));
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Recover this draft');
  await expect(page.getByRole('button', { name: '恢复文字草稿' })).toBeVisible();
  await page.unroute('**/api/commands'); await page.reload();
  await page.locator('.web-editor-tree-select').filter({ hasText: 'Web rich text' }).click(); await page.getByRole('button', { name: '编辑富文本', exact: true }).click();
  await expect(page.getByLabel('未保存文字草稿')).toHaveText('Recover this draft');
  await page.getByRole('button', { name: '恢复文字草稿' }).click(); await expect.poll(async () => (await read()).nodes[nodeId]!.text).toBe('Recover this draft');
  await expect(page.getByRole('button', { name: '恢复文字草稿' })).not.toBeVisible();
  await mkdir('.tmp', { recursive: true }); await page.screenshot({ path: '.tmp/r4-web-richtext.png', fullPage: true });
  // Switching documents before the debounce fires still targets the old document.
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Saved during switch');
  await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect.poll(async () => (await read()).nodes[nodeId]!.text).toBe('Saved during switch');
  await expect.poll(() => page.getByLabel('选择文档').inputValue()).not.toBe(id);
  const other = await page.getByLabel('选择文档').inputValue();
  expect((await (await page.request.get(`/api/documents/${other}`)).json()).document.nodes[nodeId]).toBeUndefined();
});
