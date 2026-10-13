import type { PMNodeJSON } from '@oeydesign/document';
import { validateTextContent } from '@oeydesign/document';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function style(attrs: Record<string, unknown>): string {
  const values: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value); if (/[;{}<>]/.test(text) || /expression\s*\(|javascript\s*:/i.test(text)) throw new Error('Invalid rich-text CSS value');
    values.push(`${name.replace(/[A-Z]/g, c => '-'+c.toLowerCase())}:${typeof value === 'number' ? text+'px' : text}`);
  }
  return values.length ? ` style="${escape(values.join(';'))}"` : '';
}
function link(href: unknown): string {
  const value = String(href ?? '').replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  return /^[a-z][a-z\d+.-]*:/i.test(value) && !/^(https?:|mailto:|tel:)/i.test(value) ? '#' : value;
}

/** Span-based blocks remain valid inside native text containers. */
export function renderWebRichText(content: PMNodeJSON, links = true): string {
  validateTextContent(content);
  const render = (node: PMNodeJSON): string => {
    if (node.type === 'text') {
      let text = escape(node.text ?? '');
      for (const mark of node.marks ?? []) {
        const tags: Record<string, string> = { strong: 'strong', em: 'em', underline: 'u', strike: 's' };
        if (tags[mark.type]) text = `<${tags[mark.type]}>${text}</${tags[mark.type]}>`;
        if (mark.type === 'textStyle') { const a = mark.attrs ?? {}; text = `<span${style({ color: a.color, backgroundColor: a.backgroundColor, fontFamily: a.fontFamily, fontSize: a.fontSize })}>${text}</span>`; }
        if (mark.type === 'link') text = links ? `<a href="${escape(link(mark.attrs?.href))}" rel="noopener noreferrer">${text}</a>` : `<span style="text-decoration:underline">${text}</span>`;
      }
      return text;
    }
    if (node.type === 'hard_break') return '<br>';
    const children = (node.content ?? []).map(render).join('');
    if (node.type === 'doc') return children;
    if (node.type === 'paragraph' || node.type === 'heading') {
      const a = node.attrs ?? {};
      return `<span data-oey-rich-block${style({ display: 'block', textAlign: a.align, lineHeight: a.lineHeight, marginTop: a.spaceBefore, marginBottom: a.spaceAfter, marginLeft: a.indent, textIndent: a.firstLineIndent, ...(node.type === 'heading' ? { fontWeight: 'bold' } : {}) })}>${children || '<br>'}</span>`;
    }
    if (node.type === 'bullet_list' || node.type === 'ordered_list') return `<span role="list" style="display:block">${(node.content ?? []).map((child, i) => `<span role="listitem" style="display:block">${node.type === 'bullet_list' ? '•' : `${Number(node.attrs?.order ?? 1)+i}.`} ${render(child)}</span>`).join('')}</span>`;
    return `<span${style({ display: 'block', ...(node.type === 'blockquote' ? { marginLeft: 20 } : {}) })}>${children}</span>`;
  };
  return render(content);
}
