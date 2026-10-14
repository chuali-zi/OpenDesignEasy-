import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { ChatGPTAuth } from '../src/chatgpt-auth.ts';
import { ChatGPTStore, CHATGPT_PLAN_SCOPE } from '../src/chatgpt-store.ts';
import type { ChatGPTCredential } from '../src/chatgpt-store.ts';
import { chatGPTPayload, createChatGPTModelRuntime, listChatGPTModels } from '../src/chatgpt-provider.ts';
import type { ChatGPTAuthOptions } from '../src/chatgpt-auth.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }, options: ChatGPTAuthOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'oey-chatgpt-'));
  const store = new ChatGPTStore(directory);
  const auth = new ChatGPTAuth(store, options);
  t.after(async () => { auth.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  return { auth, store, directory };
}
async function settled(auth: ChatGPTAuth) {
  const deadline = Date.now() + 5000;
  while (auth.loginState().status === 'pending' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.notEqual(auth.loginState().status, 'pending');
  return auth.loginState();
}
async function callback(authorizationUrl: string, clientId = 'oaiapp_test') {
  const authorization = new URL(authorizationUrl);
  const url = new URL(authorization.searchParams.get('redirect_uri')!);
  url.search = new URLSearchParams({ code: 'test-code', state: authorization.searchParams.get('state')!, client_id: clientId }).toString();
  await fetch(url);
}
async function savedAccount(store: ChatGPTStore, id = 'profile-a', expires = Date.now() + 3600_000) {
  await store.transaction(accounts => accounts.profiles.push({ id, issuer: 'https://auth.openai.com', subject: 'subject-a', label: id, clientId: 'oaiapp_test',
    credentials: { type: 'oauth', clientId: 'oaiapp_test', idToken: 'id-old', subject: 'subject-a', access: 'test-access', refresh: 'test-refresh', expires, scopes: [CHATGPT_PLAN_SCOPE] } }));
}

test('browser OAuth verifies identity, persists the issued client, and reuses the host on reauthorization', async t => {
  const keys = await generateKeyPair('RS256');
  let nonce = '', exchangeCount = 0;
  const { auth, store, directory } = await fixture(t, {
    fetch: async (_url, options) => {
      exchangeCount++;
      const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get('client_id'), 'oaiapp_test');
      assert.equal(body.get('resource'), 'https://api.openai.com/v1');
      assert.ok(body.get('code_verifier'));
      const idToken = await new SignJWT({ nonce, email: 'user@example.test' }).setProtectedHeader({ alg: 'RS256' }).setSubject('subject-a').setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setExpirationTime('1h').sign(keys.privateKey);
      return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', id_token: idToken, expires_in: 3600, scope: CHATGPT_PLAN_SCOPE });
    },
    verifyIdentity: async (token, clientId, expectedNonce) => {
      const { payload } = await jwtVerify(token, keys.publicKey, { issuer: 'https://auth.openai.com', audience: clientId });
      assert.equal(payload.nonce, expectedNonce);
      return { sub: payload.sub!, email: String(payload.email) };
    },
  });
  const login = await auth.beginLogin();
  const authorization = new URL(login.authorizationUrl);
  nonce = authorization.searchParams.get('nonce')!;
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authorization.searchParams.get('agent_name_hint'), 'OEYdesign');
  assert.equal(new URL(authorization.searchParams.get('redirect_uri')!).hostname, '127.0.0.1');
  const host = authorization.searchParams.get('ext_agent_host_id');
  const invalid = new URL(authorization.searchParams.get('redirect_uri')!);
  invalid.search = 'state=wrong&code=wrong';
  assert.equal((await fetch(invalid)).status, 400);
  assert.equal(exchangeCount, 0);
  await callback(login.authorizationUrl);
  const state = await settled(auth);
  assert.equal(state.status, 'completed');
  const publicProfiles = await store.profiles();
  assert.equal(publicProfiles[0]?.planEnabled, true);
  assert.doesNotMatch(JSON.stringify(publicProfiles), /test-access|test-refresh|id_token/);
  assert.match(await readFile(join(directory, 'chatgpt.json'), 'utf8'), /oaiapp_test/);
  const reconnect = await auth.beginLogin(state.profileId);
  const next = new URL(reconnect.authorizationUrl);
  assert.equal(next.searchParams.get('client_id'), 'oaiapp_test');
  assert.equal(next.searchParams.get('ext_agent_host_id'), host);
  assert.equal(next.searchParams.has('agent_name_hint'), false);
  auth.cancelLogin();
  await settled(auth);
});

