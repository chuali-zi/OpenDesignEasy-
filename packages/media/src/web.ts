import JSZip from 'jszip';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { validateWebDocument } from '@oeydesign/document';
import type { WebDocument, WebNode } from '@oeydesign/document';
import type { AssetResolver } from './assets.ts';
import { escapeWebText, renderWebMarkup, renderWebStyles, webNativeProps, webNativeTag, webVoidTags } from './web-markup.ts';

export type WebRenderOptions = { signal?: AbortSignal; width?: number; height?: number; pageId?: string };
type PageUrl = (page: WebDocument['pages'][number]) => string;

function pagePath(route: string): string {
  return route === '/' ? 'index.html' : `${route.slice(1).replace(/\/$/, '')}/index.html`;
}

function imageAssets(document: WebDocument) {
  return Array.isArray(document.assets) ? document.assets : Object.values(document.assets ?? {});
}

async function imageUrls(document: WebDocument, resolveAsset?: AssetResolver): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const node of Object.values(document.nodes)) {
    const id = node.props?.assetId;
    if (typeof id !== 'string' || urls[id]) continue;
    const asset = imageAssets(document).find(item => item.id === id);
    if (!asset || !resolveAsset) throw new Error(`Cannot render image ${id}: register its metadata and provide an asset resolver.`);
    const bytes = await resolveAsset(id);
    if (!bytes?.length) throw new Error(`Asset ${id} contains no image bytes.`);
    urls[id] = `data:${asset.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  return urls;
}

export async function renderWebHtml(document: WebDocument, pageId = document.pages[0]?.id, resolveAsset?: AssetResolver, options: { pageUrl?: PageUrl } = {}): Promise<string> {
  validateWebDocument(document);
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error(`Page ${pageId} does not exist.`);
  const depth = pagePath(page.route).split('/').length - 1;
  const pageUrl: PageUrl = options.pageUrl ?? (destination => '../'.repeat(depth) + pagePath(destination.route));
  const body = renderWebMarkup(document, page.id, await imageUrls(document, resolveAsset), { pageUrl });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>${escapeWebText(page.name)}</title><style>${renderWebStyles(document)}</style></head>
<body data-oey-document-id="${escapeWebText(document.documentId)}" data-oey-revision="${document.revision}">${body}</body></html>`;
}

function metadata(document: WebDocument, format: string): string {
  return JSON.stringify({ documentId: document.documentId, revision: document.revision, format }, null, 2);
}

export async function exportWebZip(document: WebDocument, resolveAsset?: AssetResolver): Promise<Uint8Array> {
  validateWebDocument(document);
  const zip = new JSZip();
  for (const page of document.pages) zip.file(pagePath(page.route), await renderWebHtml(document, page.id, resolveAsset));
  zip.file('oey-document.json', JSON.stringify(document, null, 2));
  zip.file('oey-metadata.json', metadata(document, 'web-static'));
  return zip.generateAsync({ type: 'uint8array' });
}

