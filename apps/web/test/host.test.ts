import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectRuntime } from '@oeydesign/runtime';
import { createWebHost } from '../src/server/host.ts';

test('Web commits share CLI state, revisions, conflicts and undo after reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'oey-web-'));
  let runtime = ProjectRuntime.create(directory);
  const document = runtime.createDocument({ name: 'Shared deck' });
  const app = await createWebHost(runtime);
  try {
    const insert = runtime.makeCommand(document.documentId, [{ type: 'node.insert', node: {
      id: 'shape', kind: 'shape', parentId: document.pages[0]!.id,
      geometry: { x: 10, y: 20, width: 200, height: 100, rotation: 0 }, style: {}, locked: false, hidden: false,
    } }]);
    const first = await app.inject({ method: 'POST', url: '/api/commands', payload: insert });
    assert.equal(first.statusCode, 200, first.body);
    const move = runtime.makeCommand(document.documentId, [{ type: 'geometry.update', nodeId: 'shape', geometry: { x: 250 } }]);
    const edited = await app.inject({ method: 'POST', url: '/api/commands', payload: move });
    assert.equal(edited.statusCode, 200);
    const retry = await app.inject({ method: 'POST', url: '/api/commands', payload: move });
    assert.deepEqual(retry.json().result, edited.json().result);
    const conflict = await app.inject({ method: 'POST', url: '/api/commands', payload: { ...move, commandId: 'stale-move', operations: [{ type: 'geometry.update', nodeId: 'shape', geometry: { x: 500 } }] } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(runtime.readDocument(document.documentId).nodes.shape!.geometry.x, 250);
    const undo = await app.inject({ method: 'POST', url: `/api/documents/${document.documentId}/undo`, payload: { baseRevision: 2 } });
    assert.equal(undo.statusCode, 200);
    assert.equal(undo.json().document.nodes.shape.geometry.x, 10);
    await app.close();
    runtime.close();
    runtime = ProjectRuntime.open(directory);
    assert.equal(runtime.readDocument(document.documentId).revision, 3);
    assert.equal(runtime.readDocument(document.documentId).nodes.shape!.geometry.x, 10);
  } finally {
    await app.close(); runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('host binds actor identity and rejects unrelated origins and impersonated runs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'oey-web-'));
  const runtime = ProjectRuntime.create(directory);
  const app = await createWebHost(runtime);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/documents', payload: { name: 'Deck', commandId: 'create-deck' } });
    const document = response.json().document;
    const denied = await app.inject({ method: 'POST', url: '/api/documents', headers: { origin: 'https://unrelated.example' }, payload: { name: 'Blocked' } });
    assert.equal(denied.statusCode, 403);
    const forged = runtime.makeCommand(document.documentId, [{ type: 'page.insert', page: { id: 'second', name: 'Second', width: 1280, height: 720, children: [] } }], { actorKind: 'agent', actorId: 'forged' });
    assert.equal((await app.inject({ method: 'POST', url: '/api/commands', payload: { ...forged, runId: 'forged-run' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/commands', payload: forged })).statusCode, 200);
    assert.equal(runtime.events().at(-1)!.payload.actorKind, 'human');
    assert.equal(runtime.events().at(-1)!.payload.actorId, 'local-user');
  } finally {
    await app.close(); runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SSE replays persisted events after a cursor and broadcasts new commits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'oey-web-events-'));
  const runtime = ProjectRuntime.create(directory);
  const document = runtime.createDocument();
  const app = await createWebHost(runtime);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/api/events?after=1`, { signal: controller.signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('id: 2\n')) received += decoder.decode((await reader.read()).value);
    assert.doesNotMatch(received, /id: 1\n/);
    runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'page.insert', page: { id: 'more', name: 'More', width: 1280, height: 720, children: [] } }]));
    while (!received.includes('id: 3\n')) received += decoder.decode((await reader.read()).value);
    assert.match(received, /"revision":1/);
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    clearTimeout(timeout); controller.abort(); await app.close(); runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
