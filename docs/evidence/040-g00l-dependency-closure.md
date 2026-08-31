# 040-G00L Windows dependency-closure evidence

- Packet: `040-G00L`, 0.4 release closure
- Base: `830b90ec2d7791157c1f53f8b8b1877c4af91f78`
- Branch: `codex/0.4/040-g00l-dependency-closure`
- Scope: private build/release verification only; no public VKF syntax, API,
  ABI, schema, diagnostic, or image change
- Owned paths: `native/VfOverlay/CMakeLists.txt`,
  `tools/verify-windows-release-closure.mjs`,
  `scripts/trace-native-release-modules.ps1`,
  `tests/js/native-release-dependency-closure.test.mjs`,
  `.github/workflows/native-release.yml`, and this receipt

## Commits

- `b2c4e0659650a53b727fd604f8f44dec2516e3b2` — static MSVC runtime
- `9dcd0da4016c4c86ef2912d267d97bc55b36fd64` — PE, inventory,
  toolchain-free, map, and dynamic-module gates
- `96034b6d027ed28cf9b2a5c92201de5fa5f06bf4` — valid hidden execution
  paths for all shipped helpers

## RED/GREEN receipt

1. PE import gate

   - RED: a clean pre-change build imported `MSVCP140.dll`,
     `VCRUNTIME140.dll`, and `VCRUNTIME140_1.dll` from `vkf-runner.exe`,
     `vkf-ui-package.exe`, and `vkf-native-scene-artifact-stager.exe`.
   - GREEN: CMP0091 plus `MultiThreaded`/`MultiThreadedDebug` links shipped
     targets with `/MT`/`/MTd`. A fresh 40/40 UI build emitted no `/MD`
     override warning. The four packaged EXEs now import only the allowlisted
     Windows DLLs listed below.
   - Mutation proof: `node --test --test-concurrency=1
     tests/js/native-release-dependency-closure.test.mjs` replaces
     `KERNEL32.dll` with equal-length `MSVCP140.dll` in a PE fixture and the
     verifier rejects it.

2. Release inventory gate

   - RED: a synthetic `bin/third-party.dll` passed before the verifier
     existed.
   - GREEN: exact package inventory rejects DLL, LIB, OBJ, PDB, NODE, and
     unexpected EXE sidecars. The fresh payload contains four EXEs, sixteen
     `.vkf` stdlib files, release metadata/docs, and samples; no native library
     is bundled.

3. Native UI semantic-object gate

   - RED: the first link-map fixture was not inspected.
   - GREEN: a synthetic map containing
     `compiled_ui_bootstrap_runtime.cpp.obj` is rejected while a thin adapter
     fixture is accepted.
   - Current release result remains RED for both real maps; see the blocker
     below. This is intentionally not waived.

4. End-user compile-time closure

   - RED: the first verifier could report PE inventory success without
     invoking the packaged compiler.
   - GREEN: with `PATH` empty and Python, Node, C/C++, assembler, linker, and
     SDK variables absent, the exact package builds a console executable and
     a static UI executable. Both generated files pass the PE import gate.

5. Dynamic loaded-module closure

   - RED: initial helper traces invoked `vkf-runner`, `vkf-ui-package`, and the
     stager without required arguments, so they exited before a live sample.
   - GREEN: the tracer now observes a valid empty-PATH UI compile pipeline
     (`vkf.exe` -> stager -> packager), a valid explicit stager call, the
     generated console runtime, and the generated UI/runner runtime. All
     launches use `-WindowStyle Hidden`; the WebView profile is isolated and
     deleted after the trace.
   - One diagnostic run observed signed Apple Bonjour `mdnsNSP.dll`. Registry
     and `netsh winsock` evidence identify it as an active machine-owned
     Winsock namespace provider, not a bundled/imported VKF dependency. The
     tracer classifies only exact provider paths registered in the Windows
     Winsock catalogs as `windows-network-provider-extension`; all other
     external paths remain fatal.

## Fresh package verification

Build/package commands:

```powershell
cmake -S native/VfOverlay -B build/g00l/ui-fresh -G "Visual Studio 17 2022" -A x64
cmake --build build/g00l/ui-fresh --config Release --parallel 1
.\scripts\package-native-release.ps1 -Version 0.4.0-g00l `
  -BinaryDirectory build/g00l/compiler `
  -UiBinaryDirectory build/g00l/ui-fresh `
  -OutputDirectory build/g00l/package-fresh
node tools/verify-windows-release-closure.mjs `
  --release-root=build/g00l/package-fresh/vektor-flow-windows-x64 `
  --probe-toolchain-free --probe-root=build/g00l/fresh-probe
.\scripts\trace-native-release-modules.ps1 `
  -ReleaseRoot build/g00l/package-fresh/vektor-flow-windows-x64 `
  -WorkRoot build/g00l/fresh-module-trace-final -TraceMilliseconds 3000
