import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ProjectRuntime, ProjectAssets } from '../src/index.ts';
import { exportWebSourceZip, readSourceArchive, WEB_IMPORT_LIMITS } from '@oeydesign/media';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv2sAAAAASUVORK5CYII=', 'base64');

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'oey-import-')); const runtime = ProjectRuntime.create(root);
  t.after(async () => { runtime.close(); await rm(root, { recursive: true, force: true }); });
  const assets = new ProjectAssets(runtime); const image = await assets.importImage(pixel, 'pixel.png');
  const doc = runtime.createDocument({ name: 'Imported workshop', kind: 'web' });
  runtime.submit(runtime.makeCommand(doc.documentId, [
    { type: 'asset.register', asset: image },
    { type: 'source.update', module: { id: 'counter-module', path: 'components/Counter.tsx', language: 'tsx', exports: ['default'], source: "export default function Counter(){return <button>Original counter</button>}" } },
    { type: 'web.node.insert', node: { id: 'headline', parentId: doc.pages[0]!.rootId, tag: 'h1', text: 'Editable title', children: [], style: { color: '#325b44' }, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'photo', parentId: doc.pages[0]!.rootId, tag: 'img', props: { assetId: image.id }, children: [], style: {}, layout: { mode: 'flow' } } },
    { type: 'web.node.insert', node: { id: 'counter', parentId: doc.pages[0]!.rootId, tag: 'div', component: { moduleId: 'counter-module', exportName: 'default' }, children: [], style: {}, layout: { mode: 'flow' } } },
    { type: 'web.page.insert', page: { id: 'about-page', name: 'About', route: '/about', rootId: 'about-root' }, root: { id: 'about-root', parentId: null, tag: 'main', children: [], style: {}, layout: { mode: 'flow' } } },
  ]));
  const snapshot = runtime.readWebDocument(doc.documentId);
  const bytes = await exportWebSourceZip(snapshot, assets.resolve);
  return { root, runtime, assets, snapshot, bytes };
}

