import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDesignServices, ProjectRuntime, RuntimeError } from '@oeydesign/runtime';

export async function executeAgent(argv: string[]): Promise<unknown> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    text: { type: 'string' }, title: { type: 'string' }, session: { type: 'string' }, question: { type: 'string' },
    host: { type: 'string' }, file: { type: 'string' }, document: { type: 'string' }, input: { type: 'string' },
    asset: { type: 'string', multiple: true }, wait: { type: 'boolean', default: false },
  } });
  const [action, directory] = positionals;
  if (!action || (!directory && !values.host)) throw new RuntimeError('invalid', 'Use agent <action> <project> or --host http://127.0.0.1:4318.');
  const text = values.text;
  const requireText = () => { if (!text?.trim()) throw new RuntimeError('invalid', '--text is required.'); return text; };
  const requireSession = () => { if (!values.session) throw new RuntimeError('invalid', '--session is required.'); return values.session; };
  const options = { inputId: values.input, assetIds: values.asset, documentId: values.document };
  if (values.host) {
    const base = new URL(values.host);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new RuntimeError('invalid', '--host must identify a local project owner.');
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const data = await response.json() as Record<string, any>;
      if (!response.ok) throw new RuntimeError('invalid', data.error?.message ?? `HTTP ${response.status}`);
      return data;
    };
    if (action === 'list') return request('/api/agent/sessions');
    if (action === 'config') return request('/api/agent/config', values.file ? JSON.parse(await readFile(values.file, 'utf8')) : undefined);
    if (action === 'create') return request('/api/agent/sessions', { title: values.title });
    let sessionId = values.session;
    if (!sessionId && action === 'run') sessionId = (await request('/api/agent/sessions', { title: values.title })).session.sessionId;
    if (!sessionId) sessionId = requireSession();
    const prefix = `/api/agent/sessions/${encodeURIComponent(sessionId)}`;
    if (action === 'status') return request(prefix);
    if (action === 'cancel') return request(`${prefix}/cancel`, {});
    if (action === 'compact') return request(`${prefix}/compact`, {});
    if (!['run', 'send', 'steer', 'follow-up', 'answer'].includes(action)) throw new RuntimeError('invalid', 'Unknown agent action.');
    const accepted = await request(`${prefix}/inputs`, { ...options, text: requireText(), mode: action === 'follow-up' ? 'follow_up' : action === 'run' || action === 'send' ? 'message' : action, questionId: values.question });
    if (!values.wait && action !== 'run') return { sessionId, ...accepted };
    while (true) {
      const state = await request(prefix);
      if (state.session.status !== 'running') return { ...accepted, ...state };
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  const runtime = ProjectRuntime.open(directory!);
  runtime.agent.configureTools(createDesignServices(runtime));
  const agent = runtime.agent;
  let activeSession: string | undefined;
  const interrupt = () => { if (activeSession) void agent.cancel(activeSession); };
  process.once('SIGINT', interrupt);
  try {
    if (action === 'list') return { sessions: agent.listSessions() };
    if (action === 'config') {
      if (values.file) agent.configure(JSON.parse(await readFile(values.file, 'utf8')));
      return agent.getConfig();
    }
    if (action === 'create') return { session: await agent.createSession({ title: values.title }) };
    const sessionId = values.session ?? (action === 'run' ? (await agent.createSession({ title: values.title })).sessionId : requireSession());
    activeSession = sessionId;
    if (action === 'cancel') return agent.cancel(sessionId);
    if (action === 'compact') { await agent.compact(sessionId); return { ok: true, sessionId }; }
    if (action !== 'status') {
      if (action === 'run' || action === 'send') await agent.send(sessionId, requireText(), options);
      else if (action === 'steer') await agent.steer(sessionId, requireText(), options);
      else if (action === 'follow-up') await agent.followUp(sessionId, requireText(), options);
      else if (action === 'answer') {
        if (!values.question) throw new RuntimeError('invalid', '--question is required.');
        await agent.answer(sessionId, values.question, requireText(), options);
      } else throw new RuntimeError('invalid', 'Unknown agent action.');
      // Standalone CLI owns this runtime; keep it alive until completion or a durable question.
      await agent.waitForIdle(sessionId);
    }
    return { session: agent.getSession(sessionId), runs: agent.listRuns(sessionId), inputs: agent.listInputs(sessionId), questions: agent.listQuestions(sessionId), messages: await agent.getMessages(sessionId) };
  } finally { process.removeListener('SIGINT', interrupt); runtime.close(); }
}
