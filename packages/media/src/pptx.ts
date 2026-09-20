import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { geometryMatrix, identityMatrix, multiplyMatrix, transformPoint, validateDocument } from "@oeydesign/document";
import type { DeckDocument, DeckNode, ImageAsset, ImageCrop, Matrix, PMMarkJSON, PMNodeJSON } from "@oeydesign/document";
import { imageBytes } from "./assets.ts";
import type { AssetResolver } from "./assets.ts";

const LOGICAL_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const DEFAULT_FONT_FACE = "Aptos";

type ExportStyle = DeckNode["style"];
type TextAlignment = "left" | "center" | "right" | "justify";
type TextRunOptions = {
  bold?: boolean;
  italic?: boolean;
  underline?: { style: "sng" };
  strike?: boolean | "sngStrike";
  breakLine?: boolean;
  align?: TextAlignment;
  bullet?: true | { type: "number" };
  indentLevel?: number;
  lineSpacing?: number;
  paraSpaceBefore?: number;
  paraSpaceAfter?: number;
  fontSize?: number;
  fontFace?: string;
  color?: string;
  highlight?: string;
  hyperlink?: { url: string };
};
type TextRun = { text: string; options?: TextRunOptions };
type ExportSlide = {
  addText(text: TextRun[], options: {
    x: number; y: number; w: number; h: number; rotate: number; objectName: string;
    fontFace: string; fontSize: number; color: string; valign: "top" | "middle" | "bottom";
    margin: number; wrap: boolean; fit: "none" | "shrink" | "resize";
    fill: { color: string; transparency: number }; line: { color: string; transparency: number };
  }): void;
  addShape(shape: string, options: {
    x: number; y: number; w: number; h: number; rotate: number; objectName: string;
    fill: { color: string; transparency?: number }; line: { color: string; transparency?: number; width?: number };
  }): void;
  addImage(options: { data: string; x: number; y: number; w: number; h: number; rotate: number; transparency: number; objectName: string; altText: string }): void;
  addTable(rows: unknown[][], options: Record<string, unknown>): void;
  addChart(type: string, data: unknown[], options: Record<string, unknown>): void;
};
type ExportPresentation = {
  ShapeType: { rect: string };
  ChartType: { bar: string; line: string; pie: string };
  layout: string;
  title: string;
  subject: string;
  revision: string;
  theme: { headFontFace: string; bodyFontFace: string };
  defineLayout(layout: { name: string; width: number; height: number }): void;
  addSlide(): ExportSlide;
  write(options: { outputType: "uint8array"; compression: boolean }): Promise<unknown>;
};
type ExportPresentationConstructor = new () => ExportPresentation;
type BlockContext = { bullet?: true | { type: "number" }; indentLevel?: number };
type ParagraphAttributes = { align?: TextAlignment; lineHeight?: number; spaceBefore?: number; spaceAfter?: number; indent?: number; firstLineIndent?: number };
type Paragraph = { runs: TextRun[]; context: BlockContext; attributes: ParagraphAttributes; headingLevel?: number };
type ImageCropRef = { nodeId: string; objectName: string; crop: ImageCrop };
type ParagraphPropertiesRef = { objectName: string; paragraphs: ParagraphAttributes[] };
type GraphicFrameRef = { objectName: string; rotation: number };

const PptxConstructor = PptxGenJS as unknown as ExportPresentationConstructor;

function retainOneParagraphProperties(xml: string): string {
  // PptxGenJS 4.0.1 repeats pPr for rich-text runs; DrawingML permits one per paragraph.
  // This only processes slides generated above, preserving each run's rPr and text.
  return xml.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (paragraph) => {
    let keptFirst = false;
    return paragraph.replace(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (properties) => {
      if (keptFirst) return "";
      keptFirst = true;
      return properties;
    });
  });
}

function escapedAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchParagraphIndent(xml: string, attributes: ParagraphAttributes): string {
  if (attributes.indent === undefined && attributes.firstLineIndent === undefined) return xml;
  const margin = Math.round(((attributes.indent ?? 0) + (attributes.firstLineIndent ?? 0)) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH * 12700);
  const indent = Math.round((attributes.firstLineIndent ?? 0) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH * 12700);
  return xml.replace(/<a:pPr\b([^>]*?)(\s*\/?>)/, (_match, rawAttributes: string, close: string) => {
    const set = (input: string, name: string, value: number) => {
      const expression = new RegExp(`\\b${name}="[^"]*"`);
      return expression.test(input) ? input.replace(expression, `${name}="${value}"`) : `${input} ${name}="${value}"`;
    };
    return `<a:pPr${set(set(rawAttributes, "marL", margin), "indent", indent)}${close}`;
  });
}

function patchSlideXml(xml: string, crops: ImageCropRef[], paragraphs: ParagraphPropertiesRef[], frames: GraphicFrameRef[]): string {
  let result = retainOneParagraphProperties(xml);
  for (const reference of paragraphs) {
    const objectName = escapedRegExp(escapedAttribute(reference.objectName));
    result = result.replace(new RegExp(`<p:sp>(?:(?!<\\/p:sp>)[\\s\\S])*?<p:cNvPr\\b[^>]*\\bname="${objectName}"[^>]*>(?:(?!<\\/p:sp>)[\\s\\S])*?<p:txBody>([\\s\\S]*?)<\\/p:txBody>(?:(?!<\\/p:sp>)[\\s\\S])*?<\\/p:sp>`), (shape) => {
      let index = 0;
      return shape.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (paragraph) => {
        const attributes = reference.paragraphs[index++];
        return attributes ? paragraph.replace(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/, (properties) => patchParagraphIndent(properties, attributes)) : paragraph;
      });
    });
  }
  for (const reference of crops) {
    const objectName = escapedRegExp(escapedAttribute(reference.objectName));
    result = result.replace(new RegExp(`<p:pic>(?:(?!<\\/p:pic>)[\\s\\S])*?<p:cNvPr\\b[^>]*\\bname="${objectName}"[^>]*>(?:(?!<\\/p:pic>)[\\s\\S])*?<p:blipFill>([\\s\\S]*?)<\\/p:blipFill>(?:(?!<\\/p:pic>)[\\s\\S])*?<\\/p:pic>`), (picture) => {
      const { crop } = reference;
      const sourceRect = `<a:srcRect l="${Math.round(crop.left * 100000)}" t="${Math.round(crop.top * 100000)}" r="${Math.round(crop.right * 100000)}" b="${Math.round(crop.bottom * 100000)}"/>`;
      return picture.replace(/<a:stretch><a:fillRect\s*\/>\s*<\/a:stretch>/, `${sourceRect}<a:stretch><a:fillRect/></a:stretch>`);
    });
  }
  for (const reference of frames) {
    const objectName = escapedRegExp(escapedAttribute(reference.objectName));
    const rotation = Math.round(((reference.rotation % 360 + 360) % 360) * 60000);
    result = result.replace(new RegExp(`<p:graphicFrame>(?:(?!<\\/p:graphicFrame>)[\\s\\S])*?<p:cNvPr\\b[^>]*\\bname="${objectName}"[^>]*>(?:(?!<\\/p:graphicFrame>)[\\s\\S])*?<p:xfrm\\b[^>]*>(?:(?!<\\/p:graphicFrame>)[\\s\\S])*?<\\/p:xfrm>(?:(?!<\\/p:graphicFrame>)[\\s\\S])*?<\\/p:graphicFrame>`), (frame) => {
      return frame.replace(/<p:xfrm\b([^>]*)>/, (_match, attributes: string) => `<p:xfrm${attributes.replace(/\s+rot="[^"]*"/, "")} rot="${rotation}">`);
    });
  }
  return result;
}

