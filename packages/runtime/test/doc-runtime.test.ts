import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTextReplaceStep, textFromString, textToString, validateDocDocument, docSchema } from '@oeydesign/document';
import { ProjectRuntime, ProjectAssets } from '../src/index.ts';
import { exportDocumentArtifact, renderDocHtml } from '@oeydesign/media';
import JSZip from 'jszip';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwDHMDAAGJAM6JKQi9AAAAAElFTkSuQmCC','base64');

test('Doc section text, identity, shared history, retries, stale conflicts and independent properties survive reopen',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oey-doc-'));let runtime=ProjectRuntime.create(root);
  try{
    const doc=runtime.createDocument({kind:'doc',name:'Synthetic report'}),id=doc.documentId,sectionId=doc.sections[0]!.id,blockId=doc.sections[0]!.content.content![0]!.attrs!.id;
    const command=runtime.makeCommand(id,[{type:'doc.text.apply',sectionId,steps:[createTextReplaceStep(1,1,'中文报告'),{stepType:'addMark',from:1,to:5,mark:{type:'strong'}}]}]);
    const result=runtime.submit(command);assert.deepEqual(runtime.submit(command),result);
    assert.equal(textToString(runtime.readDocDocument(id).content),'中文报告');assert.equal(runtime.readDocDocument(id).sections[0]!.content.content![0]!.attrs!.id,blockId);
    runtime.undo(id);assert.equal(textToString(runtime.readDocDocument(id).content),'');runtime.redo(id);
    runtime.submit(runtime.makeCommand(id,[{type:'doc.section.insert',section:{id:'s2',name:'Evidence',content:textFromString('合成资料')}}]));
    const stale=runtime.makeCommand(id,[{type:'doc.text.apply',sectionId,steps:[createTextReplaceStep(1,1,'old')]}]);
    const independent=runtime.makeCommand(id,[{type:'doc.text.apply',sectionId:'s2',steps:[createTextReplaceStep(1,1,'Independent ')]}]);
    runtime.submit(runtime.makeCommand(id,[{type:'doc.text.apply',sectionId,steps:[createTextReplaceStep(1,1,'人工作品 ')]}],{actorId:'human'}));
    assert.throws(()=>runtime.submit(stale),/changed since base/);runtime.submit(independent);
    const before=runtime.readDocDocument(id);assert.throws(()=>runtime.submit(runtime.makeCommand(id,[{type:'doc.page.update',settings:{marginLeft:10000}},{type:'doc.section.remove',sectionId:'s2'}])),/insufficient/);assert.deepEqual(runtime.readDocDocument(id),before);
    const modified=structuredClone(before);modified.content=textFromString('second truth');assert.throws(()=>validateDocDocument(modified),/projection/);
    runtime.close();runtime=ProjectRuntime.open(root);assert.deepEqual(runtime.readDocDocument(id),before);
    const version=runtime.createVersion(id,'checkpoint');runtime.submit(runtime.makeCommand(id,[{type:'doc.section.reorder',sectionId:'s2',index:0}]));runtime.restoreVersion(version.versionId);assert.deepEqual(runtime.readDocDocument(id).sections,before.sections);
  }finally{runtime.close();await rm(root,{recursive:true,force:true});}
});

test('Doc native export preserves sections, CJK runs, tables, lists, image bytes, styles and headers/footers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oey-doc-media-'));const runtime=ProjectRuntime.create(root);
  try{
    const assets=new ProjectAssets(runtime),asset=await assets.importImage(pixel,'synthetic.png');const doc=runtime.createDocument({kind:'doc',name:'Native report'}),id=doc.documentId,sectionId=doc.sections[0]!.id;
    const body={type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'中文正式报告',marks:[{type:'strong'}]}]},{type:'paragraph',content:[{type:'text',text:'原始插图 '},{type:'inline_image',attrs:{assetId:asset.id,width:48,height:48,alt:'Synthetic pixel'}}]},{type:'ordered_list',attrs:{order:3},content:[{type:'list_item',content:[{type:'paragraph',content:[{type:'text',text:'Third'}]}]}]},{type:'table',attrs:{headerRows:1},content:[{type:'table_row',content:[{type:'table_cell',content:[{type:'paragraph',content:[{type:'text',text:'证据'}]}]},{type:'table_cell',content:[{type:'paragraph',content:[{type:'text',text:'数值'}]}]}]},{type:'table_row',content:[{type:'table_cell',content:[{type:'paragraph',content:[{type:'text',text:'Synthetic'}]}]},{type:'table_cell',content:[{type:'paragraph',content:[{type:'text',text:'42'}]}]}]}]}]};
    const steps=[{stepType:'replace',from:0,to:docSchema.nodeFromJSON(doc.content).content.size,slice:{content:body.content}}];
    runtime.submit(runtime.makeCommand(id,[{type:'asset.register',asset},{type:'doc.style.update',styleId:'Body',style:{fontFamily:'Noto Sans CJK SC',fontSize:16,lineHeight:24,color:'#18231d'}},{type:'doc.section.update',sectionId,styleId:'Body'},{type:'doc.text.apply',sectionId,steps},{type:'doc.text.apply',sectionId,part:'header',steps:[createTextReplaceStep(1,1,'Synthetic header')]},{type:'doc.text.apply',sectionId,part:'footer',steps:[createTextReplaceStep(1,1,'Synthetic footer')]},{type:'doc.section.insert',section:{id:'second',name:'Appendix',content:textFromString('附录内容'),pageSettings:{width:1122.5197,height:793.7008,marginTop:72,marginRight:72,marginBottom:72,marginLeft:72}}}]));
    const committed=runtime.readDocDocument(id),bytes=await exportDocumentArtifact(committed,assets.resolve,'docx'),zip=await JSZip.loadAsync(bytes);
    const xml=await zip.file('word/document.xml')!.async('string');assert.match(xml,/中文正式报告/);assert.match(xml,/<w:tbl>/);assert.match(xml,/<w:tblHeader/);assert.match(xml,/<w:numPr>/);assert.equal((xml.match(/<w:sectPr>/g)??[]).length,2);assert.match(xml,/<wp:inline/);assert.match(await zip.file('word/styles.xml')!.async('string'),/Noto Sans CJK SC/);assert.match(await zip.file('word/numbering.xml')!.async('string'),/<w:start w:val="3"/);
    assert.equal(Object.keys(zip.files).filter(n=>/^word\/header\d+\.xml$/.test(n)).length,2);assert.equal(Object.keys(zip.files).filter(n=>/^word\/footer\d+\.xml$/.test(n)).length,2);const imageName=Object.keys(zip.files).find(n=>n.startsWith('word/media/')&&n.endsWith('.png'))!;assert.deepEqual(await zip.file(imageName)!.async('nodebuffer'),pixel);
    const html=await renderDocHtml(committed,assets.resolve);assert.match(html,/中文正式报告/);assert.match(html,/data-section-id="second"/);assert.match(html,/<table /);assert.match(html,/Synthetic header/);
    assert.deepEqual(runtime.readDocDocument(id),committed,'export leaves source state unchanged');
  }finally{runtime.close();await rm(root,{recursive:true,force:true});}
});
