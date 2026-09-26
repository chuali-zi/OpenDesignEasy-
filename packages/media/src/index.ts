import { validateDocument } from "@oeydesign/document";
import type { DeckDocument, DeckNode, DeckPage, ImageAsset, ImageCrop, PMMarkJSON, PMNodeJSON } from "@oeydesign/document";
import { imageBytes, imageDataUri } from "./assets.ts";
import type { AssetResolver } from "./assets.ts";

const xml = (value: unknown): string => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
const number = (value: number): string => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
const THEME_COLORS = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

type TextStyle = { color?: string; fontFamily?: string; fontSize?: number; backgroundColor?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; href?: string };

function markStyle(marks: PMMarkJSON[] | undefined): TextStyle {
  const style: TextStyle = {};
  for (const mark of marks ?? []) {
    if (mark.type === "strong") style.bold = true;
    else if (mark.type === "em") style.italic = true;
    else if (mark.type === "underline") style.underline = true;
    else if (mark.type === "strike") style.strike = true;
    else if (mark.type === "link") style.href = typeof mark.attrs?.href === "string" ? mark.attrs.href : undefined;
    else if (mark.type === "textStyle") {
      const attrs = mark.attrs ?? {};
      if (typeof attrs.color === "string") style.color = attrs.color;
      if (typeof attrs.fontFamily === "string") style.fontFamily = attrs.fontFamily;
      if (typeof attrs.fontSize === "number") style.fontSize = attrs.fontSize;
      if (typeof attrs.backgroundColor === "string") style.backgroundColor = attrs.backgroundColor;
    }
  }
  return style;
}

function inlineHtml(node: PMNodeJSON, inherited: TextStyle = {}): string {
  if (node.type === "text") {
    const current = { ...inherited, ...markStyle(node.marks) };
    const styles = [
      current.color ? `color:${current.color}` : "",
      current.fontFamily ? `font-family:${current.fontFamily}` : "",
      current.fontSize ? `font-size:${number(current.fontSize)}px` : "",
      current.bold ? "font-weight:700" : "",
      current.italic ? "font-style:italic" : "",
      current.underline || current.strike ? `text-decoration-line:${[current.underline ? "underline" : "", current.strike ? "line-through" : ""].filter(Boolean).join(" ")}` : "",
      current.backgroundColor ? `background-color:${current.backgroundColor}` : "",
    ].filter(Boolean).join(";");
    const text = xml(node.text ?? "");
    const link = current.href ? ` data-link-href="${xml(current.href)}"` : "";
    return styles || link ? `<span${link} style="${xml(styles)}">${text}</span>` : text;
  }
  if (node.type === "hard_break") return "<br/>";
  return (node.content ?? []).map(child => inlineHtml(child, inherited)).join("");
}

function effectiveCrop(node: DeckNode, asset: ImageAsset): ImageCrop {
  const crop = node.image?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  if (node.image?.fit !== "cover") return crop;
  const availableWidth = asset.width * (1 - crop.left - crop.right);
  const availableHeight = asset.height * (1 - crop.top - crop.bottom);
  const frameAspect = node.geometry.width / node.geometry.height;
  const sourceAspect = availableWidth / availableHeight;
  if (sourceAspect > frameAspect) {
    const targetWidth = availableHeight * frameAspect;
    const extra = (availableWidth - targetWidth) / 2 / asset.width;
    return { ...crop, left: crop.left + extra, right: crop.right + extra };
  }
  const targetHeight = availableWidth / frameAspect;
  const extra = (availableHeight - targetHeight) / 2 / asset.height;
  return { ...crop, top: crop.top + extra, bottom: crop.bottom + extra };
}

