import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createTextReplaceStep, textFromString } from '@oeydesign/document';
import type { DeliveryManifest } from '@oeydesign/media';
import { checkDelivery, createDeliveryBundle, createDesignServices, ProjectAssets, ProjectRuntime } from '../src/index.ts';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwDHMDAAGJAM6JKQi9AAAAAElFTkSuQmCC', 'base64');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

for (const kind of ['doc', 'deck', 'web'] as const) test(`${kind}: bundle binds native artifact, snapshot and asset hashes with explicit untested checks`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-delivery-'));
  const runtime = ProjectRuntime.create(root);
  try {
    const asset = await new ProjectAssets(runtime).importImage(pixel, '../synthetic.png');
    await new ProjectAssets(runtime).importReference(Buffer.from('PRIVATE synthetic source excluded'), 'private-notes.txt');
    const document = runtime.createDocument({ kind, name: '合成交付' });
    const operations = kind === 'doc' ? [
      { type: 'asset.register' as const, asset },
      { type: 'doc.text.apply' as const, sectionId: runtime.readDocDocument(document.documentId).sections[0]!.id, steps: [{ stepType: 'replace', from: 0, to: 2, slice: { content: [
        { type: 'paragraph', content: [{ type: 'text', text: '共同文案 TODO' }] },
        { type: 'paragraph', content: [{ type: 'inline_image', attrs: { assetId: asset.id, width: 30, height: 30, alt: '合成图片' } }] },
      ] } }] },
    ] : kind === 'deck' ? [
      { type: 'asset.register' as const, asset },
      { type: 'node.insert' as const, node: { id: 'title', kind: 'text' as const, parentId: runtime.readDeckDocument(document.documentId).pages[0]!.id, geometry: { x: 40, y: 40, width: 600, height: 120, rotation: 0 }, style: {}, hidden: false, locked: false, content: textFromString('共同文案 TODO') } },
      { type: 'node.insert' as const, node: { id: 'image', kind: 'image' as const, parentId: runtime.readDeckDocument(document.documentId).pages[0]!.id, geometry: { x: 40, y: 200, width: 100, height: 100, rotation: 0 }, style: {}, hidden: false, locked: false, assetId: asset.id } },
    ] : [
      { type: 'asset.register' as const, asset },
      { type: 'web.node.insert' as const, node: { id: 'title', parentId: runtime.readWebDocument(document.documentId).pages[0]!.rootId, tag: 'h1', children: [], style: {}, layout: { mode: 'flow' as const }, text: '共同文案 TODO' } },
      { type: 'web.node.insert' as const, node: { id: 'image', parentId: runtime.readWebDocument(document.documentId).pages[0]!.rootId, tag: 'img', children: [], style: { width: 100 }, layout: { mode: 'flow' as const }, props: { assetId: asset.id, alt: '合成图片' } } },
    ];
    runtime.submit(runtime.makeCommand(document.documentId, operations));
    const before = runtime.readDocument(document.documentId), events = runtime.events();
    const report = await checkDelivery(runtime, document.documentId, { expectedRevision: before.revision });
    assert.equal(report.summary.errors, 0); assert.equal(report.findings.filter(item => item.code === 'content.placeholder').length, 1);
    assert.equal(report.findings[0]!.code, 'content.placeholder'); assert.equal(report.assets[0]!.sha256, hash(pixel));
    assert.deepEqual(report.checks.filter(check => check.status === 'not-run').map(check => check.id), ['visual', 'native-app', 'facts']);
    const bundle = await createDeliveryBundle(runtime, document.documentId, { expectedRevision: before.revision });
    const zip = await JSZip.loadAsync(bundle.bytes);
    const manifest = JSON.parse(await zip.file('delivery.json')!.async('string')) as DeliveryManifest;
    assert.equal(manifest.report.documentSha256, report.documentSha256);
    assert.equal(report.renderer?.phase, 'planned'); assert.equal(manifest.report.renderer?.phase, 'generated');
    assert.equal(report.fonts?.probe, 'measured'); assert.ok(report.fonts?.runs.length);
    const artifact = await zip.file(manifest.artifact.filename)!.async('uint8array');
    assert.equal(hash(artifact), manifest.artifact.sha256); assert.equal(artifact.length, manifest.artifact.sizeBytes);
    assert.deepEqual(Object.keys(zip.files).sort(), [manifest.artifact.filename, 'README.txt', 'delivery.json'].sort());
    const native = await JSZip.loadAsync(artifact);
    if (kind !== 'web') assert.match(await native.file(kind === 'doc' ? 'word/document.xml' : 'ppt/slides/slide1.xml')!.async('string'), /共同文案 TODO/);
    else assert.ok(Object.keys(native.files).some(name => name.endsWith('oey-document.json')));
    assert.doesNotMatch(await zip.file('delivery.json')!.async('string'), /PRIVATE|private-notes|project.sqlite|apiKey/);
    assert.deepEqual(runtime.readDocument(document.documentId), before); assert.deepEqual(runtime.events(), events);
    assert.deepEqual(runtime.listRecords('exports'), []); assert.deepEqual(await readdir(join(root, 'exports')), []);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('edits, undo/redo and reopen invalidate checked revisions without modifying human history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-delivery-history-')); let runtime = ProjectRuntime.create(root);
  try {
    const doc = runtime.createDocument({ kind: 'doc' }), id = doc.documentId, sectionId = doc.sections[0]!.id;
    runtime.submit(runtime.makeCommand(id, [{ type: 'doc.text.apply', sectionId, steps: [createTextReplaceStep(1, 1, '人工原文')] }]));
    const before = await checkDelivery(runtime, id);
    for (let i = 0; i < 3; i++) {
      runtime.submit(runtime.makeCommand(id, [{ type: 'doc.text.apply', sectionId, steps: [createTextReplaceStep(1, 1, '改')] }]));
      await assert.rejects(createDeliveryBundle(runtime, id, { expectedRevision: before.revision }), /文档已更新/); runtime.undo(id);
    }
    runtime.redo(id); const edited = runtime.readDocDocument(id);
    runtime.close(); runtime = ProjectRuntime.open(root); assert.deepEqual(runtime.readDocument(id), edited);
    await assert.rejects(checkDelivery(runtime, id, { expectedRevision: before.revision }), /文档已更新/);
    const fresh = await createDeliveryBundle(runtime, id, { expectedRevision: edited.revision }); assert.equal(fresh.manifest.report.revision, edited.revision);
    await assert.rejects(createDeliveryBundle(runtime, id, { expectedRevision: undefined as unknown as number }), /expectedRevision/);
    await assert.rejects(checkDelivery(runtime, id, { expectedRevision: -1 }), /非负整数/);
    await assert.rejects(checkDelivery(runtime, id, { format: 'pptx' }), /不支持/);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('missing/corrupt bytes block delivery; cancellation publishes nothing and reports hide local paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-delivery-failure-')); const runtime = ProjectRuntime.create(root);
  try {
    const assets = new ProjectAssets(runtime), asset = await assets.importImage(pixel, 'synthetic.png');
    const doc = runtime.createDocument({ kind: 'doc' }), id = doc.documentId;
    runtime.submit(runtime.makeCommand(id, [{ type: 'asset.register', asset }]));
    const path = join(root, 'assets', `${asset.id}.bin`), damaged = Buffer.from(await readFile(path)); damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    await writeFile(path, damaged);
    let report = await checkDelivery(runtime, id); assert.equal(report.findings[0]!.code, 'asset.unavailable'); assert.equal(report.summary.errors, 1);
    assert.doesNotMatch(JSON.stringify(report), /oey-delivery-failure|AppData|ENOENT/);
    await assert.rejects(createDeliveryBundle(runtime, id, { expectedRevision: 1 }), /发现错误/);
    await rm(path); report = await checkDelivery(runtime, id); assert.equal(report.summary.errors, 1);
    await writeFile(path, pixel);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(createDesignServices(runtime).deliverArtifact!({ documentId: id, expectedRevision: 1 }, controller.signal), /abort/i);
    assert.deepEqual(await readdir(join(root, 'exports')), []); assert.deepEqual(runtime.listRecords('exports'), []);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('a human edit during material reads rejects delivery without an export record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-delivery-race-')); const runtime = ProjectRuntime.create(root);
  const original = ProjectAssets.prototype.read;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { started = resolve; });
  try {
    const asset = await new ProjectAssets(runtime).importImage(pixel, 'image.png');
    const doc = runtime.createDocument({ kind: 'doc' }); runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'asset.register', asset }]));
    ProjectAssets.prototype.read = async function (id) { started(); await gate; return original.call(this, id); };
    const delivery = createDesignServices(runtime).deliverArtifact!({ documentId: doc.documentId, expectedRevision: 1 }, new AbortController().signal);
    await reading; runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'doc.text.apply', sectionId: doc.sections[0]!.id, steps: [createTextReplaceStep(1, 1, '保留人工修改')] }]));
    release(); await assert.rejects(delivery, /文档已更新/);
    let unblock!: () => void, notify!: () => void;
    const delayed = new Promise<void>(resolve => { unblock = resolve; }), entered = new Promise<void>(resolve => { notify = resolve; });
    ProjectAssets.prototype.read = async function (id) { notify(); await delayed; return original.call(this, id); };
    const controller = new AbortController();
    const cancelled = createDesignServices(runtime).deliverArtifact!({ documentId: doc.documentId, expectedRevision: 2 }, controller.signal);
    await entered; controller.abort(); unblock(); await assert.rejects(cancelled, /abort/i);
    assert.deepEqual(await readdir(join(root, 'exports')), []); assert.deepEqual(runtime.listRecords('exports'), []);
  } finally { release?.(); ProjectAssets.prototype.read = original; runtime.close(); await rm(root, { recursive: true, force: true }); }
});
