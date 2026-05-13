#Requires -Version 5.1
<#
  Configure and build native\VfOverlay\vf-overlay.exe.
  Picks the CMake Visual Studio generator that matches your install (e.g. VS 2019 Build Tools →
  "Visual Studio 16 2019", not "Visual Studio 17 2022"). Passing CMAKE_GENERATOR_INSTANCE for the
  wrong year causes: "could not find specified instance ... no version= field was given".
#>
param(
    [switch]$SkipBundle
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$overlay = Join-Path $repo 'native\VfOverlay'
if (-not (Test-Path $overlay)) {
    Write-Error "Missing folder: native\VfOverlay (e.g. after deleting native\). Restore native\VfOverlay from the repo: `git checkout HEAD -- native/` or copy the folder back from backup."
}
Set-Location $overlay

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
    Write-Error "vswhere.exe not found. Install Visual Studio or Build Tools for Visual Studio (C++ workload)."
}

$raw = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null
if (-not $raw) {
    $raw = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.VCTools -format json 2>$null
}
if (-not $raw) {
    $raw = & $vswhere -latest -products * -format json 2>$null
}
$vs = $null
if ($raw) {
    $json = $raw | ConvertFrom-Json
    if ($json -is [System.Array]) { $json = $json[0] }
    if ($json.installationPath) {
        $vs = [PSCustomObject]@{
            Path    = $json.installationPath
            Version = $json.installationVersion
        }
    }
}
if (-not $vs) {
    Write-Error "No Visual Studio installation found. Install VS or Build Tools with Desktop development with C++."
}

Write-Host "VS installation: $($vs.Path)"
Write-Host "VS version: $($vs.Version)"

$major = 0
if ($vs.Version -match '^(\d+)') {
    $major = [int]$Matches[1]
}
if ($major -eq 0) {
    if ($vs.Path -match '\\2019\\') { $major = 16 }
    elseif ($vs.Path -match '\\2022\\') { $major = 17 }
}

# Generator name must match the product line (16 = VS 2019 / Build Tools 2019, 17 = VS 2022, …).
$generator = $null
switch ($major) {
    { $_ -ge 18 } {
        $generator = 'Visual Studio 18 2026'
        break
    }
    17 {
        $generator = 'Visual Studio 17 2022'
        break
    }
    16 {
        $generator = 'Visual Studio 16 2019'
        break
    }
    default {
        if ($major -ge 15) {
            $generator = 'Visual Studio 16 2019'
        }
    }
}

if (-not $generator) {
    Write-Error "Unsupported installationVersion major=$major from $($vs.Version). Need MSVC (VS 2017 or newer)."
}

Write-Host "CMake generator: $generator"

if (Test-Path 'build') {
    Remove-Item -Recurse -Force 'build'
}

# Prefer configure without INSTANCE (works when CMake sees the right generator for this install).
& cmake -S . -B build -G $generator -A x64
$ok = ($LASTEXITCODE -eq 0)

if (-not $ok) {
    if (Test-Path 'build') { Remove-Item -Recurse -Force 'build' }
    Write-Host "Retrying with CMAKE_GENERATOR_INSTANCE=$($vs.Path) ..."
    & cmake -S . -B build -G $generator -A x64 "-DCMAKE_GENERATOR_INSTANCE=$($vs.Path)"
    $ok = ($LASTEXITCODE -eq 0)
}

# VS18 generator may be missing on older CMake; fall back.
if (-not $ok -and $generator -eq 'Visual Studio 18 2026') {
    if (Test-Path 'build') { Remove-Item -Recurse -Force 'build' }
    Write-Host "Falling back to Visual Studio 17 2022 ..."
    $generator = 'Visual Studio 17 2022'
    & cmake -S . -B build -G $generator -A x64 "-DCMAKE_GENERATOR_INSTANCE=$($vs.Path)"
    $ok = ($LASTEXITCODE -eq 0)
}

