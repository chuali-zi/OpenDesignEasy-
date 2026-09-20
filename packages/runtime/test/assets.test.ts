import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '../src/project-runtime.ts';
import { ProjectAssets } from '../src/assets.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BwAAAABJRU5ErkJggg==', 'base64');
test('original assets and bounded references persist without changing document history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-assets-'));
  let runtime = ProjectRuntime.create(root);
  try {
    const document = runtime.createDocument();
    const assets = new ProjectAssets(runtime);
    const image = await assets.importImage(png, '标题.png');
    assert.equal(image.width, 1);
    const reference = await assets.importReference(Buffer.from('第一行\nsecond line'), 'brief.md');
    const excerpt = await assets.readReference(reference.id, 0, 3);
    assert.equal(excerpt.text, '第一行');
    assert.equal(excerpt.hasMore, true);
    assert.equal(runtime.readDocument(document.documentId).revision, 0);
    await assert.rejects(assets.read('../project.sqlite'), /Invalid asset/);
    await assert.rejects(assets.importImage(Buffer.from('<svg/>'), 'fake.png'), /decoded/);
    await assert.rejects(assets.importImage(png, 'cancelled.png', AbortSignal.abort()));
    runtime.close();
    runtime = ProjectRuntime.open(root);
    const reopened = new ProjectAssets(runtime);
    assert.equal(reopened.list().length, 2);
    assert.deepEqual(Buffer.from(await reopened.resolve(image.id)), png);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});
