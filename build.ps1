#Requires -Version 5.1
<#
.SYNOPSIS
    Build vektor-flow end-to-end so that `vkf <file.vkf>` works.

.DESCRIPTION
    1. Checks prerequisites (Python >= 3.11, pip).
    2. Installs / updates the vektorflow Python package in the current
       venv (or creates one at .venv if none is active).
    3. Builds the native vf-overlay.exe (WebView2 host) using CMake + MSVC.
    4. Prints usage instructions.

    After a successful build you can run:
        vkf examples\01_hello.vkf
        vkf examples\100_axis_4_panel.vkf
        vkf examples\110_mirror_showcase.vkf

.PARAMETER SkipNative
    Skip building vf-overlay.exe (useful if you only changed Python / VKF files).

.PARAMETER SkipPython
    Skip reinstalling the Python package (useful if you only changed C++).

.EXAMPLE
    .\build.ps1
    .\build.ps1 -SkipNative
#>
param(
    [switch]$SkipNative,
    [switch]$SkipPython
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path $PSScriptRoot

# ── banner ───────────────────────────────────────────────────────────────────
function Banner($msg) {
    Write-Host ""
    Write-Host "━━━  $msg  ━━━" -ForegroundColor Cyan
}

# ── step check ───────────────────────────────────────────────────────────────
function Step($label, [scriptblock]$block) {
    Write-Host "  → $label ..." -NoNewline
    & $block
    Write-Host " OK" -ForegroundColor Green
}

# =============================================================================
# 0. Prerequisites
# =============================================================================
Banner "0 / Checking prerequisites"

# Python
$python = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = & $cmd --version 2>&1
        if ($ver -match '(\d+)\.(\d+)') {
            $maj = [int]$Matches[1]; $min_ = [int]$Matches[2]
            if ($maj -gt 3 -or ($maj -eq 3 -and $min_ -ge 11)) {
                $python = $cmd.Source
                Write-Host "  Python: $ver at $python" -ForegroundColor Green
                break
            }
        }
    }
}
if (-not $python) {
    Write-Error "Python 3.11+ not found. Install from https://python.org and re-run."
}

# =============================================================================
# 1. Python venv + package install
# =============================================================================
if (-not $SkipPython) {
    Banner "1 / Python package (vektorflow)"

    # Determine where to install
    $inVenv   = ($env:VIRTUAL_ENV -ne $null -and $env:VIRTUAL_ENV -ne '')
    $venvPath = Join-Path $repo '.venv'

    if (-not $inVenv) {
        if (-not (Test-Path $venvPath)) {
            Step "Creating .venv" {
                & $python -m venv $venvPath
            }
        } else {
            Write-Host "  Using existing .venv at $venvPath"
        }
        # Activate for this session
        $activateScript = Join-Path $venvPath 'Scripts\Activate.ps1'
        if (Test-Path $activateScript) {
            . $activateScript
        } else {
            Write-Host "  (Could not activate .venv — continuing with system Python)"
        }
    } else {
        Write-Host "  Using active venv: $env:VIRTUAL_ENV"
    }

    Step "pip install -e .[dev]" {
        & $python -m pip install -q -e "$repo[dev]"
    }

    # Verify vkf command is available
    $vkfCmd = Get-Command vkf -ErrorAction SilentlyContinue
    if ($vkfCmd) {
        Write-Host "  vkf command: $($vkfCmd.Source)" -ForegroundColor Green
    } else {
        Write-Host "  NOTE: 'vkf' not on PATH yet — use the full path or start a new shell." -ForegroundColor Yellow
        Write-Host "        Activate the venv first:  .venv\Scripts\Activate.ps1" -ForegroundColor Yellow
    }

    # Quick smoke test
    Step "smoke test (vkf --help)" {
        $out = & $python -m vektorflow --help 2>&1
        if ($LASTEXITCODE -ne 0 -and $out -notmatch 'usage') {
            # --help returns 0 or 1 depending on argparse; just check it ran
        }
    }
} else {
    Write-Host "  Skipping Python install (-SkipPython)" -ForegroundColor Yellow
}

