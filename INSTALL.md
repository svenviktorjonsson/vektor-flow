# Vektor Flow Installation Guide

This guide is the practical install path for community testers.

If you are trying Vektor Flow as a user, start here instead of the contributor
bootstrap flow.

If you are preparing a bundle for someone else to test, verify its installed
compiler directly:

```bash
vkf -e ':: "release ready"'
```

For first macOS/Linux bundle bring-up from source, use:

- [BUNDLE_BRINGUP.md](BUNDLE_BRINGUP.md)

## Before You Start

You need:

- a packaged Vektor Flow release for your platform
- VS Code only if you want the editor integration

You do **not** need:

- Python
- `pip`
- a virtual environment

## Windows

### Installer

1. Open the repository's latest GitHub release.
2. Download `vektor-flow-windows-x64-setup.exe`.
3. Run it and leave **Add VKF to my PATH** selected.
4. Open a new PowerShell window.
5. Verify:

```powershell
vkf -e ':: "hello, world"'
```

The installer is per-user and needs no administrator access. It installs the
compiler, integrated test command, stdlib, samples, and uninstaller. Uninstall removes only
the exact PATH entry created by the installer.

Python, a C++ compiler, and an assembler are not runtime dependencies.

This installer is the strict 0.1 native edition. It contains `math`, `stat`,
`random`, `time`, `io`, `collections`, `errors`, `system`, `process`, and
`regex`. The partial `physics`, `ui`, and `symbolic` modules are absent. There is
no compatibility fallback.

### Install

1. Download the Windows release archive.
2. Extract it somewhere stable, for example:

```text
C:\Tools\vektorflow
```

3. Open PowerShell in that folder.
4. Verify the compiler works:

```powershell
.\bin\vkf.exe -e ':: "hello, world"'
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

## macOS

### Install

1. Download `vektor-flow-macos-arm64.pkg` on Apple Silicon and run it, or
   download and extract the macOS archive and run `./install.sh`. Do not run
   the archive installer with `sudo`; it is per-user and refuses root access.
2. Open a new Terminal.
3. Verify the compiler works:

```bash
vkf -e ':: "hello, world"'
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

## Linux

On Debian/Ubuntu, install `vektor-flow-linux-x64.deb`. Other distributions can
extract `vektor-flow-linux-x64.tar.gz`, then run:

```bash
./install.sh
vkf -e ':: "hello, world"'
```

Do not run `install.sh` with `sudo`. The archive installer is deliberately
per-user and refuses root access; use the `.deb` when a system package is
preferred.

This installs under `~/.local/opt/vektor-flow` and creates commands under
`~/.local/bin`. It does not install or invoke Python, a C++ compiler, or an
assembler.

### Install

1. Download the Linux release archive.
2. Extract it.
3. Open a shell in the extracted folder.
4. Verify the compiler works:

```bash
./bin/vkf -e ':: "hello, world"'
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

## VS Code

If you want editor integration after the platform install succeeds, continue
with:

- [vscode/README.md](vscode/README.md)
- [TESTING.md](TESTING.md)

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

- [README.md](README.md)
- [RELEASES.md](RELEASES.md)
- [TESTING.md](TESTING.md)
