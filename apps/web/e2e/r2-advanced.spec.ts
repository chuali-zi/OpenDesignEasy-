import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import type { DeckDocument } from '@oeydesign/document';

test('R2 rich text, image crop, table and chart edits persist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '增加文字', exact: true })).toBeVisible();

  const created = (await (await page.request.post('/api/documents', { data: { name: 'Advanced editor fixture' } })).json()).document as DeckDocument;
  await expect(page.getByLabel('选择文档').locator(`option[value="${created.documentId}"]`)).toHaveCount(1);
  await page.getByLabel('选择文档').selectOption(created.documentId);
  const snapshot = async (): Promise<DeckDocument> => (await (await page.request.get('/api/project')).json()).documents.find((document: DeckDocument) => document.documentId === created.documentId);
  const insertMenu = page.locator('summary[aria-label="插入其他对象"]');
  const openInsertMenu = async () => {
    if (!(await insertMenu.evaluate(element => element.parentElement?.hasAttribute('open') ?? false))) await insertMenu.click();
  };

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BwAAAABJRU5ErkJggg==', 'base64');
  await page.getByLabel('选择图片文件', { exact: true }).setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => Object.values((await snapshot()).nodes).filter(node => node.kind === 'image').length).toBe(1);
  await page.getByLabel('图片裁切左', { exact: true }).fill('0.12');
  await page.getByLabel('图片裁切左', { exact: true }).blur();
  await expect.poll(async () => {
    const image = Object.values((await snapshot()).nodes).find(node => node.kind === 'image');
    return image?.image?.crop?.left;
  }).toBe(0.12);

  await openInsertMenu();
  await page.getByRole('button', { name: '添加表格', exact: true }).click();
  await expect(page.getByLabel('表格单元格 1,1', { exact: true })).toBeVisible();
  await page.getByLabel('表格单元格 1,1', { exact: true }).fill('Month');
  await page.getByLabel('表格单元格 1,1', { exact: true }).blur();
  await expect.poll(async () => {
    const tableNode = Object.values((await snapshot()).nodes).find(node => node.kind === 'table');
    return tableNode?.table?.rows[0]?.cells[0]?.content.content?.[0]?.content?.[0]?.text;
  }).toBe('Month');

  await openInsertMenu();
  await page.getByRole('button', { name: '添加图表', exact: true }).click();
  const chartTitle = page.getByLabel('图表标题', { exact: true });
  await chartTitle.fill('Revenue by month');
  await chartTitle.blur();
  await expect.poll(async () => Object.values((await snapshot()).nodes).find(node => node.kind === 'chart')?.chart?.title).toBe('Revenue by month');

  const categories = page.getByLabel('图表类目', { exact: true });
  await categories.fill('North, South');
  await categories.blur();
  await expect.poll(async () => Object.values((await snapshot()).nodes).find(node => node.kind === 'chart')?.chart?.categories).toEqual(['North', 'South']);
  await expect.poll(async () => Object.values((await snapshot()).nodes).find(node => node.kind === 'chart')?.chart?.series[0]?.name).toBe('实际值');
  const seriesValues = page.getByLabel('实际值 系列数据', { exact: true });
  await seriesValues.fill('10, 20');
  await seriesValues.blur();
  await expect.poll(async () => Object.values((await snapshot()).nodes).find(node => node.kind === 'chart')?.chart?.series[0]?.values).toEqual([10, 20]);

  await page.getByRole('button', { name: '增加形状', exact: true }).click();
  await expect.poll(async () => Object.values((await snapshot()).nodes).filter(node => node.kind === 'shape').length).toBe(1);
  await page.getByRole('button', { name: '增加文字', exact: true }).click();
  const textContent = page.getByLabel('富文本内容', { exact: true });
  await expect(textContent).toBeVisible();
  await textContent.fill('Alpha beta');
  await page.keyboard.press('Home');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight', { delay: 160 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha');
  await page.getByLabel('粗体', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect.poll(() => textContent.locator('strong').allTextContents()).toEqual(['Alpha']);
  await page.getByLabel('文字颜色', { exact: true }).evaluate(element => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '#c0392b');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Use a DOM click so the contenteditable keeps focus: selection changes and
  // unmounts the editor before its 520 ms debounce, exercising cleanup flush.
  const shapeLayer = page.locator('.editor-layer-select').filter({ hasText: '矩形 ·' });
  await expect(shapeLayer).toHaveCount(1);
  await shapeLayer.evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByLabel('富文本内容', { exact: true })).toHaveCount(0);

  await expect.poll(async () => Object.values((await snapshot()).nodes).some(node => node.kind === 'text' && JSON.stringify(node.content).includes('Alpha'))).toBe(true);
  const latest = await snapshot();
  const textNode = Object.values(latest.nodes).find(node => node.kind === 'text' && JSON.stringify(node.content).includes('Alpha'))!;

  const alpha = textNode.content?.content?.flatMap(block => block.content ?? []).find(run => run.type === 'text' && run.text === 'Alpha');
  expect(alpha?.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'strong' }),
    expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: '#c0392b' }) }),
  ]));

  const previewAlpha = page.locator('.editor-rich-preview span').filter({ hasText: /^Alpha$/ });
  await expect(previewAlpha).toHaveCSS('font-weight', '700');
  await expect(previewAlpha).toHaveCSS('color', 'rgb(192, 57, 43)');
  expect(errors).toEqual([]);
});
