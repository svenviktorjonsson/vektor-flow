# Vektor Flow VS Code Extension

This extension is the fastest editor path for trying Vektor Flow once you have a working `vkf` command.

What it gives you today:

- `.vkf` language association
- syntax highlighting
- title-bar commands for:
  - parse
  - run
  - build
- compiler-backed diagnostics for `.vkf` files when enabled
- compatibility with the checked-in workspace run/debug helpers for contributors

What it is not yet:

- a full language server
- a debugger for compiled/native execution
- a full visual build UI

## Best User Path

For normal users and community testers, the preferred setup is:

1. install a packaged Vektor Flow release for your OS
2. confirm that `vkf` runs in a terminal
3. install this VS Code extension
4. point the extension at your packaged `vkf`

That is better than the repo/Python path for most users.

## Platform Notes

| Platform | Recommended UI mode today |
| --- | --- |
| Windows | `overlay`, `browser`, or `headless` |
| macOS | `browser` or `headless` |
| Linux | `browser` or `headless` |

The extension itself is cross-platform. The current host limitation is the runtime UI mode, not the editor integration.

## Prerequisites

### Required

1. VS Code
2. A working `vkf` executable or command path

Recommended check in a terminal:

```bash
vkf -e ':: "hello, world"'
```

If that works, the extension path is usually easy.

### Optional for native builds

If you want the build command to succeed for native subsets, you still need a C++ compiler on `PATH`, for example:

- `clang++`
- `g++`

## Install The Extension

### Preferred for users: package/install a VSIX

From the repo root in PowerShell:

```powershell
.\install_extension.ps1
```

Manual packaging:

```bash
cd vscode
npx --yes @vscode/vsce package --allow-missing-repository
```

Then install the generated `.vsix` from VS Code or with:

```bash
code --install-extension .\vektorflow-<version>.vsix
```

### Source-folder install for contributors

1. Open VS Code.
2. Run `Developer: Install Extension from Location...`
3. Select the `vscode/` folder from your source checkout.

## Configure The Extension

### Preferred setting

Point the extension at the packaged `vkf` binary you want to use.

#### Windows

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

#### macOS / Linux

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

If `vkf` is already on `PATH`, the simplest setup is:

```json
{
  "vektorflow.compilerPath": "vkf"
}
```

### Other useful settings

```json
{
  "vektorflow.compilerArgs": [],
  "vektorflow.useNativeCoreCommands": true,
  "vektorflow.enableDiagnostics": true,
  "vektorflow.diagnosticsDebounceMs": 250
}
```

### Legacy contributor path

The extension can still work against a repo/Python install, but that should be treated as the contributor path, not the main user path.

If you need it:

```bash
pip install -e .[dev]
```

Then either make sure `vkf` is on `PATH` or configure a Python fallback environment.

Python fallback setting:

```json
{
  "vektorflow.pythonPath": "python"
}
```

## What The Commands Do

- `Run Vektor Flow File`
  - launches the configured compiler command in a terminal against the current file
- `Parse Vektor Flow File`
  - runs `parse-native-core <file>` and writes output to the `Vektor Flow` output channel
- `Build Vektor Flow File`
  - runs `build-native-core <file>` when `vektorflow.useNativeCoreCommands` is `true`
  - otherwise runs `build <file>`

Diagnostics currently use:

- `cpp-native-core <file>` when `vektorflow.useNativeCoreCommands` is `true`
- `cpp <file>` otherwise

## Quick Start

### Windows

1. Install the packaged Windows release.
2. Confirm in a terminal:

```powershell
vkf -e ':: "hello, world"'
```

3. Install the extension.
4. Set:

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

5. Create or open a simple `hello.vkf` with:

```vkf
:: "hello, world"
```

6. Run `Run Vektor Flow File`.

Expected output:

```text
hello, world
```

### macOS / Linux

1. Install the packaged release.
2. Confirm in a terminal:

```bash
vkf -e ':: "hello, world"'
```

3. Install the extension.
4. Set:

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

5. Create or open a simple `hello.vkf` with:

```vkf
:: "hello, world"
```

6. Run `Run Vektor Flow File`.

## Good Smoke Tests

### Basic run

Open:

- a simple `.vkf` file such as:

```vkf
:: "hello, world"
```

Run:

- `Run Vektor Flow File`

Expected output:

```text
hello, world
```

### Parse path

Open:

- `examples/native_core/hello_native.vkf`

Run:

- `Parse Vektor Flow File`

Expected result:

- the `Vektor Flow` output channel opens
- parse output appears there

### Explicit stdlib import surface

Create a scratch `.vkf` file:

```vkf
math: .math
:: math.sin(0)
:: math.sqrt(81)
```

Run:

- `Run Vektor Flow File`

Expected output:

```text
0
9
```

### Native build path

If a C++ compiler is installed, open:

- `examples/native_core/hello_native.vkf`

Run:

- `Build Vektor Flow File`

Expected result:

- a built executable path is reported

## Known Boundaries

- The extension is command-driven, not language-server-driven.
- Native build is only guaranteed for the current native/native-core subsets.
- Windows currently has the best full UI story because overlay support exists there.
- macOS and Linux are still expected to use browser/headless runtime UI modes.

## Contributor / Dev Path

If you are working on the extension or compiler from source:

1. Open the repo in VS Code.
2. Install the package in a Python environment:

```bash
pip install -e .[dev]
```

3. Press `F5` in the `vscode/` folder to open an Extension Development Host.
4. Repeat the smoke tests above.

If you are packaging the extension for distribution later, see the Marketplace prep section in `vscode/package.json` and the repo docs.