function imageSvg(asset: ImageAsset, uri: string, node: DeckNode): string {
  const crop = effectiveCrop(node, asset);
  const x = asset.width * crop.left;
  const y = asset.height * crop.top;
  const width = asset.width * (1 - crop.left - crop.right);
  const height = asset.height * (1 - crop.top - crop.bottom);
  const fit = node.image?.fit ?? "contain";
  const preserve = fit === "stretch" ? "none" : fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
  const opacity = node.image?.opacity ?? 1;
  return `<svg width="${number(node.geometry.width)}" height="${number(node.geometry.height)}" viewBox="${number(x)} ${number(y)} ${number(width)} ${number(height)}" preserveAspectRatio="${preserve}" overflow="hidden"><image href="${uri}" x="0" y="0" width="${number(asset.width)}" height="${number(asset.height)}" preserveAspectRatio="none" opacity="${number(opacity)}"/></svg>`;
}

function renderText(node: DeckNode, document: DeckDocument): string {
  const content = node.content as PMNodeJSON;
  const baseSize = typeof node.style.fontSize === "number" ? node.style.fontSize : 24;
  const baseColor = node.style.color ?? node.style.fill ?? document.theme?.colors?.text1 ?? "#111827";
  const baseFont = node.style.fontFamily ?? node.style.fontFace ?? document.theme?.bodyFontFamily ?? document.theme?.fontFamily ?? "Aptos";
  const fontStyle = `font-family:${xml(baseFont)};font-size:${number(baseSize)}px;color:${xml(baseColor)};line-height:${number(baseSize * 1.2)}px`;
  return `<foreignObject x="0" y="0" width="${number(node.geometry.width)}" height="${number(node.geometry.height)}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;${fontStyle}">${renderHtmlBlocks(content, baseSize, { color: String(baseColor), fontFamily: String(baseFont), fontSize: baseSize })}</div></foreignObject>`;
}

function renderHtmlBlocks(node: PMNodeJSON, baseSize: number, inherited: TextStyle): string {
  if (node.type === "doc") return (node.content ?? []).map(child => renderHtmlBlocks(child, baseSize, inherited)).join("");
  if (node.type === "paragraph" || node.type === "heading") {
    const attrs = node.attrs ?? {};
    const level = node.type === "heading" && typeof attrs.level === "number" ? attrs.level : undefined;
    const size = level ? baseSize * Math.max(1, 1.6 - (level - 1) * 0.15) : undefined;
    const styles = [
      "margin:0",
      attrs.align ? `text-align:${attrs.align}` : "",
      typeof attrs.lineHeight === "number" ? `line-height:${number(attrs.lineHeight)}px` : "",
      typeof attrs.spaceBefore === "number" ? `margin-top:${number(attrs.spaceBefore)}px` : "",
      typeof attrs.spaceAfter === "number" ? `margin-bottom:${number(attrs.spaceAfter)}px` : "",
      typeof attrs.indent === "number" ? `margin-left:${number(attrs.indent)}px` : "",
      typeof attrs.firstLineIndent === "number" ? `text-indent:${number(attrs.firstLineIndent)}px` : "",
      level ? "font-weight:700" : "",
      size ? `font-size:${number(size)}px` : "",
    ].filter(Boolean).join(";");
    const tag = level ? `h${Math.max(1, Math.min(6, level))}` : "p";
    return `<${tag} style="${xml(styles)}">${inlineHtml(node, inherited)}</${tag}>`;
  }
  if (node.type === "bullet_list" || node.type === "ordered_list") {
    const tag = node.type === "bullet_list" ? "ul" : "ol";
    const start = node.type === "ordered_list" && typeof node.attrs?.order === "number" ? ` start="${number(node.attrs.order)}"` : "";
    return `<${tag}${start} style="margin:0;padding-left:32px">${(node.content ?? []).map(child => renderHtmlBlocks(child, baseSize, inherited)).join("")}</${tag}>`;
  }
  if (node.type === "list_item") return `<li>${(node.content ?? []).map(child => renderHtmlBlocks(child, baseSize, inherited)).join("")}</li>`;
  if (node.type === "blockquote") return `<blockquote style="margin:0 0 0 24px">${(node.content ?? []).map(child => renderHtmlBlocks(child, baseSize, inherited)).join("")}</blockquote>`;
  return inlineHtml(node, inherited);
}

