import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Inspect the synthetic project produced by check-r3-real; never sends a model request.
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the synthetic R3 acceptance project directory.');
const acceptance = JSON.parse(await readFile(join(root, 'acceptance.json'), 'utf8')) as { sessionId: string };
const port = 4330;
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/web/src/server/main.ts', '--project', root, '--port', String(port)], { windowsHide: true, stdio: 'pipe' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let count = 0; count < 60; count++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/project`)).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) throw new Error(`Host exited ${child.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Web owner did not start');
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('选择对话').selectOption(acceptance.sessionId);
  await page.getByRole('link', { name: /下载 PPTX/ }).waitFor();
  await page.locator('.agent-message').first().waitFor();
  const transcript = await page.locator('.agent-transcript').innerText();
  assert.ok(transcript.includes('方向确认'), `Restored transcript: ${transcript.slice(0, 2000)}`);
  assert.ok(!transcript.includes('Current project design context'));
  await page.locator('.editor-page-item').nth(2).click();
  await page.screenshot({ path: join(root, 'exports', 'workbench.png') });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /下载 PPTX/ }).click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ root, sessionId: acceptance.sessionId, pages: await page.locator('.editor-page-item').count(), transcript: true, download: download.suggestedFilename(), screenshot: join(root, 'exports', 'workbench.png') }));
} finally { await browser?.close(); child.kill(); }
