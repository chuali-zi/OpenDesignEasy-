import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectRuntime, ProjectAssets, createDesignServices } from '@oeydesign/runtime';

// Opt-in real acceptance. Uses only a synthetic prompt in a new disposable project.
process.loadEnvFile(resolve('.env'));
const root = resolve(`.tmp/r3-image-${Date.now()}`);
const runtime = ProjectRuntime.create(root, { name: 'Synthetic image acceptance' });
try {
  runtime.agent.configure({ providerId: 'oey-compatible', modelId: process.env.MODEL, baseUrl: process.env.BASE_URL, apiKeyEnv: 'API_KEY', api: 'openai-completions', thinkingLevel: 'low', maxTokens: 8192 });
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = runtime.createDocument({ name: 'Reading illustration' });
  const session = await runtime.agent.createSession();
  const calls: string[] = [];
  runtime.agent.subscribe(event => {
    const detail = event.event as { type?: string; toolName?: string } | undefined;
    if (detail?.type === 'tool_execution_start' && detail.toolName) { calls.push(detail.toolName); console.log(JSON.stringify({ tool: detail.toolName })); }
  });
  const accepted = await runtime.agent.send(session.sessionId, `在当前文档中测试图片工具链。调用 asset_generate 恰好一次，提示词为“米色背景上的一本打开的绿色书，简洁平面插画，没有文字”。生成后读取图片，再将它作为一个可编辑图片对象放入当前第一页，保留图片原始宽高比。调用 render_preview 看一眼画面，用一句话描述实际看到的图像；不要再次生成图片，不要添加其他页。`, { documentId: document.documentId });
  const timeout = setTimeout(() => { void runtime.agent.cancel(session.sessionId).catch(() => {}); }, 240000);
  try { await runtime.agent.waitForIdle(session.sessionId); } finally { clearTimeout(timeout); }
  const run = runtime.agent.getRun(accepted.runId)!;
  assert.equal(run.status, 'completed', run.error);
  const current = runtime.readDocument(document.documentId);
  assert.ok(Object.values(current.nodes).some(node => node.kind === 'image'));
  assert.equal(calls.filter(call => call === 'asset_generate').length, 1);
  assert.ok(calls.includes('reference_read'));
  assert.ok(calls.includes('render_preview'));
  const assets = new ProjectAssets(runtime);
  assert.equal(assets.list().filter(asset => asset.kind === 'image').length, 1);
  const preview = await createDesignServices(runtime).preview({ documentId: document.documentId }, new AbortController().signal);
  await writeFile(join(root, 'exports', 'preview.png'), Buffer.from(preview.data, 'base64'));
  const messages = await runtime.agent.getMessages(session.sessionId);
  const result = { root, sessionId: session.sessionId, documentId: document.documentId, revision: current.revision, calls, lastMessage: messages.at(-1) };
  await writeFile(join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { runtime.close(); }
