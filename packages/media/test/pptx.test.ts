import { strict as assert } from "node:assert";
import JSZip from "jszip";
import test from "node:test";
import { createDeckDocument } from "@oeydesign/document";
import { exportDeckPptx } from "../src/pptx.ts";

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

async function unzip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

test("exports a three-page native PPTX with editable text, shape and group world geometry", async () => {
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
  assert.ok(paragraphs.every((paragraph) => [...paragraph.matchAll(/<a:pPr\b/g)].length === 1), `each text paragraph has one paragraph-properties element: ${paragraphs.join(" | ")}`);
  assert.match(slide, /<a:latin typeface="Georgia"/);

  // -30 degrees is serialized as the equivalent unsigned 330 degree OOXML rotation.
  assert.match(slide, /<a:xfrm rot="19800000"/);
  // The title's 45 degree local turn combines with its group's -30 degrees.
  assert.match(slide, /<a:xfrm rot="900000"/);
  const redShape = slide.match(/<p:sp>.*?<p:cNvPr[^>]*name="Red Box".*?<a:xfrm rot="19800000"[^>]*>.*?<a:off x="(\d+)" y="(\d+)"\/>.*?<a:ext cx="(\d+)" cy="(\d+)"\/>.*?<\/p:sp>/s);
  assert.ok(redShape, "shape retains its name and group-adjusted geometry");
  assert.deepEqual(redShape.slice(1).map(Number), [2_114_184, 806_206, 952_500, 381_000]);
  assert.match(slide, /<a:solidFill><a:srgbClr val="FF0000"\s*\/>/);
});

test("refuses image nodes and mixed slide sizes with specific errors", async () => {
  const withImage = createDeckDocument({ documentId: "image-deck", name: "Image Deck" });
  const page = withImage.pages[0]!;
  page.children.push("image");
  withImage.nodes.image = {
    id: "image", kind: "image", parentId: page.id,
    geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    style: {}, locked: false, hidden: false, assetId: "asset-1",
  };
  await assert.rejects(exportDeckPptx(withImage), /Cannot export image node image: media export has no asset-byte resolver yet\./);

  const mixed = createDeckDocument({ documentId: "mixed-deck", name: "Mixed Deck" });
  mixed.pages.push({ id: "wide", name: "Wide", width: 1920, height: 1080, children: [] });
  await assert.rejects(exportDeckPptx(mixed), /Cannot export mixed page sizes.*PPTX uses one size for every slide/);
});
