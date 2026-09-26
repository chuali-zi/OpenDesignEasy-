import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { textFromString } from '@oeydesign/document';
import type { DeckNode } from '@oeydesign/document';
import { InMemoryCredentialStore, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createDesignServices, ProjectRuntime } from '../src/index.ts';

function within<T>(promise: Promise<T>, label: string, timeoutMs = 12_000): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function makeFixture(t: { after(callback: () => void): void }, faux = fauxProvider({
  provider: `oey-runtime-test-${Math.random().toString(36).slice(2, 8)}`,
  models: [{ id: 'test-model', contextWindow: 32_000, maxTokens: 2048 }],
})) {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'oey-r3-agent-'));
  let runtime = ProjectRuntime.create(directory, {
    name: 'R3 faux agent test',
    agentService: {
      async createModelRuntime() {
        const modelRuntime = await ModelRuntime.create({
          credentials: new InMemoryCredentialStore(), modelsPath: null,
          allowModelNetwork: false, refreshOnCreate: false,
        });
        modelRuntime.registerNativeProvider(faux.provider);
        return { modelRuntime, model: faux.getModel() };
      },
    },
  });
  const document = runtime.createDocument({ name: 'Agent fixture' });
  const title: DeckNode = {
    id: 'title', kind: 'text', parentId: document.pages[0]!.id,
    geometry: { x: 10, y: 20, width: 400, height: 60, rotation: 0 }, style: {}, locked: false, hidden: false,
    content: textFromString('Original'),
  };
  runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'node.insert', node: title }]));
  runtime.agent.configureTools(createDesignServices(runtime));
  t.after(() => {
    runtime.close();
    assert.ok(resolve(directory).startsWith(parent + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    faux,
    directory,
    documentId: document.documentId,
    get runtime() { return runtime; },
    reopen() {
      runtime.close();
      runtime = ProjectRuntime.open(directory, {
        agentService: {
          async createModelRuntime() {
            const modelRuntime = await ModelRuntime.create({
              credentials: new InMemoryCredentialStore(), modelsPath: null,
              allowModelNetwork: false, refreshOnCreate: false,
            });
            modelRuntime.registerNativeProvider(faux.provider);
            return { modelRuntime, model: faux.getModel() };
          },
        },
      });
      runtime.agent.configureTools(createDesignServices(runtime));
      return runtime;
    },
  };
}

test('Pi faux session persists input metadata, enforces inputId idempotency, and hides API keys from project config', async t => {
  const fixture = makeFixture(t);
  fixture.runtime.agent.configure({
    providerId: 'test-provider', modelId: 'test-model', baseUrl: 'https://api.example.test/v1',
    apiKey: 'memory-only-secret', api: 'openai-completions', contextWindow: 96_000, maxTokens: 4096,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false }, userAgent: 'oey-test',
  });
  fixture.runtime.agent.configure({ providerId: 'test-provider', modelId: 'test-model', baseUrl: 'https://api.example.test/v1', apiKeyEnv: 'API_KEY' });
  const savedConfig = fixture.runtime.getRecord<Record<string, unknown>>('agent-config', 'current')!;
  assert.equal('apiKey' in savedConfig, false);
  assert.equal(JSON.stringify(savedConfig).includes('memory-only-secret'), false);
  assert.equal('apiKey' in fixture.runtime.agent.getConfig(), false);
  assert.equal(savedConfig.maxTokens, 4096);
  assert.equal(savedConfig.contextWindow, 96_000);
  assert.equal(savedConfig.userAgent, 'oey-test');
  assert.deepEqual(savedConfig.compat, { supportsDeveloperRole: false, supportsReasoningEffort: false });
  fixture.faux.setResponses([fauxAssistantMessage('Done.', { stopReason: 'stop' })]);
  const session = await fixture.runtime.agent.createSession({ title: 'Metadata check' });
  const options = { inputId: 'input-idempotent-1', documentId: fixture.documentId };
  const accepted = await fixture.runtime.agent.send(session.sessionId, 'Please inspect the document.', options);
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'agent completion');
  assert.deepEqual(await fixture.runtime.agent.send(session.sessionId, 'Please inspect the document.', options), accepted);
  await assert.rejects(fixture.runtime.agent.send(session.sessionId, 'Different body.', options), { code: 'invalid' });
  const messages = await fixture.runtime.agent.getMessages(session.sessionId);
  const inputMessage = messages.find(message => message.role === 'custom' && message.customType === 'oey_input');
  assert.ok(inputMessage);
  assert.equal((inputMessage as { details?: { inputId?: string } }).details?.inputId, accepted.inputId);
  assert.equal(fixture.runtime.agent.getRun(accepted.runId)?.status, 'completed');
  assert.equal(fixture.faux.state.callCount, 1);
});

