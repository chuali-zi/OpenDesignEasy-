import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ServerResponse } from 'node:http';
import type { CommandEnvelope } from '@oeydesign/document';
import { KernelError } from '@oeydesign/document';
import { ProjectRuntime, RuntimeError } from '@oeydesign/runtime';
import type { ProjectEvent, CommandOptions } from '@oeydesign/runtime';
import { renderDeckSvg, exportDeckPptx } from '@oeydesign/media';

export interface WebHostOptions {
  staticRoot?: string;
  /** Exact additional origins for the separate Vite development server. */
  developmentOrigins?: string[];
}

const human = { actorId: 'local-user', actorKind: 'human' as const };

export async function createWebHost(runtime: ProjectRuntime, options: WebHostOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const streams = new Set<ServerResponse>();
  const statusCodes: Record<string, number> = { invalid: 400, conflict: 409, locked: 423, not_found: 404, busy: 409, cancelled: 409 };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof KernelError || error instanceof RuntimeError) {
      return reply.code(statusCodes[error.code] ?? 400).send({ error: { code: error.code, message: error.message, details: error.details,
        ...('target' in error ? { target: error.target } : {}), ...('revision' in error ? { revision: error.revision } : {}) } });
    }
    const failure = error as { statusCode?: number; message?: string };
    return reply.code(failure.statusCode ?? 500).send({ error: { code: failure.statusCode ? 'invalid' : 'internal_error', message: failure.message ?? 'Request failed.' } });
  });
  app.addHook('onRequest', async (request, reply) => {
    // The host is bound to loopback; do not let unrelated browser origins write projects.
    const origin = request.headers.origin;
    if (origin && origin !== `${request.protocol}://${request.headers.host}` && !options.developmentOrigins?.includes(origin)) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'This origin cannot access the local project.' } });
    }
  });

  app.get('/api/project', () => {
    const events = runtime.events();
    return { project: runtime.project, documents: runtime.listDocuments(), seq: events.at(-1)?.seq ?? 0 };
  });
  app.get<{ Params: { id: string } }>('/api/documents/:id', request => ({ document: runtime.readDocument(request.params.id) }));
  app.post<{ Body: { name?: string; commandId?: string } }>('/api/documents', request => {
    const body = request.body ?? {};
    if (body.name !== undefined && typeof body.name !== 'string') throw new RuntimeError('invalid', 'Document name must be text.');
    if (body.commandId !== undefined && (typeof body.commandId !== 'string' || !body.commandId)) throw new RuntimeError('invalid', 'commandId must be a non-empty string.');
    return { document: runtime.createDocument({ name: body.name }, { ...human, clientId: 'web', commandId: body.commandId }) };
  });
  app.post<{ Body: CommandEnvelope }>('/api/commands', request => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new RuntimeError('invalid', 'Expected a document command.');
    const command = { ...request.body, ...human };
    if (command.runId !== undefined) throw new RuntimeError('invalid', 'Browser commands cannot impersonate an agent run.');
    return { result: runtime.submit(command), document: runtime.readDocument(command.documentId) };
  });
  for (const direction of ['undo', 'redo'] as const) {
    app.post<{ Params: { id: string }; Body: CommandOptions }>(`/api/documents/:id/${direction}`, request => {
      const body = request.body ?? {};
      const result = runtime[direction](request.params.id, { ...human, clientId: 'web', commandId: body.commandId, baseRevision: body.baseRevision });
      return { result, document: runtime.readDocument(request.params.id) };
    });
  }
  app.get<{ Params: { id: string } }>('/api/documents/:id/versions', request => ({ versions: runtime.listVersions(request.params.id) }));
  app.post<{ Params: { id: string }; Body: { name: string } }>('/api/documents/:id/versions', request => {
    if (typeof request.body?.name !== 'string') throw new RuntimeError('invalid', 'Version name must be text.');
    return { version: runtime.createVersion(request.params.id, request.body.name) };
  });
  app.post<{ Params: { id: string }; Body: CommandOptions }>('/api/versions/:id/restore', request => {
    const body = request.body ?? {};
    const result = runtime.restoreVersion(request.params.id, { ...human, clientId: 'web', commandId: body.commandId, baseRevision: body.baseRevision });
    return { result, document: runtime.readDocument(result.documentId) };
  });
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>('/api/documents/:id/preview.svg', (request, reply) => {
    const document = runtime.readDocument(request.params.id);
    return reply.type('image/svg+xml').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      .header('X-Document-Revision', document.revision).send(renderDeckSvg(document, request.query.page));
  });
  app.get<{ Params: { id: string } }>('/api/documents/:id/export.pptx', async (request, reply) => {
    const document = runtime.readDocument(request.params.id);
    const file = await exportDeckPptx(document);
    return reply.type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('Content-Disposition', `attachment; filename="deck-r${document.revision}.pptx"`)
      .header('X-Document-Revision', document.revision).send(Buffer.from(file));
  });
  app.get<{ Querystring: { after?: string } }>('/api/events', (request, reply) => {
    const cursor = Number(request.headers['last-event-id'] ?? request.query.after ?? 0);
    const replay = runtime.events(cursor); // Validate before sending SSE headers.
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    streams.add(stream);
    const write = (event: ProjectEvent) => {
      if (!stream.destroyed && !stream.writableEnded) stream.write(`id: ${event.seq}\nevent: project\ndata: ${JSON.stringify(event)}\n\n`);
    };
    // Subscribe and replay synchronously, so no commit can fall between these steps.
    const unsubscribe = runtime.subscribe(write);
    for (const event of replay) write(event);
    stream.write(': connected\n\n');
    const heartbeat = setInterval(() => { if (!stream.destroyed) stream.write(': heartbeat\n\n'); }, 15_000);
    heartbeat.unref();
    stream.on('close', () => { clearInterval(heartbeat); unsubscribe(); streams.delete(stream); });
  });
  app.addHook('preClose', async () => { for (const stream of streams) stream.end(); });
  if (options.staticRoot) await app.register(fastifyStatic, { root: options.staticRoot });
  return app;
}
