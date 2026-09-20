import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec } from 'prosemirror-model';
import { textSchema } from '@oeydesign/document';

type Attrs = Record<string, unknown>;

function readParagraphAttrs(element: HTMLElement, level?: number): Attrs {
  const style = element.style;
  const numeric = (value: string) => value ? Number.parseFloat(value) : undefined;
  return {
    ...(level === undefined ? {} : { level }),
    align: style.textAlign || null,
    lineHeight: numeric(style.lineHeight) ?? null,
    spaceBefore: numeric(style.marginTop) ?? null,
    spaceAfter: numeric(style.marginBottom) ?? null,
    indent: numeric(style.marginLeft) ?? null,
    firstLineIndent: numeric(style.textIndent) ?? null,
  };
}

function paragraphStyle(attrs: Record<string, unknown>): string | undefined {
  const declarations: string[] = [];
  if (typeof attrs.align === 'string') declarations.push(`text-align:${attrs.align}`);
  if (typeof attrs.lineHeight === 'number') declarations.push(`line-height:${attrs.lineHeight}px`);
  if (typeof attrs.spaceBefore === 'number') declarations.push(`margin-top:${attrs.spaceBefore}px`);
  if (typeof attrs.spaceAfter === 'number') declarations.push(`margin-bottom:${attrs.spaceAfter}px`);
  if (typeof attrs.indent === 'number') declarations.push(`margin-left:${attrs.indent}px`);
  if (typeof attrs.firstLineIndent === 'number') declarations.push(`text-indent:${attrs.firstLineIndent}px`);
  return declarations.length ? declarations.join(';') : undefined;
}

function textStyleString(attrs: Record<string, unknown>): string | undefined {
  const declarations: string[] = [];
  if (typeof attrs.color === 'string') declarations.push(`color:${attrs.color}`);
  if (typeof attrs.backgroundColor === 'string') declarations.push(`background-color:${attrs.backgroundColor}`);
  if (typeof attrs.fontFamily === 'string') declarations.push(`font-family:${attrs.fontFamily}`);
  if (typeof attrs.fontSize === 'number') declarations.push(`font-size:${attrs.fontSize}px`);
  return declarations.length ? declarations.join(';') : undefined;
}

const nodeSpecs = textSchema.spec.nodes
  .update('paragraph', {
    ...textSchema.spec.nodes.get('paragraph'),
    parseDOM: [{ tag: 'p', getAttrs: dom => readParagraphAttrs(dom as HTMLElement) }],
    toDOM: node => ['p', { style: paragraphStyle(node.attrs) }, 0],
  } as NodeSpec)
  .update('heading', {
    ...textSchema.spec.nodes.get('heading'),
    parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, getAttrs: dom => readParagraphAttrs(dom as HTMLElement, level) })),
    toDOM: node => [`h${Math.max(1, Math.min(6, Number(node.attrs.level) || 1))}`, { style: paragraphStyle(node.attrs) }, 0],
  } as NodeSpec)
  .update('blockquote', { ...textSchema.spec.nodes.get('blockquote'), parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] } as NodeSpec)
  .update('bullet_list', { ...textSchema.spec.nodes.get('bullet_list'), parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] } as NodeSpec)
  .update('ordered_list', { ...textSchema.spec.nodes.get('ordered_list'), parseDOM: [{ tag: 'ol', getAttrs: dom => ({ order: Number((dom as HTMLElement).getAttribute('start')) || 1 }) }], toDOM: node => ['ol', { start: node.attrs.order === 1 ? null : node.attrs.order }, 0] } as NodeSpec)
  .update('list_item', { ...textSchema.spec.nodes.get('list_item'), parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] } as NodeSpec)
  .update('hard_break', { ...textSchema.spec.nodes.get('hard_break'), parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] } as NodeSpec);

const markSpecs = textSchema.spec.marks
  .update('strong', { ...textSchema.spec.marks.get('strong'), parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] } as MarkSpec)
  .update('em', { ...textSchema.spec.marks.get('em'), parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] } as MarkSpec)
  .update('underline', { ...textSchema.spec.marks.get('underline'), parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] } as MarkSpec)
  .update('strike', { ...textSchema.spec.marks.get('strike'), parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] } as MarkSpec)
  .update('textStyle', {
    ...textSchema.spec.marks.get('textStyle'),
    parseDOM: [{ tag: 'span[style]', getAttrs: dom => {
      const style = (dom as HTMLElement).style;
      return { color: style.color || null, backgroundColor: style.backgroundColor || null,
        fontFamily: style.fontFamily.replace(/^['"]|['"]$/g, '') || null,
        fontSize: style.fontSize ? Number.parseFloat(style.fontSize) : null };
    } }],
    toDOM: mark => ['span', { style: textStyleString(mark.attrs) }, 0],
  } as MarkSpec)
  .update('link', { ...textSchema.spec.marks.get('link'), parseDOM: [{ tag: 'a[href]', getAttrs: dom => ({ href: (dom as HTMLElement).getAttribute('href') }) }], toDOM: mark => ['a', { href: mark.attrs.href }, 0] } as MarkSpec);

/** DOM-capable view schema with the same node/mark names and attributes as the headless kernel schema. */
export const editorTextSchema = new Schema({ nodes: nodeSpecs, marks: markSpecs });
