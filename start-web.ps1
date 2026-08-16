param(
    [string]$DataRoot = "data/desktop-mvp",
    [string]$Database = "oeydesign.sqlite",
    [string]$DependencyImage = "spikes/e8-e12-framework/node_modules",
    [int]$Port = 8765
)

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonPath = Join-Path $repoRoot ".venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    $pythonPath = "python"
}

$dependencyPath = $DependencyImage
if (-not [System.IO.Path]::IsPathRooted($dependencyPath)) {
    $dependencyPath = Join-Path $repoRoot $dependencyPath
}
if (-not (Test-Path -LiteralPath $dependencyPath -PathType Container)) {
    throw "Frozen dependency image was not found: $dependencyPath"
}
$dependencyPath = (Resolve-Path -LiteralPath $dependencyPath).Path

Push-Location $repoRoot
try {
    $env:PYTHONPATH = Join-Path $repoRoot "src"
    & $pythonPath -m oeydesign.product_shell `
        --data-root $DataRoot `
        --database $Database `
        --dependency-image $dependencyPath `
        --port $Port
    $webExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $webExitCode
