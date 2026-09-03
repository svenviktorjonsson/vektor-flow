param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$BinaryDirectory = "build/native-compiler-clang/bin",
    [string]$UiBinaryDirectory = "build/vf-overlay/Release",
    [string]$OutputDirectory = "dist/releases"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "internal/native-release-smoke-lifecycle.ps1")

$packageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
function Write-VkfPackageTrace {
    param([Parameter(Mandatory = $true)][string]$Stage)
    if (-not [string]::IsNullOrWhiteSpace($env:VKF_PACKAGE_TRACE_FILE)) {
        $elapsed = $packageStopwatch.Elapsed.TotalMilliseconds.ToString(
            "F1",
            [System.Globalization.CultureInfo]::InvariantCulture
        )
        "$elapsed`t$Stage" | Add-Content -LiteralPath $env:VKF_PACKAGE_TRACE_FILE -Encoding utf8
    }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$binaryRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BinaryDirectory))
$uiBinaryRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $UiBinaryDirectory))
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $binaryRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $uiBinaryRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $outputRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BinaryDirectory, UiBinaryDirectory, and OutputDirectory must stay inside the repository"
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
foreach ($helper in @("vkf_wasm_artifact_smoke.exe", "vkf_webgpu_artifact_smoke.exe")) {
    $helperSource = Join-Path $binaryRoot $helper
    if (-not (Test-Path -LiteralPath $helperSource -PathType Leaf)) {
        throw "Missing private UI compiler helper: $helperSource"
    }
    Copy-Item -LiteralPath $helperSource -Destination (Join-Path $stageRoot "bin/$helper")
}
foreach ($helper in @("vkf-ui-package.exe", "vkf-runner.exe", "vkf-native-scene-artifact-stager.exe")) {
    $helperSource = Join-Path $uiBinaryRoot $helper
    if (-not (Test-Path -LiteralPath $helperSource -PathType Leaf)) {
        throw "Missing private UI runtime helper: $helperSource"
    }
    Copy-Item -LiteralPath $helperSource -Destination (Join-Path $stageRoot "bin/$helper")
}

$stdlibTarget = Join-Path $stageRoot "compiler/self_hosted/stdlib"
New-Item -ItemType Directory -Path $stdlibTarget -Force | Out-Null
$directModules = @("math.vkf", "stat.vkf", "random.vkf", "time.vkf", "io.vkf", "collections.vkf", "errors.vkf", "system.vkf", "process.vkf", "regex.vkf", "linalg.vkf", "physics.vkf", "symbolic.vkf")
foreach ($module in $directModules) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "compiler/self_hosted/stdlib/$module") -Destination $stdlibTarget
}
Copy-Item -LiteralPath (Join-Path $repoRoot "compiler/self_hosted/stdlib/physics") -Destination $stdlibTarget -Recurse

