import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { WebDocument } from "@oeydesign/document";
import { renderWebHtml, exportWebZip, buildWebSource, renderWebMarkup, renderWebStyles, renderWebPng, exportWebPdf } from "../src/index.ts";

function fixture(): WebDocument {
  return {schemaVersion:1,documentId:"web-1",kind:"web",revision:4,name:"Test",breakpoints:[{id:"mobile",maxWidth:600}],assets:[{id:"pixel",kind:"image",mimeType:"image/png",width:1,height:1}],pages:[{id:"home",name:"Home",route:"/",rootId:"root"},{id:"about",name:"About",route:"/about",rootId:"about-root"}],nodes:{
    root:{id:"root",parentId:null,tag:"main",children:["title","link","image"],style:{color:"red"},layout:{mode:"flow"}},
    title:{id:"title",parentId:"root",tag:"h1",children:[],text:"<script>alert(1)</script>",style:{fontSize:24},layout:{mode:"flow"}},
    link:{id:"link",parentId:"root",tag:"a",children:[],text:"About",props:{href:"/about",onclick:"alert(1)"},style:{},layout:{mode:"flow"}},
    image:{id:"image",parentId:"root",tag:"img",children:[],props:{assetId:"pixel",alt:"pixel"},style:{width:24,height:24},layout:{mode:"flow"}},
    "about-root":{id:"about-root",parentId:null,tag:"section",children:["about-image"],text:"About page",style:{},layout:{mode:"grid"}},
    "about-image":{id:"about-image",parentId:"about-root",tag:"img",children:[],props:{assetId:"pixel",alt:"pixel two"},style:{width:12,height:12},layout:{mode:"flow"}},
  }};
}
const assetResolver = async (id: string) => { assert.equal(id,"pixel"); return new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv2sAAAAASUVORK5CYII=","base64")); };
test("Web HTML escapes text, maps local routes, emits stable IDs and responsive CSS",async()=>{
  const doc=fixture();const html=await renderWebHtml(doc,"home",assetResolver);assert.match(html,/data-oey-node-id="root"/);assert.match(html,/href="about\/index.html"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);assert.match(html,/font-size:24px/);assert.match(html,/data-oey-revision="4"/);
  assert.match(renderWebStyles(doc),/display:grid/);const imageUrl=`data:image/png;base64,${Buffer.from(await assetResolver("pixel")).toString("base64")}`;assert.match(renderWebMarkup(doc,"home",{pixel:imageUrl},{editing:true}),/data-page-root/);
});
test("static ZIP is multi-page and round-trips document",async()=>{const doc=fixture();const zip=await JSZip.loadAsync(await exportWebZip(doc,assetResolver));assert.ok(await zip.file("index.html")?.async("string"));assert.ok(await zip.file("about/index.html")?.async("string"));assert.deepEqual(JSON.parse(await zip.file("oey-document.json")!.async("string")),doc);assert.match(await zip.file("oey-metadata.json")!.async("string"),/"revision": 4/)});
test("source project includes component bindings and rejects unsafe paths",async()=>{const doc=fixture();doc.sourceModules=[{id:"card",path:"components/Card.tsx",language:"tsx",source:"export default function Card(){return <b>Card</b>}",exports:["default"]}];doc.nodes.title!.component={moduleId:"card",exportName:"default"};const src=await buildWebSource(doc,assetResolver);assert.match(src["src/App.tsx"] as string,/import OeyComponent0 from "\.\/components\/Card"/);assert.ok(src["src/components/Card.tsx"]);doc.sourceModules[0]!.path="../evil.tsx";await assert.rejects(buildWebSource(doc,assetResolver),/invalid Web source module/)});

test("Chrome rasterizes Web images and exports every page to PDF",async()=>{
  const doc=fixture();
  const png=Buffer.from(await renderWebPng(doc,"home",assetResolver,{width:320,height:200}));assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");assert.equal(png.readUInt32BE(16),320);assert.ok(png.readUInt32BE(20)>=200);
  const pdf=Buffer.from(await exportWebPdf(doc,assetResolver));assert.ok(pdf.toString("latin1").startsWith("%PDF-"));assert.equal([...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,2);
});
