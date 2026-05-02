#Requires -Version 5.1
<#
.SYNOPSIS
    Launch the Python-free shared-runtime browser demo.

.DESCRIPTION
    Opens web/vf-ui/vf-shared-rect-demo.html directly from disk with browser
    flags that keep SharedArrayBuffer available. The hot path is browser-local:
    EventArena -> compiled-core contract seam -> TransformArena -> renderer
    adapter. No Python HTTP server or JSON polling is used.
#>
param(
    [string]$Browser,
    [switch]$PrintOnly
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $scriptDir '..')
$demo = Join-Path $repo 'web\vf-ui\vf-shared-rect-demo.html'

if (-not (Test-Path $demo)) {
    $bundleDemo = Join-Path $repo 'vf-ui\vf-shared-rect-demo.html'
    if (Test-Path $bundleDemo) {
        $demo = $bundleDemo
    } else {
        throw "Cannot find vf-shared-rect-demo.html under source web/vf-ui or bundled vf-ui."
    }
}

function Find-Browser {
    param([string]$Requested)
    if ($Requested) {
        $cmd = Get-Command $Requested -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        if (Test-Path $Requested) { return (Resolve-Path $Requested).Path }
        throw "Browser not found: $Requested"
    }

    $candidates = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        'msedge',
        'chrome',
        'chromium'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    throw "No Chromium-family browser found. Install Edge, Chrome, or Chromium, or pass -Browser <path>."
}

$browserExe = Find-Browser $Browser
$url = ([Uri](Resolve-Path $demo).Path).AbsoluteUri
$userDataDir = Join-Path ([System.IO.Path]::GetTempPath()) 'vektor-flow-shared-runtime-demo'

$arguments = @(
    '--new-window',
    '--enable-features=SharedArrayBuffer',
    '--allow-file-access-from-files',
    "--user-data-dir=$userDataDir",
    $url
)

if ($PrintOnly) {
    Write-Host $browserExe
    Write-Host ($arguments -join ' ')
    exit 0
}

Start-Process -FilePath $browserExe -ArgumentList $arguments

Write-Host "Launched Python-free shared-runtime demo:"
Write-Host "  $url"