$samplesTarget = Join-Path $stageRoot "samples"
New-Item -ItemType Directory -Path $samplesTarget -Force | Out-Null
foreach ($sample in @("examples/01_hello.vkf", "examples/64_axis_tags_and_broadcast.vkf")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $sample) -Destination $samplesTarget
}
$uiSamplesTarget = Join-Path $samplesTarget "ui"
New-Item -ItemType Directory -Path $uiSamplesTarget -Force | Out-Null
foreach ($sample in @("examples/material_ui_gallery", "examples/ui_plot_card", "examples/ui_status_board")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $sample) `
        -Destination (Join-Path $uiSamplesTarget (Split-Path $sample -Leaf)) -Recurse
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
    stdlib_modules = @("math", "stat", "random", "time", "io", "collections", "errors", "system", "process", "regex", "linalg", "physics", "physics.units", "physics.units.si", "symbolic")
    not_included_partial_modules = @()
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
Write-VkfPackageTrace -Stage "release-layout-staged"

$forbiddenFiles = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Where-Object {
    $_.Extension.ToLowerInvariant() -in @(".c", ".cc", ".cpp", ".cxx", ".py", ".pyc", ".pyd")
}
if ($forbiddenFiles) {
    throw "Strict native bundle contains forbidden compatibility/build sources: $($forbiddenFiles.FullName -join ', ')"
}

$smokeRoot = Join-Path $outputRoot ".s"
Remove-VkfPackageSmokePath -Path $smokeRoot -ExpectedRoot $outputRoot
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
$smokeSource = Join-Path $smokeRoot "installed_math.vkf"
@"
m: .math
:: m.tanh(0)
"@ | Set-Content -LiteralPath $smokeSource -Encoding utf8

$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$isolatedTemp = Join-Path $smokeRoot ("temp-" + $PID)
Push-Location $smokeRoot
try {
    New-Item -ItemType Directory -Path $isolatedTemp -Force | Out-Null
    $env:TEMP = $isolatedTemp
    $env:TMP = $isolatedTemp
    $compiler = Join-Path $stageRoot "bin/vkf.exe"
    $guardSource = Join-Path $smokeRoot "overwrite_guard.vkf"
    $guardOutput = Join-Path $smokeRoot "do-not-overwrite.exe"
    ':: 1' | Set-Content -LiteralPath $guardSource -Encoding utf8
    'user-owned-data' | Set-Content -LiteralPath $guardOutput -Encoding utf8
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $guardMessage = & $compiler -b $guardSource -o $guardOutput 2>&1
        $guardExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($guardExitCode -eq 0 -or
        (Get-Content -LiteralPath $guardOutput -Raw).Trim() -ne 'user-owned-data' -or
        ($guardMessage -join "`n") -notmatch 'refusing to overwrite existing non-VKF file') {
        throw "Packaged compiler could overwrite a user-owned output file"
    }
    $decoyOutput = Join-Path $smokeRoot "marker-decoy.exe"
    'user-owned VKF-CACHE-V1:not-an-artifact' | Set-Content -LiteralPath $decoyOutput -Encoding utf8
    $ErrorActionPreference = "Continue"
    try {
        $decoyMessage = & $compiler -b $guardSource -o $decoyOutput 2>&1
        $decoyExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($decoyExitCode -eq 0 -or
        (Get-Content -LiteralPath $decoyOutput -Raw).Trim() -ne 'user-owned VKF-CACHE-V1:not-an-artifact' -or
        ($decoyMessage -join "`n") -notmatch 'refusing to overwrite existing non-VKF file') {
        throw "Packaged compiler trusted a forged cache marker"
    }
    $global:LASTEXITCODE = 0
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
    Write-VkfPackageTrace -Stage "native-program-smoke-complete"
    $uiSourceRoot = Join-Path $smokeRoot "u"
    $uiRoot = Join-Path $uiSourceRoot "ui"
    New-Item -ItemType Directory -Path (Join-Path $uiRoot "assets") -Force | Out-Null
    $uiSource = Join-Path $uiSourceRoot "app.vkf"
    @"
: .ui.display
display: Display(dim:2)
frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])
frame.load("ui/main.html")
glass: frame.add(x:[[-1.5, 1.5], [-1.5, 1.5]], y:[[0.0, 0.0], [2.0, 2.0]], z:[[0.0, 0.0], [0.0, 0.0]], id:"release-glass", color:[0.28, 0.82, 0.94, 0.5], alpha:0.5, transparent:true)
release_button: Button(id:"release-button")
release_slider: Input(id:"release-slider")
(button_event: release_button.events.get())??>
    ButtonClicked =>
        glass.visible: true
(slider_event: release_slider.events.get())??>
    SliderValueChanged =>
        glass.alpha: slider_event.value
