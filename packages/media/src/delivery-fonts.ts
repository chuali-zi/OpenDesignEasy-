import { execFile } from 'node:child_process';
import { chromium } from 'playwright';
import type { EditableDocument } from '@oeydesign/document';
import type { AssetResolver } from './assets.ts';
import type { ArtifactFormat } from './artifact.ts';
import type { DeliveryFinding, DeliveryFonts, DeliveryFontRun, DeliveryRenderer } from './delivery.ts';
import { browserLaunchOptions } from './browser.ts';
import { renderDeckSvg } from './index.ts';
import { renderDocHtml, docPdfEngine } from './doc.ts';
import { renderWebHtml } from './web.ts';

const generic = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const normalize = (name: string) => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
export const fontFamilies = (value: string) => (value.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map(normalize);

/** Inventory is exact family-name/alias evidence, never fc-match's always-successful fallback. */
async function inventory(signal: AbortSignal): Promise<string[][] | undefined> {
  if (process.platform !== 'linux') return undefined;
  return new Promise(resolve => {
    execFile('fc-list', ['--format', '%{family}\n'], { signal, timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error || !stdout.trim() ? undefined : stdout.trim().split('\n').map(fontFamilies));
    });
  });
}

export function classifyFont(declared: string, actual: DeliveryFontRun['actual'], families?: string[][]): Pick<DeliveryFontRun, 'availability' | 'fallback'> {
  const names = fontFamilies(declared), first = names[0] ?? '';
  const aliases = families?.filter(group => group.includes(first)).flat() ?? [];
  const availability = generic.has(first) ? 'generic' : !families ? 'unknown' : families.some(group => group.includes(first)) ? 'available' : 'missing';
  // A generic family deliberately delegates selection. Named families can still fall back per script.
  const fallback = !generic.has(first) && actual.some(font => ![first, ...aliases].includes(normalize(font.family)));
  return { availability, fallback };
}

export function deliveryRenderer(document: EditableDocument, format: ArtifactFormat): DeliveryRenderer {
  const native = format === 'docx' || format === 'pptx';
  const engine = native ? format === 'docx' ? 'docx / OOXML' : 'PptxGenJS / OOXML'
    : format === 'pdf' || format === 'png' ? document.kind === 'doc' && format === 'pdf' && docPdfEngine() === 'libreoffice' ? 'LibreOffice' : 'Chromium'
    : format === 'build.zip' ? 'Vite / React' : 'OEY HTML / source';
  return { engine, phase: 'planned', platform: process.platform,
    detail: native ? '生成可编辑文件；此步骤不渲染文字。最终字体和分页由打开文件的 Word / PowerPoint 决定，尚未验证。'
      : engine === 'LibreOffice' ? '使用已配置的本地 DOCX→PDF 渲染器；不是 Microsoft Word。字体实测仅来自下方 Chromium 预览。'
      : engine === 'Chromium' ? '使用检查服务上的 Chromium 渲染；字体、换行和分页可能与用户浏览器或 Office 不同。'
      : '生成网页或源码；最终字体取决于打开它的浏览器、加载资源和设备。' };
}

/** Measure actual glyph families in the browser projection, offline, without executing managed code.
 * This is deliberately separate from Office/LibreOffice font usage and layout acceptance. */
