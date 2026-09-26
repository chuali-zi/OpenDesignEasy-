import { KernelError, invalid } from "./errors.ts";
import type { CommandEnvelope, ImageAsset, WebBreakpoint, WebDocument, WebNode, WebOperation, WebPage, WebSourceModule } from "./model.ts";

const clone = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const id = (value: unknown): value is string => typeof value === "string" && !!value.trim() && !["__proto__", "prototype", "constructor"].includes(value);
const rec = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const json = (value: unknown): boolean => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || Array.isArray(value) && value.every(json) || rec(value) && Object.entries(value).every(([key, item]) => !["__proto__", "constructor", "prototype"].includes(key) && json(item));

export function createWebDocument(input: { documentId: string; name: string; pageId?: string; rootId?: string }): WebDocument {
  const documentId = input.documentId;
  if (!id(documentId) || !input.name.trim()) invalid("documentId and name are required");
  const pageId = input.pageId ?? `${documentId}-page-1`;
  const rootId = input.rootId ?? `${documentId}-root`;
  const root: WebNode = { id: rootId, parentId: null, tag: "main", children: [], style: {}, layout: { mode: "flow" } };
  const document: WebDocument = { schemaVersion: 1, documentId, kind: "web", revision: 0, name: input.name,
    pages: [{ id: pageId, name: "Home", route: "/", rootId }], nodes: { [rootId]: root } };
  validateWebDocument(document);
  return document;
}

export function validateWebDocument(doc: WebDocument): void {
  if (!rec(doc) || doc.schemaVersion !== 1 || doc.kind !== "web" || !id(doc.documentId) || !id(doc.name) || !Number.isInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.pages) || !doc.pages.length || !rec(doc.nodes)) invalid("invalid Web document header");
  const nodeIds = new Set(Object.keys(doc.nodes));
  const pageIds = new Set<string>(); const roots = new Set<string>(); const rootRefs = new Set<string>(); const routes = new Set<string>();
  for (const page of doc.pages) {
    if (!rec(page) || !id(page.id) || pageIds.has(page.id) || nodeIds.has(page.id) || !id(page.name) || typeof page.route !== "string" || !page.route.startsWith("/") || /[\\?#%\s]/.test(page.route) || page.route !== '/' && page.route.endsWith('/') || page.route.split("/").some(part => part === "." || part === "..") || page.route.includes("//") || routes.has(page.route) || !nodeIds.has(page.rootId) || rootRefs.has(page.rootId)) invalid("invalid Web page", page?.id);
    pageIds.add(page.id); roots.add(page.rootId); rootRefs.add(page.rootId); routes.add(page.route);
  }
  const visited = new Set<string>();
  const walk = (nodeId: string, parentId: string | null, ancestors: Set<string>) => {
    const node = doc.nodes[nodeId];
    if (!node || !id(node.id) || node.id !== nodeId || node.parentId !== parentId || typeof node.tag !== "string" || !/^[a-z][a-z0-9-]*$/i.test(node.tag) || ["script", "iframe", "object", "embed", "link", "meta", "base"].includes(node.tag.toLowerCase()) || !Array.isArray(node.children) || !rec(node.style) || !rec(node.layout) || !["flow", "flex", "grid", "position"].includes(node.layout.mode) || node.props !== undefined && !rec(node.props) || node.text !== undefined && typeof node.text !== "string" || node.locked !== undefined && typeof node.locked !== "boolean" || node.hidden !== undefined && typeof node.hidden !== "boolean") invalid("invalid Web node", nodeId);
    if (visited.has(nodeId) || ancestors.has(nodeId)) invalid("Web node tree contains a cycle or duplicate child", nodeId);
    if (!json(node.style) || !json(node.layout) || node.props !== undefined && !json(node.props)) invalid("Web node values must be JSON-compatible", nodeId);
    if (node.responsive !== undefined) {
      if (!rec(node.responsive)) invalid("responsive overrides must be an object", nodeId);
      for (const [breakpointId, override] of Object.entries(node.responsive)) if (!doc.breakpoints?.some((b) => b.id === breakpointId) || !rec(override) || override.style !== undefined && (!rec(override.style) || !json(override.style)) || override.layout !== undefined && (!rec(override.layout) || !json(override.layout) || override.layout.mode !== undefined && !["flow", "flex", "grid", "position"].includes(String(override.layout.mode)))) invalid("invalid responsive override", nodeId);
    }
    if (node.component !== undefined && (!rec(node.component) || !id(node.component.moduleId) || typeof node.component.exportName !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(node.component.exportName))) invalid("invalid component binding", nodeId);
    if (['br', 'col', 'hr', 'img', 'input', 'source', 'wbr'].includes(node.tag) && (node.children.length || node.text)) invalid('void HTML nodes cannot have children or text', nodeId);
    visited.add(nodeId); const next = new Set(ancestors).add(nodeId);
    const childIds = new Set<string>();
    for (const childId of node.children) { if (!id(childId) || childIds.has(childId)) invalid("Web children must be unique IDs", nodeId); childIds.add(childId); walk(childId, nodeId, next); }
  };
  for (const rootId of roots) { if (doc.nodes[rootId]?.parentId !== null) invalid("page root must not have a parent", rootId); walk(rootId, null, new Set()); }
  if (visited.size !== nodeIds.size) invalid("Web document contains nodes outside page trees");
  if (doc.breakpoints !== undefined) validateBreakpoints(doc.breakpoints);
  if (doc.assets !== undefined) {
    if (!Array.isArray(doc.assets) && (!rec(doc.assets) || Object.entries(doc.assets).some(([key, value]) => key !== value?.id))) invalid('asset keys must match their IDs');
    const values = Array.isArray(doc.assets) ? doc.assets : Object.values(doc.assets);
    const ids = new Set<string>();
    for (const asset of values) { if (!rec(asset) || !id(asset.id) || ids.has(asset.id) || asset.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) || !Number.isFinite(asset.width) || asset.width <= 0 || !Number.isFinite(asset.height) || asset.height <= 0) invalid("invalid Web image asset", asset?.id); ids.add(asset.id); }
  }
  const moduleIds = new Set<string>();
  const paths = new Set<string>(); const modules = new Map<string, WebSourceModule>();
  for (const module of doc.sourceModules ?? []) { if (!rec(module) || !id(module.id) || moduleIds.has(module.id) || !id(module.path) || module.path.startsWith("/") || module.path.includes("\\") || module.path.includes(":") || module.path.split("/").some(part => !part || part === "." || part === "..") || !["ts", "tsx", "css"].includes(module.language) || !module.path.endsWith(`.${module.language}`) || paths.has(module.path) || typeof module.source !== "string" || module.exports !== undefined && (!Array.isArray(module.exports) || module.exports.some((e: unknown) => typeof e !== "string"))) invalid("invalid Web source module", module?.id); moduleIds.add(module.id); paths.add(module.path); modules.set(module.id, module); }
  for (const node of Object.values(doc.nodes)) if (node.component && (!moduleIds.has(node.component.moduleId) || modules.get(node.component.moduleId)?.language === 'css' || modules.get(node.component.moduleId)?.exports && !modules.get(node.component.moduleId)!.exports!.includes(node.component.exportName))) invalid("component binding refers to a missing module export", node.id);
}

