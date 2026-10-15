import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseReference } from '@oeydesign/media';

// Explicit opt-in check of synthetic files from delivery.spec.ts, using the installed Office apps.
// No API provider, user document, global settings or network access is involved.
if (process.platform !== 'win32') throw new Error('This check requires Windows and installed Microsoft Office.');
const directory = resolve(process.argv[2] ?? '.tmp/evidence/r6-delivery');
const pathLiteral = (name: string) => `'${resolve(directory, name).replaceAll("'", "''")}'`;
await mkdir(directory, { recursive: true });
for (const name of ['doc-r2.docx', 'deck-r2.pptx']) await readFile(resolve(directory, name));
const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$result=[ordered]@{schemaVersion=1;host='Windows';word=$null;powerpoint=$null}
if (Get-Process WINWORD -ErrorAction SilentlyContinue) {
  $result.word=@{status='unavailable';reason='Word is already running; no user session was touched.'}
} else {
  $word=$null;$doc=$null
  try {
    $word=New-Object -ComObject Word.Application
    $word.Visible=$false;$word.DisplayAlerts=0
    $inputPath=${pathLiteral('doc-r2.docx')};$no=$false;$yes=$true;$save=0
    $doc=$word.Documents.Open([ref]$inputPath,[ref]$no,[ref]$yes,[ref]$no)
    $doc.Repaginate()
    $paragraphs=@()
    foreach($p in $doc.Paragraphs) { $text=$p.Range.Text.Trim(); if($text) { $paragraphs+=@{text=$text;lines=$p.Range.ComputeStatistics(1);font=$p.Range.Font.Name;fontFarEast=$p.Range.Font.NameFarEast;fontPt=$p.Range.Font.Size} } }
    $paper=@{widthPt=$doc.PageSetup.PageWidth;heightPt=$doc.PageSetup.PageHeight;leftPt=$doc.PageSetup.LeftMargin;rightPt=$doc.PageSetup.RightMargin;topPt=$doc.PageSetup.TopMargin;bottomPt=$doc.PageSetup.BottomMargin}
    $pages=$doc.ComputeStatistics(2)
    $doc.ExportAsFixedFormat(${pathLiteral('doc-word.pdf')},17)
    $doc.Content.InsertAfter('Word 本机另存验证。')
    $copyPath=${pathLiteral('doc-word-roundtrip.docx')};$fileFormat=16
    $doc.SaveAs2([ref]$copyPath,[ref]$fileFormat)
    $doc.Close([ref]$save);$doc=$null
    $doc=$word.Documents.Open([ref]$copyPath,[ref]$no,[ref]$yes,[ref]$no)
    $result.word=@{status='passed';version=$word.Version;build=$word.Build;pages=$pages;paper=$paper;paragraphs=$paragraphs;roundtripMarker=$doc.Content.Text.Contains('Word 本机另存验证。');render='doc-word.pdf';testedScope='Synthetic current-revision DOCX open, paginate, PDF render, edit, save as, reopen. Not arbitrary Word compatibility.'}
  } catch { $result.word=@{status='failed';message=$_.Exception.Message} }
  finally { try { if($doc){$doc.Close([ref]$save)} } finally { if($word){$word.Quit([ref]$save)} } }
}
if (Get-Process POWERPNT -ErrorAction SilentlyContinue) {
  $result.powerpoint=@{status='unavailable';reason='PowerPoint is already running; no user session was touched.'}
} else {
  $ppt=$null;$deck=$null
  try {
    $ppt=New-Object -ComObject PowerPoint.Application
    $deck=$ppt.Presentations.Open(${pathLiteral('deck-r2.pptx')},-1,0,0)
    $slide=$deck.Slides.Item(1)
    $slide.Export(${pathLiteral('deck-powerpoint.png')},'PNG',1280,720)
    $size=@{widthPt=$deck.PageSetup.SlideWidth;heightPt=$deck.PageSetup.SlideHeight}
    $slideCount=$deck.Slides.Count
    $texts=@();foreach($shape in $slide.Shapes){if($shape.HasTextFrame){$texts+=$shape.TextFrame.TextRange.Text}}
    $marker=$slide.Shapes.AddTextbox(1,60,480,800,30)
    $marker.TextFrame.TextRange.Text='PowerPoint 本机另存验证。'
    $deck.SaveCopyAs(${pathLiteral('deck-powerpoint-roundtrip.pptx')},24)
    $deck.Close();$deck=$null
    $deck=$ppt.Presentations.Open(${pathLiteral('deck-powerpoint-roundtrip.pptx')},-1,0,0)
    $roundtrip=@();foreach($shape in $deck.Slides.Item(1).Shapes){if($shape.HasTextFrame){$roundtrip+=$shape.TextFrame.TextRange.Text}}
    $result.powerpoint=@{status='passed';version=$ppt.Version;build=$ppt.Build;slides=$slideCount;size=$size;text=$texts;roundtripMarker=($roundtrip -join ' ').Contains('PowerPoint 本机另存验证。');render='deck-powerpoint.png';testedScope='Synthetic current-revision PPTX open, render, edit, save copy, reopen. Not arbitrary PowerPoint compatibility.'}
  } catch { $result.powerpoint=@{status='failed';message=$_.Exception.Message} }
  finally { if($deck){$deck.Close()};if($ppt){$ppt.Quit()} }
}
$json=$result | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText(${pathLiteral('office-results.json')},$json,[System.Text.UTF8Encoding]::new($false))
`;
const encoded = Buffer.from(script, 'utf16le').toString('base64');
await new Promise<void>((accept, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('Office check exceeded 60 seconds. Inspect any newly started Office instance before retrying.')); }, 60_000);
  child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`Office helper failed (${code}): ${output.slice(-2000)}`)); });
});
const result = JSON.parse(await readFile(resolve(directory, 'office-results.json'), 'utf8'));
const hashes: Record<string, string> = {};
for (const name of ['doc-r2.docx', 'deck-r2.pptx']) hashes[name] = createHash('sha256').update(await readFile(resolve(directory, name))).digest('hex');
result.inputSha256 = hashes;
for (const [name, marker] of [['doc-word-roundtrip.docx', 'Word 本机另存验证。'], ['deck-powerpoint-roundtrip.pptx', 'PowerPoint 本机另存验证。']]) {
  const app = name!.startsWith('doc') ? result.word : result.powerpoint;
  if (app.status !== 'passed') continue;
  const parsed = await parseReference(await readFile(resolve(directory, name!)), name!);
  app.roundtripXmlConfirmed = parsed.text.includes(marker!);
  if (!app.roundtripMarker || !app.roundtripXmlConfirmed) app.status = 'failed';
}
await writeFile(resolve(directory, 'office-results.json'), JSON.stringify(result, null, 2));
if (result.word.status === 'passed') {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await readFile(resolve(directory, 'doc-word.pdf'))), useWorkerFetch: false });
  try {
    const pdf = await task.promise, page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1.5 });
    const factory = pdf.canvasFactory as unknown as { create(w: number, h: number): { canvas: any; context: any }; destroy(value: unknown): void };
    const canvas = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: canvas.canvas, canvasContext: canvas.context, viewport }).promise;
      await writeFile(resolve(directory, 'doc-word-render.png'), canvas.canvas.toBuffer('image/png'));
    } finally { factory.destroy(canvas); }
    result.word.renderPng = 'doc-word-render.png';
  } finally { await task.destroy(); }
  const browser = JSON.parse(await readFile(resolve(directory, 'browser-doc-lines.json'), 'utf8'));
  const paragraph = result.word.paragraphs.find((item: { text: string }) => item.text === browser.text);
  result.word.lineComparison = { browser: browser.lines, word: paragraph?.lines, sameForThisFixture: browser.lines === paragraph?.lines, note: 'Requested font names do not prove the same actual substituted font. This fixture is not a general layout guarantee.' };
}
await writeFile(resolve(directory, 'office-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.word.status !== 'passed' || result.powerpoint.status !== 'passed') process.exitCode = 1;
