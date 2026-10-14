import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthAuth } from '@earendil-works/pi-ai';
import { CHATGPT_PLAN_SCOPE, ChatGPTStore } from './chatgpt-store.ts';
import type { ChatGPTCredential, ChatGPTProfile } from './chatgpt-store.ts';

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = `openid profile email offline_access resource.invoke ${CHATGPT_PLAN_SCOPE}`;
const random = () => randomBytes(32).toString('base64url');
export class ChatGPTError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message); this.name = 'ChatGPTError'; }
}
export interface ChatGPTLoginState {
  attemptId?: string;
  status: 'idle' | 'pending' | 'completed' | 'cancelled' | 'failed';
  profileId?: string;
  error?: { code: string; message: string };
}
interface TokenResponse {
  access_token: string; refresh_token: string; id_token?: string; scope: string; expires_in: number; earliest_refresh_at?: number;
}
export interface ChatGPTAuthOptions {
  fetch?: typeof fetch;
  verifyIdentity?: (token: string, clientId: string, nonce?: string) => Promise<{ sub: string; email?: string; name?: string }>;
}

export class ChatGPTAuth {
  readonly store: ChatGPTStore;
  private state: ChatGPTLoginState = { status: 'idle' };
  private abortLogin?: AbortController;
  private startingLogin = false;
  private closed = false;
  private readonly request: typeof fetch;
  private readonly verify: NonNullable<ChatGPTAuthOptions['verifyIdentity']>;
  private readonly jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  constructor(store = new ChatGPTStore(), options: ChatGPTAuthOptions = {}) {
    this.store = store;
    this.request = options.fetch ?? fetch;
    this.verify = options.verifyIdentity ?? (async (token, clientId, nonce) => {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: ISSUER, audience: clientId });
      if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new ChatGPTError('invalid_identity', 'ChatGPT returned an invalid account identity.');
      return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined, name: typeof payload.name === 'string' ? payload.name : undefined };
    });
  }
  loginState(): ChatGPTLoginState { return structuredClone(this.state); }
  cancelLogin(): void { this.abortLogin?.abort(); }
  close(): void { this.closed = true; this.cancelLogin(); }
  async beginLogin(profileId?: string, enablePlan = false): Promise<{ attemptId: string; authorizationUrl: string }> {
    if (this.closed) throw new ChatGPTError('closed', 'ChatGPT connection service has closed.');
    if (this.abortLogin || this.startingLogin) throw new ChatGPTError('busy', 'A ChatGPT sign-in is already in progress.');
    this.startingLogin = true;
    let saved: { hostId: string; profile?: ChatGPTProfile };
    try { saved = await this.store.transaction(accounts => ({ hostId: accounts.hostId, profile: structuredClone(accounts.profiles.find(profile => profile.id === profileId)) })); }
    finally { this.startingLogin = false; }
    if (this.closed) throw new ChatGPTError('closed', 'ChatGPT connection service has closed.');
    if (profileId && !saved.profile) throw new ChatGPTError('not_found', 'ChatGPT account does not exist.');
    const controller = new AbortController();
    this.abortLogin = controller;
    const attemptId = randomUUID(), state = random(), nonce = random(), verifier = random();
    let redirectUri = '';
    const server = createServer();
    const callback = new Promise<URL>((resolve, reject) => {
      server.on('request', (request, response) => {
        const expected = new URL(redirectUri);
        const url = new URL(request.url ?? '/', redirectUri);
        if (request.method !== 'GET' || request.headers.host !== expected.host || url.pathname !== expected.pathname) { response.writeHead(404).end(); return; }
        if (url.searchParams.get('state') !== state) { response.writeHead(400).end('Invalid sign-in state.'); return; }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('You can return to OEYdesign. Your connection is being verified.');
        resolve(url);
      });
      controller.signal.addEventListener('abort', () => reject(new ChatGPTError('cancelled', 'ChatGPT sign-in was cancelled.')), { once: true });
      server.once('error', reject);
    });
    // Register the rejection handler before listening or returning the login URL.
    const result = callback.then(async url => {
      if (url.searchParams.has('error')) throw new ChatGPTError('access_denied', 'ChatGPT authorization was declined.');
      const clientId = url.searchParams.get('client_id') || saved.profile?.clientId;
      if (!clientId || clientId === 'dynamic_agent_client' || (saved.profile && clientId !== saved.profile.clientId)) throw new ChatGPTError('invalid_client', 'ChatGPT returned an unexpected client registration.');
      const code = url.searchParams.get('code');
      if (!code) throw new ChatGPTError('invalid_callback', 'ChatGPT did not return an authorization code.');
      // Retain registration even when code exchange fails; reauthorization reuses it.
      await this.store.transaction(accounts => {
        if (!saved.profile && !accounts.profiles.some(profile => profile.id === attemptId)) accounts.profiles.push({ id: attemptId, label: 'ChatGPT connection', issuer: ISSUER, subject: '', clientId });
      });
      const token = await this.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }, controller.signal);
      if (!token.id_token) throw new ChatGPTError('invalid_identity', 'ChatGPT did not return an ID token.');
      const identity = await this.verify(token.id_token, clientId, nonce);
      if (saved.profile?.subject && saved.profile.subject !== identity.sub) throw new ChatGPTError('account_mismatch', 'The signed-in account does not match this saved connection.');
      controller.signal.throwIfAborted();
      const planEnabled = typeof token.scope === 'string' && token.scope.split(/\s+/).includes(CHATGPT_PLAN_SCOPE);
      const credentials = planEnabled || (token.access_token && token.refresh_token) ? this.credential(token, clientId, token.id_token, identity.sub) : undefined;
      const id = saved.profile?.id ?? attemptId;
      await this.store.transaction(accounts => {
        const profile: ChatGPTProfile = { id, issuer: ISSUER, subject: identity.sub, clientId, email: identity.email, name: identity.name,
          label: saved.profile?.label !== 'ChatGPT connection' && saved.profile?.label ? saved.profile.label : `${identity.email || identity.name || 'ChatGPT'} · ${id.slice(0, 6)}`, credentials, status: 'connected', ...(!credentials ? { idToken: token.id_token } : {}) };
        const index = accounts.profiles.findIndex(entry => entry.id === id);
        if (index < 0) accounts.profiles.push(profile); else accounts.profiles[index] = profile;
      });
      this.state = { status: 'completed', attemptId, profileId: id };
    }).catch(error => {
      const typed = error instanceof ChatGPTError ? error : new ChatGPTError('sign_in_failed', 'ChatGPT sign-in failed. Check the connection and try again.');
      this.state = { status: typed.code === 'cancelled' ? 'cancelled' : 'failed', attemptId, error: { code: typed.code, message: typed.message } };
    }).finally(() => {
      clearTimeout(timeout);
      server.close(); server.closeAllConnections();
      if (this.abortLogin === controller) this.abortLogin = undefined;
    });
    const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
    timeout.unref();
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Callback listener failed.');
      redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({ client_id: saved.profile?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: saved.hostId,
        response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce,
        code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        ...(!saved.profile ? { agent_name_hint: 'OEYdesign' } : {}), ...(saved.profile?.email ? { login_hint: saved.profile.email } : {}),
        ...(enablePlan ? { prompt: 'consent' } : {}),
      }).toString();
      this.state = { status: 'pending', attemptId };
      void result;
      return { attemptId, authorizationUrl: url.toString() };
    } catch (error) { controller.abort(); await result; throw error; }
  }
  private credential(token: TokenResponse, clientId: string, idToken: string, subject: string): ChatGPTCredential {
    if (!token.access_token || !token.refresh_token || typeof token.scope !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new ChatGPTError('invalid_token', 'ChatGPT returned an invalid token response.');
    return { type: 'oauth', access: token.access_token, refresh: token.refresh_token, expires: Date.now() + token.expires_in * 1000,
      clientId, idToken, subject, scopes: token.scope.split(/\s+/).filter(Boolean), earliestRefreshAt: token.earliest_refresh_at };
  }
  private async token(body: Record<string, string>, signal: AbortSignal): Promise<TokenResponse> {
    const response = await this.request(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    const data = await response.json() as TokenResponse & { error?: string };
    if (!response.ok) throw new ChatGPTError(data.error || 'token_unavailable', response.status >= 500 ? 'ChatGPT token service is temporarily unavailable.' : 'ChatGPT authorization could not be renewed. Sign in again.', response.status >= 500);
    return data;
  }
  /** Pi owns the refresh lock; this adapter supplies verified profile-aware OAuth. */
  oauth(profileId: string): OAuthAuth {
    return {
      name: 'ChatGPT plan', isSubscription: true, loginLabel: 'Continue with ChatGPT',
      login: async () => { throw new ChatGPTError('sign_in_required', 'Connect ChatGPT from OEYdesign settings.'); },
      refresh: async credential => {
        const current = credential as ChatGPTCredential;
        const previousIdToken = current.idToken;
        let renewed = current;
        if (!current.pendingIdentity) {
          if (current.earliestRefreshAt && current.earliestRefreshAt * 1000 > Date.now()) throw new ChatGPTError('refresh_not_ready', 'ChatGPT access cannot be renewed yet. Try again shortly.', true);
          const token = await this.token({ grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refresh, resource: RESOURCE }, AbortSignal.timeout(30_000));
          renewed = this.credential(token, current.clientId, token.id_token ?? current.idToken, current.subject);
          // Persist the successor before identity verification, without reacquiring Pi's store lock.
          const pending = { ...renewed, pendingIdentity: Boolean(token.id_token), pendingExpires: renewed.expires, expires: token.id_token ? 0 : renewed.expires };
          Object.assign(credential, pending);
          await this.store.checkpointRotation(profileId, pending);
        }
        if (renewed.idToken !== previousIdToken || current.pendingIdentity) {
          const identity = await this.verify(renewed.idToken, current.clientId);
          if (identity.sub !== current.subject) throw new ChatGPTError('account_mismatch', 'ChatGPT refreshed a different account. Sign in again.');
        }
        delete renewed.pendingIdentity;
        if (renewed.pendingExpires) renewed.expires = renewed.pendingExpires;
        delete renewed.pendingExpires;
        return renewed;
      },
      toAuth: async credential => {
        const current = credential as ChatGPTCredential;
        if (current.pendingIdentity) throw new ChatGPTError('identity_pending', 'ChatGPT identity verification is pending. Try again.', true);
        if (!current.scopes.includes(CHATGPT_PLAN_SCOPE)) throw new ChatGPTError('plan_not_enabled', 'Enable ChatGPT plan usage for this connection.');
        return { apiKey: current.access };
      },
    };
  }
  async disconnect(profileId: string): Promise<{ remoteRevoked: boolean }> {
    return this.store.transaction(async accounts => {
      const profile = accounts.profiles.find(entry => entry.id === profileId);
      if (!profile) throw new ChatGPTError('not_found', 'ChatGPT account does not exist.');
      let remoteRevoked = !profile.credentials;
      if (profile.credentials) {
        try {
          const discovery = await this.request(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) }).then(response => response.json()) as { revocation_endpoint: string };
          const endpoint = new URL(discovery.revocation_endpoint);
          if (endpoint.origin !== ISSUER) throw new Error('Unexpected revocation endpoint.');
          const response = await this.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: profile.credentials.refresh, token_type_hint: 'refresh_token', client_id: profile.clientId }), signal: AbortSignal.timeout(15_000) });
          remoteRevoked = response.ok;
        } catch { remoteRevoked = false; }
      }
      delete profile.credentials;
      delete profile.idToken;
      profile.status = 'disconnected';
      return { remoteRevoked };
    });
  }
}
