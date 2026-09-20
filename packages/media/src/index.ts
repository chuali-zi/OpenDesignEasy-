import { textToString, validateDocument } from '@oeydesign/document';
import type { DeckDocument, DeckNode } from '@oeydesign/document';

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

/** A basic headless SVG preview for the R1 CLI. Office export and rich text layout follow in R2. */
export function renderDeckSvg(document: DeckDocument, pageId = document.pages[0]?.id): string {
  validateDocument(document);
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) throw new Error(`Page ${pageId} does not exist.`);
  const draw = (node: DeckNode): string => {
    if (node.hidden) return '';
    const { x, y, width, height, rotation } = node.geometry;
    const fill = escapeXml(String(node.style.fill ?? (node.kind === 'text' ? '#111827' : '#dbeafe')));
    const stroke = escapeXml(String(node.style.stroke ?? 'none'));
    const fontSize = typeof node.style.fontSize === 'number' ? node.style.fontSize : 24;
    let body: string;
    if (node.kind === 'group') body = node.children!.map(id => draw(document.nodes[id]!)).join('');
    else if (node.kind === 'shape') body = `<rect width="${width}" height="${height}" fill="${fill}" stroke="${stroke}"/>`;
    else if (node.kind === 'text') {
      const lines = textToString(node.content!).split('\n');
      body = `<text fill="${fill}" font-family="sans-serif" font-size="${fontSize}">${lines.map((line, index) => `<tspan x="0" y="${fontSize + index * fontSize * 1.2}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    } else throw new Error(`R1 SVG preview does not yet support ${node.kind} node ${node.id}.`);
    return `<g data-node-id="${escapeXml(node.id)}" transform="translate(${x} ${y}) rotate(${rotation})">${body}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" data-document-id="${escapeXml(document.documentId)}" data-revision="${document.revision}"><title>${escapeXml(document.name)} — ${escapeXml(page.name)}</title><rect width="100%" height="100%" fill="white"/>${page.children.map(id => draw(document.nodes[id]!)).join('')}</svg>`;
}

export { exportDeckPptx } from "./pptx.ts";
