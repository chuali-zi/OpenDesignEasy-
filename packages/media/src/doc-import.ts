import { crc32 } from './web-import.ts';
import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';
import { createDocDocument, normalizeDocContent, projectDocContent, validateDocDocument } from '@oeydesign/document';
import type { DocDocument, DocSection, DocTemplateSource, ImageAsset, JSONValue, PMMarkJSON, PMNodeJSON } from '@oeydesign/document';
import { readOfficeArchive, parseOfficeXml, child, children, attr, local, xmlText, descendants, relationships } from './office-xml.ts';
import type { XmlNode } from './office-xml.ts';
export const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const docFingerprint = (doc: DocDocument) => hashBytes(Buffer.from(JSON.stringify({ sections: doc.sections, pageSettings: doc.pageSettings, styles: doc.styles, assets: doc.assets })));
const reject = (message: string): never => { throw new Error(`Cannot import DOCX template: ${message}`); };
const real = (value: string | undefined) => { const n = Number(value); if (value === undefined || !Number.isFinite(n))
    return undefined; return n; };
const flag = (node: XmlNode | undefined) => node ? !['0', 'false', 'off'].includes(attr(node, 'val') ?? 'true') : undefined;
const pathAt = (root: XmlNode, path: number[]): XmlNode => path.reduce((node, n) => { if (!node.children[n])
    return reject('invalid property path'); return node.children[n]!; }, root);
