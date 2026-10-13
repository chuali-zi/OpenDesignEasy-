import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';
import type { Node } from 'typescript';
import { validateWebDocument } from '@oeydesign/document';
import type { WebDocument, ImageAsset } from '@oeydesign/document';
import { buildWebSource } from './web.ts';

export const WEB_IMPORT_LIMITS = { archive: 8 * 1024 * 1024, file: 4 * 1024 * 1024, expanded: 16 * 1024 * 1024, entries: 256 };
const fail = (message: string): never => { throw new Error(`Cannot import source ZIP: ${message}`); };
const text = (bytes: Uint8Array): string => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('UTF-8 text is required'); } };
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Bounded, in-memory ZIP reader. Never extracts files or follows links. */
export function readSourceArchive(input: Uint8Array): Map<string, Uint8Array> {
  if (input.length < 22 || input.length > WEB_IMPORT_LIMITS.archive) fail('archive must be at most 8 MiB');
  const b = Buffer.from(input); const files = new Map<string, Uint8Array>();
  const bounds = (start: number, size: number) => { if (start < 0 || size < 0 || start + size > b.length) fail('truncated ZIP'); };
  let end = b.length - 22;
  while (end >= Math.max(0, b.length - 65557) && b.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || end < b.length - 65557) fail('missing ZIP directory');
  bounds(end, 22);
  if (end + 22 + b.readUInt16LE(end + 20) !== b.length || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) fail('multi-volume or trailing ZIP data is unsupported');
  const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16);
  if (!count || count > WEB_IMPORT_LIMITS.entries || count !== b.readUInt16LE(end + 8) || start + size !== end) fail('ZIP entry/directory limits exceeded');
  const names = new Set<string>(); const ranges: Array<[number, number]> = []; let offset = start, total = 0;
  for (let i = 0; i < count; i++) {
    bounds(offset, 46);
    if (b.readUInt32LE(offset) !== 0x02014b50) fail('invalid ZIP directory entry');
    const flags = b.readUInt16LE(offset + 8), method = b.readUInt16LE(offset + 10);
    const crc = b.readUInt32LE(offset + 16), compressed = b.readUInt32LE(offset + 20), expanded = b.readUInt32LE(offset + 24);
    const nameSize = b.readUInt16LE(offset + 28), extraSize = b.readUInt16LE(offset + 30), commentSize = b.readUInt16LE(offset + 32);
    const local = b.readUInt32LE(offset + 42); bounds(offset + 46, nameSize + extraSize + commentSize);
    const name = text(b.subarray(offset + 46, offset + 46 + nameSize));
    const directory = name.endsWith('/'); const parts = (directory ? name.slice(0, -1) : name).split('/');
    if (!name || name.length > 240 || /[\\:\x00-\x1f]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || names.has(name.toLowerCase())) fail('unsafe or duplicate ZIP path');
    names.add(name.toLowerCase());
    const mode = (b.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000 || b.readUInt16LE(offset + 34) || flags & ~0x0808 || ![0, 8].includes(method)) fail('links, encryption or unsupported compression');
    // ZIP64 is intentionally unsupported; entry sizes must fit the same limits.
    for (let e = offset + 46 + nameSize; e < offset + 46 + nameSize + extraSize;) {
      if (e + 4 > offset + 46 + nameSize + extraSize) fail('invalid ZIP extra field');
      if (b.readUInt16LE(e) === 1) fail('ZIP64 is unsupported');
      e += 4 + b.readUInt16LE(e + 2);
      if (e > offset + 46 + nameSize + extraSize) fail('invalid ZIP extra field');
    }
    total += expanded;
    if (expanded > WEB_IMPORT_LIMITS.file || total > WEB_IMPORT_LIMITS.expanded) fail('expanded ZIP size exceeds limits');
    bounds(local, 30);
    if (local >= start || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method) fail('invalid local ZIP header');
    const localNameSize = b.readUInt16LE(local + 26), localExtraSize = b.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameSize + localExtraSize; bounds(local + 30, localNameSize + localExtraSize + compressed);
    if (text(b.subarray(local + 30, local + 30 + localNameSize)) !== name || dataStart + compressed > start) fail('ZIP path/header mismatch');
    ranges.push([local, dataStart + compressed]);
    const packed = b.subarray(dataStart, dataStart + compressed);
    const bytes = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: WEB_IMPORT_LIMITS.file });
    if (bytes.length !== expanded || crc32(bytes) !== crc || directory && bytes.length) fail('ZIP length/checksum mismatch');
    if (!directory) files.set(name, bytes);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  if (offset !== end) fail('ZIP directory size mismatch');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i > 0 && r[0] < ranges[i - 1]![1])) fail('overlapping ZIP entries');
  return files;
}

function safeJson(bytes: Uint8Array): unknown {
  let value: unknown;
  try { value = JSON.parse(text(bytes)); } catch { return fail('invalid JSON snapshot'); }
  const queue: Array<[unknown, number]> = [[value, 0]]; let count = 0;
  while (queue.length) {
    const [item, depth] = queue.pop()!;
    if (++count > 100000 || depth > 64) fail('snapshot structure exceeds limits');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe snapshot key');
      queue.push([child, depth + 1]);
    }
  }
  return value;
}

