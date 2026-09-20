import { strict as assert } from "node:assert";
import JSZip from "jszip";
import test from "node:test";
import { createDeckDocument, textFromString, type DeckDocument, type DeckNode, type ImageAsset } from "@oeydesign/document";
import { exportDeckPptx } from "../src/pptx.ts";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ks8AAAAASUVORK5CYII=", "base64");

function nativeDeck() {
  const document = createDeckDocument({ documentId: "native-deck", name: "Native Deck" });
  const firstPage = document.pages[0]!;
  document.pages.push(
    { id: "page-2", name: "Page 2", width: firstPage.width, height: firstPage.height, children: [] },
    { id: "page-3", name: "Page 3", width: firstPage.width, height: firstPage.height, children: [] },
  );
  firstPage.children.push("group");
  document.nodes.group = {
    id: "group", kind: "group", parentId: firstPage.id,
    geometry: { x: 200, y: 100, width: 300, height: 200, rotation: -30 },
    style: {}, locked: false, hidden: false, children: ["box", "title"],
  };
  document.nodes.box = {
    id: "box", kind: "shape", parentId: "group",
    geometry: { x: 10, y: 20, width: 100, height: 40, rotation: 0 },
    style: { name: "Red Box", fill: "#ff0000", stroke: "none" }, locked: false, hidden: false,
  };
  document.nodes.title = {
    id: "title", kind: "text", parentId: "group",
    geometry: { x: 50, y: 60, width: 600, height: 100, rotation: 45 },
    style: { name: "Title", fill: "#112233", fontSize: 36, fontFamily: "Georgia" }, locked: false, hidden: false,
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [
          { type: "text", text: "One", marks: [{ type: "strong" }] },
          { type: "text", text: " italic", marks: [{ type: "em" }] },
        ] },
        { type: "paragraph", content: [{ type: "text", text: "Second line 中文" }] },
      ],
    },
  };
  return document;
}

