import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDocDocument,normalizeDocContent,projectDocContent,textFromString} from '@oeydesign/document';
import {exportDocDocx,exportDocPdf} from '../src/doc.ts';
import {renderNativeDocPdf} from '../src/doc-native-pdf.ts';
import {parseReference} from '../src/references.ts';

test('native PDF rejects invalid config, aborts and cleans the whole local process group without provider credentials',{timeout:10000},async()=>{
 await assert.rejects(()=>renderNativeDocPdf(Buffer.from('x'),'relative'),/absolute/);await assert.rejects(()=>renderNativeDocPdf(Buffer.from('x'),'/unused',AbortSignal.abort()),/abort/i);
 const root=await mkdtemp(join(tmpdir(),'oey-pdf-process-'));try{
  const executable=join(root,'renderer.mjs'),pid=join(root,'pid');await writeFile(executable,`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';if(process.env.KIMI_API_KEY||process.env.OPENAI_API_KEY)process.exit(2);writeFileSync(${JSON.stringify(pid)},String(process.pid));setInterval(()=>{},1000);`);await chmod(executable,0o700);
  const start=performance.now();await assert.rejects(()=>renderNativeDocPdf(Buffer.from('synthetic'),executable,AbortSignal.timeout(300)),/abort|timeout/i);assert.ok(performance.now()-start<2000);const child=Number(await readFile(pid,'utf8'));assert.throws(()=>process.kill(child,0),/ESRCH/);
  await writeFile(executable,`#!${process.execPath}\nprocess.exit(2);`);const previous=process.env.OEY_DOCX_RENDERER;process.env.OEY_DOCX_RENDERER=executable;try{await assert.rejects(()=>exportDocPdf(createDocDocument({documentId:'failed-native',name:'Synthetic failure'})),/renderer failed \(2\)/);}finally{if(previous===undefined)delete process.env.OEY_DOCX_RENDERER;else process.env.OEY_DOCX_RENDERER=previous;}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('actual local native PDF repeats headers/fields across table pages and retains CJK plus landscape appendix',{timeout:45000,skip:!process.env.OEY_TEST_DOCX_RENDERER},async()=>{
 const doc=createDocDocument({documentId:'native-report',name:'Synthetic pagination'}),s=doc.sections[0]!;
 const paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]});
 s.header=normalizeDocContent(textFromString('SYNTHETIC HEADER'),'header');s.footer=normalizeDocContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'PAGE '},{type:'doc_field',attrs:{kind:'page'}},{type:'text',text:' OF '},{type:'doc_field',attrs:{kind:'pages'}}]}]},'footer');
 s.content=normalizeDocContent({type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'合成分页报告'}]}, {type:'table',attrs:{headerRows:1,columnWidths:[200,350]},content:[{type:'table_row',content:[{type:'table_cell',content:[paragraph('SYNTHETIC TABLE HEADER')]},{type:'table_cell',content:[paragraph('VALUE')]}]},...Array.from({length:60},(_,i)=>({type:'table_row',content:[{type:'table_cell',content:[paragraph(`Synthetic row ${i+1}`)]},{type:'table_cell',content:[paragraph(String((i+1)*3))]}]}))]}]},'body');
 doc.sections.push({id:'appendix',name:'Landscape appendix',pageSettings:{...doc.pageSettings,width:doc.pageSettings.height,height:doc.pageSettings.width},content:normalizeDocContent(textFromString('LANDSCAPE APPENDIX / 中文'),'appendix')});doc.content=projectDocContent(doc.sections);
 const pdf=await renderNativeDocPdf(await exportDocDocx(doc),process.env.OEY_TEST_DOCX_RENDERER!),parsed=await parseReference(pdf,'report.pdf');assert.ok(parsed.pages!>=3);assert.match(parsed.text,/合成分页报告/);assert.match(parsed.text,/Synthetic row 60/);assert.match(parsed.text,/180/);assert.match(parsed.text,/LANDSCAPE APPENDIX/);assert.ok((parsed.text.match(/SYNTHETIC HEADER/g)??[]).length>=2);assert.ok((parsed.text.match(/SYNTHETIC TABLE HEADER/g)??[]).length>=2);assert.match(parsed.text,/PAGE 1 OF \d/);assert.match(parsed.text,/PAGE 2 OF \d/);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({data:new Uint8Array(pdf)});try{const output=await task.promise,first=await output.getPage(1),last=await output.getPage(output.numPages);assert.ok(first.view[3]!>first.view[2]!);assert.ok(last.view[2]!>last.view[3]!);}finally{await task.destroy();}
});
