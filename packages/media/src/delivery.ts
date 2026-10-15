import JSZip from 'jszip';
import { geometryMatrix, identityMatrix, multiplyMatrix, transformPoint, validateEditableDocument } from '@oeydesign/document';
import type { EditableDocument, PMNodeJSON, Matrix } from '@oeydesign/document';
import type { ArtifactFormat } from './artifact.ts';

export interface DeliveryLocation { pageId?: string; sectionId?: string; nodeId?: string; part?: string }
export interface DeliveryFinding {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  location: DeliveryLocation;
}
export interface DeliveryAsset { id: string; sha256: string; sizeBytes: number; mimeType: string }
export interface DeliveryReport {
  schemaVersion: 1;
  documentId: string;
  kind: EditableDocument['kind'];
  name: string;
  revision: number;
  format: ArtifactFormat;
  documentSha256: string;
  assets: DeliveryAsset[];
  findings: DeliveryFinding[];
  summary: { errors: number; warnings: number };
  checks: Array<{ id: string; status: 'checked' | 'not-run'; detail: string }>;
}

export const deliveryFormats: Record<EditableDocument['kind'], readonly ArtifactFormat[]> = {
  deck: ['pptx', 'pdf', 'png'],
  doc: ['docx', 'html', 'pdf', 'png'],
  web: ['zip', 'html', 'source.zip', 'build.zip', 'pdf', 'png'],
};

export function defaultDeliveryFormat(kind: EditableDocument['kind']): ArtifactFormat {
  return deliveryFormats[kind][0]!;
}

/** Advisory static checks. These never claim measured text fit or Office compatibility. */
export function inspectDelivery(document: EditableDocument, format: ArtifactFormat): DeliveryFinding[] {
  validateEditableDocument(document);
  if (!deliveryFormats[document.kind].includes(format)) throw new Error('此文档不支持所选交付格式。');
  const findings: DeliveryFinding[] = [];
  const warn = (code: string, message: string, location: DeliveryLocation) => findings.push({ code, severity: 'warning', message, location });
  const text = (value: string, location: DeliveryLocation) => {
    if (/\b(?:TODO|TBD|FIXME)\b|待补充|待填写|待核实|Lorem ipsum/i.test(value)) warn('content.placeholder', '文案含待完成标记，请确认后交付。', location);
  };
  const pm = (node: PMNodeJSON, location: DeliveryLocation, bodyWidth?: number) => {
    const attrs = node.attrs ?? {};
    const here = typeof attrs.id === 'string' ? { ...location, nodeId: attrs.id } : location;
    // Join adjacent text runs so rich-text formatting cannot hide a placeholder.
    const directText = (node.content ?? []).map(child => child.text ?? '').join('');
    if (directText) text(directText, here);
    if (node.type === 'inline_image' || node.type === 'floating_image') {
      if (!String(attrs.alt ?? '').trim()) warn('image.alt-empty', '图片缺少替代文字，请确认阅读和无障碍需要。', here);
      if (format === 'docx') {
        const assets = Array.isArray(document.assets) ? document.assets : Object.values(document.assets ?? {});
        if (assets.find(asset => asset.id === attrs.assetId)?.mimeType === 'image/webp') findings.push({ code: 'docx.webp', severity: 'error', message: 'DOCX 暂不支持 WebP；请替换为 PNG/JPEG。', location: here });
      }
    }
    if (bodyWidth !== undefined) {
      if (node.type === 'inline_image' && Number(attrs.width) > bodyWidth + 0.5) warn('doc.body-overflow', '行内图片宽度超过正文栏。', here);
      if (node.type === 'table' && Array.isArray(attrs.columnWidths) && attrs.columnWidths.reduce<number>((sum, width) => sum + Number(width), 0) > bodyWidth + 0.5) warn('doc.body-overflow', '表格列宽总和超过正文栏，请查看实际分页。', here);
      if (node.type === 'floating_image' || node.type === 'floating_shape') {
        const width = Number(attrs.width), height = Number(attrs.height), x = Number(attrs.x ?? 0);
        const radians = Number(attrs.rotation ?? 0) * Math.PI / 180;
        const rotatedWidth = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
        const center = x + width / 2;
        if (center - rotatedWidth / 2 < -0.5 || center + rotatedWidth / 2 > bodyWidth + 0.5) warn('doc.body-overflow', '浮动对象横向超出正文栏；可能是有意出血，请查看分页。', here);
      }
    }
    for (const child of node.content ?? []) pm(child, here, bodyWidth);
  };

  if (document.kind === 'deck') {
    for (const page of document.pages) {
      if (!page.children.length) warn('page.empty', '此幻灯片没有对象。', { pageId: page.id });
      const visit = (id: string, parent: Matrix) => {
        const node = document.nodes[id]!;
        if (node.hidden) return;
        const location = { pageId: page.id, nodeId: id };
        const matrix = multiplyMatrix(parent, geometryMatrix(node.geometry));
        const { width, height } = node.geometry;
        const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map(point => transformPoint(matrix, point));
        if (corners.some(point => point.x < -0.5 || point.y < -0.5 || point.x > page.width + 0.5 || point.y > page.height + 0.5)) warn('deck.page-overflow', '对象边界超出幻灯片；可能是有意出血，请查看预览。', location);
        if (node.content) pm(node.content, location);
        for (const row of node.table?.rows ?? []) for (const cell of row.cells) pm(cell.content, { ...location, nodeId: cell.id });
        if (node.chart) for (const value of [node.chart.title ?? '', ...node.chart.categories, ...node.chart.series.map(series => series.name)]) text(value, location);
        for (const child of node.children ?? []) visit(child, matrix);
      };
      for (const id of page.children) visit(id, identityMatrix());
    }
  } else if (document.kind === 'doc') {
    for (const section of document.sections) {
      const settings = section.pageSettings ?? document.pageSettings;
      const width = settings.width - settings.marginLeft - settings.marginRight;
      for (const part of ['content', 'header', 'footer'] as const) if (section[part]) pm(section[part]!, { sectionId: section.id, part }, width);
    }
  } else {
    for (const page of document.pages) {
      const visit = (id: string) => {
        const node = document.nodes[id]!;
        if (node.hidden) return;
        const location = { pageId: page.id, nodeId: id };
        if (node.content) pm(node.content, location);
        else if (node.text) text(node.text, location);
        if (node.tag === 'img' && !String(node.props?.alt ?? '').trim()) warn('image.alt-empty', '图片缺少替代文字，请确认阅读和无障碍需要。', location);
        if (node.tag === 'a' && (!node.props?.href || node.props.href === '#')) warn('web.link-placeholder', '链接没有实际目标，请确认交互。', location);
        for (const child of node.children) visit(child);
      };
      visit(page.rootId);
    }
    if (format === 'html' && document.pages.length > 1) warn('web.single-page-export', '单页 HTML 只交付首页；交付全部路由请选择静态站点 ZIP 或源码 ZIP。', { pageId: document.pages[0]!.id });
  }
  const unique = new Map(findings.map(finding => [JSON.stringify([finding.code, finding.location]), finding]));
  return [...unique.values()];
}

