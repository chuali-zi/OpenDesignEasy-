import type { CSSProperties, ReactNode } from 'react';
import type { DeckNode, PMNodeJSON } from '@oeydesign/document';

function renderInline(node: PMNodeJSON, key: string): ReactNode {
  if (node.type === 'text') {
    const style: CSSProperties = {};
    let weight: number | string | undefined;
    let italic = false;
    let decoration = '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'strong') weight = 700;
      if (mark.type === 'em') italic = true;
      if (mark.type === 'underline') decoration = `${decoration} underline`.trim();
      if (mark.type === 'strike') decoration = `${decoration} line-through`.trim();
      if (mark.type === 'textStyle') {
        if (typeof mark.attrs?.color === 'string') style.color = mark.attrs.color;
        if (typeof mark.attrs?.backgroundColor === 'string') style.backgroundColor = mark.attrs.backgroundColor;
        if (typeof mark.attrs?.fontFamily === 'string') style.fontFamily = mark.attrs.fontFamily;
        if (typeof mark.attrs?.fontSize === 'number') style.fontSize = `${mark.attrs.fontSize}px`;
      }
    }
    if (weight) style.fontWeight = weight;
    if (italic) style.fontStyle = 'italic';
    if (decoration) style.textDecoration = decoration;
    return <span key={key} style={style}>{node.text}</span>;
  }
  if (node.type === 'hard_break') return <br key={key} />;
  return <>{(node.content ?? []).map((child, index) => renderInline(child, `${key}-${index}`))}</>;
}

function renderBlocks(node: PMNodeJSON, key: string): ReactNode {
  if (node.type === 'paragraph' || node.type === 'heading') {
    const attrs = node.attrs ?? {};
    const style: CSSProperties = {
      textAlign: typeof attrs.align === 'string' ? attrs.align as CSSProperties['textAlign'] : undefined,
      lineHeight: typeof attrs.lineHeight === 'number' ? `${attrs.lineHeight}px` : undefined,
      marginTop: typeof attrs.spaceBefore === 'number' ? `${attrs.spaceBefore}px` : 0,
      marginBottom: typeof attrs.spaceAfter === 'number' ? `${attrs.spaceAfter}px` : 0,
      marginLeft: typeof attrs.indent === 'number' ? `${attrs.indent}px` : 0,
      textIndent: typeof attrs.firstLineIndent === 'number' ? `${attrs.firstLineIndent}px` : undefined,
      fontWeight: node.type === 'heading' ? 650 : undefined,
    };
    return <div key={key} className="editor-rich-preview-paragraph" style={style}>
      {(node.content ?? []).map((child, index) => renderInline(child, `${key}-${index}`))}
    </div>;
  }
  if (node.type === 'bullet_list' || node.type === 'ordered_list') {
    const Tag = node.type === 'bullet_list' ? 'ul' : 'ol';
    return <Tag key={key} className="editor-rich-preview-list">{(node.content ?? []).map((child, index) => renderBlocks(child, `${key}-${index}`))}</Tag>;
  }
  if (node.type === 'list_item') return <li key={key}>{(node.content ?? []).map((child, index) => renderBlocks(child, `${key}-${index}`))}</li>;
  if (node.type === 'blockquote') return <blockquote key={key} className="editor-rich-preview-quote">{(node.content ?? []).map((child, index) => renderBlocks(child, `${key}-${index}`))}</blockquote>;
  return <>{(node.content ?? []).map((child, index) => renderBlocks(child, `${key}-${index}`))}</>;
}

export function RichTextPreview({ node, matrix }: { node: DeckNode; matrix: readonly number[] }) {
  if (!node.content || matrix.length !== 6) return null;
  const [a, b, c, d, e, f] = matrix;
  const fontSize = typeof node.style.fontSize === 'number' ? node.style.fontSize : 24;
  const fontFamily = typeof node.style.fontFamily === 'string' ? node.style.fontFamily : 'Segoe UI';
  const color = typeof node.style.fill === 'string' ? node.style.fill : '#244b3a';
  const fontStyle: CSSProperties = {
    position: 'absolute', left: 0, top: 0, width: node.geometry.width, height: node.geometry.height,
    overflow: 'hidden', transformOrigin: '0 0', transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
    color, fontSize, fontFamily, fontWeight: node.style.fontWeight === 'bold' ? 700 : 400,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', pointerEvents: 'none',
  };
  return <div className="editor-rich-preview" aria-hidden="true" style={fontStyle}>
    {(node.content.content ?? []).map((block, index) => renderBlocks(block, `${node.id}-${index}`))}
  </div>;
}
