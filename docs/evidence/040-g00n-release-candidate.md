# 040-G00N Release Candidate Evidence

## Handoff

- packet: `040-G00N`
- branch: `codex/0.4/040-g00n-release-candidate`
- integration base: `354f849`
- verified implementation head: `a41f43a`
- public VKF syntax/API/ABI/schema/diagnostics: unchanged
- release metadata: normalized from stale `0.3.0` to `0.4.0`

## Observable result

The exact post-merge Windows x64 release candidate builds and packages with the
thin native host and retained event/gallery changes. The release compiler
reports `VKF 0.4.0`. Its portable archive compiles console and UI programs with
an empty `PATH`, runs after extraction outside the repository, and launches UI
only hidden/off-screen during verification.

The shipped runner and UI packager link no forbidden native UI-semantic
objects. Their imports are Windows system DLLs only. The loaded-module trace
contains release-owned executables, generated VKF executables, Windows/system
components, the installed WebView2 runtime, the installed graphics driver and
registered Windows network/media extensions; it contains no bundled
third-party native library.

The exact package smoke now compiles a script-free static HTML/CSS UI with a
`Button` and range `Input`, embeds `ButtonClicked` and `SliderValueChanged`
retained rules in the generated executable, proves deterministic packaging,
opens it hidden, relocates it without sidecars, and opens the relocated copy
hidden. The same compiled retained rules are executed by the focused native,
WASM and browser-adapter behavior matrix.

## RED / GREEN receipts

| Gate | RED | GREEN |
| --- | --- | --- |
| release version metadata | package/native compiler reported `0.3.0` | `ae292ff` |
| retained scene stager compile | repository JSON header root missing | `2b61ff7` |
| retained scene stager link | 19 unresolved `vf::JsonValue` symbols | `50eafb0` |
| retained scene stager JSON compile | `vf/json.hpp` include root missing | `c2b0ced` |
| exact retained package fixture | passive UI did not prove Button/Slider rules | `0137277` |
| exact fixture compilation | `Frame.add` fixture omitted mandatory `color:` | `0250314` |
| toolchain-free retained UI compile | embedded runtime omitted `vf-retained-event-adapter.js` | `a41f43a` |

## Exact artifacts

| Artifact | SHA-256 |
| --- | --- |
| `build/g00n/compiler/vkf-strict.exe` | `21def79c946df56d9f32e10bac3152d7bdeb2e5c1d1d33e97833719b38104831` |
| `build/g00n/ui/vf-overlay.exe` | `fc8c307fadb5d11fe65af8dea536145b8d83e3eb476d8311bcf1312e83d989de` |
| `build/g00n/ui/vkf-ui-package.exe` | `88eb386f8052c9f68b59fda23c8663fdff56b4dcb39c969c804d4abe51d00dbc` |
| `build/g00n/ui/vkf-runner.exe` | `08410318125fabbdda9e5d5f16468c276a63a381748c6425b5464c79077e6fa7` |
| `build/g00n/ui/vkf-native-scene-artifact-stager.exe` | `13b8015de0ed12a6e392df4c23b6e5c02f26c9f172f478525424584abe0891a3` |
| `build/g00n/release/vektor-flow-windows-x64.zip` | `185a6ea6d648f2a1b0b44d539c098eb8143f11f2f32eedbcb388fee71db9ade2` |

The embedded browser runtime contains 51 allowlisted assets and has version
`4195bb52474dbc82290e5354`.

## Verification

Native compiler and release targets:

```powershell
.\scripts\build-native-compiler.ps1 -OutputDirectory build/g00n/compiler -OnlyTargets vkf-strict
.\scripts\build-native-ui-package.ps1 -BuildDirectory build/g00n/ui -Target vkf-ui-package -Configuration Release -Parallel 1
.\scripts\build-native-ui-package.ps1 -BuildDirectory build/g00n/ui -Target vf-overlay -Configuration Release -Parallel 1
.\scripts\build-native-ui-package.ps1 -BuildDirectory build/g00n/ui -Target vf-release-host-adapter-test -Configuration Release -Parallel 1
.\scripts\build-native-ui-package.ps1 -BuildDirectory build/g00n/ui -Target vf-retained-scene-event-program-runtime-test -Configuration Release -Parallel 1
```

