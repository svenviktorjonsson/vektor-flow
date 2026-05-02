#Requires -Version 5.1
<#
.SYNOPSIS
    Launch the Python-free shared-runtime demo in the native Windows overlay.

.DESCRIPTION
    Starts vf-overlay.exe on vf-shared-rect-demo.html. The overlay hosts the
    static UI assets from its adjacent web\ folder and does not require Chrome,
    Python, or JSON polling for pointer movement.
#>
param(
    [switch]$PrintOnly
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $scriptDir '..')

function Find-Overlay {
    $candidates = @(
        (Join-Path $repo 'native\VfOverlay\build\Release\vf-overlay.exe'),
        (Join-Path $repo 'native\VfOverlay\build\Debug\vf-overlay.exe'),
        (Join-Path $repo 'native\VfOverlay\build\vf-overlay.exe'),
        (Join-Path $repo 'vf-overlay.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw "vf-overlay.exe not found. Build native\VfOverlay first or run from a windows-overlay bundle."
}

function Sync-WebAssets {
    param([string]$OverlayExe)
    $exeDir = Split-Path $OverlayExe
    $webDir = Join-Path $exeDir 'web'
    $sourceWeb = Join-Path $repo 'web\vf-ui'

    if (-not (Test-Path $sourceWeb)) {
        return
    }
    if (Test-Path $webDir) {
        Remove-Item -Recurse -Force $webDir
    }
    Copy-Item -Recurse $sourceWeb $webDir
}

$overlayExe = Find-Overlay
Sync-WebAssets $overlayExe
$overlayDir = Split-Path $overlayExe
$page = 'vf-shared-rect-demo.html'

if (-not (Test-Path (Join-Path $overlayDir "web\$page"))) {
    throw "Cannot find web\$page next to vf-overlay.exe."
}

if ($PrintOnly) {
    Write-Host $overlayExe
    Write-Host $page
    exit 0
}

Start-Process -FilePath $overlayExe -ArgumentList $page -WorkingDirectory $overlayDir
Write-Host "Launched Python-free shared-runtime overlay demo:"
Write-Host "  $overlayExe $page"
