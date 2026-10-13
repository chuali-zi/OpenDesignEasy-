import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {browserLaunchOptions} from '@oeydesign/media/browser';
import {readImageOcr,parseReference} from '@oeydesign/media';
import {ProjectRuntime,ProjectAssets,createDesignServices} from '../src/index.ts';

test('packaged Chinese OCR reads actual synthetic image/scan locally; runtime cache, originals, cancel and CLI have no provider dependency',{timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'oey-chinese-ocr-')),browser=await chromium.launch(browserLaunchOptions());let runtime=ProjectRuntime.create(root);
 try{
  const page=await browser.newPage({viewport:{width:1000,height:160},deviceScaleFactor:2});await page.route('**/*',r=>r.abort());await page.setContent('<style>html,body{margin:0;background:white;color:black}p{margin:24px;font:48px "Noto Sans CJK SC"}</style><p>合成中文资料测试42</p>');await page.evaluate(()=>document.fonts.ready);const image=await page.screenshot({type:'png'}),assets=new ProjectAssets(runtime),asset=await assets.importImage(image,'synthetic-chinese.png');
  const normalize=(text:string)=>text.replace(/\s/g,'');
  const start=performance.now();await assert.rejects(()=>readImageOcr(image,{language:'chi_sim',signal:AbortSignal.timeout(10)}),/abort|timeout/i);assert.ok(performance.now()-start<2000);assert.equal(runtime.listRecords('reference-text').length,0);
  await assert.rejects(()=>readImageOcr(image,{language:'chi_sim',dataDir:join(root,'missing')}),/no automatic download/);await assert.rejects(()=>readImageOcr(image,{language:'unknown'}),/language/);
  const result=await createDesignServices(runtime).readReference({assetId:asset.id,ocr:true,ocrLanguage:'chi_sim'},new AbortController().signal) as {text:string;warnings:string[]};assert.equal(normalize(result.text),'合成中文资料测试42');assert.match(result.warnings[0]!,/inferred/);assert.equal(runtime.listRecords('reference-text').length,1);assert.deepEqual(Buffer.from(await assets.resolve(asset.id)),image);
  await page.setContent(`<style>html,body{margin:0}</style><img style="width:1000px;height:160px" src="data:image/png;base64,${image.toString('base64')}">`);const pdf=await page.pdf({width:'1000px',height:'160px'});const empty=await parseReference(pdf,'scan.pdf');assert.match(empty.warnings[0]!,/no extractable text/);const scan=await parseReference(pdf,'scan.pdf',{ocr:true,ocrLanguage:'chi_sim'});assert.match(normalize(scan.text),/合成中文资料测试42/);assert.match(scan.warnings[0]!,/OCR/);
  await page.setContent('<style>body{font:40px Arial;background:white;color:black}</style><p>SYNTHETIC EVIDENCE 42</p>');const english=await readImageOcr(await page.screenshot({type:'png'}));assert.match(english.text,/SYNTHETIC EVIDENCE 42/);
  runtime.close();runtime=ProjectRuntime.open(root);const cached=await new ProjectAssets(runtime).readReference(asset.id,0,1000,{ocr:true,ocrLanguage:'chi_sim'});assert.equal(normalize(cached.text),'合成中文资料测试42');assert.equal(runtime.listRecords('reference-text').length,1);const fresh=await new ProjectAssets(runtime).importImage(image,'synthetic-fresh.png');runtime.close();
  // Block network in the CLI process and inherited workers; a fresh cache key must recognize locally.
  const blocker=join(root,'deny-network.cjs');await writeFile(blocker,"for(const name of ['http','https']){const mod=require(name);mod.request=mod.get=()=>{throw Error('Unexpected network access during local OCR')}};require('net').Socket.prototype.connect=function(){throw Error('Unexpected socket during local OCR')};globalThis.fetch=async()=>{throw Error('Unexpected fetch during local OCR')};");
  const cli=spawnSync(process.execPath,['--no-warnings','--require',blocker,'--import','tsx',resolve('apps/cli/src/index.ts'),'asset','read',root,fresh.id,'--ocr','true','--language','chi_sim'],{cwd:resolve('.'),env:{...process.env,OEY_OCR_DATA_DIR:undefined},encoding:'utf8',timeout:30000});assert.equal(cli.status,0,cli.stderr);assert.equal(normalize(JSON.parse(cli.stdout).text),'合成中文资料测试42');runtime=ProjectRuntime.open(root);
 }finally{runtime.close();await browser.close();await rm(root,{recursive:true,force:true});}
});
