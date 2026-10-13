import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { kimiSmokeModel, runKimiSmoke } from './kimi-smoke.ts';

function response(text = 'OK') {
  const events = [
    { type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: 'k3', content: [], usage: { input_tokens: 8, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('installed Pi native model matches the approved route', () => {
  const model = kimiSmokeModel();
  assert.equal(model.api, 'anthropic-messages');
  assert.equal(model.baseUrl, 'https://api.kimi.com/coding');
});

test('Pi serializes one bounded synthetic request and exposes usage only', async () => {
  let calls = 0;
  const result = await runKimiSmoke('synthetic-test-key', async (input, init) => {
    calls++;
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.kimi.com/coding/v1/messages?beta=true');
    assert.equal(request.redirect, 'error');
    const body = await request.json();
    assert.equal(body.max_tokens, 256);
    assert.equal(body.model, 'k3');
    assert.equal(body.tools, undefined);
    assert.equal(body.thinking, undefined);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with exactly OK and nothing else.' }]);
    return response();
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.usage, { input: 8, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 9 });
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'), false);
});

for (const status of [302, 401, 429, 500]) {
  test(`HTTP ${status} is not retried and response details are not logged`, async () => {
    let calls = 0;
    const result = await runKimiSmoke('synthetic-test-key', async () => {
      calls++;
      return new Response('private-response-sentinel', { status, headers: { location: 'https://example.invalid' } });
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, status);
    assert.equal(JSON.stringify(result).includes('private-response-sentinel'), false);
  });
}

test('unexpected model text is rejected without echoing it', async () => {
  const result = await runKimiSmoke('synthetic-test-key', async () => response('private-response-sentinel'));
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('private-response-sentinel'), false);
});

test('missing credentials fail before transport', async () => {
  await assert.rejects(runKimiSmoke('', async () => { assert.fail('must not send'); }), /missing/);
});

test('total deadline aborts even a transport that never resolves', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const pending = runKimiSmoke('synthetic-test-key', async (_input, init) => {
    signal = init?.signal ?? undefined;
    started();
    return new Promise<Response>(() => {});
  });
  await ready;
  t.mock.timers.tick(30_000);
  const result = await pending;
  assert.equal(result.status, 'timeout');
  assert.equal(result.requests, 1);
  assert.equal(signal?.aborted, true);
});

test('offline CLI needs no credential file and legacy acceptance refuses implicit execution', () => {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]!]));
  const offline = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ts/check-kimi-smoke.ts'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).requests, 0);
  assert.equal(JSON.parse(offline.stdout).keyPresent, false);
  const legacy = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ts/check-r3-native.ts'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /separate budget authorization/);
  assert.doesNotMatch(legacy.stderr, /ENOENT/);
});
