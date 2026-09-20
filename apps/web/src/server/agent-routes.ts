import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { ProjectRuntime, RuntimeError } from '@oeydesign/runtime';

export function registerAgentRoutes(app: FastifyInstance, runtime: ProjectRuntime, streams: Set<ServerResponse>) {
  const agent = runtime.agent;
  app.get('/api/agent/config', () => agent.getConfig());
  app.post<{ Body: Parameters<typeof agent.configure>[0] }>('/api/agent/config', request => {
    agent.configure(request.body);
    return agent.getConfig();
  });
  app.get('/api/agent/sessions', () => ({ sessions: agent.listSessions() }));
  app.post<{ Body: { title?: string } }>('/api/agent/sessions', async request => ({ session: await agent.createSession({ title: request.body?.title }) }));
  app.get<{ Params: { id: string } }>('/api/agent/sessions/:id', async request => {
    const id = request.params.id;
    const session = agent.getSession(id);
    if (!session) throw new RuntimeError('not_found', 'Agent session does not exist.');
    return { session, runs: agent.listRuns(id), inputs: agent.listInputs(id), questions: agent.listQuestions(id), messages: await agent.getMessages(id) };
  });
  app.post<{ Params: { id: string }; Body: { text: string; mode?: string; inputId?: string; documentId?: string; questionId?: string; assetIds?: string[] } }>('/api/agent/sessions/:id/inputs', async request => {
    const { text, mode, inputId, documentId, questionId, assetIds } = request.body ?? {};
    if (typeof text !== 'string' || !text.trim()) throw new RuntimeError('invalid', 'Input text must not be empty.');
    const id = request.params.id;
    if (mode === 'answer') {
      if (!questionId) throw new RuntimeError('invalid', 'An answer requires its question ID.');
      return agent.answer(id, questionId, text, { inputId, assetIds });
    }
    if (mode === 'steer') return agent.steer(id, text, { inputId, assetIds });
    if (mode === 'follow_up') return agent.followUp(id, text, { inputId, assetIds });
    if (mode && mode !== 'message') throw new RuntimeError('invalid', 'Unknown input mode.');
    return agent.send(id, text, { inputId, documentId, assetIds });
  });
  app.post<{ Params: { id: string }; Body: { runId?: string } }>('/api/agent/sessions/:id/cancel', request => agent.cancel(request.params.id, request.body?.runId));
  app.post<{ Params: { id: string } }>('/api/agent/sessions/:id/compact', async request => { await agent.compact(request.params.id); return { ok: true }; });
  app.post<{ Params: { id: string }; Body: { documentId: string; nodeIds: string[] } }>('/api/agent/sessions/:id/selection', request => {
    agent.setSelection(request.params.id, request.body);
    return { ok: true };
  });
  app.get('/api/agent/events', (_request, reply) => {
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    streams.add(stream);
    const unsubscribe = agent.subscribe(event => { if (!stream.destroyed && !stream.writableEnded) stream.write(`data: ${JSON.stringify(event)}\n\n`); });
    stream.write(': connected\n\n');
    const heartbeat = setInterval(() => { if (!stream.destroyed) stream.write(': heartbeat\n\n'); }, 15000);
    heartbeat.unref();
    stream.on('close', () => { clearInterval(heartbeat); unsubscribe(); streams.delete(stream); });
  });
}
