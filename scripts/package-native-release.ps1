param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$BinaryDirectory = "build/native-compiler-clang/bin",
    [string]$OutputDirectory = "dist/releases"
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$binaryRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BinaryDirectory))
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $binaryRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $outputRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BinaryDirectory and OutputDirectory must stay inside the repository"
}

$stageRoot = Join-Path $outputRoot "vektor-flow-windows-x64"
$archivePath = Join-Path $outputRoot "vektor-flow-windows-x64.zip"
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
New-Item -ItemType Directory -Path (Join-Path $stageRoot "bin") -Force | Out-Null

$compilerSource = Join-Path $binaryRoot "vkf-strict.exe"
if (-not (Test-Path -LiteralPath $compilerSource -PathType Leaf)) {
    throw "Missing release compiler: $compilerSource"
}
Copy-Item -LiteralPath $compilerSource -Destination (Join-Path $stageRoot "bin/vkf.exe")

$stdlibTarget = Join-Path $stageRoot "compiler/self_hosted/stdlib"
New-Item -ItemType Directory -Path $stdlibTarget -Force | Out-Null
$directModules = @("math.vkf", "stat.vkf", "random.vkf", "time.vkf", "io.vkf", "collections.vkf", "errors.vkf", "system.vkf", "process.vkf", "capture.vkf")
foreach ($module in $directModules) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "compiler/self_hosted/stdlib/$module") -Destination $stdlibTarget
}

$samplesTarget = Join-Path $stageRoot "samples"
New-Item -ItemType Directory -Path $samplesTarget -Force | Out-Null
foreach ($sample in @("examples/01_hello.vkf", "examples/64_axis_tags_and_broadcast.vkf")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $sample) -Destination $samplesTarget
}
foreach ($document in @("README.md", "INSTALL.md", "TESTING.md")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $document) -Destination $stageRoot
}

$manifest = [ordered]@{
    schema = 1
    name = "Vektor Flow"
    version = $Version
    platform = "windows-x64"
    entrypoint = "bin/vkf.exe"
    test_command = "vkf -t"
    stdlib_modules = @("math", "stat", "random", "time", "io", "collections", "errors", "system", "process", "capture")
    not_included_partial_modules = @("physics", "ui", "symbolic")
    strict_direct = $true
    compatibility_fallback = $false
    runtime_contract = [ordered]@{
        python_required = $false
        cpp_compiler_required = $false
        cpp_runtime_install_required = $false
        assembler_required = $false
    }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stageRoot "vektorflow-release.json") -Encoding utf8

$forbiddenFiles = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Where-Object {
    $_.Extension.ToLowerInvariant() -in @(".c", ".cc", ".cpp", ".cxx", ".py", ".pyc", ".pyd")
}
if ($forbiddenFiles) {
    throw "Strict native bundle contains forbidden compatibility/build sources: $($forbiddenFiles.FullName -join ', ')"
}

$smokeRoot = Join-Path $outputRoot ".installer-smoke"
if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force }
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
$smokeSource = Join-Path $smokeRoot "installed_math.vkf"
@"
m: .math
:: m.tanh(0)
"@ | Set-Content -LiteralPath $smokeSource -Encoding utf8

Push-Location $smokeRoot
try {
    $compiler = Join-Path $stageRoot "bin/vkf.exe"
    $buildOutput = & $compiler -b $smokeSource
    $programPath = [System.IO.Path]::ChangeExtension($smokeSource, ".exe")
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $programPath) -or
        ($buildOutput -join "`n") -notmatch "^Built ") {
        throw "Packaged compiler did not build the requested executable"
    }
    if (Test-Path -LiteralPath (Join-Path $smokeRoot ".vkfbuild")) {
        throw "Packaged compiler exposed an internal build directory"
    }
    $programOutput = & $programPath
    if ($LASTEXITCODE -ne 0 -or ($programOutput -join "`n").Trim() -ne "0") {
        throw "Packaged program smoke failed"
    }
    @"
io: .io
io.write_text("native-io.txt", "native UTF-8: hej")
io.append_text("native-io.txt", " + appended")
io.write_bytes("native-io.bin", "byte exact")
io.eprint("native stderr")
:: io.read_text("native-io.txt")
:: io.read_bytes("native-io.bin")
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_io.vkf") -Encoding utf8
    $ioErrorPath = Join-Path $smokeRoot "io.err"
    $ioOutput = & $compiler (Join-Path $smokeRoot "installed_io.vkf") 2> $ioErrorPath
    $ioError = (Get-Content -LiteralPath $ioErrorPath -Raw).Trim()
    if ($LASTEXITCODE -ne 0 -or
        ($ioOutput -join "`n").Trim() -ne "native UTF-8: hej + appended`nbyte exact" -or
        $ioError -ne "native stderr") {
        throw "Packaged native IO smoke failed"
    }
    @"