function mixedDeck(): DeckDocument {
  const document = createDeckDocument({ documentId: "mixed-native-deck", name: "Mixed Native Deck" });
  document.theme = { name: "Forest", bodyFontFamily: "Georgia", headingFontFamily: "Aptos Display", colors: { accent1: "#315646", text1: "#18221C", background1: "#FFFFFF" } };
  document.pages.push(
    { id: "page-table", name: "Table", width: 1280, height: 720, children: [] },
    { id: "page-charts", name: "Charts", width: 1280, height: 720, children: [] },
  );
  const asset: ImageAsset = { id: "photo-1", kind: "image", mimeType: "image/png", width: 1, height: 1, name: "pixel.png", sizeBytes: tinyPng.byteLength };
  document.assets = [asset];
  const put = (node: DeckNode) => { document.nodes[node.id] = node; document.pages.find(page => page.id === node.parentId)!.children.push(node.id); };
  put({ id: "photo", kind: "image", parentId: document.pages[0]!.id, assetId: asset.id,
    geometry: { x: 50, y: 80, width: 240, height: 120, rotation: 7 }, style: { name: "Hero photo" }, locked: false, hidden: false,
    image: { fit: "cover", crop: { left: 0.1, top: 0, right: 0.15, bottom: 0 }, opacity: 0.35 } });
  put({ id: "table", kind: "table", parentId: "page-table",
    geometry: { x: 50, y: 40, width: 800, height: 300, rotation: -15 }, style: { name: "Editable table", fontSize: 20 }, locked: false, hidden: false,
    table: { headerRows: 1, columnWidths: [240, 360], borderColor: "#CCD7C7", borderWidth: 1, cellPadding: 12, rows: [
      { id: "header", height: 100, cells: [
        { id: "h1", content: textFromString("Quarter") },
        { id: "h2", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Sales", marks: [{ type: "strong" }, { type: "textStyle", attrs: { color: "#D4AA72", fontSize: 24 } }] }] }] } },
      ] },
      { id: "row1", height: 100, cells: [
        { id: "r1c1", content: textFromString("Q1") },
        { id: "r1c2", content: textFromString("120") },
      ] },
    ] } });
  for (const [index, type] of (["bar", "line", "pie"] as const).entries()) {
    put({ id: `chart-${type}`, kind: "chart", parentId: "page-charts",
      geometry: { x: 30 + index * 410, y: 60, width: 380, height: 380, rotation: 0 }, style: { name: `Chart ${type}` }, locked: false, hidden: false,
      chart: { type, title: type.toUpperCase(), categories: ["Q1", "Q2", "Q3"], series: [{ id: "sales", name: "Sales", values: [12, 24, 38], color: "#315646" }], legend: true, dataLabels: true } });
  }
  return document;
}

async function unzip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

test("exports editable text and shapes with nested world geometry and rich text", async () => {
  const document = nativeDeck();
  const before = structuredClone(document);
  const buffer = await exportDeckPptx(document);
  assert.deepEqual(document, before);
  assert.equal(String.fromCharCode(buffer[0]!, buffer[1]!), "PK");

  const zip = await unzip(buffer);
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.equal([...presentation.matchAll(/<p:sldId\b/g)].length, 3);

  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.equal([...slide.matchAll(/<p:sp>/g)].length, 2);
  assert.match(slide, /<a:t>One<\/a:t>/);
  assert.match(slide, /<a:t> italic<\/a:t>/);
  assert.match(slide, /<a:t>Second line 中文<\/a:t>/);
  assert.match(slide, /<a:rPr[^>]*\bb="1"/);
  assert.match(slide, /<a:rPr[^>]*\bi="1"/);
  const textBody = slide.match(/<p:txBody>.*?<\/p:txBody>/s)?.[0];
  assert.ok(textBody);
  const paragraphs = [...textBody.matchAll(/<a:p>.*?<\/a:p>/gs)].map(([paragraph]) => paragraph);
  assert.equal(paragraphs.length, 2);
  assert.ok(paragraphs.every(paragraph => [...paragraph.matchAll(/<a:pPr\b/g)].length === 1));
  assert.match(slide, /<a:latin typeface="Georgia"/);
  assert.match(slide, /<a:xfrm rot="19800000"/);
  assert.match(slide, /<a:xfrm rot="900000"/);
  const redShape = slide.match(/<p:sp>.*?<p:cNvPr[^>]*name="Red Box".*?<a:xfrm rot="19800000"[^>]*>.*?<a:off x="(\d+)" y="(\d+)"\/>.*?<a:ext cx="(\d+)" cy="(\d+)"\/>.*?<\/p:sp>/s);
  assert.ok(redShape, "shape retains its name and group-adjusted geometry");
  assert.deepEqual(redShape.slice(1).map(Number), [2_114_184, 806_206, 952_500, 381_000]);
  assert.match(slide, /<a:solidFill><a:srgbClr val="FF0000"\s*\/>/);
});

test("exports native image, table, bar/line/pie charts and theme in three pages", async () => {
  const document = mixedDeck();
  const before = structuredClone(document);
  const bytes = await exportDeckPptx(document, async id => {
    assert.equal(id, "photo-1");
    return new Uint8Array(tinyPng);
  });
  assert.deepEqual(document, before);
  const zip = await unzip(bytes);
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.equal([...presentation.matchAll(/<p:sldId\b/g)].length, 3);

  const imageSlide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(imageSlide, /<p:pic>/);
  assert.match(imageSlide, /<a:alphaModFix amt="35000"\/>/);
  assert.match(imageSlide, /<a:srcRect l="10000" t="31250" r="15000" b="31250"\/>/);

  const tableSlide = await zip.file("ppt/slides/slide2.xml")!.async("string");
  assert.match(tableSlide, /<a:tbl>/);
  assert.match(tableSlide, /<a:t>Quarter<\/a:t>/);
  assert.match(tableSlide, /<a:t>Sales<\/a:t>/);
  assert.match(tableSlide, /<a:rPr[^>]*\bb="1"/);
  assert.match(tableSlide, /<a:rPr[^>]*\bsz="1800"/);
  assert.match(tableSlide, /<a:tcPr[^>]*anchor="ctr"/);
  assert.match(tableSlide, /<p:xfrm rot="20700000"/);

  const chartFiles = Object.keys(zip.files).filter(path => /^ppt\/charts\/chart\d+\.xml$/.test(path));
  assert.equal(chartFiles.length, 3);
  const charts = await Promise.all(chartFiles.map(path => zip.file(path)!.async("string")));
  assert.ok(charts.some(chart => /<c:barChart>/.test(chart)));
  assert.ok(charts.some(chart => /<c:lineChart>/.test(chart)));
  assert.ok(charts.some(chart => /<c:pieChart>/.test(chart)));
  const theme = await zip.file("ppt/theme/theme1.xml")!.async("string");
  assert.match(theme, /<a:clrScheme name="Forest"/);
  assert.match(theme, /<a:accent1><a:srgbClr val="315646"\/>/);
  assert.match(theme, /<a:latin typeface="Georgia"/);
});

test("requires a byte resolver for registered images and rejects mixed slide sizes", async () => {
  const withImage = createDeckDocument({ documentId: "image-deck", name: "Image Deck" });
  const page = withImage.pages[0]!;
  withImage.assets = [{ id: "asset-1", kind: "image", mimeType: "image/png", width: 10, height: 10 }];
  page.children.push("image");
  withImage.nodes.image = {
    id: "image", kind: "image", parentId: page.id,
    geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    style: {}, locked: false, hidden: false, assetId: "asset-1",
  };
  await assert.rejects(exportDeckPptx(withImage), /provide an asset resolver for asset-1/);

  const mixed = createDeckDocument({ documentId: "mixed-deck", name: "Mixed Deck" });
  mixed.pages.push({ id: "wide", name: "Wide", width: 1920, height: 1080, children: [] });
  await assert.rejects(exportDeckPptx(mixed), /Cannot export mixed page sizes.*PPTX uses one size for every slide/);
});