test('identity-only sign-in stays connected without allowing inference, and cancellation closes its callback', async t => {
  const { auth, store } = await fixture(t, {
    fetch: async () => Response.json({ access_token: 'identity-access', refresh_token: 'identity-refresh', id_token: 'test-id', scope: 'openid email', expires_in: 3600 }),
    verifyIdentity: async () => ({ sub: 'subject-a' }),
  });
  const login = await auth.beginLogin(); await callback(login.authorizationUrl); await settled(auth);
  const profile = (await store.profiles())[0]!;
  assert.equal(profile.connected, true); assert.equal(profile.planEnabled, false);
  const runtime = await createChatGPTModelRuntime(auth, profile.id);
  await assert.rejects(runtime.getAuth('openai'), /OAuth auth derivation failed/);
  const reconnect = await auth.beginLogin(profile.id, true);
  assert.equal(new URL(reconnect.authorizationUrl).searchParams.get('prompt'), 'consent');
  auth.cancelLogin(); await settled(auth);
  await assert.rejects(fetch(new URL(new URL(reconnect.authorizationUrl).searchParams.get('redirect_uri')!)));
});

test('a mismatched returning identity preserves the original account credentials', async t => {
  const { auth, store } = await fixture(t, {
    fetch: async () => Response.json({ access_token: 'wrong-access', refresh_token: 'wrong-refresh', id_token: 'wrong-id', scope: CHATGPT_PLAN_SCOPE, expires_in: 3600 }),
    verifyIdentity: async () => ({ sub: 'another-account' }),
  });
  await savedAccount(store);
  const login = await auth.beginLogin('profile-a'); await callback(login.authorizationUrl);
  assert.equal((await settled(auth)).error?.code, 'account_mismatch');
  assert.equal((await store.credentials('profile-a').read('openai') as { access: string }).access, 'test-access');
});

test('a verified identity can remain signed in even when no inference tokens were granted', async t => {
  const { auth, store } = await fixture(t, { fetch: async () => Response.json({ id_token: 'identity-only', scope: 'openid email' }), verifyIdentity: async () => ({ sub: 'subject-a' }) });
  const login = await auth.beginLogin(); await callback(login.authorizationUrl);
  assert.equal((await settled(auth)).status, 'completed');
  const profile = (await store.profiles())[0]!;
  assert.equal(profile.connected, true); assert.equal(profile.planEnabled, false);
  assert.doesNotMatch(JSON.stringify(profile), /identity-only/);
  await auth.disconnect(profile.id);
  assert.equal((await store.profiles())[0]?.connected, false);
});

