import assert from "node:assert/strict";
import test from "node:test";
import {
  KernelError, applyCommand, createDeckDocument, createTextReplaceStep, normalizeKonvaTransform,
  restoreDocument, textFromString, textToString, validateDocument, type CommandEnvelope, type DeckNode
} from "../src/index.ts";

const node = (id: string, parentId: string, kind: DeckNode["kind"] = "shape"): DeckNode => ({ id, kind, parentId, geometry: { x: 1, y: 2, width: 100, height: 40, rotation: 0 }, style: {}, locked: false, hidden: false, ...(kind === "text" ? { content: textFromString("Hello") } : {}), ...(kind === "group" ? { children: [] } : {}) });
const command = (documentId: string, operations: CommandEnvelope["operations"], baseRevision = 0, preconditions: CommandEnvelope["preconditions"] = []): CommandEnvelope => ({ commandId: crypto.randomUUID(), projectId: "project", documentId, actorId: "actor", actorKind: "human", clientId: "client", baseRevision, preconditions, operations, label: "test" });
const pageIdOf = (document: ReturnType<typeof createDeckDocument>): string => document.pages[0]!.id;

test("layer indices describe final order, and reparent appends into an empty group", () => {
  const empty = createDeckDocument({ documentId: 'deck', name: 'Layers' });
  const page = pageIdOf(empty);
  const base = applyCommand(empty, command('deck', [
    { type: 'node.insert', node: node('first', page) },
    { type: 'node.insert', node: node('second', page) },
    { type: 'node.insert', node: node('group', page, 'group') },
  ]), empty).document;
  const reordered = applyCommand(base, command('deck', [{ type: 'node.reorder', nodeId: 'first', index: 2 }], base.revision), base).document;
  assert.deepEqual(reordered.pages[0]!.children, ['second', 'group', 'first']);
  const nested = applyCommand(reordered, command('deck', [{ type: 'node.reparent', nodeId: 'first', parentId: 'group' }], reordered.revision), reordered).document;
  assert.deepEqual(nested.nodes.group!.children, ['first']);
});

test("text can replay after an unrelated move but not after another text edit", () => {
  const empty = createDeckDocument({ documentId: 'deck', name: 'Text' });
  const base = applyCommand(empty, command('deck', [{ type: 'node.insert', node: node('title', pageIdOf(empty), 'text') }]), empty).document;
  const moved = applyCommand(base, command('deck', [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 300 } }], base.revision), base).document;
  const replace = command('deck', [{ type: 'text.apply', nodeId: 'title', steps: [createTextReplaceStep(1, 6, 'World')] }], base.revision);
  const result = applyCommand(moved, replace, base).document;
  assert.equal(result.nodes.title!.geometry.x, 300);
  assert.equal(textToString(result.nodes.title!.content!), 'World');
  assert.throws(() => applyCommand(result, replace, base), { code: 'conflict' });
});

test("nested locked ancestors prevent inserting and reparenting into their descendants", () => {
  const empty = createDeckDocument({ documentId: 'deck', name: 'Locked tree' });
  const page = pageIdOf(empty);
  const base = applyCommand(empty, command('deck', [
    { type: 'node.insert', node: node('outer', page, 'group') },
    { type: 'node.insert', node: node('inner', 'outer', 'group') },
    { type: 'node.insert', node: node('outside', page) },
    { type: 'node.flags.update', nodeId: 'outer', flags: { locked: true } },
  ]), empty).document;
  assert.throws(() => applyCommand(base, command('deck', [{ type: 'node.insert', node: node('inside', 'inner') }], base.revision), base), { code: 'locked' });
  assert.throws(() => applyCommand(base, command('deck', [{ type: 'node.reparent', nodeId: 'outside', parentId: 'inner' }], base.revision), base), { code: 'locked' });
});

