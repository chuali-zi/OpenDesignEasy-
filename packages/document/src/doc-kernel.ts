import { Schema, type NodeSpec } from 'prosemirror-model';
import { KernelError, invalid } from './errors.ts';
import { textSchema, textFromString, applyTextSteps, validateTextContent } from './text.ts';
import { DEFAULT_DOC_STYLES } from './doc-defaults.ts';
import type { CommandEnvelope, DocDocument, DocSection, DocPageSettings, DocOperation, PMNodeJSON } from './model.ts';

let nodes = textSchema.spec.nodes;
nodes.forEach((name, spec) => { if (!['doc', 'text', 'hard_break'].includes(name)) nodes = nodes.update(name, { ...spec, attrs: { ...spec.attrs, id: { default: null }, styleId: { default: null }, ...(['paragraph','heading'].includes(name) ? { pageBreakBefore: {default:null}, keepNext: {default:null}, keepLines: {default:null}, widowControl:{default:null} }: {}) } }); });
const floatAttrs={id:{default:null},x:{default:0},y:{default:0},width:{default:240},height:{default:140},rotation:{default:0},wrap:{default:'topBottom'},locked:{default:false}};
nodes = nodes.append({
  floating_image:{inline:true,group:'inline',atom:true,attrs:{...floatAttrs,assetId:{},alt:{default:''}}},
  floating_shape:{inline:true,group:'inline',atom:true,attrs:{...floatAttrs,shape:{default:'rectangle'},fill:{default:'#FFFFFF'},stroke:{default:'#000000'},strokeWidth:{default:1},text:{default:'文字框'},fontSize:{default:16},fontFamily:{default:'Noto Sans CJK SC'},color:{default:'#000000'}}},
  table: { group: 'block', content: 'table_row+', isolating: true, attrs: { id: { default: null }, headerRows: { default: 1 }, columnWidths: { default: null } } },
  table_row: { content: 'table_cell+', attrs: { id: { default: null } } },
  table_cell: { content: 'block+', isolating: true, attrs: { id: { default: null } } },
  inline_image: { inline: true, group: 'inline', atom: true, draggable: true, attrs: { id: { default: null }, assetId: {}, width: {}, height: {}, alt: { default: '' } } },
  doc_field: { inline:true, group:'inline', atom:true, attrs:{id:{default:null},kind:{}} },
  inline_page_break: {inline:true,group:'inline',atom:true,attrs:{id:{default:null}}},
  page_break: { group: 'block', atom: true, attrs: { id: { default: null } } },
} as Record<string, NodeSpec>);
export const docSchema = new Schema({ nodes, marks: textSchema.spec.marks.append({ooxmlRun:{attrs:{sourceId:{}}}}) });
export const DEFAULT_DOC_PAGE: DocPageSettings = { width: 793.7008, height: 1122.5197, marginTop: 96, marginRight: 96, marginBottom: 96, marginLeft: 96 };
const equal = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const id = (x: unknown): x is string => typeof x === 'string' && !!x.trim() && x.length <= 200 && !['__proto__','prototype','constructor'].includes(x);

