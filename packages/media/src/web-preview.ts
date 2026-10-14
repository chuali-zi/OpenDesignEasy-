import { chromium } from 'playwright';
import type { WebDocument } from '@oeydesign/document';
import type { AssetResolver } from './assets.ts';
import { buildWebProject } from './web-build.ts';
import { renderWebHtml, type WebRenderOptions } from './web.ts';

const contentTypes: Record<string, string> = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
};

/** Render managed React components using the same production builder as the UI preview. */
export async function renderWebPreviewPng(document: WebDocument, pageId = document.pages[0]?.id, resolveAsset?: AssetResolver, options: WebRenderOptions = {}): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const pageModel = document.pages.find(page => page.id === pageId);
  if (!pageModel) throw new Error(`Web page ${pageId} does not exist.`);
  const hasComponents = Object.values(document.nodes).some(node => node.component);
  const build = hasComponents ? await buildWebProject(document, resolveAsset, options) : undefined;
  const html = build ? undefined : await renderWebHtml(document, pageId, resolveAsset);
  options.signal?.throwIfAborted();
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  const abort = () => { void browser.close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    const page = await browser.newPage({ viewport: { width: options.width ?? 1280, height: options.height ?? 900 }, serviceWorkers: 'block' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Serve the in-memory build through interception; no Web host or external requests.
    const origin = 'http://oey-preview.invalid';
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!build || url.origin !== origin) return route.abort();
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const isPage = document.pages.some(item => item.route.replace(/\/$/, '') === url.pathname.replace(/\/$/, ''));
      const filename = Object.hasOwn(build.files, path) ? path : isPage ? 'index.html' : '';
      const bytes = build.files[filename];
      if (!bytes) return route.fulfill({ status: 404, body: 'Not found' });
      await route.fulfill({ contentType: contentTypes[filename.split('.').at(-1)!] ?? 'application/octet-stream', body: Buffer.from(bytes) });
    });
    if (build) {
      await page.goto(`${origin}${pageModel.route}`, { waitUntil: 'load' });
      await page.waitForFunction(() => (window.document.getElementById('root')?.childElementCount ?? 0) > 0, undefined, { timeout: 15_000 });
    } else await page.setContent(html!, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await window.document.fonts.ready;
      await Promise.all(Array.from(window.document.images, image => image.decode()));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    if (errors.length) throw new Error(`React preview failed: ${errors.join('; ')}`);
    // Keep the actual viewport width even when content overflows horizontally.
    const height = Math.max(options.height ?? 900, await page.evaluate(() => window.document.documentElement.scrollHeight));
    return new Uint8Array(await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: options.width ?? 1280, height } }));
  } catch (error) {
    options.signal?.throwIfAborted();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}
