import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { CommandEnvelope } from '@oeydesign/document';
import { KernelError } from '@oeydesign/document';
import { ProjectAssets, ProjectRuntime, RuntimeError } from '@oeydesign/runtime';
import type { ProjectEvent, CommandOptions } from '@oeydesign/runtime';
import { renderDeckSvg, exportDeckPptx, exportDeckPdf, renderDeckPng } from '@oeydesign/media';
import { registerAgentRoutes } from './agent-routes.ts';

export interface WebHostOptions {
  staticRoot?: string;
  /** Exact additional origins for the separate Vite development server. */
  developmentOrigins?: string[];
}

const human = { actorId: 'local-user', actorKind: 'human' as const };

export async function createWebHost(runtime: ProjectRuntime, options: WebHostOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const streams = new Set<ServerResponse>();
  const assets = new ProjectAssets(runtime);
  registerAgentRoutes(app, runtime, streams);
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
  app.get('/api/assets', () => ({ assets: assets.list() }));
  app.get('/api/exports', () => ({ exports: runtime.listRecords('exports').map(record => record.value) }));
  app.get<{ Params: { id: string } }>('/api/exports/:id', async (request, reply) => {
    const result = runtime.getRecord<{ filename: string; format: string }>('exports', request.params.id);
    if (!result || basename(result.filename) !== result.filename) throw new RuntimeError('not_found', 'Export not found.');
    const mime: Record<string, string> = { pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf', png: 'image/png' };
    return reply.type(mime[result.format] ?? 'application/octet-stream').header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(await readFile(join(runtime.root, 'exports', result.filename)));
  });
  app.post<{ Body: { name: string; base64: string; kind?: string } }>('/api/assets', { bodyLimit: 29 * 1024 * 1024 }, async request => {
    const body = request.body;
    if (typeof body?.name !== 'string' || typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new RuntimeError('invalid', 'Expected an asset name and base64 bytes.');
    const bytes = Buffer.from(body.base64, 'base64');
    return { asset: body.kind === 'reference' ? await assets.importReference(bytes, body.name) : await assets.importImage(bytes, body.name) };
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const { asset, bytes } = await assets.read(request.params.id);
    reply.header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'");
    if (asset.kind === 'reference') reply.header('Content-Disposition', 'attachment');
    return reply.type(asset.mimeType).send(Buffer.from(bytes));
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
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>('/api/documents/:id/preview.svg', async (request, reply) => {
    const document = runtime.readDocument(request.params.id);
    return reply.type('image/svg+xml').header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
      .header('X-Document-Revision', document.revision).send(await renderDeckSvg(document, request.query.page, assets.resolve));
  });
  app.get<{ Params: { id: string } }>('/api/documents/:id/export.pptx', async (request, reply) => {
    const document = runtime.readDocument(request.params.id);
    const file = await exportDeckPptx(document, assets.resolve);
    return reply.type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('Content-Disposition', `attachment; filename="deck-r${document.revision}.pptx"`)
      .header('X-Document-Revision', document.revision).send(Buffer.from(file));
  });
  for (const format of ['pdf', 'png'] as const) app.get<{ Params: { id: string } }>(`/api/documents/:id/export.${format}`, async (request, reply) => {
    const document = runtime.readDocument(request.params.id);
    const controller = new AbortController();
    const stop = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once('close', stop);
    try {
      const bytes = format === 'pdf' ? await exportDeckPdf(document, assets.resolve, { signal: controller.signal }) : await renderDeckPng(document, undefined, assets.resolve, { signal: controller.signal });
      return reply.type(format === 'pdf' ? 'application/pdf' : 'image/png').header('Content-Disposition', `attachment; filename="deck-r${document.revision}.${format}"`)
        .header('X-Document-Revision', document.revision).send(Buffer.from(bytes));
    } finally { reply.raw.removeListener('close', stop); }
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