function patchThemeXml(xml: string, theme: DeckDocument["theme"]): string {
  if (!theme) return xml;
  const colorNames = { text1: "dk1", text2: "dk2", background1: "lt1", background2: "lt2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6" } as const;
  for (const [key, slot] of Object.entries(colorNames) as Array<[keyof typeof colorNames, string]>) {
    const color = theme.colors?.[key];
    if (!color) continue;
    const safeColor = color.replace(/^#/, "").toUpperCase();
    xml = xml.replace(new RegExp(`<a:${slot}>([\\s\\S]*?)<\\/a:${slot}>`), `<a:${slot}><a:srgbClr val="${safeColor}"/></a:${slot}>`);
  }
  const majorFont = theme.headingFontFamily ?? theme.fontFamily;
  const minorFont = theme.bodyFontFamily ?? theme.fontFamily;
  if (majorFont) xml = xml.replace(/(<a:majorFont>[\s\S]*?<a:latin\b[^>]*typeface=")[^"]*(")/, (_match, prefix: string, suffix: string) => `${prefix}${escapedAttribute(majorFont)}${suffix}`);
  if (minorFont) xml = xml.replace(/(<a:minorFont>[\s\S]*?<a:latin\b[^>]*typeface=")[^"]*(")/, (_match, prefix: string, suffix: string) => `${prefix}${escapedAttribute(minorFont)}${suffix}`);
  if (theme.name) xml = xml.replace(/<a:clrScheme\b[^>]*\bname="[^"]*"/, `<a:clrScheme name="${escapedAttribute(theme.name)}"`);
  return xml;
}

async function normalizePptx(bytes: Uint8Array, slideCrops: ImageCropRef[][], slideParagraphs: ParagraphPropertiesRef[][], slideFrames: GraphicFrameRef[][], theme: DeckDocument["theme"]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => Number(left.match(/slide(\d+)/)?.[1] ?? 0) - Number(right.match(/slide(\d+)/)?.[1] ?? 0));
  for (let index = 0; index < slideNames.length; index += 1) {
    const name = slideNames[index]!;
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("string");
    zip.file(name, patchSlideXml(xml, slideCrops[index] ?? [], slideParagraphs[index] ?? [], slideFrames[index] ?? []));
  }
  const themeEntry = zip.file("ppt/theme/theme1.xml");
  if (themeEntry) zip.file("ppt/theme/theme1.xml", patchThemeXml(await themeEntry.async("string"), theme));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function styleString(style: ExportStyle, key: string): string | undefined {
  const value = style[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function color(value: unknown, target: string): string {
  if (typeof value !== "string") throw new Error(`${target} must be a 3- or 6-digit hex color.`);
  const normalized = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(normalized)) return normalized.split("").map((character) => `${character}${character}`).join("").toUpperCase();
  if (/^[\da-f]{6}$/i.test(normalized)) return normalized.toUpperCase();
  throw new Error(`${target} color ${JSON.stringify(value)} is unsupported; use #RGB or #RRGGBB.`);
}

function nodeWorldMatrix(document: DeckDocument, node: DeckNode, memo: Map<string, Matrix>): Matrix {
  const cached = memo.get(node.id);
  if (cached) return cached;
  const parent = document.nodes[node.parentId];
  const parentWorld = parent ? nodeWorldMatrix(document, parent, memo) : identityMatrix();
  const world = multiplyMatrix(parentWorld, geometryMatrix(node.geometry));
  memo.set(node.id, world);
  return world;
}

function worldRotation(document: DeckDocument, node: DeckNode): number {
  let result = 0;
  let current: DeckNode | undefined = node;
  while (current) {
    result += current.geometry.rotation;
    current = document.nodes[current.parentId];
  }
  return ((result % 360) + 360) % 360;
}

function pptxPosition(document: DeckDocument, node: DeckNode, memo: Map<string, Matrix>) {
  const { width, height } = node.geometry;
  const center = transformPoint(nodeWorldMatrix(document, node, memo), { x: width / 2, y: height / 2 });
  return {
    x: (center.x - width / 2) / LOGICAL_PIXELS_PER_INCH,
    y: (center.y - height / 2) / LOGICAL_PIXELS_PER_INCH,
    w: width / LOGICAL_PIXELS_PER_INCH,
    h: height / LOGICAL_PIXELS_PER_INCH,
    rotate: worldRotation(document, node),
    objectName: styleString(node.style, "name") ?? node.id,
  };
}

function textMarks(marks: PMMarkJSON[] | undefined, target: string): TextRunOptions {
  const options: TextRunOptions = {};
  for (const mark of marks ?? []) {
    if (mark.type === "strong") options.bold = true;
    else if (mark.type === "em") options.italic = true;
    else if (mark.type === "underline") options.underline = { style: "sng" };
    else if (mark.type === "strike") options.strike = "sngStrike";
    else if (mark.type === "textStyle") {
      const attributes = mark.attrs ?? {};
      if (typeof attributes.color === "string") options.color = color(attributes.color, `Text node ${target} run color`);
      if (typeof attributes.backgroundColor === "string") options.highlight = color(attributes.backgroundColor, `Text node ${target} run highlight`);
      if (typeof attributes.fontFamily === "string") options.fontFace = attributes.fontFamily;
      if (typeof attributes.fontSize === "number") options.fontSize = attributes.fontSize * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH;
    }
    else if (mark.type === "link") {
      const href = mark.attrs?.href;
      if (typeof href !== "string" || !href.trim()) throw new Error(`Text node ${target} has a link mark without a valid href.`);
      options.hyperlink = { url: href };
    } else throw new Error(`Text node ${target} has unsupported mark ${mark.type}.`);
  }
  return options;
}

function inlineRuns(node: PMNodeJSON, target: string): TextRun[] {
  if (node.type === "text") return [{ text: node.text ?? "", options: textMarks(node.marks, target) }];
  if (node.type === "hard_break") return [{ text: "", options: { breakLine: true } }];
  return (node.content ?? []).flatMap((child) => inlineRuns(child, target));
}

function collectParagraphs(node: PMNodeJSON, target: string, context: BlockContext = {}): Paragraph[] {
  if (node.type === "paragraph" || node.type === "heading") {
    const runs = (node.content ?? []).flatMap((child) => inlineRuns(child, target));
    if (!runs.length) runs.push({ text: "", options: {} });
    const attributes = node.attrs ?? {};
    const alignValue = attributes.align;
    const align = alignValue === "left" || alignValue === "center" || alignValue === "right" || alignValue === "justify" ? alignValue : undefined;
    return [{
      runs,
      context,
      attributes: {
        ...(align ? { align } : {}),
        ...(typeof attributes.lineHeight === "number" ? { lineHeight: attributes.lineHeight } : {}),
        ...(typeof attributes.spaceBefore === "number" ? { spaceBefore: attributes.spaceBefore } : {}),
        ...(typeof attributes.spaceAfter === "number" ? { spaceAfter: attributes.spaceAfter } : {}),
        ...(typeof attributes.indent === "number" ? { indent: attributes.indent } : {}),
        ...(typeof attributes.firstLineIndent === "number" ? { firstLineIndent: attributes.firstLineIndent } : {}),
      },
      ...(node.type === "heading" && typeof node.attrs?.level === "number" ? { headingLevel: node.attrs.level } : {}),
    }];
  }
  if (node.type === "bullet_list" || node.type === "ordered_list") {
    const listContext: BlockContext = {
      ...context,
      bullet: node.type === "bullet_list" ? true : { type: "number" },
    };
    return (node.content ?? []).flatMap((child) => collectParagraphs(child, target, listContext));
  }
  if (node.type === "blockquote" || node.type === "list_item") {
    const childContext = node.type === "blockquote" ? { ...context, indentLevel: (context.indentLevel ?? 0) + 1 } : context;
    return (node.content ?? []).flatMap((child) => collectParagraphs(child, target, childContext));
  }
  if (node.type === "doc") return (node.content ?? []).flatMap((child) => collectParagraphs(child, target, context));
  if (node.type === "text" || node.type === "hard_break") return [{ runs: inlineRuns(node, target), context, attributes: {} }];
  if (node.content?.length) return node.content.flatMap((child) => collectParagraphs(child, target, context));
  throw new Error(`Text node ${target} contains unsupported content node ${node.type}.`);
}

function textRunsFor(content: PMNodeJSON, target: string, style: DeckNode["style"]): TextRun[] {
  const paragraphs = collectParagraphs(content, target);
  const output: TextRun[] = [];
  const alignValue = styleString(style, "textAlign") ?? styleString(style, "align");
  const align = alignValue === undefined ? undefined : ["left", "center", "right", "justify"].includes(alignValue) ? alignValue as TextAlignment : undefined;
  if (alignValue !== undefined && align === undefined) throw new Error(`Text node ${target} has unsupported alignment ${JSON.stringify(alignValue)}.`);
  const explicitFontSize = style.fontSize;
  if (explicitFontSize !== undefined && (typeof explicitFontSize !== "number" || !Number.isFinite(explicitFontSize) || explicitFontSize <= 0)) {
    throw new Error(`Text node ${target} has unsupported fontSize; expected a positive logical-pixel number.`);
  }
  const baseFontSize = typeof explicitFontSize === "number" ? explicitFontSize : 24;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    const fontScale = paragraph.headingLevel === undefined ? 1 : Math.max(1, 1.6 - (paragraph.headingLevel - 1) * 0.15);
    const paragraphRuns = paragraph.runs.length ? paragraph.runs : [{ text: "", options: {} }];
    for (let runIndex = 0; runIndex < paragraphRuns.length; runIndex += 1) {
      const run = paragraphRuns[runIndex]!;
      const options: TextRunOptions = { ...run.options };
      if (paragraph.headingLevel !== undefined && options.bold === undefined) options.bold = true;
      if (paragraph.headingLevel !== undefined && explicitFontSize === undefined) options.fontSize = baseFontSize * fontScale * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH;
      if (runIndex === 0) {
        if (paragraph.attributes.align ?? align) options.align = paragraph.attributes.align ?? align;
        if (paragraph.attributes.lineHeight !== undefined) options.lineSpacing = paragraph.attributes.lineHeight * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH;
        if (paragraph.attributes.spaceBefore !== undefined) options.paraSpaceBefore = paragraph.attributes.spaceBefore * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH;
        if (paragraph.attributes.spaceAfter !== undefined) options.paraSpaceAfter = paragraph.attributes.spaceAfter * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH;
        if (paragraph.context.bullet) options.bullet = paragraph.context.bullet;
        if (paragraph.context.indentLevel) options.indentLevel = paragraph.context.indentLevel;
      }
      if (runIndex === paragraphRuns.length - 1 && index < paragraphs.length - 1) options.breakLine = true;
      output.push({ text: run.text ?? "", options });
    }
  }
  return output;
}

function textRuns(node: DeckNode): TextRun[] {
  return textRunsFor(node.content as PMNodeJSON, node.id, node.style);
}

function textColor(node: DeckNode, document: DeckDocument): string {
  const value = node.style.color ?? node.style.fill ?? document.theme?.colors?.text1 ?? "#111827";
  return color(value, `Text node ${node.id}`);
}

function textFont(node: DeckNode, document?: DeckDocument): string | undefined {
  return styleString(node.style, "fontFace") ?? styleString(node.style, "fontFamily") ?? document?.theme?.bodyFontFamily ?? document?.theme?.fontFamily;
}

function addText(slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>, themeFont: string, paragraphRefs: ParagraphPropertiesRef[]): void {
  const fontSize = node.style.fontSize;
  if (fontSize !== undefined && (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0)) {
    throw new Error(`Text node ${node.id} has unsupported fontSize; expected a positive logical-pixel number.`);
  }
  const position = pptxPosition(document, node, memo);
  slide.addText(textRuns(node), {
    ...position,
    fontFace: textFont(node, document) ?? themeFont,
    fontSize: (typeof fontSize === "number" ? fontSize : 24) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH,
    color: textColor(node, document),
    valign: (styleString(node.style, "verticalAlign") ?? "top") as "top" | "middle" | "bottom",
    margin: 0,
    wrap: true,
    fit: "shrink",
    fill: { color: "FFFFFF", transparency: 100 },
    line: { color: "FFFFFF", transparency: 100 },
  });
  paragraphRefs.push({ objectName: position.objectName, paragraphs: collectParagraphs(node.content as PMNodeJSON, node.id).map((paragraph) => paragraph.attributes) });
}

function addShape(pptx: ExportPresentation, slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>): void {
  const position = pptxPosition(document, node, memo);
  const fillValue = node.style.fill ?? document.theme?.colors?.accent1 ?? "#dbeafe";
  const strokeValue = node.style.stroke;
  const fill = fillValue === "none" || fillValue === "transparent"
    ? { color: "FFFFFF", transparency: 100 }
    : { color: color(fillValue, `Shape node ${node.id} fill`) };
  const stroke = strokeValue === undefined || strokeValue === "none" || strokeValue === "transparent"
    ? { color: "FFFFFF", transparency: 100 }
    : { color: color(strokeValue, `Shape node ${node.id} stroke`), width: typeof node.style.strokeWidth === "number" ? node.style.strokeWidth * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH : 0.75 };
  slide.addShape(pptx.ShapeType.rect, { ...position, fill, line: stroke });
}

function imageCrop(node: DeckNode, asset: ImageAsset): ImageCrop | undefined {
  const crop = node.image?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  if (node.image?.fit !== "cover") return node.image?.crop;
  const availableWidth = asset.width * (1 - crop.left - crop.right);
  const availableHeight = asset.height * (1 - crop.top - crop.bottom);
  const frameAspect = node.geometry.width / node.geometry.height;
  const sourceAspect = availableWidth / availableHeight;
  if (sourceAspect > frameAspect) {
    const extra = (availableWidth - availableHeight * frameAspect) / 2 / asset.width;
    return { ...crop, left: crop.left + extra, right: crop.right + extra };
  }
  const extra = (availableHeight - availableWidth / frameAspect) / 2 / asset.height;
  return { ...crop, top: crop.top + extra, bottom: crop.bottom + extra };
}

function imagePosition(position: ReturnType<typeof pptxPosition>, node: DeckNode, asset: ImageAsset, crop?: ImageCrop) {
  if (node.image?.fit !== "contain") return position;
  const left = crop?.left ?? 0, right = crop?.right ?? 0, top = crop?.top ?? 0, bottom = crop?.bottom ?? 0;
  const sourceWidth = asset.width * (1 - left - right), sourceHeight = asset.height * (1 - top - bottom);
  const scale = Math.min(position.w * LOGICAL_PIXELS_PER_INCH / sourceWidth, position.h * LOGICAL_PIXELS_PER_INCH / sourceHeight);
  const width = sourceWidth * scale / LOGICAL_PIXELS_PER_INCH, height = sourceHeight * scale / LOGICAL_PIXELS_PER_INCH;
  return { ...position, x: position.x + (position.w - width) / 2, y: position.y + (position.h - height) / 2, w: width, h: height };
}

async function addImage(slide: ExportSlide, document: DeckDocument, node: DeckNode, memo: Map<string, Matrix>, resolveAsset: AssetResolver | undefined, crops: ImageCropRef[]): Promise<void> {
  const { asset, bytes } = await imageBytes(document, node, resolveAsset);
  const position = pptxPosition(document, node, memo);
  const crop = imageCrop(node, asset);
  slide.addImage({
    ...imagePosition(position, node, asset, crop),
    data: `data:${asset.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    rotate: position.rotate,
    transparency: Math.round((1 - (node.image?.opacity ?? 1)) * 100),
    objectName: position.objectName,
    altText: asset.name ?? node.id,
  });
  if (crop && (crop.left || crop.top || crop.right || crop.bottom)) crops.push({ nodeId: node.id, objectName: position.objectName, crop });
}

function addTable(slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>, themeFont: string, frames: GraphicFrameRef[]): void {
  const table = node.table!;
  const position = pptxPosition(document, node, memo);
  const headerRows = table.headerRows ?? 0;
  const headerFill = document.theme?.colors?.accent1 ?? "#2F855A";
  const text1 = document.theme?.colors?.text1 ?? "#18221C";
  const rows = table.rows.map((row, rowIndex) => row.cells.map((cell) => {
    const header = rowIndex < headerRows;
    const style = cell.style ?? {};
    return {
      text: textRunsFor(cell.content, `Table ${node.id} cell ${cell.id}`, {
        fontSize: style.fontSize ?? (typeof node.style.fontSize === "number" ? node.style.fontSize : 16),
        fontFamily: style.fontFamily ?? themeFont,
      }),
      options: {
        fill: { color: color(style.fill ?? (header ? headerFill : "#FFFFFF"), `Table ${node.id} cell ${cell.id} fill`) },
        color: color(style.color ?? (header ? "#FFFFFF" : text1), `Table ${node.id} cell ${cell.id} color`),
        fontFace: style.fontFamily ?? themeFont,
        fontSize: (style.fontSize ?? (typeof node.style.fontSize === "number" ? node.style.fontSize : 16)) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH,
        align: style.align ?? "left",
        bold: header,
        valign: "middle",
        margin: (table.cellPadding ?? 5) / LOGICAL_PIXELS_PER_INCH,
        border: { color: color(table.borderColor ?? "#D1D5DB", `Table ${node.id} border color`), pt: (table.borderWidth ?? 1) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH },
      },
    };
  }));
  const rawColumnWidths = table.columnWidths ?? Array.from({ length: table.rows[0]!.cells.length }, () => node.geometry.width / table.rows[0]!.cells.length);
  const columnTotal = rawColumnWidths.reduce((sum, width) => sum + width, 0);
  const availableColumnWidths = rawColumnWidths.map((width) => position.w * width / columnTotal);
  const rawRowHeights = table.rows.map((row) => row.height ?? node.geometry.height / table.rows.length);
  const rowTotal = rawRowHeights.reduce((sum, height) => sum + height, 0);
  const availableRowHeights = rawRowHeights.map((height) => position.h * height / rowTotal);
  slide.addTable(rows, {
    ...position,
    colW: availableColumnWidths,
    rowH: availableRowHeights,
    margin: (table.cellPadding ?? 5) / LOGICAL_PIXELS_PER_INCH,
    fontFace: themeFont,
    fontSize: (typeof node.style.fontSize === "number" ? node.style.fontSize : 16) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH,
    border: { color: color(table.borderColor ?? "#D1D5DB", `Table ${node.id} border color`), pt: (table.borderWidth ?? 1) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH },
    objectName: position.objectName,
    autoPage: false,
  });
  frames.push({ objectName: position.objectName, rotation: position.rotate });
}

function addChart(pptx: ExportPresentation, slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>, frames: GraphicFrameRef[]): void {
  const chart = node.chart!;
  const position = pptxPosition(document, node, memo);
  const palette = (["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const)
    .flatMap((key) => document.theme?.colors?.[key] ? [document.theme.colors[key]!] : []);
  const defaults = ["#2F855A", "#3182CE", "#DD6B20", "#805AD5", "#D53F8C", "#718096"];
  const chartColors = chart.type === "pie"
    ? chart.categories.map((_, index) => color(palette[index % Math.max(1, palette.length)] ?? defaults[index % defaults.length]!, `Chart ${node.id} category ${index + 1} color`))
    : chart.series.map((series, index) => color(series.color ?? palette[index % Math.max(1, palette.length)] ?? defaults[index % defaults.length]!, `Chart ${node.id} series ${series.id} color`));
  const data = chart.series.map((series) => ({ name: series.name, labels: chart.categories, values: series.values }));
  slide.addChart(chart.type === "pie" ? pptx.ChartType.pie : chart.type === "line" ? pptx.ChartType.line : pptx.ChartType.bar, data, {
    ...position,
    objectName: position.objectName,
    title: chart.title,
    showTitle: Boolean(chart.title),
    showLegend: chart.legend ?? chart.type !== "pie",
    showValue: chart.dataLabels ?? false,
    showLabel: chart.type === "pie",
    showPercent: chart.type === "pie" && (chart.dataLabels ?? false),
    catAxisTitle: chart.xAxisTitle,
    valAxisTitle: chart.yAxisTitle,
    chartColors,
    titleFontFace: document.theme?.headingFontFamily ?? document.theme?.fontFamily ?? "Aptos Display",
    titleFontSize: 16,
    catAxisLabelFontFace: document.theme?.bodyFontFamily ?? document.theme?.fontFamily ?? "Aptos",
    valAxisLabelFontFace: document.theme?.bodyFontFamily ?? document.theme?.fontFamily ?? "Aptos",
  });
  frames.push({ objectName: position.objectName, rotation: position.rotate });
}

async function addNode(pptx: ExportPresentation, slide: ExportSlide, document: DeckDocument, node: DeckNode, memo: Map<string, Matrix>, themeFont: string, resolveAsset: AssetResolver | undefined, crops: ImageCropRef[], paragraphs: ParagraphPropertiesRef[], frames: GraphicFrameRef[]): Promise<void> {
  if (node.hidden) return;
  if (node.kind === "group") {
    for (const childId of node.children ?? []) {
      const child = document.nodes[childId];
      if (!child) throw new Error(`Group ${node.id} refers to missing child ${childId}.`);
      await addNode(pptx, slide, document, child, memo, themeFont, resolveAsset, crops, paragraphs, frames);
    }
    return;
  }
  if (node.kind === "image") {
    await addImage(slide, document, node, memo, resolveAsset, crops);
    return;
  }
  if (node.kind === "table") {
    addTable(slide, node, document, memo, themeFont, frames);
    return;
  }
  if (node.kind === "chart") {
    addChart(pptx, slide, node, document, memo, frames);
    return;
  }
  if (node.kind === "text") {
    addText(slide, node, document, memo, themeFont, paragraphs);
    return;
  }
  addShape(pptx, slide, node, document, memo);
}

/** Exports editable text, shapes, pictures, tables and charts. Groups retain child world geometry. */
export async function exportDeckPptx(document: DeckDocument, resolveAsset?: AssetResolver): Promise<Uint8Array> {
  validateDocument(document);
  const [firstPage, ...remainingPages] = document.pages;
  if (!firstPage) throw new Error("A Deck requires at least one page.");
  const mixedPage = remainingPages.find((page) => page.width !== firstPage.width || page.height !== firstPage.height);
  if (mixedPage) {
    throw new Error(`Cannot export mixed page sizes: ${firstPage.id} is ${firstPage.width}x${firstPage.height}, but ${mixedPage.id} is ${mixedPage.width}x${mixedPage.height}; PPTX uses one size for every slide.`);
  }

  const fontFaces = Object.values(document.nodes).filter((node) => node.kind === "text").map((node) => textFont(node, document)).filter((font): font is string => Boolean(font));
  const bodyFont = document.theme?.bodyFontFamily ?? document.theme?.fontFamily ?? fontFaces[0] ?? DEFAULT_FONT_FACE;
  const headingFont = document.theme?.headingFontFamily ?? document.theme?.fontFamily ?? bodyFont;
  const pptx = new PptxConstructor();
  pptx.defineLayout({ name: "OEY_CUSTOM", width: firstPage.width / LOGICAL_PIXELS_PER_INCH, height: firstPage.height / LOGICAL_PIXELS_PER_INCH });
  pptx.layout = "OEY_CUSTOM";
  pptx.title = document.name;
  pptx.subject = `OEY document ${document.documentId}, revision ${document.revision}`;
  pptx.revision = String(document.revision);
  pptx.theme = { headFontFace: headingFont, bodyFontFace: bodyFont };

  const memo = new Map<string, Matrix>();
  const slideCrops: ImageCropRef[][] = [];
  const slideParagraphs: ParagraphPropertiesRef[][] = [];
  const slideFrames: GraphicFrameRef[][] = [];
  for (const page of document.pages) {
    const slide = pptx.addSlide();
    const crops: ImageCropRef[] = [];
    const paragraphs: ParagraphPropertiesRef[] = [];
    const frames: GraphicFrameRef[] = [];
    for (const nodeId of page.children) {
      const node = document.nodes[nodeId];
      if (!node) throw new Error(`Page ${page.id} refers to missing node ${nodeId}.`);
      await addNode(pptx, slide, document, node, memo, bodyFont, resolveAsset, crops, paragraphs, frames);
    }
    slideCrops.push(crops);
    slideParagraphs.push(paragraphs);
    slideFrames.push(frames);
  }

  const output = await pptx.write({ outputType: "uint8array", compression: true });
  if (!(output instanceof Uint8Array)) throw new Error("PptxGenJS did not return a Uint8Array for the PPTX export.");
  return normalizePptx(output, slideCrops, slideParagraphs, slideFrames, document.theme);
}