function renderTable(node: DeckNode, document: DeckDocument): string {
  const table = node.table!;
  const width = node.geometry.width, height = node.geometry.height;
  const columnSizes = table.columnWidths ?? Array.from({ length: table.rows[0]!.cells.length }, () => width / table.rows[0]!.cells.length);
  const columnSum = columnSizes.reduce((sum, item) => sum + item, 0);
  const widths = columnSizes.map(value => value / columnSum * width);
  const rowSizes = table.rows.map(row => row.height ?? height / table.rows.length);
  const rowSum = rowSizes.reduce((sum, item) => sum + item, 0);
  const heights = rowSizes.map(value => value / rowSum * height);
  const headerFill = document.theme?.colors?.accent1 ?? "#2F855A";
  const defaultColor = document.theme?.colors?.text1 ?? "#18221C";
  let top = 0;
  const rows = table.rows.map((row, rowIndex) => {
    let left = 0;
    const cells = row.cells.map((cell, columnIndex) => {
      const cellWidth = widths[columnIndex]!;
      const cellHeight = heights[rowIndex]!;
      const style = cell.style ?? {};
      const background = style.fill ?? (rowIndex < (table.headerRows ?? 0) ? headerFill : "#FFFFFF");
      const color = style.color ?? (rowIndex < (table.headerRows ?? 0) ? "#FFFFFF" : defaultColor);
      const font = style.fontFamily ?? document.theme?.bodyFontFamily ?? document.theme?.fontFamily ?? "Aptos";
      const fontSize = style.fontSize ?? (typeof node.style.fontSize === "number" ? node.style.fontSize : 16);
      const textAlign = style.align ?? "left";
      const text = `<foreignObject x="${number(left + 6)}" y="${number(top + 4)}" width="${number(Math.max(0, cellWidth - 12))}" height="${number(Math.max(0, cellHeight - 8))}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;font-family:${xml(font)};font-size:${number(fontSize)}px;line-height:${number(fontSize * 1.2)}px;color:${xml(color)};font-weight:${rowIndex < (table.headerRows ?? 0) ? "700" : "400"};text-align:${textAlign}">${renderHtmlBlocks(cell.content, fontSize, { color, fontFamily: font, fontSize, bold: rowIndex < (table.headerRows ?? 0) })}</div></foreignObject>`;
      const output = `<g data-cell-id="${xml(cell.id)}"><rect x="${number(left)}" y="${number(top)}" width="${number(cellWidth)}" height="${number(cellHeight)}" fill="${xml(background)}" stroke="${xml(table.borderColor ?? "#D1D5DB")}" stroke-width="${number(table.borderWidth ?? 1)}"/>${text}</g>`;
      left += cellWidth;
      return output;
    }).join("");
    const output = `<g data-row-id="${xml(row.id)}">${cells}</g>`;
    top += heights[rowIndex]!;
    return output;
  }).join("");
  return rows;
}

function chartColor(document: DeckDocument, index: number, supplied?: string): string {
  if (supplied) return supplied;
  const theme = document.theme?.colors;
  return theme?.[THEME_COLORS[index % THEME_COLORS.length]!] ?? ["#2F855A", "#3182CE", "#DD6B20", "#805AD5", "#D53F8C", "#718096"][index % 6]!;
}

