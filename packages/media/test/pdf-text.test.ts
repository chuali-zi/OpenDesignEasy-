import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfPageText } from '../src/pdf-text.ts';
const run = (str: string, x: number, y: number, width = str.length * 18, height = 18) => ({ str, transform: [18, 0, 0, 18, x, y], width, height, dir: 'ltr', hasEOL: false });

test('real LibreOffice fallback emission order reconstructs CJK without synthetic overlapping spaces', () => {
  const extracted = pdfPageText([run('合成分', 72.1, 738.689), run(' ', 126.1, 738.689, 35.982, 0), run('告', 162.082, 738.689), run('页报', 126.1, 738.689)]);
  assert.equal(extracted.text.trim(), '合成分页报告'); assert.equal(extracted.repaired, true);
});
test('repair retains intentional gaps and paragraph baselines, never invents a missing glyph', () => {
  const extracted = pdfPageText([run('甲', 0, 40), run('丙', 60, 40), run('乙', 18, 40), { ...run('次行', 0, 20), hasEOL: true }]);
  assert.equal(extracted.text, '甲乙 丙 次行\n'); assert.equal(extracted.repaired, true);
  assert.equal(pdfPageText([run('甲', 0, 40), run('丙', 36, 40)]).repaired, false);
});
test('RTL, vertical/rotated, mixed Latin and separate columns retain original stream order', () => {
  for (const runs of [
    [run('乙', 18, 20), { ...run('甲', 0, 20), dir: 'rtl' }],
    [run('乙', 18, 20), { ...run('甲', 0, 20), transform: [0, 18, -18, 0, 0, 20] }],
    [run('API乙', 30, 20), run('甲', 0, 20)],
    [run('左上', 0, 40), run('左下', 0, 20), run('右上', 200, 40), run('右下', 200, 20)],
  ]) assert.equal(pdfPageText(runs).repaired, false);
});
