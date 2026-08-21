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
$makensisCandidates = @(
    $MakensisPath,
    (Join-Path ${env:ProgramFiles(x86)} "NSIS/makensis.exe"),
    (Join-Path $env:ProgramFiles "NSIS/makensis.exe"),
    (Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
)
$makensis = $makensisCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $makensis) { throw "NSIS compiler (makensis.exe) was not found" }
if (-not (Test-Path -LiteralPath $bundleRoot -PathType Container)) { throw "Missing bundle: $bundleRoot" }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& $makensis "/DAPP_VERSION=$Version" "/DBUNDLE_ROOT=$bundleRoot" "/DOUTPUT_FILE=$(Join-Path $outputRoot 'vektor-flow-windows-x64-setup.exe')" (Join-Path $repoRoot "packaging/windows/vektor-flow.nsi")
if ($LASTEXITCODE -ne 0) { throw "NSIS failed" }

$installer = Join-Path $outputRoot "vektor-flow-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer was not produced" }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $installer -Leaf)" | Set-Content -LiteralPath "$installer.sha256" -Encoding ascii
Write-Output $installer