/** Produce a self-contained, readable React/Vite project from one committed document. */
export async function buildWebSource(document: WebDocument, resolveAsset?: AssetResolver): Promise<Record<string, string | Uint8Array>> {
  validateWebDocument(document);
  const files: Record<string, string | Uint8Array> = {
    'package.json': JSON.stringify({ name: 'oey-web-design', version: '1.0.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { react: '19.3.0', 'react-dom': '19.3.0' }, devDependencies: { vite: '7.3.6', typescript: '5.9.3' } }, null, 2),
    'index.html': `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeWebText(document.name)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
    'vite.config.ts': `import { defineConfig } from 'vite';\nexport default defineConfig({ esbuild: { jsx: 'automatic' }, build: { target: 'es2022' } });\n`,
    'src/main.tsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './style.css';\ncreateRoot(document.getElementById('root')!).render(<App />);\n`,
    'src/style.css': renderWebStyles(document),
    'oey-document.json': JSON.stringify(document, null, 2),
    'oey-metadata.json': metadata(document, 'web-source'),
    'README.md': '# Exported Web design\n\nRun `npm install` and `npm run build`. Run `npm run dev` for local development. Serve `dist` with an SPA fallback to `index.html` for page routes.\n\nThe snapshot in `oey-document.json` records the editable source revision.\n',
  };
  const reserved = new Set([...Object.keys(files), 'src/App.tsx'].map(path => path.toLowerCase()));
  for (const module of document.sourceModules ?? []) {
    const path = `src/${module.path}`;
    if (reserved.has(path.toLowerCase())) throw new Error(`Source module collides with a generated source path: ${module.path}`);
    reserved.add(path.toLowerCase());
    files[path] = module.source;
  }
  const urls: Record<string, string> = {};
  const usedFilenames = new Set<string>();
  const referenced = new Set(Object.values(document.nodes).map(node => node.props?.assetId).filter((id): id is string => typeof id === 'string'));
  for (const id of referenced) {
    if (!imageAssets(document).some(asset => asset.id === id) || !resolveAsset) throw new Error(`Cannot package referenced image ${id}.`);
    const filename = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (usedFilenames.has(filename.toLowerCase())) throw new Error(`Image asset filenames collide for ${id}.`);
    usedFilenames.add(filename.toLowerCase());
    const bytes = await resolveAsset(id);
    if (!bytes?.length) throw new Error(`Asset ${id} contains no image bytes.`);
    files[`public/assets/${filename}`] = bytes;
    urls[id] = `/assets/${encodeURIComponent(filename)}`;
  }
  const imports = [`import React from 'react';`];
  const bindings = new Map<string, string>();
  for (const node of Object.values(document.nodes)) {
    if (!node.component) continue;
    const module = document.sourceModules?.find(item => item.id === node.component!.moduleId);
    if (!module || module.language === 'css') throw new Error(`Node ${node.id} has no renderable component module.`);
    const name = `OeyComponent${bindings.size}`;
    const path = `./${module.path.replace(/\.tsx?$/, '')}`;
    imports.push(node.component.exportName === 'default' ? `import ${name} from ${JSON.stringify(path)};` : `import { ${node.component.exportName} as ${name} } from ${JSON.stringify(path)};`);
    bindings.set(node.id, name);
  }
  const emit = (id: string, indent = '    '): string => {
    const node = document.nodes[id]!;
    if (node.hidden) return '';
    const tag = webNativeTag(node);
    const identity = { 'data-oey-node-id': id, 'data-web-id': id };
    const props: Record<string, unknown> = node.component ? identity : { ...webNativeProps(node, urls), ...identity };
    if (props.class !== undefined) { props.className = props.class; delete props.class; }
    if (props.for !== undefined) { props.htmlFor = props.for; delete props.for; }
    if (['input', 'textarea', 'select'].includes(tag)) {
      if (props.value !== undefined) { props.defaultValue = props.value; delete props.value; }
      if (props.checked !== undefined) { props.defaultChecked = props.checked; delete props.checked; }
    }
    if (tag === 'textarea' && node.text !== undefined) props.defaultValue = node.text;
    const attrs = `{...${JSON.stringify(props)}}`;
    if (webVoidTags.has(tag)) return `${indent}<${tag} ${attrs} />`;
    let children = [node.text !== undefined && tag !== 'textarea' ? `${indent}  {${JSON.stringify(node.text)}}` : '', ...node.children.map(child => emit(child, `${indent}  `))].filter(Boolean).join('\n');
    const bound = bindings.get(id);
    if (bound) children = `${indent}  <${bound} {...${JSON.stringify(node.props ?? {})}}>\n${children}\n${indent}  </${bound}>`;
    const behavior = tag === 'form' ? ' onSubmit={event => { event.preventDefault(); const status = event.currentTarget.querySelector<HTMLOutputElement>("[data-oey-form-status]"); if (status) status.hidden = false; }}' : '';
    if (tag === 'form') children += `\n${indent}  <output data-oey-form-status hidden>Demo submitted</output>`;
    return `${indent}<${tag} ${attrs}${behavior}>\n${children}\n${indent}</${tag}>`;
  };
  const routes = document.pages.map(page => `  if (route === ${JSON.stringify(page.route.replace(/\/$/, '') || '/')}) return (\n${emit(page.rootId)}\n  );`).join('\n');
  files['src/App.tsx'] = `${imports.join('\n')}\n\nexport default function App() {\n  const route = window.location.pathname.replace(/\\/$/, '') || '/';\n${routes}\n  return <main><h1>Page not found</h1><a href="/">Home</a></main>;\n}\n`;
  return files;
}

export async function exportWebSourceZip(document: WebDocument, resolveAsset?: AssetResolver): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(await buildWebSource(document, resolveAsset))) zip.file(path, contents);
  return zip.generateAsync({ type: 'uint8array' });
}

async function withBrowser<T>(options: WebRenderOptions, render: (browser: Awaited<ReturnType<typeof chromium.launch>>) => Promise<T>): Promise<T> {
  options.signal?.throwIfAborted();
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  const abort = () => { void browser.close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try { options.signal?.throwIfAborted(); return await render(browser); }
  catch (error) { options.signal?.throwIfAborted(); throw error; }
  finally { options.signal?.removeEventListener('abort', abort); if (browser.isConnected()) await browser.close(); }
}

async function ready(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, image => image.decode())); });
}

export async function renderWebPng(document: WebDocument, pageId = document.pages[0]?.id, resolveAsset?: AssetResolver, options: WebRenderOptions = {}): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const html = await renderWebHtml(document, pageId, resolveAsset);
  return withBrowser(options, async browser => {
    const page = await browser.newPage({ viewport: { width: options.width ?? 1280, height: options.height ?? 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    await ready(page);
    return new Uint8Array(await page.screenshot({ type: 'png', fullPage: true }));
  });
}

export async function exportWebPdf(document: WebDocument, resolveAsset?: AssetResolver, options: WebRenderOptions = {}): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  validateWebDocument(document);
  const urls = await imageUrls(document, resolveAsset);
  const sections = document.pages.map(page => `<section class="oey-print-page">${renderWebMarkup(document, page.id, urls)}</section>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${renderWebStyles(document)}\n@page{size:A4;margin:16mm}.oey-print-page{break-after:page}.oey-print-page:last-child{break-after:auto}</style></head><body>${sections}</body></html>`;
  return withBrowser(options, async browser => {
    const page = await browser.newPage({ viewport: { width: options.width ?? 1280, height: options.height ?? 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    await ready(page);
    return new Uint8Array(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true }));
  });
}