/** Keep surviving IDs; assign IDs to inserted structure only, using a deterministic command prefix. */
export function normalizeDocContent(value: PMNodeJSON, prefix: string): PMNodeJSON {
  checkStructureBounds(value);
  let count = 0; const seen = new Set<string>();
  const result = docSchema.nodeFromJSON(value).toJSON() as PMNodeJSON;
  const collect = (node: PMNodeJSON) => { if (typeof node.attrs?.id === 'string') seen.add(node.attrs.id); for (const child of node.content ?? []) collect(child); }; collect(result);
  const walk = (node: PMNodeJSON) => { if (!['doc','text','hard_break'].includes(node.type) && !node.attrs?.id) { let key: string; do { key = `${prefix}-${++count}`; } while (seen.has(key)); seen.add(key); node.attrs = { ...node.attrs, id: key }; } for (const child of node.content ?? []) walk(child); }; walk(result); return result;
}
export function projectDocContent(sections: DocSection[]): PMNodeJSON { return { type: 'doc', content: sections.flatMap(section => structuredClone(section.content.content ?? [])) }; }
export function createDocDocument(input: { documentId: string; name: string }): DocDocument {
  const section: DocSection = { id: `section-${input.documentId}`, name: '正文', content: normalizeDocContent(textFromString(''), `block-${input.documentId}`) };
  const document: DocDocument = { schemaVersion: 1, kind: 'doc', documentId: input.documentId, revision: 0, name: input.name, sections: [section], content: projectDocContent([section]), pageSettings: { ...DEFAULT_DOC_PAGE }, styles: structuredClone(DEFAULT_DOC_STYLES) };
  validateDocDocument(document); return document;
}
function validatePage(page: DocPageSettings) {
  if (!record(page) || Object.keys(page).some(key => !Object.hasOwn(DEFAULT_DOC_PAGE,key))) invalid('unknown Doc page setting');
  for (const key of Object.keys(DEFAULT_DOC_PAGE)) if (!Number.isFinite(page[key]) || Number(page[key]) < 0 || Number(page[key]) > 10000) invalid('invalid Doc page dimensions');
  if (page.width < 100 || page.height < 100 || page.width - page.marginLeft - page.marginRight < 40 || page.height - page.marginTop - page.marginBottom < 40) invalid('Doc margins leave insufficient body space');
}
function checkStructureBounds(value: PMNodeJSON): void {
  let count=0; const walk=(node: PMNodeJSON, depth: number) => { if (!record(node) || typeof node.type !== 'string' || depth > 64 || ++count > 100000 || node.content !== undefined && !Array.isArray(node.content)) invalid('invalid or excessive Doc structure'); for (const child of node.content ?? []) walk(child,depth+1); }; walk(value,0);
}
export function validateDocDocument(doc: DocDocument): void {
  if (!record(doc) || doc.kind !== 'doc' || doc.schemaVersion !== 1 || !id(doc.documentId) || !id(doc.name) || !Number.isInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.sections) || !doc.sections.length || doc.sections.length > 256) invalid('invalid Doc header/sections');
  if (doc.templateSource !== undefined) {
    const source=doc.templateSource;
    if(!record(source)||!id(source.assetId)||!id(source.fileName)||/[\\/\x00-\x1f]/.test(source.fileName)||!/^[a-f0-9]{64}$/.test(source.sourceHash)||!/^[a-f0-9]{64}$/.test(source.fingerprint)||!record(source.runs)||!record(source.blocks)||!record(source.stylesSnapshot)||!record(source.sections)) invalid('invalid Doc template provenance');
    for(const [key,item]of [...Object.entries(source.runs),...Object.entries(source.blocks)]) if(!id(key)||!record(item)||typeof item.part!=='string'||!/^word\/[\w.-]+\.xml$/.test(item.part)||!Array.isArray(item.path)||item.path.length>64||item.path.some((n:unknown)=>!Number.isSafeInteger(n)||Number(n)<0||Number(n)>100000))invalid('invalid template property location');
  }
  validatePage(doc.pageSettings); const ids = new Set<string>(); let count = 0;
  const assets = Array.isArray(doc.assets) ? doc.assets : Object.values(doc.assets ?? {}); const assetIds = new Set<string>();
  for (const asset of assets) { if (!record(asset) || !id(asset.id) || assetIds.has(asset.id) || asset.kind !== 'image' || !['image/png','image/jpeg','image/webp'].includes(asset.mimeType) || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) invalid('invalid Doc image asset'); assetIds.add(asset.id); }
  if (doc.assets && !Array.isArray(doc.assets) && Object.entries(doc.assets).some(([key,value]) => key !== value.id)) invalid('Doc asset key mismatch');
  const walk = (node: PMNodeJSON, depth: number) => {
    if (depth > 64 || ++count > 100000 || !record(node)) invalid('Doc content exceeds structure limit');
    if (!['doc','text','hard_break'].includes(node.type)) { if (!id(node.attrs?.id) || ids.has(node.attrs.id)) invalid('Doc block IDs must be unique'); ids.add(node.attrs.id); }
    for(const mark of node.marks ?? []) if(mark.type==='ooxmlRun' && (!id(mark.attrs?.sourceId)||!doc.templateSource?.runs[mark.attrs.sourceId])) invalid('missing template run property source');
    if(node.type==='doc_field'&&!['page','pages'].includes(String(node.attrs?.kind)))invalid('unsupported Doc field');
    if(['paragraph','heading'].includes(node.type))for(const key of ['pageBreakBefore','keepNext','keepLines','widowControl'])if(node.attrs?.[key]!=null&&typeof node.attrs[key]!=='boolean')invalid('invalid paragraph pagination flag');
    if (node.type === 'heading' && (!Number.isInteger(node.attrs?.level) || Number(node.attrs?.level) < 1 || Number(node.attrs?.level) > 6)) invalid('invalid Doc heading level');
    if (node.type === 'ordered_list' && (!Number.isInteger(node.attrs?.order) || Number(node.attrs?.order) < 1)) invalid('invalid ordered list start');
    if (node.attrs?.styleId != null && (!id(node.attrs.styleId) || !doc.styles || !Object.hasOwn(doc.styles,String(node.attrs.styleId)))) invalid('missing Doc style reference');
    if (node.type === 'table') { if (!Number.isInteger(node.attrs?.headerRows) || Number(node.attrs?.headerRows) < 0 || Number(node.attrs?.headerRows) > (node.content?.length ?? 0)) invalid('invalid table header count'); const cols = node.content?.[0]?.content?.length; if (!cols || cols > 32 || (node.content?.length ?? 0) > 1000 || node.content?.some(row => row.content?.length !== cols)) invalid('Doc tables must have rectangular rows'); if(node.attrs?.columnWidths != null && (!Array.isArray(node.attrs.columnWidths)||node.attrs.columnWidths.length!==cols||node.attrs.columnWidths.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0||v>10000)))invalid('invalid Doc column widths'); }
    if(['floating_image','floating_shape'].includes(node.type)){for(const key of ['x','y','width','height','rotation'])if(typeof node.attrs?.[key]!=='number'||!Number.isFinite(node.attrs[key])||Math.abs(Number(node.attrs[key]))>10000)invalid('invalid floating geometry');if(Number(node.attrs?.width)<20||Number(node.attrs?.height)<20||!['none','topBottom'].includes(String(node.attrs?.wrap))||typeof node.attrs?.locked!=='boolean')invalid('invalid floating layout');if(node.type==='floating_shape'){if(!['rectangle','ellipse'].includes(String(node.attrs?.shape))||typeof node.attrs?.text!=='string'||String(node.attrs.text).length>10000||typeof node.attrs?.fontFamily!=='string'||/[;{}<>]/.test(node.attrs.fontFamily)||typeof node.attrs?.fontSize!=='number'||Number(node.attrs.fontSize)<=0||Number(node.attrs.fontSize)>1000||typeof node.attrs?.strokeWidth!=='number'||Number(node.attrs.strokeWidth)<0||Number(node.attrs.strokeWidth)>100)invalid('invalid floating shape');for(const key of ['fill','stroke','color'])if(typeof node.attrs?.[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(String(node.attrs[key])))invalid('floating colors must use hex RGB');}}
    if ((node.type === 'inline_image' || node.type==='floating_image') && (!assetIds.has(String(node.attrs?.assetId)) || !Number.isFinite(node.attrs?.width) || !Number.isFinite(node.attrs?.height) || Number(node.attrs?.width) <= 0 || Number(node.attrs?.height) <= 0 || Number(node.attrs?.width) > 10000 || Number(node.attrs?.height) > 10000 || typeof node.attrs?.alt !== 'string')) invalid('invalid Doc image reference/geometry');
    for (const child of node.content ?? []) walk(child,depth+1);
  };
  if (doc.styles !== undefined) { if (!record(doc.styles)) invalid('invalid Doc styles'); for (const [key,style] of Object.entries(doc.styles)) { if (!id(key) || !record(style) || Object.keys(style).some(k => !['fontFamily','fontSize','color','lineHeight','spaceBefore','spaceAfter','align','bold','italic','underline','strike','keepNext'].includes(k))) invalid('invalid Doc style'); for (const [k,v] of Object.entries(style)) { if (['bold','italic','underline','strike','keepNext'].includes(k) ? typeof v !== 'boolean' : ['fontSize','lineHeight','spaceBefore','spaceAfter'].includes(k) ? typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000 : typeof v !== 'string' || !v.trim() || /[;{}<>]/.test(v) || /url\s*\(|expression\s*\(/i.test(v)) invalid('invalid Doc style value'); } } }
  for (const section of doc.sections) { if (!record(section) || !id(section.id) || ids.has(section.id) || !id(section.name)) invalid('invalid Doc section'); ids.add(section.id); if(section.breakType!==undefined&&!['nextPage','continuous','evenPage','oddPage'].includes(section.breakType))invalid('unsupported section break'); if (section.styleId !== undefined && (!doc.styles||!Object.hasOwn(doc.styles,section.styleId))) invalid('missing section style'); if (section.pageSettings) validatePage(section.pageSettings); for (const part of ['content','header','footer'] as const) if (section[part]) { if (section[part].type !== 'doc') invalid('section parts must be ProseMirror docs'); checkStructureBounds(section[part]); validateTextContent(section[part],section.id,docSchema); walk(section[part],0); } }
  if (!equal(doc.content,projectDocContent(doc.sections))) invalid('Doc content projection differs from sections');
  if (new TextEncoder().encode(JSON.stringify(doc)).length > 4 * 1024 * 1024) invalid('Doc exceeds 4 MiB');
}
const sectionAt = (doc: DocDocument, key: string) => { const section = doc.sections.find(s => s.id === key); if (!section) throw new KernelError('not_found','Doc section does not exist',key); return section; };
export function applyDocCommand(current: DocDocument, command: CommandEnvelope, base: DocDocument): { document: DocDocument; changedNodeIds: string[] } {
  validateDocDocument(current); validateDocDocument(base);
  if (!record(command) || !id(command.commandId) || !id(command.projectId) || !id(command.actorId) || !id(command.clientId) || !['human','agent','system'].includes(command.actorKind) || typeof command.label !== 'string' || !command.label.trim() || command.runId !== undefined && !id(command.runId) || command.documentId !== current.documentId || base.documentId !== current.documentId || command.baseRevision !== base.revision || base.revision > current.revision || current.revision === base.revision && !equal(current,base) || !Array.isArray(command.preconditions) || !Array.isArray(command.operations) || !command.operations.length || command.operations.length > 1000) invalid('invalid Doc command/base');
  for (const doc of base.revision === current.revision ? [base] : [base,current]) for (const condition of command.preconditions) {
    if (condition.type === 'document.property' && condition.path === 'name') { if (!equal(doc.name,condition.value)) throw new KernelError('conflict','Doc name changed'); }
    else if (condition.type === 'asset.exists') { const exists = (Array.isArray(doc.assets) ? doc.assets : Object.values(doc.assets ?? {})).some(a => a.id === condition.assetId); if (exists !== (condition.exists ?? true)) throw new KernelError('conflict','Doc asset changed'); }
    else invalid('unsupported Doc precondition');
  }
  const next = structuredClone(current); const changed = new Set<string>();
  const conflict = (a: unknown,b: unknown,key: string) => { if (base.revision !== current.revision && !equal(a,b)) throw new KernelError('conflict','Doc target changed since base',key); };
  for (const [index,raw] of command.operations.entries()) {
    if (!record(raw) || typeof raw.type !== 'string') invalid('invalid Doc operation');
    const op = raw as DocOperation; const prefix = `block-${command.commandId}-${index}`;
    switch (op.type) {
      case 'doc.text.apply': { const part = op.part ?? 'content'; if (!['content','header','footer'].includes(part) || !Array.isArray(op.steps) || !op.steps.length || op.steps.length > 1000) invalid('invalid Doc text steps'); conflict(base.sections.find(s=>s.id===op.sectionId)?.[part], current.sections.find(s=>s.id===op.sectionId)?.[part],op.sectionId); const target = sectionAt(next,op.sectionId); const previousContent=target[part] ?? textFromString('');const proposed=normalizeDocContent(applyTextSteps(previousContent,op.steps,docSchema),prefix);
        const floatMap=(root:PMNodeJSON)=>{const nodes=new Map<string,{node:PMNodeJSON;parent:string}>();const walk=(n:PMNodeJSON,parent='')=>{if(['paragraph','heading'].includes(n.type))parent=String(n.attrs?.id);if(['floating_image','floating_shape'].includes(n.type))nodes.set(String(n.attrs?.id),{node:n,parent});for(const c of n.content??[])walk(c,parent);};walk(root);return nodes;};
        const beforeFloats=floatMap(previousContent),afterFloats=floatMap(proposed);for(const [id,value]of beforeFloats)if(value.node.attrs?.locked){const next=afterFloats.get(id);const unlocked=next&&next.parent===value.parent&&next.node.attrs?.locked===false&&equal({...next.node,attrs:{...next.node.attrs,locked:true}},value.node);if(!unlocked&&(!next||next.parent!==value.parent||!equal(next.node,value.node)))throw new KernelError('locked','Floating object is locked',id);}
        target[part]=proposed; changed.add(op.sectionId); break; }
      case 'doc.section.insert': { conflict(base.sections.map(s=>s.id),current.sections.map(s=>s.id),'sections'); if (next.sections.some(s=>s.id===op.section.id)) invalid('section ID exists'); const at = op.index ?? next.sections.length; if (!Number.isInteger(at) || at < 0 || at > next.sections.length) invalid('invalid section index'); const value = structuredClone(op.section); for (const part of ['content','header','footer'] as const) if (value[part]) value[part] = normalizeDocContent(value[part],`${prefix}-${part}`); next.sections.splice(at,0,value); changed.add(value.id); break; }
      case 'doc.section.update': { if(Object.keys(op).some(k=>!['type','sectionId','name','styleId','breakType'].includes(k)))invalid('unsupported section update field');const before=base.sections.find(s=>s.id===op.sectionId), now=current.sections.find(s=>s.id===op.sectionId), target=sectionAt(next,op.sectionId); for (const key of ['name','styleId','breakType'] as const) if (op[key] !== undefined) { conflict(key==='breakType'?before?.breakType??'nextPage':before?.[key],key==='breakType'?now?.breakType??'nextPage':now?.[key],op.sectionId); if(key==='breakType'){if(op.breakType===null)delete target.breakType;else target.breakType=op.breakType;}else if (key === 'name') target.name=op.name!; else if (op.styleId===null) delete target.styleId; else target.styleId=op.styleId; } changed.add(op.sectionId); break; }
      case 'doc.section.remove': case 'doc.section.reorder': { conflict(base.sections.map(s=>s.id),current.sections.map(s=>s.id),'sections'); const at=next.sections.findIndex(s=>s.id===op.sectionId); if (at<0) invalid('missing section'); if (op.type==='doc.section.remove') { conflict(sectionAt(base,op.sectionId),sectionAt(current,op.sectionId),op.sectionId); if (next.sections.length===1) invalid('cannot remove last section'); next.sections.splice(at,1); } else { if (!Number.isInteger(op.index) || op.index<0 || op.index>=next.sections.length) invalid('invalid section index'); const [value]=next.sections.splice(at,1); next.sections.splice(op.index,0,value!); } changed.add(op.sectionId); break; }
      case 'doc.page.update': { if (!record(op.settings)) invalid('invalid page patch'); const before=op.sectionId ? sectionAt(base,op.sectionId).pageSettings ?? base.pageSettings : base.pageSettings, now=op.sectionId ? sectionAt(current,op.sectionId).pageSettings ?? current.pageSettings : current.pageSettings; for (const key of Object.keys(op.settings)) conflict(before[key],now[key],key); if (op.sectionId) { const target=sectionAt(next,op.sectionId); target.pageSettings={ ...(target.pageSettings ?? next.pageSettings),...op.settings }; changed.add(op.sectionId); } else next.pageSettings={...next.pageSettings,...op.settings}; break; }
      case 'doc.style.update': { if (!id(op.styleId)) invalid('invalid style ID'); conflict(base.styles?.[op.styleId],current.styles?.[op.styleId],op.styleId); next.styles ??= {}; if (op.style===null) delete next.styles[op.styleId]; else next.styles[op.styleId]=structuredClone(op.style); break; }
      case 'asset.register': { const values=Array.isArray(next.assets) ? next.assets : Object.values(next.assets ?? {}); if (values.some(a=>a.id===op.asset.id)) invalid('asset ID exists'); if (Array.isArray(next.assets)) next.assets.push(structuredClone(op.asset)); else { next.assets ??= {}; (next.assets as Record<string, import('./model.ts').ImageAsset>)[op.asset.id]=structuredClone(op.asset); } break; }
      default: invalid('operation is not supported by DocDocument');
    }
  }
  next.content=projectDocContent(next.sections); next.revision=current.revision+1; validateDocDocument(next); return { document:next, changedNodeIds:[...changed] };
}
export function restoreDocDocument(current: DocDocument,snapshot: DocDocument): DocDocument { validateDocDocument(current); validateDocDocument(snapshot); if (current.documentId!==snapshot.documentId) invalid('snapshot belongs to another document'); const result=structuredClone(snapshot); result.revision=current.revision+1; return result; }
