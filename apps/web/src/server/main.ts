import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createDesignServices, ProjectRuntime } from '@oeydesign/runtime';
import { createWebHost } from './host.ts';

const { values } = parseArgs({ options: { project: { type: 'string', default: '.tmp/workbench' }, port: { type: 'string', default: '4318' } } });
const root = resolve(values.project!);
if (existsSync(resolve('.env'))) process.loadEnvFile(resolve('.env'));
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
const runtime = existsSync(join(root, 'project.sqlite')) ? ProjectRuntime.open(root) : ProjectRuntime.create(root, { name: '我的设计项目' });
runtime.agent.configureTools(createDesignServices(runtime));
try {
  if (!runtime.listDocuments().length) runtime.createDocument({ name: '未命名演示文稿' });
  const staticRoot = resolve('apps/web/dist');
  const app = await createWebHost(runtime, {
    ...(existsSync(staticRoot) ? { staticRoot } : {}),
    developmentOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
  app.addHook('onClose', async () => runtime.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    console.log(`OEYdesign: ${address}\nProject: ${root}`);
    if (!existsSync(staticRoot)) console.log('Run npm run build:web to build the editor, or npm run dev:web for Vite.');
  } catch (error) { await app.close(); throw error; }
} catch (error) { runtime.close(); throw error; }
