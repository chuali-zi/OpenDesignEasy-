import { Schema, type NodeSpec } from 'prosemirror-model';
import { docSchema } from '@oeydesign/document';
import { editorTextSchema } from './editor-text-schema.ts';
export function createDocEditorSchema(assetUrl:(id:string)=>string,styles:Record<string,Record<string,unknown>>={}):Schema {
  let nodes=docSchema.spec.nodes;
  nodes.forEach((name,spec)=>{ const view=editorTextSchema.spec.nodes.get(name);if(view)nodes=nodes.update(name,{...view,attrs:spec.attrs} as NodeSpec); });
  const style=(a:Record<string,unknown>)=>{const s={...(styles[String(a.styleId??'Normal')] ?? {}),...Object.fromEntries(Object.entries(a).filter(([,v])=>v!=null))};const css:string[]=[];
    for(const [key,name]of Object.entries({fontFamily:'font-family',fontSize:'font-size',color:'color',align:'text-align',lineHeight:'line-height',spaceBefore:'margin-top',spaceAfter:'margin-bottom',indent:'margin-left',firstLineIndent:'text-indent'}))if(s[key]!=null)css.push(`${name}:${typeof s[key]==='number'?`${s[key]}px`:s[key]}`);
    if(s.bold)css.push('font-weight:bold');if(s.italic)css.push('font-style:italic');if(s.underline||s.strike)css.push(`text-decoration:${s.underline?'underline':''} ${s.strike?'line-through':''}`);if(s.pageBreakBefore)css.push('break-before:page');return css.join(';');};
  for(const name of ['paragraph','heading'])nodes=nodes.update(name,{...nodes.get(name),toDOM:n=>[name==='heading'?`h${n.attrs.level}`:'p',{style:style(n.attrs)},0]} as NodeSpec);
  nodes=nodes.update('table' ,{...docSchema.spec.nodes.get('table'),parseDOM:[{tag:'table'}],toDOM:n=>['table',...(Array.isArray(n.attrs.columnWidths)?[['colgroup',...n.attrs.columnWidths.map((width:number)=>['col',{style:`width:${width}px`}])]]:[]),['tbody',0]]} as NodeSpec)
    .update('table_row',{...docSchema.spec.nodes.get('table_row'),parseDOM:[{tag:'tr'}],toDOM:()=>['tr',0]} as NodeSpec)
    .update('table_cell',{...docSchema.spec.nodes.get('table_cell'),parseDOM:[{tag:'td'},{tag:'th'}],toDOM:()=>['td',0]} as NodeSpec)
    .update('inline_image',{...docSchema.spec.nodes.get('inline_image'),toDOM:n=>['img',{src:assetUrl(String(n.attrs.assetId)),width:n.attrs.width,height:n.attrs.height,alt:n.attrs.alt,'data-asset-id':n.attrs.assetId}]} as NodeSpec)
    .update('page_break',{...docSchema.spec.nodes.get('page_break'),toDOM:()=>['div',{class:'doc-page-break',contenteditable:'false'},'分页符']} as NodeSpec);
  for(const name of ['floating_image','floating_shape'])nodes=nodes.update(name,{...docSchema.spec.nodes.get(name),toDOM:()=>['span',{class:'doc-floating-anchor'}]} as NodeSpec);
  nodes=nodes.update('doc_field',{...docSchema.spec.nodes.get('doc_field'),toDOM:n=>['span',{class:'doc-field',contenteditable:'false'},n.attrs.kind==='pages'?'页数':'页码']} as NodeSpec)
    .update('inline_page_break',{...docSchema.spec.nodes.get('inline_page_break'),toDOM:()=>['span',{class:'doc-page-break',contenteditable:'false'},'分页符']} as NodeSpec);
  const marks=editorTextSchema.spec.marks.append({ooxmlRun:{...docSchema.spec.marks.get('ooxmlRun'),toDOM:()=>['span',0]}});
  return new Schema({nodes,marks});
}
