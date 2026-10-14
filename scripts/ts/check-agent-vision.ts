import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { buildWebProject } from '@oeydesign/media';
import { ProjectRuntime, ProjectAssets, createDesignServices } from '@oeydesign/runtime';
import { createVisionWeb } from '../../packages/runtime/test/fixtures/vision-web.ts';

// Opt-in paid acceptance: one new synthetic project, existing native Kimi credentials.
// Run with Node 24: node --import tsx scripts/ts/check-agent-vision.ts
process.loadEnvFile(resolve('.env'));
const root = resolve(`.tmp/agent-vision-${Date.now()}`);
const runtime = ProjectRuntime.create(root, { name: 'Synthetic visual repair acceptance' });
type Check = { tool: string; revision?: number; viewport?: { width: number; height: number }; renderMode?: string; filename?: string; isError?: boolean };
const checks: Check[] = [];
const screenshots: Promise<void>[] = [];
try {
  runtime.agent.configure({ providerId: 'kimi-coding', modelId: 'k3', baseUrl: '', apiKeyEnv: 'API_KEY', thinkingLevel: 'low' });
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = createVisionWeb(runtime);
  const screenshotDirectory = join(root, 'screenshots');
  await mkdir(screenshotDirectory, { recursive: true });
  const session = await runtime.agent.createSession();
  runtime.agent.subscribe(event => {
    const detail = event.event as { type?: string; toolName?: string; isError?: boolean; result?: { details?: Check; content?: Array<{ type: string; data?: string }> } } | undefined;
    if (detail?.type !== 'tool_execution_end' || !detail.toolName) return;
    const result = detail.result?.details;
    const check: Check = { tool: detail.toolName, revision: result?.revision, viewport: result?.viewport, renderMode: result?.renderMode, filename: result?.filename, isError: detail.isError };
    checks.push(check);
    console.log(JSON.stringify(check));
    if (detail.toolName === 'render_preview' && !detail.isError) {
      const image = detail.result?.content?.find(part => part.type === 'image');
      if (image?.data) screenshots.push(writeFile(join(screenshotDirectory, `${checks.length}-${result?.viewport?.width}-r${result?.revision}.png`), Buffer.from(image.data, 'base64')));
    }
  });
  const accepted = await runtime.agent.send(session.sessionId,
    '请把当前已有网页完善为可交付的响应式页面。先看当前实际画面，判断是否需要调整；保留现有三段文案、按钮和真实 React 组件，只修复必要的版式问题，完成后导出 build.zip。',
    { documentId: document.documentId });
  const timeout = setTimeout(() => { void runtime.agent.cancel(session.sessionId).catch(() => {}); }, 240_000);
  try { await runtime.agent.waitForIdle(session.sessionId); } finally { clearTimeout(timeout); }
  await Promise.all(screenshots);
  const run = runtime.agent.getRun(accepted.runId)!;
  assert.equal(run.status, 'completed', run.error);
  const latest = runtime.readWebDocument(document.documentId);
  assert.ok(latest.revision > document.revision, 'the defective layout must actually be repaired');
  const firstRepair = checks.findIndex(check => check.tool === 'document_apply' && !check.isError);
  assert.ok(firstRepair >= 0);
  const beforeRepair = checks.slice(0, firstRepair).filter(check => check.tool === 'render_preview' && !check.isError);
  assert.ok(beforeRepair.some(check => check.viewport?.width === 390 && check.revision === document.revision && check.renderMode === 'react'), 'inspect the actual defective phone layout before repair');
  const exportedIndex = checks.findLastIndex(check => check.tool === 'artifact_export' && !check.isError);
  assert.ok(exportedIndex > firstRepair, 'the repaired design must be delivered');
  const finalPreviews = checks.slice(firstRepair + 1, exportedIndex).filter(check => check.tool === 'render_preview' && !check.isError && check.revision === latest.revision);
  for (const width of [1280, 390]) assert.ok(finalPreviews.some(check => check.viewport?.width === width && check.renderMode === 'react'), `recheck final React revision at ${width}px before export`);
  assert.equal(checks[exportedIndex]!.revision, latest.revision);
  const zip = await JSZip.loadAsync(await readFile(join(root, 'exports', checks[exportedIndex]!.filename!)));
  assert.equal(JSON.parse(await zip.file('oey-build-metadata.json')!.async('string')).revision, latest.revision);

  // Independently measure the built result: hidden clipping or shrinking text is not a repair.
  const build = await buildWebProject(latest, new ProjectAssets(runtime).resolve);
  const types: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '') || 'index.html';
    const bytes = build.files[path];
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[path.split('.').at(-1)!] ?? 'application/octet-stream' }).end(bytes);
  });
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  const measurements: unknown[] = [];
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
      assert.ok(await page.getByRole('heading', { name: 'Design that works everywhere' }).isVisible());
      assert.ok(await page.getByText('Create, refine, and share your ideas.', { exact: true }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Start designing' }).isVisible());
      const measurement = await page.evaluate(() => {
        const doc = window.document;
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const failures: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.tagName === 'SCRIPT') continue;
          const range = doc.createRange(); range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects());
          if (!rects.length || rects.some(rect => rect.left < -1 || rect.right > window.innerWidth + 1)) failures.push(`clipped: ${node.textContent}`);
          if (Number.parseFloat(getComputedStyle(node.parentElement!).fontSize) < 16) failures.push(`too small: ${node.textContent}`);
        }
        const button = doc.querySelector('button')!.getBoundingClientRect();
        return { width: window.innerWidth, scrollWidth: doc.documentElement.scrollWidth, failures, button: { left: button.left, right: button.right, height: button.height } };
      });
      assert.ok(measurement.scrollWidth <= viewport.width + 1, 'no horizontal overflow');
      assert.deepEqual(measurement.failures, [], 'all preserved text must remain readable and in bounds');
      assert.ok(measurement.button.left >= 0 && measurement.button.right <= viewport.width + 1 && measurement.button.height >= 32);
      measurements.push(measurement);
      await page.close();
    }
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  }
  const messages = await runtime.agent.getMessages(session.sessionId);
  const assistant = messages.findLast(message => message.role === 'assistant');
  assert.equal(assistant?.api, 'anthropic-messages');
  const result = { status: 'passed', root, provider: assistant.provider, model: assistant.model, protocol: assistant.api, initialRevision: document.revision, finalRevision: latest.revision, checks, measurements };
  await writeFile(join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, root, initialRevision: document.revision, finalRevision: latest.revision }));
} catch (error) {
  await Promise.allSettled(screenshots);
  await writeFile(join(root, 'acceptance.json'), JSON.stringify({ status: 'failed', root, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally { runtime.close(); }
