#Requires -Version 5.1
<#
  Run vf-overlay after building native/VfOverlay (see native/VfOverlay/README.md).
  Optional: first path under the HTTP web root (default: vkf-scene.html).
  Example: .\scripts\run-vf-ui.ps1 -Page "geom/vf-geom-demo.html"
#>
param(
    [string] $Page = "vkf-scene.html"
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$candidates = @(
    (Join-Path $repo 'native\VfOverlay\build\Release\vf-overlay.exe'),
    (Join-Path $repo 'native\VfOverlay\build\Debug\vf-overlay.exe'),
    (Join-Path $repo 'native\VfOverlay\build\vf-overlay.exe')
)
foreach ($exe in $candidates) {
    if (Test-Path $exe) {
        $webRoot = Join-Path (Split-Path $exe) 'web'
        $rel = $Page -replace '/', [IO.Path]::DirectorySeparatorChar
        $pagePath = Join-Path $webRoot $rel
        if (-not (Test-Path (Join-Path $webRoot 'index.html'))) {
            Write-Warning "Missing web\index.html next to vf-overlay.exe. Build native\VfOverlay (POST_BUILD copies repo web\vf-ui\ here)."
        } elseif ($Page -and -not (Test-Path $pagePath)) {
            Write-Warning "Page not found: $pagePath`nRun: cmake --build native\VfOverlay\build --config Release"
        }
        Push-Location (Split-Path $exe)
        try {
            & $exe $Page
        } finally {
            Pop-Location
        }
        exit $LASTEXITCODE
    }
}
Write-Error "vf-overlay.exe not found. Build native\VfOverlay first (see native\VfOverlay\README.md)."
