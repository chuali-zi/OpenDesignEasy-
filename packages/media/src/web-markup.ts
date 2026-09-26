import type { JSONValue, WebDocument, WebLayout, WebNode } from '@oeydesign/document';

export type WebMarkupOptions = { editing?: boolean; pageUrl?: (page: WebDocument['pages'][number]) => string };
export const webVoidTags = new Set(['br', 'col', 'hr', 'img', 'input', 'source', 'wbr']);
const nativeTags = new Set(('a article aside b blockquote br button caption code col colgroup dd details div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input label legend li main nav ol optgroup option output p picture pre progress section select small source span strong summary table tbody td textarea th thead time tr ul wbr').split(' '));
const unitless = new Set(['opacity', 'z-index', 'font-weight', 'line-height', 'flex', 'flex-grow', 'flex-shrink', 'order', 'zoom', 'grid-row', 'grid-column', 'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end', 'aspect-ratio', 'scale']);

export function escapeWebText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function webNativeTag(node: WebNode): string {
  if (!nativeTags.has(node.tag)) throw new Error(`Unsupported native Web tag ${node.tag} on ${node.id}.`);
  return node.tag;
}

function safeUrl(value: string): string {
  const normalized = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^(https?:|mailto:|tel:)/i.test(normalized)) return '#';
  return value;
}

/** Native props contain data; executable behavior belongs to managed components. */
export function webNativeProps(node: WebNode, assetUrls: Record<string, string> = {}): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z\d_-]*$/.test(key) || /^on/i.test(key) || /^(?:style|innerHTML|dangerouslySetInnerHTML|srcdoc|action|formaction|assetId|data-oey-.*|data-web-.*)$/i.test(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    if (['href', 'src', 'poster', 'cite'].includes(key.toLowerCase())) props[key] = safeUrl(String(value));
    else if (key.toLowerCase() === 'srcset') continue;
    else props[key] = value as string | number | boolean;
  }
  if (typeof node.props?.assetId === 'string') {
    const url = assetUrls[node.props.assetId];
    if (!url) throw new Error(`Image asset ${node.props.assetId} has no resolved resource.`);
    props.src = url;
  }
  if (props.target === '_blank') props.rel = 'noopener noreferrer';
  return props;
}

function declarations(style: Record<string, JSONValue | undefined>): string {
  return Object.entries(style).flatMap(([property, value]) => {
    if (value == null || typeof value === 'boolean' || typeof value === 'object') return [];
    const key = property.startsWith('--') ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    if (!/^(?:--[\w-]+|[a-z][a-z\d-]*)$/.test(key)) throw new Error(`Invalid CSS property: ${property}`);
    let text = String(value);
    if (/[;{}<>]/.test(text) || /expression\s*\(|javascript\s*:|behavior\s*:/i.test(text)) throw new Error(`Invalid CSS value for ${property}`);
    if (typeof value === 'number' && value !== 0 && !unitless.has(key) && !key.startsWith('--')) text += 'px';
    return [`${key}:${text}`];
  }).join(';');
}

function layoutStyles(layout: Partial<WebLayout>, resetFlow = false): Record<string, JSONValue | undefined> {
  const { mode, ...properties } = layout;
  const result: Record<string, JSONValue | undefined> = { ...properties };
  if (mode === 'flex' || mode === 'grid') { result.display = mode; if (resetFlow) result.position = layout.position ?? 'static'; }
  if (mode === 'position') result.position = layout.position ?? 'absolute';
  if (mode === 'flow' && resetFlow) { result.display = 'revert'; result.position = layout.position ?? 'static'; }
  return result;
}

function selector(id: string): string {
  const value = id.replace(/["\\\n\r\f<>]/g, character => `\\${character.charCodeAt(0).toString(16)} `);
  return `[data-oey-node-id="${value}"]`;
}

/** The editor, static exports and React source all use this CSS projection. */
export function renderWebStyles(document: WebDocument): string {
  const rules = ['*,*::before,*::after{box-sizing:border-box}', 'html,body{margin:0}', 'img{max-width:100%}'];
  for (const module of document.sourceModules ?? []) if (module.language === 'css') rules.push(module.source.replace(/</g, '\\3c '));
  for (const node of Object.values(document.nodes)) rules.push(`${selector(node.id)}{${declarations({ ...node.style, ...layoutStyles(node.layout) })}}`);
  for (const breakpoint of document.breakpoints ?? []) {
    const condition = [breakpoint.minWidth === undefined ? '' : `(min-width:${breakpoint.minWidth}px)`, breakpoint.maxWidth === undefined ? '' : `(max-width:${breakpoint.maxWidth}px)`].filter(Boolean).join(' and ') || 'all';
    const overrides = Object.values(document.nodes).flatMap(node => {
      const override = node.responsive?.[breakpoint.id];
      if (!override) return [];
      return [`${selector(node.id)}{${declarations({ ...override.style, ...layoutStyles(override.layout ?? {}, true) })}}`];
    });
    if (overrides.length) rules.push(`@media ${condition}{${overrides.join('\n')}}`);
  }
  return rules.join('\n');
}

function attributes(props: Record<string, string | number | boolean>): string {
  return Object.entries(props).flatMap(([key, value]) => {
    const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key;
    if (typeof value === 'boolean' && !name.startsWith('aria-') && !name.startsWith('data-')) return value ? [name] : [];
    return [`${name}="${escapeWebText(String(value))}"`];
  }).join(' ');
}

export function renderWebMarkup(document: WebDocument, pageId = document.pages[0]?.id, assetUrls: Record<string, string> = {}, options: WebMarkupOptions = {}): string {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error(`Web page ${pageId} does not exist.`);
  const render = (id: string, root = false): string => {
    const node = document.nodes[id];
    if (!node) throw new Error(`Web node ${id} does not exist.`);
    if (node.hidden) return '';
    if (node.component && !options.editing) throw new Error(`Static HTML cannot render custom component ${id}; use the React source export/build.`);
    const tag = webNativeTag(node);
    const props = webNativeProps(node, assetUrls);
    if (tag === 'a' && typeof props.href === 'string') {
      const destination = document.pages.find(item => item.route === props.href || item.id === props.href);
      if (destination && options.pageUrl) props.href = options.pageUrl(destination);
    }
    const identity = `data-oey-node-id="${escapeWebText(id)}" data-web-id="${escapeWebText(id)}"${root ? ' data-page-root' : ''}`;
    const opening = `<${tag} ${identity} ${attributes(props)}`;
    if (webVoidTags.has(tag)) return `${opening}>`;
    const boundary = node.component ? `<span data-component-boundary>${escapeWebText(node.component.exportName)} · 组件</span>` : '';
    const content = boundary + (node.text === undefined ? '' : escapeWebText(node.text)) + node.children.map(child => render(child)).join('');
    const demo = tag === 'form' ? '<output data-oey-form-status hidden>Demo submitted</output>' : '';
    const behavior = tag === 'form' && !options.editing ? ` onsubmit="event.preventDefault();this.querySelector('[data-oey-form-status]').hidden=false"` : '';
    return `${opening}${behavior}>${content}${demo}</${tag}>`;
  };
  return render(page.rootId, true);
}
