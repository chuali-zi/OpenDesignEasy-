import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

test('native acceptance transport failure makes one attempt and removes its fixture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oey-native-entry-'));
  const counter = join(root, 'attempts.json');
  // Real Pi serialization, synthetic credential, and an intercepted transport only.
  const mock = `import {writeFileSync} from 'node:fs'; let calls=0; globalThis.fetch=async(request,options)=>{
    writeFileSync(${JSON.stringify(counter)}, JSON.stringify({calls:++calls,url:request.url,redirect:options.redirect}));
    throw new Error('synthetic offline transport failure');
  };`;
  const env: NodeJS.ProcessEnv = { PATH: dirname(process.execPath), KIMI_API_KEY: 'synthetic-offline-only' };
  try {
    const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
      '--import', `data:text/javascript,${encodeURIComponent(mock)}`, resolve('scripts/ts/check-r3-native.ts'), '--live-tools'],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    const code = await new Promise<number | null>(resolveExit => child.on('exit', resolveExit)); clearTimeout(timer);
    assert.equal(code, 1, output);
    assert.match(output, /Bounded native tool acceptance failed/);
    assert.doesNotMatch(output, /synthetic offline transport failure|synthetic-offline-only/);
    const transport = JSON.parse(readFileSync(counter, 'utf8'));
    assert.equal(transport.calls, 1);
    assert.match(transport.url, /^https:\/\/api\.kimi\.com\/coding\/v1\/messages(?:\?beta=true)?$/);
    assert.equal(transport.redirect, 'error');
    assert.deepEqual(readdirSync(join(root, '.tmp')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('documented npm entry preserves proxy and CA settings without real transport or retries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oey-native-launch-'));
  const counter = join(root, 'transport.json');
  const proxy = 'http://127.0.0.1:9';
  // NODE_OPTIONS preloads an offline interceptor in npm and its child. Only the
  // child reaches fetch; the proxy is never contacted and no real key is inherited.
  const mock = `import {writeFileSync} from 'node:fs'; let calls=0; globalThis.fetch=async()=>{
    writeFileSync(${JSON.stringify(counter)},JSON.stringify({calls:++calls,
      proxyPreserved:process.env.HTTPS_PROXY===${JSON.stringify(proxy)},
      caPreserved:process.env.SSL_CERT_FILE==='synthetic-ca-setting',
      tlsVerificationDefault:process.env.NODE_TLS_REJECT_UNAUTHORIZED===undefined,
      envProxyEnabled:process.execArgv.includes('--use-env-proxy'),
      systemCaEnabled:process.execArgv.includes('--use-system-ca')}));
    throw new Error('offline launch transport stop');
  };`;
  const env: NodeJS.ProcessEnv = {
    PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    KIMI_API_KEY: 'synthetic-offline-only', HTTPS_PROXY: proxy, NO_PROXY: 'localhost',
    SSL_CERT_FILE: 'synthetic-ca-setting', NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(mock)}`,
  };
  const packageFile = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.ok(packageFile.scripts['check:native-tools']);
  const fixtureParent = resolve('.tmp');
  mkdirSync(fixtureParent, { recursive: true });
  const before = readdirSync(fixtureParent).filter(name => name.startsWith('native-tools-')).sort();
  try {
    const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath),
      process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    await assert.rejects(promisify(execFile)(process.execPath,
      [npmCli, 'run', 'check:native-tools', '--', '--live-tools'],
      { cwd: resolve('.'), env, timeout: 15000 }), (error: unknown) => {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      assert.equal(result.code, 1);
      assert.match(`${result.stdout}${result.stderr}`, /Bounded native tool acceptance failed/);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-offline-only|offline launch transport stop/);
      return true;
    });
    assert.deepEqual(JSON.parse(readFileSync(counter, 'utf8')), {
      calls: 1, proxyPreserved: true, caPreserved: true, tlsVerificationDefault: true,
      envProxyEnabled: true, systemCaEnabled: true,
    });
    assert.deepEqual(readdirSync(fixtureParent).filter(name => name.startsWith('native-tools-')).sort(), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
