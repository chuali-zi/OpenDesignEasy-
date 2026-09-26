import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ProjectRuntime, ProjectAssets, createDesignServices } from '@oeydesign/runtime';

// Opt-in acceptance: uses the project's explicitly configured provider; never part of npm test.
process.loadEnvFile(resolve('.env'));
const root = resolve(process.argv[2] ?? `.tmp/r3-real-${Date.now()}`);
let runtime = ProjectRuntime.create(root, { name: 'R3 actual provider acceptance' });
const configure = () => {
  runtime.agent.configure({ providerId: 'oey-compatible', modelId: process.env.MODEL, baseUrl: process.env.BASE_URL, apiKeyEnv: 'API_KEY', api: 'openai-completions', thinkingLevel: 'low', maxTokens: 8192, contextWindow: 262144 });
  runtime.agent.configureTools(createDesignServices(runtime));
};
configure();
const stages: Record<string, unknown>[] = [];
try {
  const document = runtime.createDocument({ name: '共同创作 / 城市阅读计划' });
  const assets = new ProjectAssets(runtime);
  const brief = await assets.importReference(Buffer.from('城市阅读计划：目标受众为社区居民。核心主张：每周一起读一本书。试点数据：4月12人、5月24人、6月38人。不要补充未经给出的成果或统计。设计倾向：留白、深绿与米色、中文可读。'), 'brief.md');
  const session = await runtime.agent.createSession({ title: '真实模型共同编辑' });
  const sessionId = session.sessionId;
  const wait = async () => {
    const timeout = setTimeout(() => { void runtime.agent.cancel(sessionId).catch(() => {}); }, 180000);
    try { await runtime.agent.waitForIdle(sessionId); } finally { clearTimeout(timeout); }
    const run = runtime.agent.listRuns(sessionId).at(-1)!;
    assert.ok(['completed', 'waiting_input'].includes(run.status), `Run ended ${run.status}: ${run.error ?? ''}`);
    return run;
  };
  const run = async (text: string, assetIds?: string[]) => {
    const accepted = await runtime.agent.send(sessionId, text, { documentId: document.documentId, assetIds });
    console.log(JSON.stringify({ stage: 'accepted', runId: accepted.runId }));
    await wait();
  };
  await run('请先读取参考资料并用三句话讨论叙事方向。现在只讨论，不要修改任何文档。', [brief.id]);
  assert.equal(runtime.readDeckDocument(document.documentId).revision, 0);
  stages.push({ stage: 'discussion', unchanged: true });
  console.log(JSON.stringify(stages.at(-1)));
  await run(`方向确认。请在文档 ${document.documentId} 中直接制作总计三页的可编辑演示，使用现有空白页作为第一页。每页至少两个真实节点：第1页标题与说明，第2页社区活动安排表格，第3页按参考资料中的人数做原生柱状图和结论标题。先读取文档/工具结构；不要创建另一个文档，不要提问，不要生成图片。保留中文可读字号，完成后读回检查。`);
  let current = runtime.readDeckDocument(document.documentId);
  assert.equal(current.pages.length, 3);
  assert.ok(Object.values(current.nodes).some(node => node.kind === 'table'));
  assert.ok(Object.values(current.nodes).some(node => node.kind === 'chart'));
  stages.push({ stage: 'create-three-pages', revision: current.revision, nodes: Object.keys(current.nodes).length });
  console.log(JSON.stringify(stages.at(-1)));
  const title = Object.values(current.nodes).find(node => node.kind === 'text')!;
  runtime.submit(runtime.makeCommand(document.documentId, [{ type: 'geometry.update', nodeId: title.id, geometry: { x: 87, y: 91 } }], { actorId: 'human-acceptance', label: '人工调整标题位置' }));
  runtime.agent.setSelection(sessionId, { documentId: document.documentId, nodeIds: [title.id] });
  await run('我刚手动调整了选中的标题。读取最新状态，保持已有三页和所有节点不变，沿用设计只扩展第四页作为下一步行动，至少两个可编辑文字对象。');
  current = runtime.readDeckDocument(document.documentId);
  assert.equal(current.pages.length, 4);
  assert.equal(current.nodes[title.id]!.geometry.x, 87);
  assert.equal(current.nodes[title.id]!.geometry.y, 91);
  stages.push({ stage: 'respect-human-edit', revision: current.revision, titleId: title.id });
  console.log(JSON.stringify(stages.at(-1)));
  await run('请使用 user_ask 让我选择“方案 A”或“方案 B”，本轮只提问，不改作品。收到答案以后只简短确认选择，也不要改作品。');
  const question = runtime.agent.listQuestions(sessionId).find(item => item.status === 'pending');
  assert.ok(question);
  const revisionBeforeAnswer = runtime.readDeckDocument(document.documentId).revision;
  runtime.close();
  runtime = ProjectRuntime.open(root);
  runtime.agent.configureTools(createDesignServices(runtime));
  assert.equal(runtime.agent.getConfig().modelId, process.env.MODEL);
  assert.equal(runtime.agent.listQuestions(sessionId).find(item => item.questionId === question.questionId)?.status, 'pending');
  await runtime.agent.answer(sessionId, question.questionId, question.options[0] ?? '方案 A');
  await wait();
  assert.equal(runtime.readDeckDocument(document.documentId).revision, revisionBeforeAnswer);
  stages.push({ stage: 'question-restart-answer', recovered: true, messages: (await runtime.agent.getMessages(sessionId)).length });
  console.log(JSON.stringify(stages.at(-1)));
  const services = createDesignServices(runtime);
  const preview = await services.preview({ documentId: document.documentId }, new AbortController().signal);
  await writeFile(join(root, 'exports', 'agent-result.png'), Buffer.from(preview.data, 'base64'));
  const exported = await services.exportArtifact({ documentId: document.documentId, format: 'pptx' }, new AbortController().signal);
  const result = { root, sessionId, documentId: document.documentId, stages, exported };
  await writeFile(join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { runtime.close(); }
