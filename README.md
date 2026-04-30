# Vektor Flow

A mathematical visualization and computational language.

Vektor Flow is moving toward a no-Python end-user release model:

- `vkf` as the user-facing compiler/runtime command
- packaged native artifacts for supported programs
- Windows native transparent overlay UI
- macOS and Linux browser/headless UI for the same language/runtime surface

File extension: `.vkf`

## Current Beta Status

What is already true:

- the language, interpreter, compiler pipeline, package contract, and VS Code extension are usable now
- Windows is the current full UI beta target:
  - `overlay`
  - `browser`
  - `headless`
- macOS and Linux are the current portable UI beta targets:
  - `browser`
  - `headless`
- the produced native executables from the supported subset do not require Python at runtime

What is not fully finished yet:

- the Python-free end-user distribution story is still being finalized for all release channels
- the transparent overlay host is currently Windows-only
- the full language is still broader than the currently packaged native subset

So the honest platform target story today is:

- Windows: full beta experience
- macOS: browser-mode beta
- Linux: browser-mode beta

## Choose Your Path

### 1. I want to try Vektor Flow as a user

This is the preferred path when release artifacts are available:

- download the package for your platform
- unzip or extract it
- run `vkf`
- optionally point the VS Code extension at that packaged `vkf`

If a packaged release is not yet published for your platform, use the source
build path below for now.

The concrete step-by-step install guide lives in:

- [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)

### 2. I want to build or contribute from source

Use the repo bootstrap path:

- Windows:
  - `./build.ps1`
- macOS / Linux:
  - install Python 3.11+
  - `pip install -e .[dev]`

That path is still appropriate for contributors, but it should not be the main onboarding story for community testers.

## Platform Matrix

| Platform | UI modes | Recommended beta story |
| --- | --- | --- |
| Windows | `overlay`, `browser`, `headless` | Full beta target |
| macOS | `browser`, `headless` | Portable beta target |
| Linux | `browser`, `headless` | Portable beta target |

Windows is the only current platform with the native transparent overlay host.

## Quick Start

### Windows beta

When a packaged Windows release is available:

1. Download the Windows package.
2. Extract it to a folder such as `C:\Tools\vektorflow`.
3. Run:

```powershell
.\vkf.exe -s ':: "hello, world"'
```

4. For a packaged native program, use the generated launcher:

```powershell
.\my-packaged-program\run.bat
.\my-packaged-program\smoke-test.bat
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf.exe`.

UI modes:

- `overlay` for the Windows transparent overlay host
- `browser` for the browser host
- `headless` for file-only display output

### macOS beta

When a packaged macOS release is available:

1. Download the macOS archive.
2. Extract it.
3. Run:

```bash
./vkf -s ':: "hello, world"'
```

4. For packaged native programs, use the generated shell launcher:

```bash
./my-packaged-program/run.sh
./my-packaged-program/smoke-test.sh
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf`.

UI modes:

- `browser`
- `headless`

### Linux beta

When a packaged Linux release is available:

1. Download the Linux archive.
2. Extract it.
3. Run:

```bash
./vkf -s ':: "hello, world"'
```

4. For packaged native programs, use the generated shell launcher:

```bash
./my-packaged-program/run.sh
./my-packaged-program/smoke-test.sh
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf`.

UI modes:

- `browser`
- `headless`

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

## VS Code Quick Start

The extension guide lives in:

- [vscode/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\vscode\README.md)

Recommended user story:

1. Install the Vektor Flow extension.
   Current expected path:
   - install from a local `.vsix`
   - or install directly from the `vscode/` folder while it is still pre-Marketplace
2. Point it at your packaged `vkf` binary:

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

On macOS or Linux:

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

3. Open `examples/hello.vkf`.
4. Run `Run Vektor Flow File`.

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

### Useful developer commands

```bash
vkf bench --list
vkf bench
vkf tokens examples/hello.vkf --json
vkf package examples/benchmarks/scalar_control.vkf -o dist/scalar-control
vkf package-native-core examples/native_core/hello_native.vkf -o dist/hello-native
```