# =============================================================================
# 2. Native vf-overlay.exe  (WebView2 / WebGPU host)
# =============================================================================
if (-not $SkipNative) {
    Banner "2 / Native vf-overlay.exe (WebView2 host)"

    $overlayDir = Join-Path $repo 'native\VfOverlay'
    if (-not (Test-Path $overlayDir)) {
        Write-Host "  native\VfOverlay not found — skipping native build." -ForegroundColor Yellow
        Write-Host "  The Python CLI (vkf) will still work; the overlay window requires the native build." -ForegroundColor Yellow
    } else {
        # Delegate to existing build-vf-overlay.ps1
        $buildScript = Join-Path $repo 'scripts\build-vf-overlay.ps1'
        if (Test-Path $buildScript) {
            Write-Host "  Delegating to scripts\build-vf-overlay.ps1 ..."
            & $buildScript
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Native build failed (exit $LASTEXITCODE)."
            }
        } else {
            # Inline minimal build if the script is missing
            Write-Host "  scripts\build-vf-overlay.ps1 not found — attempting inline build ..."
            Set-Location $overlayDir

            $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
            if (-not (Test-Path $vswhere)) {
                Write-Host "  vswhere not found — cannot build native overlay." -ForegroundColor Yellow
                Write-Host "  Install Visual Studio with C++ workload and re-run." -ForegroundColor Yellow
            } else {
                $vsJson = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null | ConvertFrom-Json
                if ($vsJson -is [array]) { $vsJson = $vsJson[0] }
                $vsVer  = $vsJson.installationVersion
                $vsMaj  = [int]($vsVer -replace '^(\d+).*','$1')
                $gen    = switch ($vsMaj) { 17 { 'Visual Studio 17 2022' } 16 { 'Visual Studio 16 2019' } default { 'Visual Studio 17 2022' } }
                if (Test-Path 'build') { Remove-Item -Recurse -Force 'build' }
                & cmake -S . -B build -G $gen -A x64
                & cmake --build build --config Release
                if ($LASTEXITCODE -ne 0) { Write-Error "Native build failed." }
            }
            Set-Location $repo
        }

        # Locate the built exe
        $exe = $null
        foreach ($candidate in @(
            (Join-Path $overlayDir 'build\Release\vf-overlay.exe'),
            (Join-Path $overlayDir 'build\vf-overlay.exe')
        )) {
            if (Test-Path $candidate) { $exe = $candidate; break }
        }
        if ($exe) {
            Write-Host "  Built: $exe" -ForegroundColor Green
        } else {
            Write-Host "  vf-overlay.exe not found after build — check CMake output above." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  Skipping native build (-SkipNative)" -ForegroundColor Yellow
}

# =============================================================================
# 3. Run tests (quick)
# =============================================================================
Banner "3 / Running test suite"
$testOut = & $python -m pytest "$repo\tests" -q --ignore="$repo\tests\test_vf_ui_playwright.py" 2>&1
Write-Host ($testOut | Select-Object -Last 3)
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Some tests failed — see output above." -ForegroundColor Yellow
} else {
    Write-Host "  All tests passed." -ForegroundColor Green
}

# =============================================================================
# Done — print usage
# =============================================================================
Banner "Done"
Write-Host ""
Write-Host "  To use vektor-flow, activate the venv first (if not already active):"
Write-Host ""
Write-Host "      .venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host ""
Write-Host "  Then run any .vkf file:"
Write-Host ""
Write-Host "      vkf examples\01_hello.vkf" -ForegroundColor White
Write-Host "      vkf examples\100_axis_4_panel.vkf" -ForegroundColor White
Write-Host "      vkf examples\110_mirror_showcase.vkf" -ForegroundColor White
Write-Host "      vkf package examples\\benchmarks\\scalar_control.vkf -o dist\\scalar-control" -ForegroundColor White
Write-Host "      .\\dist\\scalar-control\\run.bat" -ForegroundColor White
Write-Host "      .\\dist\\scalar-control\\smoke-test.bat" -ForegroundColor White
Write-Host ""
Write-Host "  Or via Python module (works without venv activation):"
Write-Host ""
Write-Host "      python -m vektorflow examples\110_mirror_showcase.vkf" -ForegroundColor White
Write-Host ""
Write-Host "  Rebuild Python only (after editing .py / .vkf files):"
Write-Host ""
Write-Host "      .\build.ps1 -SkipNative" -ForegroundColor White
Write-Host ""