test('source ZIP imports managed edits, images and routes into a new persisted editable design', async t => {
  const f = await fixture(t); t.mock.method(globalThis, 'fetch', () => { throw new Error('Import must not access a network'); });
  const zip = await JSZip.loadAsync(f.bytes);
  const edited = 'export default function Counter(){return <button>External edit</button>}';
  zip.file('src/components/Counter.tsx', edited);
  zip.file('package.json', '{"scripts":{"install":"must never execute"}}');
  zip.file('vite.config.ts', 'throw new Error("must never execute config")');
  const result = await f.runtime.importWebSource(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  assert.notEqual(result.document.documentId, f.snapshot.documentId); assert.equal(result.document.revision, 0);
  assert.deepEqual(result.document.pages, f.snapshot.pages); assert.equal(result.document.nodes.headline!.text, 'Editable title');
  assert.equal(result.document.sourceModules![0]!.source, edited); assert.deepEqual(result.changedModules, ['components/Counter.tsx']);
  const assetId = result.document.nodes.photo!.props!.assetId as string;
  assert.notEqual(assetId, f.snapshot.nodes.photo!.props!.assetId); assert.deepEqual(Buffer.from(await f.assets.resolve(assetId)), pixel);
  assert.deepEqual(f.runtime.readWebDocument(f.snapshot.documentId), f.snapshot);
  f.runtime.submit(f.runtime.makeCommand(result.document.documentId, [{ type: 'web.node.update', nodeId: 'headline', text: 'Human edit after import' }]));
  f.runtime.undo(result.document.documentId); assert.equal(f.runtime.readWebDocument(result.document.documentId).nodes.headline!.text, 'Editable title');
  f.runtime.redo(result.document.documentId);
  f.runtime.close(); const reopened = ProjectRuntime.open(f.root);
  try {
    const doc = reopened.readWebDocument(result.document.documentId); assert.equal(doc.nodes.headline!.text, 'Human edit after import');
    const roundtrip = await reopened.importWebSource(await exportWebSourceZip(doc, new ProjectAssets(reopened).resolve));
    assert.equal(roundtrip.document.nodes.headline!.text, 'Human edit after import'); assert.equal(roundtrip.document.sourceModules![0]!.source, edited);
  } finally { reopened.close(); }
});

for (const scenario of ['generated edit', 'missing module', 'missing image', 'bad structure', 'bad image', 'secret path', 'arbitrary project', 'absolute module import', 'undeclared module import', 'dynamic module path', 'filesystem macro'] as const) {
  test(`rejects ${scenario} without changing designs or assets`, async t => {
    const f = await fixture(t); const zip = await JSZip.loadAsync(f.bytes);
    if (scenario === 'generated edit') zip.file('src/App.tsx', 'externally modified generated tree');
    if (scenario === 'missing module') zip.remove('src/components/Counter.tsx');
    if (scenario === 'missing image') zip.remove(`public/assets/${f.snapshot.nodes.photo!.props!.assetId}`);
    if (scenario === 'bad structure') { const d = structuredClone(f.snapshot); d.nodes.headline!.children = ['headline']; zip.file('oey-document.json', JSON.stringify(d)); }
    if (scenario === 'bad image') zip.file(`public/assets/${f.snapshot.nodes.photo!.props!.assetId}`, 'not a PNG');
    if (scenario === 'secret path') zip.file('.env', 'synthetic forbidden file');
    if (scenario === 'arbitrary project') zip.remove('oey-document.json');
    if (scenario === 'absolute module import') zip.file('src/components/Counter.tsx', "import x from '/synthetic-secret.json'; export default function Counter(){return null}");
    if (scenario === 'undeclared module import') zip.file('src/components/Counter.tsx', "import x from '../../missing'; export default function Counter(){return null}");
    if (scenario === 'dynamic module path') zip.file('src/components/Counter.tsx', 'const path="x"; import(path); export default function Counter(){return null}');
    if (scenario === 'filesystem macro') zip.file('src/components/Counter.tsx', 'const x=import.meta.glob("../../*"); export default function Counter(){return null}');
    const assetsBefore = await readdir(join(f.root, 'assets')); const eventsBefore = f.runtime.events().length;
    await assert.rejects(f.runtime.importWebSource(await zip.generateAsync({ type: 'uint8array' })), error => { assert.equal((error as { code: string }).code, 'invalid'); return true; });
    assert.deepEqual(f.runtime.listDocuments(), [f.snapshot]); assert.deepEqual(await readdir(join(f.root, 'assets')), assetsBefore); assert.equal(f.runtime.events().length, eventsBefore);
  });
}

test('ZIP boundaries reject traversal, duplicate names, symlinks, bombs and CRC corruption before use', async () => {
  const make = async (name: string, data: string, options = {}) => new JSZip().file(name, data, options).generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  assert.throws(() => readSourceArchive(Buffer.alloc(WEB_IMPORT_LIMITS.archive + 1)));
  assert.throws(() => readSourceArchive(Buffer.from('not a zip')));
  for (const path of ['../escape', '/absolute', 'C:/drive', 'a\\b', 'a/../b']) assert.throws(() => readSourceArchive(traversalZip(path)), /unsafe/);
  const duplicate = await new JSZip().file('A.txt', 'a').file('a.txt', 'b').generateAsync({ type: 'nodebuffer' });
  assert.throws(() => readSourceArchive(duplicate), /duplicate/);
  const link = await make('link', '../secret', { unixPermissions: 0o120777 }); assert.throws(() => readSourceArchive(link), /links/);
  const bomb = await new JSZip().file('huge', 'x'.repeat(WEB_IMPORT_LIMITS.file + 1)).generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.throws(() => readSourceArchive(bomb), /expanded/);
  const forged = Buffer.from(bomb);
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); forged.writeUInt32LE(1, central + 24);
  assert.throws(() => readSourceArchive(forged)); // actual inflation also has a hard cap
  const corrupt = await make('small', 'data'); corrupt[35] = corrupt[35]! ^ 1; assert.throws(() => readSourceArchive(corrupt), /checksum/);
});

// Minimal single-entry stored archive constructor permits literal traversal names;
// JSZip normally normalizes them on read, which could hide a hostile input.
function traversalZip(name: string): Buffer {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length, 16);
  return Buffer.concat([local, n, central, n, end]);
}
