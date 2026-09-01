param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$archiveFullPath = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $archiveFullPath -PathType Leaf)) {
    throw "Missing Windows portable archive: $archiveFullPath"
}
$sidecarPath = "$archiveFullPath.sha256"
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
    throw "Missing Windows portable archive checksum: $sidecarPath"
}
$sidecarText = (Get-Content -LiteralPath $sidecarPath -Raw).Trim()
if ($sidecarText -notmatch '^([0-9a-fA-F]{64})\s+') {
    throw "Invalid Windows portable archive checksum"
}
$expectedHash = $Matches[1].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $archiveFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Windows portable archive checksum mismatch: $actualHash"
}

$extractRoot = Join-Path (
    [System.IO.Path]::GetTempPath()
) ("VektorFlowArchiveSmoke-$PID-" + [guid]::NewGuid().ToString("N"))
$extractFullPath = [System.IO.Path]::GetFullPath($extractRoot)
$repoPrefix = $repoRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if ($extractFullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Portable archive smoke extraction must stay outside the repository"
}
if (Test-Path -LiteralPath $extractFullPath) {
    throw "Portable archive smoke extraction already exists: $extractFullPath"
}

$savedLocation = Get-Location
$savedPath = $env:PATH
$savedLocalAppData = $env:LOCALAPPDATA
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$savedVkfEnvironment = @{}
Get-ChildItem Env: | Where-Object { $_.Name -like "VKF_*" } | ForEach-Object {
    $savedVkfEnvironment[$_.Name] = $_.Value
}

try {
    New-Item -ItemType Directory -Path $extractFullPath | Out-Null
    Expand-Archive -LiteralPath $archiveFullPath -DestinationPath $extractFullPath

    $manifestPath = Join-Path $extractFullPath "vektorflow-release.json"
    $compiler = Join-Path $extractFullPath "bin/vkf.exe"
    $sample = Join-Path $extractFullPath "samples/01_hello.vkf"
    $mathModule = Join-Path $extractFullPath "compiler/self_hosted/stdlib/math.vkf"
    foreach ($required in @($manifestPath, $compiler, $sample, $mathModule)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Windows portable archive omitted: $required"
        }
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.entrypoint -ne "bin/vkf.exe") {
        throw "Windows portable archive has an invalid entrypoint"
    }

    Add-Content -LiteralPath $mathModule -Encoding utf8 -Value @"

archive_probe() -> int:
    43117
"@
    $probeSource = Join-Path $extractFullPath "archive-probe.vkf"
    @"
m: .math
:: m.archive_probe()
"@ | Set-Content -LiteralPath $probeSource -Encoding utf8

    Get-ChildItem Env: | Where-Object { $_.Name -like "VKF_*" } | ForEach-Object {
        [System.Environment]::SetEnvironmentVariable($_.Name, $null, "Process")
    }
    $env:PATH = "$(Join-Path $env:SystemRoot 'System32');$env:SystemRoot"
    $env:LOCALAPPDATA = Join-Path $extractFullPath "runtime-data"
    $env:TEMP = Join-Path $extractFullPath "temp"
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:TEMP -Force | Out-Null
    Set-Location $extractFullPath

    $inlineOutput = (& $compiler -e ':: "archive ready"' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $inlineOutput -ne "archive ready") {
        throw "Extracted Windows compiler inline smoke failed: $inlineOutput"
    }
    $sampleOutput = (& $compiler $sample | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $sampleOutput -ne "hello, world") {
        throw "Extracted Windows compiler sample smoke failed: $sampleOutput"
    }
    $sentinelOutput = (& $compiler $probeSource | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $sentinelOutput -ne "43117") {
        throw "Extracted Windows compiler did not load its extracted stdlib: $sentinelOutput"
    }

    $summary = [ordered]@{
        archiveHashVerified = $true
        extractionOutsideRepository = $true
        developerPathRemoved = $true
        extractedStdlibSentinel = 43117
        inlineOutput = $inlineOutput
        sampleOutput = $sampleOutput
        runtimeContract = $manifest.runtime_contract
        archiveSha256 = $actualHash
    }
    if ($Json) {
        $summary | ConvertTo-Json -Depth 5 -Compress
    } else {
        $summary
    }
} finally {
    Set-Location $savedLocation
    $env:PATH = $savedPath
    $env:LOCALAPPDATA = $savedLocalAppData
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
    Get-ChildItem Env: | Where-Object { $_.Name -like "VKF_*" } | ForEach-Object {
        [System.Environment]::SetEnvironmentVariable($_.Name, $null, "Process")
    }
    foreach ($entry in $savedVkfEnvironment.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $extractFullPath); $attempt++) {
        try {
            Remove-Item -LiteralPath $extractFullPath -Recurse -Force -ErrorAction Stop
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (Test-Path -LiteralPath $extractFullPath) {
        throw "Windows portable archive smoke left its extraction behind: $extractFullPath"
    }
}
