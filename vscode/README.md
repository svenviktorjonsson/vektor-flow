# Vektor Flow VS Code Extension MVP

This folder contains the current VS Code extension MVP for Vektor Flow.

What it gives you today:

- `.vkf` language association
- syntax highlighting
- editor title-bar commands for:
  - parse
  - run
  - build
- compatibility with the workspace `Run and Debug` and `Task` entries already checked into this repo
- compiler-backed diagnostics for `.vkf` files when enabled

What it does not try to be yet:

- a packaged language server
- full debugger integration
- an all-in-one native build UI

## Prerequisites

### Required to try the extension

1. VS Code
2. Python 3 on `PATH`
3. A Vektor Flow command path that VS Code can execute

The extension prefers running a compiler command directly:

```text
vkf
```

That means the lowest-friction setup is:

- install this repo so `vkf` is on `PATH`, or
- point `vektorflow.compilerPath` at the exact executable you want to use

From the repo root:

```bash
pip install -e .[dev]
```

If you do not have `vkf` on `PATH`, the extension can still fall back to Python, but only when:

- `vektorflow.compilerPath` is blank, and
- `vektorflow.pythonPath` points to an interpreter that can import `vektorflow`

The legacy fallback command is:

```bash
python -m vektorflow.cli <subcommand> <file>
```

### Optional for native build experimentation

If you want the build button and native-core terminal flows to succeed, install a C++ compiler on `PATH`:

- `clang++`, or
- `g++`

That is not required for syntax highlighting or the run command itself, but it is required for commands like:

```bash
vkf build-native-core examples/native_core/hello_native.vkf
```

## Install Options

### Fastest: install directly from the folder in VS Code

1. Open VS Code.
2. Run `Developer: Install Extension from Location...`
3. Select the `vscode/` folder from this repo.

Important:

- do not run `code --install-extension ./vscode`
- that command expects a `.vsix` file or a published extension id, not a source folder

### Pack and install a `.vsix`

From the repo root in PowerShell:

```powershell
.\install_extension.ps1
```

What that script does:

- packages `vscode/` into a `.vsix`
- installs it with `code` or `cursor` if either CLI is on `PATH`

Manual alternative:

```bash
cd vscode
npx --yes @vscode/vsce package --allow-missing-repository
```

Then install the generated `.vsix` with:

```bash
code --install-extension .\vektorflow-<version>.vsix
```

If `code` is not on `PATH`, open VS Code and use:

- `Shell Command: Install 'code' command in PATH`

or install the `.vsix` through the Extensions view menu.

## Marketplace Prep

This extension is now packaged so it can be published cleanly later, but it is
not published yet.

Before publishing:

1. Create or choose your actual VS Code Marketplace publisher id.
2. Replace the placeholder publisher value in:
   - `vscode/package.json`
3. Log in with `vsce`:

```bash
vsce login <your-publisher-id>
```

4. Publish from the `vscode/` folder:

```bash
vsce publish
```

The extension package now includes:

- a bundled `LICENSE`
- a constrained `files` whitelist in `package.json`
- repository, homepage, and issue tracker metadata

## Configure The Extension

### Preferred settings

The extension now prefers these settings:

- `vektorflow.compilerPath`
- `vektorflow.compilerArgs`
- `vektorflow.useNativeCoreCommands`
- `vektorflow.enableDiagnostics`
- `vektorflow.diagnosticsDebounceMs`

Recommended default if `vkf` already works in your terminal:

```json
{
  "vektorflow.compilerPath": "vkf",
  "vektorflow.compilerArgs": [],
  "vektorflow.useNativeCoreCommands": true
}
```

### Python fallback setting

Legacy fallback setting:

- `Vektor Flow: Python Path`
- setting key: `vektorflow.pythonPath`

Default:

```text
python
```

Set it to the full path of your venv interpreter only if you are using the Python fallback path.

### What the commands actually do

- `Run Vektor Flow File`
  - launches the configured compiler command in a terminal against the current file
- `Parse Vektor Flow File`
  - runs `parse-native-core <file>` and captures output in the `Vektor Flow` output channel
- `Build Vektor Flow File`
  - runs `build-native-core <file>` when `vektorflow.useNativeCoreCommands` is `true`
  - otherwise runs `build <file>`

Diagnostics currently use:

- `cpp-native-core <file>` when `vektorflow.useNativeCoreCommands` is `true`
- `cpp <file>` otherwise

## Smoke Test

This is the shortest end-to-end path to prove the MVP is working.

### 1. Open the repo in VS Code

Open:

- `C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh`

### 2. Confirm the extension is active

Open:

- `examples/hello.vkf`

You should see:

- language mode: `Vektor Flow`
- syntax highlighting
- title-bar buttons for parse, run, and build

### 3. Run the basic command path

Use one of these:

1. Click the run button in the editor title bar
2. Command Palette -> `Run Vektor Flow File`
3. `Run and Debug` -> `vkf: run current file`
4. `Terminal -> Run Task...` -> `vkf: run current file`

Expected terminal output:

```text
hello, world
```

### 4. Verify parse output

Open:

- `examples/native_core/hello_native.vkf`

Run:

- `Parse Vektor Flow File`

Expected result:

- the `Vektor Flow` output channel opens
- you see a parsed module representation rather than a terminal launch failure

### 5. Verify explicit stdlib import syntax from the user surface

Create a scratch `.vkf` file with:

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

This proves the extension is not only launching the CLI, but preserving the explicit stdlib namespace import contract users see in the language surface.

### 6. Verify build for the current native-core subset

With a C++ compiler on `PATH`, open:

- `examples/native_core/hello_native.vkf`

Run:

- `Build Vektor Flow File`

Expected result:

- the `Vektor Flow` output channel reports a built executable path

Then run in the integrated terminal:

```powershell
.\hello_native.exe
```

Expected output:

```text
42
```

### 7. Terminal-only fallback smoke test

```bash
python -m vektorflow.cli build-native-core examples/native_core/hello_native.vkf -o hello_native.exe
.\hello_native.exe
```

Expected output:

```text
42
```

If this step fails with a compiler error, the extension is still fine; it usually means `clang++` or `g++` is not on `PATH`.

## Known MVP Boundaries

- The extension is command-driven, not language-server-driven.
- The checked-in workspace `Run and Debug` config uses the Python extension.
- The checked-in tasks use `python -m vektorflow.cli ...`, so they depend on the same interpreter setup as the extension command.
- Parse/build commands capture output in the `Vektor Flow` output channel; run launches an integrated terminal.
- Native build is only guaranteed for the current native-core subset.

## Extension Development

If you want to work on the extension itself:

1. Open this repo in VS Code.
2. Open the `vscode/` folder in the workspace.
3. Press `F5`.
4. A new Extension Development Host window should open.
5. In that host window, open a `.vkf` file and repeat the smoke test above.
