import { Schema, type NodeSpec } from 'prosemirror-model';
import { docSchema } from '@oeydesign/document';
import { editorTextSchema } from './editor-text-schema.ts';
export function createDocEditorSchema(assetUrl:(id:string)=>string):Schema {
  let nodes=docSchema.spec.nodes;
  nodes.forEach((name,spec)=>{ const view=editorTextSchema.spec.nodes.get(name);if(view)nodes=nodes.update(name,{...view,attrs:spec.attrs} as NodeSpec); });
  nodes=nodes.update('table',{...docSchema.spec.nodes.get('table'),parseDOM:[{tag:'table'}],toDOM:()=>['table',['tbody',0]]} as NodeSpec)
    .update('table_row',{...docSchema.spec.nodes.get('table_row'),parseDOM:[{tag:'tr'}],toDOM:()=>['tr',0]} as NodeSpec)
    .update('table_cell',{...docSchema.spec.nodes.get('table_cell'),parseDOM:[{tag:'td'},{tag:'th'}],toDOM:()=>['td',0]} as NodeSpec)
    .update('inline_image',{...docSchema.spec.nodes.get('inline_image'),toDOM:n=>['img',{src:assetUrl(String(n.attrs.assetId)),width:n.attrs.width,height:n.attrs.height,alt:n.attrs.alt,'data-asset-id':n.attrs.assetId}]} as NodeSpec)
    .update('page_break',{...docSchema.spec.nodes.get('page_break'),toDOM:()=>['div',{class:'doc-page-break',contenteditable:'false'},'分页符']} as NodeSpec);
  return new Schema({nodes,marks:editorTextSchema.spec.marks});
}
