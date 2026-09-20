import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectRuntime, createDesignServices } from '@oeydesign/runtime';

// Separate opt-in: native Pi Kimi endpoint, only after authorization for /coding.
process.loadEnvFile(resolve('.env'));
const root = resolve(`.tmp/r3-native-${Date.now()}`);
const runtime = ProjectRuntime.create(root, { name: 'Synthetic native protocol acceptance' });
try {
  runtime.agent.configure({ providerId: 'kimi-coding', modelId: 'k3', baseUrl: '', apiKeyEnv: 'API_KEY', thinkingLevel: 'low' });
  assert.equal(runtime.agent.getConfig().baseUrl, undefined, 'Native validation must not inherit the compatible BASE_URL.');
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = runtime.createDocument({ name: 'Synthetic red square' });
  runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'node.insert', node: {
    id: 'red-square', kind: 'shape', parentId: document.pages[0]!.id,
    geometry: { x: 200, y: 150, width: 350, height: 350, rotation: 0 }, style: { fill: '#FF0000' }, locked: false, hidden: false,
  } }]));
  const session = await runtime.agent.createSession();
  const calls: string[] = [];
  runtime.agent.subscribe(event => {
    const detail = event.event as { type?: string; toolName?: string } | undefined;
    if (detail?.type === 'tool_execution_start' && detail.toolName) { calls.push(detail.toolName); console.log(JSON.stringify({ tool: detail.toolName })); }
  });
  const accepted = await runtime.agent.send(session.sessionId, `调用 render_preview 查看当前文档的截图，再用一句中文说出画面中图形的颜色与形状。最后使用 design_decide 记录“保持简洁留白”。不要改动文档或生成图片。`, { documentId: document.documentId });
  const timeout = setTimeout(() => { void runtime.agent.cancel(session.sessionId).catch(() => {}); }, 120000);
  try { await runtime.agent.waitForIdle(session.sessionId); } finally { clearTimeout(timeout); }
  const run = runtime.agent.getRun(accepted.runId)!;
  assert.equal(run.status, 'completed', run.error);
  assert.ok(calls.includes('render_preview'));
  assert.ok(calls.includes('design_decide'));
  assert.equal(runtime.readDocument(document.documentId).revision, 1);
  const messages = await runtime.agent.getMessages(session.sessionId);
  const assistant = messages.findLast(message => message.role === 'assistant');
  assert.equal(assistant?.api, 'anthropic-messages', 'Verify the protocol actually used, not just the provider name.');
  const result = { root, protocol: assistant.api, provider: assistant.provider, model: assistant.model, sessionId: session.sessionId, calls,
    text: assistant.content.filter(part => part.type === 'text').map(part => part.text).join('\n') };
  await writeFile(join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { runtime.close(); }
