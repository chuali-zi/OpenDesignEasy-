import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import {createDocDocument,createDeckDocument,normalizeDocContent,projectDocContent} from '@oeydesign/document';
import {exportDocDocx,renderDocHtml,prepareDocxImport,exportDeckPptx} from '../src/index.ts';

test('unstyled Doc exports A4 geometry and black, readable styles; custom paper and explicit template colors survive',async()=>{
 const doc=createDocDocument({documentId:'proportions',name:'Synthetic proportions'});
 doc.sections[0]!.content=normalizeDocContent({type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'黑色标题'}]},{type:'paragraph',content:[{type:'text',text:'黑色正文'}]}]},'body');doc.content=projectDocContent(doc.sections);
 const bytes=await exportDocDocx(doc),zip=await JSZip.loadAsync(bytes),body=await zip.file('word/document.xml')!.async('string'),styles=await zip.file('word/styles.xml')!.async('string');
 assert.match(body,/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);for(const side of ['top','right','bottom','left'])assert.match(body,new RegExp('w:'+side+'="1440"'));
 for(const [id,size,line,bold]of [['Normal',24,360,false],['Heading1',36,480,true],['Heading2',30,420,true],['Heading3',27,390,true]]as const){const style=styles.match(new RegExp('<w:style\\b[^>]*w:styleId="'+id+'"[\\s\\S]*?</w:style>'))![0];assert.match(style,/<w:color w:val="000000"/);assert.match(style,new RegExp('<w:sz w:val="'+size+'"'));assert.match(style,new RegExp('w:line="'+line+'"'));if(bold)assert.match(style,/<w:b\b/);assert.equal((styles.match(new RegExp('w:styleId="'+id+'"','g'))??[]).length,1);}
 const html=await renderDocHtml(doc);for(const [tag,size,line]of [['h1',24,32],['p',16,24]]){const element=html.match(new RegExp('<'+tag+'\\b[^>]*>'))![0];for(const declaration of ['font-size:'+size+'px','line-height:'+line+'px','color:#000000'])assert.ok(element.includes(declaration),declaration);}
 doc.pageSettings={width:816,height:1056,marginTop:72,marginRight:72,marginBottom:72,marginLeft:72};doc.styles!.Normal!.color='#123456';doc.styles!.Heading1!.color='#654321';
 const colored=await exportDocDocx(doc),source=prepareDocxImport(colored,{documentId:'imported',assetId:'original',fileName:'Synthetic-template.docx'}).document;
 assert.deepEqual(await exportDocDocx(source,async()=>colored),colored);assert.equal(source.styles!.Normal!.color,'#123456');assert.equal(source.styles!.Heading1!.color,'#654321');assert.equal(source.pageSettings.width,816);
 source.sections[0]!.content.content!.at(-1)!.content!.push({type:'text',text:' edited'});source.content=projectDocContent(source.sections);
 const changed=await exportDocDocx(source,async()=>colored),editedZip=await JSZip.loadAsync(changed);assert.match(await editedZip.file('word/styles.xml')!.async('string'),/w:val="654321"/);assert.match(await editedZip.file('word/document.xml')!.async('string'),/w:w="12240"[^>]*w:h="15840"/);
});

test('Deck defaults to 16:9 and native PPTX retains a specified 4:3 page',async()=>{
 const d=createDeckDocument({documentId:'normal-deck',name:'Synthetic slides'});assert.equal(d.pages[0]!.width/d.pages[0]!.height,16/9);
 for(const [width,height]of [[1280,720],[960,720]] as const){d.pages[0]!.width=width;d.pages[0]!.height=height;const zip=await JSZip.loadAsync(await exportDeckPptx(d)),xml=await zip.file('ppt/presentation.xml')!.async('string'),match=xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)!;assert.equal(Number(match[1])/Number(match[2]),width/height);assert.equal(Number(match[1]),width*9525);assert.equal(Number(match[2]),height*9525);}
});

test('native PDF paints the full inline image height instead of clipping it to the default text line',{timeout:20000,skip:!process.env.OEY_TEST_DOCX_RENDERER||!process.env.OEY_TEST_PDF_RASTERIZER},async t=>{
 const {chromium}=await import('playwright'),{browserLaunchOptions}=await import('../src/browser.ts'),{renderNativeDocPdf}=await import('../src/doc-native-pdf.ts'),{mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{promisify}=await import('node:util'),{execFile}=await import('node:child_process');
 const browser=await chromium.launch(browserLaunchOptions()),root=await mkdtemp(join(tmpdir(),'oey-native-image-height-'));
 try{const page=await browser.newPage();const original=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=60;canvas.height=30;const ctx=canvas.getContext('2d')!;ctx.fillStyle='black';ctx.fillRect(0,0,60,30);return canvas.toDataURL('image/png').split(',')[1]!;}),'base64');
 const doc=createDocDocument({documentId:'native-image-height',name:'Synthetic image height'});doc.assets=[{id:'image',kind:'image',mimeType:'image/png',width:60,height:30}];doc.sections[0]!.content=normalizeDocContent({type:'doc',content:[{type:'paragraph',content:[{type:'inline_image',attrs:{assetId:'image',width:360,height:180,alt:'Synthetic black rectangle'}}]}]},'body');doc.content=projectDocContent(doc.sections);
 const pdf=await renderNativeDocPdf(await exportDocDocx(doc,async()=>original),process.env.OEY_TEST_DOCX_RENDERER!);await writeFile(join(root,'reference.pdf'),pdf);await promisify(execFile)(process.env.OEY_TEST_PDF_RASTERIZER!,['-png','-r','96','-f','1','-singlefile',join(root,'reference.pdf'),join(root,'reference')],{timeout:10000});const png=await readFile(join(root,'reference.png'));
 const pixels=await page.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let minX=Infinity,minY=Infinity,maxX=-1,maxY=-1,count=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const index=(y*canvas.width+x)*4;if(data[index]!<20&&data[index+1]!<20&&data[index+2]!<20){count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}return{width:maxX-minX+1,height:maxY-minY+1,count};},png.toString('base64'));
 assert.ok(Math.abs(pixels.width-360)<=2,JSON.stringify(pixels));assert.ok(Math.abs(pixels.height-180)<=2,JSON.stringify(pixels));assert.ok(pixels.count>60000,JSON.stringify(pixels));t.diagnostic('native image pixels '+JSON.stringify(pixels));
 }finally{await browser.close();await rm(root,{recursive:true,force:true});}
});
