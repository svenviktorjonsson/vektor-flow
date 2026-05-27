# Vektor Flow Beta Testing Guide

This is the fastest path for community testers who want to help us find bugs,
installation friction, packaging problems, UI issues, and VS Code integration
rough edges.

## Start Here

1. Install or extract the packaged Vektor Flow release for your platform.
2. Confirm the packaged `vkf` command works in a terminal.
3. Run one sample file.
4. Install the bundled VS Code extension if you want editor testing too.
5. Report any friction with the checklist at the bottom of this file.

If you are looking for platform-specific install steps, start with:

- [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)

If you are the maintainer preparing a tester bundle, verify it before sharing:

```bash
python scripts/verify_release_bundle.py dist/releases/<channel>
```

## Terminal Smoke Tests

### Windows

From the extracted bundle folder:

```powershell
.\vkf.exe -e ':: "hello, world"'
.\vkf.exe .\samples\01_hello.vkf
.\vkf.exe .\samples\100_axis_4_panel.vkf
```

### macOS / Linux

From the extracted bundle folder:

```bash
./vkf -e ':: "hello, world"'
./vkf ./samples/01_hello.vkf
./vkf ./samples/100_axis_4_panel.vkf
```

## UI Smoke Tests

Current supported modes by platform:

- Windows:
  - `overlay`
  - `browser`
  - `headless`
- macOS:
  - `browser`
  - `headless`
- Linux:
  - `browser`
  - `headless`

The best beta signal right now is whether:

- the program launches
- the expected UI host opens
- the UI output matches the sample program
- the host closes cleanly and can be relaunched

### Python-Free Shared Runtime Demo

This is the fastest UI path to test right now. On Windows it runs inside the
native overlay using static UI assets:

- no Chrome dependency on Windows
- no Python server
- no `vf-display.json` polling during pointer movement
- typed event and transform arenas on the hot path

Windows:

```powershell
.\run-shared-runtime-demo.ps1
```

macOS / Linux:

```bash
./run-shared-runtime-demo.sh
```

Expected result: a browser window opens with one draggable rectangle. Dragging
the rectangle should feel immediate.

## VS Code Extension Smoke Test

If your bundle includes an `extensions/` folder:

1. Install the bundled `.vsix` from that folder.
2. Open VS Code.
3. Set `vektorflow.compilerPath` to the packaged `vkf` binary:

### Windows

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

### macOS / Linux

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

4. Open `samples/01_hello.vkf`.
5. Run `Run Vektor Flow File`.
6. Confirm the terminal prints:

```text
hello, world
```

Good extra editor checks:

- syntax highlighting looks correct
- diagnostics appear for real mistakes
- `Parse Vektor Flow File` works
- `Build Vektor Flow File` behaves sensibly for supported native subsets

## What Feedback Helps Most

We especially want to hear about:

- install friction
- missing bundled files
- `vkf` command failures
- browser-mode UI failures on macOS or Linux
- overlay problems on Windows
- VS Code extension setup friction
- examples that work from source but fail from a packaged bundle

## Bug Report Checklist

When reporting a bug, include:

1. platform and version:
   - Windows / macOS / Linux
   - bundle channel if known
2. whether you used:
   - packaged release
   - source build
3. exact command you ran
4. exact `.vkf` file or minimal snippet
5. terminal output or screenshot
6. whether VS Code extension was involved
7. whether the issue is:
   - install
   - compiler/runtime
   - package/launcher
   - UI
   - extension/editor

If the problem involves a packaged native program, also include:

- `vektorflow-package.json`
- `vektorflow-release.json` if present

That gives us enough context to reproduce the issue much faster.
