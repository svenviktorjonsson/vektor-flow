# Run from repository root:  .\install_extension.ps1
# Packages vscode\ into a .vsix and installs it with the VS Code or Cursor CLI.

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ExtDir = Join-Path $Root "vscode"

if (-not (Test-Path -LiteralPath (Join-Path $ExtDir "package.json"))) {
    Write-Error "Expected package.json at: $ExtDir"
    exit 1
}

Set-Location -LiteralPath $ExtDir

Write-Host "Packaging extension in: $ExtDir"

if (Get-Command vsce -ErrorAction SilentlyContinue) {
    & vsce package --allow-missing-repository
} else {
    & npx --yes @vscode/vsce package --allow-missing-repository
}

$vsix = Get-ChildItem -LiteralPath $ExtDir -Filter "*.vsix" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $vsix) {
    Write-Error "No .vsix file was created in $ExtDir"
    exit 1
}

Write-Host "Installing: $($vsix.FullName)"

$cli = $null
if (Get-Command code -ErrorAction SilentlyContinue) {
    $cli = "code"
} elseif (Get-Command cursor -ErrorAction SilentlyContinue) {
    $cli = "cursor"
}

if (-not $cli) {
    Write-Error "Neither 'code' nor 'cursor' is on PATH. Install the VS Code CLI, then run:`n  code --install-extension `"$($vsix.FullName)`""
    exit 1
}

& $cli --install-extension $vsix.FullName

Write-Host "Done. Reload the window if the extension does not appear (Ctrl+Shift+P -> Developer: Reload Window)."
