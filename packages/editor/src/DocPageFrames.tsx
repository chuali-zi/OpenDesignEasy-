import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {DOMSerializer,type Schema} from 'prosemirror-model';
import type{DocPageSettings,PMNodeJSON}from'@oeydesign/document';
import{configureDocColumns,countDocColumns,docColumnIndex,DOC_PAGE_GAP}from'./doc-page-layout.ts';

export type DocPaginationOptions={page:DocPageSettings;zoom:number;partSchema:Schema;header?:PMNodeJSON;footer?:PMNodeJSON;pageOffset:number;totalPages:number;onPages:(count:number)=>void;onPart:(part:'header'|'footer')=>void};
function partHtml(content:PMNodeJSON|undefined,schema:Schema,page:number,total:number):string{
 if(!content)return '';const host=document.createElement('div');host.append(DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON(content).content));for(const field of Array.from(host.querySelectorAll<HTMLElement>('[data-doc-field-kind]')))field.textContent=field.dataset.docFieldKind==='pages'?String(total):String(page);return host.innerHTML;
}
export function DocPageFrames({hostRef,schema,options}:{hostRef:RefObject<HTMLDivElement|null>;schema:Schema;options?:DocPaginationOptions}){
 const[layoutPages,setLayoutPages]=useState(1),pages=Math.min(200,layoutPages),overflow=layoutPages>200;const latest=useRef(options);latest.current=options;const dimensions=JSON.stringify(options?.page);
 useEffect(()=>{
  const host=hostRef.current;if(!host)return;let frame=0,disposed=false;
  const measure=()=>{frame=0;if(disposed)return;const surface=host.querySelector<HTMLElement>('.editor-rich-text-surface');if(!surface)return;
   if(!latest.current){surface.removeAttribute('data-doc-page-stride');surface.removeAttribute('data-doc-page-width');surface.style.cssText='';surface.classList.remove('doc-column-content');for(const field of Array.from(surface.querySelectorAll<HTMLElement>('[data-doc-field-kind]'))){const value=field.dataset.docFieldKind==='pages'?'页数':'页码';if(field.textContent!==value)field.textContent=value;}return;}
   configureDocColumns(surface,latest.current.page);surface.classList.add('doc-column-content');const count=countDocColumns(surface);setLayoutPages(count);latest.current.onPages(count);
   for(const field of Array.from(surface.querySelectorAll<HTMLElement>('[data-doc-field-kind]'))){const value=String(field.dataset.docFieldKind==='pages'?latest.current.totalPages:latest.current.pageOffset+docColumnIndex(surface,field)+1);if(field.textContent!==value)field.textContent=value;}
   surface.dispatchEvent(new CustomEvent('doc-pagination-layout'));
  };
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(measure);};
  const observer=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element?r.target:r.target.parentElement)?.closest('.doc-floating-anchor,.doc-field')&&(r.type!=='attributes'||r.target instanceof Element&&r.target!==host.querySelector('.editor-rich-text-surface'))))schedule();});observer.observe(host,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style']});
  host.addEventListener('doc-pagination-content',schedule);host.addEventListener('load',schedule,true);window.addEventListener('resize',schedule);document.fonts.addEventListener('loadingdone',schedule);schedule();
  return()=>{disposed=true;if(frame)cancelAnimationFrame(frame);observer.disconnect();host.removeEventListener('doc-pagination-content',schedule);host.removeEventListener('load',schedule,true);window.removeEventListener('resize',schedule);document.fonts.removeEventListener('loadingdone',schedule);};
 },[dimensions,!!options]);
 useEffect(()=>{hostRef.current?.dispatchEvent(new CustomEvent('doc-pagination-content'));},[options?.pageOffset,options?.totalPages]);
 const parts=useMemo(()=>options?Array.from({length:pages},(_,i)=>({header:partHtml(options.header,options.partSchema,options.pageOffset+i+1,options.totalPages),footer:partHtml(options.footer,options.partSchema,options.pageOffset+i+1,options.totalPages)})):[],[options?.header,options?.footer,options?.pageOffset,options?.totalPages,pages,schema,options?.partSchema]);
 return <div className={`doc-pagination-scroll ${options?'paged':''}`} aria-label={options?'分页正文画布':undefined}>
  {overflow&&<p role="alert">编辑视图超过 200 页，请按章节继续编辑；正文没有截断。</p>}
  <div className="doc-pagination-canvas" style={options?{width:pages*(options.page.width+DOC_PAGE_GAP)-DOC_PAGE_GAP,height:options.page.height,zoom:options.zoom/100}:undefined}>
   {options&&<div className="doc-page-papers" aria-label="可编辑纸页">{parts.map((part,i)=><div className="doc-edit-page" data-doc-edit-page={i+1} key={i} style={{left:i*(options.page.width+DOC_PAGE_GAP),width:options.page.width,height:options.page.height}}>
    <button className="doc-page-header" aria-label={`编辑第 ${i+1} 页页眉`} style={{left:options.page.marginLeft,right:options.page.marginRight,height:Math.max(20,options.page.marginTop-12)}} onClick={e=>{e.preventDefault();options.onPart('header');}}><div dangerouslySetInnerHTML={{__html:part.header}}/></button>
    <button className="doc-page-footer" aria-label={`编辑第 ${i+1} 页页脚`} style={{left:options.page.marginLeft,right:options.page.marginRight,height:Math.max(20,options.page.marginBottom-12)}} onClick={e=>{e.preventDefault();options.onPart('footer');}}><div dangerouslySetInnerHTML={{__html:part.footer}}/></button>
    <span className="doc-page-number">{options.pageOffset+i+1} / {options.totalPages}</span>
   </div>)}</div>}
   <div ref={hostRef} className="editor-rich-host" style={options?{position:'absolute',left:options.page.marginLeft,top:options.page.marginTop,width:options.page.width-options.page.marginLeft-options.page.marginRight}:undefined}/>
  </div>
  {options&&<small className="doc-page-count" aria-live="polite">本章节 {layoutPages} 页 · 纸页可直接编辑 · 横向连续分页</small>}
 </div>;
}
