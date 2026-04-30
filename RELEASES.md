# Vektor Flow Release Layout

This document defines the intended public release layout for installable Vektor Flow beta packages.

The goal is simple:

- end users should not need Python installed
- the same `vkf` entrypoint should exist on all supported platforms
- UI mode differences should be explicit and honest

Here, `vkf` means the primary end-user launcher/binary name exposed by the
release package, not merely an internal compiler alias. For a public release,
that is the command users should expect to run first.

## Release Channels

### Windows: `windows-overlay`

Supported UI modes:

- `overlay`
- `browser`
- `headless`

This is the current full beta target.

### macOS: `macos-browser`

Supported UI modes:

- `browser`
- `headless`

This is the current portable beta target.

Runtime note:

- requires a locally available browser
- does not require Python for end-user execution

### Linux: `linux-browser`

Supported UI modes:

- `browser`
- `headless`

This is the current portable beta target.

Runtime note:

- requires a locally available browser
- does not require Python for end-user execution

## What "No Python Dependency For End Users" Means

For packaged releases:

- users should not need Python installed to run `vkf`
- users should not need `pip`, `venv`, or editable installs
- packaged native executables and launchers should run directly from the extracted release folder
- the package should include the runtime assets needed for the supported release mode

It does **not** mean:

- Python is already removed from every internal compiler/build step
- every stdlib seam is already native-hosted
- every platform has the same UI host implementation

So the promise is:

- no Python required for **end-user execution**
- Python may still be involved in **developer-side build/packaging workflows** until those are replaced

## Common Package Shape

Every public release should aim to expose the same high-level shape, even if the internal build path differs.

Core package contents:

- `vkf` or `vkf.exe`
- packaged runtime/compiler assets required by that release channel
- packaged UI web assets
- packaged native program launchers where applicable
- packaged smoke-test launcher(s)
- package manifest / contract metadata
- short release README

Expected named artifacts where applicable:

- `vektorflow-package.json`
- `vf-display.json` and related runtime UI state files when a UI program is launched
- `README.txt`
- `run.bat` / `run.sh`
- `run.ps1` where Windows launcher flows expose it
- `smoke-test.bat` / `smoke-test.sh`
- `smoke-test.ps1` where Windows launcher flows expose it

For UI-enabled releases, the bundled web UI assets should include the `vf-ui`
assets required by the selected host mode. Geom assets and host-facing display
JSON files are part of the package/runtime contract, not ad-hoc external
dependencies.

For generated native program packages, the current contract already includes artifacts like:

- built native executable
- emitted C++ source
- `vektorflow-package.json`
- `README.txt`
- `run.bat` / `run.sh`
- `smoke-test.bat` / `smoke-test.sh`

## Windows Overlay Release

Expected bundled pieces:

- `vkf.exe`
- UI web assets
- `vf-overlay.exe` as a bundled support artifact for overlay mode
- Windows launchers
- smoke-test launchers
- package/runtime manifest

Expected user story:

1. unzip package
2. run `vkf.exe`
3. UI examples can use `overlay`, `browser`, or `headless`

## macOS Browser Release

Expected bundled pieces:

- `vkf`
- UI web assets
- shell launchers
- smoke-test launchers
- package/runtime manifest
- browser available on the local machine

Expected user story:

1. extract archive
2. run `./vkf`
3. UI examples use `browser` or `headless`

Future work:

- native transparent overlay host for macOS

## Linux Browser Release

Expected bundled pieces:

- `vkf`
- UI web assets
- shell launchers
- smoke-test launchers
- package/runtime manifest
- browser available on the local machine

Expected user story:

1. extract archive
2. run `./vkf`
3. UI examples use `browser` or `headless`

Future work:

- native transparent overlay host for Linux

## Runtime/UI Contract Strategy

Keep one shared display/event contract across all platforms.

That lets us vary only the UI host shell:

- Windows native overlay host
- macOS browser host now, overlay host later
- Linux browser host now, overlay host later

This is the key to shipping all three OSes now without pretending they have the same host implementation.

## Recommended Public Messaging

Use wording close to this:

- Vektor Flow beta is available on Windows, macOS, and Linux.
- Windows includes the native transparent overlay host.
- macOS and Linux currently use the browser UI host.
- End users do not need Python installed to run packaged releases.

## Suggested Next Packaging Targets

1. `windows-overlay`
2. `macos-browser`
3. `linux-browser`

These should become the named release outputs referenced by the top-level README and VS Code setup docs.

## Current Builder Entry Points

For maintainers producing tester bundles from source:

- Windows:
  - `.\scripts\build-release-bundle.ps1`
- macOS / Linux:
  - `./scripts/build-release-bundle.sh`

Both wrappers delegate to:

- `scripts/build_release_bundle.py`

That builder currently does the host-native assembly work:

- builds a `vkf` tester executable with PyInstaller
- copies sample `.vkf` files
- copies `vf-ui` web assets unless explicitly skipped
- packages the VS Code extension into a `.vsix` unless explicitly skipped
- writes a release manifest and bundle README
