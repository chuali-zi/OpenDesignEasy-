import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { geometryMatrix, identityMatrix, multiplyMatrix, transformPoint, validateDocument } from "@oeydesign/document";
import type { DeckDocument, DeckNode, Matrix, PMMarkJSON, PMNodeJSON } from "@oeydesign/document";

const LOGICAL_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const DEFAULT_FONT_FACE = "Aptos";

type ExportStyle = DeckNode["style"];
type TextAlignment = "left" | "center" | "right" | "justify";
type TextRunOptions = {
  bold?: boolean;
  italic?: boolean;
  breakLine?: boolean;
  align?: TextAlignment;
  bullet?: true | { type: "number" };
  indentLevel?: number;
  fontSize?: number;
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
};
type ExportPresentation = {
  ShapeType: { rect: string };
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
type Paragraph = { runs: TextRun[]; context: BlockContext; headingLevel?: number };

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

async function normalizeParagraphProperties(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  for (const name of slideNames) {
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("string");
    zip.file(name, retainOneParagraphProperties(xml));
  }
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
    return [{
      runs,
      context,
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
  if (node.type === "text" || node.type === "hard_break") return [{ runs: inlineRuns(node, target), context }];
  if (node.content?.length) return node.content.flatMap((child) => collectParagraphs(child, target, context));
  throw new Error(`Text node ${target} contains unsupported content node ${node.type}.`);
}

function textRuns(node: DeckNode): TextRun[] {
  const paragraphs = collectParagraphs(node.content as PMNodeJSON, node.id);
  const output: TextRun[] = [];
  const alignValue = styleString(node.style, "textAlign") ?? styleString(node.style, "align");
  const align = alignValue === undefined ? undefined : ["left", "center", "right", "justify"].includes(alignValue) ? alignValue as TextAlignment : undefined;
  if (alignValue !== undefined && align === undefined) throw new Error(`Text node ${node.id} has unsupported alignment ${JSON.stringify(alignValue)}.`);
  const explicitFontSize = node.style.fontSize;
  if (explicitFontSize !== undefined && (typeof explicitFontSize !== "number" || !Number.isFinite(explicitFontSize) || explicitFontSize <= 0)) {
    throw new Error(`Text node ${node.id} has unsupported fontSize; expected a positive logical-pixel number.`);
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
        if (align) options.align = align;
        if (paragraph.context.bullet) options.bullet = paragraph.context.bullet;
        if (paragraph.context.indentLevel) options.indentLevel = paragraph.context.indentLevel;
      }
      if (runIndex === paragraphRuns.length - 1 && index < paragraphs.length - 1) options.breakLine = true;
      output.push({ text: run.text ?? "", options });
    }
  }
  return output;
}

function textColor(node: DeckNode): string {
  const value = node.style.color ?? node.style.fill ?? "#111827";
  return color(value, `Text node ${node.id}`);
}

function textFont(node: DeckNode): string | undefined {
  return styleString(node.style, "fontFace") ?? styleString(node.style, "fontFamily");
}

function addText(slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>, themeFont: string): void {
  const fontSize = node.style.fontSize;
  if (fontSize !== undefined && (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0)) {
    throw new Error(`Text node ${node.id} has unsupported fontSize; expected a positive logical-pixel number.`);
  }
  const position = pptxPosition(document, node, memo);
  slide.addText(textRuns(node), {
    ...position,
    fontFace: textFont(node) ?? themeFont,
    fontSize: (typeof fontSize === "number" ? fontSize : 24) * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH,
    color: textColor(node),
    valign: (styleString(node.style, "verticalAlign") ?? "top") as "top" | "middle" | "bottom",
    margin: 0,
    wrap: true,
    fit: "shrink",
    fill: { color: "FFFFFF", transparency: 100 },
    line: { color: "FFFFFF", transparency: 100 },
  });
}

function addShape(pptx: ExportPresentation, slide: ExportSlide, node: DeckNode, document: DeckDocument, memo: Map<string, Matrix>): void {
  const position = pptxPosition(document, node, memo);
  const fillValue = node.style.fill ?? "#dbeafe";
  const strokeValue = node.style.stroke;
  const fill = fillValue === "none" || fillValue === "transparent"
    ? { color: "FFFFFF", transparency: 100 }
    : { color: color(fillValue, `Shape node ${node.id} fill`) };
  const stroke = strokeValue === undefined || strokeValue === "none" || strokeValue === "transparent"
    ? { color: "FFFFFF", transparency: 100 }
    : { color: color(strokeValue, `Shape node ${node.id} stroke`), width: typeof node.style.strokeWidth === "number" ? node.style.strokeWidth * POINTS_PER_INCH / LOGICAL_PIXELS_PER_INCH : 0.75 };
  slide.addShape(pptx.ShapeType.rect, { ...position, fill, line: stroke });
}

function addNode(pptx: ExportPresentation, slide: ExportSlide, document: DeckDocument, node: DeckNode, memo: Map<string, Matrix>, themeFont: string): void {
  if (node.hidden) return;
  if (node.kind === "group") {
    for (const childId of node.children ?? []) {
      const child = document.nodes[childId];
      if (!child) throw new Error(`Group ${node.id} refers to missing child ${childId}.`);
      addNode(pptx, slide, document, child, memo, themeFont);
    }
    return;
  }
  if (node.kind === "image") throw new Error(`Cannot export image node ${node.id}: media export has no asset-byte resolver yet.`);
  if (node.kind === "text") {
    addText(slide, node, document, memo, themeFont);
    return;
  }
  addShape(pptx, slide, node, document, memo);
}

/** Exports editable text and rectangle shapes. Groups are flattened while retaining their world geometry. */
export async function exportDeckPptx(document: DeckDocument): Promise<Uint8Array> {
  validateDocument(document);
  const [firstPage, ...remainingPages] = document.pages;
  if (!firstPage) throw new Error("A Deck requires at least one page.");
  const mixedPage = remainingPages.find((page) => page.width !== firstPage.width || page.height !== firstPage.height);
  if (mixedPage) {
    throw new Error(`Cannot export mixed page sizes: ${firstPage.id} is ${firstPage.width}x${firstPage.height}, but ${mixedPage.id} is ${mixedPage.width}x${mixedPage.height}; PPTX uses one size for every slide.`);
  }

  const unsupportedImage = Object.values(document.nodes).find((node) => node.kind === "image");
  if (unsupportedImage) throw new Error(`Cannot export image node ${unsupportedImage.id}: media export has no asset-byte resolver yet.`);

  const fontFaces = Object.values(document.nodes).filter((node) => node.kind === "text").map(textFont).filter((font): font is string => Boolean(font));
  const themeFont = fontFaces[0] ?? DEFAULT_FONT_FACE;
  const pptx = new PptxConstructor();
  pptx.defineLayout({ name: "OEY_CUSTOM", width: firstPage.width / LOGICAL_PIXELS_PER_INCH, height: firstPage.height / LOGICAL_PIXELS_PER_INCH });
  pptx.layout = "OEY_CUSTOM";
  pptx.title = document.name;
  pptx.subject = `OEY document ${document.documentId}, revision ${document.revision}`;
  pptx.revision = String(document.revision);
  pptx.theme = { headFontFace: themeFont, bodyFontFace: themeFont };

  const memo = new Map<string, Matrix>();
  for (const page of document.pages) {
    const slide = pptx.addSlide();
    for (const nodeId of page.children) {
      const node = document.nodes[nodeId];
      if (!node) throw new Error(`Page ${page.id} refers to missing node ${nodeId}.`);
      addNode(pptx, slide, document, node, memo, themeFont);
    }
  }

  const output = await pptx.write({ outputType: "uint8array", compression: true });
  if (!(output instanceof Uint8Array)) throw new Error("PptxGenJS did not return a Uint8Array for the PPTX export.");
  return normalizeParagraphProperties(output);
}
