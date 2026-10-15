type TextRun = { str: string; transform: number[]; width: number; height: number; dir?: string; hasEOL?: boolean };
const isRun = (item: object): item is TextRun => 'str' in item && 'transform' in item && 'width' in item;
const cjkLine = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}\p{N}\s]+$/u;
const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Repair font-fallback emission order within one contiguous horizontal CJK line.
 * Never globally sort a page, infer missing glyphs, or reorder RTL/rotated text. */
export function pdfPageText(items: object[]): { text: string; repaired: boolean } {
  const lines: TextRun[][] = [];
  let line: TextRun[] = [];
  for (const item of items) {
    if (!isRun(item)) continue;
    if (line.length && Math.abs(item.transform[5]! - line[0]!.transform[5]!) > 0.5) { lines.push(line); line = []; }
    line.push(item);
  }
  if (line.length) lines.push(line);
  let repaired = false;
  return { text: lines.map(runs => {
    const value = runs.map(run => run.str).join('');
    const horizontal = runs.every(run => run.dir !== 'rtl' && run.dir !== 'ttb' && Math.abs(run.transform[1]!) < 0.01 && Math.abs(run.transform[2]!) < 0.01);
    const inverted = runs.some((run, index) => index > 0 && run.str.trim() && run.transform[4]! < runs[index - 1]!.transform[4]! - 0.5);
    if (!horizontal || !inverted || !hasCjk.test(value) || !cjkLine.test(value)) return runs.map(run => run.str + (run.hasEOL ? '\n' : ' ')).join('');
    const visible = runs.filter(run => run.str.trim());
    // PDF.js may insert a synthetic space before a fallback font draws the glyph
    // occupying that very interval. Only discard a space whose span is covered.
    const sorted = runs.filter(run => run.str.trim() || run.width > 0 && !visible.some(other => other.transform[4]! < run.transform[4]! + run.width - 0.5 && other.transform[4]! + other.width > run.transform[4]! + 0.5))
      .sort((a, b) => a.transform[4]! - b.transform[4]!);
    let text = '', end = Number.NEGATIVE_INFINITY;
    for (const run of sorted) {
      const gap = run.transform[4]! - end;
      if (text && gap > Math.max(1, run.height * 0.25) && !/\s$/.test(text) && !/^\s/.test(run.str)) text += ' ';
      text += run.str; end = Math.max(end, run.transform[4]! + run.width);
    }
    repaired = true;
    return text + (runs.some(run => run.hasEOL) ? '\n' : ' ');
  }).join(''), repaired };
}
