import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

test('CLI creates, edits, reopens and exports a Web document without a Web host', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oey-web-cli-'));
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'apps/cli/src/index.ts', ...args], { cwd: resolve('.'), encoding: 'utf8', windowsHide: true }));
  try {
    const { project } = run('project', 'create', directory);
    const { document } = run('document', 'create', directory, '--kind', 'web', '--name', 'Website');
    const file = join(directory, 'command.json');
    await writeFile(file, JSON.stringify({ commandId: 'insert', projectId: project.projectId, documentId: document.documentId, actorId: 'cli', actorKind: 'human', clientId: 'cli', baseRevision: 0, preconditions: [], label: 'Add heading', operations: [{ type: 'web.node.insert', node: { id: 'heading', parentId: document.pages[0].rootId, tag: 'h1', text: 'Hello', children: [], style: {}, layout: { mode: 'flow' } } }] }));
    run('document', 'apply', directory, file);
    run('node', 'text', directory, document.documentId, 'heading', '--text', '中文与 Web');
    assert.equal(run('document', 'read', directory, document.documentId).document.nodes.heading.text, '中文与 Web');
    run('undo', directory, document.documentId);
    assert.equal(run('document', 'read', directory, document.documentId).document.nodes.heading.text, 'Hello');
    run('redo', directory, document.documentId);
    const html = join(directory, 'site.html');
    assert.equal(run('document', 'render', directory, document.documentId, '--output', html).format, 'html');
    assert.match(await readFile(html, 'utf8'), /中文与 Web/);
    const archive = join(directory, 'site.source.zip');
    const exported = run('document', 'export', directory, document.documentId, '--output', archive);
    assert.equal(exported.format, 'source.zip');
    assert.ok((await JSZip.loadAsync(await readFile(archive))).file('src/App.tsx'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
