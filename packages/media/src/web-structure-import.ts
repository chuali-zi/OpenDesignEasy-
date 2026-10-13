import { chromium } from 'playwright';
import type { Expression, JsxChild, JsxElement, JsxSelfClosingElement, Node } from 'typescript';
import { createWebDocument, validateWebDocument, textToString } from '@oeydesign/document';
import type { JSONValue, WebDocument, WebNode, PMNodeJSON, PMMarkJSON } from '@oeydesign/document';
import { browserLaunchOptions } from './browser.ts';
import { renderWebStyles, webNativeTag } from './web-markup.ts';

type Tree = { tag: string; props: Record<string, JSONValue>; style: Record<string, JSONValue>; text?: string; children: Tree[] };
export const WEB_STRUCTURE_LIMITS = { bytes: 1024 * 1024, nodes: 256, depth: 32 };
const fail = (message: string): never => { throw new Error(`Cannot import structure: ${message}`); };

async function htmlTree(source: string): Promise<Tree> {
  const browser = await chromium.launch(browserLaunchOptions());
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    // tsx/esbuild's keepNames helper can appear in serialized trusted callbacks.
    await page.evaluate('globalThis.__name = (value) => value');
    // DOMParser stays disconnected. Authored scripts are never installed in a page.
    return await page.evaluate(({ source, limits }) => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      if (document.querySelector('script,style,link,iframe,object,embed,base,img,picture,source')) throw new Error('Only native static HTML with inline CSS is supported; scripts, style sheets, frames and image resources are preserved in your input file but cannot be mapped by this importer.');
      let count = 0;
      const read = (element: Element, depth: number): Tree => {
        if (++count > limits.nodes || depth > limits.depth) throw new Error('Structure exceeds node/depth limits.');
        const props: Record<string, string | boolean> = {}, style: Record<string, string> = {};
        if (/url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|[{}<>]/i.test(element.getAttribute('style') ?? '')) throw new Error('Inline CSS resources or executable values are unsupported.');
        for (const attr of Array.from(element.attributes)) {
          if (/^on/i.test(attr.name) || ['__proto__', 'constructor', 'prototype', 'src', 'srcset', 'poster', 'srcdoc', 'action', 'formaction'].includes(attr.name)) throw new Error('Executable, resource or unsafe HTML attributes are unsupported.');
          if (attr.name !== 'style') props[attr.name] = ['checked', 'disabled', 'required', 'readonly', 'multiple', 'selected', 'autofocus', 'hidden', 'open'].includes(attr.name) ? true : attr.value;
        }
        if (element instanceof HTMLElement) for (const property of Array.from(element.style)) {
          const value = element.style.getPropertyValue(property);
          if (element.style.getPropertyPriority(property) || /url\s*\(|expression\s*\(|javascript\s*:|[;{}<>]/i.test(value)) throw new Error('Inline CSS resources, important declarations and executable values are unsupported.');
          style[property.startsWith('--') ? property : property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
        }
        const children: Tree[] = [];
        const mixed = Array.from(element.childNodes).some(node => node.nodeType === Node.ELEMENT_NODE);
        let text = '';
        for (const node of Array.from(element.childNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) children.push(read(node as Element, depth + 1));
          else if (node.nodeType === Node.TEXT_NODE) {
            const value = node.textContent ?? '';
            if (!mixed) text += value;
            else if (value.trim() || /^(?:p|span|a|h[1-6]|b|strong|i|em|label|button)$/i.test(element.tagName)) {
              if (++count > limits.nodes) throw new Error('Structure exceeds node limits.');
              children.push({ tag: 'span', props: {}, style: {}, text: value, children: [] });
            }
          }
        }
        return { tag: element.tagName.toLowerCase() === 'body' ? 'div' : element.tagName.toLowerCase(), props, style, ...(text ? { text } : {}), children };
      };
      return read(document.body, 0);
    }, { source, limits: WEB_STRUCTURE_LIMITS });
  } catch (error) { return fail(error instanceof Error ? error.message : 'HTML parse failed.'); }
  finally { await browser.close(); }
}

async function reactTree(source: string): Promise<Tree> {
  const ts = (await import('typescript')).default;
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if ((ast as typeof ast & { parseDiagnostics: unknown[] }).parseDiagnostics.length) fail('Invalid TSX syntax.');
  const constants = new Map<string, Expression>(); let root: Node | undefined, steps = 0;
  const literal = (node: Expression, depth = 0): JSONValue => {
    if (++steps > 100000 || depth > WEB_STRUCTURE_LIMITS.depth) return fail('Literal structure exceeds limits.');
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, depth + 1);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
    if (ts.isIdentifier(node) && constants.has(node.text)) return literal(constants.get(node.text)!, depth + 1);
    if (ts.isObjectLiteralExpression(node)) {
      const result: Record<string, JSONValue> = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !property.name || !ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) return fail('Only literal object properties are supported.');
        const key = property.name.text; if (['__proto__', 'constructor', 'prototype'].includes(key)) return fail('Unsafe literal key.');
        result[key] = literal(property.initializer, depth + 1);
      }
      return result;
    }
    return fail('Dynamic expressions, calls, spreads and executable code cannot be mapped. Original input is not executed or changed.');
  };
  const declarations = (statement: Node) => {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return fail('Only static const declarations and one exported component are supported.');
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) fail('Destructuring and missing initializers are unsupported.');
      constants.set((declaration.name as import('typescript').Identifier).text, declaration.initializer!);
    }
  };
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) { if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'react') fail('Only the React import is supported; external dependencies are not loaded.'); }
    else if (ts.isExportAssignment(statement) && !statement.isExportEquals) root = statement.expression;
    else if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { if (root) fail('Multiple entry components.'); root = statement; }
    else declarations(statement);
  }
  if (!root) fail('A default-exported static component is required.');
  if (ts.isIdentifier(root!)) root = constants.get(root!.text);
  if (!root) fail('Unknown entry component.');
  const entry = root;
  if (ts.isArrowFunction(root!) || ts.isFunctionDeclaration(root!) || ts.isFunctionExpression(root!)) {
    if (root!.parameters.length || !root!.body) fail('Parameterized components are unsupported.');
    const body = root!.body!;
    if (ts.isBlock(body)) { let returned: Expression | undefined; for (const statement of body.statements) { if (ts.isReturnStatement(statement) && statement.expression && !returned) returned = statement.expression; else declarations(statement); } root = returned; }
    else root = body;
  }
  while (root && ts.isParenthesizedExpression(root)) root = root.expression;
  for (const expression of constants.values()) if (expression !== entry) literal(expression);
  const decode = (value: string) => value.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) { const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd'; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' } as Record<string, string>)[entity.toLowerCase()]!;
  });
  const jsxText = (value: string) => {
    const lines = value.split(/\r\n|\n|\r/), last = lines.findLastIndex(line => line.trim());
    return decode(lines.map((line, i) => { let text = line.replace(/\t/g, ' '); if (i) text = text.replace(/^ +/, ''); if (i !== lines.length - 1) text = text.replace(/ +$/, ''); return text ? text + (i < last ? ' ' : '') : ''; }).join(''));
  };
  let count = 0;
  const read = (node: JsxElement | JsxSelfClosingElement | import('typescript').JsxFragment, depth: number): Tree => {
    if (++count > WEB_STRUCTURE_LIMITS.nodes || depth > WEB_STRUCTURE_LIMITS.depth) return fail('Structure exceeds node/depth limits.');
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    const result: Tree = { tag: opening?.tagName.getText(ast) ?? 'div', props: {}, style: {}, children: [] };
    if (opening) for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) return fail('JSX spreads are unsupported.');
      const key = attribute.name.getText(ast); if (/^on/i.test(key) || ['__proto__', 'constructor', 'prototype', 'dangerouslySetInnerHTML', 'src', 'srcSet', 'ref', 'action', 'formAction'].includes(key)) fail('Executable attributes and external/image resources are unsupported.');
      const value = !attribute.initializer ? true : ts.isStringLiteral(attribute.initializer) ? decode(attribute.initializer.text) : ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression ? literal(attribute.initializer.expression) : fail('Unsupported JSX attribute.');
      if (key === 'style') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Style must be a literal object.'); result.style = value as Record<string, JSONValue>; }
      else result.props[key] = value;
    }
    const children: readonly JsxChild[] = ts.isJsxSelfClosingElement(node) ? [] : node.children;
    for (const child of children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) result.children.push(read(child, depth + 1));
      else {
        const value = ts.isJsxText(child) ? jsxText(child.text) : ts.isJsxExpression(child) && child.expression ? literal(child.expression) : '';
        if (value !== '' && value !== null && typeof value !== 'boolean') {
          if (typeof value === 'object') fail('Only scalar text expressions are supported.');
          if (++count > WEB_STRUCTURE_LIMITS.nodes) fail('Structure exceeds node limits.');
          result.children.push({ tag: 'span', props: {}, style: {}, text: String(value), children: [] });
        }
      }
    }
    return result;
  };
  if (!root || !ts.isJsxElement(root) && !ts.isJsxSelfClosingElement(root) && !ts.isJsxFragment(root)) fail('Entry must return native JSX.');
  return read(root as JsxElement, 0);
}

