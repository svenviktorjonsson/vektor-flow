#Requires -Version 5.1
# One command from repo root: editable install, vf-overlay (re)build, run screen demo.
# Forwards all args to scripts\run-screen-demo.ps1 (e.g. -Full for clean CMake configure).
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
& (Join-Path $here 'scripts\run-screen-demo.ps1') @args
exit $LASTEXITCODE
