import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { WebDocument, WebOperation } from '@oeydesign/document';

test('built application preview runs components and routes without changing the design, and rebuild errors recover', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '新建 Web 文档' }).click();
  await expect(page.getByRole('main', { name: 'Web 编辑器' })).toBeVisible();
  const documentId = await page.getByLabel('选择文档').inputValue();
  const read = async (): Promise<WebDocument> => (await (await page.request.get(`/api/documents/${documentId}`)).json()).document;
  const projectId = (await (await page.request.get('/api/project')).json()).project.projectId;
  const apply = async (operations: WebOperation[]) => {
    const doc = await read();
    const result = await page.request.post('/api/commands', { data: {
      commandId: randomUUID(), projectId, documentId, actorId: 'local-user', actorKind: 'human', clientId: 'preview-e2e',
      baseRevision: doc.revision, preconditions: [], operations, label: 'Synthetic preview fixture',
    } });
    expect(result.status(), await result.text()).toBe(200);
  };
  const source = `import {useState} from 'react'; export default function Demo(){const [n,setN]=useState(0);return <article style={{padding:48,fontFamily:'sans-serif',color:'#244e3d'}}><p>OEYdesign · 合成测试</p><h1>受管组件现在可以实际运行</h1><p>点击按钮验证交互，使用链接切换页面。</p><button onClick={()=>setN(n+1)}>计数：{n}</button><p><a href="/about">打开第二页</a></p></article>}`;
  const module = { id: 'preview-demo', path: 'Demo.tsx', language: 'tsx' as const, exports: ['default'], source };
  await apply([
    { type: 'source.update', module },
    { type: 'web.node.update', nodeId: (await read()).pages[0]!.rootId, component: { moduleId: module.id, exportName: 'default' } },
    { type: 'web.page.insert', page: { id: 'about', name: 'About', route: '/about', rootId: 'about-root' },
      root: { id: 'about-root', parentId: null, tag: 'main', children: [], text: '这是第二页', style: { padding: 48 }, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'back', parentId: 'about-root', tag: 'a', children: [], text: '返回首页', props: { href: '/' }, style: {}, layout: { mode: 'flow' } } },
  ]);
  const revision = (await read()).revision;
  await page.getByRole('button', { name: '运行应用', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '应用交互预览' });
  const frame = page.frameLocator('iframe[title="构建应用预览"]');
  await expect(frame.getByRole('button', { name: '计数：0' })).toBeVisible();
  await frame.getByRole('button', { name: '计数：0' }).click();
  await expect(frame.getByRole('button', { name: '计数：1' })).toBeVisible();
  expect((await read()).revision).toBe(revision);
  expect(await frame.locator('body').evaluate(() => {
    try { void window.parent.document.body; return false; } catch { return true; }
  })).toBe(true);
  const originalUrl = (await page.locator('iframe[title="构建应用预览"]').getAttribute('src'))!;
  expect((await page.request.get(`${originalUrl}/api/project`)).status()).toBe(404);
  await page.screenshot({ path: '.tmp/r4-application-preview.png', fullPage: true });
  await frame.getByRole('link', { name: '打开第二页' }).click();
  await expect(frame.getByText('这是第二页')).toBeVisible();
  await frame.getByRole('link', { name: '返回首页' }).click();
  await expect(frame.getByRole('button', { name: '计数：0' })).toBeVisible();

  await apply([{ type: 'source.update', module: { ...module, source: 'export default function Broken( {' } }]);
  await expect(dialog).toContainText('作品已更新');
  await dialog.getByRole('button', { name: '重新构建预览' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vite build failed');
  await expect(frame.getByRole('button', { name: '计数：0' })).toBeVisible();
  await apply([{ type: 'source.update', module: { ...module, source: source.replace('计数：', '新计数：') } }]);
  await dialog.getByRole('button', { name: '重新构建预览' }).click();
  await expect(frame.getByRole('button', { name: '新计数：0' })).toBeVisible();
  await expect(async () => { await expect(page.request.get(originalUrl)).rejects.toThrow(); }).toPass();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
