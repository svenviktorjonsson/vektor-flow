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

  Default: build native target when needed (incremental if possible), then run with
  native `vkf` runtime.
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

function Find-NativeVkfExecutable {
  $candidateFromCommand = $null
  $vkfExeCommand = Get-Command vkf.exe -ErrorAction SilentlyContinue
  if ($vkfExeCommand -and $vkfExeCommand.Source) {
    $candidateFromCommand = $vkfExeCommand.Source
  } else {
    $vkfCommand = Get-Command vkf -ErrorAction SilentlyContinue
    if ($vkfCommand -and $vkfCommand.Source) {
      $candidateFromCommand = $vkfCommand.Source
    }
  }

  $candidates = @(
    (Join-Path $repo 'dist\releases\windows-overlay\vkf.exe'),
    (Join-Path $repo 'dist\releases\windows-overlay\vkf'),
    $candidateFromCommand
  )

  foreach ($candidate in $candidates) {
    if (-not $candidate) {
      continue
    }
    if ($candidate.ToLower().EndsWith('.exe') -or Test-Path $candidate) {
      if (Test-Path $candidate) {
        $full = (Resolve-Path $candidate).Path
      } else {
        $full = $candidate
      }
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
    [string]$Demo
  )

  Write-Host "Run: $Demo"

  if (-not $Runtime) {
    Write-Error "No executable runtime to run this demo."
  }

  & $Runtime $Demo
  return $LASTEXITCODE
}

if (-not $SkipBuild) {
  Invoke-VfOverlayBuild -DoFull($Full)
} else {
  Write-Warning "SkipBuild: vf-overlay's web/ folder may be stale. Use default or -Full for a reliable UI."
}

$demo = Join-Path $repo 'examples\110_mirror_showcase.vkf'
if (-not (Test-Path $demo)) {
  Write-Error "Demo missing: $demo"
}

$runtime = Find-NativeVkfExecutable
if (-not $runtime) {
  Write-Error "No native vkf executable found.
Build/install a native package that provides vkf.exe/vkf in PATH, then run again.
"
}

$env:VKF_RUNTIME_BACKEND = 'native'
Write-Host "Runtime mode: native-first (VKF_RUNTIME_BACKEND=$($env:VKF_RUNTIME_BACKEND))"
Invoke-DemoRun -Runtime $runtime -Demo $demo
exit $LASTEXITCODE
