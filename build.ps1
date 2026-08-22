#Requires -Version 5.1
param(
    [string]$OutputDirectory = "build/native-compiler-clang/bin",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$builder = Join-Path $repoRoot "scripts/build-native-compiler.ps1"

& $builder -OutputDirectory $OutputDirectory -OnlyTargets @("vkf", "vkf-strict")

$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
$compiler = Join-Path $outputRoot "vkf-strict.exe"

if (-not $SkipTests) {
    & $compiler -t (Join-Path $repoRoot "tests/vkf")
    if ($LASTEXITCODE -ne 0) {
        throw "Native VKF test suite failed"
    }
}

Write-Output (Join-Path $outputRoot "vkf.exe")