export type PreparedWebImport = { document: WebDocument; images: Array<{ asset: ImageAsset; bytes: Uint8Array }>; changedModules: string[]; warnings: string[] };

async function validateManagedSources(document: WebDocument): Promise<void> {
  const paths = new Set((document.sourceModules ?? []).map(module => module.path));
  for (const module of document.sourceModules ?? []) {
    const importPath = (specifier: string) => {
      if (['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(specifier)) return;
      if (!specifier.startsWith('.') || /[\\:#?]/.test(specifier)) fail('managed imports must use React or declared relative modules');
      const resolved = posix.normalize(posix.join(posix.dirname(module.path), specifier));
      if (resolved.startsWith('../') || ![resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.css`, `${resolved}/index.ts`, `${resolved}/index.tsx`].some(path => paths.has(path))) fail('managed import escapes the source project or refers to an undeclared module');
    };
    if (module.language === 'css') {
      for (const match of module.source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) importPath(match[1]!);
      if (/url\s*\(\s*(?!["']?data:)/i.test(module.source)) fail('CSS file URLs are unsupported; use native image nodes or embedded data');
      continue;
    }
    if (/\/assets\//.test(module.source)) fail('literal asset URLs in managed code are unsupported; use native image nodes');
    const ts = (await import('typescript')).default;
    const source = ts.createSourceFile(module.path, module.source, ts.ScriptTarget.Latest, true, module.language === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) importPath(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) importPath(arg.text); else fail('dynamic module paths are unsupported');
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') fail('CommonJS require is unsupported in managed browser code');
      if (ts.isPropertyAccessExpression(node) && ['glob', 'globEager'].includes(node.name.text)) fail('filesystem glob macros are unsupported');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

/** OEY source ZIPs only: native structure comes from the validated snapshot;
 * managed TS/TSX/CSS files may change, generated entry files must still match. */
export async function prepareWebSourceImport(bytes: Uint8Array): Promise<PreparedWebImport> {
  const files = readSourceArchive(bytes);
  const snapshot = files.get('oey-document.json'), metadata = files.get('oey-metadata.json');
  if (!snapshot || !metadata) fail('requires an OEY source ZIP with oey-document.json; arbitrary HTML/React projects are not yet supported');
  const document = safeJson(snapshot!) as WebDocument;
  if (!document || !Array.isArray(document.pages) || !document.nodes || typeof document.nodes !== 'object' || Array.isArray(document.nodes) || document.sourceModules !== undefined && !Array.isArray(document.sourceModules)) fail('invalid document collections');
  if (document.pages.length > 64 || Object.keys(document.nodes).length > 2000 || (document.sourceModules?.length ?? 0) > 128) fail('document structure exceeds limits');
  const stack: Array<[string, number]> = document.pages.map(page => [page.rootId, 0]); const seen = new Set<string>();
  while (stack.length) {
    const [id, depth] = stack.pop()!; if (depth > 128) fail('native tree depth exceeds limits');
    if (seen.has(id)) continue; seen.add(id);
    const children = document.nodes[id]?.children;
    if (Array.isArray(children)) { if (children.length > 2000) fail('child list exceeds limits'); for (const child of children) stack.push([child, depth + 1]); }
  }
  validateWebDocument(document);
  const meta = safeJson(metadata!) as { format?: string; documentId?: string; revision?: number };
  if (meta.format !== 'web-source' || meta.documentId !== document.documentId || meta.revision !== document.revision) fail('source metadata does not match snapshot');
  const images: PreparedWebImport['images'] = []; const warnings: string[] = []; const changedModules: string[] = [];
  const referenced = new Set(Object.values(document.nodes).map(node => node.props?.assetId).filter((v): v is string => typeof v === 'string'));
  const assets = Array.isArray(document.assets) ? document.assets : Object.values(document.assets ?? {});
  for (const asset of assets) {
    const image = files.get(`public/assets/${asset.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    if (!image) { if (referenced.has(asset.id)) fail('referenced image bytes are missing'); warnings.push('一份未使用图片的原件缺失，已省略其资产记录。'); continue; }
    images.push({ asset, bytes: image });
  }
  if ([...referenced].some(id => !assets.some(a => a.id === id))) fail('image reference has no registered metadata');
  document.assets = images.map(i => i.asset);
  const generated = await buildWebSource(document, async id => images.find(i => i.asset.id === id)!.bytes);
  const modules = new Set((document.sourceModules ?? []).map(m => `src/${m.path}`));
  for (const path of files.keys()) if (!Object.hasOwn(generated, path)) fail('unrecognized file; remove unsupported files before importing');
  for (const [path, expected] of Object.entries(generated)) {
    const actual = files.get(path); if (!actual) fail(`missing required file: ${path}`);
    if (modules.has(path)) continue;
    if ((['src/App.tsx', 'src/main.tsx', 'src/style.css', 'index.html'].includes(path) || path.startsWith('original/')) && text(actual!) !== expected) fail(`generated entry changed: ${path}; edit native content in OEY or modify a managed source module`);
  }
  for (const module of document.sourceModules ?? []) {
    const source = text(files.get(`src/${module.path}`)!);
    if (source !== module.source) changedModules.push(module.path);
    module.source = source;
  }
  validateWebDocument(document);
  await validateManagedSources(document);
  warnings.push('Package scripts and build configuration are not executed or adopted.');
  return { document, images, changedModules, warnings };
}
