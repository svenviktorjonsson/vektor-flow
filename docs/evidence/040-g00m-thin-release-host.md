# 0.4 G00M thin release host evidence

## Receipt

- Branch: `codex/0.4/040-g00m-thin-release-host`
- Base: `2ab020112666112ff4ca05919854c3bca2ae9d7d`
- Release source split: `e6c2652`
- Required inline-CRLF integration fix: `08d7077`
- Thin input/event arena bridge: `ecc3f56`
- Browser event-arena mapping: `14e9ce8`

No public VKF syntax, API, ABI, schema, or diagnostic changed.

## RED to GREEN

The first focused RED was:

```powershell
node --test tests/js/native-release-thin-host.test.mjs
```

Result: 1 passed and 2 failed. The shipped source set did not provide native
hit testing, an event arena, or a shared-buffer bridge. A second RED added the
browser-side opaque arena mapping: 3 passed and 1 failed.

The minimal GREEN separates the legacy compatibility host from the three
shipped targets. The release host now:

- maps static resources through WebView2 virtual-host mapping;
- retains half-open hit rectangles received through the internal
  `vf_host_hit_regions_v1` adapter and returns `HTTRANSPARENT` elsewhere;
- restricts WebView child input regions to the same rectangles;
- transfers complete `vf_event` messages as opaque bytes into a bounded 64 KiB
  FIFO arena;
- publishes that arena through `ICoreWebView2SharedBuffer` and maps it in the
  browser runtime without recognizing component event kinds;
- keeps close/minimize/restore and crash diagnostics as OS adapter behavior.

`release_host_adapter.cpp` contains none of `ButtonClicked`,
`SliderValueChanged`, `ButtonEvent`, `SliderEvent`, or `FrameEvent`. Component
and queue semantics remain in the compiled native/WASM runtime path.

Focused GREEN:

```powershell
node --test tests/js/native-release-thin-host.test.mjs
build/v/vf-release-host-adapter-test.exe
```

Results: 4/4 JavaScript checks and the native adapter executable passed. The
native test proves half-open inside/outside behavior, rejection without partial
mutation, and FIFO opaque-event delivery.

## Button, slider, and static HTML matrix

With the helper-built current compiler, WASM artifact helper, scene stager, and
native owner-event executable selected through their focused environment
variables:

```powershell
node --test --test-concurrency=1 `
  tests/compiler/frame-load-static-html-parity.test.mjs `
  tests/compiler/slider-event-parity.test.mjs `
  tests/compiler/owner-event-poll-lowering.test.mjs `
  tests/compiler/owner-event-loop-lowering.test.mjs `
  tests/compiler/owner-event-queues-parity.test.mjs `
  tests/js/vf-frame-drag-handle.test.cjs `
  tests/js/native-release-thin-host.test.mjs
```

Result: **21 passed, 0 failed**. This includes real hidden-browser static HTML
interaction, `ButtonClicked` and `SliderValueChanged`, native/WASM queue parity,
and an outside point excluded from the generated hit-region stream. The exact
release package embeds the same tested `vf-frame.js`, `vf-runtime-shell.js`,
and static HTML event adapter under asset version
`486c660783da79e79913c87c`; packaging then proves that exact executable through
hidden open, relocation, and lifecycle smokes. Native C++ transports event
bytes and hit regions without branching on Button or Slider semantics.

## Exact release link maps and imports

```powershell
.\scripts\build-native-ui-package.ps1 `
  -BuildDirectory build/v -Target vkf-ui-package `
  -Configuration Release -Parallel 1
node tools/verify-windows-release-closure.mjs `
  --link-map=build/v/vkf-runner.map `
  --link-map=build/v/vkf-ui-package.map `
  --binary=build/v/vkf-runner.exe `
  --binary=build/v/vkf-ui-package.exe
