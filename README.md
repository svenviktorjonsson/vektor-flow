# Vektor Flow

A mathematical visualization and computational language.

Use `vkf` to run `.vkf` programs.

File extension: `.vkf`

## Start Here

Choose the package for your OS, extract it, run `vkf`, then optionally install
the VS Code extension.

### Platform support

| Platform | UI modes today | Recommended path |
| --- | --- | --- |
| Windows | `overlay`, `browser`, `headless` | Full beta |
| macOS | `browser`, `headless` | Portable beta |
| Linux | `browser`, `headless` | Portable beta |

Windows is the only platform with the native transparent overlay host today.

## Quick Start

### Windows

1. Download and extract the Windows package.
2. In PowerShell inside the extracted folder, run:

```powershell
.\vkf.exe -e ':: "hello, world"'
.\vkf.exe .\samples\hello.vkf
.\vkf.exe .\samples\core_language_tour.vkf
```

Expected first output:

```text
hello, world
```

### macOS / Linux

1. Download and extract the package for your OS.
2. In a shell inside the extracted folder, run:

```bash
./vkf -e ':: "hello, world"'
./vkf ./samples/hello.vkf
./vkf ./samples/core_language_tour.vkf
```

Expected first output:

```text
hello, world
```

## VS Code

1. Install the bundled `.vsix` from the package, or install the extension from
   `vscode/`.
2. Point the extension at your packaged `vkf`.

### Windows setting

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

### macOS / Linux setting

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

3. Open `samples/hello.vkf`.
4. Run `Run Vektor Flow File`.

Extension guide:

- [vscode/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\vscode\README.md)

## Need More Detail?

- install guide:
  - [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)
- tester guide:
  - [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)
- release layout:
  - [RELEASES.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\RELEASES.md)
- macOS/Linux maintainer bring-up:
  - [BUNDLE_BRINGUP.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\BUNDLE_BRINGUP.md)

## Try These First

```bash
vkf examples/hello.vkf
vkf examples/branching.vkf
vkf examples/core_language_tour.vkf
```

For current packaged-native work:

```bash
vkf package examples/benchmarks/scalar_control.vkf -o dist/scalar-control
vkf package-native-core examples/native_core/hello_native.vkf -o dist/hello-native
```

## Packaging And Native Compiler Progress

The current standalone and packaging work is tracked in:

- [NATIVE_CORE.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\NATIVE_CORE.md)
- [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)
- [RELEASES.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\RELEASES.md)
- [examples/native_core/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\examples\native_core\README.md)

Important current distinction:

- `vkf build` produces a native executable for the supported subset
- `vkf package` and `vkf package-native-core` produce a native package directory
- Python is still used to produce those packages today
- the produced packaged executables do not require Python at runtime

Current package shape includes:

- built native executable
- emitted C++ source
- `vektorflow-package.json`
- `README.txt`
- `run.bat`
- `run.sh`
- `smoke-test.bat`
- `smoke-test.sh`

The package manifest now carries the runnable contract, launcher information, install hints, and codegen/build lineage so callers do not have to guess how to execute the package.

## UI Host Status

Current UI host modes:

- `overlay`
- `browser`
- `headless`

Current platform truth:

- `overlay` is Windows-only today
- `browser` is the portable bridge for macOS and Linux
- `headless` is the no-host mode

So the cross-platform release strategy is:

- Windows ships the native overlay host
- macOS and Linux ship the same language/runtime with browser-mode UI
- future native overlay hosts for macOS and Linux can plug into the same display/event contract

## Standard Library Notes

Most stdlib areas are not blocked on Windows-only native code.

Important examples:

- `math`, `collections`, `errors`, `stat`: general runtime/library work
- `io`: mostly portable by design, with host seams for file and time behavior
- `ui`: the main host/platform-specific stdlib area

That means the major cross-platform native-host effort is the UI host, not the rest of the stdlib surface.

## Community Feedback

The best feedback right now is:

- install friction on each platform
- `vkf` command behavior on packaged builds
- VS Code extension setup friction
- browser-mode UI issues on macOS/Linux
- overlay issues on Windows
- compiler/runtime bugs from real `.vkf` programs

When reporting a bug, include:

- platform
- whether you used a packaged build or a source build
- the `.vkf` file or minimal snippet
- package manifest if the bug is package/runtime related

For a fuller tester checklist, use:

- [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)

## Contributor Path

If you want to build from source today:

### Windows

```powershell
.\build.ps1
```

That script:

- installs the Python package
- builds the Windows overlay host
- runs tests

### macOS / Linux

```bash
pip install -e .[dev]
python -m vektorflow --version
```

If you are building tester bundles from source:

- Windows:
  - `.\scripts\build-release-bundle.ps1`
- macOS / Linux:
  - `./scripts/build-release-bundle.sh`

Verify before sharing:

- `python scripts/verify_release_bundle.py dist/releases/<channel>`

### Useful developer commands

```bash
vkf bench --list
vkf bench
vkf tokens examples/hello.vkf --json
vkf package examples/benchmarks/scalar_control.vkf -o dist/scalar-control
vkf package-native-core examples/native_core/hello_native.vkf -o dist/hello-native
```
