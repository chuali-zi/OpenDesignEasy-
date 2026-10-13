import { Worker } from 'node:worker_threads';
import { statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { imageSize } from 'image-size';
import { readOfficeArchive, parseOfficeXml, descendants, child, children, attr, xmlText, relationships } from './office-xml.ts';
export type ParsedReference = {
    format: string;
    text: string;
    warnings: string[];
    pages?: number;
    sheets?: Array<{
        name: string;
        rows: string[][];
    }>;
    truncated?: boolean;
};
const MAX_TEXT = 1000000;
function finish(result: ParsedReference): ParsedReference { if (result.text.length > MAX_TEXT)
    return { ...result, text: result.text.slice(0, MAX_TEXT), truncated: true, warnings: [...result.warnings, 'Extracted text truncated at 1,000,000 characters. Original retained.'] }; return result; }
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], value = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    value += '"';
                    i++;
                }
                else {
                    quoted = false;
                    closed = true;
                }
            }
            else
                value += c;
            continue;
        }
        if (c === '"') {
            if (value || closed)
                throw new Error('Invalid CSV quote');
            quoted = true;
        }
        else if (c === ',') {
            row.push(value);
            value = '';
            closed = false;
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(value);
            if (row.length > 256)
                throw new Error('CSV exceeds 256 columns');
            rows.push(row);
            row = [];
            value = '';
            closed = false;
            if (rows.length > 10000)
                throw new Error('CSV exceeds 10000 rows');
        }
        else {
            if (closed)
                throw new Error('Text after closing CSV quote');
            value += c;
        }
        if (row.length > 256)
            throw new Error('CSV exceeds 256 columns');
    }
    if (quoted)
        throw new Error('Unclosed CSV quote');
    if (value || row.length || closed) {
        row.push(value);
        if (row.length > 256)
            throw new Error('CSV exceeds 256 columns');
        rows.push(row);
    }
    if (rows.length > 10000)
        throw new Error('CSV exceeds 10000 rows');
    return rows;
}
export async function readImageOcr(bytes: Uint8Array, options: {
    signal?: AbortSignal;
    language?: string;
    dataDir?: string;
} = {}): Promise<ParsedReference> {
    const language = options.language ?? 'eng';
    if (!['eng', 'chi_sim'].includes(language)) throw new Error('OCR language must be eng or chi_sim; no automatic download occurs.');
    let directory = options.dataDir ?? process.env.OEY_OCR_DATA_DIR, gzip = false;
    if (directory === undefined) {
        // Fixed, installed dependency data only. Never ask the engine to choose a CDN.
        try { directory = resolve(dirname(createRequire(import.meta.url).resolve(language === 'eng' ? '@tesseract.js-data/eng' : '@tesseract.js-data/chi_sim')), '4.0.0_best_int'); gzip = true; }
        catch { throw new Error('OCR needs installed local language data or OEY_OCR_DATA_DIR; no automatic download occurs.'); }
    }
    const dataFile = resolve(directory, `${language}.traineddata${gzip ? '.gz' : ''}`);
    if (!isAbsolute(directory) || !existsSync(dataFile))
        throw new Error('OCR needs existing local eng/chi_sim traineddata in OEY_OCR_DATA_DIR; no automatic download occurs.');
    const trainedData = statSync(dataFile);
    if (!trainedData.isFile() || trainedData.size > 40 * 1024 * 1024)
        throw new Error('OCR language data must be a local file below 40 MiB');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
        throw new Error('OCR image exceeds byte limit');
    const image = imageSize(bytes);
    if (!image.width || !image.height || image.width * image.height > 20000000)
        throw new Error('OCR image exceeds 20 megapixels');
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
    signal.throwIfAborted();
    const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './ocr-worker.ts' : './ocr-worker.mjs', import.meta.url), { workerData: { bytes: new Uint8Array(bytes), language, dataDir: directory, gzip } });
    let onAbort: () => void = () => { };
    try {
        const text = await new Promise<string>((accept, reject) => {
            onAbort = () => reject(signal.reason ?? new Error('OCR aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
            worker.once('message', (result: {
                text?: string;
                error?: string;
            }) => result.error ? reject(new Error(result.error)) : typeof result.text === 'string' ? accept(result.text) : reject(new Error('Invalid OCR worker result')));
            worker.once('error', reject);
            worker.once('exit', code => reject(new Error(`OCR worker exited before result (${code})`)));
            if (signal.aborted)
                onAbort();
        });
        signal.throwIfAborted();
        return finish({ format: 'ocr', text, warnings: [`OCR (${language}) is inferred text; verify against original.`] });
    }
    finally {
        signal.removeEventListener('abort', onAbort);
        await worker.terminate();
    }
}
export async function parseReference(bytes: Uint8Array, fileName: string, options: {
    signal?: AbortSignal;
    ocr?: boolean;
    ocrDataDir?: string;
    ocrLanguage?: string;
} = {}): Promise<ParsedReference> {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
        throw new Error('Reference must be 1 byte..20 MiB');
    const extension = fileName.split('.').at(-1)?.toLowerCase();
    options.signal?.throwIfAborted();
    if (['txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'py'].includes(extension ?? '')) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (extension === 'json')
            JSON.parse(text);
        return finish({ format: extension!, text, warnings: [] });
    }
    if (extension === 'csv') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), rows = parseCsv(text);
        return finish({ format: 'csv', text: JSON.stringify(rows), sheets: [{ name: fileName, rows }], warnings: ['CSV cell values are strings; formulas are not executed.'] });
    }
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension ?? ''))
        return readImageOcr(bytes, { signal: options.signal, language: options.ocrLanguage, dataDir: options.ocrDataDir });
    if (extension === 'pdf') {
        const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        signal.throwIfAborted();
        const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, disableFontFace: true, disableAutoFetch: true, disableStream: true, maxImageSize: 20000000 });
        const abort = () => { void task.destroy().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            const pdf = await task.promise;
            signal.throwIfAborted();
            if (pdf.numPages > 100)
                throw new Error('PDF exceeds 100 pages');
            const pages: string[] = [], warnings: string[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                signal.throwIfAborted();
                const page = await pdf.getPage(i), content = await page.getTextContent();
                let text = content.items.map(item => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join('');
                if (!text.trim()) {
                    if (options.ocr) {
                        const factory = pdf.canvasFactory as {
                            create: (w: number, h: number) => {
                                canvas: any;
                                context: any;
                            };
                            reset: (canvas: any, w: number, h: number) => void;
                            destroy: (canvas: any) => void;
                        };
                        const viewport = page.getViewport({ scale: 1.5 });
                        const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
                        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 20_000_000) throw new Error('PDF OCR page exceeds pixel limit');
                        const canvas = factory.create(width, height);
                        let image: Uint8Array;
                        try { await page.render({ canvas: canvas.canvas, canvasContext: canvas.context, viewport }).promise; image = canvas.canvas.toBuffer('image/png'); }
                        finally { factory.destroy(canvas); }
                        const read = await readImageOcr(image, { signal, language: options.ocrLanguage, dataDir: options.ocrDataDir });
                        text = read.text;
                        warnings.push(`Page ${i}: OCR; verify inferred text.`);
                    }
                    else
                        warnings.push(`Page ${i} has no extractable text; request OCR with local language data.`);
                }
                pages.push(`Page ${i}\n${text}`);
                page.cleanup();
                if (pages.join('\n').length > MAX_TEXT)
                    break;
            }
            return finish({ format: 'pdf', text: pages.join('\n\n'), pages: pdf.numPages, warnings });
        }
        finally {
            signal.removeEventListener('abort', abort);
            await task.destroy();
        }
    }
    if (['docx', 'pptx', 'xlsx'].includes(extension ?? '')) {
        const files = readOfficeArchive(bytes);
        const xml = (name: string) => { const data = files.get(name); if (!data)
            throw new Error(`Missing Office part ${name}`); return parseOfficeXml(data); };
        if (extension === 'docx') {
            const parts = ['word/document.xml', ...Array.from(files.keys()).filter(n => /^word\/(?:header|footer)\d+\.xml$/.test(n))];
            return finish({ format: 'docx', text: parts.map(p => `${p}\n` + descendants(xml(p), 'p').map(p => descendants(p, 't').map(xmlText).join('')).join('\n')).join('\n\n'), warnings: ['Read paragraph text, including table cells and headers/footers; drawings/fields/comments are not interpreted. Original retained.'] });
        }
        if (extension === 'pptx') {
            const rels = relationships(files, 'ppt/presentation.xml'), ids = descendants(xml('ppt/presentation.xml'), 'sldId');
            if (ids.length > 100)
                throw new Error('PPTX exceeds 100 slides');
            const pages = ids.map((n, i) => { const rel = rels.get(n.attrs['r:id'] ?? attr(n, 'id')!); if (!rel || rel.external)
                throw new Error('Invalid slide relationship'); return `Slide ${i + 1}\n` + descendants(xml(rel.path), 't').map(xmlText).join('\n'); });
            return finish({ format: 'pptx', text: pages.join('\n\n'), pages: pages.length, warnings: ['Native slide/shape/table text; charts/notes/embedded media are not interpreted. Original retained.'] });
        }
        const shared = files.has('xl/sharedStrings.xml') ? descendants(xml('xl/sharedStrings.xml'), 'si').map(s => descendants(s, 't').map(xmlText).join('')) : [];
        const rels = relationships(files, 'xl/workbook.xml'), sheets = descendants(xml('xl/workbook.xml'), 'sheet');
        if (sheets.length > 100)
            throw new Error('XLSX exceeds 100 sheets');
        const result = sheets.map(sheet => {
            const rel = rels.get(attr(sheet, 'id')!);
            if (!rel || rel.external) throw new Error('Invalid sheet relationship');
            const sourceRows = descendants(xml(rel.path), 'row');
            const rows: string[][] = []; const usedRows = new Set<number>();
            for (const row of sourceRows) {
                const rowNumber = Number(attr(row, 'r'));
                if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > 10000 || usedRows.has(rowNumber)) throw new Error('XLSX requires unique rows within 1..10000');
                usedRows.add(rowNumber); const cells: string[] = []; const usedCells = new Set<number>();
                for (const cell of children(row, 'c')) {
                    const address = attr(cell, 'r')?.match(/^([A-Z]+)([1-9]\d*)$/);
                    if (!address || Number(address[2]) !== rowNumber) throw new Error('Invalid spreadsheet address');
                    let index = 0; for (const letter of address[1]!) index = index * 26 + letter.charCodeAt(0) - 64;
                    if (index > 256 || usedCells.has(index)) throw new Error('XLSX requires unique columns within A..IV');
                    usedCells.add(index);
                    const type = attr(cell, 't'), formula = child(cell, 'f'), value = child(cell, 'v');
                    let content = value ? xmlText(value) : '';
                    if (formula) content = `=${xmlText(formula)} [cached=${content}]`;
                    else if (type === 's') { const index = Number(content); if (!value || !Number.isSafeInteger(index) || index < 0 || index >= shared.length) throw new Error('Invalid XLSX shared-string index'); content = shared[index]!; }
                    else if (type === 'inlineStr') content = descendants(cell, 't').map(xmlText).join('');
                    cells[index - 1] = content;
                }
                rows[rowNumber - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
            }
            return { name: attr(sheet, 'name') ?? 'Sheet', rows: Array.from({ length: rows.length }, (_, i) => rows[i] ?? []) };
        });
        return finish({ format: 'xlsx', sheets: result, text: result.map(s => `${s.name}\n${JSON.stringify(s.rows)}`).join('\n\n'), warnings: ['Raw cell strings and cached formula results; no formulas/macros/external connections are executed. Dates/number formatting require verification.'] });
    }
    throw new Error('Unsupported reference format');
}
