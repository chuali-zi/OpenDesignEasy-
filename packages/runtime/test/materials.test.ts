import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDocDocument } from '@oeydesign/document';
import { exportDocDocx } from '@oeydesign/media';
import { ProjectRuntime,ProjectAssets,createDesignServices } from '../src/index.ts';

test('native reference text cache, warnings, offsets and original bytes persist; CLI awaits parsing before runtime closes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'oey-materials-'));let runtime=ProjectRuntime.create(root);
 try{
  const doc=createDocDocument({documentId:'source-doc',name:'Synthetic source'});doc.sections[0]!.content.content![0]!.content=[{type:'text',text:'Synthetic evidence 42 / 中文资料'}];doc.content=structuredClone(doc.sections[0]!.content);
  const bytes=await exportDocDocx(doc),assets=new ProjectAssets(runtime),ref=await assets.importReference(bytes,'evidence.docx');const target=runtime.createDocument();const before=runtime.readDocument(target.documentId);
  const result=await createDesignServices(runtime).readReference({assetId:ref.id,offset:0,limit:5000},new AbortController().signal) as {text:string;format:string;warnings:string[]};assert.match(result.text,/Synthetic evidence 42 \/ 中文资料/);assert.equal(result.format,'docx');assert.match(result.warnings[0]!,/not interpreted/);assert.equal(runtime.listRecords('reference-text').length,1);
  const excerpt=await assets.readReference(ref.id,10,5);assert.equal(excerpt.text,result.text.slice(10,15));assert.equal(excerpt.hasMore,true);assert.equal(runtime.listRecords('reference-text').length,1);assert.deepEqual(Buffer.from(await assets.resolve(ref.id)),Buffer.from(bytes));assert.deepEqual(runtime.readDocument(target.documentId),before);
  const broken=await assets.importReference(Buffer.from('bad ZIP'),'broken.docx');await assert.rejects(()=>assets.readReference(broken.id),/ZIP/);assert.equal(runtime.listRecords('reference-text').length,1);assert.equal((await assets.read(broken.id)).bytes.toString(),'bad ZIP');
  const csv=await assets.importReference(Buffer.from('name,note\nSynthetic,"quoted, value"\n'),'source.csv');runtime.close();
  const cli=spawnSync(process.execPath,['--no-warnings','--import','tsx',resolve('apps/cli/src/index.ts'),'asset','read',root,csv.id,'--limit','1000'],{cwd:resolve('.'),encoding:'utf8',timeout:20000});assert.equal(cli.status,0,cli.stderr);const output=JSON.parse(cli.stdout);assert.equal(output.format,'csv');assert.match(output.text,/quoted, value/);
  runtime=ProjectRuntime.open(root);assert.equal(runtime.listRecords('reference-text').length,2);assert.deepEqual(Buffer.from(await new ProjectAssets(runtime).resolve(ref.id)),Buffer.from(bytes));
 }finally{runtime.close();await rm(root,{recursive:true,force:true});}
});
