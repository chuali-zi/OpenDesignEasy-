import assert from 'node:assert/strict';
import test from 'node:test';
import { startApplicationPreview } from '../src/server/application-preview.ts';

test('preview serves only immutable build files and page routes, then closes its listener', async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const preview = await startApplicationPreview({ documentId: 'synthetic', revision: 7, files: {
    'index.html': encode('<main>preview</main>'), 'assets/app.js': encode('console.log("synthetic")'),
  } }, ['/', '/about']);
  try {
    const page = await fetch(`${preview.url}/about`);
    assert.equal(await page.text(), '<main>preview</main>');
    assert.match(page.headers.get('content-security-policy')!, /sandbox allow-scripts;/);
    assert.doesNotMatch(page.headers.get('content-security-policy')!, /allow-same-origin/);
    assert.match(page.headers.get('content-security-policy')!, /connect-src 'none'/);
    assert.equal((await fetch(`${preview.url}/assets/app.js`)).headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(`${preview.url}/api/project`)).status, 404);
    assert.equal((await fetch(`${preview.url}/%2e%2e/project.sqlite`)).status, 404);
    assert.equal((await fetch(preview.url, { method: 'POST' })).status, 405);
  } finally { await preview.close(); }
  await assert.rejects(fetch(preview.url));
});