```

All commands exited 0. Packaging also passed its packaged stdlib, console,
static UI, relocation, and lifecycle smokes.

Packaged PE imports:

- `vkf.exe`: `KERNEL32.dll`
- `vkf-native-scene-artifact-stager.exe`: `KERNEL32.dll`
- `vkf-runner.exe` and `vkf-ui-package.exe`: `ADVAPI32.dll`,
  `COMCTL32.dll`, `CRYPT32.dll`, `d3d11.dll`, `dbghelp.dll`, `dcomp.dll`,
  `GDI32.dll`, `gdiplus.dll`, `KERNEL32.dll`, `ole32.dll`, `SHELL32.dll`,
  `SHLWAPI.dll`, `USER32.dll`, and `WS2_32.dll`

Toolchain-free outputs:

- console SHA-256:
  `1c009575c7651421666bc9d3c048a232b48de23bb20bcf5361b3032b44ed27d3`
- UI SHA-256:
  `1fa3e67d81fb870baa95f9415c06e7f40c59d0fe890ffea0abd7a4acd06fea1a`
- environment receipt: `PATH=""`; Python/Node/C++/assembler/linker/SDK all
  `false`

Final dynamic receipt: 4 valid traces, 121 unique loaded modules, 110 Windows
system, 7 installed WebView2 runtime, 2 release-owned, 2 generated VKF, and 0
forbidden external modules. WebView's private installed `VCRUNTIME140*.dll`
belongs to the allowed Evergreen WebView2 runtime under `Program Files`; no
shipped VKF binary imports or bundles it.

## Tests

- Focused gate: `node --test --test-concurrency=1
  tests/js/native-release-dependency-closure.test.mjs` — 5/5 passed.
- Affected serial matrix: `node --test --test-concurrency=1
  tests/js/native-release-dependency-closure.test.mjs
  tests/js/native-ui-package-build-helper.test.mjs
  tests/js/native-release-smoke-lifecycle.test.mjs` — 10/10 passed after the
  valid-path hardening.
- Full repository: `npm test` — 397/397 passed.

## Artifact hashes

- package ZIP:
  `42A20B53FF20EA130DA9E50D0612706D638ABC77006780D0CA6C4276571BE757`
- dependency-closure JSON:
  `9D883B4146E99CEB87CCF517D2FBA56D61B30358410592D65F4ED33448BBCF01`
- loaded-module JSON:
  `26D50E0F958AC46DF57CF5A711FBC3C1C62E1031249F7C0F6011880571C9CB2B`
- packaged `vkf.exe`:
  `326260BB66C69CAE2CD4C6A0A4DF1BA6A50F335D093AC28AD3EE89856D20B495`
- packaged runner:
  `E58C2FCCD17692DED8D98F440A49573D86A1557E4A1F71AC593AC8FB7AC644F6`
- packaged UI packager:
  `9D368E1621284C93B7AFC7AB5EB6CA7DEFE81B4D2D62D9DA5D182FDEA3304761`
- packaged stager:
  `70257F91F75C2E9747F0C773F29F5217AB024894E6151A3FD7BFCAC07220CD92`
- runner map:
  `9ECCB04C9D971EE1CBC7C01428BF7A34B9C18ECB79B315C96D61799FF8BCEBB2`
- UI packager map:
  `9AE517F372AB0617EF3C8EE2F7DCC1E5E7DF4FA21EE121FCF6070A8299CF551E`

## Native source classification and remaining blocker

Allowed thin adapter/build support:

- `vkf_launcher.cpp`: private bundle packaging/launch adapter
- `ui_runtime_contract.cpp`: frozen event/shared-buffer/packet validation
- `geom_ledger_contract.cpp`: shared-buffer contract/serialization
- `crash_diagnostics.cpp`: Windows crash adapter
- `json.cpp`: statically linked first-party parser
- embedded web assets: the actual web UI surface/resources

Mixed and therefore not yet release-thin:

- `main.cpp`: WebView/Win32 transport plus HTTP `/api/*`, runtime-packet
  preload, and compiled-bootstrap routes/semantics
- `overlay_geometry_ledger_runtime.cpp`: buffer transport plus hard-coded
  four-point geometry-state synthesis

Forbidden release semantic objects found in both real maps:

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

Both commands below exit 1 with the exact list above:

```powershell
node tools/verify-windows-release-closure.mjs --link-map=build/g00l/ui-fresh/vkf-runner.map
node tools/verify-windows-release-closure.mjs --link-map=build/g00l/ui-fresh/vkf-ui-package.map
```

The release source split is not safe inside G00L because `main.cpp` directly
owns launcher HTTP/runtime behavior currently assigned to G02. The next
migration packet must extract WebView window/resource loading, OS input/event
transport, shared-buffer mapping, GPU surface upload, and crash diagnostics
into a thin release source set; keep HTTP `/api/*`, legacy packet snapshots,
compiled bootstrap/demo/plugin loading, expression evaluation, and fallback
geometry synthesis in compatibility/test targets. Split pure geometry mapping
from fallback synthesis, link only the thin set into `vkf-runner` and
`vkf-ui-package`, then require both real maps to contain zero forbidden
objects.

Therefore dependency packaging, static runtime, import closure, end-user
toolchain closure, and dynamic-module closure are GREEN. The shipped-native-UI
semantics deletion/link-map acceptance gate remains RED and is the sole packet
blocker.