```

Both maps report `forbiddenSemanticObjects: []`. Neither PE imports an MSVC
redistributable. Both import only `ADVAPI32.dll`, `dbghelp.dll`, `GDI32.dll`,
`KERNEL32.dll`, `ole32.dll`, `SHELL32.dll`, and `USER32.dll`.

The following eight legacy semantic objects are absent from both shipped maps:

```text
compiled_ui_bootstrap_host
compiled_ui_bootstrap_packet_bridge
compiled_ui_bootstrap_runtime
compiled_ui_runtime_demo
compiled_ui_runtime_loader
compiled_ui_runtime_registry
overlay_geometry_ledger_runtime
overlay_packet_runtime
```

Compatibility and explicit test-only targets retain their existing legacy
sources; they are not copied into the release bundle.

## Exact hidden package and dependency closure

```powershell
.\scripts\package-native-release.ps1 `
  -Version 0.4.0-g00m `
  -BinaryDirectory build/g00m/compiler-post-crlf `
  -UiBinaryDirectory build/v `
  -OutputDirectory build/g00m/package-final
node tools/verify-windows-release-closure.mjs `
  --release-root=build/g00m/package-final/vektor-flow-windows-x64 `
  --probe-toolchain-free --probe-root=build/g00m/final-probe
.\scripts\trace-native-release-modules.ps1 `
  -ReleaseRoot build/g00m/package-final/vektor-flow-windows-x64 `
  -WorkRoot build/g00m/final-module-trace-retry -TraceMilliseconds 3000
```

All final commands exited 0. Packaging passed packaged stdlib/compiler smoke,
deterministic static UI compilation, hidden UI open, relocation, and hidden
lifecycle cleanup. The toolchain-free probe ran with an empty `PATH` and no
Python, Node, C++ compiler, assembler, linker, or SDK. The loaded-module trace
launched every process hidden and classified only release-owned files, Windows
system/driver/media/provider components, and the installed WebView2 runtime.
No bundled third-party DLL was present.

The first module-trace attempt failed to observe its UI output immediately
after compile while other long-running verification was active. The same exact
compiler command succeeded in isolation; a fresh full trace then passed. No
source change was made for that transient verification failure.

## Full suite

```powershell
npm test -- --test-concurrency=1
```

Result: **407 passed, 0 failed, 1 skipped**. The skip is the pre-existing
Windows portable-archive integration case; the exact PowerShell package and
archive gate above ran and passed.

## SHA-256

| Artifact | SHA-256 |
| --- | --- |
| `build/v/vkf-runner.exe` | `7807EB9DAB39DC76D243E92AC2EC3D7A8561EECF1FCE120B437DE917949ADAB8` |
| `build/v/vkf-ui-package.exe` | `D3A9CBFA71137A21ABD5581EA546B7E813821D719AAF48CCDA094CB374F02D9A` |
| `build/v/vkf-runner.map` | `449637B20E83E263B50CB6A92A3792AB44B85EB41FED066B3604910412053342` |
| `build/v/vkf-ui-package.map` | `36EA87EE23536E6CD72E062CA8AADF6C36142FDB1D1A22CF029EB34DB461DE99` |
| packaged `vkf.exe` | `3BD70D5E9988C9FA03FBCAF5147994DE45D2AECD798290AA63BDE9C6E0623976` |
| packaged scene stager | `378873982EFB35E79D1993D97E079DBDD2A42C59119E432902B0C6F30461B7DB` |
| packaged runner | `7807EB9DAB39DC76D243E92AC2EC3D7A8561EECF1FCE120B437DE917949ADAB8` |
| packaged UI packager | `D3A9CBFA71137A21ABD5581EA546B7E813821D719AAF48CCDA094CB374F02D9A` |
| release ZIP | `E8F939DF955026AE5B39EDFBB556960ABDCDDFD7863F32F6FE7959BB572CB536` |

Toolchain-free generated outputs:

- console: `FC5CB07D6FCE9CFE1AF6115047017FC918DEF01996B217B1EF7DC634A5DD1167`
- UI: `28819F7DCAF48CE9E796727D1D8D1C1ACF2A68C4CD7350B2024D366D2AEE708F`

## Owned paths

- `native/VfOverlay/CMakeLists.txt`
- `native/VfOverlay/vf/release_overlay_host.cpp`
- `native/VfOverlay/vf/release_host_adapter.cpp`
- `native/VfOverlay/vf/release_host_adapter.hpp`
- `native/VfOverlay/vf/release_host_adapter_test.cpp`
- `tests/js/native-release-thin-host.test.mjs`
- `web/vf-ui/vf-frame.js`
- `web/vf-ui/vf-runtime-shell.js`
- `docs/evidence/040-g00m-thin-release-host.md`

