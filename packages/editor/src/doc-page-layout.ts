import{createDocEditorSchema}from'./doc-editor-schema.ts';
import {EditorState} from 'prosemirror-state';
import {EditorView,type NodeView} from 'prosemirror-view';
import type {Node as PMNode,Schema} from 'prosemirror-model';
import type {DocDocument,DocPageSettings} from '@oeydesign/document';
import {createDocFloatingView} from './DocFloatingView.ts';

export const DOC_PAGE_GAP=32;
export function configureDocColumns(surface:HTMLElement,page:DocPageSettings){
 const width=page.width-page.marginLeft-page.marginRight,height=page.height-page.marginTop-page.marginBottom;
 surface.dataset.docPageStride=String(page.width+DOC_PAGE_GAP);surface.dataset.docPageWidth=String(width);
 Object.assign(surface.style,{width:`${width}px`,height:`${height}px`,minHeight:'0px',padding:'0px',columnWidth:`${width}px`,columnGap:`${page.marginLeft+page.marginRight+DOC_PAGE_GAP}px`,columnFill:'auto',overflow:'visible'});
}
/** Count actual column fragments, excluding absolutely-positioned object overflow. */
export function countDocColumns(surface:HTMLElement):number{
 const stride=Number(surface.dataset.docPageStride);if(!stride)return 1;
 const origin=surface.getBoundingClientRect(),scale=origin.width/surface.clientWidth||1;let pages=1;
 for(const block of Array.from(surface.children))for(const rect of Array.from(block.getClientRects())){
  if(rect.width>0)pages=Math.max(pages,Math.round((rect.left-origin.left)/(stride*scale))+1);
 }
 return pages;
}
export function docColumnIndex(surface:HTMLElement,element:Element):number{
 const stride=Number(surface.dataset.docPageStride);if(!stride)return 0;
 const rect=element.getClientRects()[0]??element.getBoundingClientRect(),origin=surface.getBoundingClientRect(),scale=origin.width/surface.clientWidth||1;
 return Math.max(0,Math.floor((rect.left-origin.left+1)/(stride*scale)));
}
export function createDocFieldView(node:PMNode):NodeView{
 const dom=document.createElement('span');dom.className='doc-field';dom.contentEditable='false';dom.dataset.docFieldKind=String(node.attrs.kind);dom.textContent=node.attrs.kind==='pages'?'页数':'页码';
 return{dom,update(next){if(next.type!==node.type)return false;node=next;dom.dataset.docFieldKind=String(node.attrs.kind);return true;},ignoreMutation:()=>true};
}
const sectionMeasurements=new WeakMap<Schema,Map<string,{signature:string;pages:number}>>();
/** Read-only measurements share the live editor's schema and native browser fragmentation. */
export function measureDocSections(doc:DocDocument,schema:Schema,assetUrl:(id:string)=>string):Record<string,number>{
 const host=document.createElement('div');host.className='doc-paper doc-pagination-measure';Object.assign(host.style,{position:'fixed',left:'-100000px',top:'0px',visibility:'hidden',padding:'0px',zoom:'1'});document.body.append(host);const counts:Record<string,number>={};let cache=sectionMeasurements.get(schema);if(!cache){cache=new Map();sectionMeasurements.set(schema,cache);}
 try{for(const section of doc.sections){const cacheId=doc.documentId+':'+section.id,signature=JSON.stringify([section.content,section.pageSettings??doc.pageSettings,section.styleId]),prior=cache.get(cacheId);if(prior?.signature===signature){counts[section.id]=prior.pages;continue;}const mount=document.createElement('div');host.append(mount);const sectionSchema=createDocEditorSchema(assetUrl,doc.styles,section.styleId??'Normal'),view=new EditorView(mount,{state:EditorState.create({schema:sectionSchema,doc:sectionSchema.nodeFromJSON(section.content)}),editable:()=>false,attributes:{class:'editor-rich-text-surface doc-column-content'},nodeViews:{floating_image:(n,v,p)=>createDocFloatingView(n,v,p,assetUrl,()=>false),floating_shape:(n,v,p)=>createDocFloatingView(n,v,p,assetUrl,()=>false),doc_field:createDocFieldView}});try{configureDocColumns(view.dom,section.pageSettings??doc.pageSettings);counts[section.id]=countDocColumns(view.dom);cache.set(cacheId,{signature,pages:counts[section.id]!});}finally{view.destroy();mount.remove();}}return counts;}finally{host.remove();}
}
