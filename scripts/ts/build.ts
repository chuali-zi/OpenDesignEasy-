import { build } from 'esbuild';

await build({
  entryPoints: ['apps/cli/src/index.ts'],
  outfile: 'dist/oey.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);' },
});
console.log('Built dist/oey.mjs');
