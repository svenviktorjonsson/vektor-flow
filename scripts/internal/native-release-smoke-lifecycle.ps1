function Assert-VkfPackageSmokePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = [System.IO.Path]::GetFullPath($ExpectedRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $rootPrefix = $fullRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($fullPath -ne $fullRoot -and
        -not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Package smoke path must stay inside the isolated smoke root: $fullPath"
    }
    return $fullPath
}

function Remove-VkfPackageSmokePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot,
        [ValidateRange(1, 100)]
        [int]$Attempts = 50,
        [ValidateRange(1, 1000)]
        [int]$RetryMilliseconds = 200
    )

    $fullPath = Assert-VkfPackageSmokePath -Path $Path -ExpectedRoot $ExpectedRoot
    $lastFailure = $null
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        if (-not (Test-Path -LiteralPath $fullPath)) {
            return
        }
        try {
            Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
        } catch {
            $lastFailure = $_
        }
        if (-not (Test-Path -LiteralPath $fullPath)) {
            return
        }
        if ($attempt + 1 -lt $Attempts) {
            Start-Sleep -Milliseconds $RetryMilliseconds
        }
    }

    $detail = if ($lastFailure) { $lastFailure.Exception.Message } else { "path still exists" }
    throw "Timed out removing test-owned package smoke path '$fullPath': $detail"
}

function Test-VkfWebViewProfileCommandLine {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandLine,
        [Parameter(Mandatory = $true)]
        [string]$ProfilePath
    )

    $match = [System.Text.RegularExpressions.Regex]::Match(
        $CommandLine,
        '(?i)(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+))'
    )
    if (-not $match.Success) {
        return $false
    }
    $candidate = if ($match.Groups[1].Success) {
        $match.Groups[1].Value
    } else {
        $match.Groups[2].Value
    }
    try {
        $candidatePath = [System.IO.Path]::GetFullPath($candidate).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
        $expectedPath = [System.IO.Path]::GetFullPath($ProfilePath).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
    } catch {
        return $false
    }
    $expectedPrefix = $expectedPath + [System.IO.Path]::DirectorySeparatorChar
    return $candidatePath.Equals(
            $expectedPath,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -or $candidatePath.StartsWith(
            $expectedPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )
}

function Stop-VkfPackageProfileProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProfilePath,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $profileFullPath = Assert-VkfPackageSmokePath `
        -Path $ProfilePath `
        -ExpectedRoot $ExpectedRoot
    $webViewProcesses = Get-CimInstance Win32_Process `
        -Filter "Name = 'msedgewebview2.exe'" `
        -ErrorAction Stop
    foreach ($webViewProcess in $webViewProcesses) {
        $commandLine = $webViewProcess.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine) -or
            -not (Test-VkfWebViewProfileCommandLine `
                -CommandLine $commandLine `
                -ProfilePath $profileFullPath)) {
            continue
        }
        $processId = [int]$webViewProcess.ProcessId
        if ($processId -le 0 -or $processId -eq $PID) {
            throw "Refusing invalid WebView package-smoke process id $processId"
        }
        $taskkill = Join-Path $env:SystemRoot "System32/taskkill.exe"
        & $taskkill /PID $processId /T /F 2>&1 | Out-Null
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
                break
            }
            Start-Sleep -Milliseconds 50
        }
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            throw "Test-owned WebView process $processId did not exit"
        }
    }
}

function Stop-VkfPackageSmokeProcess {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedExecutable,
        [Parameter(Mandatory = $true)]
        [string]$ProfilePath,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot,
        [ValidateRange(100, 30000)]
        [int]$GraceMilliseconds = 5000,
        [ValidateRange(100, 30000)]
        [int]$ForceMilliseconds = 10000
    )

    $expectedExecutablePath = Assert-VkfPackageSmokePath `
        -Path $ExpectedExecutable `
        -ExpectedRoot $ExpectedRoot
    $profileFullPath = Assert-VkfPackageSmokePath `
        -Path $ProfilePath `
        -ExpectedRoot $ExpectedRoot
    if (-not $Process.HasExited) {
        $actualExecutable = $Process.Path
        if ([string]::IsNullOrWhiteSpace($actualExecutable)) {
            $actualExecutable = $Process.StartInfo.FileName
        }
        if ([string]::IsNullOrWhiteSpace($actualExecutable)) {
            throw "Cannot verify the live package smoke process executable"
        }
        $actualExecutablePath = [System.IO.Path]::GetFullPath($actualExecutable)
        if (-not $actualExecutablePath.Equals(
            $expectedExecutablePath,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Refusing to stop a process outside the package smoke executable: $actualExecutablePath"
        }

        $closePosted = $Process.CloseMainWindow()
        if ($closePosted) {
            $Process.WaitForExit($GraceMilliseconds) | Out-Null
        }
        if (-not $Process.HasExited) {
            $taskkill = Join-Path $env:SystemRoot "System32/taskkill.exe"
            & $taskkill /PID $Process.Id /T /F 2>&1 | Out-Null
            $Process.WaitForExit($ForceMilliseconds) | Out-Null
        }
    }
    if (-not $Process.HasExited) {
        throw "Test-owned package smoke process $($Process.Id) did not exit"
    }

    Stop-VkfPackageProfileProcesses `
        -ProfilePath $profileFullPath `
        -ExpectedRoot $ExpectedRoot
    Remove-VkfPackageSmokePath `
        -Path $profileFullPath `
        -ExpectedRoot $ExpectedRoot `
        -Attempts 50 `
        -RetryMilliseconds 200
}