if (-not $ok) {
    $vcvars = Join-Path $vs.Path 'VC\Auxiliary\Build\vcvars64.bat'
    $ninja = Get-Command ninja -ErrorAction SilentlyContinue
    if ((Test-Path $vcvars) -and $ninja) {
        Write-Host "Trying Ninja + MSVC (vcvars64)..."
        $od = (Get-Location).Path
        cmd /c "call `"$vcvars`" && cd /d `"$od`" && cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK: $(Join-Path $overlay 'build\vf-overlay.exe')"
            exit 0
        }
    }
    Write-Error "cmake configure failed. Install a matching CMake (supports $generator) or open Developer PowerShell for your VS and run cmake from there."
}

& cmake --build build --config Release --target vf-overlay
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$out = Join-Path $overlay 'build\Release\vf-overlay.exe'
if (-not (Test-Path $out)) {
    $out = Join-Path $overlay 'build\vf-overlay.exe'
}
Write-Host "OK: $out"

if (-not $SkipBundle) {
    $outDir = Split-Path $out -Parent
    $distRoot = Join-Path $overlay 'build\dist'
    $bundleDir = Join-Path $distRoot 'vf-overlay-win64'
    $zipPath = Join-Path $distRoot 'vf-overlay-win64.zip'
    $manifestPath = Join-Path $bundleDir 'bundle-manifest.json'
    $launcherPath = Join-Path $bundleDir 'launch-vf-overlay.cmd'
    $requiredBundleItems = @(
        'vf-overlay.exe',
        'web'
    )
    $optionalBundleItems = @(
        'vf-overlay.exe.WebView2'
    )

    if (Test-Path $bundleDir) {
        Remove-Item -Recurse -Force $bundleDir
    }
    New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

    foreach ($item in $requiredBundleItems) {
        $source = Join-Path $outDir $item
        if (-not (Test-Path $source)) {
            Write-Error "Bundle step missing required runtime asset: $source"
        }
        Copy-Item -Recurse -Force $source $bundleDir
    }

    foreach ($item in $optionalBundleItems) {
        $source = Join-Path $outDir $item
        if (Test-Path $source) {
            Copy-Item -Recurse -Force $source $bundleDir
        }
    }

    @'
@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0vf-overlay.exe"
'@ | Set-Content -Path $launcherPath -Encoding ASCII

    $bundleFiles = Get-ChildItem -Path $bundleDir -Recurse -File | ForEach-Object {
        [PSCustomObject]@{
            path = $_.FullName.Substring($bundleDir.Length + 1).Replace('\', '/')
            size = $_.Length
        }
    }
    $manifest = [ordered]@{
        bundleName = 'vf-overlay-win64'
        platform = 'windows-x64'
        entryExe = 'vf-overlay.exe'
        launchFromBundleRoot = '.\vf-overlay.exe'
        launcher = 'launch-vf-overlay.cmd'
        webRoot = 'web'
        runtimeArtifacts = [ordered]@{
            uiShell = 'web/index.html'
            defaultRuntimePackets = 'web/vf-runtime-packets.json'
            sessionRuntimePacketsGlob = 'web/sessions/*/vf-runtime-packets.json'
        }
        runtimeContract = [ordered]@{
            overlayConsumesRuntimePacketsFrom = '/api/runtime-packets and web/vf-runtime-packets.json'
            overlayExposesInputPacketsAt = '/api/runtime-packets/input'
        }
        builtAtUtc = [DateTime]::UtcNow.ToString('o')
        webView2LoaderSidecarIncluded = (Test-Path (Join-Path $bundleDir 'vf-overlay.exe.WebView2'))
        runtimeRequirements = @(
            'Microsoft Edge WebView2 Runtime installed on target machine'
        )
        files = $bundleFiles
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

    if (Test-Path $zipPath) {
        Remove-Item -Force $zipPath
    }
    Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host "Bundle folder: $bundleDir"
    Write-Host "Bundle zip:    $zipPath"
}
