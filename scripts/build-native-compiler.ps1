param(
    [string]$OutputDirectory = "build/native-compiler-clang/bin",
    [string[]]$OnlyTargets = @()
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must stay inside the repository"
}

$clang = (Get-Command clang++ -ErrorAction Stop).Source
$jsonSource = Join-Path $repoRoot "native/VfOverlay/vf/json.cpp"
$targetDefinitions = @(
    @{ Name = "vkf"; Source = "compiler/native/vkf_driver_artifact_smoke.cpp"; ExtraSources = @("compiler/native/vkf_x64_artifact.cpp", "compiler/native/vkf_lexer_cursor_smoke.cpp", "compiler/native/vkf_parser_token_stream_smoke.cpp", "compiler/native/vkf_ast_to_ir_smoke.cpp", "compiler/native/vkf_csv_demand_source_scanner.cpp"); Defines = @("-DVKF_X64_BACKEND_LIBRARY", "-DVKF_NATIVE_FRONTEND_LIBRARY"); Json = $true },
    @{ Name = "vkf-strict"; Source = "compiler/native/vkf_driver_artifact_smoke.cpp"; ExtraSources = @("compiler/native/vkf_x64_artifact.cpp", "compiler/native/vkf_lexer_cursor_smoke.cpp", "compiler/native/vkf_parser_token_stream_smoke.cpp", "compiler/native/vkf_ast_to_ir_smoke.cpp", "compiler/native/vkf_csv_demand_source_scanner.cpp"); Defines = @("-DVKF_X64_BACKEND_LIBRARY", "-DVKF_NATIVE_FRONTEND_LIBRARY", "-DVKF_STRICT_DIRECT_ONLY"); Json = $true },
    @{ Name = "vkf_lexer_cursor_smoke"; Source = "compiler/native/vkf_lexer_cursor_smoke.cpp"; Json = $false },
    @{ Name = "vkf_parser_token_stream_smoke"; Source = "compiler/native/vkf_parser_token_stream_smoke.cpp"; Json = $true },
    @{ Name = "vkf_ast_to_ir_smoke"; Source = "compiler/native/vkf_ast_to_ir_smoke.cpp"; ExtraSources = @("compiler/native/vkf_csv_demand_source_scanner.cpp"); Json = $true },
    @{ Name = "vkf_bootstrap_bundle_artifact_smoke"; Source = "compiler/native/vkf_bootstrap_bundle_artifact_smoke.cpp"; Json = $true },
    @{ Name = "vkf_compiler_artifact_smoke"; Source = "compiler/native/vkf_compiler_artifact_smoke.cpp"; Json = $true },
    @{ Name = "vkf_cpp_aot_artifact"; Source = "compiler/native/vkf_cpp_aot_artifact.cpp"; Json = $true },
    @{ Name = "vkf_x64_artifact"; Source = "compiler/native/vkf_x64_artifact.cpp"; Json = $true },
    @{ Name = "vkf_arm64_artifact"; Source = "compiler/native/vkf_arm64_artifact.cpp"; Json = $true },
    @{ Name = "vkf_x64_runner_template"; Source = "compiler/native/vkf_x64_runner_template.cpp"; Json = $false },
    @{ Name = "vkf_wasm_artifact_smoke"; Source = "compiler/native/vkf_wasm_artifact_smoke.cpp"; Json = $true },
    @{ Name = "vkf_symbolic_kernel_artifact"; Source = "compiler/native/vkf_symbolic_kernel_artifact.cpp"; Json = $true },
    @{ Name = "vkf_linalg_factor_x64_test"; Source = "compiler/native/kernels/vkf_linalg_factor_x64_test.cpp"; Json = $false },
    @{ Name = "vkf_webgpu_artifact_smoke"; Source = "compiler/native/vkf_webgpu_artifact_smoke.cpp"; Json = $true }
)

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
foreach ($target in $targetDefinitions) {
    if ($OnlyTargets.Count -gt 0 -and $OnlyTargets -notcontains $target.Name) {
        continue
    }
    $arguments = @(
        "-std=c++17",
        "-O2",
        "-DNDEBUG",
        "-I", $repoRoot,
        "-I", (Join-Path $repoRoot "native/VfOverlay"),
        (Join-Path $repoRoot $target.Source)
    )
    if ($target.ExtraSources) {
        $arguments += @($target.ExtraSources | ForEach-Object { Join-Path $repoRoot $_ })
    }
    if ($target.Defines) {
        $arguments += $target.Defines
    }
    if ($target.Json) {
        $arguments += $jsonSource
    }
    if ($target.Name -eq "vkf_x64_runner_template") {
        $arguments += @(
            "-Xlinker", "/nodefaultlib",
            "-Xlinker", "legacy_stdio_definitions.lib",
            "-Xlinker", "legacy_stdio_wide_specifiers.lib",
            "-Xlinker", "ucrt.lib",
            "-Xlinker", "kernel32.lib"
        )
    }
    $arguments += @("-o", (Join-Path $outputRoot ($target.Name + ".exe")))
    & $clang @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "clang++ failed building $($target.Name)"
    }
}

Write-Output (Join-Path $outputRoot "vkf.exe")
