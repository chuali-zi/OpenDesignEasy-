import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createDeckDocument, textFromString, type DeckNode } from "@oeydesign/document";
import { exportDeckPdf, renderDeckPng, renderDeckSvg } from "../src/index.ts";

function rasterDeck() {
  const document = createDeckDocument({ documentId: "raster-deck", name: "Raster deck" });
  document.pages[0]!.width = 640;
  document.pages[0]!.height = 360;
  document.pages.push(
    { id: "page-two", name: "Table", width: 640, height: 360, children: [] },
    { id: "page-three", name: "Chart", width: 640, height: 360, children: [] },
  );
  const put = (node: DeckNode) => { document.nodes[node.id] = node; document.pages.find(page => page.id === node.parentId)!.children.push(node.id); };
  put({ id: "shape", kind: "shape", parentId: document.pages[0]!.id, geometry: { x: 20, y: 30, width: 180, height: 90, rotation: 5 }, style: { fill: "#315646", stroke: "none" }, locked: false, hidden: false });
  put({ id: "title", kind: "text", parentId: document.pages[0]!.id, geometry: { x: 30, y: 45, width: 170, height: 55, rotation: 0 }, style: { fill: "#FFFFFF", fontSize: 24 }, locked: false, hidden: false, content: textFromString("Chrome PNG") });
  put({ id: "table", kind: "table", parentId: "page-two", geometry: { x: 20, y: 20, width: 600, height: 280, rotation: 0 }, style: {}, locked: false, hidden: false,
    table: { headerRows: 1, rows: [
      { id: "header", cells: [{ id: "h1", content: textFromString("Quarter") }, { id: "h2", content: textFromString("Sales") }] },
      { id: "body", cells: [{ id: "b1", content: textFromString("Q1") }, { id: "b2", content: textFromString("42") }] },
    ] } });
  put({ id: "chart", kind: "chart", parentId: "page-three", geometry: { x: 20, y: 20, width: 600, height: 300, rotation: 0 }, style: {}, locked: false, hidden: false,
    chart: { type: "bar", title: "Quarterly", categories: ["Q1", "Q2"], series: [{ id: "s", name: "Sales", values: [20, 42] }], legend: true, dataLabels: true } });
  return document;
}

test("headless Chrome renders exact-size PNG and complete multipage PDF", async () => {
  const document = rasterDeck();
  const png = Buffer.from(await renderDeckPng(document, "page-two"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 360);

  const pdfBytes = await exportDeckPdf(document);
  const pdf = Buffer.from(pdfBytes).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.equal([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length, 3);
});

test("honors an already-aborted browser rendering request", async () => {
  const document = rasterDeck();
  const controller = new AbortController();
  controller.abort(new Error("cancelled by caller"));
  await assert.rejects(renderDeckPng(document, undefined, undefined, { signal: controller.signal }), /cancelled by caller/);
});

test("SVG rich text wraps CJK and Latin runs at the actual logical text-box width", async () => {
  const document = createDeckDocument({ documentId: "wrap-deck", name: "Wrap deck" });
  const page = document.pages[0]!;
  page.width = 240;
  page.height = 180;
  page.children.push("wrapped");
  document.nodes.wrapped = { id: "wrapped", kind: "text", parentId: page.id,
    geometry: { x: 10, y: 10, width: 120, height: 140, rotation: 0 }, style: { fontSize: 20, fontFamily: "Arial" }, locked: false, hidden: false,
    content: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "A long English phrase that wraps and continues 中文自动换行测试", marks: [{ type: "textStyle", attrs: { color: "#315646" } }] },
    ] }] } };
  const svg = await renderDeckSvg(document);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 240, height: 180 } });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const result = await page.evaluate(() => {
      const box = window.document.querySelector<SVGForeignObjectElement>('[data-node-id="wrapped"] foreignObject');
      const paragraph = box?.querySelector("p");
      if (!box || !paragraph) throw new Error("SVG foreignObject text box was not rendered.");
      const range = window.document.createRange();
      range.selectNodeContents(paragraph);
      const lines = Array.from(range.getClientRects()).map(rect => ({ top: rect.top, left: rect.left, right: rect.right }));
      return { box: box.getBoundingClientRect().toJSON(), lines };
    });
    assert.ok(new Set(result.lines.map(line => line.top)).size > 1, "real browser layout wraps text onto multiple visual lines");
    assert.ok(result.lines.every(line => line.right <= result.box.right + 1), "wrapped lines stay within the node width");
  } finally {
    await browser.close();
  }
});
