import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'apps/cli/src/index.ts', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
test('real CLI checks and delivers all media without a Web service; failure preserves existing destination', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'oey-delivery-cli-'));
  try {
    assert.equal(cli('project', 'create', directory).status, 0);
    for (const kind of ['doc', 'deck', 'web']) {
      const created = cli('document', 'create', directory, '--kind', kind); assert.equal(created.status, 0, created.stderr);
      const documentId = JSON.parse(created.stdout).document.documentId;
      const checked = cli('document', 'check', directory, documentId); assert.equal(checked.status, 0, checked.stderr);
      const report = JSON.parse(checked.stdout).report; assert.equal(report.revision, 0);
      const output = resolve(directory, `${kind}.delivery.zip`);
      const delivered = cli('document', 'deliver', directory, documentId, '--revision', '0', '--output', output); assert.equal(delivered.status, 0, delivered.stderr);
      const zip = await JSZip.loadAsync(await readFile(output)); assert.ok(zip.file('delivery.json'));
      await writeFile(output, 'existing user output');
      const failed = cli('document', 'deliver', directory, documentId, '--revision', '999', '--output', output); assert.equal(failed.status, 1);
      assert.equal(await readFile(output, 'utf8'), 'existing user output');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