test('Pi serializes rotation across runtimes, with no credential crossover between accounts', async t => {
  let refreshes = 0;
  const { auth, store } = await fixture(t, {
    fetch: async () => { refreshes++; return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', scope: CHATGPT_PLAN_SCOPE, expires_in: 3600 }); },
  });
  await savedAccount(store, 'profile-a', 0); await savedAccount(store, 'profile-b');
  const [one, two] = await Promise.all([createChatGPTModelRuntime(auth, 'profile-a'), createChatGPTModelRuntime(auth, 'profile-a')]);
  const connections = await Promise.all([one.getAuth('openai'), two.getAuth('openai')]);
  assert.equal(refreshes, 1);
  assert.ok(connections.every(connection => connection?.auth.apiKey === 'rotated-access'));
  assert.equal((await store.credentials('profile-b').read('openai') as { access: string }).access, 'test-access');
});

test('rotating token survives a JWKS outage and resumes verification without consuming the old refresh token', async t => {
  let refreshes = 0, verificationAvailable = false;
  const { auth, store } = await fixture(t, {
    fetch: async () => { refreshes++; return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', id_token: 'rotated-id', scope: CHATGPT_PLAN_SCOPE, expires_in: 3600 }); },
    verifyIdentity: async () => { if (!verificationAvailable) throw new Error('JWKS temporarily unavailable'); return { sub: 'subject-a' }; },
  });
  await savedAccount(store, 'profile-a', 0);
  const runtime = await createChatGPTModelRuntime(auth, 'profile-a');
  await assert.rejects(runtime.getAuth('openai'), /OAuth refresh failed/);
  const pending = await store.credentials('profile-a').read('openai') as ChatGPTCredential;
  assert.equal(pending.refresh, 'rotated-refresh'); assert.equal(pending.pendingIdentity, true);
  verificationAvailable = true;
  assert.equal((await runtime.getAuth('openai'))?.auth.apiKey, 'rotated-access');
  assert.equal(refreshes, 1);
});

test('request compatibility retains local design tools and history, and strips unsupported parameters', () => {
  const body = chatGPTPayload({ model: 'test', input: [{ role: 'system', content: 'design instructions' }, { role: 'user', content: 'Edit title' }],
    tools: [{ type: 'function', name: 'document_apply', parameters: { type: 'object' } }], max_output_tokens: 8192, temperature: 0.5, previous_response_id: 'old-response', store: true, stream: false });
  assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.equal('max_output_tokens' in body, false); assert.equal('previous_response_id' in body, false); assert.equal('tools' in body, false);
  const input = body.input as Array<{ type?: string; role?: string; tools?: unknown[] }>;
  assert.equal(input[0]?.type, 'additional_tools'); assert.equal(input[1]?.role, 'developer'); assert.equal(input[0]?.tools?.length, 1);
  assert.throws(() => chatGPTPayload({ tools: [{ type: 'tool_search' }] }), /local design function tools/);
});

test('account model discovery preserves server order and marks unknown model capabilities honestly', async t => {
  const { auth, store } = await fixture(t); await savedAccount(store);
  const runtime = await createChatGPTModelRuntime(auth, 'profile-a');
  const known = runtime.getModels('openai')[0]!;
  const choices = await listChatGPTModels(auth, 'profile-a', async (_url, options) => {
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-access');
    return Response.json({ models: [{ slug: 'unrecognized-model', display_name: 'New model', visibility: 'list' }, { slug: known.id, display_name: 'Known model', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }] });
  });
  assert.deepEqual(choices.map(choice => choice.id), ['unrecognized-model', known.id]);
  assert.equal(choices[0]?.supported, false); assert.equal(choices[0]?.images, false);
});

test('local logout clears tokens but retains registration and reports unconfirmed remote revocation', async t => {
  const { auth, store } = await fixture(t, { fetch: async () => { throw new Error('offline'); } }); await savedAccount(store);
  assert.deepEqual(await auth.disconnect('profile-a'), { remoteRevoked: false });
  assert.equal((await store.profiles())[0]?.connected, false);
  const saved = await store.transaction(accounts => accounts.profiles[0]);
  assert.equal(saved?.clientId, 'oaiapp_test'); assert.equal(saved?.credentials, undefined);
});

test('Pi Responses transport uses OAuth with local tool roundtrips and rejects incomplete/failed streams', async t => {
  const { auth, store } = await fixture(t); await savedAccount(store);
  const runtime = await createChatGPTModelRuntime(auth, 'profile-a');
  const model = runtime.getModels('openai').find(entry => entry.api === 'openai-responses')!;
  const requests: Record<string, unknown>[] = [];
  const streamResponse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  const mockedFetch: typeof fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-access');
    requests.push(JSON.parse(String(options?.body)));
    const item = { type: 'function_call', id: 'fc_item', call_id: 'call_1', name: 'document_read', arguments: '{"documentId":"design"}', status: 'completed' };
    return streamResponse([
      { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [item], usage: { input_tokens: 2, output_tokens: 1 } } },
    ]);
  };
  const context = { systemPrompt: 'Preserve manual edits.', tools: [{ name: 'document_read', description: 'Read current design', parameters: { type: 'object', properties: { documentId: { type: 'string' } } } }],
    messages: [{ role: 'user' as const, content: 'Read my design', timestamp: Date.now() }] };
  const assistant = await runtime.completeSimple(model, context, { fetch: mockedFetch });
  assert.equal(assistant.stopReason, 'toolUse');
  const call = assistant.content.find(part => part.type === 'toolCall')!;
  assert.equal(call.name, 'document_read');
  assert.deepEqual(call.arguments, { documentId: 'design' });
  const next = { ...context, messages: [...context.messages, assistant, { role: 'toolResult' as const, toolCallId: call.id, toolName: call.name,
    content: [{ type: 'text' as const, text: '{"revision":3}' }], isError: false, timestamp: Date.now() }] };
  const failed = await runtime.completeSimple(model, next, { fetch: async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { input: Array<{ type?: string; call_id?: string }> };
    assert.ok(body.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_1'));
    return streamResponse([{ type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } }]);
  } });
  assert.equal(failed.stopReason, 'error'); assert.match(failed.errorMessage!, /subscription_sharing_usage_limit_exceeded/);
  const incomplete = await runtime.completeSimple(model, context, { fetch: async () => streamResponse([{ type: 'response.incomplete', response: { status: 'incomplete', output: [] } }]) });
  assert.equal(incomplete.stopReason, 'error'); assert.match(incomplete.errorMessage!, /incomplete/i);
  assert.equal(requests[0]?.store, false); assert.equal(requests[0]?.stream, true); assert.equal('tools' in requests[0]!, false);
});
