#Requires -Version 5.1
param(
    [string]$BuildDirectory = "build/v",
    [string]$Target = "vkf-ui-package",
    [ValidateSet("Debug", "Release", "RelWithDebInfo", "MinSizeRel")]
    [string]$Configuration = "Release",
    [ValidateRange(1, 64)]
    [int]$Parallel = 2,
    [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceRoot = Join-Path $repoRoot "native/VfOverlay"
$buildRoot = if ([System.IO.Path]::IsPathRooted($BuildDirectory)) {
    [System.IO.Path]::GetFullPath($BuildDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BuildDirectory))
}
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $buildRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BuildDirectory must stay inside the repository"
}
if ($Target -notmatch '^[A-Za-z0-9_.-]+$') {
    throw "Target contains unsupported command characters"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "CMakeLists.txt") -PathType Leaf)) {
    throw "Missing native UI source at native/VfOverlay"
}

$relativeBuild = $buildRoot.Substring($repoPrefix.Length).Replace('\', '/')
$legacyScratch = Join-Path $buildRoot "CMakeFiles/CMakeScratch/TryCompile-12345678/cmTC_123456.dir/Debug/cmTC_123456.tlog/link-rc.read.1.tlog"
$fileSystem = New-Object -ComObject Scripting.FileSystemObject
$shortRepoRoot = $fileSystem.GetFolder($repoRoot).ShortPath
$mappedScratch = "$shortRepoRoot/$relativeBuild/CMakeFiles/CMakeScratch/TryCompile-12345678/cmTC_123456.dir/Debug/cmTC_123456.tlog/link-rc.read.1.tlog"
$minimumNinjaVersion = "1.11.0"
$pinnedNinjaVersion = "1.12.1"
$pinnedNinjaArchiveSha256 = "f550fec705b6d6ff58f2db3c374c2277a37691678d6aba463adcbb129108467a"
$plan = [ordered]@{
    generator = "Ninja"
    compilerEnvironment = "MSVC"
    avoidsMsbuildFileTracker = $true
    usesShortRepositoryPath = $true
    buildDirectory = $relativeBuild
    packageUiBinaryDirectory = $relativeBuild
    legacyMsbuildScratchPathLength = $legacyScratch.Length
    mappedCMakeScratchPathLength = $mappedScratch.Length
    minimumNinjaVersion = $minimumNinjaVersion
    pinnedNinjaVersion = $pinnedNinjaVersion
    pinnedNinjaArchiveSha256 = $pinnedNinjaArchiveSha256
    target = $Target
    configuration = $Configuration
}
if ($PlanOnly) {
    $plan | ConvertTo-Json -Compress
    exit 0
}

$cmake = (Get-Command cmake -ErrorAction Stop).Source
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw "vswhere.exe not found; install Visual Studio Build Tools with C++"
}
$installationPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null | Select-Object -First 1)
if (-not $installationPath) {
    throw "Visual Studio C++ Build Tools not found"
}
$ninjaCommand = Get-Command ninja -ErrorAction SilentlyContinue
$ninja = if ($ninjaCommand) {
    $ninjaCommand.Source
} else {
    Join-Path $installationPath "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe"
}
$ninjaVersion = if (Test-Path -LiteralPath $ninja -PathType Leaf) {
    (& $ninja --version 2>$null | Select-Object -First 1)
} else {
    $null
}
if (-not $ninjaVersion -or [version]$ninjaVersion -lt [version]$minimumNinjaVersion) {
    $ninjaToolRoot = Join-Path $repoRoot "build/.tools/ninja-$pinnedNinjaVersion"
    $ninjaArchive = Join-Path $ninjaToolRoot "ninja-win.zip"
    $ninja = Join-Path $ninjaToolRoot "ninja.exe"
    if (-not (Test-Path -LiteralPath $ninja -PathType Leaf)) {
        New-Item -ItemType Directory -Path $ninjaToolRoot -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/ninja-build/ninja/releases/download/v$pinnedNinjaVersion/ninja-win.zip" -OutFile $ninjaArchive
        $archiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ninjaArchive).Hash.ToLowerInvariant()
        if ($archiveSha256 -ne $pinnedNinjaArchiveSha256) {
            throw "Pinned Ninja archive hash mismatch: $archiveSha256"
        }
        Expand-Archive -LiteralPath $ninjaArchive -DestinationPath $ninjaToolRoot -Force
    }
    $ninjaVersion = (& $ninja --version 2>$null | Select-Object -First 1)
}
if (-not $ninjaVersion -or [version]$ninjaVersion -lt [version]$minimumNinjaVersion) {
    throw "Ninja $minimumNinjaVersion or newer is required for long Windows paths"
}
$vcvars = Join-Path $installationPath "VC/Auxiliary/Build/vcvars64.bat"
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) {
    throw "vcvars64.bat not found under $installationPath"
}

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$shortBuildRoot = $fileSystem.GetFolder($buildRoot).ShortPath
$mappedSource = Join-Path $shortRepoRoot "native/VfOverlay"
$command = "call `"$vcvars`" && `"$cmake`" -S `"$mappedSource`" -B `"$shortBuildRoot`" -G Ninja -DCMAKE_MAKE_PROGRAM=`"$ninja`" -DCMAKE_BUILD_TYPE=$Configuration && `"$cmake`" --build `"$shortBuildRoot`" --target $Target --parallel $Parallel"
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Output $buildRoot
