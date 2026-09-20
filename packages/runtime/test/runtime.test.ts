import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { textFromString, textToString } from '@oeydesign/document';
import type { DeckNode } from '@oeydesign/document';
import { ProjectRuntime } from '../src/index.ts';

const fixturePath = fileURLToPath(new URL('./fixtures/owner-process.ts', import.meta.url));

function temporaryProject(t: { after(fn: () => void): void }) {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'oey-r1-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(parent + sep) && target !== parent);
    rmSync(target, { recursive: true, force: true });
  });
  return directory;
}

function withTitle(directory: string) {
  const runtime = ProjectRuntime.create(directory, { name: 'R1 项目' });
  const document = runtime.createDocument({ name: '演示' });
  const title: DeckNode = { id: 'title', kind: 'text', parentId: document.pages[0]!.id,
    geometry: { x: 10, y: 20, width: 400, height: 60, rotation: 0 },
    style: { fill: '#111827' }, hidden: false, locked: false, content: textFromString('原始标题') };
  runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'node.insert', node: title }]));
  return { runtime, documentId: document.documentId };
}

test('unified human/agent history, retries, branches and versions survive reopen', t => {
  const directory = temporaryProject(t);
  let { runtime, documentId } = withTitle(directory);
  try {
    const move = runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 80 } }]);
    const moved = runtime.submit(move);
    assert.deepEqual(runtime.submit(move), moved);
    assert.throws(() => runtime.submit({ ...move, label: 'different request' }), { code: 'invalid' });
    const version = runtime.createVersion(documentId, '手工布局');
    runtime.submit(runtime.makeCommand(documentId, [{ type: 'style.update', nodeId: 'title', style: { fill: '#ff0000' } }], { actorKind: 'agent', actorId: 'design-agent' }));
    const undoId = 'undo-agent';
    const undone = runtime.undo(documentId, { commandId: undoId });
    assert.equal(runtime.readDocument(documentId).nodes.title!.style.fill, '#111827');
    assert.deepEqual(runtime.undo(documentId, { commandId: undoId }), undone);
    runtime.close();
    runtime = ProjectRuntime.open(directory);
    runtime.redo(documentId);
    assert.equal(runtime.readDocument(documentId).nodes.title!.style.fill, '#ff0000');
    runtime.restoreVersion(version.versionId);
    assert.equal(runtime.readDocument(documentId).nodes.title!.geometry.x, 80);
    assert.equal(runtime.readDocument(documentId).nodes.title!.style.fill, '#111827');
    runtime.undo(documentId);
    assert.equal(runtime.readDocument(documentId).nodes.title!.style.fill, '#ff0000');
    runtime.submit(runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { y: 45 } }]));
    assert.throws(() => runtime.redo(documentId), { code: 'invalid' });
    assert.equal(runtime.listVersions(documentId)[0]!.revision, moved.revision);
    assert.equal(textToString(runtime.readDocument(documentId).nodes.title!.content!), '原始标题');
    const events = runtime.events();
    assert.deepEqual(events.map(event => event.seq), events.map((_event, index) => index + 1));
    assert.ok(events.some(event => event.payload.actorKind === 'agent'));
    assert.deepEqual(runtime.events(moved.seq), events.filter(event => event.seq > moved.seq));
  } finally { runtime.close(); }
});

test('stale independent edits merge, conflicting and partial batches leave no state or events', t => {
  const { runtime, documentId } = withTitle(temporaryProject(t));
  try {
    const baseRevision = runtime.readDocument(documentId).revision;
    const staleColor = runtime.makeCommand(documentId, [{ type: 'style.update', nodeId: 'title', style: { fill: '#123456' } }]);
    const staleMove = runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 90 } }]);
    runtime.submit(runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 40 } }]));
    runtime.submit(staleColor);
    assert.throws(() => runtime.submit(staleMove), { code: 'conflict' });
    assert.equal(runtime.readDocument(documentId).nodes.title!.geometry.x, 40);
    assert.equal(runtime.readDocument(documentId).nodes.title!.style.fill, '#123456');
    assert.equal(runtime.readDocument(documentId, baseRevision).nodes.title!.geometry.x, 10);
    const before = runtime.readDocument(documentId);
    const events = runtime.events();
    assert.throws(() => runtime.submit(runtime.makeCommand(documentId, [
      { type: 'geometry.update', nodeId: 'title', geometry: { x: 100 } },
      { type: 'node.remove', nodeId: 'missing' },
    ])));
    assert.deepEqual(runtime.readDocument(documentId), before);
    assert.deepEqual(runtime.events(), events);
    runtime.subscribe(() => { throw new Error('Disconnected client'); });
    const result = runtime.submit(runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 60 } }]));
    assert.equal(runtime.events(result.seq - 1)[0]!.revision, result.revision);
  } finally { runtime.close(); }
});

test('OS owner lock rejects another process and recovers committed state after forced exit', async t => {
  const directory = temporaryProject(t);
  const { runtime, documentId } = withTitle(directory);
  runtime.close();
  const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', fixturePath, directory, 'hold', documentId], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data); });
  try {
    await new Promise<void>((accept, reject) => {
      child.stdout.once('data', data => String(data).includes('ready') ? accept() : reject(new Error(String(data))));
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Owner exited early ${code}: ${stderr}`)));
    });
    assert.throws(() => ProjectRuntime.open(directory), { code: 'busy' });
    const other = spawnSync(process.execPath, ['--import', 'tsx', fixturePath, directory, 'probe', documentId], { encoding: 'utf8', windowsHide: true });
    assert.equal(other.status, 1, other.stderr);
    assert.equal(JSON.parse(other.stdout).code, 'busy');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  const reopened = ProjectRuntime.open(directory);
  try {
    assert.equal(reopened.readDocument(documentId).nodes.title!.geometry.x, 55);
    reopened.undo(documentId);
    assert.equal(reopened.readDocument(documentId).nodes.title!.geometry.x, 10);
  } finally { reopened.close(); }
});

test('process exit during SQLite transaction rolls back partial snapshot writes', t => {
  const directory = temporaryProject(t);
  const { runtime, documentId } = withTitle(directory);
  const before = runtime.readDocument(documentId);
  const events = runtime.events();
  runtime.close();
  const child = spawnSync(process.execPath, ['--import', 'tsx', fixturePath, directory, 'uncommitted', documentId], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 23, child.stderr + child.stdout);
  const reopened = ProjectRuntime.open(directory);
  try {
    assert.deepEqual(reopened.readDocument(documentId), before);
    assert.deepEqual(reopened.events(), events);
  } finally { reopened.close(); }
});
