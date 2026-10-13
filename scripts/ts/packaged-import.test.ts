import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createWebDocument } from '@oeydesign/document';
import { exportWebSourceZip } from '@oeydesign/media';

test('packaged CLI lazily loads the official parser and imports managed source without a Web host', async () => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const root = await mkdtemp(join(resolve('.tmp'), 'packaged-import-test-'));
  const env = { PATH: dirname(process.execPath) };
  const exec = promisify(execFile);
  try {
    const executable = join(root, 'oey.mjs');
    await exec(process.execPath, ['--import', 'tsx', 'scripts/ts/build.ts', executable], { cwd: resolve('.'), env, timeout: 30000 });
    const source = createWebDocument({ documentId: 'synthetic-package', name: 'Packaged project' });
    source.sourceModules = [{ id: 'counter', path: 'Counter.tsx', language: 'tsx', exports: ['default'], source: 'export default function Counter(){return <button>Packaged source import</button>}' }];
    source.nodes[source.pages[0]!.rootId]!.component = { moduleId: 'counter', exportName: 'default' };
    const file = join(root, 'input.source.zip'); await writeFile(file, await exportWebSourceZip(source));
    const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [executable, ...args], { env, timeout: 15000 })).stdout);
    const directory = join(root, 'project'); await run('project', 'create', directory);
    const imported = await run('document', 'import-source', directory, file);
    assert.equal(imported.document.sourceModules[0].source, source.sourceModules[0]!.source);
    assert.equal(imported.document.pages[0].route, '/');
    const exported = join(root, 'output.source.zip');
    await run('document', 'export', directory, imported.document.documentId, '--output', exported);
    const returned = await run('document', 'import-source', directory, exported);
    assert.notEqual(returned.document.documentId, imported.document.documentId);
    assert.equal(returned.document.sourceModules[0].source, source.sourceModules[0]!.source);
  } finally { await rm(root, { recursive: true, force: true }); }
});
