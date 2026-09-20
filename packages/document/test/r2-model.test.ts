import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommand, createDeckDocument, textFromString, textSchema, validateDocument,
  type ChartData, type CommandEnvelope, type DeckNode, type ImageAsset, type TableData,
} from "../src/index.ts";

const command = (documentId: string, operations: CommandEnvelope["operations"], baseRevision = 0): CommandEnvelope => ({
  commandId: crypto.randomUUID(), projectId: "project", documentId, actorId: "editor", actorKind: "human", clientId: "test",
  baseRevision, preconditions: [], operations, label: "R2 model test",
});

const imageAsset = (id: string): ImageAsset => ({ id, kind: "image", mimeType: "image/png", width: 640, height: 480, name: `${id}.png`, sizeBytes: 2048 });
const cellText = (id: string, value: string) => ({ id, content: textFromString(value) });
const tableData = (value = "Revenue"): TableData => ({
  rows: [
    { id: "header", cells: [cellText("h1", "Quarter"), cellText("h2", value)] },
    { id: "row-1", cells: [cellText("r1c1", "Q1"), cellText("r1c2", "$120")] },
  ],
  columnWidths: [180, 140], headerRows: 1, borderColor: "#CCD4DD", borderWidth: 1, cellPadding: 8,
});
const chartData = (title = "Quarterly sales"): ChartData => ({
  type: "bar", title, categories: ["Q1", "Q2", "Q3"],
  series: [{ id: "sales", name: "Sales", values: [120, 160, 140], color: "#2F855A" }], legend: true, dataLabels: false,
});
const makeNode = (id: string, parentId: string, kind: DeckNode["kind"], extra: Partial<DeckNode> = {}): DeckNode => ({
  id, parentId, kind, geometry: { x: 20, y: 30, width: 320, height: 180, rotation: 0 }, style: {}, locked: false, hidden: false, ...extra,
});

test("validates and preserves rich text styling and paragraph attributes", () => {
  const document = createDeckDocument({ documentId: "rich-text", name: "Rich text" });
  const paragraph = {
    type: "paragraph",
    attrs: { align: "center", lineHeight: 28, spaceBefore: 4, spaceAfter: 8, indent: 12, firstLineIndent: 6 },
    content: [{ type: "text", text: "Styled", marks: [
      { type: "strong" }, { type: "underline" },
      { type: "textStyle", attrs: { color: "#245A42", fontFamily: "Georgia", fontSize: 32, backgroundColor: "#FFF1CC" } },
    ] }],
  };
  document.pages[0]!.children.push("title");
  document.nodes.title = makeNode("title", document.pages[0]!.id, "text", { content: { type: "doc", content: [paragraph] } });
  validateDocument(document);
  const roundTrip = textSchema.nodeFromJSON(document.nodes.title!.content).toJSON();
  assert.deepEqual({ ...roundTrip.content?.[0]?.attrs }, paragraph.attrs);
  assert.deepEqual(roundTrip.content?.[0]?.content?.[0]?.marks?.map((mark: { type: string }) => mark.type), ["strong", "underline", "textStyle"]);
  const invalidText = {
    ...document,
    nodes: {
      ...document.nodes,
      title: { ...document.nodes.title!, content: { type: "doc", content: [{ type: "paragraph", attrs: { align: "diagonal" } }] } },
    },
  };
  assert.throws(() => validateDocument(invalidText), /invalid text content/);
});