function renderChart(node: DeckNode, document: DeckDocument): string {
  const chart = node.chart!;
  const width = node.geometry.width, height = node.geometry.height;
  const left = 36, right = 12, top = chart.title ? 34 : 12, bottom = chart.legend ? 54 : 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = chart.series.flatMap(series => series.values);
  const maxValue = Math.max(0, ...values), minValue = Math.min(0, ...values);
  const range = maxValue - minValue || 1;
  let content = "";
  if (chart.type === "pie") {
    const series = chart.series[0]!;
    const total = series.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const radius = Math.max(1, Math.min(plotWidth, plotHeight) / 2);
    const cx = left + plotWidth / 2, cy = top + plotHeight / 2;
    let angle = -Math.PI / 2;
    content = series.values.map((value, index) => {
      const slice = Math.max(0, value) / total * Math.PI * 2;
      const start = angle;
      const end = angle + slice;
      const x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(end), y2 = cy + radius * Math.sin(end);
      const large = slice > Math.PI ? 1 : 0;
      const path = `M ${number(cx)} ${number(cy)} L ${number(x1)} ${number(y1)} A ${number(radius)} ${number(radius)} 0 ${large} 1 ${number(x2)} ${number(y2)} Z`;
      angle = end;
      const labelAngle = start + slice / 2;
      const labelX = cx + radius * 0.58 * Math.cos(labelAngle);
      const labelY = cy + radius * 0.58 * Math.sin(labelAngle);
      const percent = Math.round(Math.max(0, value) / total * 100);
      const label = chart.dataLabels ? `<text x="${number(labelX)}" y="${number(labelY)}" text-anchor="middle" font-size="11" fill="#18221C">${xml(`${chart.categories[index]} ${value} (${percent}%)`)}</text>` : "";
      return `<path d="${path}" fill="${xml(chartColor(document, index))}" data-category="${xml(chart.categories[index])}"/>${label}`;
    }).join("");
  } else {
    const zeroY = top + maxValue / range * plotHeight;
    content += `<path d="M ${left} ${number(top)} V ${number(top + plotHeight)} M ${left} ${number(zeroY)} H ${number(left + plotWidth)}" fill="none" stroke="#9CA3AF"/>`;
    const groupWidth = plotWidth / chart.categories.length;
    chart.series.forEach((series, seriesIndex) => {
      const color = chartColor(document, seriesIndex, series.color);
      const points = series.values.map((value, categoryIndex) => ({
        x: left + groupWidth * (categoryIndex + 0.5),
        y: top + (maxValue - value) / range * plotHeight,
        value,
      }));
      if (chart.type === "line") {
        content += `<polyline points="${points.map(point => `${number(point.x)},${number(point.y)}`).join(" ")}" fill="none" stroke="${xml(color)}" stroke-width="3"/>`;
        content += points.map(point => `<circle cx="${number(point.x)}" cy="${number(point.y)}" r="4" fill="${xml(color)}"/>`).join("");
        if (chart.dataLabels) content += points.map(point => `<text x="${number(point.x + 6)}" y="${number(point.y - 8)}" font-size="11" fill="${xml(document.theme?.colors?.text1 ?? "#18221C")}">${number(point.value)}</text>`).join("");
      } else {
        const barWidth = groupWidth / Math.max(1, chart.series.length + 1);
        content += points.map((point, categoryIndex) => {
          const barHeight = Math.abs(zeroY - point.y);
          const x = point.x - groupWidth / 2 + barWidth * (seriesIndex + 0.5);
          const y = Math.min(zeroY, point.y);
          const rect = `<rect x="${number(x)}" y="${number(y)}" width="${number(barWidth * 0.82)}" height="${number(barHeight)}" fill="${xml(color)}" data-category="${xml(chart.categories[categoryIndex])}"/>`;
          const label = chart.dataLabels ? `<text x="${number(x + barWidth * 0.41)}" y="${number(y - 6)}" text-anchor="middle" font-size="11" fill="${xml(document.theme?.colors?.text1 ?? "#18221C")}">${number(point.value)}</text>` : "";
          return rect + label;
        }).join("");
      }
    });
    content += chart.categories.map((category, index) => `<text x="${number(left + groupWidth * (index + 0.5))}" y="${number(height - (chart.legend ? 28 : 8))}" text-anchor="middle" font-size="12" fill="#4B5563">${xml(category)}</text>`).join("");
  }
  const title = chart.title ? `<text x="${number(width / 2)}" y="22" text-anchor="middle" font-family="${xml(document.theme?.headingFontFamily ?? document.theme?.fontFamily ?? "Aptos Display")}" font-size="18" font-weight="bold" fill="${xml(document.theme?.colors?.text1 ?? "#18221C")}">${xml(chart.title)}</text>` : "";
  const legendLabels = chart.type === "pie" ? chart.categories : chart.series.map(series => series.name);
  const legend = chart.legend ? legendLabels.map((label, index) => {
    const slot = plotWidth / Math.max(1, legendLabels.length);
    const x = left + index * slot;
    const y = height - 8;
    return `<g data-legend-item="${xml(label)}"><rect x="${number(x)}" y="${number(y - 9)}" width="10" height="10" fill="${xml(chartColor(document, index, chart.type === "pie" ? undefined : chart.series[index]?.color))}"/><text x="${number(x + 14)}" y="${number(y)}" font-size="10" fill="${xml(document.theme?.colors?.text1 ?? "#18221C")}">${xml(label)}</text></g>`;
  }).join("") : "";
  return `${title}${content}${legend}`;
}