export interface DeliveryManifest {
  schemaVersion: 1;
  report: DeliveryReport;
  artifact: { filename: string; sha256: string; sizeBytes: number };
}

/** Only generated filenames and explicit in-memory bytes enter the archive. No source tree or references. */
export async function packageDelivery(manifest: DeliveryManifest, artifact: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const expected = `${manifest.report.kind}-r${manifest.report.revision}.${manifest.report.format}`;
  if (manifest.artifact.filename !== expected || !/^(deck|doc|web)-r\d+\.(?:pptx|docx|pdf|png|html|zip|source\.zip|build\.zip)$/.test(expected)) throw new Error('Invalid generated delivery filename.');
  const zip = new JSZip();
  const fileOptions = { date: new Date('2000-01-01T00:00:00Z') };
  zip.file(manifest.artifact.filename, artifact, fileOptions);
  zip.file('delivery.json', JSON.stringify(manifest, null, 2), fileOptions);
  zip.file('README.txt', `OEYdesign 交付快照\n版本：r${manifest.report.revision}\n产物：${manifest.artifact.filename}\n检查发现：${manifest.report.summary.errors} 错误，${manifest.report.summary.warnings} 提醒\n\n请查看 delivery.json 的 findings 和 checks。未运行的检查不代表通过。\n仅打包所选产物和本报告，不额外归档项目目录、独立资料库或聊天历史。\n产物保留其原有内容；源码格式包含网页源码。未扫描或脱敏产物内的敏感内容。\n`, fileOptions);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }, () => signal?.throwIfAborted());
  signal?.throwIfAborted();
  return bytes;
}
