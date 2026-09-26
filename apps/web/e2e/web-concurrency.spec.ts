import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { WebDocument, WebOperation } from '@oeydesign/document';
import type { Page } from '@playwright/test';

async function currentWebDocument(page: Page): Promise<WebDocument> {
  const documentId = await page.getByLabel('选择文档').inputValue();
  return (await (await page.request.get(`/api/documents/${encodeURIComponent(documentId)}`)).json()).document as WebDocument;
}

async function remoteEdit(page: Page, document: WebDocument, operation: WebOperation, label: string) {
  const project = await (await page.request.get('/api/project')).json();
  const response = await page.request.post('/api/commands', { data: {
    commandId: randomUUID(), projectId: project.project.projectId, documentId: document.documentId,
    actorId: 'agent:e2e', actorKind: 'agent', clientId: 'agent-e2e', baseRevision: document.revision,
    preconditions: [], operations: [operation], label,
  } });
  // The local Web host binds browser/API commands to its human identity. This still
  // exercises the same command, revision, conflict, and event path as an agent edit.
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  return JSON.parse(body) as { document: WebDocument };
}

async function openNewWebDocument(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
}

test('a stale text draft stays recoverable while unrelated agent style edits still merge', async ({ page }) => {
  await openNewWebDocument(page);
  await page.getByRole('button', { name: '标题', exact: true }).click();
  await expect(page.getByLabel('元素文案')).toBeVisible();
  let document = await currentWebDocument(page);
  const heading = Object.values(document.nodes).find(node => node.tag === 'h2')!;
  const text = page.getByLabel('元素文案');

  await text.fill('人工尚未提交的标题');
  const concurrent = await remoteEdit(page, document, {
    type: 'web.node.update', nodeId: heading.id, text: 'Agent 已保存标题',
  }, 'Agent changes the same text');
  await expect(page.locator('.web-editor-toolbar')).toContainText(`修订 ${concurrent.document.revision}`);
  await expect(text).toHaveValue('人工尚未提交的标题');
  await text.blur();
  await expect(page.getByText('未保存的输入已保留')).toBeVisible();
  await expect(text).toHaveValue('人工尚未提交的标题');
  await expect.poll(async () => (await currentWebDocument(page)).nodes[heading.id]?.text).toBe('Agent 已保存标题');

  await page.getByRole('button', { name: '恢复已保存值' }).click();
  await expect(text).toHaveValue('Agent 已保存标题');
  document = await currentWebDocument(page);
  await text.fill('人工沿用 Agent 标题继续修改');
  const styleEdit = await remoteEdit(page, document, {
    type: 'web.style.update', nodeId: heading.id, style: { color: '#315d4b' },
  }, 'Agent changes a separate style field');
  await expect(page.locator('.web-editor-toolbar')).toContainText(`修订 ${styleEdit.document.revision}`);

  await text.blur();
  await expect.poll(async () => (await currentWebDocument(page)).nodes[heading.id]?.text).toBe('人工沿用 Agent 标题继续修改');
  expect((await currentWebDocument(page)).nodes[heading.id]?.style.color).toBe('#315d4b');
  await expect(page.getByText('未保存的输入已保留')).toHaveCount(0);
});

test('dirty source refuses a stale overwrite and locks its textarea while saving', async ({ page }) => {
  await openNewWebDocument(page);
  const documentId = await page.getByLabel('选择文档').inputValue();
  await page.getByRole('button', { name: '源码模块' }).click();
  await page.getByLabel('新模块路径').fill('styles/concurrency.css');
  await page.getByRole('button', { name: '新建模块' }).click();
  await expect.poll(async () => (await currentWebDocument(page)).sourceModules?.some(module => module.path === 'styles/concurrency.css')).toBe(true);

  const source = page.getByLabel('源码模块内容');
  await expect(source).toBeVisible();
  let document = await currentWebDocument(page);
  let module = document.sourceModules!.find(item => item.path === 'styles/concurrency.css')!;
  const userDraft = `${module.source}/* local draft */\n`;
  await source.fill(userDraft);
  const externalSource = `${module.source}/* remote edit */\n`;
  const remote = await remoteEdit(page, document, {
    type: 'source.update', module: { ...module, source: externalSource },
  }, 'Agent changes the same source module');
  await expect(page.locator('.web-editor-toolbar')).toContainText(`修订 ${remote.document.revision}`);
  await expect(source).toHaveValue(userDraft);
  await page.getByRole('button', { name: '保存模块' }).click();
  await expect(page.locator('.web-editor-error')).toBeVisible();
  await expect(source).toHaveValue(userDraft);
  await expect.poll(async () => (await currentWebDocument(page)).sourceModules?.find(item => item.id === module.id)?.source).toBe(externalSource);

  await page.getByRole('button', { name: '恢复已保存源码' }).click();
  await expect(source).toHaveValue(externalSource);
  document = await currentWebDocument(page);
  module = document.sourceModules!.find(item => item.id === module.id)!;
  const finalSource = `${externalSource}/* save after conflict */\n`;
  await source.fill(finalSource);

  let release!: () => void;
  let commandStarted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { commandStarted = resolve; });
  await page.route('**/api/commands', async route => {
    commandStarted();
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '保存模块' }).click();
    await started;
    await expect(source).toBeDisabled();
  } finally {
    release();
  }
  await expect.poll(async () => (await currentWebDocument(page)).sourceModules?.find(item => item.id === module.id)?.source).toBe(finalSource);
  await page.unroute('**/api/commands');
  expect(await page.getByLabel('选择文档').inputValue()).toBe(documentId);
});
