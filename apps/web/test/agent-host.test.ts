import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ProjectRuntime, createDesignServices } from '@oeydesign/runtime';
import { createWebHost } from '../src/server/host.ts';

test('CLI agent through the Web owner shares durable input, document changes and human undo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oey-agent-host-'));
  const faux = fauxProvider({ provider: 'oey-host-test', models: [{ id: 'test', contextWindow: 32000, maxTokens: 2048 }] });
  const runtime = ProjectRuntime.create(directory, { agentService: { async createModelRuntime() {
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    return { modelRuntime, model: faux.getModel() };
  } } });
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = runtime.createDocument();
  const app = await createWebHost(runtime);
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('document_apply', { documentId: document.documentId, baseRevision: 0, label: 'Add shared object', operations: [{ type: 'node.insert', node: {
        id: 'shared-shape', kind: 'shape', parentId: document.pages[0]!.id,
        geometry: { x: 40, y: 60, width: 160, height: 90, rotation: 0 }, style: {}, locked: false, hidden: false,
      } }] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Shared object created.', { stopReason: 'stop' }),
    ]);
    const child = await promisify(execFile)(process.execPath, ['--no-warnings', '--import', 'tsx', resolve('apps/cli/src/index.ts'), 'agent', 'run', '--host', address, '--document', document.documentId, '--input', 'cli-shared-input', '--text', 'Create a shape.'], { windowsHide: true, timeout: 30000 });
    const result = JSON.parse(child.stdout);
    assert.equal(result.session.status, 'idle');
    assert.equal(result.inputs[0].inputId, 'cli-shared-input');
    assert.equal(result.runs[0].status, 'completed');
    assert.equal(runtime.readDocument(document.documentId).nodes['shared-shape']?.geometry.x, 40);
    const snapshot = (await app.inject({ url: `/api/agent/sessions/${result.session.sessionId}` })).json();
    assert.equal(snapshot.messages.at(-1).content[0].text, 'Shared object created.');
    const undo = await app.inject({ method: 'POST', url: `/api/documents/${document.documentId}/undo`, payload: { baseRevision: 1 } });
    assert.equal(undo.statusCode, 200, undo.body);
    assert.equal(runtime.readDocument(document.documentId).nodes['shared-shape'], undefined);
    assert.ok(runtime.events().some(event => event.payload.actorKind === 'agent'));
  } finally {
    await app.close(); runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())));
    await rm(directory, { recursive: true, force: true });
  }
});
