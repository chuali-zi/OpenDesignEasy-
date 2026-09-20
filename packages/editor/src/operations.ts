import { Transform } from 'prosemirror-transform';
import { textSchema, textFromString } from '@oeydesign/document';
import type { DeckDocument, DeckNode, DocumentOperation, Geometry, PMNodeJSON } from '@oeydesign/document';

export type NodePlacement = Pick<Geometry, 'x' | 'y'>;

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export function makeTextInsert(parentId: string, placement: NodePlacement, text = '双击编辑文字'): DocumentOperation {
  const node: DeckNode = {
    id: newId('text'), kind: 'text', parentId,
    geometry: { ...placement, width: 360, height: 84, rotation: 0 },
    style: { name: '文本框', fill: '#244b3a', fontSize: 36, fontFamily: 'Georgia' },
    locked: false, hidden: false, content: textFromString(text),
  };
  return { type: 'node.insert', node };
}

export function makeShapeInsert(parentId: string, placement: NodePlacement, options: { width?: number; height?: number; fill?: string } = {}): DocumentOperation {
  const node: DeckNode = {
    id: newId('shape'), kind: 'shape', parentId,
    geometry: { ...placement, width: options.width ?? 280, height: options.height ?? 150, rotation: 0 },
    style: { name: '矩形', fill: options.fill ?? '#dce9df', stroke: '#244b3a', strokeWidth: 1 },
    locked: false, hidden: false,
  };
  return { type: 'node.insert', node };
}

export function makePageInsert(document: DeckDocument, name = `Page ${document.pages.length + 1}`): { operation: DocumentOperation; pageId: string } {
  const source = document.pages.at(-1) ?? { width: 1280, height: 720 };
  const pageId = newId('page');
  return {
    pageId,
    operation: { type: 'page.insert', page: { id: pageId, name, width: source.width, height: source.height, children: [] } },
  };
}

export function makeCoverOperations(pageId: string, width: number, height: number): { operations: DocumentOperation[]; focusNodeId: string } {
  const background = newId('shape');
  const panel = newId('shape');
  const accent = newId('shape');
  const eyebrow = newId('text');
  const title = newId('text');
  const subtitle = newId('text');
  const footer = newId('text');
  const textNode = (id: string, name: string, value: string, x: number, y: number, w: number, h: number, fill: string, fontSize: number, fontFamily = 'Segoe UI'): DeckNode => ({
    id, kind: 'text', parentId: pageId, geometry: { x, y, width: w, height: h, rotation: 0 },
    style: { name, fill, fontSize, fontFamily }, locked: false, hidden: false, content: textFromString(value),
  });
  const rect = (id: string, name: string, x: number, y: number, w: number, h: number, fill: string): DeckNode => ({
    id, kind: 'shape', parentId: pageId, geometry: { x, y, width: w, height: h, rotation: 0 },
    style: { name, fill, stroke: 'none' }, locked: false, hidden: false,
  });
  const pad = Math.round(Math.min(width, height) * 0.12);
  const panelX = Math.round(width * 0.69);
  const operations: DocumentOperation[] = [
    { type: 'node.insert', node: rect(background, '深绿背景', 0, 0, width, height, '#254b3c') },
    { type: 'node.insert', node: rect(panel, '右侧色块', panelX, 0, width - panelX, height, '#315d4b') },
    { type: 'node.insert', node: rect(accent, '强调线', pad, Math.round(height * 0.31), 88, 5, '#bdd48b') },
    { type: 'node.insert', node: textNode(eyebrow, '眉题', 'OEY DESIGN     /     PRESENTATION', pad, Math.round(height * 0.18), width * 0.48, 28, '#c7d6cb', 14) },
    { type: 'node.insert', node: textNode(title, '主标题', '设计，从这里\n开始。', pad, Math.round(height * 0.36), width * 0.5, Math.round(height * 0.29), '#f8faf6', 54, 'Georgia') },
    { type: 'node.insert', node: textNode(subtitle, '副标题', '把想法整理成清晰的表达', pad, Math.round(height * 0.71), width * 0.49, 42, '#e0e9e2', 21) },
    { type: 'node.insert', node: textNode(footer, '页脚', '2026    ·    DECK 01', pad, Math.round(height * 0.88), width * 0.48, 24, '#bdd48b', 13) },
  ];
  return { operations, focusNodeId: title };
}

/** Replace a Deck text node's plain text while preserving the ProseMirror document shape. */
export function makeTextReplacementSteps(content: PMNodeJSON, value: string): unknown[] {
  const before = textSchema.nodeFromJSON(content);
  const after = textSchema.nodeFromJSON(textFromString(value));
  const transform = new Transform(before);
  transform.replace(0, before.content.size, after.slice(0, after.content.size));
  return transform.steps.map(step => step.toJSON());
}
