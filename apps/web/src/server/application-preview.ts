import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebProjectBuild } from '@oeydesign/media';

/** A loopback origin serving only an immutable build, never project APIs or files. */
export async function startApplicationPreview(build: WebProjectBuild, routes: string[]) {
  const contentTypes: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2' };
  const server = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'");
    response.setHeader('Access-Control-Allow-Origin', '*'); // Module assets for the opaque sandbox origin.
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
    let path: string;
    try { path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    const file = routes.includes(path.replace(/\/$/, '') || '/') ? 'index.html' : path.slice(1);
    const bytes = Object.hasOwn(build.files, file) ? build.files[file] : undefined;
    if (!bytes) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', contentTypes[file.split('.').at(-1)!] ?? 'application/octet-stream');
    response.writeHead(200).end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    clearTimeout(timer); server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  };
  const timer = setTimeout(() => { void close(); }, 30 * 60_000); timer.unref();
  return { url, close };
}