export async function prepareWebStructureImport(source: string, format: 'html' | 'tsx', fileName: string): Promise<WebDocument> {
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > WEB_STRUCTURE_LIMITS.bytes || !['html', 'tsx'].includes(format) || typeof fileName !== 'string' || !fileName || fileName.length > 160 || /[\\/\x00-\x1f]/.test(fileName)) fail('Source must be nonempty UTF-8 text at most 1 MiB with a simple file name.');
  const tree = format === 'html' ? await htmlTree(source) : await reactTree(source);
  const document = createWebDocument({ documentId: 'import-structure', name: fileName, rootId: 'import-root', pageId: 'import-page' }); let count = 0;
  const inlineTags = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'a']);
  const inline = (node: Tree): boolean => inlineTags.has(node.tag) && !Object.keys(node.style).length && Object.keys(node.props).every(key => node.tag === 'a' && ['href', 'title'].includes(key)) && node.children.every(inline);
  const textRuns = (node: Tree, inherited: PMMarkJSON[] = []): PMNodeJSON[] => {
    const marks = [...inherited];
    const kind = ({ b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'underline', s: 'strike' } as Record<string, string>)[node.tag];
    if (kind && !marks.some(mark => mark.type === kind)) marks.push({ type: kind });
    if (node.tag === 'a' && typeof node.props.href === 'string') marks.push({ type: 'link', attrs: { href: node.props.href, title: node.props.title ?? null } });
    if (node.tag === 'br') return [{ type: 'hard_break' }];
    return [...(node.text ? [{ type: 'text', text: node.text, ...(marks.length ? { marks } : {}) }] : []), ...node.children.flatMap(child => textRuns(child, marks))];
  };
  const visit = (tree: Tree, parentId: string | null, root = false): string => {
    const id = root ? 'import-root' : `import-node-${++count}`;
    const style = { ...tree.style }, display = style.display, position = style.position;
    if (Object.values(style).some(value => value !== null && typeof value !== 'string' && typeof value !== 'number' || typeof value === 'string' && /url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|[;{}<>]/i.test(value))) fail('Only native literal CSS values without resources are supported.');
    if (Object.values(tree.props).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) fail('Native attributes must be scalar literals.');
    const mode = position === 'absolute' || position === 'fixed' ? 'position' : display === 'flex' || display === 'grid' ? display : 'flow';
    const node: WebNode = { id, parentId, tag: tree.tag, props: tree.props, children: [], style, layout: { mode }, ...(tree.text !== undefined ? { text: tree.text } : {}) };
    if (position && ['absolute', 'fixed', 'relative', 'static'].includes(String(position))) node.layout.position = position as WebNode['layout']['position'];
    webNativeTag(node); document.nodes[id] = node;
    if (/^(?:p|h[1-6])$/.test(tree.tag) && tree.children.length && tree.children.every(inline)) {
      node.content = { type: 'doc', content: [{ type: 'paragraph', content: textRuns(tree) }] }; node.text = textToString(node.content);
    } else tree.children.forEach(child => node.children.push(visit(child, id)));
    return id;
  };
  visit(tree, null, true); document.originalSource = { format, fileName, source }; validateWebDocument(document); renderWebStyles(document); return document;
}