export { pathAt };
export function prepareDocxImport(bytes: Uint8Array, options: {
    documentId: string;
    assetId: string;
    fileName: string;
}): {
    document: DocDocument;
    images: Array<{
        asset: ImageAsset;
        bytes: Uint8Array;
    }>;
    warnings: string[];
} {
    const files = readOfficeArchive(bytes), roots = new Map<string, XmlNode>();
    const xml = (part: string) => { if (!roots.has(part)) {
        const value = files.get(part);
        if (!value)
            return reject(`missing part ${part}`);
        roots.set(part, parseOfficeXml(value));
    } return roots.get(part)!; };
    const types = xml('[Content_Types].xml');
    if (!descendants(types, 'Override').some(n => attr(n, 'PartName') === '/word/document.xml' && attr(n, 'ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))
        reject('only DOCX main documents are supported');
    for (const part of files.keys()) {
        if (part.endsWith('.xml') || part.endsWith('.rels'))
            xml(part);
        if (part.endsWith('.rels'))
            for (const relation of children(xml(part), 'Relationship'))
                if(/\/(?:attachedTemplate|oleObject|control)$/.test(attr(relation,'Type')??''))reject('active/template relationships are unsupported');else if (attr(relation, 'TargetMode') === 'External' && (!/\/hyperlink$/.test(attr(relation, 'Type') ?? '') || !/^(https?:|mailto:|tel:)/i.test(attr(relation, 'Target') ?? '')))
                    reject('external resources/templates are unsupported');
    }
    if (/macroEnabled|vbaProject|activeX|oleObject/i.test(xmlText(types) + JSON.stringify(types)))
        reject('active Office content is unsupported');
    const doc = createDocDocument({ documentId: options.documentId, name: options.fileName.replace(/\.docx$/i, '') || 'Imported report' });
    doc.styles = {};
    const source: DocTemplateSource = { assetId: options.assetId, fileName: options.fileName, sourceHash: hashBytes(bytes), fingerprint: '0'.repeat(64), stylesSnapshot: {}, sections:{}, runs: {}, blocks: {} };
    doc.templateSource = source;
    const images: Array<{
        asset: ImageAsset;
        bytes: Uint8Array;
    }> = [], imageMap = new Map<string, ImageAsset>();
    let serial = 0;
    const key = (kind: string) => `${options.documentId}-${kind}-${++serial}`;
    const styleNodes = new Map<string, XmlNode>();
    if (files.has('word/styles.xml'))
        for (const node of children(xml('word/styles.xml'), 'style')) {
            const id = attr(node, 'styleId');
            if (id) {
                if (['__proto__', 'constructor', 'prototype'].includes(id) || id.length > 200)
                    reject('unsafe style ID');
                styleNodes.set(id, node);
            }
            ;
        }
    const pAttrs = (p: XmlNode | undefined): Record<string, JSONValue> => {
        const value: Record<string, JSONValue> = {};
        if (!p)
            return value;
        const align = attr(child(p, 'jc'), 'val');
        if (align && ['left', 'right', 'center', 'both', 'justify'].includes(align))
            value.align = align === 'both' ? 'justify' : align;
        const spacing = child(p, 'spacing');
        for (const [from, to] of [['before', 'spaceBefore'], ['after', 'spaceAfter']] as const) {
            const n = real(attr(spacing, from));
            if (n !== undefined)
                value[to] = n / 15;
        }
        const line = real(attr(spacing, 'line'));
        if (line !== undefined && attr(spacing, 'lineRule') !== 'auto')
            value.lineHeight = line / 15;
        const ind = child(p, 'ind');
        const left = real(attr(ind, 'left') ?? attr(ind, 'start')), first = real(attr(ind, 'firstLine')), hanging = real(attr(ind, 'hanging'));
        if (left !== undefined)
            value.indent = left / 15;
        if (first !== undefined || hanging !== undefined)
            value.firstLineIndent = (first ?? -hanging!) / 15;
        for (const name of ['pageBreakBefore', 'keepNext', 'keepLines', 'widowControl']) {
            const b = flag(child(p, name));
            if (b !== undefined)
                value[name] = b;
        }
        return value;
    };
    const rMarks = (p: XmlNode | undefined): PMMarkJSON[] => {
        const marks: PMMarkJSON[] = [];
        if (!p)
            return marks;
        for (const [name, type] of [['b', 'strong'], ['i', 'em'], ['strike', 'strike']] as const)
            if (flag(child(p, name)))
                marks.push({ type });
        if (child(p, 'u') && attr(child(p, 'u'), 'val') !== 'none')
            marks.push({ type: 'underline' });
        const style: Record<string, JSONValue> = {};
        const size = real(attr(child(p, 'sz'), 'val'));
        if (size !== undefined)
            style.fontSize = size / 1.5;
        const font = child(p, 'rFonts');
        const family = attr(font, 'eastAsia') ?? attr(font, 'ascii') ?? attr(font, 'hAnsi');
        if (family)
            style.fontFamily = family;
        const color = attr(child(p, 'color'), 'val'), fill = attr(child(p, 'shd'), 'fill');
        if (color && /^[a-f0-9]{6}$/i.test(color))
            style.color = '#' + color;
        if (fill && /^[a-f0-9]{6}$/i.test(fill))
            style.backgroundColor = '#' + fill;
        if (Object.keys(style).length)
            marks.push({ type: 'textStyle', attrs: style });
        return marks;
    };
    const styles = (id: string, chain: string[] = []): Record<string, JSONValue> => { if (chain.includes(id) || chain.length > 32)
        return reject('cyclic style inheritance'); if (Object.hasOwn(doc.styles!,id))
        return doc.styles![id] as Record<string, JSONValue>; const node = styleNodes.get(id); const base = node && attr(child(node, 'basedOn'), 'val'); const inherited = base ? styles(base, [...chain, id]) : {}; const result: Record<string, JSONValue> = { ...inherited }; for (const mark of rMarks(node && child(node, 'rPr'))) {
        if (mark.type === 'textStyle')
            Object.assign(result, mark.attrs);
        else
            result[{ strong: 'bold', em: 'italic', underline: 'underline', strike: 'strike' }[mark.type]!] = true;
    } const rp=node&&child(node,'rPr');for(const [xml,key]of [['b','bold'],['i','italic'],['strike','strike']] as const){const value=flag(rp&&child(rp,xml));if(value!==undefined)result[key]=value;}if(rp&&child(rp,'u'))result.underline=attr(child(rp,'u'),'val')!=='none';
        const p = pAttrs(node && child(node, 'pPr')); for (const k of ['align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'keepNext'])
        if (p[k] != null)
            result[k] = p[k]!; doc.styles![id] = result; return result; };
    for (const id of styleNodes.keys())
        styles(id);
    const defaults = files.has('word/styles.xml') ? child(xml('word/styles.xml'), 'docDefaults') : undefined;
    const normal = doc.styles.Normal ?? {};
    for (const mark of rMarks(defaults && child(child(defaults, 'rPrDefault')!, 'rPr')))
        if (mark.type === 'textStyle')
            for (const [key, value] of Object.entries(mark.attrs ?? {}))
                if (normal[key] === undefined)
                    normal[key] = value;
    doc.styles.Normal = normal;
    const numberings = new Map<string, {
        type: 'bullet_list' | 'ordered_list';
        order: number;
    }>();
    if (files.has('word/numbering.xml')) {
        const root = xml('word/numbering.xml'), abstracts = new Map(children(root, 'abstractNum').map(n => [attr(n, 'abstractNumId'), n]));
        for (const n of children(root, 'num')) {
            const id = attr(n, 'numId'), definition = abstracts.get(attr(child(n, 'abstractNumId'), 'val'));
            const lvl = definition && children(definition, 'lvl').find(l => attr(l, 'ilvl') === '0');
            if (!id || !lvl)
                continue;
            const fmt = attr(child(lvl, 'numFmt'), 'val');
            if (!['bullet', 'decimal'].includes(fmt ?? ''))
                continue;
            const override = children(n, 'lvlOverride').find(l => attr(l, 'ilvl') === '0');
            numberings.set(id, { type: fmt === 'bullet' ? 'bullet_list' : 'ordered_list', order: real(attr(override && child(override, 'startOverride'), 'val')) ?? real(attr(child(lvl, 'start'), 'val')) ?? 1 });
        }
    }
    const inline = (node: XmlNode, part: string, path: number[], inherited: PMMarkJSON[] = []): PMNodeJSON[] => {
        const name = local(node.name);
        if (name === '#text')
            return [];
        if (name === 'r') {
            const marks = rMarks(child(node, 'rPr')), sid = key('run');
            source.runs[sid] = { part, path, marks: structuredClone(marks) };
            const all = [...inherited, ...marks, { type: 'ooxmlRun', attrs: { sourceId: sid } }];
            return node.children.flatMap((n, i) => local(n.name) === 'rPr' ? [] : inline(n, part, [...path, i], all));
        }
        if (name === 't')
            return xmlText(node) ? [{ type: 'text', text: xmlText(node), marks: inherited }] : [];
        if (name === 'tab')
            return [{ type: 'text', text: '\t', marks: inherited }];
        if (name === 'br')
            return [{ type: attr(node, 'type') === 'page' ? 'inline_page_break' : 'hard_break' }];
        if (name === 'hyperlink') {
            const rel = relationships(files, part).get(node.attrs['r:id'] ?? '');
            if (!rel?.external || !/^(https?:|mailto:|tel:)/i.test(rel.path))
                return reject('unsupported hyperlink anchor');
            return node.children.flatMap((n, i) => inline(n, part, [...path, i], [...inherited, { type: 'link', attrs: { href: rel.path } }]));
        }
        if (name === 'd bookmark' || ['bookmarkStart', 'bookmarkEnd', 'proofErr', 'lastRenderedPageBreak'].includes(name))
            return [];
        if (name === 'fldSimple') {
            const instruction = (attr(node, 'instr') ?? '').trim().toUpperCase().replace(/\s+\\\*\s+MERGEFORMAT$/, '');
            if (!['PAGE', 'NUMPAGES'].includes(instruction))
                return reject('unsupported field instruction');
            return [{ type: 'doc_field', attrs: { kind: instruction === 'PAGE' ? 'page' : 'pages' } }];
        }
        if (name === 'drawing') {
            const inlineDrawing=descendants(node,'inline')[0],anchor=descendants(node,'anchor')[0],drawing=inlineDrawing ?? anchor;
            if(!drawing||inlineDrawing&&anchor||descendants(node,'anchor').length>1||descendants(node,'inline').length>1)return reject('unsupported drawing group');
            let floating:Record<string,JSONValue>|undefined;
            if(anchor){const h=child(anchor,'positionH'),v=child(anchor,'positionV');if(attr(h,'relativeFrom')!=='column'||attr(v,'relativeFrom')!=='paragraph')return reject('floating anchors require column/paragraph relative offsets');const hx=child(h,'posOffset'),vy=child(v,'posOffset');if(!hx||!vy)return reject('aligned/relative-size floating anchors not yet supported');const wrap=child(anchor,'wrapTopAndBottom')?'topBottom':child(anchor,'wrapNone')?'none':undefined;if(!wrap)return reject('side wrapping not yet supported');const extent=child(anchor,'extent'),width=real(attr(extent,'cx')),height=real(attr(extent,'cy')),transform=descendants(anchor,'xfrm')[0];if(!width||!height)return reject('invalid floating extent');floating={x:Number(xmlText(hx))/9525,y:Number(xmlText(vy))/9525,width:width/9525,height:height/9525,rotation:(real(attr(transform,'rot'))??0)/60000,wrap,locked:false};
                const shape=descendants(anchor,'wsp')[0];if(shape){if(['1','true'].includes(attr(transform,'flipH')??'')||['1','true'].includes(attr(transform,'flipV')??''))return reject('flipped shapes are unsupported');if(descendants(shape,'effectLst').length||descendants(shape,'blipFill').length||descendants(shape,'gradFill').length||descendants(shape,'schemeClr').length||descendants(shape,'noFill').length)return reject('complex/transparent shape fills are unsupported');const props=child(shape,'spPr'),geom=props&&child(props,'prstGeom'),kind=attr(geom,'prst');if(!['rect','ellipse'].includes(kind??''))return reject('unsupported floating shape');const fill=props&&child(props,'solidFill'),line=props&&child(props,'ln'),lineFill=line&&child(line,'solidFill'),run=descendants(shape,'rPr')[0],styles=rMarks(run).find(m=>m.type==='textStyle')?.attrs ?? {};const textBox=descendants(shape,'txbxContent')[0];if(!textBox)return reject('missing shape text box');for(const p of textBox.children){if(local(p.name)!=='p'||p.children.some(n=>!['pPr','r'].includes(local(n.name))))return reject('complex shape text is unsupported');const props=child(p,'pPr');if(props?.children.some(n=>local(n.name)!=='jc'||attr(n,'val')!=='center'))return reject('shape text requires centered plain paragraphs');for(const r of children(p,'r')){if(r.children.some(n=>!['rPr','t','br','tab'].includes(local(n.name))))return reject('complex shape runs are unsupported');const marks=rMarks(child(r,'rPr'));if(marks.some(m=>m.type!=='textStyle')||JSON.stringify(marks.find(m=>m.type==='textStyle')?.attrs??{})!==JSON.stringify(styles))return reject('mixed shape text formatting is unsupported');}}const text=children(textBox,'p').map(p=>children(p,'r').map(r=>r.children.map(n=>local(n.name)==='t'?xmlText(n):local(n.name)==='br'?'\n':local(n.name)==='tab'?'\t':'').join('')).join('')).join('\n');const id=key('shape'),attrs:Record<string,JSONValue>={id,...floating,shape:kind==='ellipse'?'ellipse':'rectangle',fill:'#'+(attr(fill&&child(fill,'srgbClr'),'val')??'DDEBDD'),stroke:'#'+(attr(lineFill&&child(lineFill,'srgbClr'),'val')??'355E49'),strokeWidth:(real(attr(line,'w'))??9525)/9525,text,fontFamily:styles.fontFamily??'Noto Sans CJK SC',fontSize:styles.fontSize??16,color:styles.color??'#18231d'};source.blocks[id]={part,path,type:'floating_shape',attrs:structuredClone(attrs)};return [{type:'floating_shape',attrs}];}
            }
            const transform=descendants(drawing,'xfrm')[0];if(descendants(drawing,'srcRect').some(n=>Object.values(n.attrs).some(v=>Number(v)!==0))||!anchor&&Number(attr(transform,'rot')??0)!==0||['1','true'].includes(attr(transform,'flipH')??'')||['1','true'].includes(attr(transform,'flipV')??''))return reject('cropped/flipped inline images are not yet mapped');
            const blip = descendants(drawing, 'blip')[0], ref = blip && Object.entries(blip.attrs).find(([k]) => local(k) === 'embed')?.[1], rel = ref && relationships(files, part).get(ref);
            if (!rel || rel.external)
                return reject('external image is unsupported');
            let asset = imageMap.get(rel.path);
            if (!asset) {
                const image = files.get(rel.path);
                if (!image)
                    return reject('missing image bytes');
                const size = imageSize(image);
                if (size.type === 'png') {
                    const png = Buffer.from(image);
                    let offset = 8;
                    let ended = false;
                    while (offset < png.length) {
                        if (offset + 12 > png.length)
                            reject('truncated PNG image');
                        const length = png.readUInt32BE(offset);
                        if (offset + 12 + length > png.length || crc32(png.subarray(offset + 4, offset + 8 + length)) !== png.readUInt32BE(offset + 8 + length))
                            reject('PNG image checksum mismatch');
                        const type = png.subarray(offset + 4, offset + 8).toString('ascii');
                        offset += 12 + length;
                        if (type === 'IEND') {
                            ended = true;
                            if (offset !== png.length)
                                reject('trailing PNG bytes');
                        }
                    }
                    if (!ended)
                        reject('missing PNG end');
                }
                if (!['png', 'jpg'].includes(size.type ?? '') || !size.width || !size.height || size.width * size.height > 100000000)
                    return reject('use supported PNG/JPEG image');
                asset = { id: key('image'), kind: 'image', mimeType: size.type === 'png' ? 'image/png' : 'image/jpeg', width: size.width, height: size.height, name: rel.path.split('/').at(-1) };
                imageMap.set(rel.path, asset);
                images.push({ asset, bytes: image });
            }
            const extent = child(drawing, 'extent'), width = real(attr(extent, 'cx')), height = real(attr(extent, 'cy'));
            if (!width || !height)
                return reject('invalid inline image size');
            const id=key('picture'),attrs:Record<string,JSONValue>={id,assetId:asset.id,width:width/9525,height:height/9525,alt:attr(child(drawing,'docPr'),'descr')??''};if(floating)Object.assign(attrs,floating);source.blocks[id]={part,path,type:anchor?'floating_image':'inline_image',attrs:structuredClone(attrs)};return [{type:anchor?'floating_image':'inline_image',attrs,marks:inherited}];
        }
        return reject(`unsupported inline element ${name}`);
    };
    const paragraphInline = (parent: XmlNode, part: string, path: number[]): PMNodeJSON[] => {
        const output: PMNodeJSON[] = [];
        for (let i = 0; i < parent.children.length; i++) {
            const node = parent.children[i]!;
            if (local(node.name) === 'pPr')
                continue;
            if (local(node.name) === 'r' && descendants(node, 'fldChar').some(n => attr(n, 'fldCharType') === 'begin')) {
                const start = i, group: XmlNode[] = [];
                let depth = 0;
                do {
                    const value = parent.children[i];
                    if (!value)
                        reject('unterminated field');
                    group.push(value!);
                    for (const flag of descendants(value!, 'fldChar')) {
                        if (attr(flag, 'fldCharType') === 'begin')
                            depth++;
                        if (attr(flag, 'fldCharType') === 'end')
                            depth--;
                    }
                    if (depth < 0 || depth > 1)
                        reject('nested/invalid field');
                    if (depth)
                        i++;
                } while (depth);
                const instruction = group.flatMap(n => descendants(n, 'instrText').map(xmlText)).join('').trim().toUpperCase();
                const match = instruction.match(/^(PAGE|NUMPAGES)(?:\s+\\\*\s+(?:MERGEFORMAT|ARABIC))*$/);
                if (!match)
                    reject('unsupported field instruction');
                const marks = rMarks(child(node, 'rPr')), id = key('run');
                source.runs[id] = { part, path: [...path, start], marks: structuredClone(marks) };
                output.push({ type: 'doc_field', attrs: { kind: match![1] === 'PAGE' ? 'page' : 'pages' }, marks: [...marks, { type: 'ooxmlRun', attrs: { sourceId: id } }] });
                continue;
            }
            output.push(...inline(node, part, [...path, i]));
        }
        return output;
    };
    const paragraph = (node: XmlNode, part: string, path: number[]): {
        node: PMNodeJSON;
        numId?: string;
    } => {
        const p = child(node, 'pPr'), id = key('block'), styleId = attr(p && child(p, 'pStyle'), 'val');
        if (styleId && !Object.hasOwn(doc.styles!,styleId))
            styles(styleId);
        if(styleId&&!child(p,'numPr')){let cursor:string|undefined=styleId;for(let depth=0;cursor&&depth<32;depth++){const style=styleNodes.get(cursor);if(child(child(style,'pPr'),'numPr'))reject('style-driven numbering is not yet mapped');cursor=attr(child(style,'basedOn'),'val');}}
        const sourceStyle = styleId ? styleNodes.get(styleId) : undefined;
        const level = real(attr(p && child(p, 'outlineLvl'), 'val')) ?? real(attr(sourceStyle && child(child(sourceStyle, 'pPr')!, 'outlineLvl'), 'val')) ?? (styleId?.match(/^Heading([1-6])$/i) ? Number(styleId.match(/\d/)!) - 1 : undefined);
        const attrs: Record<string, JSONValue> = { id, ...pAttrs(p), ...(styleId ? { styleId } : {}), ...(level !== undefined && level < 6 ? { level: level + 1 } : {}) };
        const result: PMNodeJSON = { type: level !== undefined && level < 6 ? 'heading' : 'paragraph', attrs, content: paragraphInline(node, part, path) };
        source.blocks[id] = { part, path, type: result.type, attrs: structuredClone(attrs) };
        const num = p && child(p, 'numPr');
        if (num && Number(attr(child(num, 'ilvl'), 'val') ?? 0) !== 0)
            return reject('nested numbering not yet supported');
        return { node: result, numId: attr(num && child(num, 'numId'), 'val') };
    };
    const blocks = (parent: XmlNode, part: string, path: number[]): PMNodeJSON[] => {
        const out: PMNodeJSON[] = [];
        let listId: string | undefined;
        for (const [index, node] of parent.children.entries()) {
            const name = local(node.name), next = [...path, index];
            if (name === '#text' || ['sectPr', 'tblPr', 'tblGrid', 'tcPr'].includes(name))
                continue;
            if (name === 'p') {
                const parsed = paragraph(node, part, next);
                if (parsed.numId) {
                    const number = numberings.get(parsed.numId);
                    if (!number)
                        return reject('unsupported numbering definition');
                    let list = out.at(-1);
                    if (listId !== parsed.numId || !list || !['bullet_list', 'ordered_list'].includes(list.type)) {
                        list = { type: number.type, attrs: number.type === 'ordered_list' ? { order: number.order } : {}, content: [] };
                        out.push(list);
                    }
                    list.content!.push({ type: 'list_item', content: [parsed.node] });
                    listId = parsed.numId;
                }
                else {
                    out.push(parsed.node);
                    listId = undefined;
                }
                continue;
            }
            listId = undefined;
            if (name === 'tbl') {
                const rows = children(node, 'tr');
                let headerEnded = false;
                for (const row of rows) {
                    const header = flag(child(child(row, 'trPr'), 'tblHeader'));
                    if (header && headerEnded)
                        reject('non-contiguous table headers');
                    if (!header)
                        headerEnded = true;
                }
                const table: PMNodeJSON = { type: 'table', attrs: { id: key('table'), headerRows: rows.filter(r => flag(child(child(r, 'trPr')!, 'tblHeader'))).length }, content: rows.map(row => ({ type: 'table_row', content: children(row, 'tc').map(cell => { const props = child(cell, 'tcPr'); if (child(props!, 'vMerge') || Number(attr(child(props!, 'gridSpan'), 'val') ?? 1) !== 1)
                            return reject('merged table cells not yet supported'); if (children(cell, 'tbl').length)
                            reject('nested tables not yet supported'); return { type: 'table_cell', content: blocks(cell, part, [...next, node.children.indexOf(row), row.children.indexOf(cell)]) }; }) })) };
                const grid = child(node, 'tblGrid'), widths = grid && children(grid, 'gridCol').map(n => Number(attr(n, 'w')) / 15);
                if (widths?.length && widths.every(n => n > 0))
                    table.attrs!.columnWidths = widths;
                source.blocks[String(table.attrs!.id)] = { part, path: next, type: 'table', attrs: structuredClone(table.attrs!) };
                out.push(table);
                continue;
            }
            return reject(`unsupported block ${name}`);
        }
        return out;
    };
    const main = xml('word/document.xml'), body = child(main, 'body');
    if (!body)
        return reject('missing document body');
    const bodyPath = [main.children.indexOf(body)], sections: DocSection[] = [];
    let current: PMNodeJSON[] = [];
    const rels = relationships(files, 'word/document.xml');
    let headerPart: string | undefined, footerPart: string | undefined;
    const locate=(root:XmlNode,target:XmlNode,path:number[]=[]):number[]|undefined=>{if(root===target)return path;for(let i=0;i<root.children.length;i++){const found=locate(root.children[i]!,target,[...path,i]);if(found)return found;}};
    const finish = (props: XmlNode | undefined) => {
        const numbering=props&&child(props,'pgNumType');if(numbering&&(attr(numbering,'start')!==undefined||attr(numbering,'fmt')!==undefined&&attr(numbering,'fmt')!=='decimal'))reject('page-number restarts/custom formats are outside editable template support');
        if(props&&descendants(props,'cols').some(n=>Number(attr(n,'num')??'1')!==1||children(n,'col').length>0))reject('multiple text columns/custom column widths are outside editable template support');
        const id = key('section'), page = { ...doc.pageSettings }, size = props && child(props, 'pgSz'), margin = props && child(props, 'pgMar');
        for (const [a, b] of [['w', 'width'], ['h', 'height']] as const) {
            const n = real(attr(size, a));
            if (n !== undefined)
                page[b] = n / 15;
        }
        for (const [a, b] of [['top', 'marginTop'], ['right', 'marginRight'], ['bottom', 'marginBottom'], ['left', 'marginLeft']] as const) {
            const n = real(attr(margin, a));
            if (n !== undefined)
                page[b] = n / 15;
        }
        for (const [tag, kind] of [['headerReference', 'header'], ['footerReference', 'footer']] as const) {
            const refs = props && children(props, tag);
            if (refs?.some(n => attr(n, 'type') !== 'default'))
                return reject('first/even-page headers not yet supported');
            const ref = refs?.[0], rel = ref && rels.get(ref.attrs['r:id'] ?? '');
            if(ref&&!rel)reject('missing header/footer relationship');
            if(refs&&refs.length>1)reject('duplicate header/footer relationship');
            if (rel) {
                if (rel.external)
                    return reject('external header/footer');
                if (kind === 'header')
                    headerPart = rel.path;
                else
                    footerPart = rel.path;
            }
        }
        const header = headerPart ? normalizeDocContent({ type: 'doc', content: blocks(xml(headerPart), headerPart, []) }, `${id}-header`) : undefined;
        const footer = footerPart ? normalizeDocContent({ type: 'doc', content: blocks(xml(footerPart), footerPart, []) }, `${id}-footer`) : undefined;
        const breakType=attr(props&&child(props,'type'),'val')??'nextPage';if(!['nextPage','continuous','evenPage','oddPage'].includes(breakType))reject('unsupported section break');if(props){const path=locate(main,props);if(path)source.sections[id]={path,settings:structuredClone(page),breakType};}
        const content = normalizeDocContent({ type: 'doc', content: current.length ? current : [{ type: 'paragraph' }] }, id);
        sections.push({ id, breakType:breakType as DocSection['breakType'], name: `章节 ${sections.length + 1}`, content, pageSettings: page, styleId: 'Normal', ...(header ? { header: structuredClone(header) } : {}), ...(footer ? { footer: structuredClone(footer) } : {}) });
        current = [];
    };
    let segment: Array<{
        node: XmlNode;
        index: number;
    }> = [];
    const flush = (props: XmlNode | undefined) => {
        const priorKeys = new Set([...Object.keys(source.runs), ...Object.keys(source.blocks)]);
        current = blocks({ name: 'holder', attrs: {}, children: segment.map(item => item.node) }, 'word/document.xml', []);
        for (const [id, entry] of [...Object.entries(source.runs), ...Object.entries(source.blocks)])
            if (!priorKeys.has(id) && entry.part === 'word/document.xml') {
                const originalIndex = segment[entry.path[0]!]?.index;
                if (originalIndex === undefined)
                    reject('invalid template source mapping');
                entry.path = [...bodyPath, originalIndex!, ...entry.path.slice(1)];
            }
        finish(props);
        segment = [];
    };
    for (const [index, node] of body.children.entries()) {
        const name = local(node.name);
        if (name === '#text')
            continue;
        if (name === 'sectPr') {
            flush(node);
            continue;
        }
        segment.push({ node, index });
        const sectionProps = name === 'p' && child(child(node, 'pPr'), 'sectPr');
        if (sectionProps)
            flush(sectionProps);
    }
    if (segment.length || !sections.length)
        flush(undefined);
    doc.sections = sections;
    doc.pageSettings = { ...sections[0]!.pageSettings! };
    doc.assets = images.map(i => i.asset);
    doc.content = projectDocContent(sections);
    const baseline = (n: PMNodeJSON) => { if (n.attrs?.id && source.blocks[String(n.attrs.id)])
        source.blocks[String(n.attrs.id)]!.attrs = structuredClone(n.attrs); for (const c of n.content ?? [])
        baseline(c); };
    for (const section of sections)
        for (const content of [section.content, section.header, section.footer])
            if (content)
                baseline(content);
    source.stylesSnapshot = structuredClone(doc.styles);
    source.fingerprint = docFingerprint(doc);
    validateDocDocument(doc);
    return { document: doc, images, warnings: ['支持正文/样式/平面列表/矩形表格/章节/默认页眉页脚/PNG/JPEG及有限浮动图片/矩形椭圆文字框；复杂域、合并格与其他锚点/环绕拒绝。原始模板完整保留。'] };
}
