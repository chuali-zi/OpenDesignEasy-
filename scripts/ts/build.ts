import { build } from 'esbuild';

const outfile = process.argv[2] ?? 'dist/oey.mjs';
await build({
  entryPoints: ['apps/cli/src/index.ts'],
  outfile,
  bundle: true,
  external: ['@earendil-works/*', 'playwright', 'playwright-core', 'typescript'],
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);' },
});
console.log(`Built ${outfile}`);
