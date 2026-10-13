import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectRuntime, createDesignServices } from '@oeydesign/runtime';
import type { AgentRunLimits } from '@oeydesign/runtime';

// Explicit authorization is still required; this is not the text-only probe.
if (process.argv.slice(2).join(' ') !== '--live-tools') throw new Error('Native tool acceptance requires separate budget authorization and --live-tools.');
if (!process.env.KIMI_API_KEY) throw new Error('KIMI_API_KEY is missing. No credential files are loaded.');
const limits: AgentRunLimits = {
  maxRequests: 2, maxInputTokens: 32_000, maxOutputTokens: 1024, maxOutputTokensPerRequest: 512,
  maxToolCalls: 1, timeoutMs: 45_000, allowedTools: ['document_read'],
  endpoint: 'https://api.kimi.com/coding/v1/messages', modelId: 'kimi-for-coding',
};
await mkdir(resolve('.tmp'), { recursive: true });
const root = await mkdtemp(join(resolve('.tmp'), 'native-tools-'));
let runtime: ProjectRuntime | undefined;
let success = false;
// Covers setup and code ignoring abort; only this process's fixture is removed.
const watchdog = setTimeout(() => {
  runtime?.close();
  void rm(root, { recursive: true, force: true }).finally(() => { console.error('Native tool acceptance exceeded its process deadline.'); process.exit(1); });
}, 60_000);
try {
  runtime = ProjectRuntime.create(root, { name: 'Synthetic bounded native tool acceptance', agentService: { runLimits: limits } });
  runtime.agent.configure({ providerId: 'kimi-coding', modelId: limits.modelId, baseUrl: '', apiKeyEnv: 'KIMI_API_KEY', thinkingLevel: 'off' });
  assert.equal(runtime.agent.getConfig().baseUrl, undefined);
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = runtime.createDocument({ name: 'Synthetic red square' });
  runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'node.insert', node: {
    id: 'red-square', kind: 'shape', parentId: document.pages[0]!.id,
    geometry: { x: 200, y: 150, width: 350, height: 350, rotation: 0 }, style: { fill: '#FF0000' }, locked: false, hidden: false,
  } }]));
  const session = await runtime.agent.createSession();
  const accepted = await runtime.agent.send(session.sessionId, 'Call document_read exactly once for the current document, then describe the shape and color briefly. Do not call other tools.', { documentId: document.documentId });
  await runtime.agent.waitForIdle(session.sessionId);
  const run = runtime.agent.getRun(accepted.runId)!;
  assert.equal(run.status, 'completed', 'Bounded native tool run did not complete.');
  assert.equal(run.budgetUsage?.toolCalls, 1);
  assert.equal(runtime.readDocument(document.documentId).revision, 1);
  const messages = await runtime.agent.getMessages(session.sessionId);
  const assistant = messages.findLast(message => message.role === 'assistant');
  assert.equal(assistant?.api, 'anthropic-messages');
  assert.equal(assistant.model, limits.modelId);
  const result = { protocol: assistant.api, model: assistant.model, limits, usage: run.budgetUsage, documentUnchanged: true };
  await writeFile(join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  success = true;
} catch {
  console.error('Bounded native tool acceptance failed. No retry was attempted.'); process.exitCode = 1;
} finally {
  runtime?.close();
  if (!success) await rm(root, { recursive: true, force: true });
  clearTimeout(watchdog);
}
