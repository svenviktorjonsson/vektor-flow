# Cross-Platform Bundle Bring-Up

This guide is for maintainers or contributors who are producing the first real
tester bundles on macOS and Linux.

If you are an end user, use:

- [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)
- [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)

## Goal

Produce a host-native tester bundle that:

1. builds successfully on the host OS
2. passes bundle verification
3. runs the inline smoke check
4. runs both bundled sample files
5. includes the VS Code extension bundle when packaging succeeds

Current target channels:

- Windows:
  - `windows-overlay`
- macOS:
  - `macos-browser`
- Linux:
  - `linux-browser`

## Expected Host Prerequisites

### All platforms

- Python 3.11+
- ability to install repo dev dependencies
- `npx` or `vsce` on `PATH` if you want the VS Code extension bundled

### Windows

- PowerShell
- MSVC/CMake toolchain if you need to rebuild the overlay host

### macOS / Linux

- `python3`
- a working shell
- browser available locally for browser-mode UI testing
- C++ compiler on `PATH` if you plan to exercise native build flows

## Bootstrap

From the repo root:

### Windows

```powershell
.\build.ps1
```

### macOS / Linux

```bash
python3 -m pip install -e .[dev]
```

If the release builder needs PyInstaller and it is not already installed:

```bash
python3 -m pip install pyinstaller
```

## Build The Bundle

### Windows

```powershell
.\scripts\build-release-bundle.ps1
```

Expected output bundle:

- `dist\releases\windows-overlay`

### macOS

```bash
./scripts/build-release-bundle.sh --channel macos-browser
```

Expected output bundle:

- `dist/releases/macos-browser`

### Linux

```bash
./scripts/build-release-bundle.sh --channel linux-browser
```

Expected output bundle:

- `dist/releases/linux-browser`

## Verify The Bundle

Always run the verifier before handing the bundle to testers:

### Windows

```powershell
python scripts\verify_release_bundle.py dist\releases\windows-overlay
```

### macOS

```bash
python3 scripts/verify_release_bundle.py dist/releases/macos-browser
```

### Linux

```bash
python3 scripts/verify_release_bundle.py dist/releases/linux-browser
```

Expected result:

- the verifier prints the bundle path
- exit code `0`

## Manual Smoke Pass

Run these from inside the extracted or built bundle directory.

### Windows

```powershell
.\vkf.exe -e ':: "hello, world"'
.\vkf.exe .\samples\hello.vkf
.\vkf.exe .\samples\core_language_tour.vkf
```

### macOS / Linux

```bash
./vkf -e ':: "hello, world"'
./vkf ./samples/hello.vkf
./vkf ./samples/core_language_tour.vkf
```

Expected signals:

- inline smoke prints `hello, world`
- both sample files run without immediate startup failure
- UI-capable examples use the expected host mode for that platform

## VS Code Extension Check

If the bundle contains `extensions/*.vsix`:

1. install that `.vsix`
2. set `vektorflow.compilerPath` to the bundled `vkf`
3. open `samples/hello.vkf`
4. run `Run Vektor Flow File`

Expected result:

- the terminal prints `hello, world`

Recommended settings:

### Windows

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\bundle\\vkf.exe"
}
```

### macOS / Linux

```json
{
  "vektorflow.compilerPath": "/path/to/bundle/vkf"
}
```

## What To Capture When Something Fails

When a bundle bring-up fails, capture:

1. OS and version
2. exact build command
3. exact verify command
4. full terminal output
5. whether failure was in:
   - bundle build
   - bundle verify
   - sample run
   - VS Code extension
   - browser/UI host
6. the generated:
   - `vektorflow-release.json`
   - `README.txt`

## Current Honest Platform State

- Windows:
  - fully exercised locally in this repo
- macOS:
  - build path committed, awaiting first host execution
- Linux:
  - build path committed, awaiting first host execution

So the next community-ready milestone is:

1. run this guide once on a macOS host
2. run this guide once on a Linux host
3. archive those first successful bundle results
