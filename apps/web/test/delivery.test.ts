import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ProjectRuntime } from '@oeydesign/runtime';
import { createWebHost } from '../src/server/host.ts';

test('delivery HTTP API rejects stale revisions, unsupported formats and unrelated origins; report is uncached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-delivery-host-')), runtime = ProjectRuntime.create(root), app = await createWebHost(runtime);
  try {
    const doc = runtime.createDocument({ kind: 'doc' }), id = doc.documentId;
    const checked = await app.inject({ url: `/api/documents/${id}/delivery-check?revision=0` });
    assert.equal(checked.statusCode, 200, checked.body); assert.equal(checked.headers['cache-control'], 'no-store');
    runtime.submit(runtime.makeCommand(id, [{ type: 'doc.page.update', settings: { marginLeft: 80 } }]));
    for (const revision of [undefined, '1', null, -1, 0]) {
      const result = await app.inject({ method: 'POST', url: `/api/documents/${id}/delivery.zip`, payload: { expectedRevision: revision } });
      assert.equal(result.statusCode, revision === 0 ? 409 : 400, result.body);
    }
    assert.equal((await app.inject({ url: `/api/documents/${id}/delivery-check?format=pptx` })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/documents/${id}/delivery.zip`, headers: { origin: 'https://unrelated.example' }, payload: { expectedRevision: 1 } })).statusCode, 403);
    const delivered = await app.inject({ method: 'POST', url: `/api/documents/${id}/delivery.zip`, payload: { expectedRevision: 1 } });
    assert.equal(delivered.statusCode, 200, delivered.body); assert.equal(delivered.headers['x-document-revision'], '1');
    assert.equal(delivered.headers['x-delivery-renderer'], 'docx / OOXML');
    const zip = await JSZip.loadAsync(delivered.rawPayload); assert.ok(zip.file('doc-r1.docx'));
    const report = JSON.parse(await zip.file('delivery.json')!.async('string')).report;
    assert.equal(report.revision, 1); assert.equal(report.renderer.phase, 'generated');
    assert.equal(report.checks.find((item: { id: string }) => item.id === 'native-app').status, 'not-run');
    assert.equal(runtime.readDocument(id).revision, 1);
  } finally { await app.close(); runtime.close(); await rm(root, { recursive: true, force: true }); }
});