test('question ends a mixed tool batch before document write and resumes after restart without replay', async t => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall('user_ask', { prompt: 'Which direction?', options: ['A', 'B'], allowFreeText: false }, { id: 'question-call' }),
      fauxToolCall('document_apply', { documentId: fixture.documentId, baseRevision: 1, operations: [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 99 } }] }, { id: 'blocked-write-call' }),
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage('A selected option is received.', { stopReason: 'stop' }),
  ]);
  const session = await fixture.runtime.agent.createSession();
  const first = await fixture.runtime.agent.send(session.sessionId, 'Ask me about the direction.', { documentId: fixture.documentId });
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'question run');
  assert.equal(fixture.runtime.agent.getRun(first.runId)?.status, 'waiting_input');
  assert.equal(fixture.runtime.agent.listQuestions(session.sessionId).filter(question => question.status === 'pending').length, 1);
  assert.equal(fixture.runtime.readDeckDocument(fixture.documentId).nodes.title!.geometry.x, 10);
  await assert.rejects(fixture.runtime.agent.send(session.sessionId, 'Bypass the pending question.', { inputId: 'bypass-input' }), { code: 'conflict' });
  fixture.reopen();
  const pending = fixture.runtime.agent.listQuestions(session.sessionId).find(question => question.status === 'pending')!;
  assert.equal(fixture.runtime.agent.getSession(session.sessionId)?.status, 'waiting_input');
  const answer = await fixture.runtime.agent.answer(session.sessionId, pending.questionId, 'A', { inputId: 'answer-once' });
  assert.equal(fixture.runtime.agent.getSession(session.sessionId)?.lastRunId, answer.runId);
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'answer run');
  assert.equal(fixture.runtime.agent.getRun(answer.runId)?.status, 'completed');
  assert.deepEqual(await fixture.runtime.agent.answer(session.sessionId, pending.questionId, 'A', { inputId: 'answer-once' }), answer);
  assert.equal(fixture.runtime.readDeckDocument(fixture.documentId).nodes.title!.geometry.x, 10);
  assert.equal(fixture.faux.state.callCount, 2);
  assert.ok((await fixture.runtime.agent.getMessages(session.sessionId)).length >= 4);
});

test('steer and follow-up reach real Pi queues, and cancellation aborts an active tool signal', async t => {
  const firstRequest = deferred<void>();
  const releaseFirst = deferred<void>();
  const fixture = makeFixture(t);
  const contexts: string[] = [];
  fixture.faux.setResponses([
    async context => { contexts.push(JSON.stringify(context.messages)); firstRequest.resolve(); await releaseFirst.promise; return fauxAssistantMessage('initial finished', { stopReason: 'stop' }); },
    context => { contexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage('steer handled', { stopReason: 'stop' }); },
    context => { contexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage('follow-up handled', { stopReason: 'stop' }); },
  ]);
  const session = await fixture.runtime.agent.createSession();
  const primary = await fixture.runtime.agent.send(session.sessionId, 'Start work.');
  await within(firstRequest.promise, 'first faux request');
  const steered = await fixture.runtime.agent.steer(session.sessionId, 'Change course.', { inputId: 'steer-1' });
  const followed = await fixture.runtime.agent.followUp(session.sessionId, 'Then check one more thing.', { inputId: 'follow-up-1' });
  assert.equal(steered.runId, primary.runId);
  assert.equal(followed.runId, primary.runId);
  releaseFirst.resolve();
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'steer and follow-up completion');
  assert.equal(fixture.faux.state.callCount, 3);
  assert.ok(contexts[1]?.includes('Change course.'));
  assert.ok(contexts[2]?.includes('Then check one more thing.'));

  const enteredTool = deferred<AbortSignal>();
  const releaseTool = deferred<void>();
  const services = createDesignServices(fixture.runtime);
  fixture.runtime.agent.configureTools({
    ...services,
    async preview(_args, signal) {
      enteredTool.resolve(signal);
      await new Promise<void>((resolvePromise, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        releaseTool.promise.then(resolvePromise, reject);
      });
      return { revision: fixture.runtime.readDeckDocument(fixture.documentId).revision, mimeType: 'image/png', data: '' };
    },
  });
  fixture.faux.setResponses([fauxAssistantMessage(
    fauxToolCall('render_preview', { documentId: fixture.documentId }, { id: 'active-preview' }),
    { stopReason: 'toolUse' },
  )]);
  const active = await fixture.runtime.agent.send(session.sessionId, 'Preview the page.');
  const toolSignal = await within(enteredTool.promise, 'preview tool start');
  assert.equal(toolSignal.aborted, false);
  const cancelled = await within(fixture.runtime.agent.cancel(session.sessionId, active.runId), 'active tool cancellation');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(toolSignal.aborted, true);
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'cancelled run idle');
  assert.equal(fixture.runtime.agent.getRun(active.runId)?.status, 'cancelled');
});

