# Vektor Flow VS Code Extension

This extension is the fastest editor path for trying Vektor Flow once you have a working `vkf` command.

What it gives you today:

- `.vkf` language association
- syntax highlighting
- title-bar commands for:
  - check
  - run
  - build
- compiler-backed diagnostics for `.vkf` files when enabled

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

That is better than pointing the extension at a repository build.

For the full tester checklist after installation, see:

- [TESTING.md](../TESTING.md)

## Prerequisites

### Required

1. VS Code
2. A working `vkf` executable or command path

Recommended check in a terminal:

```bash
vkf -e ':: "hello, world"'
```

If that works, the extension path is usually easy.

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
  "vektorflow.enableDiagnostics": true,
  "vektorflow.diagnosticsDebounceMs": 250
}
```

## What The Commands Do

- `Run Vektor Flow File`
  - launches the configured compiler command in a terminal against the current file
- `Build Vektor Flow File`
  - runs `vkf -b <file>` and writes output to the `Vektor Flow` output channel
- `Check Vektor Flow File`
  - builds to a temporary executable and reports compiler diagnostics without running it

Background diagnostics use the same temporary native build and remove its
artifact afterward.

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

### Check path

Introduce an invalid binding in a scratch `.vkf` file, then run:

- `Check Vektor Flow File`

Expected result: the compiler error appears in VS Code Problems without running
the program or leaving an executable beside the source.

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

Open any valid `.vkf` program.

Run:

- `Build Vektor Flow File`

Expected result:

- a built executable path is reported

## Known Boundaries

- The extension is command-driven, not language-server-driven.
- It exposes only the native 0.1.3 compiler surface; unavailable `ui`, `physics`,
  and `symbolic` modules remain unavailable in the editor.

## Contributor / Dev Path

If you are working on the extension or compiler from source:

1. Open the repo in VS Code.
2. Install VKF 0.1.3 or build the native compiler using the repository installation guide.
3. Press `F5` in the `vscode/` folder to open an Extension Development Host.
4. Repeat the smoke tests above.

If you are packaging the extension for distribution later, see the Marketplace prep section in `vscode/package.json` and the repo docs.
