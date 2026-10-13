import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ProjectRuntime, createDesignServices } from '../src/index.ts';
import type { AgentRunLimits } from '../src/index.ts';

async function fixture(t: { after(fn: () => void): void }, overrides: Partial<AgentRunLimits> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oey-budget-'));
  const faux = fauxProvider({ provider: 'budget-faux', models: [{ id: 'budget-model' }] });
  const runtime = ProjectRuntime.create(root, { name: 'Synthetic bounded agent', agentService: {
    runLimits: { maxRequests: 2, maxInputTokens: 100_000, maxOutputTokens: 1024, maxOutputTokensPerRequest: 512,
      maxToolCalls: 2, timeoutMs: 3000, allowedTools: ['document_read', 'design_decide'], ...overrides },
    async createModelRuntime() {
      const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      modelRuntime.registerNativeProvider(faux.provider);
      return { modelRuntime, model: faux.getModel() };
    },
  } });
  runtime.agent.configureTools(createDesignServices(runtime));
  const doc = runtime.createDocument({ name: 'Synthetic fixture' });
  const session = await runtime.agent.createSession();
  t.after(() => { runtime.close(); rmSync(root, { recursive: true, force: true }); });
  const run = async () => {
    const accepted = await runtime.agent.send(session.sessionId, 'Read the synthetic document.', { documentId: doc.documentId });
    await runtime.agent.waitForIdle(session.sessionId);
    return runtime.agent.getRun(accepted.runId)!;
  };
  return { root, runtime, faux, doc, session, run };
}

test('a real Pi tool turn shares the run budget with the final model turn', async t => {
  const f = await fixture(t, { maxInputTokens: 32_000 });
  f.faux.setResponses([
    (_context, options) => {
      assert.equal(options?.maxTokens, 512); assert.equal(options?.maxRetries, 0);
      return fauxAssistantMessage(fauxToolCall('document_read', { documentId: f.doc.documentId }));
    }, fauxAssistantMessage('Done'),
  ]);
  const run = await f.run();
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.budgetUsage?.requests, 2);
  assert.equal(run.budgetUsage?.toolCalls, 1);
  assert.equal(run.budgetUsage?.reservedOutputTokens, 1024);
  assert.equal(f.runtime.readDocument(f.doc.documentId).revision, 0);
});

for (const [name, limits, reason, calls] of [
  ['request count', { maxRequests: 1 }, 'requests', 1],
  ['cumulative output reservation', { maxOutputTokens: 512 }, 'output_tokens', 1],
  ['input reservation before transport', { maxInputTokens: 1 }, 'input_tokens', 0],
] as const) test(`${name} stops the whole agent loop`, async t => {
  const f = await fixture(t, limits);
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('document_read', { documentId: f.doc.documentId })), fauxAssistantMessage('must not happen')]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(run.budgetUsage?.failure, reason);
  assert.equal(f.faux.state.callCount, calls);
  assert.ok(f.runtime.agent.listInputs(f.session.sessionId).every(input => input.status === 'interrupted'));
});

test('tool budget blocks the second tool in one batch before its side effect', async t => {
  const f = await fixture(t, { maxToolCalls: 1 });
  f.faux.setResponses([fauxAssistantMessage([
    fauxToolCall('design_decide', { text: 'first' }), fauxToolCall('design_decide', { text: 'forbidden second' }),
  ])]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(run.budgetUsage?.failure, 'tool_calls');
  assert.equal(f.runtime.listRecords('agent-decisions').length, 1);
  assert.equal(f.faux.state.callCount, 1);
});

test('provider error does not trigger Pi session retries', async t => {
  const f = await fixture(t);
  f.faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: '429 rate limit' }), fauxAssistantMessage('retry forbidden')]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(f.faux.state.callCount, 1);
});

for (const scenario of ['retry', 'redirect target', 'wrong output cap'] as const) test(`HTTP boundary rejects ${scenario} without an extra transport`, async t => {
  const endpoint = 'https://api.kimi.com/coding/v1/messages';
  const f = await fixture(t, { endpoint });
  let transports = 0;
  t.mock.method(globalThis, 'fetch', async (_request: Request, options: RequestInit) => {
    transports++; assert.equal(options.redirect, 'error');
    assert.ok(options.signal); return new Response('{}');
  });
  f.faux.setResponses([async (_context, options) => {
    const request = { method: 'POST', body: JSON.stringify({ model: 'budget-model', max_tokens: scenario === 'wrong output cap' ? 999 : 512 }) };
    const target = scenario === 'redirect target' ? 'https://example.invalid/v1/messages' : endpoint;
    await options!.fetch!(target, request);
    await options!.fetch!(target, request);
    return fauxAssistantMessage('must not complete');
  }]);
  const run = await f.run();
  assert.equal(run.status, 'failed');
  assert.equal(run.budgetUsage?.failure, scenario === 'wrong output cap' ? 'http_budget' : 'http_target_or_retry');
  assert.equal(transports, scenario === 'retry' ? 1 : 0);
  assert.equal(f.faux.state.callCount, 1);
});

test('reported output exceeding the reservation fails before any tool side effect', async t => {
  const f = await fixture(t, { maxOutputTokensPerRequest: 1 });
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('design_decide', { text: 'should never commit' }))]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(run.budgetUsage?.failure, 'reported_tokens');
  assert.equal(f.runtime.listRecords('agent-decisions').length, 0);
});

test('deadline covers a hung tool and stops the next write in the same batch', async t => {
  const f = await fixture(t, { timeoutMs: 500, allowedTools: ['reference_read', 'design_decide'] });
  let release!: () => void;
  f.runtime.agent.configureTools({ ...createDesignServices(f.runtime), async readReference() {
    await new Promise<void>(resolve => { release = resolve; }); return { text: 'late tool result' };
  } });
  f.faux.setResponses([fauxAssistantMessage([
    fauxToolCall('reference_read', { assetId: 'synthetic' }), fauxToolCall('design_decide', { text: 'late write' }),
  ])]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(run.budgetUsage?.failure, 'deadline');
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.runtime.listRecords('agent-decisions').length, 0);
  assert.equal(f.faux.state.callCount, 1);
});

test('deadline resolves waitForIdle when a provider ignores abort, and late tools cannot write', async t => {
  const f = await fixture(t, { timeoutMs: 500 });
  let release!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
  f.faux.setResponses([() => new Promise(resolve => { release = resolve; })]);
  const run = await f.run();
  assert.equal(run.status, 'failed'); assert.equal(run.budgetUsage?.failure, 'deadline');
  release(fauxAssistantMessage(fauxToolCall('design_decide', { text: 'too late' })));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.runtime.listRecords('agent-decisions').length, 0);
  assert.equal(f.faux.state.callCount, 1);
  f.runtime.close();
  const reopened = ProjectRuntime.open(f.root);
  try { assert.equal(reopened.agent.getRun(run.runId)?.status, 'failed'); }
  finally { reopened.close(); }
});