test('SDK compaction refreshes the latest document, selection, human edits and decisions on the next turn', async t => {
  const faux = fauxProvider({
    provider: `oey-runtime-compact-${Math.random().toString(36).slice(2, 8)}`,
    models: [{ id: 'test-model', contextWindow: 256_000, maxTokens: 2048 }],
  });
  const fixture = makeFixture(t, faux);
  const session = await fixture.runtime.agent.createSession();
  const ordinaryReplies = Array.from({ length: 8 }, (_, index) => fauxAssistantMessage(`Archived reply ${index}.`, { stopReason: 'stop' }));
  faux.setResponses([
    ...ordinaryReplies,
    fauxAssistantMessage('Compacted conversation summary.', { stopReason: 'stop' }),
  ]);
  for (let index = 0; index < ordinaryReplies.length; index += 1) {
    await fixture.runtime.agent.send(session.sessionId, `Background ${index}: ${'previous project discussion and design rationale '.repeat(800)}`);
    await within(fixture.runtime.agent.waitForIdle(session.sessionId), `history turn ${index}`);
  }

  await within(fixture.runtime.agent.compact(session.sessionId), 'Pi SDK compaction');
  assert.equal(faux.state.callCount, ordinaryReplies.length + 1, 'manual compaction makes a real faux provider summary request');

  const changed = fixture.runtime.readDeckDocument(fixture.documentId);
  fixture.runtime.submit(fixture.runtime.makeCommand(fixture.documentId, [{
    type: 'geometry.update', nodeId: 'title', geometry: { x: 333 },
  }], { actorId: 'reviewer', actorKind: 'human', clientId: 'manual' }));
  const latestRevision = fixture.runtime.readDeckDocument(fixture.documentId).revision;
  fixture.runtime.agent.setSelection(session.sessionId, { documentId: fixture.documentId, nodeIds: ['title'] });
  fixture.runtime.putRecord('agent-decisions', 'decision-after-compact', {
    decisionId: 'decision-after-compact', sessionId: session.sessionId, runId: 'human-review',
    documentId: fixture.documentId, text: 'Keep the selected headline aligned to the left edge.', createdAt: new Date().toISOString(),
  });
  assert.ok(changed.revision < latestRevision);

  let refreshedSystemPrompt = '';
  faux.appendResponses([context => {
    refreshedSystemPrompt = context.systemPrompt ?? '';
    return fauxAssistantMessage('I have refreshed the current design context.', { stopReason: 'stop' });
  }]);
  await fixture.runtime.agent.send(session.sessionId, 'Continue with the current design state.');
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'post-compaction turn');
  const contextMarker = 'Current project design context (refresh from tools before editing if anything changed):\n';
  const contextStart = refreshedSystemPrompt.indexOf(contextMarker);
  assert.notEqual(contextStart, -1);
  const designContext = JSON.parse(refreshedSystemPrompt.slice(contextStart + contextMarker.length)) as {
    documents: Array<{ documentId: string; revision: number }>;
    selection: { documentId: string; nodeIds: string[] };
    recentHumanChanges: Array<{ documentId: string; revision: number; changedNodeIds: string[] }>;
    decisions: Array<{ text: string }>;
  };
  assert.equal(designContext.documents.find(document => document.documentId === fixture.documentId)?.revision, latestRevision);
  assert.equal(designContext.selection.documentId, fixture.documentId);
  assert.deepEqual(designContext.selection.nodeIds, ['title']);
  assert.ok(designContext.recentHumanChanges.some(change => change.documentId === fixture.documentId && change.changedNodeIds.includes('title')));
  assert.ok(designContext.decisions.some(decision => decision.text === 'Keep the selected headline aligned to the left edge.'));
});

