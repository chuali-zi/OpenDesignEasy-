import { build } from 'esbuild';
import { dirname, join } from 'node:path';

const outfile = process.argv[2] ?? 'dist/oey.mjs';
await build({
  entryPoints: ['apps/cli/src/index.ts'],
  outfile,
  bundle: true,
  external: ['@earendil-works/*', 'playwright', 'playwright-core', 'typescript', 'pdfjs-dist/*', 'tesseract.js'],
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);' },
});
await build({ entryPoints: ['packages/media/src/ocr-worker.ts'], outfile: join(dirname(outfile), 'ocr-worker.mjs'), bundle: true,
  external: ['tesseract.js'], platform: 'node', target: 'node24', format: 'esm' });
console.log(`Built ${outfile} and OCR worker`);
