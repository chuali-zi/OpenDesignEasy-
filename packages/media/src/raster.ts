import { chromium } from "playwright";
import { validateDocument } from "@oeydesign/document";
import type { DeckDocument } from "@oeydesign/document";
import type { AssetResolver } from "./assets.ts";
import { renderDeckSvg } from "./index.ts";

export type RenderOptions = { signal?: AbortSignal };

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "Media rendering was aborted.");
  error.name = "AbortError";
  return error;
}

async function withChrome<T>(options: RenderOptions, render: (browser: Awaited<ReturnType<typeof chromium.launch>>) => Promise<T>): Promise<T> {
  if (options.signal?.aborted) throw abortError(options.signal);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const onAbort = () => { void browser.close(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw abortError(options.signal);
    return await render(browser);
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (browser.isConnected()) await browser.close();
  }
}

export async function renderDeckPng(document: DeckDocument, pageId = document.pages[0]?.id, resolveAsset?: AssetResolver, options: RenderOptions = {}): Promise<Uint8Array> {
  validateDocument(document);
  const pageModel = document.pages.find(page => page.id === pageId);
  if (!pageModel) throw new Error(`Page ${pageId} does not exist.`);
  const svg = await renderDeckSvg(document, pageModel.id, resolveAsset);
  return withChrome(options, async browser => {
    const page = await browser.newPage({ viewport: { width: Math.ceil(pageModel.width), height: Math.ceil(pageModel.height) }, deviceScaleFactor: 1 });
    try {
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;width:${pageModel.width}px;height:${pageModel.height}px;overflow:hidden}svg{display:block;width:${pageModel.width}px;height:${pageModel.height}px}</style></head><body>${svg}</body></html>`, { waitUntil: "load" });
      await page.evaluate(async () => {
        const pageDocument = window.document;
        await pageDocument.fonts.ready;
        await Promise.all(Array.from(pageDocument.images, image => image.decode().catch(() => undefined)));
      });
      return new Uint8Array(await page.screenshot({ type: "png", fullPage: false }));
    } finally {
      await page.close();
    }
  });
}

function pdfHtml(pages: Array<{ svg: string; width: number; height: number }>): string {
  const pageRules = pages.map((page, index) => `@page deck${index} { size: ${page.width}px ${page.height}px; margin: 0; }`).join("\n");
  const sections = pages.map((page, index) => `<section class="deck-page page-${index}" style="width:${page.width}px;height:${page.height}px">${page.svg}</section>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageRules}\nhtml,body{margin:0;padding:0}.deck-page{page:deck0;break-after:page;overflow:hidden;display:block}.deck-page:last-child{break-after:auto}.deck-page svg{display:block;width:100%;height:100%}${pages.map((_page, index) => `.page-${index}{page:deck${index}}`).join("")}</style></head><body>${sections}</body></html>`;
}

export async function exportDeckPdf(document: DeckDocument, resolveAsset?: AssetResolver, options: RenderOptions = {}): Promise<Uint8Array> {
  validateDocument(document);
  const rendered = await Promise.all(document.pages.map(async page => ({
    svg: await renderDeckSvg(document, page.id, resolveAsset), width: page.width, height: page.height,
  })));
  const html = pdfHtml(rendered);
  return withChrome(options, async browser => {
    const page = await browser.newPage({ viewport: { width: Math.max(...document.pages.map(item => Math.ceil(item.width))), height: Math.max(...document.pages.map(item => Math.ceil(item.height))) } });
    try {
      await page.setContent(html, { waitUntil: "load" });
      const bytes = await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, tagged: true });
      return new Uint8Array(bytes);
    } finally {
      await page.close();
    }
  });
}
