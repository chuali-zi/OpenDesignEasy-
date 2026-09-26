import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import type { WebDocument } from '@oeydesign/document';
import type { AssetResolver } from './assets.ts';
import { buildWebSource } from './web.ts';

export type WebBuildOptions = { signal?: AbortSignal };
export type WebProjectBuild = { files: Record<string, Uint8Array>; documentId: string; revision: number };
const BUILD_TIMEOUT_MS = 120_000;
const require = createRequire(import.meta.url);

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Web build was aborted.');
  error.name = 'AbortError';
  return error;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function writeSourceFiles(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const target = resolve(root, name);
    if (!inside(root, target) || target === root) throw new Error(`Generated source path escapes its temporary project: ${name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

function runnerSource(viteEntry: string, reactPath: string, reactDomPath: string, reactRuntimePath: string, reactDomClientPath: string): string {
  return `import { build } from ${JSON.stringify(pathToFileURL(viteEntry).href)};
const [root, outDir] = process.argv.slice(2);
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: 'react/jsx-runtime', replacement: ${JSON.stringify(reactRuntimePath)} },
    { find: 'react-dom/client', replacement: ${JSON.stringify(reactDomClientPath)} },
    { find: 'react-dom', replacement: ${JSON.stringify(reactDomPath)} },
    { find: 'react', replacement: ${JSON.stringify(reactPath)} },
  ] },
  build: { outDir, emptyOutDir: true, target: 'es2022', sourcemap: false, minify: true },
});
`;
}

async function runBuild(root: string, runnerPath: string, outDir: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [runnerPath, root, outDir], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let forcedError: Error | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error); else resolvePromise();
    };
    const terminate = (error: Error) => {
      forcedError = error;
      child.kill();
    };
    const onAbort = () => terminate(abortError(signal!));
    const timer = setTimeout(() => terminate(new Error(`Vite build exceeded ${BUILD_TIMEOUT_MS} ms.`)), BUILD_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => finish(error));
    child.once('close', (code, exitSignal) => {
      if (forcedError) return finish(forcedError);
      if (code === 0) return finish();
      const detail = (stderr || stdout).trim();
      finish(new Error(`Vite build failed${code === null ? ` (${exitSignal ?? 'terminated'})` : ` with exit code ${code}`}.${detail ? `\n${detail}` : ''}`));
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function collectDist(root: string, directory: string, files: Record<string, Uint8Array>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (!inside(root, fullPath)) throw new Error('Vite output escaped its isolated build directory.');
    if (entry.isSymbolicLink()) throw new Error(`Vite emitted an unexpected symlink: ${relative(root, fullPath)}`);
    if (entry.isDirectory()) await collectDist(root, fullPath, files);
    else if (entry.isFile()) files[relative(join(root, 'dist'), fullPath).split(sep).join('/')] = new Uint8Array(await readFile(fullPath));
  }
}

export async function buildWebProject(document: WebDocument, resolveAsset?: AssetResolver, options: WebBuildOptions = {}): Promise<WebProjectBuild> {
  options.signal?.throwIfAborted();
  const projectRoot = await mkdtemp(join(tmpdir(), 'oey-web-build-'));
  try {
    const source = await buildWebSource(document, resolveAsset);
    await writeSourceFiles(projectRoot, source);
    const viteEntry = fileURLToPath(import.meta.resolve('vite'));
    const reactPath = require.resolve('react');
    const reactDomPath = require.resolve('react-dom');
    const reactRuntimePath = require.resolve('react/jsx-runtime');
    const reactDomClientPath = require.resolve('react-dom/client');
    const runnerPath = join(projectRoot, '.oey-vite-build.mjs');
    const distPath = join(projectRoot, 'dist');
    await writeFile(runnerPath, runnerSource(viteEntry, reactPath, reactDomPath, reactRuntimePath, reactDomClientPath));
    await runBuild(projectRoot, runnerPath, distPath, options.signal);
    options.signal?.throwIfAborted();
    const files: Record<string, Uint8Array> = {};
    await collectDist(projectRoot, distPath, files);
    if (!files['index.html']) throw new Error('Vite completed without producing dist/index.html.');
    files['oey-build-metadata.json'] = new TextEncoder().encode(JSON.stringify({ documentId: document.documentId, revision: document.revision, format: 'web-build', status: 'built' }, null, 2));
    return { files, documentId: document.documentId, revision: document.revision };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

export async function exportWebBuildZip(document: WebDocument, resolveAsset?: AssetResolver, options: WebBuildOptions = {}): Promise<Uint8Array> {
  const build = await buildWebProject(document, resolveAsset, options);
  options.signal?.throwIfAborted();
  const zip = new JSZip();
  for (const [path, bytes] of Object.entries(build.files)) zip.file(path, bytes);
  return zip.generateAsync({ type: 'uint8array' });
}
