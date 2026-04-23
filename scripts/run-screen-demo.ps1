#Requires -Version 5.1
<#
  Single end-to-end command: editable install, vf-overlay build, run examples/screen_demo.vkf.
  From repo root you can also run:  .\rebuild-and-run-demo.ps1  (forwards here).

  vf-overlay serves `web/` next to `vf-overlay.exe` (POST_BUILD copy from `web/vf-ui`).

  Usage (repo root):
    .\rebuild-and-run-demo.ps1
    .\scripts\run-screen-demo.ps1              # same pipeline
    .\scripts\run-screen-demo.ps1 -Full        # full clean configure+build (after CMake/VS changes)
    .\scripts\run-screen-demo.ps1 -SkipBuild  # only pip + python (avoid; stale UI after web/native edits)

  Default: always rebuild the native target (incremental if possible) + run the demo. No manual steps.
#>
param(
  [switch]$Full,
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repo

function Invoke-VfOverlayBuild {
  param([bool]$DoFull)
  $overlay = Join-Path $repo 'native\VfOverlay'
  if (-not (Test-Path $overlay)) {
    Write-Error "Missing native\VfOverlay. Clone or restore the native tree."
  }
  $cache = Join-Path $overlay 'build\CMakeCache.txt'
  if ($DoFull -or -not (Test-Path $cache)) {
    $buildScript = Join-Path $repo 'scripts\build-vf-overlay.ps1'
    & $buildScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  else {
    Write-Host "Incremental: cmake --build (copies web/vf-ui -> build output) ..."
    Push-Location $overlay
    try {
      & cmake --build build --config Release
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      Pop-Location
    }
  }
}

Write-Host "pip: editable install of vektorflow from repo root ..."
& python -m pip install -e $repo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipBuild) {
  Invoke-VfOverlayBuild -DoFull($Full)
} else {
  Write-Warning "SkipBuild: vf-overlay's web/ folder may be stale. Use default or -Full for a reliable UI."
}

$demo = Join-Path $repo 'examples\screen_demo.vkf'
Write-Host "Run: python -m vektorflow.cli $demo"
& python -m vektorflow.cli $demo
exit $LASTEXITCODE
