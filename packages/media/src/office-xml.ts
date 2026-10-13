import { posix } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readSourceArchive } from './web-import.ts';
export type XmlNode={name:string;attrs:Record<string,string>;children:XmlNode[];text?:string};
export const local=(name:string)=>name.split(':').at(-1)!;
export const child=(node:XmlNode,name:string)=>node.children.find(c=>local(c.name)===name);
export const children=(node:XmlNode,name:string)=>node.children.filter(c=>local(c.name)===name);
export const attr=(node:XmlNode|undefined,name:string)=>node && Object.entries(node.attrs).find(([key])=>local(key)===name)?.[1];
export function descendants(node:XmlNode,name:string):XmlNode[]{return [...(local(node.name)===name?[node]:[]),...node.children.flatMap(n=>descendants(n,name))];}
export function xmlText(node:XmlNode):string{return node.text ?? node.children.map(xmlText).join('');}
export function parseOfficeXml(bytes:Uint8Array):XmlNode {
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Office XML declarations/entities are unsupported');if(XMLValidator.validate(xml)!==true)throw new Error('Malformed Office XML');
 const raw=new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:false,parseTagValue:false,parseAttributeValue:false,processEntities:true,htmlEntities:false}).parse(xml) as Record<string,any>[];let count=0;
 const convert=(entries:Record<string,any>[],depth:number):XmlNode[]=>entries.flatMap(entry=>{if(depth>64||++count>100000)throw new Error('Office XML structure limit exceeded');const name=Object.keys(entry).find(k=>k!==':@');if(!name||name.startsWith('?')||name==='#comment')return [];if(name==='#text')return [{name,attrs:{},children:[],text:String(entry[name])}];const attrs=Object.fromEntries(Object.entries(entry[':@']??{}).map(([k,v])=>[k.replace(/^@_/,''),String(v)]));return [{name,attrs,children:convert(entry[name],depth+1)}];});
 const roots=convert(raw,0).filter(n=>n.name!=='#text');if(roots.length!==1)throw new Error('Office XML requires one root');return roots[0]!;
}
export function readOfficeArchive(bytes:Uint8Array):Map<string,Uint8Array>{const files=readSourceArchive(bytes,{allowOfficeRelationships:true});for(const name of files.keys())if(/vbaProject|activeX|embeddings\//i.test(name))throw new Error('Macros and embedded executable/OLE objects are unsupported');if(!files.has('[Content_Types].xml'))throw new Error('Missing Office content types');return files;}
export function relationships(files:Map<string,Uint8Array>,part:string):Map<string,{path:string;external:boolean}> {
 const relPath=posix.join(posix.dirname(part),'_rels',posix.basename(part)+'.rels'),data=files.get(relPath),result=new Map<string,{path:string;external:boolean}>();if(!data)return result;
 for(const rel of children(parseOfficeXml(data),'Relationship')){const id=attr(rel,'Id'),target=attr(rel,'Target'),external=attr(rel,'TargetMode')==='External';if(!id||!target||result.has(id))throw new Error('Invalid Office relationship');const path=external?target:posix.normalize(posix.join(posix.dirname(part),target));if(!external&&(path.startsWith('../')||path.startsWith('/')||path.includes('\\')))throw new Error('Unsafe Office relationship path');result.set(id,{path,external});}return result;
}
