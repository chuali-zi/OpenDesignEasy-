import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { browserLaunchOptions } from '../src/browser.ts';
import { parseReference,parseCsv,readImageOcr } from '../src/references.ts';
import { createDocDocument, createDeckDocument,textFromString } from '@oeydesign/document';
import { exportDocDocx } from '../src/doc.ts';
import { exportDeckPptx } from '../src/pptx.ts';

test('reference readers retain CSV quoting/source, read native DOCX/PPTX/XLSX and reject damaged/unsafe archives',async()=>{
 assert.deepEqual(parseCsv('name,note\r\n"合成","line 1\nline ""2"""\r\n'),[['name','note'],['合成','line 1\nline "2"']]);assert.throws(()=>parseCsv('"open'),/Unclosed/);assert.throws(()=>parseCsv('a,'.repeat(256)+'\n'),/columns/);
 const source="export default function Demo(){return <h1>合成资料</h1>}";assert.equal((await parseReference(Buffer.from(source),'demo.tsx')).text,source);
 const doc=createDocDocument({documentId:'doc-read',name:'Read'});doc.sections[0]!.content.content![0]!.content=[{type:'text',text:'中文 DOCX 证据'}];doc.content=structuredClone(doc.sections[0]!.content);assert.match((await parseReference(await exportDocDocx(doc),'input.docx')).text,/中文 DOCX 证据/);
 const deck=createDeckDocument({documentId:'deck-read',name:'Read'});const page=deck.pages[0]!;page.children=['text'];deck.nodes.text={id:'text',parentId:page.id,kind:'text',geometry:{x:10,y:10,width:500,height:100,rotation:0},style:{},locked:false,hidden:false,content:textFromString('中文 PPTX 证据')};assert.match((await parseReference(await exportDeckPptx(deck),'input.pptx')).text,/中文 PPTX 证据/);
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('_rels/.rels','<Relationships/>');zip.file('xl/workbook.xml','<workbook xmlns:r="urn:rel"><sheets><sheet name="合成工作表" sheetId="1" r:id="rId1"/></sheets></workbook>');zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');zip.file('xl/sharedStrings.xml','<sst><si><t>合成文本</t></si></sst>');zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>');const bytes=await zip.generateAsync({type:'uint8array'}),xlsx=await parseReference(bytes,'input.xlsx');assert.deepEqual(xlsx.sheets![0]!.rows,[['合成文本','','=1+2 [cached=3]']]);assert.equal(xlsx.sheets![0]!.name,'合成工作表');
 zip.file('word/vbaProject.bin','ignored');await assert.rejects(()=>parseReference(zip.generateAsync({type:'uint8array'}) as any,'input.docx'));
 await assert.rejects(()=>parseReference(Buffer.from('notzip'),'bad.docx'));const malformed=new JSZip();malformed.file('[Content_Types].xml','<Types/>');malformed.file('word/document.xml','<!DOCTYPE x [<!ENTITY a "bad">]><document><p>&a;</p></document>');await assert.rejects(()=>parseReference(malformed.generateAsync({type:'uint8array'}) as any,'input.docx'));
});

test('PDF text and scanned-page OCR use actual local engines, preserve original and refuse implicit language downloads',{timeout:45000},async()=>{
 const browser=await chromium.launch(browserLaunchOptions());try{
  const page=await browser.newPage({viewport:{width:900,height:170}});await page.setContent('<style>body{font:32px Arial;background:white;color:black}</style><p>SYNTHETIC EVIDENCE 42</p>');const pdf=new Uint8Array(await page.pdf({width:'900px',height:'170px'}));const parsed=await parseReference(pdf,'text.pdf');assert.match(parsed.text,/SYNTHETIC EVIDENCE 42/);assert.equal(parsed.pages,1);
  const image=new Uint8Array(await page.screenshot({type:'png'}));await assert.rejects(()=>readImageOcr(image,{dataDir:'/tmp/oey-no-ocr-data'}),/no automatic download/);
  const imageOcr=await readImageOcr(image,{dataDir:'/usr/share/tesseract-ocr/5/tessdata'});assert.match(imageOcr.text,/SYNTHETIC EVIDENCE 42/);assert.match(imageOcr.warnings[0]!,/inferred/);
  await page.setContent(`<style>html,body{margin:0}</style><img src="data:image/png;base64,${Buffer.from(image).toString('base64')}">`);const scanned=new Uint8Array(await page.pdf({width:'900px',height:'170px'}));const empty=await parseReference(scanned,'scan.pdf');assert.match(empty.warnings[0]!,/no extractable text/);const scanOcr=await parseReference(scanned,'scan.pdf',{ocr:true,ocrDataDir:'/usr/share/tesseract-ocr/5/tessdata'});assert.match(scanOcr.text,/SYNTHETIC EVIDENCE 42/);assert.match(scanOcr.warnings[0]!,/OCR/);
 }finally{await browser.close();}
});
