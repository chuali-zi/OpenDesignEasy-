import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Windows acceptance only; the product exporter has no Office dependency.
const input = process.argv[2];
if (!input) throw new Error('Usage: tsx scripts/ts/check-office.ts <generated.pptx> [output-directory]');
const destination = resolve(process.argv[3] ?? '.tmp/office-validation');
mkdirSync(destination, { recursive: true });
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const script = `
$ErrorActionPreference = 'Stop'
$application = $null
$presentation = $null
try {
  $application = New-Object -ComObject PowerPoint.Application
  $presentation = $application.Presentations.Open(${quote(resolve(input))}, -1, 0, 0)
  $slides = @()
  foreach ($slide in $presentation.Slides) {
    $tables = 0; $charts = 0; $pictures = 0; $texts = 0
    foreach ($shape in $slide.Shapes) {
      if ($shape.HasTable -eq -1) { $tables++ }
      if ($shape.HasChart -eq -1) { $charts++ }
      if ($shape.Type -eq 13) { $pictures++ }
      if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) { $texts++ }
    }
    $slide.Export((Join-Path ${quote(destination)} ('slide-' + $slide.SlideIndex + '.png')), 'PNG', 1280, 720)
    $slides += @{ index = $slide.SlideIndex; shapes = $slide.Shapes.Count; tables = $tables; charts = $charts; pictures = $pictures; texts = $texts }
  }
  $presentation.SaveAs((Join-Path ${quote(destination)} 'office-rendered.pdf'), 32)
  @{ opened = $true; slideCount = $presentation.Slides.Count; slides = $slides } | ConvertTo-Json -Depth 5 -Compress
} finally {
  if ($presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($application) { $application.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application) }
}
`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 90000 });
if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
console.log(result.stdout.trim());
