import JSZip from 'jszip';
import type { DocDocument, JSONValue, PMMarkJSON, PMNodeJSON } from '@oeydesign/document';
import { readOfficeArchive, parseOfficeXml, serializeOfficeXml, local, child, children, attr, descendants, setXmlChild, setXmlAttr } from './office-xml.ts';
import type { XmlNode } from './office-xml.ts';
import { pathAt } from './doc-import.ts';
export type DocXmlBinding = {
    kind: 'block';
    id: string;
    attrs: Record<string, JSONValue>;
    type: string;
} | {
    kind: 'run';
    id: string;
    marks: PMMarkJSON[];
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const empty = (name: string): XmlNode => ({ name: `w:${name}`, attrs: {}, children: [] });
function propertyMerge(original: XmlNode | undefined, generated: XmlNode | undefined, changed: string[], kind: 'pPr' | 'rPr'): XmlNode {
    const result = original ? structuredClone(original) : empty(kind);
    for (const name of changed)
        setXmlChild(result, name, generated && child(generated, name));
    return result;
}
const markAttrs = (marks: PMMarkJSON[]) => { const out: Record<string, unknown> = { strong: false, em: false, underline: false, strike: false }; for (const mark of marks) {
    if (Object.hasOwn(out, mark.type))
        out[mark.type] = true;
    if (mark.type === 'textStyle')
        Object.assign(out, mark.attrs);
} return out; };
/** Regenerate supported content while retaining source package parts and untouched OOXML properties. */
export async function preserveTemplateXml(doc: DocDocument, original: Uint8Array, generated: Uint8Array, bindings: Map<string, DocXmlBinding>): Promise<Uint8Array> {
    const source = doc.templateSource!, old = readOfficeArchive(original), fresh = readOfficeArchive(generated), oldRoots = new Map<string, XmlNode>();
    const oldXml = (part: string) => { if (!oldRoots.has(part)) {
        const bytes = old.get(part);
        if (!bytes)
            throw new Error('Template property source part is missing');
        oldRoots.set(part, parseOfficeXml(bytes));
    } return oldRoots.get(part)!; };
    const numberBytes = fresh.get('word/numbering.xml'), numberRoot = numberBytes && parseOfficeXml(numberBytes), oldNumber = old.has('word/numbering.xml') ? oldXml('word/numbering.xml') : undefined;
    const numbered = new Set<string>();
    const tables = new Map<string, PMNodeJSON>();
    const firstParagraph = (n: PMNodeJSON): PMNodeJSON | undefined => ['paragraph', 'heading'].includes(n.type) ? n : (n.content ?? []).map(firstParagraph).find(Boolean);
    const collect = (n: PMNodeJSON) => { if (n.type === 'table') {
        const p = firstParagraph(n);
        if (p?.attrs?.id)
            tables.set(String(p.attrs.id), n);
    } for (const c of n.content ?? [])
        collect(c); };
    for (const s of doc.sections)
        for (const c of [s.content, s.header, s.footer])
            if (c)
                collect(c);
    for (const [part, bytes] of fresh) {
        if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(part))
            continue;
        const root = parseOfficeXml(bytes);
        const runBindings = new WeakMap<XmlNode, DocXmlBinding>();
        const imageBindings=new WeakMap<XmlNode,DocXmlBinding>();
        const scan=(node:XmlNode,inherited?:DocXmlBinding,inheritedImage?:DocXmlBinding)=>{
            let active=inherited,imageActive=inheritedImage;
            for(const c of node.children){
                if(local(c.name)==='bookmarkStart'){const value=bindings.get(attr(c,'name')??'');if(value?.kind==='run')active=value;else if(value?.kind==='block'&&['inline_image','floating_image','floating_shape'].includes(value.type))imageActive=value;}
                else if(local(c.name)==='bookmarkEnd'){active=inherited;imageActive=inheritedImage;}
                if(local(c.name)==='r'&&active?.kind==='run')runBindings.set(c,active);
                if(local(c.name)==='drawing'&&imageActive)imageBindings.set(c,imageActive);
                scan(c,active,imageActive);
            }
        };
        scan(root);
        const visit = (node: XmlNode) => {
            for (const c of node.children)
                visit(c);
            if(local(node.name)==='drawing'){
                const binding=imageBindings.get(node);if(binding?.kind!=='block')return;const item=source.blocks[binding.id];
                if(!item||item.type!==binding.type||binding.type==='floating_shape'&&!equal(item.attrs,binding.attrs)||binding.type!=='floating_shape'&&!equal(item.attrs.assetId,binding.attrs.assetId))return;
                const originalDrawing=structuredClone(pathAt(oldXml(item.part),item.path)),oldBlip=descendants(originalDrawing,'blip')[0],newBlip=descendants(node,'blip')[0];
                if(oldBlip&&newBlip){for(const k of Object.keys(oldBlip.attrs))if(local(k)==='embed')delete oldBlip.attrs[k];const entry=Object.entries(newBlip.attrs).find(([k])=>local(k)==='embed');if(entry)oldBlip.attrs[entry[0]]=entry[1];}
                const frameName=binding.type==='inline_image'?'inline':'anchor',oldFrame=descendants(originalDrawing,frameName)[0],newFrame=descendants(node,frameName)[0];
                if(oldFrame&&newFrame){
                    const oldProps=child(oldFrame,'docPr'),newProps=child(newFrame,'docPr');if(oldProps&&newProps){oldProps.attrs.id=newProps.attrs.id!;if(!equal(item.attrs.alt,binding.attrs.alt))oldProps.attrs.descr=String(binding.attrs.alt ?? '');}
                    if(!equal(item.attrs.width,binding.attrs.width)||!equal(item.attrs.height,binding.attrs.height)){setXmlChild(oldFrame,'extent',child(newFrame,'extent'));const before=descendants(originalDrawing,'xfrm')[0],now=descendants(node,'xfrm')[0];if(before&&now)setXmlChild(before,'ext',child(now,'ext'));}
                    if(frameName==='anchor'){
                        if(!equal(item.attrs.x,binding.attrs.x))setXmlChild(oldFrame,'positionH',child(newFrame,'positionH'));if(!equal(item.attrs.y,binding.attrs.y))setXmlChild(oldFrame,'positionV',child(newFrame,'positionV'));
                        if(!equal(item.attrs.rotation,binding.attrs.rotation)){const before=descendants(originalDrawing,'xfrm')[0],now=descendants(node,'xfrm')[0];if(before&&now)setXmlAttr(before,'rot',attr(now,'rot'));}
                        if(!equal(item.attrs.wrap,binding.attrs.wrap)){const name=binding.attrs.wrap==='none'?'wrapNone':'wrapTopAndBottom',wrap=child(newFrame,name)!;oldFrame.children=oldFrame.children.map(n=>['wrapNone','wrapTopAndBottom'].includes(local(n.name))?structuredClone(wrap):n);}
                    }
                }
                node.children=originalDrawing.children;node.attrs=originalDrawing.attrs;return;
            }
            if (local(node.name) === 'tbl') {
                const pBinding = descendants(node, 'bookmarkStart').map(m => bindings.get(attr(m, 'name') ?? '')).find(b => b?.kind === 'block');
                const table = pBinding && tables.get(pBinding.id), item = table?.attrs?.id && source.blocks[String(table.attrs.id)];
                if (table && item) {
                    const originalTable = pathAt(oldXml(item.part), item.path);
                    setXmlChild(node, 'tblPr', child(originalTable, 'tblPr'));
                    if (equal(item.attrs.columnWidths, table.attrs?.columnWidths))
                        setXmlChild(node, 'tblGrid', child(originalTable, 'tblGrid'));
                    const beforeRows = children(originalTable, 'tr'), nowRows = children(node, 'tr');
                    if (beforeRows.length === nowRows.length)
                        for (let r = 0; r < nowRows.length; r++) {
                            const prior = child(beforeRows[r], 'trPr'), generated = child(nowRows[r], 'trPr'), props = prior ? structuredClone(prior) : empty('trPr');
                            setXmlChild(props, 'tblHeader', generated && child(generated, 'tblHeader'));
                            setXmlChild(nowRows[r]!, 'trPr', props);
                            const beforeCells = children(beforeRows[r]!, 'tc'), nowCells = children(nowRows[r]!, 'tc');
                            if (beforeCells.length === nowCells.length && equal(item.attrs.columnWidths, table.attrs?.columnWidths))
                                for (let c = 0; c < nowCells.length; c++)
                                    setXmlChild(nowCells[c]!, 'tcPr', child(beforeCells[c], 'tcPr'));
                        }
                }
                return;
            }
            if (!['p', 'r'].includes(local(node.name)))
                return;
            const marker = descendants(node, 'bookmarkStart').map(m => attr(m, 'name')).find(name => name && bindings.get(name)?.kind === (local(node.name) === 'p' ? 'block' : 'run'));
            const binding = local(node.name) === 'r' ? runBindings.get(node) : (marker ? bindings.get(marker) : undefined);
            if (!binding)
                return;
            if (binding.kind === 'run') {
                const item = source.runs[binding.id];
                if (!item)
                    return;
                const originalRun = pathAt(oldXml(item.part), item.path), before = markAttrs(item.marks), now = markAttrs(binding.marks), properties = { strong: ['b', 'bCs'], em: ['i', 'iCs'], underline: ['u'], strike: ['strike'], fontFamily: ['rFonts'], fontSize: ['sz', 'szCs'], color: ['color'], backgroundColor: ['shd'] };
                const changed = Object.entries(properties).filter(([key]) => !equal(before[key], now[key])).flatMap(([, names]) => names);
                const result = propertyMerge(child(originalRun, 'rPr'), child(node, 'rPr'), changed, 'rPr');
                for (const [name, xmlName] of [['strong', 'b'], ['em', 'i'], ['underline', 'u'], ['strike', 'strike']] as const)
                    if (before[name] === true && now[name] !== true)
                        setXmlChild(result, xmlName, { name: `w:${xmlName}`, attrs: { 'w:val': xmlName === 'u' ? 'none' : '0' }, children: [] });
                setXmlChild(node, 'rPr', result);
                return;
            }
            const item = source.blocks[binding.id];
            if (!item || item.type !== binding.type)
                return;
            const originalNode = pathAt(oldXml(item.part), item.path), before = item.attrs, now = binding.attrs, generatedPr = child(node, 'pPr'), origPr = child(originalNode, 'pPr');
            const mappings: Record<string, string[]> = { styleId: ['pStyle'], level: ['outlineLvl'], align: ['jc'], pageBreakBefore: ['pageBreakBefore'], keepNext: ['keepNext'], keepLines: ['keepLines'], widowControl: ['widowControl'] };
            const changed = Object.entries(mappings).filter(([key]) => !equal(before[key], now[key])).flatMap(([, names]) => names);
            const result = propertyMerge(origPr, generatedPr, changed, 'pPr');
            setXmlChild(result, 'sectPr', generatedPr && child(generatedPr, 'sectPr'));
            for (const [group, keys] of [['spacing', ['lineHeight', 'spaceBefore', 'spaceAfter']], ['ind', ['indent', 'firstLineIndent']]] as const)
                if (keys.some(key => !equal(before[key], now[key])))
                    setXmlChild(result, group, generatedPr && child(generatedPr, group));
            const genNum = generatedPr && child(generatedPr, 'numPr'), origNum = origPr && child(origPr, 'numPr');
            setXmlChild(result, 'numPr', genNum); // new list items share regenerated sequence identities
            if (genNum && origNum && numberRoot && oldNumber) {
                const genId = attr(child(genNum, 'numId'), 'val'), oldId = attr(child(origNum, 'numId'), 'val');
                if (genId && oldId && !numbered.has(genId)) {
                    const gn = children(numberRoot, 'num').find(n => attr(n, 'numId') === genId), on = children(oldNumber, 'num').find(n => attr(n, 'numId') === oldId);
                    const ga = gn && children(numberRoot, 'abstractNum').find(n => attr(n, 'abstractNumId') === attr(child(gn, 'abstractNumId'), 'val')), oa = on && children(oldNumber, 'abstractNum').find(n => attr(n, 'abstractNumId') === attr(child(on, 'abstractNumId'), 'val'));
                    if (ga && oa) {
                        const oldLevel = children(oa, 'lvl').find(n => attr(n, 'ilvl') === '0'), genLevel = children(ga, 'lvl').find(n => attr(n, 'ilvl') === '0');
                        if (oldLevel && genLevel && attr(child(oldLevel, 'numFmt'), 'val') === attr(child(genLevel, 'numFmt'), 'val')) {
                            const copy = structuredClone(oldLevel);
                            setXmlChild(copy, 'start', child(genLevel, 'start'));
                            const at=ga.children.indexOf(genLevel);ga.children.splice(at,1,copy);
                        }
                    }
                    numbered.add(genId);
                }
            }
            setXmlChild(node, 'pPr', result);
        };
        visit(root);
        if(part==='word/document.xml'){
            const sects=descendants(root,'sectPr');if(sects.length!==doc.sections.length)throw new Error('Generated section count differs from model');
            for(let i=0;i<sects.length;i++){const section=doc.sections[i]!,baseline=source.sections[section.id];if(!baseline)continue;const current=sects[i]!,originalProps=structuredClone(pathAt(oldXml('word/document.xml'),baseline.path));
                for(const tag of ['headerReference','footerReference']){originalProps.children=originalProps.children.filter(n=>local(n.name)!==tag);const refs=children(current,tag).map(n=>structuredClone(n));const at=tag==='headerReference'?0:originalProps.children.filter(n=>local(n.name)==='headerReference').length;originalProps.children.splice(at,0,...refs);}
                if(!equal(baseline.breakType,section.breakType ?? 'nextPage'))setXmlChild(originalProps,'type',child(current,'type'));
                const page=section.pageSettings ?? doc.pageSettings;
                if(!equal(baseline.settings.width,page.width)||!equal(baseline.settings.height,page.height))setXmlChild(originalProps,'pgSz',child(current,'pgSz'));
                const margins=child(originalProps,'pgMar');if(margins){const generatedMargins=child(current,'pgMar');for(const [key,name]of [['marginTop','top'],['marginRight','right'],['marginBottom','bottom'],['marginLeft','left']] as const)if(!equal(baseline.settings[key],page[key]))setXmlAttr(margins,name,attr(generatedMargins,name));}
                current.attrs=originalProps.attrs;current.children=originalProps.children;
            }
        }
        const originalRoot = old.get(part) && oldXml(part);
        if (originalRoot)
            for (const [key, value] of Object.entries(originalRoot.attrs))
                if (key.startsWith('xmlns:') && !root.attrs[key])
                    root.attrs[key] = value;
        fresh.set(part, Buffer.from(serializeOfficeXml(root)));
    }
    if (numberRoot)
        fresh.set('word/numbering.xml', Buffer.from(serializeOfficeXml(numberRoot)));
    // Original style XML stays byte-exact when its editable properties were not changed.
    if (old.has('word/styles.xml')) {
        if (equal(doc.styles, source.stylesSnapshot))
            fresh.set('word/styles.xml', old.get('word/styles.xml')!);
        else {
            const root = oldXml('word/styles.xml'), gen = parseOfficeXml(fresh.get('word/styles.xml')!);
            for (const [id, style] of Object.entries(doc.styles ?? {})) {
                if (equal(style, source.stylesSnapshot[id]))
                    continue;
                const value = children(gen, 'style').find(s => attr(s, 'styleId') === id);
                if (!value)
                    continue;
                const originalStyle = children(root, 'style').find(s => attr(s, 'styleId') === id);
                if (originalStyle) {
                    for (const name of ['rPr', 'pPr']) {
                        const originalProps = child(originalStyle, name), newProps = child(value, name);
                        if (newProps) {
                            const combined = originalProps ? structuredClone(originalProps) : empty(name);
                            for (const c of newProps.children)
                                setXmlChild(combined, local(c.name), c);
                            setXmlChild(originalStyle, name, combined);
                        }
                    }
                }
                else
                    root.children.push(value);
            }
            fresh.set('word/styles.xml', Buffer.from(serializeOfficeXml(root)));
        }
    }
    const types = oldXml('[Content_Types].xml'), newTypes = parseOfficeXml(fresh.get('[Content_Types].xml')!);
    for (const node of newTypes.children) {
        if (local(node.name) === '#text')
            continue;
        const key = attr(node, 'PartName') ?? attr(node, 'Extension');
        types.children = types.children.filter(oldNode => local(oldNode.name) !== local(node.name) || (attr(oldNode, 'PartName') ?? attr(oldNode, 'Extension')) !== key);
        types.children.push(node);
    }
    fresh.set('[Content_Types].xml', Buffer.from(serializeOfficeXml(types)));
    for (const [part, bytes] of fresh) {
        if (!part.endsWith('.rels') || !old.has(part))
            continue;
        const root = parseOfficeXml(bytes), prior = oldXml(part);
        let serial = 0;
        const ids = new Set(children(root, 'Relationship').map(r => attr(r, 'Id')));
        for (const relation of children(prior, 'Relationship')) {
            if (children(root, 'Relationship').some(r => attr(r, 'Type') === attr(relation, 'Type') && attr(r, 'Target') === attr(relation, 'Target')))
                continue;
            const copy = structuredClone(relation);
            let id: string;
            do {
                id = `oeyPreserved${++serial}`;
            } while (ids.has(id));
            copy.attrs.Id = id;
            ids.add(id);
            root.children.push(copy);
        }
        fresh.set(part, Buffer.from(serializeOfficeXml(root)));
    }
    const zip = new JSZip();
    for (const [part, bytes] of old)
        zip.file(part, bytes);
    for (const [part, bytes] of fresh)
        zip.file(part, bytes);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
