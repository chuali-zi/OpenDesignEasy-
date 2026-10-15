import assert from 'node:assert/strict';
import test from 'node:test';
import {applyEditableCommand,createDocDocument,createDeckDocument,createWebDocument,textFromString} from '@oeydesign/document';
import type {DocumentOperation,EditableDocument} from '@oeydesign/document';
import {inspectDelivery} from '@oeydesign/media';
import {resolveDeliveryLocation} from '../src/delivery-location.ts';
function apply<T extends EditableDocument>(doc:T,operations:DocumentOperation[]):T{return applyEditableCommand(doc,{commandId:crypto.randomUUID(),projectId:'p',documentId:doc.documentId,actorId:'synthetic',actorKind:'human',clientId:'test',baseRevision:doc.revision,preconditions:[],label:'Synthetic locations',operations},doc).document as T;}

test('Doc findings resolve exact section/part/block without mutation; missing/invalid targets fail closed',()=>{
 let doc=createDocDocument({documentId:'d',name:'Synthetic footer'});doc=apply(doc,[{type:'doc.section.insert',section:{id:'appendix',name:'Appendix',content:textFromString('Preserved body'),header:textFromString('TODO header'),footer:textFromString('TODO footer')}}]);const before=structuredClone(doc),findings=inspectDelivery(doc,'docx');
 for(const finding of findings){const target=resolveDeliveryLocation(doc,finding.location);assert.equal(target?.kind,'doc');assert.equal(target?.kind==='doc'&&target.sectionId,'appendix');assert.equal(target?.kind==='doc'&&target.part,finding.location.part);assert.equal(target?.nodeId,finding.location.nodeId);}
 const footer=findings.find(f=>f.location.part==='footer')!.location;assert.equal(resolveDeliveryLocation(doc,{...footer,part:'header'}),null);assert.equal(resolveDeliveryLocation(doc,{...footer,nodeId:'missing'}),null);assert.equal(resolveDeliveryLocation(doc,{...footer,sectionId:'missing'}),null);assert.equal(resolveDeliveryLocation(doc,{...footer,part:'source'}),null);assert.equal(resolveDeliveryLocation(doc,{}),null);assert.deepEqual(doc,before);
});

test('Deck findings resolve nested scene owners and table cells; cross-page, hidden and ambiguous references are rejected',()=>{
 let doc=createDeckDocument({documentId:'deck',name:'Synthetic deck',pageId:'first'});doc=apply(doc,[{type:'page.insert',page:{id:'second',name:'Second',width:1280,height:720,children:[]}},{type:'node.insert',node:{id:'group',kind:'group',parentId:'second',geometry:{x:20,y:20,width:800,height:500,rotation:0},children:[],style:{},locked:false,hidden:false}},{type:'node.insert',node:{id:'title',kind:'text',parentId:'group',geometry:{x:20,y:20,width:500,height:100,rotation:0},content:textFromString('TODO title'),style:{},locked:true,hidden:false}},{type:'node.insert',node:{id:'table',kind:'table',parentId:'second',geometry:{x:20,y:550,width:500,height:100,rotation:0},style:{},locked:false,hidden:false,table:{headerRows:0,columnWidths:[500],rows:[{id:'row',height:60,cells:[{id:'cell',content:textFromString('TODO cell')}]}]}}}]);
 const before=structuredClone(doc),issues=inspectDelivery(doc,'pptx');for(const issue of issues.filter(item=>item.code==='content.placeholder')){const result=resolveDeliveryLocation(doc,issue.location);assert.ok(result&&result.kind==='deck');assert.equal(result.pageId,'second');assert.equal(result?.nodeId,issue.location.nodeId==='cell'?'table':'title');}
 assert.equal(resolveDeliveryLocation(doc,{pageId:'first',nodeId:'title'}),null);assert.equal(resolveDeliveryLocation(doc,{pageId:'second',nodeId:'__proto__'}),null);
 const hidden=structuredClone(doc);hidden.nodes.group!.hidden=true;assert.equal(resolveDeliveryLocation(hidden,{pageId:'second',nodeId:'title'}),null);
 const ambiguous=structuredClone(doc);ambiguous.nodes.table!.table!.rows[0]!.cells[0]!.id='title';assert.equal(resolveDeliveryLocation(ambiguous,{pageId:'second',nodeId:'title'}),null);assert.deepEqual(doc,before);
});

test('Web findings keep route ownership and leave a read-only canonical document unchanged',()=>{
 let doc=createWebDocument({documentId:'web',name:'Synthetic routes',pageId:'home',rootId:'root'});doc=apply(doc,[{type:'web.page.insert',page:{id:'about',name:'About',route:'/about',rootId:'about-root'},root:{id:'about-root',parentId:null,tag:'main',children:[],style:{},layout:{mode:'flow'}}},{type:'web.node.insert',node:{id:'copy',parentId:'about-root',tag:'p',text:'待补充：合成文案',children:[],style:{},layout:{mode:'flow'}}}]);const before=structuredClone(doc),finding=inspectDelivery(doc,'zip').find(item=>item.code==='content.placeholder')!;
 assert.deepEqual(resolveDeliveryLocation(doc,finding.location),{kind:'web',pageId:'about',nodeId:'copy'});assert.equal(resolveDeliveryLocation(doc,{...finding.location,pageId:'home'}),null);assert.deepEqual(resolveDeliveryLocation(doc,{pageId:'about'}),{kind:'web',pageId:'about'});assert.equal(resolveDeliveryLocation(doc,{pageId:'about',nodeId:'missing'}),null);assert.deepEqual(doc,before);
});
