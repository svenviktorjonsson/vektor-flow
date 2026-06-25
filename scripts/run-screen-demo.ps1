#Requires -Version 5.1
<#
  Single end-to-end command: vf-overlay build + run examples/110_mirror_showcase.vkf.
  Runtime execution uses native executables.

  From repo root you can also run:  .\rebuild-and-run-demo.ps1  (forwards here).

  vf-overlay serves `web/` next to `vf-overlay.exe` (POST_BUILD copy from `web/vf-ui`).

  Usage (repo root):
    .\rebuild-and-run-demo.ps1
    .\scripts\run-screen-demo.ps1                   # same pipeline
    .\scripts\run-screen-demo.ps1 -Full             # full clean configure+build (after CMake/VS changes)
    .\scripts\run-screen-demo.ps1 -SkipBuild        # skip vf-overlay rebuild only
    .\scripts\run-screen-demo.ps1 -NoWait           # launch and return immediately

  Default: build native target when needed (incremental if possible), then run with
  native `vkf` runtime.
#>
param(
  [switch]$Full,
  [switch]$SkipBuild,
  [switch]$NoWait
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repo

function Find-VfOverlayExecutable {
  $candidates = @(
    (Join-Path $repo 'native\VfOverlay\build\Release\vf-overlay.exe'),
    (Join-Path $repo 'native\VfOverlay\build\Debug\vf-overlay.exe'),
    (Join-Path $repo 'native\VfOverlay\build\vf-overlay.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }
  return $null
}

function Format-Elapsed {
  param([System.Diagnostics.Stopwatch]$Timer)

  if ($Timer.Elapsed.TotalSeconds -ge 1.0) {
    return ('{0:n2}s' -f $Timer.Elapsed.TotalSeconds)
  }
  return ('{0:n0}ms' -f $Timer.Elapsed.TotalMilliseconds)
}

function Sync-VfOverlayWebAssets {
  param([string]$OverlayExe)

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  if (-not $OverlayExe) {
    Write-Error "Cannot sync vf-overlay web assets: vf-overlay.exe is missing."
  }
  $source = Join-Path $repo 'web\vf-ui'
  $dest = Join-Path (Split-Path $OverlayExe) 'web'
  if (-not (Test-Path $source)) {
    Write-Error "Missing vf-ui source assets: $source"
  }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $stamp = Join-Path $dest '.vf-ui-sync-head'
  $head = ''
  try {
    $head = (& git -C $repo rev-parse HEAD 2>$null).Trim()
  } catch {
    $head = ''
  }
  $dirtyAssetPaths = @()
  try {
    $statusLines = & git -C $repo status --porcelain -- web/vf-ui 2>$null
    foreach ($line in $statusLines) {
      if (-not $line -or $line.Length -lt 4) {
        continue
      }
      $path = $line.Substring(3).Trim()
      if ($path.Contains(' -> ')) {
        $path = ($path -split ' -> ')[-1].Trim()
      }
      $path = $path.Trim('"')
      if ($path.StartsWith('web/vf-ui/') -or $path.StartsWith('web\vf-ui\')) {
        $dirtyAssetPaths += $path
      }
    }
  } catch {
    $dirtyAssetPaths = @()
  }
  if ($dirtyAssetPaths.Count -gt 0) {
    Write-Host "Fast sync: copying $($dirtyAssetPaths.Count) changed vf-ui asset(s)."
    foreach ($rel in ($dirtyAssetPaths | Sort-Object -Unique)) {
      $srcFile = Join-Path $repo $rel
      $assetRel = $rel.Substring('web/vf-ui/'.Length).Replace('/', '\')
      $dstFile = Join-Path $dest $assetRel
      if (Test-Path $srcFile) {
        New-Item -ItemType Directory -Force -Path (Split-Path $dstFile) | Out-Null
        Copy-Item -LiteralPath $srcFile -Destination $dstFile -Force
      } elseif (Test-Path $dstFile) {
        Remove-Item -LiteralPath $dstFile -Force
      }
    }
    $timer.Stop()
    Write-Host "Timing: vf-ui asset sync $(Format-Elapsed $timer)"
    return
  }
  if ($head -and (Test-Path $stamp) -and ((Get-Content -LiteralPath $stamp -Raw).Trim() -eq $head)) {
    Write-Host "Fast sync: vf-ui assets already current."
    $timer.Stop()
    Write-Host "Timing: vf-ui asset sync $(Format-Elapsed $timer)"
    return
  }
  Write-Host "Full sync: web/vf-ui -> $dest"
  & robocopy $source $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    exit $LASTEXITCODE
  }
  $global:LASTEXITCODE = 0
  if ($head) {
    Set-Content -LiteralPath $stamp -Value $head -NoNewline
  }
  $timer.Stop()
  Write-Host "Timing: vf-ui asset sync $(Format-Elapsed $timer)"
}

function Test-VfOverlayNativeBuildNeeded {
  param([string]$OverlayExe)

  if (-not $OverlayExe -or -not (Test-Path $OverlayExe)) {
    return $true
  }
  $requiredExecutables = @(
    (Join-Path $repo 'native\VfOverlay\build\Release\vkf.exe'),
    (Join-Path $repo 'native\VfOverlay\build\Release\vkf-runner.exe')
  )
  foreach ($requiredExecutable in $requiredExecutables) {
    if (-not (Test-Path $requiredExecutable)) {
      return $true
    }
  }
  $overlay = Join-Path $repo 'native\VfOverlay'
  $exeTime = @(
    (Get-Item $OverlayExe).LastWriteTimeUtc,
    (Get-Item $requiredExecutables[0]).LastWriteTimeUtc,
    (Get-Item $requiredExecutables[1]).LastWriteTimeUtc
  ) | Sort-Object | Select-Object -First 1
  $nativeSources = Get-ChildItem -LiteralPath $overlay -Recurse -File | Where-Object {
    $_.FullName -notlike '*\build\*' -and (
      $_.Extension -in @('.cpp', '.hpp', '.h', '.rc', '.ico') -or
      $_.Name -eq 'CMakeLists.txt'
    )
  }
  foreach ($source in $nativeSources) {
    if ($source.LastWriteTimeUtc -gt $exeTime) {
      return $true
    }
  }
  return $false
}

function Invoke-VfOverlayBuild {
  param([bool]$DoFull)

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
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
  $timer.Stop()
  Write-Host "Timing: native vf-overlay build $(Format-Elapsed $timer)"
}

function Find-NativeVkfExecutable {
  $candidates = @(
    (Join-Path $repo 'native\VfOverlay\build\Release\vkf.exe'),
    (Join-Path $repo 'native\VfOverlay\build\Debug\vkf.exe'),
    (Join-Path $repo 'native\VfOverlay\build\vkf.exe'),
    (Join-Path $repo 'dist\releases\windows-overlay\vkf.exe'),
    (Join-Path $repo 'dist\releases\windows-overlay\vkf')
  )

  foreach ($candidate in $candidates) {
    if (-not $candidate) {
      continue
    }
    if (Test-Path $candidate) {
      $full = (Resolve-Path $candidate).Path
      if ($full.ToLower().EndsWith('.exe')) {
        return $full
      }
    }
  }
  return $null
}

function Invoke-DemoRun {
  param(
    [string]$Runtime,
    [string]$Demo,
    [bool]$LaunchAndReturn
  )

  Write-Host "Run: $Demo"

  if (-not $Runtime) {
    Write-Error "No executable runtime to run this demo."
  }

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  if ($LaunchAndReturn) {
    $quotedDemo = '"' + ($Demo -replace '"', '\"') + '"'
    $process = Start-Process -FilePath $Runtime -ArgumentList $quotedDemo -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $timer.Stop()
    Write-Host "Launch: pid=$($process.Id)"
    Write-Host "Timing: launch $(Format-Elapsed $timer)"
    return 0
  }

  & $Runtime $Demo
  $timer.Stop()
  Write-Host "Timing: run returned after $(Format-Elapsed $timer)"
  return $LASTEXITCODE
}

$overlayExe = Find-VfOverlayExecutable
if ($SkipBuild) {
  Sync-VfOverlayWebAssets -OverlayExe $overlayExe
} elseif ($Full -or (Test-VfOverlayNativeBuildNeeded -OverlayExe $overlayExe)) {
  Invoke-VfOverlayBuild -DoFull($Full)
} else {
  Write-Host "Fast path: native vf-overlay is current; skipping CMake build."
  Sync-VfOverlayWebAssets -OverlayExe $overlayExe
}

$demo = Join-Path $repo 'examples\110_mirror_showcase.vkf'
if (-not (Test-Path $demo)) {
  Write-Error "Demo missing: $demo"
}

$runtime = Find-NativeVkfExecutable
if (-not $runtime) {
  Write-Error "No native vkf executable found.
Build native\VfOverlay target vkf first. Python vkf shims are intentionally ignored.
"
}

$env:VKF_RUNTIME_BACKEND = 'native'
Write-Host "Runtime mode: native-first (VKF_RUNTIME_BACKEND=$($env:VKF_RUNTIME_BACKEND))"
Invoke-DemoRun -Runtime $runtime -Demo $demo -LaunchAndReturn([bool]$NoWait)
exit $LASTEXITCODE