test("creates and validates a stable empty deck", () => {
  const document = createDeckDocument({ documentId: "deck", name: "Demo" });
  assert.equal(document.revision, 0); assert.equal(document.pages[0]!.children.length, 0); validateDocument(document);
});

test("applies an atomic insert and geometry update", () => {
  const current = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(current);
  const result = applyCommand(current, command(current.documentId, [{ type: "node.insert", node: node("shape", pageId) }, { type: "geometry.update", nodeId: "shape", geometry: { x: 20 } }]), current);
  assert.equal(result.document.revision, 1); assert.deepEqual(result.document.nodes.shape!.geometry.x, 20); assert.deepEqual(current.pages[0]!.children, []); assert.deepEqual(result.changedNodeIds, ["shape"]);
});

test("rejects locked nodes and rolls back a failed batch", () => {
  const current = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(current); const inserted = applyCommand(current, command(current.documentId, [{ type: "node.insert", node: node("shape", pageId) }]), current).document;
  inserted.nodes.shape!.locked = true;
  assert.throws(() => applyCommand(inserted, command(inserted.documentId, [{ type: "geometry.update", nodeId: "shape", geometry: { x: 2 } }, { type: "node.remove", nodeId: "missing" }], inserted.revision), inserted), (error: unknown) => error instanceof KernelError && error.code === "locked");
  assert.equal(inserted.nodes.shape!.geometry.x, 1);
});

test("allows stale edits to independent properties and rejects same property", () => {
  const base = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(base); const withNode = applyCommand(base, command(base.documentId, [{ type: "node.insert", node: node("shape", pageId) }]), base).document;
  const current = applyCommand(withNode, command(withNode.documentId, [{ type: "geometry.update", nodeId: "shape", geometry: { x: 8 } }], withNode.revision), withNode).document;
  const independent = applyCommand(current, command(current.documentId, [{ type: "style.update", nodeId: "shape", style: { fill: "red" } }], withNode.revision), withNode).document;
  assert.equal(independent.nodes.shape!.geometry.x, 8); assert.equal(independent.nodes.shape!.style.fill, "red");
  assert.throws(() => applyCommand(current, command(current.documentId, [{ type: "geometry.update", nodeId: "shape", geometry: { x: 9 } }], withNode.revision), withNode), (error: unknown) => error instanceof KernelError && error.code === "conflict");
});

test("text helpers and ProseMirror steps preserve structured content", () => {
  const content = textFromString("Hello"); const step = createTextReplaceStep(1, 6, "World");
  const current = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(current);
  const withText = applyCommand(current, command(current.documentId, [{ type: "node.insert", node: node("title", pageId, "text") }]), current).document;
  const result = applyCommand(withText, command(withText.documentId, [{ type: "text.apply", nodeId: "title", steps: [step] }], withText.revision), withText).document;
  assert.equal(textToString(content), "Hello"); assert.equal(textToString(result.nodes.title!.content!), "World");
});

test("restore makes a new revision and geometry helpers stay pure", () => {
  const current = createDeckDocument({ documentId: "deck", name: "Demo" }); const snapshot = structuredClone(current); snapshot.name = "Older";
  const restored = restoreDocument({ ...current, revision: 4 }, snapshot); assert.equal(restored.revision, 5); assert.equal(restored.name, "Older"); assert.equal(normalizeKonvaTransform({ x: 4, y: 5, width: 10, height: 20, scaleX: 2, scaleY: -1 }).width, 20);
});

