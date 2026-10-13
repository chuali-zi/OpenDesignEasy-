import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDocDocument,createTextReplaceStep,textFromString,normalizeDocContent,projectDocContent} from '@oeydesign/document';
import {exportDocDocx} from '@oeydesign/media';
import {ProjectRuntime,ProjectAssets} from '../src/index.ts';
import JSZip from 'jszip';

test('DOCX template import is atomic and idempotent, keeps original, shares edit history and roundtrips after reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'oey-template-'));let runtime=ProjectRuntime.create(root);
 try{
  const old=runtime.createDocument(),source=createDocDocument({documentId:'source',name:'合成报告'});source.sections[0]!.content=normalizeDocContent(textFromString('原始中文模板'),'body');source.sections[0]!.header=normalizeDocContent(textFromString('原始页眉'),'header');source.sections[0]!.footer=normalizeDocContent(textFromString('原始页脚'),'footer');source.sections.push({id:'second',name:'附录',content:normalizeDocContent(textFromString('第二节'),'second'),pageSettings:{width:1122.5197,height:793.7008,marginTop:72,marginRight:72,marginBottom:72,marginLeft:72}});source.content=projectDocContent(source.sections);
  const bytes=await exportDocDocx(source),first=await runtime.importDocx(bytes,'report.docx',{commandId:'import-1'}),duplicate=await runtime.importDocx(bytes,'report.docx',{commandId:'import-1'});assert.equal(first.document.documentId,duplicate.document.documentId);assert.equal(runtime.listDocuments().length,2);assert.deepEqual(runtime.readDocument(old.documentId),old);
  const id=first.document.documentId,section=first.document.sections[0]!.id,assets=new ProjectAssets(runtime);assert.deepEqual(Buffer.from(await assets.resolve(first.document.templateSource!.assetId)),Buffer.from(bytes));assert.deepEqual(Buffer.from(await exportDocDocx(first.document,assets.resolve)),Buffer.from(bytes));assert.equal(first.document.sections.length,2);
  runtime.submit(runtime.makeCommand(id,[{type:'doc.text.apply',sectionId:section,steps:[createTextReplaceStep(1,1,'新 ')]}]));assert.match(JSON.stringify(runtime.readDocDocument(id).content),/新 /);runtime.undo(id);assert.deepEqual(Buffer.from(await exportDocDocx(runtime.readDocDocument(id),assets.resolve)),Buffer.from(bytes));runtime.redo(id);runtime.close();runtime=ProjectRuntime.open(root);const out=await exportDocDocx(runtime.readDocDocument(id),new ProjectAssets(runtime).resolve),again=await runtime.importDocx(out,'roundtrip.docx');assert.match(JSON.stringify(again.document.content),/新 /);
  const count=runtime.listDocuments().length,assetCount=new ProjectAssets(runtime).list().length;const zip=await JSZip.loadAsync(bytes);zip.file('word/vbaProject.bin','synthetic macro payload');await assert.rejects(runtime.importDocx(await zip.generateAsync({type:'uint8array'}),'bad.docx'),/Macros/);await assert.rejects(runtime.importDocx(Buffer.from('broken'),'broken.docx'),/ZIP/);assert.equal(runtime.listDocuments().length,count);assert.equal(new ProjectAssets(runtime).list().length,assetCount);
  await assert.rejects(runtime.importDocx(out,'different.docx',{commandId:'import-1'}),/different|reuse|already|commandId/i);
 }finally{runtime.close();await rm(root,{recursive:true,force:true});}
});