io: .io
:: io.read_line()
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_read_line.vkf") -Encoding utf8
    $readLineInput = "x" * 600
    $readLineOutput = $readLineInput | & $compiler (Join-Path $smokeRoot "installed_read_line.vkf")
    if ($LASTEXITCODE -ne 0 -or ($readLineOutput -join "`n").Trim() -ne $readLineInput) {
        throw "Packaged native read-line smoke failed"
    }
    @"
c: .collections
errors: .errors
q: c.queue()
q.put(10)
q.put(20)
first: q.get()
second: q.get()
point: c.map(name:"origin", x:1, y:2)
caught: 0
(false?! "native error")!?
    errors.AssertionError => caught: 1
:: first + second + point.x + point.y + caught
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_collections_errors.vkf") -Encoding utf8
    $collectionsOutput = & $compiler (Join-Path $smokeRoot "installed_collections_errors.vkf")
    if ($LASTEXITCODE -ne 0 -or ($collectionsOutput -join "`n").Trim() -ne "34") {
        throw "Packaged native collections/errors smoke failed"
    }
    @"
system: .system
present: system.env("PATH")
missing: system.env("VKF_MISSING_RELEASE_TEST_0_1_0")
:: system.os()
:: system.arch()
:: system.cpu_count() > 0
:: present.found
:: missing.found
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_system.vkf") -Encoding utf8
    $systemOutput = & $compiler (Join-Path $smokeRoot "installed_system.vkf")
    if ($LASTEXITCODE -ne 0 -or ($systemOutput -join "`n").Trim() -ne "windows`nx86_64`ntrue`ntrue`nfalse") {
        throw "Packaged native system smoke failed"
    }
    @"
process: .process
result: process.run("cmd.exe", ["/d", "/c", "(<nul set /p =hello)&(<nul set /p =error>&2)&exit /b 7"])
:: result.code
:: result.out
:: result.err
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_process.vkf") -Encoding utf8
    $processOutput = & $compiler (Join-Path $smokeRoot "installed_process.vkf")
    if ($LASTEXITCODE -ne 0 -or ($processOutput -join "`n").Trim() -ne "7`nhello`nerror") {
        throw "Packaged native process smoke failed"
    }
    @"
capture: .capture
result: capture.regex("values are 123 and 45", 'values are (?P<a>\d+) and (?P<b>\d+)')
:: result.a
:: result.b
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_capture.vkf") -Encoding utf8
    $captureOutput = & $compiler (Join-Path $smokeRoot "installed_capture.vkf")
    if ($LASTEXITCODE -ne 0 -or ($captureOutput -join "`n").Trim() -ne "123`n45") {
        throw "Packaged native capture smoke failed"
    }
    $namedOutput = & $compiler $smokeSource -o app.exe
    if ($LASTEXITCODE -ne 0 -or ($namedOutput -join "`n").Trim() -ne "0" -or
        -not (Test-Path -LiteralPath (Join-Path $smokeRoot "app.exe"))) {
        throw "Packaged named build-and-run smoke failed"
    }
    @"
test installed_test() -> bit:
    :: "test output"
    @: 2 + 2 = 4
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_test.vkf") -Encoding utf8
    $testOutput = & $compiler -t (Join-Path $smokeRoot "installed_test.vkf")
    if ($LASTEXITCODE -ne 0 -or ($testOutput -join "`n") -notmatch "PASS .*installed_test") {
        throw "Packaged integrated test smoke failed"
    }
    $unsupportedOutput = & $compiler -e 'physics: .physics; :: physics.rigid_material("x", 1, 1, 1, 1, 1, 1)' 2>&1
    $unsupportedExitCode = $LASTEXITCODE
    if ($unsupportedExitCode -eq 0 -or ($unsupportedOutput -join "`n") -notmatch "not included in the strict native release") {
        throw "Strict release accepted an excluded stdlib module"
    }
    $global:LASTEXITCODE = 0
} finally {
    Pop-Location
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
}

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $archivePath -Leaf)" | Set-Content -LiteralPath "$archivePath.sha256" -Encoding ascii
Write-Output $stageRoot
Write-Output $archivePath