test("applies image, table, chart, theme, page and asset operations with field-level conflicts", () => {
  const document = createDeckDocument({ documentId: "typed-deck", name: "Typed deck" });
  const pageId = document.pages[0]!.id;
  const initial = applyCommand(document, command(document.documentId, [
    { type: "asset.register", asset: imageAsset("hero-original") },
    { type: "node.insert", node: makeNode("hero", pageId, "image", { assetId: "hero-original" }) },
    { type: "node.insert", node: makeNode("table", pageId, "table", { table: tableData() }) },
    { type: "node.insert", node: makeNode("chart", pageId, "chart", { chart: chartData() }) },
    { type: "document.theme", theme: { name: "Forest", fontFamily: "Aptos", colors: { accent1: "#2F855A", text1: "#18221C" } } },
  ]), document).document;
  assert.equal(initial.revision, 1);

  const cropChanged = applyCommand(initial, command(initial.documentId, [{
    type: "image.update", nodeId: "hero", image: { fit: "cover", crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 }, opacity: 0.8 },
  }], initial.revision), initial).document;
  const replaced = applyCommand(cropChanged, command(initial.documentId, [{ type: "asset.replace", nodeId: "hero", asset: imageAsset("hero-replacement") }], cropChanged.revision), cropChanged).document;
  assert.equal(replaced.nodes.hero!.assetId, "hero-replacement");
  assert.ok(Array.isArray(replaced.assets) ? replaced.assets.some((asset) => asset.id === "hero-original") : replaced.assets?.["hero-original"]);
  assert.equal(replaced.nodes.hero!.image?.opacity, 0.8);

  const objectBase = replaced;
  const chartChanged = applyCommand(objectBase, command(objectBase.documentId, [{ type: "chart.update", nodeId: "chart", chart: chartData("Updated chart") }], objectBase.revision), objectBase).document;
  const tableChanged = applyCommand(chartChanged, command(objectBase.documentId, [{ type: "table.update", nodeId: "table", table: tableData("Gross profit") }], objectBase.revision), objectBase).document;
  assert.equal(tableChanged.nodes.chart!.chart?.title, "Updated chart");
  assert.equal(tableChanged.nodes.table!.table?.rows[0]?.cells[1]?.content.content?.[0]?.content?.[0]?.text, "Gross profit");
  assert.throws(() => applyCommand(tableChanged, command(objectBase.documentId, [{ type: "table.update", nodeId: "table", table: tableData("Net profit") }], objectBase.revision), objectBase), { code: "conflict" });

  const colorChanged = applyCommand(objectBase, command(objectBase.documentId, [{ type: "document.theme", theme: { colors: { accent2: "#C05621" } } }], objectBase.revision), objectBase).document;
  const independentTheme = applyCommand(colorChanged, command(objectBase.documentId, [{ type: "document.theme", theme: { colors: { accent1: "#276749" } } }], objectBase.revision), objectBase).document;
  assert.equal(independentTheme.theme?.colors?.accent2, "#C05621");
  assert.equal(independentTheme.theme?.colors?.accent1, "#276749");
  assert.throws(() => applyCommand(colorChanged, command(objectBase.documentId, [{ type: "document.theme", theme: { colors: { accent2: "#DD6B20" } } }], objectBase.revision), objectBase), { code: "conflict" });

  const pageChanged = applyCommand(objectBase, command(objectBase.documentId, [{ type: "page.update", pageId, page: { name: "Cover" } }], objectBase.revision), objectBase).document;
  const resizedPage = applyCommand(pageChanged, command(objectBase.documentId, [{ type: "page.update", pageId, page: { width: 1600 } }], objectBase.revision), objectBase).document;
  assert.equal(resizedPage.pages[0]?.name, "Cover");
  assert.equal(resizedPage.pages[0]?.width, 1600);
  assert.throws(() => applyCommand(pageChanged, command(objectBase.documentId, [{ type: "page.update", pageId, page: { name: "Another cover" } }], objectBase.revision), objectBase), { code: "conflict" });

  const anotherAsset = applyCommand(replaced, command(replaced.documentId, [{ type: "asset.register", asset: imageAsset("extra") }], replaced.revision), replaced).document;
  assert.ok(Array.isArray(anotherAsset.assets) ? anotherAsset.assets.some((asset) => asset.id === "extra") : anotherAsset.assets?.extra);
});

test("rejects invalid structured tables, charts, images and theme values", () => {
  const base = createDeckDocument({ documentId: "invalid-typed", name: "Invalid typed" });
  const pageId = base.pages[0]!.id;
  assert.throws(() => applyCommand(base, command(base.documentId, [
    { type: "node.insert", node: makeNode("bad-chart", pageId, "chart", { chart: { ...chartData(), type: "pie", series: [chartData().series[0]!, { ...chartData().series[0]!, id: "second" }] } }) },
  ]), base), /pie charts require exactly one data series/);
  assert.throws(() => applyCommand(base, command(base.documentId, [{ type: "document.theme", theme: { colors: { accent1: "red" } } }]), base), /#RGB or #RRGGBB/);
  assert.throws(() => applyCommand(base, command(base.documentId, [{ type: "asset.register", asset: { ...imageAsset("bad"), width: 0 } }]), base), /invalid image asset metadata/);
});
