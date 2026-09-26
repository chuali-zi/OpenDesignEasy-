import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import type { AddressInfo } from 'node:net';
import type { WebDocument } from '@oeydesign/document';
import { buildWebProject } from '../src/web-build.ts';
import { exportDocumentArtifact } from '../src/artifact.ts';

function project(source = `import {useState} from 'react';export default function Counter(){const [count,setCount]=useState(0);return <button data-counter onClick={()=>setCount(count+1)}>Count {count}</button>}`): WebDocument {
  return {
    schemaVersion: 1, documentId: 'build-project', kind: 'web', revision: 9, name: 'Built project',
    pages: [{ id: 'home', name: 'Home', route: '/', rootId: 'root' }],
    nodes: {
      root: { id: 'root', parentId: null, tag: 'main', children: ['counter'], style: {}, layout: { mode: 'flow' } },
      counter: { id: 'counter', parentId: 'root', tag: 'div', children: [], style: {}, layout: { mode: 'flow' }, component: { moduleId: 'counter-module', exportName: 'default' } },
    },
    sourceModules: [{ id: 'counter-module', path: 'Counter.tsx', language: 'tsx', source, exports: ['default'] }],
  };
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

test('Vite production build returns only dist files and the built component works in Chrome', { timeout: 120_000 }, async t => {
  const result = await buildWebProject(project());
  assert.equal(result.documentId, 'build-project');
  assert.equal(result.revision, 9);
  assert.ok(result.files['index.html']);
  assert.ok(result.files['oey-build-metadata.json']);
  assert.ok(Object.keys(result.files).every(path => !path.startsWith('dist/') && !path.includes('oey-document') && !path.endsWith('.tsx')));
  assert.equal(JSON.parse(new TextDecoder().decode(result.files['oey-build-metadata.json'])).status, 'built');

  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]!).replace(/^\/+/, '') || 'index.html';
    const bytes = result.files[path] ?? result.files['index.html'];
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': contentType(path) }).end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address() as AddressInfo;
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`failed ${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-counter]').textContent(), 'Count 0');
  await page.locator('[data-counter]').click();
  assert.equal(await page.locator('[data-counter]').textContent(), 'Count 1');
  assert.deepEqual(errors, []);
});

test('invalid managed component source reports a Vite build error and pre-abort avoids building', { timeout: 120_000 }, async () => {
  await assert.rejects(buildWebProject(project('export default function Counter( {')), /Vite build failed[\s\S]*(?:error|Expected|Parse)/i);
  const controller = new AbortController();
  controller.abort(new Error('cancel before build'));
  await assert.rejects(buildWebProject(project(), undefined, { signal: controller.signal }), /cancel before build/);
});

test('artifact build.zip contains Vite dist outputs and metadata at the archive root', async () => {
  const bytes = await exportDocumentArtifact(project(), undefined, 'build.zip');
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('index.html'));
  assert.ok(Object.keys(zip.files).some(path => path.startsWith('assets/')));
  assert.equal(JSON.parse(await zip.file('oey-build-metadata.json')!.async('string')).format, 'web-build');
  assert.ok(!Object.keys(zip.files).some(path => path.startsWith('dist/')));
});
