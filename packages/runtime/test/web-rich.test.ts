import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTextReplaceStep, textFromString } from '@oeydesign/document';
import { renderWebHtml, exportWebSourceZip, buildWebSource } from '@oeydesign/media';
import { ProjectRuntime } from '../src/index.ts';

test('Web rich text shares commands/history, preserves marks through source roundtrip and rejects stale replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-web-rich-')); let runtime = ProjectRuntime.create(root);
  try {
    const doc = runtime.createDocument({ kind: 'web', name: 'Rich website' });
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.insert', node: { id: 'text', parentId: doc.pages[0]!.rootId, tag: 'p', text: 'Hello', children: [], style: {}, layout: { mode: 'flow' } } }]));
    const base = runtime.readWebDocument(doc.documentId);
    const command = runtime.makeCommand(doc.documentId, [{ type: 'text.apply', nodeId: 'text', steps: [createTextReplaceStep(1, 1, '中文'), { stepType: 'addMark', from: 1, to: 3, mark: { type: 'strong' } }] }]);
    const first = runtime.submit(command); assert.deepEqual(runtime.submit(command), first);
    let rich = runtime.readWebDocument(doc.documentId);
    assert.equal(rich.nodes.text!.text, '中文Hello'); assert.equal(rich.nodes.text!.content!.content![0]!.content![0]!.marks![0]!.type, 'strong');
    assert.match(await renderWebHtml(rich), /<strong>中文<\/strong>/);
    assert.match((await buildWebSource(rich))['src/App.tsx'] as string, /data-oey-rich-content/);
    runtime.undo(doc.documentId); assert.deepEqual(runtime.readWebDocument(doc.documentId).nodes.text, base.nodes.text);
    runtime.redo(doc.documentId);
    runtime.close(); runtime = ProjectRuntime.open(root); rich = runtime.readWebDocument(doc.documentId);
    assert.equal(rich.nodes.text!.content!.content![0]!.content![0]!.marks![0]!.type, 'strong');
    const imported = await runtime.importWebSource(await exportWebSourceZip(rich));
    assert.deepEqual(imported.document.nodes.text!.content, rich.nodes.text!.content);
    const stale = runtime.makeCommand(doc.documentId, [{ type: 'text.apply', nodeId: 'text', steps: [createTextReplaceStep(1, 1, 'Old ')] }]);
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.update', nodeId: 'text', text: 'New human text' }]));
    assert.throws(() => runtime.submit(stale), /rich text changed/);
    assert.equal(runtime.readWebDocument(doc.documentId).nodes.text!.text, 'New human text');
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('Web rich content uses escaped markup, safe links and plain projection; unrelated style edits still merge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-web-rich-safe-')); const runtime = ProjectRuntime.create(root);
  try {
    const doc = runtime.createDocument({ kind: 'web' });
    const content = textFromString('<script>synthetic</script>');
    content.content![0]!.content![0]!.marks = [{ type: 'link', attrs: { href: 'javascript:synthetic()' } }];
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.insert', node: { id: 'rich', parentId: doc.pages[0]!.rootId, tag: 'p', children: [], content, style: {}, layout: { mode: 'flow' } } }]));
    const html = await renderWebHtml(runtime.readWebDocument(doc.documentId));
    assert.doesNotMatch(html, /<script>|javascript:/); assert.match(html, /&lt;script&gt;/); assert.match(html, /href="#"/);
    const edit = runtime.makeCommand(doc.documentId, [{ type: 'text.apply', nodeId: 'rich', steps: [createTextReplaceStep(1, 1, 'Human ')] }]);
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.style.update', nodeId: 'rich', style: { color: '#224433' } }]));
    runtime.submit(edit); assert.equal(runtime.readWebDocument(doc.documentId).nodes.rich!.style.color, '#224433');
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.update', nodeId: 'rich', flags: { locked: true } }]));
    assert.throws(() => runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'text.apply', nodeId: 'rich', steps: [createTextReplaceStep(1, 1, 'Forbidden ')] }])), /locked/);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('native interactive wrappers avoid nested links and invalid rich targets do not commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oey-web-rich-wrapper-')); const runtime = ProjectRuntime.create(root);
  try {
    const doc = runtime.createDocument({ kind: 'web' }); const content = textFromString('Linked label');
    content.content![0]!.content![0]!.marks = [{ type: 'link', attrs: { href: 'https://example.invalid' } }];
    runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.insert', node: { id: 'link', parentId: doc.pages[0]!.rootId, tag: 'a', props: { href: '#' }, content, children: [], style: {}, layout: { mode: 'flow' } } }]));
    const html = await renderWebHtml(runtime.readWebDocument(doc.documentId));
    assert.equal((html.match(/<a /g) ?? []).length, 1); assert.match(html, /text-decoration:underline/);
    const before = runtime.readWebDocument(doc.documentId);
    assert.throws(() => runtime.submit(runtime.makeCommand(doc.documentId, [{ type: 'web.node.insert', node: { id: 'invalid', parentId: doc.pages[0]!.rootId, tag: 'select', content, children: [], style: {}, layout: { mode: 'flow' } } }])), /supported text container/);
    assert.deepEqual(runtime.readWebDocument(doc.documentId), before);
  } finally { runtime.close(); await rm(root, { recursive: true, force: true }); }
});
