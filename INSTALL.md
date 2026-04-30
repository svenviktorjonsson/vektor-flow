# Vektor Flow Installation Guide

This guide is the practical install path for community testers.

If you are trying Vektor Flow as a user, start here instead of the contributor
bootstrap flow.

If you are preparing a bundle for someone else to test, verify it first with:

```bash
python scripts/verify_release_bundle.py dist/releases/<channel>
```

For first macOS/Linux bundle bring-up from source, use:

- [BUNDLE_BRINGUP.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\BUNDLE_BRINGUP.md)

## Before You Start

You need:

- a packaged Vektor Flow release for your platform
- VS Code only if you want the editor integration

You do **not** need:

- Python
- `pip`
- a virtual environment

## Windows

Current UI modes:

- `overlay`
- `browser`
- `headless`

### Install

1. Download the Windows release archive.
2. Extract it somewhere stable, for example:

```text
C:\Tools\vektorflow
```

3. Open PowerShell in that folder.
4. Verify the compiler works:

```powershell
.\vkf.exe -e ':: "hello, world"'
```

Expected output:

```text
hello, world
```

### Run A Packaged Native Program

If the release bundle includes a packaged native program folder, use the
generated launcher inside that folder:

```powershell
.\my-packaged-program\run.bat
.\my-packaged-program\smoke-test.bat
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf.exe`.

### Use The Overlay

Windows is the only platform that currently supports the native transparent
overlay host.

If a UI program uses the default Windows UI path, it can use:

- `overlay`
- `browser`
- `headless`

## macOS

Current UI modes:

- `browser`
- `headless`

### Install

1. Download the macOS release archive.
2. Extract it.
3. Open Terminal in the extracted folder.
4. Verify the compiler works:

```bash
./vkf -e ':: "hello, world"'
```

Expected output:

```text
hello, world
```

### Run A Packaged Native Program

If the release bundle includes a packaged native program folder, use the
generated launcher inside that folder:

```bash
./my-packaged-program/run.sh
./my-packaged-program/smoke-test.sh
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf`.

### UI Note

macOS currently uses:

- `browser`
- `headless`

There is not yet a macOS native transparent overlay host.

## Linux

Current UI modes:

- `browser`
- `headless`

### Install

1. Download the Linux release archive.
2. Extract it.
3. Open a shell in the extracted folder.
4. Verify the compiler works:

```bash
./vkf -e ':: "hello, world"'
```

Expected output:

```text
hello, world
```

### Run A Packaged Native Program

If the release bundle includes a packaged native program folder, use the
generated launcher inside that folder:

```bash
./my-packaged-program/run.sh
./my-packaged-program/smoke-test.sh
```

If the release bundle includes sample `.vkf` files, you can also run those
directly. The inline snippet above is the safest first check because it depends
only on the packaged `vkf`.

### UI Note

Linux currently uses:

- `browser`
- `headless`

There is not yet a Linux native transparent overlay host.

## VS Code

If you want editor integration after the platform install succeeds, continue
with:

- [vscode/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\vscode\README.md)
- [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)

Recommended settings:

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

If `vkf` is already on `PATH`, the simplest packaged setup is:

```json
{
  "vektorflow.compilerPath": "vkf"
}
```

## If You Are Building From Source Instead

That is the contributor path, not the main tester path.

See:

- [README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\README.md)
- [RELEASES.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\RELEASES.md)
- [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)
