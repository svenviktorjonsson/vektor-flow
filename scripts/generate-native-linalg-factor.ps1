param(
    [string]$Clang = "clang++",
    [string]$Linker = "lld-link",
    [string]$ReadObject = "llvm-readobj"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo "compiler/native/kernels/vkf_linalg_factor_x64.cpp"
$header = Join-Path $repo "compiler/native/kernels/vkf_linalg_factor_x64_bytes.hpp"
$temporary = Join-Path $repo ".work/linalg-factor-kernel"
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
$object = Join-Path $temporary "factor.obj"
$image = Join-Path $temporary "factor.exe"

& $Clang -std=c++17 -O3 -mavx2 -mfma -ffast-math -fno-builtin `
    -fno-exceptions -fno-rtti -fno-asynchronous-unwind-tables `
    -c $source -o $object
if ($LASTEXITCODE -ne 0) { throw "Clang failed to compile the linalg kernel" }

& $Linker /entry:vkf_cholesky_x64 /subsystem:console /nodefaultlib /fixed `
    /opt:noref /merge:.rdata=.text /section:.text,ER `
    /export:vkf_solve_x64 /export:vkf_solve_96_x64 `
    /export:vkf_cholesky_x64 /export:vkf_cholesky_96_x64 `
    /export:vkf_lu_x64 /export:vkf_lu_96_x64 `
    /export:vkf_least_squares_x64 /out:$image $object
if ($LASTEXITCODE -ne 0) { throw "LLD failed to link the linalg kernel" }

$exports = & $ReadObject --coff-exports $image
if ($LASTEXITCODE -ne 0) { throw "llvm-readobj failed" }
$entries = @{}
$current = $null
foreach ($line in $exports) {
    if ($line -match '^\s*Name:\s+(\S+)') { $current = $Matches[1] }
    if ($current -and $line -match '^\s*RVA:\s+0x([0-9A-Fa-f]+)') {
        $entries[$current] = [Convert]::ToInt32($Matches[1], 16)
        $current = $null
    }
}
$required = @(
    "vkf_solve_x64", "vkf_solve_96_x64",
    "vkf_cholesky_x64", "vkf_cholesky_96_x64", "vkf_lu_x64",
    "vkf_lu_96_x64", "vkf_least_squares_x64"
)
foreach ($name in $required) {
    if (-not $entries.ContainsKey($name)) { throw "Missing kernel export $name" }
}
$textRva = ($required | ForEach-Object { $entries[$_] } |
    Measure-Object -Minimum).Minimum

$sections = & $ReadObject --sections $image
if ($LASTEXITCODE -ne 0) { throw "llvm-readobj failed to inspect sections" }
$inText = $false
$textSize = $null
$textOffset = $null
foreach ($line in $sections) {
    if ($line -match '^\s*Name:\s+\.text\s') { $inText = $true; continue }
    if ($inText -and $line -match '^\s*VirtualSize:\s+0x([0-9A-Fa-f]+)') {
        $textSize = [Convert]::ToInt32($Matches[1], 16)
    }
    if ($inText -and $line -match '^\s*PointerToRawData:\s+0x([0-9A-Fa-f]+)') {
        $textOffset = [Convert]::ToInt32($Matches[1], 16)
        break
    }
}
if ($null -eq $textSize -or $null -eq $textOffset) { throw "Could not locate raw .text data" }
$imageBytes = [IO.File]::ReadAllBytes($image)
$bytes = [byte[]]::new($textSize)
[Array]::Copy($imageBytes, $textOffset, $bytes, 0, $textSize)
if ($bytes[0] -eq 0x4d -and $bytes[1] -eq 0x5a) { throw "Extracted PE header instead of .text" }
$lines = [Collections.Generic.List[string]]::new()
for ($offset = 0; $offset -lt $bytes.Length; $offset += 16) {
    $last = [Math]::Min($offset + 15, $bytes.Length - 1)
    $encoded = ($bytes[$offset..$last] | ForEach-Object { "0x{0:x2}" -f $_ }) -join ", "
    $lines.Add("    $encoded,")
}

$content = @"
#pragma once

#include <array>
#include <cstddef>

namespace vkf::native_kernels {

inline constexpr std::size_t linalg_factor_cholesky_entry = $($entries["vkf_cholesky_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_cholesky_96_entry = $($entries["vkf_cholesky_96_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_solve_entry = $($entries["vkf_solve_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_solve_96_entry = $($entries["vkf_solve_96_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_lu_entry = $($entries["vkf_lu_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_lu_96_entry = $($entries["vkf_lu_96_x64"] - $textRva)u;
inline constexpr std::size_t linalg_factor_least_squares_entry = $($entries["vkf_least_squares_x64"] - $textRva)u;
inline constexpr std::array<unsigned char, $($bytes.Length)> linalg_factor_x64_windows = {
$($lines -join "`n")
};

}  // namespace vkf::native_kernels
"@
[IO.File]::WriteAllText($header, $content.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
Write-Host "Generated $header ($($bytes.Length) bytes)"
