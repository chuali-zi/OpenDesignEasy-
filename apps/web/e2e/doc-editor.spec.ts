import { evidencePath } from './evidence.ts';
import { expect,test } from '@playwright/test';
import type { DocDocument } from '@oeydesign/document';
import JSZip from 'jszip';
test('Doc direct text, native table/image, sections, margins, shared undo/reopen and DOCX/PDF exports',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.getByLabel('新建 Doc 文档')).toBeEnabled();await page.getByLabel('新建 Doc 文档').click();await expect(page.getByLabel('Doc 编辑器')).toBeVisible();await expect(page.getByLabel('新建 Doc 文档')).toBeEnabled();const id=await page.getByLabel('选择文档').inputValue();
  const read=async():Promise<DocDocument>=>(await(await page.request.get(`/api/documents/${id}`)).json()).document;
  const editor=page.getByLabel('富文本内容');await editor.click();await page.keyboard.type('Synthetic report');await page.keyboard.press('Enter');await page.keyboard.insertText('中文资料');await expect.poll(async()=>JSON.stringify((await read()).content)).toContain('中文资料');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=>JSON.stringify((await read()).content)).not.toContain('中文资料');await page.getByRole('button',{name:'重做',exact:true}).click();await expect(editor).toContainText('中文资料');
  await editor.click();await page.keyboard.press('ControlOrMeta+End');await page.getByRole('button',{name:'插入表格',exact:true}).click();await expect(editor.locator('td')).toHaveCount(9);await editor.locator('td').first().click();await page.keyboard.insertText('合成表格');await expect.poll(async()=>JSON.stringify((await read()).content)).toContain('合成表格');
  await editor.locator('td').last().click();await page.getByLabel('插入文档图片').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwDHMDAAGJAM6JKQi9AAAAAElFTkSuQmCC','base64')});await expect(editor.locator('img[data-asset-id]')).toHaveCount(1);await expect.poll(async()=>JSON.stringify((await read()).content)).toContain('inline_image');
  await page.getByRole('button',{name:'＋ 新增章节',exact:true}).click();await expect(page.getByLabel('Doc 编辑器')).toContainText('章节 2');await expect.poll(async()=>(await read()).sections.length).toBe(2);await expect(editor).not.toContainText('合成表格');await editor.click();await page.keyboard.insertText('附录内容');await expect.poll(async()=>JSON.stringify((await read()).sections[1]!.content)).toContain('附录内容');
  const margin=page.getByLabel('页边距左');await margin.fill('20');await margin.blur();await expect.poll(async()=>(await read()).sections[1]!.pageSettings?.marginLeft).toBeCloseTo(20*96/25.4,3);
  await page.getByLabel('Doc 编辑区域').selectOption('header');await editor.click();await page.keyboard.insertText('报告页眉');await expect.poll(async()=>JSON.stringify((await read()).sections[1]!.header)).toContain('报告页眉');
  await page.reload();await expect(page.getByLabel('Doc 编辑器')).toBeVisible();await expect(editor).toContainText('合成表格');
  const docx=await page.request.get(`/api/documents/${id}/export.docx`);expect(docx.status()).toBe(200);const zip=await JSZip.loadAsync(await docx.body());expect(await zip.file('word/document.xml')!.async('string')).toContain('附录内容');
  const pdf=await page.request.get(`/api/documents/${id}/export.pdf`);expect(pdf.status()).toBe(200);expect((await pdf.body()).subarray(0,5).toString()).toBe('%PDF-');
  await page.screenshot({path:evidencePath('r5-doc-core/doc-editor-synthetic.png'),fullPage:true});expect(errors).toEqual([]);
});
