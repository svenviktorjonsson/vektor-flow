param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$BundleDirectory = "dist/releases/vektor-flow-windows-x64",
    [string]$OutputDirectory = "dist/releases",
    [string]$MakensisPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$bundleRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BundleDirectory))
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $bundleRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $outputRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BundleDirectory and OutputDirectory must stay inside the repository"
}
$makensisCandidates = @(
    $MakensisPath,
    (Join-Path ${env:ProgramFiles(x86)} "NSIS/makensis.exe"),
    (Join-Path $env:ProgramFiles "NSIS/makensis.exe"),
    (Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
)
$makensis = $makensisCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
$installerSource = Join-Path $repoRoot "packaging/windows/vektor-flow.nsi"
$installerText = Get-Content -LiteralPath $installerSource -Raw
if ($installerText -match 'MUI_PAGE_DIRECTORY' -or
    $installerText -match 'RMDir\s+/r\s+"\$INSTDIR"') {
    throw "Installer safety contract forbids arbitrary install roots and recursive root deletion"
}
foreach ($requiredGuard in @('.vektor-flow-install', 'StrCmp "$INSTDIR" "$LOCALAPPDATA\Programs\VektorFlow"')) {
    if (-not $installerText.Contains($requiredGuard)) {
        throw "Installer safety guard is missing: $requiredGuard"
    }
}
if (-not $makensis) { throw "NSIS compiler (makensis.exe) was not found" }
if (-not (Test-Path -LiteralPath $bundleRoot -PathType Container)) { throw "Missing bundle: $bundleRoot" }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& $makensis "/DAPP_VERSION=$Version" "/DBUNDLE_ROOT=$bundleRoot" "/DOUTPUT_FILE=$(Join-Path $outputRoot 'vektor-flow-windows-x64-setup.exe')" $installerSource
if ($LASTEXITCODE -ne 0) { throw "NSIS failed" }

$installer = Join-Path $outputRoot "vektor-flow-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer was not produced" }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $installer -Leaf)" | Set-Content -LiteralPath "$installer.sha256" -Encoding ascii
Write-Output $installer
