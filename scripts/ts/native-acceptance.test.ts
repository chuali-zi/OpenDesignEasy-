import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

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