test('reopening a project marks in-flight Pi input interrupted and does not replay it', async t => {
  const requestStarted = deferred<void>();
  const releaseRequest = deferred<void>();
  const faux = fauxProvider({
    provider: `oey-runtime-restart-${Math.random().toString(36).slice(2, 8)}`,
    models: [{ id: 'test-model', contextWindow: 32_000, maxTokens: 2048 }],
  });
  const fixture = makeFixture(t, faux);
  faux.setResponses([
    async () => {
      requestStarted.resolve();
      await releaseRequest.promise;
      return fauxAssistantMessage('The original process finished late.', { stopReason: 'stop' });
    },
    fauxAssistantMessage('This must not be replayed.', { stopReason: 'stop' }),
  ]);
  const session = await fixture.runtime.agent.createSession();
  const accepted = await fixture.runtime.agent.send(session.sessionId, 'Run once, then simulate a process restart.');
  await within(requestStarted.promise, 'original model request');

  fixture.reopen();
  assert.equal(fixture.runtime.agent.getRun(accepted.runId)?.status, 'interrupted');
  assert.equal(fixture.runtime.agent.listInputs(session.sessionId).find(input => input.inputId === accepted.inputId)?.status, 'interrupted');
  releaseRequest.resolve();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  assert.equal(faux.state.callCount, 1, 'recovery does not issue a second provider request for ambiguous in-flight work');
  assert.equal(fixture.runtime.agent.getRun(accepted.runId)?.status, 'interrupted');
  assert.equal(fixture.runtime.agent.listRuns(session.sessionId).length, 1);
});

test('cold history reconstruction includes custom user input and its input metadata', async t => {
  const fixture = makeFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage('I read the user input.', { stopReason: 'stop' })]);
  const session = await fixture.runtime.agent.createSession();
  const accepted = await fixture.runtime.agent.send(session.sessionId, 'Keep this message visible after restart.', { inputId: 'history-input-1' });
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'history run completion');
  assert.equal(fixture.runtime.agent.getRun(accepted.runId)?.status, 'completed');
  fixture.reopen();
  const recoveredMessages = await fixture.runtime.agent.getMessages(session.sessionId);
  const recoveredInput = recoveredMessages.find(message => message.role === 'custom' && message.customType === 'oey_input') as { details?: { inputId?: string; runId?: string } } | undefined;
  assert.equal(recoveredInput?.details?.inputId, accepted.inputId);
  assert.equal(recoveredInput?.details?.runId, accepted.runId);
  assert.ok(recoveredMessages.some(message => message.role === 'assistant'));
});

test('cancelled run drops a late attachment result and cannot commit with its former run identity', async t => {
  const requestStarted = deferred<void>();
  const releaseRequest = deferred<void>();
  const referenceStarted = deferred<void>();
  const releaseReference = deferred<void>();
  const fixture = makeFixture(t);
  fixture.faux.setResponses([async () => {
    requestStarted.resolve();
    await releaseRequest.promise;
    return fauxAssistantMessage('Cancelled before handling its queued message.', { stopReason: 'stop' });
  }]);
  const session = await fixture.runtime.agent.createSession();
  const started = await fixture.runtime.agent.send(session.sessionId, 'Start a turn that will receive a late attachment.');
  await within(requestStarted.promise, 'active model request');

  fixture.runtime.agent.configureTools({
    ...createDesignServices(fixture.runtime),
    async readReference() {
      referenceStarted.resolve();
      await releaseReference.promise;
      return { text: 'This reference resolves after cancellation.' };
    },
  });
  const queued = await fixture.runtime.agent.steer(session.sessionId, 'Use this reference.', { inputId: 'late-attachment', assetIds: ['slow-reference'] });
  await within(referenceStarted.promise, 'queued reference resolution');
  assert.equal(queued.runId, started.runId);

  const cancellation = fixture.runtime.agent.cancel(session.sessionId, started.runId);
  assert.equal(fixture.runtime.agent.getRun(started.runId)?.status, 'cancelled');
  releaseReference.resolve();
  releaseRequest.resolve();
  await within(cancellation, 'cancellation with resolving attachment');
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'cancelled model idle');
  assert.equal(fixture.runtime.agent.listInputs(session.sessionId).find(input => input.inputId === queued.inputId)?.status, 'cancelled');
  assert.equal(fixture.faux.state.callCount, 1, 'the stale steering input is not delivered as a second model turn');

  const revision = fixture.runtime.readDeckDocument(fixture.documentId).revision;
  const staleCommand = fixture.runtime.makeCommand(fixture.documentId, [{
    type: 'geometry.update', nodeId: 'title', geometry: { x: 444 },
  }], { actorId: `agent:${session.sessionId}`, actorKind: 'agent', clientId: `agent:${session.sessionId}`, runId: started.runId });
  assert.throws(() => fixture.runtime.submit(staleCommand), { code: 'cancelled' });
  assert.equal(fixture.runtime.readDeckDocument(fixture.documentId).revision, revision);
});