function validateBreakpoints(breakpoints: WebBreakpoint[]): void {
  if (!Array.isArray(breakpoints)) invalid("breakpoints must be an array");
  const seen = new Set<string>();
  for (const point of breakpoints) {
    if (!rec(point) || !id(point.id) || seen.has(point.id) || point.minWidth !== undefined && (!Number.isFinite(point.minWidth) || point.minWidth < 0) || point.maxWidth !== undefined && (!Number.isFinite(point.maxWidth) || point.maxWidth < 0) || point.minWidth !== undefined && point.maxWidth !== undefined && point.minWidth > point.maxWidth) invalid("invalid Web breakpoint", point?.id);
    seen.add(point.id);
  }
}
const node = (doc: WebDocument, nodeId: string): WebNode => { const value = Object.hasOwn(doc.nodes, nodeId) ? doc.nodes[nodeId] : undefined; if (!value) throw new KernelError("not_found", "Web node does not exist", nodeId); return value; };
const children = (doc: WebDocument, parentId: string): string[] => node(doc, parentId).children;
function pageRoot(doc: WebDocument, nodeId: string): boolean { return doc.pages.some(p => p.rootId === nodeId); }
function ancestors(doc: WebDocument, nodeId: string): WebNode[] { const result: WebNode[] = []; let parent = doc.nodes[nodeId]?.parentId; while (parent) { result.push(node(doc, parent)); parent = doc.nodes[parent]!.parentId; } return result; }
function assertEditable(doc: WebDocument, nodeId: string, subtree = false, allowOwnLocked = false): void {
  const target = node(doc, nodeId);
  const candidates = [...(allowOwnLocked ? [] : [target]), ...(subtree ? descendants(doc, nodeId).map(id => node(doc, id)) : []), ...ancestors(doc, nodeId)];
  const locked = candidates.find(n => n.locked);
  if (locked) throw new KernelError("locked", "Web node or ancestor is locked", locked.id);
}
function descendants(doc: WebDocument, nodeId: string): string[] { return node(doc, nodeId).children.flatMap(id => [id, ...descendants(doc, id)]); }
function module(doc: WebDocument, moduleId: string): WebSourceModule | undefined { return doc.sourceModules?.find(m => m.id === moduleId); }
function asset(doc: WebDocument, assetId: string): ImageAsset | undefined { return Array.isArray(doc.assets) ? doc.assets.find(a => a.id === assetId) : doc.assets && Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined; }
function applyOne(doc: WebDocument, op: WebOperation, changed: Set<string>): void {
  switch (op.type) {
    case "web.page.insert": {
      if (doc.pages.some(page => page.id === op.page.id) || doc.nodes[op.root.id] || op.page.rootId !== op.root.id || op.root.parentId !== null || op.root.children.length) {
        invalid("new Web page requires a unique page and empty root", op.page.id);
      }
      const index = op.index ?? doc.pages.length;
      if (!Number.isInteger(index) || index < 0 || index > doc.pages.length) invalid("invalid page index");
      doc.pages.splice(index, 0, clone(op.page));
      doc.nodes[op.root.id] = clone(op.root);
      changed.add(op.root.id);
      return;
    }
    case "web.page.update": {
      const page = doc.pages.find(candidate => candidate.id === op.pageId);
      if (!page) throw new KernelError("not_found", "Web page does not exist", op.pageId);
      if (op.page.name !== undefined) {
        if (!op.page.name.trim()) invalid("page name is required");
        page.name = op.page.name;
      }
      if (op.page.route !== undefined) page.route = op.page.route;
      return;
    }
    case "web.breakpoints.update": {
      validateBreakpoints(op.breakpoints);
      doc.breakpoints = clone(op.breakpoints);
      const keep = new Set(op.breakpoints.map(point => point.id));
      for (const current of Object.values(doc.nodes)) {
        if (!current.responsive) continue;
        for (const breakpointId of Object.keys(current.responsive)) {
          if (!keep.has(breakpointId)) delete current.responsive[breakpointId];
        }
      }
      return;
    }
    case "asset.register": {
      if (asset(doc, op.asset.id)) invalid("asset id already exists", op.asset.id);
      if (Array.isArray(doc.assets)) doc.assets.push(clone(op.asset));
      else {
        doc.assets ??= {};
        (doc.assets as Record<string, ImageAsset>)[op.asset.id] = clone(op.asset);
      }
      return;
    }
    case "source.update": {
      const index = doc.sourceModules?.findIndex(current => current.id === op.module.id) ?? -1;
      if (index < 0) (doc.sourceModules ??= []).push(clone(op.module));
      else doc.sourceModules![index] = clone(op.module);
      return;
    }
    case "source.remove": {
      if (Object.values(doc.nodes).some(current => current.component?.moduleId === op.moduleId)) {
        invalid("cannot remove a bound component module", op.moduleId);
      }
      const index = doc.sourceModules?.findIndex(current => current.id === op.moduleId) ?? -1;
      if (index < 0) throw new KernelError("not_found", "source module does not exist", op.moduleId);
      doc.sourceModules!.splice(index, 1);
      return;
    }
    case "web.node.insert": {
      const inserted = clone(op.node);
      if (!id(inserted.id) || doc.nodes[inserted.id] || !inserted.parentId || pageRoot(doc, inserted.id)) {
        invalid("Web node insert requires a unique ID and parent", inserted.id);
      }
      assertEditable(doc, inserted.parentId);
      const siblings = children(doc, inserted.parentId);
      const index = op.index ?? siblings.length;
      if (!Number.isInteger(index) || index < 0 || index > siblings.length || inserted.children.length) {
        invalid("invalid insertion index or non-empty inserted children", inserted.id);
      }
      siblings.splice(index, 0, inserted.id);
      doc.nodes[inserted.id] = inserted;
      changed.add(inserted.id);
      return;
    }
    case "web.node.remove": {
      if (pageRoot(doc, op.nodeId)) invalid("a page root cannot be removed", op.nodeId);
      assertEditable(doc, op.nodeId, true);
      const removed = node(doc, op.nodeId);
      const siblings = children(doc, removed.parentId!);
      siblings.splice(siblings.indexOf(removed.id), 1);
      for (const removedId of [removed.id, ...descendants(doc, removed.id)]) {
        delete doc.nodes[removedId];
        changed.add(removedId);
      }
      return;
    }
    case "web.node.reparent": {
      const moved = node(doc, op.nodeId);
      if (pageRoot(doc, moved.id)) invalid("a page root cannot be reparented", moved.id);
      assertEditable(doc, moved.id, true);
      assertEditable(doc, op.parentId);
      if (op.parentId === moved.id || descendants(doc, moved.id).includes(op.parentId)) {
        invalid("cannot create a Web tree cycle", moved.id);
      }
      const siblings = children(doc, moved.parentId!);
      siblings.splice(siblings.indexOf(moved.id), 1);
      const destination = children(doc, op.parentId);
      const index = op.index ?? destination.length;
      if (!Number.isInteger(index) || index < 0 || index > destination.length) invalid("invalid reparent index", moved.id);
      destination.splice(index, 0, moved.id);
      moved.parentId = op.parentId;
      changed.add(moved.id);
      return;
    }
    case "web.node.update": {
      const current = node(doc, op.nodeId);
      const unlockingOnly = current.locked === true && op.flags?.locked === false && op.text === undefined && op.props === undefined && op.component === undefined && op.flags.hidden === undefined && Object.keys(op.flags).every(key => key === "locked");
      assertEditable(doc, current.id, false, unlockingOnly);
      if (op.text !== undefined) {
        if (op.text === null) delete current.text;
        else current.text = op.text;
      }
      if (op.props) {
        current.props ??= {};
        for (const [key, value] of Object.entries(op.props)) {
          if (["__proto__", "constructor", "prototype"].includes(key)) invalid("unsafe Web prop key", key);
          if (value === null) delete current.props[key];
          else current.props[key] = clone(value);
        }
        if (!Object.keys(current.props).length) delete current.props;
      }
      if (op.flags?.hidden !== undefined) current.hidden = op.flags.hidden;
      if (op.flags?.locked !== undefined) current.locked = op.flags.locked;
      if (op.component === null) delete current.component;
      else if (op.component !== undefined) current.component = clone(op.component);
      changed.add(current.id);
      return;
    }
    case "web.style.update":
    case "web.layout.update": {
      const current = node(doc, op.nodeId);
      assertEditable(doc, current.id);
      if (op.breakpointId && !doc.breakpoints?.some(point => point.id === op.breakpointId)) invalid("unknown breakpoint", op.breakpointId);
      const target: Record<string, any> = op.breakpointId ? ((current.responsive ??= {})[op.breakpointId] ??= {}) : current;
      const key = op.type === "web.style.update" ? "style" : "layout";
      const patch = op.type === "web.style.update" ? op.style : op.layout;
      const destination: Record<string, unknown> = target[key] ?? (target[key] = {});
      for (const [name, value] of Object.entries(patch)) {
        if (["__proto__", "constructor", "prototype"].includes(name)) invalid("unsafe Web style/layout key", name);
        if (value === null) delete destination[name];
        else destination[name] = clone(value);
      }
      changed.add(current.id);
      return;
    }
    default: invalid(`unsupported Web operation: ${(op as { type: string }).type}`);
  }
}
function checkPreconditions(doc: WebDocument, command: CommandEnvelope): void {
  for (const p of command.preconditions) {
    if (!rec(p) || typeof p.type !== "string") invalid("Web precondition must identify a type");
    if (p.type === "node.exists") { if (Boolean(doc.nodes[p.nodeId]) !== (p.exists ?? true)) throw new KernelError("conflict", "Web node existence precondition failed", p.nodeId); }
    else if (p.type === "node.property") { if (typeof p.path !== "string" || !p.path) invalid("Web node.property requires a path"); const actual = p.path.split(".").reduce((v: any, k) => v?.[k], doc.nodes[p.nodeId]); if (!equal(actual, p.value)) throw new KernelError("conflict", "Web node property precondition failed", p.nodeId, { path: p.path, actual }); }
    else if (p.type === "node.parent") { if (doc.nodes[p.nodeId]?.parentId !== p.parentId) throw new KernelError("conflict", "Web parent precondition failed", p.nodeId); }
    else if (p.type === "document.property" && p.path === "name") { if (doc.name !== p.value) throw new KernelError("conflict", "Web document precondition failed", "name"); }
    else if (p.type === "asset.exists") { if (Boolean(asset(doc, p.assetId)) !== (p.exists ?? true)) throw new KernelError("conflict", "Web asset precondition failed", p.assetId); }
    else invalid(`unsupported Web precondition: ${p.type}`);
  }
}
function checkStale(current: WebDocument, base: WebDocument, op: WebOperation): void {
  if (current.revision === base.revision) return;

  if ("nodeId" in op) {
    const existedAtBase = Boolean(base.nodes[op.nodeId]);
    if (!existedAtBase && current.nodes[op.nodeId]) {
      throw new KernelError("conflict", "Web node ID was created since base", op.nodeId);
    }
    const before = base.nodes[op.nodeId]; const now = current.nodes[op.nodeId];
    if (before && !now) throw new KernelError("conflict", "Web node was removed since base", op.nodeId);

    if ((op.type === 'web.style.update' && ['left', 'top', 'right', 'bottom', 'width', 'height', 'transform'].some(key => key in op.style) || op.type === 'web.layout.update') && before?.parentId !== now?.parentId) {
      throw new KernelError('conflict', 'Web layout parent changed since base', op.nodeId);
    }
    if ((op.type === 'web.style.update' || op.type === 'web.layout.update') && op.breakpointId && !equal(base.breakpoints?.find(point => point.id === op.breakpointId), current.breakpoints?.find(point => point.id === op.breakpointId))) {
      throw new KernelError('conflict', 'Web breakpoint changed since base', op.breakpointId);
    }

    if (op.type === "web.style.update") {
      const styleAt = (target: WebNode | undefined) => op.breakpointId ? target?.responsive?.[op.breakpointId]?.style : target?.style;
      for (const key of Object.keys(op.style)) {
        if (!equal(styleAt(before)?.[key], styleAt(now)?.[key])) {
          throw new KernelError("conflict", "Web style changed since base", op.nodeId, { key });
        }
      }
    }

    if (op.type === "web.layout.update") {
      const layoutAt = (target: WebNode | undefined) => op.breakpointId ? target?.responsive?.[op.breakpointId]?.layout : target?.layout;
      for (const key of Object.keys(op.layout)) {
        if (!equal(layoutAt(before)?.[key], layoutAt(now)?.[key])) {
          throw new KernelError("conflict", "Web layout changed since base", op.nodeId, { key });
        }
      }
    }

    if (op.type === "web.node.update") {
      for (const key of Object.keys(op.props ?? {})) {
        if (!equal(before?.props?.[key], now?.props?.[key])) {
          throw new KernelError("conflict", "Web prop changed since base", op.nodeId, { key });
        }
      }
      const beforeRecord = before as unknown as Record<string, unknown> | undefined;
      const nowRecord = now as unknown as Record<string, unknown> | undefined;
      for (const key of ["text", "component"] as const) {
        if (op[key] !== undefined && !equal(beforeRecord?.[key], nowRecord?.[key])) {
          throw new KernelError("conflict", `Web ${key} changed since base`, op.nodeId);
        }
      }
      for (const key of Object.keys(op.flags ?? {})) {
        if (!equal(beforeRecord?.[key], nowRecord?.[key])) {
          throw new KernelError("conflict", "Web flag changed since base", op.nodeId, { key });
        }
      }
    }

    if (op.type === "web.node.remove" && existedAtBase) {
      const baseIds = [op.nodeId, ...descendants(base, op.nodeId)].sort();
      const currentIds = [op.nodeId, ...descendants(current, op.nodeId)].sort();
      if (!equal(baseIds, currentIds) || baseIds.some(id => !equal(base.nodes[id], current.nodes[id]))) {
        throw new KernelError("conflict", "Web subtree changed since base", op.nodeId);
      }
    }

    if (op.type === "web.node.reparent" && before?.parentId !== now?.parentId) {
      throw new KernelError("conflict", "Web parent changed since base", op.nodeId);
    }
    if (op.type === "web.node.reparent" && before?.parentId && !equal(children(base, before.parentId), children(current, before.parentId))) {
      throw new KernelError("conflict", "Web source ordering changed since base", before.parentId);
    }
    if (op.type === "web.node.reparent" && base.nodes[op.parentId] && !equal(children(base, op.parentId), children(current, op.parentId))) {
      throw new KernelError("conflict", "Web destination ordering changed since base", op.parentId);
    }
  }
  if (op.type === "web.node.insert" && base.nodes[op.node.parentId!] && !equal(children(base, op.node.parentId!), children(current, op.node.parentId!))) {
    throw new KernelError("conflict", "Web parent ordering changed since base", op.node.parentId!);
  }
  if (op.type === "web.page.update") {
    const before = base.pages.find(page => page.id === op.pageId);
    const now = current.pages.find(page => page.id === op.pageId);
    for (const key of Object.keys(op.page) as Array<"name" | "route">) {
      if (!equal(before?.[key], now?.[key])) throw new KernelError("conflict", "Web page property changed since base", op.pageId, { key });
    }
  }
  if (op.type === "web.page.insert" && !equal(base.pages.map(page => page.id), current.pages.map(page => page.id))) {
    throw new KernelError("conflict", "Web page order changed since base");
  }
  if (op.type === "source.update" || op.type === "source.remove") {
    const moduleId = op.type === "source.update" ? op.module.id : op.moduleId;
    if (!equal(module(base, moduleId), module(current, moduleId))) {
      throw new KernelError("conflict", "Web source module changed since base", moduleId);
    }
    if (op.type === "source.update") {
      const collidingAtBase = (base.sourceModules ?? []).find(candidate => candidate.id !== moduleId && candidate.path === op.module.path);
      const collidingNow = (current.sourceModules ?? []).find(candidate => candidate.id !== moduleId && candidate.path === op.module.path);
      if (!equal(collidingAtBase, collidingNow)) throw new KernelError("conflict", "Web source path changed since base", op.module.path);
    }
  }
  if (op.type === "asset.register" && !asset(base, op.asset.id) && asset(current, op.asset.id)) {
    throw new KernelError("conflict", "asset ID was registered since base", op.asset.id);
  }
  if (op.type === "web.breakpoints.update") {
    if (!equal(base.breakpoints, current.breakpoints)) throw new KernelError("conflict", "Web breakpoints changed since base");
    const removed = new Set((base.breakpoints ?? []).filter(point => !op.breakpoints.some(next => next.id === point.id)).map(point => point.id));
    const allNodeIds = new Set([...Object.keys(base.nodes), ...Object.keys(current.nodes)]);
    for (const breakpointId of removed) {
      for (const nodeId of allNodeIds) {
        if (!equal(base.nodes[nodeId]?.responsive?.[breakpointId], current.nodes[nodeId]?.responsive?.[breakpointId])) {
          throw new KernelError("conflict", "responsive override changed since base", nodeId, { breakpointId });
        }
      }
    }
  }
}
export function applyWebCommand(current: WebDocument, command: CommandEnvelope, base: WebDocument): { document: WebDocument; changedNodeIds: string[] } {
  validateWebDocument(current); validateWebDocument(base);
  if (!rec(command) || !id(command.commandId) || !id(command.projectId) || !id(command.actorId) || !id(command.clientId) || !["human", "agent", "system"].includes(command.actorKind) || typeof command.label !== "string" || !command.label.trim() || command.runId !== undefined && !id(command.runId) || !Array.isArray(command.preconditions) || command.documentId !== current.documentId || command.documentId !== base.documentId || !Number.isInteger(command.baseRevision) || command.baseRevision !== base.revision || base.revision > current.revision || current.revision === base.revision && !equal(current, base) || !Array.isArray(command.operations) || !command.operations.length) throw new KernelError("invalid", "invalid Web command or base revision");
  checkPreconditions(base, command); if (base.revision !== current.revision) checkPreconditions(current, command);
  const next = clone(current); const changed = new Set<string>();
  try { for (const raw of command.operations) { if (!("type" in raw) || !raw.type.startsWith("web.") && !raw.type.startsWith("source.") && raw.type !== "asset.register") invalid("operation is not supported by WebDocument"); checkStale(current, base, raw as WebOperation); applyOne(next, raw as WebOperation, changed); } next.revision = current.revision + 1; validateWebDocument(next); return { document: next, changedNodeIds: [...changed] }; }
  catch (error) { if (error instanceof KernelError) throw error; throw new KernelError("invalid", error instanceof Error ? error.message : String(error)); }
}

export function restoreWebDocument(current: WebDocument, snapshot: WebDocument): WebDocument {
  validateWebDocument(current); validateWebDocument(snapshot); if (current.documentId !== snapshot.documentId) throw new KernelError("invalid", "snapshot belongs to another document"); const restored = clone(snapshot); restored.revision = current.revision + 1; validateWebDocument(restored); return restored;
}
