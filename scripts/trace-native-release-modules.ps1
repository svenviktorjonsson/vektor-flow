#Requires -Version 7.0
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseRoot,
    [string]$WorkRoot = "build/native-release-module-trace",
    [ValidateRange(250, 10000)]
    [int]$TraceMilliseconds = 2000
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$release = [System.IO.Path]::GetFullPath($ReleaseRoot)
$work = if ([System.IO.Path]::IsPathRooted($WorkRoot)) {
    [System.IO.Path]::GetFullPath($WorkRoot)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $WorkRoot))
}
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $work.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "WorkRoot must stay inside the repository"
}
if (-not (Test-Path -LiteralPath $release -PathType Container)) {
    throw "ReleaseRoot is not a directory: $release"
}
if ($work -eq $repoRoot -or $work -eq $release) {
    throw "unsafe module-trace work root: $work"
}

if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force
}
New-Item -ItemType Directory -Path $work -Force | Out-Null

$compiler = Join-Path $release "bin/vkf.exe"
$runner = Join-Path $release "bin/vkf-runner.exe"
$uiPackage = Join-Path $release "bin/vkf-ui-package.exe"
$stager = Join-Path $release "bin/vkf-native-scene-artifact-stager.exe"
foreach ($binary in @($compiler, $runner, $uiPackage, $stager)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
        throw "missing shipped executable: $binary"
    }
}

$consoleRoot = Join-Path $work "console"
$uiRoot = Join-Path $work "ui"
New-Item -ItemType Directory -Path $consoleRoot, (Join-Path $uiRoot "ui") -Force | Out-Null
$consoleSource = Join-Path $consoleRoot "trace.vkf"
$consoleProgram = Join-Path $consoleRoot "trace.exe"
@"
time: .time
time.sleep(3)
:: 42
"@ | Set-Content -LiteralPath $consoleSource -Encoding utf8
$uiSource = Join-Path $uiRoot "trace.vkf"
$uiProgram = Join-Path $uiRoot "trace.exe"
@"
: .ui.display
display: Display(dim:2)
frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])
frame.load("ui/main.html")
"@ | Set-Content -LiteralPath $uiSource -Encoding utf8
'<button>Module trace</button>' | Set-Content -LiteralPath (Join-Path $uiRoot "ui/main.html") -Encoding utf8

$savedPath = $env:PATH
$savedLocalAppData = $env:LOCALAPPDATA
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$fileSystem = New-Object -ComObject Scripting.FileSystemObject
$shortWork = $fileSystem.GetFolder($work).ShortPath
$env:PATH = ""
$env:LOCALAPPDATA = Join-Path $shortWork "local-app-data"
$env:TEMP = Join-Path $shortWork "temp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:TEMP -Force | Out-Null
try {
    & $compiler -b $consoleSource -o $consoleProgram | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $consoleProgram -PathType Leaf)) {
        throw "could not build module-trace console program"
    }
    & $compiler -b $uiSource -o $uiProgram | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $uiProgram -PathType Leaf)) {
        throw "could not build module-trace UI program"
    }
    # Compilation above proves an empty PATH. Runtime tracing restores the
    # ordinary OS search path so the installed Evergreen WebView2 runtime can
    # start exactly as it does for an end user.
    $env:PATH = $savedPath

    function Get-ProcessTreeIds([int]$RootId) {
        $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath, Name)
        $ids = [System.Collections.Generic.HashSet[int]]::new()
        [void]$ids.Add($RootId)
        do {
            $changed = $false
            foreach ($row in $rows) {
                if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) {
                    $changed = $true
                }
            }
        } while ($changed)
        [pscustomobject]@{ ids = $ids; rows = $rows }
    }

    function Trace-HiddenProcess([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory) {
        $process = Start-Process `
            -FilePath $Executable `
            -ArgumentList $Arguments `
            -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden `
            -PassThru
        $deadline = [DateTime]::UtcNow.AddMilliseconds($TraceMilliseconds)
        $modulePaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $processPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        [void]$modulePaths.Add([System.IO.Path]::GetFullPath($Executable))
        [void]$processPaths.Add([System.IO.Path]::GetFullPath($Executable))
        try {
            do {
                $tree = Get-ProcessTreeIds $process.Id
                foreach ($row in $tree.rows) {
                    if (-not $tree.ids.Contains([int]$row.ProcessId)) { continue }
                    if ($row.ExecutablePath) { [void]$processPaths.Add([string]$row.ExecutablePath) }
                    try {
                        $live = Get-Process -Id $row.ProcessId -ErrorAction Stop
                        foreach ($module in $live.Modules) {
                            if ($module.FileName) { [void]$modulePaths.Add([string]$module.FileName) }
                        }
                    } catch {
                        # A short-lived child remains covered by its process image and PE import gate.
                    }
                }
                Start-Sleep -Milliseconds 50
                $process.Refresh()
            } while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited)
        } finally {
            $process.Refresh()
            if (-not $process.HasExited) {
                $taskkill = Join-Path $env:SystemRoot "System32/taskkill.exe"
                $killer = Start-Process `
                    -FilePath $taskkill `
                    -ArgumentList @("/PID", $process.Id, "/T", "/F") `
                    -WindowStyle Hidden `
                    -Wait `
                    -PassThru
                $remaining = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
                if ($killer.ExitCode -ne 0 -and $remaining) {
                    throw "failed to terminate hidden trace process $($process.Id)"
                }
            }
        }
        [pscustomobject]@{
            name = $Name
            executable = $Executable
            process_paths = @($processPaths | Sort-Object)
            module_paths = @($modulePaths | Sort-Object)
        }
    }

    $traces = @(
        Trace-HiddenProcess "generated-console-runtime" $consoleProgram @() $consoleRoot
        Trace-HiddenProcess "generated-ui-runtime" $uiProgram @() $uiRoot
        Trace-HiddenProcess "vkf-runner" $runner @() (Split-Path $runner -Parent)
        Trace-HiddenProcess "vkf-ui-package" $uiPackage @() (Split-Path $uiPackage -Parent)
        Trace-HiddenProcess "vkf-native-scene-artifact-stager" $stager @() (Split-Path $stager -Parent)
    )

    $systemPrefix = $env:SystemRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $releasePrefix = $release.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $workPrefix = $work.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $windowsAppsPrefix = (Join-Path $env:ProgramFiles "WindowsApps").TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $modules = @($traces | ForEach-Object { $_.module_paths } | Sort-Object -Unique | ForEach-Object {
        $modulePath = [System.IO.Path]::GetFullPath($_)
        $classification = if ($modulePath.StartsWith($systemPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            "windows-system"
        } elseif ($modulePath.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            "release-owned"
        } elseif ($modulePath.StartsWith($workPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            "generated-vkf"
        } elseif ($modulePath -match '(?i)[\\/]Microsoft[\\/](EdgeWebView|Edge)[\\/]Application[\\/]') {
            "webview2-system-runtime"
        } elseif ($modulePath.StartsWith($windowsAppsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            "windows-media-extension"
        } else {
            "forbidden-external"
        }
        [pscustomobject]@{ path = $modulePath; classification = $classification }
    })
    $forbidden = @($modules | Where-Object classification -eq "forbidden-external")
    if ($forbidden.Count -ne 0) {
        throw "dynamic module trace found external modules: $($forbidden.path -join ', ')"
    }
    [pscustomobject]@{
        schema = 1
        release_root = $release
        launches_hidden = $true
        traces = $traces
        modules = $modules
    } | ConvertTo-Json -Depth 8
} finally {
    $env:PATH = $savedPath
    $env:LOCALAPPDATA = $savedLocalAppData
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
}