`vf-release-host-adapter-test.exe` passed the half-open hit-region,
outside-region `HTTRANSPARENT`, and opaque shared-event-arena cases.
`vf-retained-scene-event-program-runtime-test.exe` passed the native retained
Button/Slider patch lifecycle.

Exact package, archive, hidden lifecycle and relocation:

```powershell
.\scripts\package-native-release.ps1 -Version 0.4.0 -BinaryDirectory build/g00n/compiler -UiBinaryDirectory build/g00n/ui -OutputDirectory build/g00n/release
$env:VKF_WINDOWS_RELEASE_ARCHIVE=(Resolve-Path 'build/g00n/release/vektor-flow-windows-x64.zip').Path
node --test tests/js/windows-portable-archive-smoke.test.mjs
```

Result: 3 passed, 0 failed. The package command also independently extracted
and ran the completed archive before returning success.

Dependency, toolchain and link-map closure:

```powershell
node tools/verify-windows-release-closure.mjs --release-root=build/g00n/release/vektor-flow-windows-x64 --probe-toolchain-free --probe-root=build/g00n/closure-probe --link-map=build/g00n/ui/vkf-ui-package.map --link-map=build/g00n/ui/vkf-runner.map
```

Result:

- release root contains no bundled `.dll`, build source or toolchain file;
- compiler, stager, runner and UI packager import system DLLs only;
- runner and UI packager maps contain zero forbidden semantic objects;
- empty-`PATH` console and UI compilation passed;
- generated console imports only `kernel32.dll` and system `msvcrt.dll`;
- generated UI imports only the thin host's system DLL allowlist.

Hidden loaded-module trace:

```powershell
.\scripts\trace-native-release-modules.ps1 -ReleaseRoot build/g00n/release/vektor-flow-windows-x64 -WorkRoot build/g00n/module-trace -TraceMilliseconds 3000
```

Result: passed with `launches_hidden: true`. All observed modules were
classified as release-owned, generated VKF, Windows system, installed
WebView2, installed graphics driver, Windows media extension, or registered
Windows network-provider extension.

Retained static UI and event behavior:

```powershell
$env:VKF_NATIVE_COMPILER_BIN=(Resolve-Path 'build/g00n/compiler').Path
$env:VKF_NATIVE_SCENE_STAGER=(Resolve-Path 'build/g00n/ui/vkf-native-scene-artifact-stager.exe').Path
node --test tests/compiler/material-ui-gallery-acceptance.test.mjs tests/compiler/retained-scene-event-patch-parity.test.mjs tests/js/retained-event-adapter.test.mjs
```

Result: 4 passed, 0 failed. The material gallery remained script-free, the
four buttons and slider compiled to the expected retained program, native and
WASM artifacts matched, and dispatched patches changed mirror visibility and
glass alpha as expected.

Complete JavaScript suite with the exact archive enabled:

```powershell
$env:VKF_WINDOWS_RELEASE_ARCHIVE=(Resolve-Path 'build/g00n/release/vektor-flow-windows-x64.zip').Path
npm test
```

Final result: 416 passed, 0 failed, 0 skipped. An earlier concurrent run had
one wall-clock-only physics threshold failure (`160.8 ms`); the exact test
passed in isolation at `32.7 ms`, and the complete suite then passed on its
serial rerun.

## Owned paths

- `package.json`
- `package-lock.json`
- `compiler/native/vkf_driver_artifact_smoke.cpp`
- `native/VfOverlay/CMakeLists.txt`
- `native/VfOverlay/tools/generate_embedded_vf_ui_assets.cmake`
- `native/VfOverlay/vkf_launcher.cpp`
- `scripts/package-native-release.ps1`
- `tests/js/native-release-thin-host.test.mjs`
- `tests/js/release-version-metadata.test.mjs`
- `tests/js/windows-portable-archive-smoke.test.mjs`
- `docs/evidence/040-g00n-release-candidate.md`

## Remaining limits

- WebView2, the installed GPU driver and registered Windows extensions remain
  OS/runtime components; they are not bundled VKF dependencies.
- Live gallery interaction is exercised by the existing hidden G01N browser
  capture. G00N additionally proves that the exact packaged executable embeds
  the same static controls and retained rules, opens hidden, relocates, and
  that those compiled rules execute in native/WASM/browser adapter tests.