test("rejects unsafe hierarchy keys, non-group children, and loose operations", () => {
  const document = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(document);
  const unsafe = structuredClone(document); unsafe.nodes = { constructor: node("constructor", pageId) } as typeof unsafe.nodes; unsafe.pages[0]!.children = ["constructor"];
  assert.throws(() => validateDocument(unsafe), (error: unknown) => error instanceof KernelError && error.code === "invalid");
  const nonGroup = structuredClone(document); nonGroup.nodes.shape = { ...node("shape", pageId), children: [] }; nonGroup.pages[0]!.children = ["shape"];
  assert.throws(() => validateDocument(nonGroup), (error: unknown) => error instanceof KernelError && error.code === "invalid");
  const withShape = applyCommand(document, command(document.documentId, [{ type: "node.insert", node: node("shape", pageId) }]), document).document;
  assert.throws(() => applyCommand(withShape, command(withShape.documentId, [{ type: "geometry.update", nodeId: "shape", geometry: { opacity: 1 } } as never], withShape.revision), withShape), (error: unknown) => error instanceof KernelError && error.code === "invalid");
  assert.throws(() => applyCommand(document, command(document.documentId, [{ op: "geometry.update", nodeId: "missing", geometry: { x: 1 } } as never]), document), (error: unknown) => error instanceof KernelError && error.code === "invalid");
});

test("checks stale preconditions and allows repeated edits in one stale batch", () => {
  const base = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(base);
  const withNode = applyCommand(base, command(base.documentId, [{ type: "node.insert", node: node("shape", pageId) }]), base).document;
  const current = applyCommand(withNode, command(withNode.documentId, [{ type: "geometry.update", nodeId: "shape", geometry: { x: 10 } }], withNode.revision), withNode).document;
  assert.throws(() => applyCommand(current, command(current.documentId, [{ type: "style.update", nodeId: "shape", style: { fill: "red" } }], withNode.revision, [{ type: "node.property", nodeId: "shape", path: "geometry.x", value: 1 }]), withNode), (error: unknown) => error instanceof KernelError && error.code === "conflict");
  const repeated = applyCommand(current, command(current.documentId, [{ type: "style.update", nodeId: "shape", style: { fill: "red" } }, { type: "style.update", nodeId: "shape", style: { fill: "blue" } }], withNode.revision), withNode).document;
  assert.equal(repeated.nodes.shape!.style.fill, "blue");
});

test("preserves world geometry on reparent and cannot move a locked descendant", () => {
  const base = createDeckDocument({ documentId: "deck", name: "Demo" }); const pageId = pageIdOf(base);
  const group = node("group", pageId, "group"); group.geometry = { x: 100, y: 50, width: 200, height: 100, rotation: 90 };
  const child = node("child", "group"); child.geometry = { x: 10, y: 0, width: 20, height: 20, rotation: 5 };
  const nested = applyCommand(base, command(base.documentId, [{ type: "node.insert", node: group }, { type: "node.insert", node: child }]), base).document;
  const moved = applyCommand(nested, command(nested.documentId, [{ type: "node.reparent", nodeId: "child", parentId: pageId }], nested.revision), nested).document;
  assert.ok(Math.abs(moved.nodes.child!.geometry.x - 100) < 1e-9); assert.ok(Math.abs(moved.nodes.child!.geometry.y - 60) < 1e-9); assert.equal(moved.nodes.child!.geometry.rotation, 95);
  const locked = structuredClone(nested); locked.nodes.child!.locked = true;
  assert.throws(() => applyCommand(locked, command(locked.documentId, [{ type: "node.reparent", nodeId: "group", parentId: pageId }], locked.revision), locked), (error: unknown) => error instanceof KernelError && error.code === "locked");
});

test("rejects incomplete envelopes and same-revision mismatched base snapshots", () => {
  const document = createDeckDocument({ documentId: "deck", name: "Demo" });
  assert.throws(() => applyCommand(document, { documentId: document.documentId } as never, document), (error: unknown) => error instanceof KernelError && error.code === "invalid");
  const mismatched = structuredClone(document); mismatched.name = "other";
  assert.throws(() => applyCommand(document, command(document.documentId, [{ type: "page.insert", page: { id: "p2", name: "Page 2", width: 100, height: 100, children: [] } }]), mismatched), (error: unknown) => error instanceof KernelError && error.code === "invalid");
});
