import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { exportWebSourceZip, renderWebHtml } from '@oeydesign/media';
import { ProjectRuntime } from '../src/index.ts';

test('static React literals import without execution, preserve text order/source, retry and survive edits/source roundtrip', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-static-react-')); const runtime = ProjectRuntime.create(root);
  try {
    const source = `import React from 'react'; const title = 'World'; const theme = {color:'#234d39', fontSize:32}; export default function Page(){return <main><h1 style={theme}>Hello <strong>{title}</strong> &amp; friends</h1><form><label htmlFor="name">Name</label><input id="name" placeholder="Your name"/><button>Submit</button></form></main>}`;
    const imported = await runtime.importWebStructure(source, 'tsx', 'demo.tsx', { commandId: 'static-import' });
    const html = await renderWebHtml(imported.document); assert.match(html, /Hello /); assert.match(html, /World/); assert.match(html, /&amp; friends/);
    const count = runtime.listDocuments().length, titleNode = Object.values(imported.document.nodes).find(node => node.tag === 'h1')!;
    assert.ok(titleNode); runtime.submit(runtime.makeCommand(imported.document.documentId, [{ type: 'web.node.update', nodeId: titleNode.id, text: 'Human ' }]));
    const repeat = await runtime.importWebStructure(source, 'tsx', 'demo.tsx', { commandId: 'static-import' });
    assert.equal(runtime.listDocuments().length, count); assert.equal(repeat.document.nodes[titleNode.id]!.text, 'Human ');
    await assert.rejects(runtime.importWebStructure(source + ' ', 'tsx', 'demo.tsx', { commandId: 'static-import' }), /command|reuse|different/i);
    runtime.undo(imported.document.documentId); assert.equal(runtime.readWebDocument(imported.document.documentId).nodes[titleNode.id]!.text, 'Hello World & friends'); runtime.redo(imported.document.documentId);
    const bytes = await exportWebSourceZip(runtime.readWebDocument(imported.document.documentId)); const zip = await JSZip.loadAsync(bytes);
    assert.equal(await zip.file('original/source.tsx')!.async('string'), source);
    const roundtrip = await runtime.importWebSource(bytes); assert.equal(roundtrip.document.originalSource!.source, source); assert.equal(roundtrip.document.nodes[titleNode.id]!.text, 'Human ');
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('HTML uses inert parsing and inline CSS; executable/damaged/resource inputs reject without changing existing documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-static-html-')); const runtime = ProjectRuntime.create(root);
  try {
    const original = runtime.createDocument({ kind: 'web' }), snapshot = runtime.readWebDocument(original.documentId);
    const source = '<!doctype html><title>Synthetic</title><body><section style="display:flex;gap:16px"><h1>Hello <b>中文</b> &amp; more</h1><a href="/about">About</a></section></body>';
    const [first, repeat] = await Promise.all([runtime.importWebStructure(source, 'html', 'demo.html', { commandId: 'html-import' }), runtime.importWebStructure(source, 'html', 'demo.html', { commandId: 'html-import' })]);
    assert.equal(first.document.documentId, repeat.document.documentId); assert.equal(runtime.listDocuments().length, 2);
    assert.deepEqual(runtime.readWebDocument(original.documentId), snapshot);
    assert.equal(Object.values(first.document.nodes).find(node => node.tag === 'section')!.layout.mode, 'flex');
    for (const bad of ['<script>throw new Error("executed")</script>', '<img src="https://example.invalid/no-fetch.png">', '<style>h1{color:red}</style>', '<p onclick="alert(1)">Click</p>', '<p style="background:url(https://example.invalid)">Hi</p>']) {
      await assert.rejects(runtime.importWebStructure(bad, 'html', 'bad.html')); assert.equal(runtime.listDocuments().length, 2);
    }
    for (const bad of ['export default () => <div', 'export default function X(){fetch("https://example.invalid"); return <div/>}', 'export default () => <div {...unknown}/>', 'export default () => <div style={{color:()=>42}}/>']) await assert.rejects(runtime.importWebStructure(bad, 'tsx', 'bad.tsx'));
    assert.equal(runtime.listDocuments().length, 2); assert.deepEqual(runtime.readWebDocument(original.documentId), snapshot);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});