function nodeTransform(node: DeckNode): string {
  const { x, y, rotation } = node.geometry;
  return `translate(${number(x)} ${number(y)}) rotate(${number(rotation)})`;
}

async function drawNode(document: DeckDocument, node: DeckNode, resolver?: AssetResolver): Promise<string> {
  if (node.hidden) return "";
  const { width, height } = node.geometry;
  let body = "";
  if (node.kind === "group") {
    const children = await Promise.all((node.children ?? []).map(id => drawNode(document, document.nodes[id]!, resolver)));
    body = children.join("");
  } else if (node.kind === "shape") {
    const fill = node.style.fill ?? "#dbeafe";
    const stroke = node.style.stroke ?? "none";
    const strokeWidth = typeof node.style.strokeWidth === "number" ? node.style.strokeWidth : 1;
    body = `<rect width="${number(width)}" height="${number(height)}" fill="${xml(fill)}" stroke="${xml(stroke)}" stroke-width="${number(strokeWidth)}"/>`;
  } else if (node.kind === "text") {
    body = renderText(node, document);
  } else if (node.kind === "image") {
    const { asset, bytes } = await imageBytes(document, node, resolver);
    body = imageSvg(asset, imageDataUri(asset, bytes), node);
  } else if (node.kind === "table") {
    body = renderTable(node, document);
  } else if (node.kind === "chart") {
    body = renderChart(node, document);
  }
  return `<g data-node-id="${xml(node.id)}" transform="${nodeTransform(node)}">${body}</g>`;
}

export async function renderDeckSvg(document: DeckDocument, pageId = document.pages[0]?.id, resolveAsset?: AssetResolver): Promise<string> {
  validateDocument(document);
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) throw new Error(`Page ${pageId} does not exist.`);
  const children = await Promise.all(page.children.map(id => drawNode(document, document.nodes[id]!, resolveAsset)));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${number(page.width)}" height="${number(page.height)}" viewBox="0 0 ${number(page.width)} ${number(page.height)}" data-document-id="${xml(document.documentId)}" data-revision="${document.revision}"><title>${xml(document.name)} — ${xml(page.name)}</title><rect width="100%" height="100%" fill="${xml(document.theme?.colors?.background1 ?? "#FFFFFF")}"/>${children.join("")}</svg>`;
}

export { exportDeckPptx } from "./pptx.ts";
export { exportDeckPdf, renderDeckPng } from "./raster.ts";
export { renderWebHtml, exportWebZip, buildWebSource, exportWebSourceZip, renderWebPng, exportWebPdf } from "./web.ts";
export { renderWebMarkup, renderWebStyles } from "./web-markup.ts";
export * from "./artifact.ts";
