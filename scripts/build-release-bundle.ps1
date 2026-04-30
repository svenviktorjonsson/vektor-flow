param(
    [string]$Channel,
    [string]$Output,
    [switch]$SkipExtension,
    [switch]$SkipUiAssets,
    [switch]$AllowMissingOverlay
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
if (-not $Python) {
    throw "Python is required to build release bundles."
}

$Args = @((Join-Path $Root "scripts\build_release_bundle.py"))
if ($Channel) { $Args += @("--channel", $Channel) }
if ($Output) { $Args += @("--output", $Output) }
if ($SkipExtension) { $Args += "--skip-extension" }
if ($SkipUiAssets) { $Args += "--skip-ui-assets" }
if ($AllowMissingOverlay) { $Args += "--allow-missing-overlay" }

& $Python @Args
