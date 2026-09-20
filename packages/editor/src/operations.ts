import { Transform } from 'prosemirror-transform';
import { textSchema, textFromString } from '@oeydesign/document';
import type { ChartData, DeckDocument, DeckNode, DocumentOperation, Geometry, ImageAsset, PMNodeJSON, TableData } from '@oeydesign/document';

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

export function makeTableInsert(parentId: string, placement: NodePlacement, options: { fill?: string; textColor?: string } = {}): DocumentOperation {
  const values = [['指标', '本期', '变化'], ['收入', '128', '+12%'], ['用户', '4.2万', '+8%']];
  const table: TableData = {
    headerRows: 1, columnWidths: [150, 130, 130], borderColor: '#d9e2da', borderWidth: 1, cellPadding: 9,
    rows: values.map(row => ({ id: newId('row'), cells: row.map(value => ({
      id: newId('cell'), content: textFromString(value),
      style: row === values[0] ? { fill: options.fill ?? '#e8efe9', color: options.textColor ?? '#244b3a', fontSize: 14 } : { color: options.textColor ?? '#3f5045', fontSize: 13 },
    })) })),
  };
  const node: DeckNode = { id: newId('table'), kind: 'table', parentId, geometry: { ...placement, width: 410, height: 156, rotation: 0 },
    style: { name: '数据表格' }, locked: false, hidden: false, table };
  return { type: 'node.insert', node };
}

export function makeChartInsert(parentId: string, placement: NodePlacement, options: { colors?: string[]; textColor?: string } = {}): DocumentOperation {
  const colors = options.colors ?? ['#315d4b', '#c07e4d', '#6e87a1'];
  const chart: ChartData = { type: 'bar', title: '季度表现', categories: ['第一季', '第二季', '第三季'],
    series: [{ id: newId('series'), name: '实际值', values: [64, 82, 72], color: colors[0] }, { id: newId('series'), name: '目标值', values: [70, 76, 85], color: colors[1] }], legend: true, dataLabels: true, yAxisTitle: '指数' };
  const node: DeckNode = { id: newId('chart'), kind: 'chart', parentId, geometry: { ...placement, width: 480, height: 300, rotation: 0 },
    style: { name: '柱状图', fill: '#ffffff', textColor: options.textColor ?? '#304238' }, locked: false, hidden: false, chart };
  return { type: 'node.insert', node };
}

export function makeImageInsert(parentId: string, placement: NodePlacement, asset: ImageAsset, options: { width?: number; height?: number } = {}): DocumentOperation[] {
  const width = options.width ?? 360;
  const height = options.height ?? Math.max(120, Math.round(width * asset.height / asset.width));
  const node: DeckNode = { id: newId('image'), kind: 'image', parentId,
    geometry: { ...placement, width, height, rotation: 0 }, style: { name: asset.name ?? '图片', stroke: 'none' },
    locked: false, hidden: false, assetId: asset.id, image: { fit: 'contain', opacity: 1 } };
  return [{ type: 'asset.register', asset }, { type: 'node.insert', node }];
}

export function scaleRichTextContent(content: PMNodeJSON, factor: number): { content: PMNodeJSON; steps: unknown[] } {
  const root = textSchema.nodeFromJSON(content);
  const transform = new Transform(root);
  const blocks: Array<{ pos: number; node: typeof root }> = [];
  const runs: Array<{ from: number; to: number; attrs: Record<string, unknown> }> = [];
  root.descendants((node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') blocks.push({ pos, node: node as typeof root });
    if (node.isText) {
      const style = node.marks.find(mark => mark.type === textSchema.marks.textStyle);
      if (typeof style?.attrs.fontSize === 'number') runs.push({ from: pos, to: pos + node.nodeSize, attrs: style.attrs });
    }
  });
  for (const block of blocks) {
    const attrs = { ...block.node.attrs };
    for (const key of ['lineHeight', 'spaceBefore', 'spaceAfter', 'indent', 'firstLineIndent']) {
      if (typeof attrs[key] === 'number') attrs[key] *= factor;
    }
    if (JSON.stringify(attrs) !== JSON.stringify(block.node.attrs)) transform.setNodeMarkup(block.pos, undefined, attrs);
  }
  for (const run of runs) {
    transform.removeMark(run.from, run.to, textSchema.marks.textStyle);
    transform.addMark(run.from, run.to, textSchema.marks.textStyle.create({ ...run.attrs, fontSize: run.attrs.fontSize as number * factor }));
  }
  return { content: transform.doc.toJSON() as PMNodeJSON, steps: transform.steps.map(step => step.toJSON()) };
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