export async function inspectDeliveryFonts(document: EditableDocument, resolve?: AssetResolver, signal?: AbortSignal): Promise<DeliveryFonts> {
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
  bounded.throwIfAborted();
  const families = await inventory(bounded);
  const result: DeliveryFonts = { platform: process.platform, inventory: families ? 'fontconfig' : 'unavailable', probe: 'not-run', complete: false, runs: [],
    detail: '仅检查服务宿主；不代表用户 Windows 已安装或缺少字体。字形实测来自当前文档的离线 Chromium 预览，不代表 Word / PowerPoint / LibreOffice 的实际用字。' };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => { void browser?.close(); };
  try {
    browser = await chromium.launch({ ...browserLaunchOptions(), timeout: 5000 });
    bounded.addEventListener('abort', abort, { once: true }); bounded.throwIfAborted();
    result.browserVersion = browser.version();
    const page = await browser.newPage({ javaScriptEnabled: false, viewport: document.kind === 'doc'
      ? { width: Math.ceil(document.pageSettings.width + 48), height: Math.ceil(document.pageSettings.height + 48) }
      : document.kind === 'deck' ? { width: Math.ceil(document.pages[0]!.width), height: Math.ceil(document.pages[0]!.height) } : { width: 1280, height: 900 } });
    await page.route('**/*', route => route.abort());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const pages = document.kind === 'doc' ? [undefined] : document.pages.map(item => item.id);
    result.complete = true;
    for (const pageId of pages) {
      bounded.throwIfAborted();
      if (result.runs.length >= 256) { result.complete = false; break; }
      const html = document.kind === 'doc' ? await renderDocHtml(document, resolve) : document.kind === 'deck'
        ? `<!doctype html><html><body style="margin:0">${await renderDeckSvg(document, pageId, resolve)}</body></html>` : await renderWebHtml(document, pageId, resolve);
      if (document.kind === 'deck') { const model = document.pages.find(item => item.id === pageId)!; await page.setViewportSize({ width: Math.ceil(model.width), height: Math.ceil(model.height) }); }
      await page.setContent(html, { waitUntil: 'load', timeout: 5000 });
      await page.evaluate(async () => { await window.document.fonts.ready; });
      const extracted = await page.evaluate(({ kind, limit }) => {
        const walker = window.document.createTreeWalker(window.document.body, NodeFilter.SHOW_TEXT), texts: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) if (node.textContent?.trim()) texts.push(node as Text);
        const runs: Array<{ declared: string; weight: string; style: string; sample: string; location: { sectionId?: string; nodeId?: string; part?: string }; selector: string }> = [];
        let complete = true;
        for (const text of texts) {
          const parent = text.parentElement!;
          if (parent.closest('script,style,title,noscript')) continue;
          if (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') continue;
          if (runs.length >= limit) { complete = false; break; }
          const computed = getComputedStyle(parent), section = parent.closest('[data-section-id]');
          const block = parent.closest('[data-block-id]')?.getAttribute('data-block-id');
          const nodeId = kind === 'doc' ? block && block !== 'undefined' ? block : undefined
            : parent.closest(kind === 'deck' ? '[data-node-id]' : '[data-oey-node-id]')?.getAttribute(kind === 'deck' ? 'data-node-id' : 'data-oey-node-id') ?? undefined;
          const wrapper = window.document.createElementNS(parent.namespaceURI, parent.namespaceURI === 'http://www.w3.org/2000/svg' ? 'tspan' : 'span');
          const selector = `oey-font-${runs.length}`; wrapper.id = selector;
          parent.insertBefore(wrapper, text); wrapper.append(text);
          runs.push({ declared: computed.fontFamily, weight: computed.fontWeight, style: computed.fontStyle, sample: [...text.data].slice(0, 64).join(''),
            location: kind === 'doc' ? { sectionId: section?.getAttribute('data-section-id') ?? undefined, nodeId, part: parent.closest('header') ? 'header' : parent.closest('footer') ? 'footer' : 'content' } : { nodeId }, selector: `#${selector}` });
        }
        return { runs, complete };
      }, { kind: document.kind, limit: 256 - result.runs.length });
      // CDP reports painted glyphs. Layout/font readiness alone can return an empty
      // usage list for a just-wrapped run, especially after navigating between pages.
      // A screenshot flushes painting even with page JavaScript disabled; rAF
      // callbacks are intentionally unavailable in this offline context.
      await page.screenshot({ type: 'png', timeout: 5000 });
      const root = await cdp.send('DOM.getDocument');
      for (const run of extracted.runs) {
        bounded.throwIfAborted();
        const node = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: run.selector });
        let measured = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
        if (!measured.fonts.some(font => font.glyphCount > 0)) {
          await page.locator(run.selector).evaluate(element => element.scrollIntoView({ behavior: 'instant', block: 'center' }));
          await page.screenshot({ type: 'png', timeout: 5000 });
          measured = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
        }
        const actual = measured.fonts.filter(font => font.glyphCount > 0).map(font => ({ family: font.familyName, postScriptName: font.postScriptName, glyphs: font.glyphCount }));
        const { selector: _selector, ...data } = run;
        result.runs.push({ ...data, location: { ...(pageId ? { pageId } : {}), ...data.location }, actual, ...classifyFont(run.declared, actual, families) });
        if (!actual.length) result.complete = false;
      }
      result.complete &&= extracted.complete;
    }
    result.probe = 'measured';
    result.detail += ' 已阻止外部资源和脚本；最多 256 个可见文字片段，Web 视口 1280 × 900。未遍历其他断点、交互状态或受管组件。';
  } catch {
    signal?.throwIfAborted();
    result.complete = false;
    result.detail += ' 字体实测未完成（浏览器、资源、受管组件或检查时限限制）；未测量不代表字体可用。';
  } finally {
    bounded.removeEventListener('abort', abort);
    await browser?.close().catch(() => undefined);
  }
  return result;
}

export function fontFindings(fonts: DeliveryFonts): DeliveryFinding[] {
  const findings = fonts.runs.flatMap(run => run.availability === 'missing' || run.fallback ? [{
    code: 'font.substitution', severity: 'warning' as const, location: run.location,
    message: `声明 ${run.declared}；${run.availability === 'missing' ? '当前检查宿主未发现首选字体；' : ''}Chromium 此处实际使用 ${run.actual.map(font => font.family).join('、') || '未测得'}。存在替代或跨文字字形回退，可能改变换行；请定位确认。此结论不代表用户 Windows 缺少字体。`,
  }] : []);
  if (!fonts.complete) findings.push({ code: 'font.unverified', severity: 'warning', location: {}, message: '字体检查未完整覆盖当前文档，请结合目标设备和软件复核；未测量不代表通过。' });
  return [...new Map(findings.map(item => [JSON.stringify([item.code, item.location, item.message]), item])).values()];
}
