import { applyTextSteps, validateTextContent } from "./text.ts";
import { geometryMatrix, normalizeRotation, parentToWorld, worldToParent, type Matrix } from "./geometry.ts";
import { KernelError, invalid } from "./errors.ts";
import type { AssetCollection, ChartData, CommandEnvelope, DeckDocument, DeckNode, DeckPage, DocumentAsset, DocumentOperation, EditPrecondition, Geometry, ImageAsset, ImageSettings, Style, TableData, ThemePatch } from "./model.ts";

const clone = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stableId = (value: unknown): value is string => nonEmpty(value) && !["__proto__", "constructor", "prototype"].includes(value);
const geometryKeys = new Set(["x", "y", "width", "height", "rotation"]);
const themeColorKeys = new Set(["accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "text1", "text2", "background1", "background2"]);
const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const hasOwnNode = (document: DeckDocument, nodeId: string): boolean => Object.prototype.hasOwnProperty.call(document.nodes, nodeId);

function validateHexColor(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) invalid(`${label} must be a #RGB or #RRGGBB color`);
}

function validateImageAsset(asset: unknown, target: string): asserts asset is ImageAsset {
  if (!record(asset) || !stableId(asset.id) || asset.kind !== "image" || !imageMimeTypes.has(String(asset.mimeType)) || !finite(asset.width) || asset.width <= 0 || !finite(asset.height) || asset.height <= 0) {
    invalid("invalid image asset metadata", target);
  }
  if (asset.name !== undefined && (typeof asset.name !== "string" || !asset.name.trim())) invalid("image asset name must be non-empty", target);
  if (asset.sizeBytes !== undefined && (typeof asset.sizeBytes !== "number" || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0)) invalid("image asset sizeBytes must be a positive integer", target);
  if (asset.sha256 !== undefined && (typeof asset.sha256 !== "string" || !/^[\da-f]{64}$/i.test(asset.sha256))) invalid("image asset sha256 must be a 64-digit hexadecimal string", target);
}

function assetEntries(assets: AssetCollection | undefined): Array<[string, DocumentAsset]> {
  if (!assets) return [];
  return Array.isArray(assets) ? assets.map((asset) => [asset.id, asset]) : Object.entries(assets);
}

function findAsset(document: DeckDocument, assetId: string): DocumentAsset | undefined {
  const assets = document.assets;
  if (!assets) return undefined;
  if (Array.isArray(assets)) return assets.find((asset) => asset.id === assetId);
  return Object.prototype.hasOwnProperty.call(assets, assetId) ? assets[assetId] : undefined;
}

function storeAsset(document: DeckDocument, asset: ImageAsset): void {
  if (Array.isArray(document.assets)) document.assets.push(clone(asset));
  else {
    document.assets ??= {};
    (document.assets as Record<string, DocumentAsset>)[asset.id] = clone(asset);
  }
}

function validateImageSettings(settings: unknown, target: string): asserts settings is ImageSettings {
  if (!record(settings)) invalid("image settings must be an object", target);
  if (settings.fit !== undefined && !["contain", "cover", "stretch"].includes(String(settings.fit))) invalid("image fit must be contain, cover or stretch", target);
  if (settings.opacity !== undefined && (!finite(settings.opacity) || settings.opacity < 0 || settings.opacity > 1)) invalid("image opacity must be between 0 and 1", target);
  if (settings.crop !== undefined) {
    const crop = settings.crop;
    if (!record(crop)) invalid("image crop must be an object", target);
    const sides = [crop.left, crop.top, crop.right, crop.bottom];
    if (sides.some((side) => !finite(side) || side < 0 || side >= 1) || (crop.left as number) + (crop.right as number) >= 1 || (crop.top as number) + (crop.bottom as number) >= 1) invalid("image crop must use normalized insets whose opposing sums are less than 1", target);
  }
}

function validateTableData(table: unknown, target: string): asserts table is TableData {
  if (!record(table) || !Array.isArray(table.rows) || table.rows.length === 0) invalid("table node requires at least one row", target);
  const width = table.rows[0]?.cells?.length;
  if (!Number.isInteger(width) || width <= 0) invalid("table must contain at least one cell per row", target);
  const rowIds = new Set<string>();
  for (const row of table.rows) {
    if (!record(row) || !stableId(row.id) || rowIds.has(row.id) || !Array.isArray(row.cells) || row.cells.length !== width) invalid("table rows must have unique ids and the same non-zero number of cells", target);
    rowIds.add(row.id);
    if (row.height !== undefined && (!finite(row.height) || row.height <= 0)) invalid("table row height must be positive", row.id);
    const cellIds = new Set<string>();
    for (const cell of row.cells) {
      if (!record(cell) || !stableId(cell.id) || cellIds.has(cell.id)) invalid("table cells must have unique ids per row", row.id);
      cellIds.add(cell.id);
      if (!cell.content || !record(cell.content) || cell.content.type !== "doc") invalid("table cell content must be a rich-text doc", cell.id);
      validateTextContent(cell.content as never, `table cell ${cell.id}`);
      if (cell.style !== undefined) validateTableCellStyle(cell.style, cell.id);
    }
  }
  if (table.columnWidths !== undefined && (!Array.isArray(table.columnWidths) || table.columnWidths.length !== width || table.columnWidths.some((value) => !finite(value) || value <= 0))) invalid("table columnWidths must contain one positive value per column", target);
  if (table.headerRows !== undefined && (typeof table.headerRows !== "number" || !Number.isInteger(table.headerRows) || table.headerRows < 0 || table.headerRows > table.rows.length)) invalid("table headerRows is out of range", target);
  if (table.borderColor !== undefined) validateHexColor(table.borderColor, `table ${target} borderColor`);
  if (table.borderWidth !== undefined && (!finite(table.borderWidth) || table.borderWidth < 0)) invalid("table borderWidth must be non-negative", target);
  if (table.cellPadding !== undefined && (!finite(table.cellPadding) || table.cellPadding < 0)) invalid("table cellPadding must be non-negative", target);
}

function validateTableCellStyle(style: unknown, target: string): void {
  if (!record(style)) invalid("table cell style must be an object", target);
  if (style.fill !== undefined) validateHexColor(style.fill, `table cell ${target} fill`);
  if (style.color !== undefined) validateHexColor(style.color, `table cell ${target} color`);
  if (style.fontFamily !== undefined && (typeof style.fontFamily !== "string" || !style.fontFamily.trim())) invalid("table cell fontFamily must be non-empty", target);
  if (style.fontSize !== undefined && (!finite(style.fontSize) || style.fontSize <= 0)) invalid("table cell fontSize must be positive", target);
  if (style.align !== undefined && !["left", "center", "right"].includes(String(style.align))) invalid("table cell align must be left, center or right", target);
}

function validateChartData(chart: unknown, target: string): asserts chart is ChartData {
  if (!record(chart) || !["bar", "line", "pie"].includes(String(chart.type)) || !Array.isArray(chart.categories) || !chart.categories.length || chart.categories.some((category) => typeof category !== "string") || !Array.isArray(chart.series) || !chart.series.length) invalid("chart requires a supported type, categories and series", target);
  if (chart.type === "pie" && chart.series.length !== 1) invalid("pie charts require exactly one data series", target);
  const seriesIds = new Set<string>();
  for (const series of chart.series) {
    if (!record(series) || !stableId(series.id) || seriesIds.has(series.id) || typeof series.name !== "string" || !series.name.trim() || !Array.isArray(series.values) || series.values.length !== chart.categories.length || series.values.some((value) => !finite(value))) invalid("chart series must have a unique id, name, and one finite value per category", target);
    seriesIds.add(series.id);
    if (series.color !== undefined) validateHexColor(series.color, `chart series ${series.id} color`);
  }
  if (chart.title !== undefined && typeof chart.title !== "string") invalid("chart title must be a string", target);
  if (chart.xAxisTitle !== undefined && typeof chart.xAxisTitle !== "string" || chart.yAxisTitle !== undefined && typeof chart.yAxisTitle !== "string") invalid("chart axis titles must be strings", target);
  if (chart.legend !== undefined && typeof chart.legend !== "boolean" || chart.dataLabels !== undefined && typeof chart.dataLabels !== "boolean") invalid("chart legend and dataLabels must be boolean", target);
}

function validateTheme(theme: unknown): void {
  if (!record(theme)) invalid("Deck theme must be an object");
  for (const key of ["name", "fontFamily", "headingFontFamily", "bodyFontFamily"]) {
    const value = theme[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) invalid(`Deck theme ${key} must be non-empty`);
  }
  if (theme.colors !== undefined) {
    if (!record(theme.colors)) invalid("Deck theme colors must be an object");
    for (const [key, value] of Object.entries(theme.colors)) {
      if (!themeColorKeys.has(key)) invalid(`unsupported Deck theme color ${key}`);
      validateHexColor(value, `Deck theme ${key}`);
    }
  }
}

export function createDeckDocument(input: { documentId: string; name: string; pageId?: string }): DeckDocument {
  if (!stableId(input.documentId) || !nonEmpty(input.name)) invalid("documentId and name are required");
  const page: DeckPage = { id: input.pageId ?? `${input.documentId}-page-1`, name: "Page 1", width: 1280, height: 720, children: [] };
  const document: DeckDocument = { schemaVersion: 1, documentId: input.documentId, kind: "deck", revision: 0, name: input.name, pages: [page], nodes: {} };
  validateDocument(document);
  return document;
}

export function validateDocument(document: DeckDocument): void {
  if (!document || document.schemaVersion !== 1 || document.kind !== "deck") invalid("unsupported document schema or kind");
  if (!stableId(document.documentId) || !nonEmpty(document.name) || !Number.isInteger(document.revision) || document.revision < 0) invalid("invalid document header");
  if (!Array.isArray(document.pages) || !document.pages.length || !document.nodes || typeof document.nodes !== "object") invalid("deck must contain pages and nodes");
  if (document.theme !== undefined) validateTheme(document.theme);
  if (document.assets !== undefined && !Array.isArray(document.assets) && !record(document.assets)) invalid("assets must be an array or an id-keyed object");
  const assetIds = new Set<string>();
  for (const [key, asset] of assetEntries(document.assets)) {
    validateImageAsset(asset, key);
    if (!Array.isArray(document.assets) && key !== asset.id) invalid("asset map key must match its id", key);
    if (assetIds.has(asset.id)) invalid("asset ids must be unique", asset.id);
    assetIds.add(asset.id);
  }
  const ids = new Set<string>();
  for (const page of document.pages) {
    if (!stableId(page.id) || ids.has(page.id) || !nonEmpty(page.name) || !finite(page.width) || !finite(page.height) || page.width <= 0 || page.height <= 0 || !Array.isArray(page.children)) invalid("invalid page", page.id);
    ids.add(page.id);
    assertUniqueChildren(page.children, page.id);
  }
  for (const [key, node] of Object.entries(document.nodes)) {
    if (key !== node.id || !stableId(node.id) || ids.has(node.id)) invalid("node has an invalid or duplicate id", node.id);
    if (!["text", "shape", "image", "group", "table", "chart"].includes(node.kind)) invalid("unsupported node kind", node.id);
    if (!stableId(node.parentId) || !node.geometry || Object.keys(node.geometry).some((key) => !geometryKeys.has(key)) || !finite(node.geometry?.x) || !finite(node.geometry?.y) || !finite(node.geometry?.width) || !finite(node.geometry?.height) || !finite(node.geometry?.rotation) || node.geometry.width <= 0 || node.geometry.height <= 0) invalid("invalid node geometry", node.id);
    if (typeof node.locked !== "boolean" || typeof node.hidden !== "boolean" || !node.style || typeof node.style !== "object" || Array.isArray(node.style)) invalid("invalid node flags or style", node.id);
    if (node.kind === "image") {
      if (!stableId(node.assetId) || !assetIds.has(node.assetId)) invalid("image node must reference a registered image asset", node.id);
      if (node.image !== undefined) validateImageSettings(node.image, node.id);
    } else if (node.assetId !== undefined || node.image !== undefined) invalid("only image nodes may reference image assets or settings", node.id);
    if (node.kind === "table") {
      if (!node.table) invalid("table node data is required", node.id);
      validateTableData(node.table, node.id);
    } else if (node.table !== undefined) invalid("only table nodes may contain table data", node.id);
    if (node.kind === "chart") {
      if (!node.chart) invalid("chart node data is required", node.id);
      validateChartData(node.chart, node.id);
    } else if (node.chart !== undefined) invalid("only chart nodes may contain chart data", node.id);
    if (node.kind === "text") {
      if (!node.content || typeof node.content !== "object" || !nonEmpty(node.content.type)) invalid("text node content is required", node.id);
      validateTextContent(node.content, `text node ${node.id}`);
    }
    if (node.kind !== "text" && node.content !== undefined) invalid("only text nodes may contain text content", node.id);
    if (node.kind === "group" && !Array.isArray(node.children)) invalid("group children are required", node.id);
    if (node.kind !== "group" && node.children !== undefined) invalid("only group nodes may have children", node.id);
    if (node.children) assertUniqueChildren(node.children, node.id);
    ids.add(node.id);
  }
  const parentChildren = new Set<string>();
  for (const page of document.pages) {
    for (const child of page.children) {
      if (!document.nodes[child] || document.nodes[child].parentId !== page.id || parentChildren.has(child)) invalid("page child relationship is invalid", child);
      parentChildren.add(child);
    }
  }
  for (const node of Object.values(document.nodes)) {
    if (!document.pages.some((page) => page.id === node.parentId) && !document.nodes[node.parentId]) invalid("node parent does not exist", node.id);
    if (node.children) for (const child of node.children) {
      if (!document.nodes[child] || document.nodes[child].parentId !== node.id || parentChildren.has(child)) invalid("group child relationship is invalid", child);
      parentChildren.add(child);
    }
  }
  if (parentChildren.size !== Object.keys(document.nodes).length) invalid("every node must occur exactly once in the hierarchy");
  for (const node of Object.values(document.nodes)) {
    const seen = new Set<string>(); let parent: string | undefined = node.id;
    while (parent && document.nodes[parent]) {
      if (seen.has(parent)) invalid("node hierarchy contains a cycle", node.id);
      const parentNode: DeckNode | undefined = document.nodes[parent];
      if (!parentNode) break;
      seen.add(parent); parent = parentNode.parentId;
    }
  }
}

function assertUniqueChildren(children: string[], target: string): void {
  if (children.some((child) => !stableId(child)) || new Set(children).size !== children.length) invalid("children must contain unique non-empty ids", target);
}

type ChildContainer = { children: string[] };
function pageOrGroup(document: DeckDocument, parentId: string): ChildContainer & (DeckPage | DeckNode) {
  const page = document.pages.find((candidate) => candidate.id === parentId);
  if (page) return page;
  const node = hasOwnNode(document, parentId) ? document.nodes[parentId] : undefined;
  if (node?.kind === "group" && node.children) return node as ChildContainer & DeckNode;
  throw new KernelError("not_found", "parent does not exist or is not a group", parentId);
}
function childrenOf(document: DeckDocument, parentId: string): string[] { return pageOrGroup(document, parentId).children; }
function findNode(document: DeckDocument, nodeId: string): DeckNode { const node = stableId(nodeId) && hasOwnNode(document, nodeId) ? document.nodes[nodeId] : undefined; if (!node) throw new KernelError("not_found", "node does not exist", nodeId); return node; }
function findPage(document: DeckDocument, pageId: string): DeckPage { const page = document.pages.find((candidate) => candidate.id === pageId); if (!page) throw new KernelError("not_found", "page does not exist", pageId); return page; }
function descendants(document: DeckDocument, nodeId: string): string[] { const node = findNode(document, nodeId); return [nodeId, ...(node.children ?? []).flatMap((child) => descendants(document, child))]; }
function ancestorIds(document: DeckDocument, nodeId: string): string[] { const result: string[] = []; let parent = document.nodes[nodeId]?.parentId; while (parent && document.nodes[parent]) { const parentNode = document.nodes[parent]; if (!parentNode) break; result.push(parent); parent = parentNode.parentId; } return result; }
function assertUnlocked(document: DeckDocument, nodeId: string, allowUnlock = false): void {
  const node = findNode(document, nodeId);
  if (node.locked && !allowUnlock) throw new KernelError("locked", "node is locked", nodeId);
  const lockedParent = ancestorIds(document, nodeId).find((id) => document.nodes[id]?.locked);
  if (lockedParent) throw new KernelError("locked", "parent group is locked", lockedParent);
}
function assertSubtreeUnlocked(document: DeckDocument, nodeId: string): void {
  assertUnlocked(document, nodeId);
  const lockedDescendant = descendants(document, nodeId).slice(1).find((id) => document.nodes[id]?.locked);
  if (lockedDescendant) throw new KernelError("locked", "operation would modify a locked descendant", lockedDescendant);
}
function parentMatrices(document: DeckDocument, parentId: string): Matrix[] {
  const matrices: Matrix[] = [];
  let currentId: string | undefined = parentId;
  while (currentId && hasOwnNode(document, currentId)) {
    const parent: DeckNode | undefined = document.nodes[currentId];
    if (!parent) break;
    matrices.push(geometryMatrix(parent.geometry));
    currentId = parent.parentId;
  }
  return matrices;
}
function parentRotation(document: DeckDocument, parentId: string): number {
  let rotation = 0;
  let currentId: string | undefined = parentId;
  while (currentId && hasOwnNode(document, currentId)) {
    const parent: DeckNode | undefined = document.nodes[currentId];
    if (!parent) break;
    rotation += parent.geometry.rotation;
    currentId = parent.parentId;
  }
  return rotation;
}
function valueAt(value: unknown, path: string): unknown { return path.split(".").reduce((current: unknown, key) => record(current) ? current[key] : undefined, value); }
function assertPreconditions(document: DeckDocument, preconditions: EditPrecondition[]): void {
  for (const condition of preconditions ?? []) {
    if (!record(condition) || !nonEmpty(condition.type)) invalid("precondition must identify its type");
    if (condition.type === "node.property" && !nonEmpty(condition.path)) invalid("node.property requires a property path");
    if (condition.type === "document.property" && !["name", "theme"].includes(condition.path)) invalid("unsupported document property precondition");
    if (condition.type === "node.exists") { const exists = hasOwnNode(document, condition.nodeId); if (exists !== (condition.exists ?? true)) throw new KernelError("conflict", "node existence precondition failed", condition.nodeId); }
    else if (condition.type === "node.property") { const actual = valueAt(document.nodes[condition.nodeId], condition.path); if (!equal(actual, condition.value)) throw new KernelError("conflict", "node property precondition failed", condition.nodeId, { path: condition.path, actual }); }
    else if (condition.type === "node.parent") { if (document.nodes[condition.nodeId]?.parentId !== condition.parentId) throw new KernelError("conflict", "node parent precondition failed", condition.nodeId); }
    else if (condition.type === "page.children") { if (!equal(document.pages.find((page) => page.id === condition.pageId)?.children, condition.children)) throw new KernelError("conflict", "page ordering precondition failed", condition.pageId); }
    else if (condition.type === "page.property") { const actual = valueAt(document.pages.find((page) => page.id === condition.pageId), condition.path); if (!equal(actual, condition.value)) throw new KernelError("conflict", "page property precondition failed", condition.pageId, { path: condition.path, actual }); }
    else if (condition.type === "asset.exists") { const exists = Boolean(findAsset(document, condition.assetId)); if (exists !== (condition.exists ?? true)) throw new KernelError("conflict", "asset existence precondition failed", condition.assetId); }
    else if (condition.type === "document.property") { const actual = valueAt(document, condition.path); if (!equal(actual, condition.value)) throw new KernelError("conflict", "document property precondition failed", condition.path, { actual }); }
    else if (condition.type === "text.version") { if (!equal(document.nodes[condition.nodeId]?.content, condition.value)) throw new KernelError("conflict", "text precondition failed", condition.nodeId); }
    else invalid(`unsupported precondition: ${String((condition as { type: unknown }).type)}`);
  }
}
function assertUntouched(current: DeckDocument, base: DeckDocument, nodeId: string, path: string): void {
  if (!equal(valueAt(base.nodes[nodeId], path), valueAt(current.nodes[nodeId], path))) throw new KernelError("conflict", "stale property was changed", nodeId, { path, current: valueAt(current.nodes[nodeId], path) });
}
function assertContainerGeometryUntouched(current: DeckDocument, base: DeckDocument, containerId: string): void {
  if (base.nodes[containerId] || current.nodes[containerId]) assertUntouched(current, base, containerId, "geometry");
  else {
    const basePage = base.pages.find((page) => page.id === containerId);
    const currentPage = current.pages.find((page) => page.id === containerId);
    if (!equal(basePage && { width: basePage.width, height: basePage.height }, currentPage && { width: currentPage.width, height: currentPage.height })) throw new KernelError("conflict", "stale parent page geometry changed", containerId);
  }
}
function assertStructuralUntouched(current: DeckDocument, base: DeckDocument, parentId: string): void {
  const baseParent = base.pages.some((page) => page.id === parentId) || Boolean(base.nodes[parentId]);
  const currentParent = current.pages.some((page) => page.id === parentId) || Boolean(current.nodes[parentId]);
  if (!baseParent && !currentParent) return; // created earlier in this same command batch
  if (baseParent !== currentParent) throw new KernelError("conflict", "hierarchy target changed since base", parentId);
  if (!equal(childrenOf(base, parentId), childrenOf(current, parentId))) throw new KernelError("conflict", "stale hierarchy was changed", parentId);
}
function assertPageUntouched(current: DeckDocument, base: DeckDocument, pageId: string, path: "name" | "width" | "height"): void {
  const basePage = base.pages.find((page) => page.id === pageId);
  const currentPage = current.pages.find((page) => page.id === pageId);
  if (!equal(basePage?.[path], currentPage?.[path])) throw new KernelError("conflict", "stale page property was changed", pageId, { path, current: currentPage?.[path] });
}
function assertDocumentThemeUntouched(current: DeckDocument, base: DeckDocument, path: string): void {
  const baseValue = valueAt(base.theme, path);
  const currentValue = valueAt(current.theme, path);
  if (!equal(baseValue, currentValue)) throw new KernelError("conflict", "stale Deck theme property was changed", "theme", { path, current: currentValue });
}
function themePatchPaths(theme: ThemePatch): string[] {
  const paths = Object.keys(theme).filter((key) => key !== "colors").map((key) => key);
  for (const key of Object.keys(theme.colors ?? {})) paths.push(`colors.${key}`);
  return paths;
}
function setThemePatch(document: DeckDocument, patch: ThemePatch): void {
  const theme: Record<string, unknown> = clone(document.theme ?? {});
  for (const key of ["name", "fontFamily", "headingFontFamily", "bodyFontFamily"] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    if (value === null) delete theme[key];
    else theme[key] = value;
  }
  if (patch.colors) {
    const colors: Record<string, unknown> = { ...((theme.colors as Record<string, unknown> | undefined) ?? {}) };
    for (const [key, value] of Object.entries(patch.colors)) {
      if (value === null) delete colors[key];
      else colors[key] = value;
    }
    if (Object.keys(colors).length) theme.colors = colors;
    else delete theme.colors;
  }
  if (Object.keys(theme).length) document.theme = theme;
  else delete document.theme;
}
function validateOperationShape(operation: unknown): asserts operation is DocumentOperation {
  if (!record(operation)) invalid("operation must be an object");
  const type = operation.type;
  if (!nonEmpty(type)) invalid("operation type is required");
  if (type === "geometry.update" && (!record(operation.geometry) || Object.keys(operation.geometry).length === 0)) invalid("geometry.update requires a non-empty geometry object");
  if (type === "style.update" && !record(operation.style)) invalid("style.update requires a style object");
  if (type === "node.flags.update" && !record(operation.flags)) invalid("node.flags.update requires a flags object");
  if (type === "text.apply" && !Array.isArray(operation.steps)) invalid("text.apply requires a steps array");
  if (type === "page.update" && (!record(operation.page) || Object.keys(operation.page).length === 0 || Object.keys(operation.page).some((key) => !["name", "width", "height"].includes(key)))) invalid("page.update requires supported page properties");
  if (type === "page.reorder" && (typeof operation.index !== "number" || !Number.isInteger(operation.index) || operation.index < 0)) invalid("page.reorder requires a non-negative integer index");
  if (type === "image.update" && (!record(operation.image) || Object.keys(operation.image).length === 0 || Object.keys(operation.image).some((key) => !["fit", "crop", "opacity"].includes(key)))) invalid("image.update requires supported image settings");
  if (type === "asset.register" || type === "asset.replace") validateImageAsset(operation.asset, "asset operation");
  if (type === "table.update" && (!record(operation.table) || !Array.isArray(operation.table.rows))) invalid("table.update requires table data");
  if (type === "chart.update" && !record(operation.chart)) invalid("chart.update requires chart data");
  if (type === "document.theme") {
    if (!record(operation.theme) || Object.keys(operation.theme).length === 0) invalid("document.theme requires theme properties");
    for (const key of Object.keys(operation.theme)) if (!["name", "fontFamily", "headingFontFamily", "bodyFontFamily", "colors"].includes(key)) invalid(`unsupported Deck theme property ${key}`);
    if (operation.theme.colors !== undefined) {
      if (!record(operation.theme.colors) || Object.keys(operation.theme.colors).length === 0) invalid("document.theme colors must include at least one theme color");
      for (const [key, value] of Object.entries(operation.theme.colors)) {
        if (!themeColorKeys.has(key)) invalid(`unsupported Deck theme color ${key}`);
        if (value !== null) validateHexColor(value, `Deck theme ${key}`);
      }
    }
  }
}
function checkStale(current: DeckDocument, base: DeckDocument, operation: DocumentOperation): void {
  if (current.revision === base.revision) return;
  const op = operation as any;
  const type = op.type;
  if (type === "page.update") for (const key of Object.keys(op.page ?? {})) assertPageUntouched(current, base, op.pageId, key as "name" | "width" | "height");
  else if (type === "page.reorder") {
    if (!base.pages.some((page) => page.id === op.pageId) || !current.pages.some((page) => page.id === op.pageId)) throw new KernelError("conflict", "reordered page was removed", op.pageId);
    if (!equal(base.pages.map((page) => page.id), current.pages.map((page) => page.id))) throw new KernelError("conflict", "page order changed since base", op.pageId);
  }
  else if (type === "document.theme") for (const path of themePatchPaths(op.theme)) assertDocumentThemeUntouched(current, base, path);
  else if (type === "asset.register") {
    const previous = findAsset(base, op.asset.id);
    const latest = findAsset(current, op.asset.id);
    if (!previous && latest) throw new KernelError("conflict", "asset id was registered since base", op.asset.id);
  }
  const targetId = op.nodeId;
  if (targetId && !hasOwnNode(base, targetId)) {
    if (hasOwnNode(current, targetId)) throw new KernelError("conflict", "target was created since base", targetId);
    return; // a previous operation in this batch created the target
  }
  if (type === "geometry.update") {
    assertUntouched(current, base, op.nodeId, "parentId");
    for (const key of Object.keys(op.geometry)) assertUntouched(current, base, op.nodeId, `geometry.${key}`);
    const targetParent = base.nodes[op.nodeId]?.parentId;
    if (targetParent) assertContainerGeometryUntouched(current, base, targetParent);
    for (const parentId of ancestorIds(base, op.nodeId)) assertContainerGeometryUntouched(current, base, parentId);
  }
  else if (type === "style.update") for (const key of Object.keys(op.style ?? {})) assertUntouched(current, base, op.nodeId, `style.${key}`);
  else if (type === "node.flags.update") for (const key of Object.keys(op.flags ?? {})) assertUntouched(current, base, op.nodeId, key);
  else if (type === "text.apply") assertUntouched(current, base, op.nodeId, "content");
  else if (type === "image.update") for (const key of Object.keys(op.image ?? {})) assertUntouched(current, base, op.nodeId, `image.${key}`);
  else if (type === "asset.replace") assertUntouched(current, base, op.nodeId, "assetId");
  else if (type === "table.update") assertUntouched(current, base, op.nodeId, "table");
  else if (type === "chart.update") assertUntouched(current, base, op.nodeId, "chart");
  else if (type === "node.remove") {
    const ids = descendants(base, op.nodeId);
    if (ids.some((id) => !current.nodes[id] || !equal(current.nodes[id], base.nodes[id]))) throw new KernelError("conflict", "removed subtree changed since base", op.nodeId);
  } else if (type === "node.reparent" || type === "node.reorder") {
    const node = findNode(base, op.nodeId); assertUntouched(current, base, op.nodeId, "parentId"); assertStructuralUntouched(current, base, node.parentId); assertContainerGeometryUntouched(current, base, node.parentId);
    if (op.parentId) assertStructuralUntouched(current, base, op.parentId);
    if (op.parentId) assertContainerGeometryUntouched(current, base, op.parentId);
  } else if (type === "node.insert") {
    if (op.node?.id && current.nodes[op.node.id] && !base.nodes[op.node.id]) throw new KernelError("conflict", "inserted node id was used since base", op.node.id);
    const parentId = op.parentId ?? op.node?.parentId; if (parentId) assertStructuralUntouched(current, base, parentId);
  } else if (type === "page.insert") {
    if (current.pages.length !== base.pages.length) throw new KernelError("conflict", "pages changed since base");
  }
}

export function applyCommand(current: DeckDocument, command: CommandEnvelope, base: DeckDocument): { document: DeckDocument; changedNodeIds: string[] } {
  validateDocument(current); validateDocument(base);
  if (!command || !stableId(command.commandId) || !stableId(command.projectId) || !stableId(command.actorId) || !stableId(command.clientId) || !nonEmpty(command.label) || !["human", "agent", "system"].includes(command.actorKind) || !Number.isInteger(command.baseRevision) || (command.runId !== undefined && !stableId(command.runId)) || !Array.isArray(command.preconditions) || !Array.isArray(command.operations)) throw new KernelError("invalid", "invalid command envelope");
  if (command.documentId !== current.documentId || command.documentId !== base.documentId) throw new KernelError("invalid", "command documentId does not match document");
  if (command.baseRevision !== base.revision || base.revision > current.revision) throw new KernelError("invalid", "base revision does not match supplied base snapshot");
  if (base.revision === current.revision && !equal(base, current)) throw new KernelError("invalid", "base snapshot does not match current at its revision");
  if (command.operations.length === 0) throw new KernelError("invalid", "command must contain operations");
  assertPreconditions(base, command.preconditions);
  if (current.revision !== base.revision) assertPreconditions(current, command.preconditions);
  const next = clone(current); const changed = new Set<string>();
  try {
    for (const operation of command.operations) { validateOperationShape(operation); checkStale(current, base, operation); applyOperation(next, operation, changed); }
    next.revision = current.revision + 1; validateDocument(next);
    return { document: next, changedNodeIds: [...changed] };
  } catch (error) { if (error instanceof KernelError) throw error; throw new KernelError("invalid", error instanceof Error ? error.message : String(error)); }
}

function applyOperation(document: DeckDocument, operation: DocumentOperation, changed: Set<string>): void {
  const op = operation as any; const type = op.type;
  if (type === "page.insert") {
    const page = clone(op.page ?? op); if (!nonEmpty(page.id) || document.pages.some((candidate) => candidate.id === page.id)) invalid("page id already exists", page.id);
    if (!Array.isArray(page.children) || page.children.length) invalid("inserted pages must have an empty children array", page.id); if (!finite(page.width) || !finite(page.height) || page.width <= 0 || page.height <= 0) invalid("invalid page", page.id);
    const index = op.index === undefined ? document.pages.length : op.index; if (!Number.isInteger(index) || index < 0 || index > document.pages.length) invalid("invalid page index", page.id);
    document.pages.splice(index, 0, page); return;
  }
  if (type === "page.update") {
    const page = findPage(document, op.pageId);
    if (op.page.name !== undefined) {
      if (!nonEmpty(op.page.name)) invalid("page name must be non-empty", page.id);
      page.name = op.page.name;
    }
    for (const key of ["width", "height"] as const) {
      const value = op.page[key];
      if (value !== undefined) {
        if (!finite(value) || value <= 0) invalid(`page ${key} must be positive`, page.id);
        page[key] = value;
      }
    }
    return;
  }
  if (type === "page.reorder") {
    const pageIndex = document.pages.findIndex((page) => page.id === op.pageId);
    if (pageIndex < 0) throw new KernelError("not_found", "page does not exist", op.pageId);
    if (op.index >= document.pages.length) invalid("page order index is out of range", op.pageId);
    const [page] = document.pages.splice(pageIndex, 1);
    document.pages.splice(op.index, 0, page!);
    return;
  }
  if (type === "document.theme") {
    setThemePatch(document, op.theme);
    return;
  }
  if (type === "asset.register") {
    validateImageAsset(op.asset, "asset.register");
    if (findAsset(document, op.asset.id)) invalid("asset id already exists", op.asset.id);
    storeAsset(document, op.asset);
    return;
  }
  if (type === "asset.replace") {
    const node = findNode(document, op.nodeId);
    assertUnlocked(document, node.id);
    if (node.kind !== "image") invalid("asset.replace target must be an image node", node.id);
    validateImageAsset(op.asset, "asset.replace");
    const existing = findAsset(document, op.asset.id);
    if (existing && !equal(existing, op.asset)) invalid("replacement asset id already has different metadata", op.asset.id);
    if (!existing) storeAsset(document, op.asset);
    node.assetId = op.asset.id;
    changed.add(node.id);
    return;
  }
  if (type === "node.insert") {
    const node: DeckNode = clone(op.node); if (!node || !nonEmpty(node.id) || document.nodes[node.id]) invalid("node id already exists", node?.id);
    const parentId = op.parentId ?? node.parentId; node.parentId = parentId; const parent = pageOrGroup(document, parentId); if (node.kind === "group" && !node.children) node.children = [];
    if (hasOwnNode(document, parentId)) assertUnlocked(document, parentId);
    const index = op.index === undefined ? parent.children.length : op.index; if (!Number.isInteger(index) || index < 0 || index > parent.children.length) invalid("invalid node index", node.id);
    if (node.kind === "group" && node.children?.length) invalid("inserted groups must start empty; insert children separately", node.id);
    document.nodes[node.id] = node; parent.children.splice(index, 0, node.id); changed.add(node.id); return;
  }
  if (type === "node.remove") {
    const node = findNode(document, op.nodeId); assertSubtreeUnlocked(document, node.id); const ids = descendants(document, node.id); const parent = pageOrGroup(document, node.parentId); parent.children.splice(parent.children.indexOf(node.id), 1);
    for (const id of ids) { delete document.nodes[id]; changed.add(id); } return;
  }
  if (type === "geometry.update") {
    const node = findNode(document, op.nodeId); assertSubtreeUnlocked(document, node.id); for (const key of Object.keys(op.geometry ?? {})) { if (!geometryKeys.has(key) || !finite(op.geometry[key])) invalid("invalid geometry property", node.id); }
    node.geometry = { ...node.geometry, ...op.geometry }; changed.add(node.id); return;
  }
  if (type === "style.update") {
    const node = findNode(document, op.nodeId); assertUnlocked(document, node.id); node.style = { ...node.style, ...clone(op.style ?? {}) }; changed.add(node.id); return;
  }
  if (type === "image.update") {
    const node = findNode(document, op.nodeId); assertUnlocked(document, node.id);
    if (node.kind !== "image") invalid("image.update target must be an image node", node.id);
    node.image = { ...(node.image ?? { fit: "contain" }), ...clone(op.image) };
    changed.add(node.id);
    return;
  }
  if (type === "table.update") {
    const node = findNode(document, op.nodeId); assertUnlocked(document, node.id);
    if (node.kind !== "table") invalid("table.update target must be a table node", node.id);
    node.table = clone(op.table);
    changed.add(node.id);
    return;
  }
  if (type === "chart.update") {
    const node = findNode(document, op.nodeId); assertUnlocked(document, node.id);
    if (node.kind !== "chart") invalid("chart.update target must be a chart node", node.id);
    node.chart = clone(op.chart);
    changed.add(node.id);
    return;
  }
  if (type === "node.flags.update") {
    const node = findNode(document, op.nodeId); const flags = op.flags ?? {};
    if (node.locked && flags.locked !== false) assertUnlocked(document, node.id);
    if (flags.locked !== undefined && typeof flags.locked !== "boolean" || flags.hidden !== undefined && typeof flags.hidden !== "boolean") invalid("invalid node flags", node.id);
    if (flags.locked === false) { assertUnlocked(document, node.id, true); node.locked = false; }
    if (flags.locked === true) { assertUnlocked(document, node.id, true); node.locked = true; }
    if (flags.hidden !== undefined) { assertUnlocked(document, node.id); node.hidden = flags.hidden; } changed.add(node.id); return;
  }
  if (type === "node.reparent" || type === "node.reorder") {
    const node = findNode(document, op.nodeId); assertSubtreeUnlocked(document, node.id); const newParentId = type === "node.reparent" ? op.parentId : (op.parentId ?? node.parentId); const oldParentId = node.parentId; const oldParent = pageOrGroup(document, oldParentId); const newParent = pageOrGroup(document, newParentId);
    if (newParentId === node.id || descendants(document, node.id).includes(newParentId)) invalid("cannot parent a node under itself or its descendant", node.id);
    if (hasOwnNode(document, newParentId)) assertUnlocked(document, newParentId);
    const preserveWorld = type === "node.reparent" && newParentId !== oldParentId;
    const worldOrigin = preserveWorld ? parentToWorld({ x: node.geometry.x, y: node.geometry.y }, parentMatrices(document, oldParentId)) : undefined;
    const worldRotation = preserveWorld ? node.geometry.rotation + parentRotation(document, oldParentId) : undefined;
    const oldIndex = oldParent.children.indexOf(node.id); oldParent.children.splice(oldIndex, 1); node.parentId = newParentId;
    if (preserveWorld && worldOrigin && worldRotation !== undefined) {
      const localOrigin = worldToParent(worldOrigin, parentMatrices(document, newParentId));
      node.geometry = { ...node.geometry, x: localOrigin.x, y: localOrigin.y, rotation: normalizeRotation(worldRotation - parentRotation(document, newParentId)) };
    }
    const index = op.index ?? (newParentId === oldParentId ? oldIndex : newParent.children.length); if (!Number.isInteger(index) || index < 0 || index > newParent.children.length) invalid("invalid node index", node.id); newParent.children.splice(index, 0, node.id); changed.add(node.id); return;
  }
  if (type === "text.apply") {
    const node = findNode(document, op.nodeId); assertUnlocked(document, node.id); if (node.kind !== "text" || !node.content) invalid("text.apply target is not a text node", node.id); node.content = applyTextSteps(node.content, op.steps ?? []); changed.add(node.id); return;
  }
  invalid(`unsupported document operation: ${String(type)}`);
}

export function restoreDocument(current: DeckDocument, snapshot: DeckDocument): DeckDocument {
  validateDocument(current); validateDocument(snapshot);
  if (current.documentId !== snapshot.documentId) throw new KernelError("invalid", "snapshot belongs to another document");
  const restored = clone(snapshot); restored.revision = current.revision + 1; validateDocument(restored); return restored;
}