"@ | Set-Content -LiteralPath $uiSource -Encoding utf8
    '<link rel="stylesheet" href="theme.css"><button id="release-button">Release UI</button><input id="release-slider" type="range" min="0" max="1" value="0.5">' |
        Set-Content -LiteralPath (Join-Path $uiRoot "main.html") -Encoding utf8
    'button { background-image: url("assets/icon.svg"); color: rgb(12, 34, 56); }' |
        Set-Content -LiteralPath (Join-Path $uiRoot "theme.css") -Encoding utf8
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>' |
        Set-Content -LiteralPath (Join-Path $uiRoot "assets/icon.svg") -Encoding utf8
    $uiFirst = Join-Path $uiSourceRoot "first.exe"
    $uiSecond = Join-Path $uiSourceRoot "second.exe"
    $savedPath = $env:PATH
    $env:PATH = ""
    try {
        $uiFirstOutput = & $compiler -b $uiSource -o $uiFirst
        $uiFirstExitCode = $LASTEXITCODE
        $uiSecondOutput = & $compiler -b $uiSource -o $uiSecond
        $uiSecondExitCode = $LASTEXITCODE

        if ($uiFirstExitCode -ne 0 -or -not (Test-Path -LiteralPath $uiFirst) -or
            ($uiFirstOutput -join "`n") -notmatch "^Built ") {
            throw "Packaged compiler did not build the static UI application"
        }
        if ($uiSecondExitCode -ne 0 -or -not (Test-Path -LiteralPath $uiSecond) -or
            (Get-FileHash -LiteralPath $uiFirst -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $uiSecond -Algorithm SHA256).Hash) {
            throw "Packaged UI application was not deterministic"
        }
        Write-VkfPackageTrace -Stage "deterministic-ui-builds-complete"
    $uiBytes = [System.IO.File]::ReadAllBytes($uiFirst)
    $uiFooter = [System.Text.Encoding]::ASCII.GetBytes("VKF_SCENE_BUNDLE_END_V1")
    if ($uiBytes.Length -lt $uiFooter.Length) {
        throw "Packaged UI application omitted its embedded scene bundle"
    }
    for ($index = 0; $index -lt $uiFooter.Length; $index++) {
        if ($uiBytes[$uiBytes.Length - $uiFooter.Length + $index] -ne $uiFooter[$index]) {
            throw "Packaged UI application omitted its embedded scene bundle"
        }
    }
    $payloadSizeOffset = $uiBytes.Length - $uiFooter.Length - 8
    $payloadSize = [System.BitConverter]::ToUInt64($uiBytes, $payloadSizeOffset)
    if ($payloadSize -gt $payloadSizeOffset) {
        throw "Packaged UI application reported an invalid scene bundle size"
    }
    $payloadStart = $payloadSizeOffset - [int64]$payloadSize
    $uiPayloadText = [System.Text.Encoding]::UTF8.GetString($uiBytes, [int]$payloadStart, [int]$payloadSize)
    if (-not $uiPayloadText.Contains('"schema":"vektorflow.internal.ui_package_provenance"')) {
        throw "Packaged UI application omitted its private provenance"
    }
    if (-not $uiPayloadText.Contains('id="release-button"') -or
        -not $uiPayloadText.Contains('id="release-slider"') -or
        -not $uiPayloadText.Contains('"event":"ButtonClicked"') -or
        -not $uiPayloadText.Contains('"event":"SliderValueChanged"')) {
        throw "Packaged UI application omitted retained Button/Slider behavior"
    }
    $savedLocalAppData = $env:LOCALAPPDATA
    $uiLocalAppData = Join-Path $smokeRoot "localappdata"
    $uiWebViewProfile = Join-Path $uiLocalAppData "vektor-flow/webview2/runtime-v1"
    if (Test-Path -LiteralPath $uiLocalAppData) {
        Remove-Item -LiteralPath $uiLocalAppData -Recurse -Force
    }
    $env:LOCALAPPDATA = $uiLocalAppData
    try {
            $openedUi = Join-Path $uiSourceRoot ("u10open-" + $PID + ".exe")
            $openStdout = Join-Path $uiSourceRoot "u10open.stdout.txt"
            $openStderr = Join-Path $uiSourceRoot "u10open.stderr.txt"
            $taskkill = Join-Path $env:SystemRoot "System32/taskkill.exe"
            $openCompiler = Start-Process -FilePath $compiler -ArgumentList @(
                ('"' + $uiSource + '"'), "-o", ('"' + $openedUi + '"')
            ) -WorkingDirectory $uiSourceRoot -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput $openStdout -RedirectStandardError $openStderr
            $openedProcess = $null
            try {
                for ($attempt = 0; $attempt -lt 300 -and -not $openCompiler.HasExited; $attempt++) {
                    $openedProcess = Get-Process -ErrorAction SilentlyContinue |
                        Where-Object { $_.Path -eq $openedUi } |
                        Select-Object -First 1
                    if ($openedProcess) { break }
                    Start-Sleep -Milliseconds 100
                }
                if (-not $openedProcess -or $openCompiler.HasExited) {
                    $openError = if (Test-Path -LiteralPath $openStderr) {
                        (Get-Content -LiteralPath $openStderr -Raw).Trim()
                    } else { "" }
                    throw "Packaged vkf app.vkf did not stay attached to the opened UI application: $openError"
                }
            } finally {
                if (-not $openCompiler.HasExited) {
                    & $taskkill /PID $openCompiler.Id /T /F 2>&1 | Out-Null
                    $openCompiler.WaitForExit(10000) | Out-Null
                } elseif ($openedProcess -and -not $openedProcess.HasExited) {
                    & $taskkill /PID $openedProcess.Id /T /F 2>&1 | Out-Null
                    $openedProcess.WaitForExit(10000) | Out-Null
                }
                if ($openedProcess) {
                    Stop-VkfPackageSmokeProcess `
                        -Process $openedProcess `
                        -ExpectedExecutable $openedUi `
                        -ProfilePath $uiWebViewProfile `
                        -ExpectedRoot $smokeRoot
                }
            }
    Write-VkfPackageTrace -Stage "attached-ui-open-proof-complete"
    $relocatedRoot = Join-Path $smokeRoot "r"
    New-Item -ItemType Directory -Path $relocatedRoot -Force | Out-Null
    $relocatedUi = Join-Path $relocatedRoot "renamed.exe"
    $relocatedProfile = Join-Path $uiLocalAppData "vektor-flow/webview2/runtime-v1"
    Copy-Item -LiteralPath $uiFirst -Destination $relocatedUi
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $uiSourceRoot); $attempt++) {
        try {
            Remove-Item -LiteralPath $uiSourceRoot -Recurse -Force
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (Test-Path -LiteralPath $uiSourceRoot) {
        throw "Packaged UI open proof left its WebView profile locked"
    }
    if ((Get-ChildItem -LiteralPath $relocatedRoot -File).Count -ne 1) {
        throw "Relocated UI application proof contained source or helper sidecars"
    }
    $uiProcess = $null
    try {
        $uiProcess = Start-Process -FilePath $relocatedUi -WorkingDirectory $relocatedRoot -WindowStyle Hidden -PassThru
        Start-Sleep -Seconds 2
        if ($uiProcess.HasExited) {
            throw "Relocated packaged UI application did not stay running"
        }
    } finally {
        if ($uiProcess) {
            Stop-VkfPackageSmokeProcess `
                -Process $uiProcess `
                -ExpectedExecutable $relocatedUi `
                -ProfilePath $relocatedProfile `
                -ExpectedRoot $smokeRoot
        }
    }
    Write-VkfPackageTrace -Stage "relocated-ui-proof-complete"
    } finally {
        $env:LOCALAPPDATA = $savedLocalAppData
        for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $uiLocalAppData); $attempt++) {
            try {
                Remove-Item -LiteralPath $uiLocalAppData -Recurse -Force
            } catch {
                Start-Sleep -Milliseconds 200
            }
        }
        if (Test-Path -LiteralPath $uiLocalAppData) {
            throw "Packaged UI smoke left its isolated runtime cache behind"
        }
    }
    } finally {
        $env:PATH = $savedPath
    }
    $commandProcessor = $env:COMSPEC.Replace('\', '\\')
    @"
io: .io
c: .collections
errors: .errors
system: .system
process: .process
regex: .regex
io.write_text("native-io.txt", "native UTF-8: hej")
io.append_text("native-io.txt", " + appended")
io.write_bytes("native-io.bin", "byte exact")
io.eprint("native stderr")
q: c.queue()
q.put(10)
q.put(20)
first: q.get()
second: q.get()
point: c.map(name:"origin", x:1, y:2)
caught: 0
(false?! "native error")!?
    errors.AssertionError => caught: 1
present: system.env("PATH")
missing: system.env("VKF_MISSING_RELEASE_TEST_0_1_0")
process_result: process.run("$commandProcessor", ["/d", "/c", "(<nul set /p =hello)&(<nul set /p =error>&2)&exit /b 7"])
shell_result: process.shell("exit /b 0")
regex_result: regex.match("values are 123 and 45", 'values are (?P<a>.*) and (?P<b>\d+)')
:: io.read_text("native-io.txt")
:: io.read_bytes("native-io.bin")
:: first + second + point.x + point.y + caught
:: system.os()
:: system.arch()
:: system.cpu_count() > 0
:: present.found
:: missing.found
:: process_result.code
:: process_result.out
:: process_result.err
:: shell_result.code
:: regex_result.a
:: regex_result.b
"@ | Set-Content -LiteralPath (Join-Path $smokeRoot "installed_runtime.vkf") -Encoding utf8
    $runtimeErrorPath = Join-Path $smokeRoot "runtime.err"
    $runtimeOutput = & $compiler (Join-Path $smokeRoot "installed_runtime.vkf") 2> $runtimeErrorPath
    $runtimeError = (Get-Content -LiteralPath $runtimeErrorPath -Raw).Trim()
    $expectedRuntimeOutput = @(
        "native UTF-8: hej + appended", "byte exact", "34", "windows", "x86_64",
        "true", "true", "false", "7", "hello", "error", "0", "123", "45"
    ) -join "`n"
    if ($LASTEXITCODE -ne 0 -or
        ($runtimeOutput -join "`n").Trim() -ne $expectedRuntimeOutput -or
        $runtimeError -ne "native stderr") {
        throw "Packaged consolidated native runtime smoke failed"
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
    $stdlibProof = & $compiler -t (Join-Path $repoRoot "tests/release_stdlibs.vkf")
    if ($LASTEXITCODE -ne 0 -or ($stdlibProof -join "`n") -notmatch "(?m)^7 passed, 0 failed$") {
        throw "Packaged native stdlib proof failed"
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
        throw "Packaged integrated test smoke failed (exit $LASTEXITCODE): $($testOutput -join '`n')"
    }
    Write-VkfPackageTrace -Stage "stdlib-and-cli-smokes-complete"
    $global:LASTEXITCODE = 0
} finally {
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $isolatedTemp); $attempt++) {
        try {
            Remove-Item -LiteralPath $isolatedTemp -Recurse -Force
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (Test-Path -LiteralPath $isolatedTemp) {
        throw "Packaged release smoke left its isolated temporary state behind"
    }
    Pop-Location
    Remove-VkfPackageSmokePath -Path $smokeRoot -ExpectedRoot $outputRoot
}

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal
Write-VkfPackageTrace -Stage "archive-complete"
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $archivePath -Leaf)" | Set-Content -LiteralPath "$archivePath.sha256" -Encoding ascii
& (Join-Path $PSScriptRoot "test-windows-portable-archive.ps1") `
    -ArchivePath $archivePath `
    -Json | Out-Null
Write-VkfPackageTrace -Stage "portable-archive-proof-complete"
Write-Output $stageRoot
Write-Output $archivePath
