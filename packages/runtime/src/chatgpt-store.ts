import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import lockfile from 'proper-lockfile';
import type { Credential, CredentialStore, OAuthCredential } from '@earendil-works/pi-ai';

export const CHATGPT_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export interface ChatGPTCredential extends OAuthCredential {
  clientId: string;
  idToken: string;
  subject: string;
  scopes: string[];
  earliestRefreshAt?: number;
  /** A rotated token must be saved before a potentially unavailable JWKS check. */
  pendingIdentity?: boolean;
  pendingExpires?: number;
}
export interface ChatGPTProfile {
  id: string;
  label: string;
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
  clientId: string;
  credentials?: ChatGPTCredential;
  status?: 'connected' | 'disconnected';
  idToken?: string;
}
export interface PublicChatGPTProfile {
  id: string;
  label: string;
  email?: string;
  name?: string;
  connected: boolean;
  planEnabled: boolean;
}
export interface ChatGPTAccounts { version: 1; hostId: string; profiles: ChatGPTProfile[] }

export function defaultChatGPTDirectory(): string {
  return process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OEYdesign', 'auth')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'oeydesign', 'auth');
}

/** Account secrets belong to the current OS user, never to a design project. */
export class ChatGPTStore {
  readonly directory: string;
  private initialized?: Promise<void>;
  private readonly checkpoints = new Map<string, (credential: ChatGPTCredential) => Promise<void>>();
  constructor(directory = defaultChatGPTDirectory()) { this.directory = directory; }
  private initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (process.platform === 'win32') {
        const { stdout } = await promisify(execFile)('whoami.exe', [], { windowsHide: true });
        await promisify(execFile)('icacls.exe', [this.directory, '/inheritance:r', '/grant:r', `${stdout.trim()}:(OI)(CI)F`], { windowsHide: true });
      }
    })();
  }
  async transaction<T>(fn: (accounts: ChatGPTAccounts) => Promise<T> | T): Promise<T> {
    await this.initialize();
    const release = await lockfile.lock(this.directory, { realpath: false, stale: 120_000, update: 10_000, retries: { retries: 40, minTimeout: 50, maxTimeout: 500 } });
    try {
      const path = join(this.directory, 'chatgpt.json');
      let accounts: ChatGPTAccounts;
      let previous: string | undefined;
      try {
        accounts = JSON.parse(await readFile(path, 'utf8')) as ChatGPTAccounts;
        if (accounts.version !== 1 || !accounts.hostId?.startsWith('urn:uuid:') || !Array.isArray(accounts.profiles)) throw new Error('Invalid ChatGPT account file.');
        previous = JSON.stringify(accounts);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        accounts = { version: 1, hostId: `urn:uuid:${randomUUID()}`, profiles: [] };
      }
      const result = await fn(accounts);
      if (previous !== JSON.stringify(accounts)) await this.save(accounts);
      return result;
    } finally { await release(); }
  }
  private async save(accounts: ChatGPTAccounts): Promise<void> {
    const temporary = join(this.directory, `chatgpt-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(accounts), { mode: 0o600 });
    await rename(temporary, join(this.directory, 'chatgpt.json'));
  }
  /** Called only by OAuth refresh while Pi's CredentialStore.modify holds this profile's lock. */
  async checkpointRotation(profileId: string, credential: ChatGPTCredential): Promise<void> {
    const checkpoint = this.checkpoints.get(profileId);
    if (!checkpoint) throw new Error('Token rotation requires the account write lock.');
    await checkpoint(credential);
  }
  async profiles(): Promise<PublicChatGPTProfile[]> {
    return this.transaction(accounts => accounts.profiles.map(profile => ({
      id: profile.id, label: profile.label, email: profile.email, name: profile.name,
      connected: Boolean(profile.status === 'connected' || (profile.credentials && !profile.credentials.pendingIdentity)),
      planEnabled: Boolean(profile.credentials && !profile.credentials.pendingIdentity && profile.credentials.scopes.includes(CHATGPT_PLAN_SCOPE)),
    })));
  }
  /** Each Pi runtime stays bound to one profile, even when another project switches accounts. */
  credentials(profileId: string): CredentialStore {
    return {
      read: async providerId => providerId === 'openai'
        ? this.transaction(accounts => structuredClone(accounts.profiles.find(profile => profile.id === profileId)?.credentials)) : undefined,
      list: async () => this.transaction(accounts => accounts.profiles.find(profile => profile.id === profileId)?.credentials ? [{ providerId: 'openai', type: 'oauth' as const }] : []),
      modify: async (providerId, fn) => {
        if (providerId !== 'openai') throw new Error('ChatGPT credentials cannot authorize another provider.');
        let failure: unknown;
        const result = await this.transaction(async accounts => {
          const profile = accounts.profiles.find(entry => entry.id === profileId);
          if (!profile?.credentials) throw new Error('ChatGPT connection has ended. Sign in again.');
          const current = structuredClone(profile.credentials);
          this.checkpoints.set(profileId, async credential => { profile.credentials = structuredClone(credential); await this.save(accounts); });
          let credential: Credential | undefined;
          try { credential = await fn(current); }
          catch (error) {
            failure = error;
            let cause = error as { code?: string; cause?: unknown };
            while (cause.cause) cause = cause.cause as typeof cause;
            const code = cause.code;
            if (['invalid_grant', 'invalid_refresh_token', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'account_mismatch'].includes(code ?? '')) { delete profile.credentials; delete profile.idToken; profile.status = 'disconnected'; }
            else if (current.pendingIdentity) profile.credentials = current;
          }
          finally { this.checkpoints.delete(profileId); }
          if (credential) {
            if (credential.type !== 'oauth') throw new Error('Expected a ChatGPT OAuth credential.');
            profile.credentials = credential as ChatGPTCredential;
          }
          return structuredClone(profile.credentials) as Credential | undefined;
        });
        if (failure) throw failure;
        return result;
      },
      delete: async () => { await this.transaction(accounts => { const profile = accounts.profiles.find(entry => entry.id === profileId); if (profile) { delete profile.credentials; delete profile.idToken; profile.status = 'disconnected'; } }); },
    };
  }
}