test('a tool that ignores abort cannot let its tool batch write after cancellation', async t => {
  const toolStarted = deferred<void>();
  const releaseTool = deferred<void>();
  const fixture = makeFixture(t);
  fixture.runtime.agent.configureTools({
    ...createDesignServices(fixture.runtime),
    async generateAsset() {
      toolStarted.resolve();
      await releaseTool.promise;
      return { id: 'late-generated-asset' };
    },
  });
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('asset_generate', { prompt: 'Wait for a synthetic image.' }, { id: 'slow-generate' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('document_apply', {
      documentId: fixture.documentId, baseRevision: 1,
      operations: [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 555 } }],
    }, { id: 'must-be-blocked' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Finished.', { stopReason: 'stop' }),
  ]);
  const session = await fixture.runtime.agent.createSession();
  const active = await fixture.runtime.agent.send(session.sessionId, 'Generate an image, then change the title geometry.');
  await within(toolStarted.promise, 'long-running asset tool');

  const cancellation = fixture.runtime.agent.cancel(session.sessionId, active.runId);
  assert.equal(fixture.runtime.agent.getRun(active.runId)?.status, 'cancelled');
  releaseTool.resolve();
  await within(cancellation, 'cancel active tool batch');
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'cancelled tool batch idle');
  assert.equal(fixture.runtime.readDeckDocument(fixture.documentId).revision, 1);
  assert.equal(fixture.runtime.readDeckDocument(fixture.documentId).nodes.title!.geometry.x, 10);
  assert.equal(fixture.faux.state.callCount, 1, 'the model does not continue to the queued write after the delayed tool returns');
});

test('Pi tools expose Web operations and preserve human text while editing and exporting the same document', async t => {
  const fixture = makeFixture(t);
  const web = fixture.runtime.createDocument({ kind: 'web', name: 'Shared website' });
  const documentId = web.documentId;
  fixture.runtime.submit(fixture.runtime.makeCommand(documentId, [{ type: 'web.node.insert', node: {
    id: 'headline', parentId: web.pages[0]!.rootId, tag: 'h1', text: 'Original', children: [], style: {}, layout: { mode: 'flow' },
  } }]));
  fixture.runtime.submit(fixture.runtime.makeCommand(documentId, [{ type: 'web.node.update', nodeId: 'headline', text: '人工确定的标题' }]));
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('document_schema', { documentId }, { id: 'web-schema' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('document_apply', { documentId, baseRevision: 1,
      operations: [{ type: 'web.style.update', nodeId: 'headline', style: { color: '#234D39' } }],
    }, { id: 'web-style' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('artifact_export', { documentId, format: 'html' }, { id: 'web-export' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Done.', { stopReason: 'stop' }),
  ]);
  const session = await fixture.runtime.agent.createSession();
  const accepted = await fixture.runtime.agent.send(session.sessionId, '继续完善网站，保留我的标题并导出。', { documentId });
  await within(fixture.runtime.agent.waitForIdle(session.sessionId), 'Web design run');
  assert.equal(fixture.runtime.agent.getRun(accepted.runId)?.status, 'completed');
  const latest = fixture.runtime.readWebDocument(documentId);
  assert.equal(latest.nodes.headline!.text, '人工确定的标题');
  assert.equal(latest.nodes.headline!.style.color, '#234D39');
  const exported = fixture.runtime.listRecords<{ documentId: string; revision: number; format: string }>('exports');
  assert.equal(exported.length, 1);
  assert.deepEqual({ documentId: exported[0]!.value.documentId, revision: exported[0]!.value.revision, format: exported[0]!.value.format }, { documentId, revision: latest.revision, format: 'html' });
  assert.match(JSON.stringify(await fixture.runtime.agent.getMessages(session.sessionId)), /web\.layout\.update/);
});
