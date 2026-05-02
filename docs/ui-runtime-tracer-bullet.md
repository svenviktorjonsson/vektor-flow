# UI Runtime Tracer Bullet

Goal: make the tomorrow demo prove the real runtime path, not the old inspection
path.

## Demo Path

The demo path is:

1. VKF source compiles before the interaction starts.
2. The VKF binary or compiled core runs in-process.
3. The compiled core writes events, transforms, geometry, widgets, and commands
   into shared arenas.
4. The renderer adapter reads dirty arena ranges.
5. The renderer updates GPU buffers.
6. The frame presents without Python polling or JSON reloads.

Python and JSON are allowed before and after the hot path: compilation bring-up,
fixtures, inspection snapshots, screenshots, docs, and regression tests. They are
excluded from pointer-sample handling, transform updates, geometry mutation, and
per-frame rendering.

## Smallest Slice

Build the smallest deep module slice that earns the seam:

- `CompiledCore` writes one draggable rectangle into `RuntimeArenas`.
- `RuntimeArenas` expose a stable interface: arena pointers, record formats,
  generation counters, and dirty ranges.
- `RendererAdapter` reads dirty ranges and updates one GPU-backed vertex buffer.
- `InspectionAdapter` can snapshot the same arena state for tests, but never
  drives the frame.

This gives depth because the caller only needs the arena interface while memory
layout, event dispatch, transform math, and upload strategy stay local to their
modules. It gives leverage because the same seam supports browser iteration now
and native overlay adapters later.

## Acceptance

- Dragging the rectangle mutates shared arena state from compiled VKF code.
- The renderer presents from GPU buffers derived from arena dirty ranges.
- No per-frame `vf-display.json` write/read is needed.
- No Python HTTP poll is needed for pointer movement.
- A test or inspection snapshot can verify arena contents outside the hot path.

## Current Browser Tracer

The current executable browser tracer is:

- `web/vf-ui/vf-shared-rect-demo.html`
- `web/vf-ui/vf-shared-rect-demo.js`
- `tests/test_vf_shared_runtime_browser.py`

This tracer uses a JS `CompiledCore` stand-in behind
`VfWasmDemoContract.createWasmDemoContract(...)`. That is deliberate: the seam is
the stable part being tested. Replacing the stand-in with a real VKF/WASM export
should not require renderer changes.

## Truthful Native/Core Path

The current packaged native/core path is:

1. `dist/releases/windows-overlay/vkf.exe` is a packaged Python CLI entrypoint.
2. `vkf.exe cpp-native-core <file>` emits standalone C++ for the supported
   `examples/native_core/` subset.
3. `vkf.exe package-native-core <file> -o <dir>` produces C++, an executable,
   launchers, smoke tests, and `vektorflow-package.json`.
4. The package metadata says `python_required_to_build: true` and
   `python_required_to_run: false`.

That is a useful `CompiledCore` module, but it does not yet satisfy the UI
runtime interface. Its generated implementation has a process `main()` and
prints program output; it does not export `init(api)` / `update(input, api)` or
write the `RuntimeArenas` layout expected by `VfWasmDemoContract`.

`examples/ui_draggable_rect_minimal.vkf` is also not in the native-core subset
today: `vkf.exe cpp-native-core examples/ui_draggable_rect_minimal.vkf` fails
with `unknown name in typed IR analysis: ui`.

The release bundle also trails the source tracer. `web/vf-ui/` contains
`vf-shared-runtime.js`, `vf-gpu-runtime.js`, `vf-wasm-demo-contract.js`, and the
shared rectangle demo; `dist/releases/windows-overlay/vf-ui/` currently contains
the older JSON/browser display assets instead.

## Exact Gap List

- `NativeCorePackage` seam exists for standalone executables, not UI exports.
- `VfWasmDemoContract` seam exists for JS/WASM-style demos, not native-core C++
  packages.
- `RuntimeArenas` currently expose only a JS `SharedArrayBuffer` transform arena;
  there is no generated native header or ABI for compiled C++ to write.
- The `ui` language surface is outside `native_core`, so the draggable UI example
  cannot be the first native-core input.
- The Windows overlay release bundle includes UI modes and overlay assets, but
  not the shared-runtime tracer files needed to demonstrate this seam from the
  bundle.
- The renderer adapter is deep enough for WebGPU/WebGL-style buffer writes, but
  native-core cannot reach that interface yet.

## Next Vertical Slice

Build the next slice around a tiny adapter instead of broad compiler work:

1. Define one C ABI/header for the transform arena: header fields, mat4 slots,
   dirty version, dirty min, and dirty max.
2. Add a native-core output mode that emits `vkf_init(VfDemoApi*)` and
   `vkf_update(VfInputSnapshot, VfDemoApi*)` for a one-rectangle demo, not
   `main()`.
3. Keep the first VKF source free of `ui`; use plain numbers/functions that map
   pointer input to `setTranslate2D(slot, x, y)`.
4. Add one JS/WASM adapter that makes those exports satisfy
   `VfWasmDemoContract.createWasmDemoContract(...)`.
5. Package the shared-runtime tracer files into `windows-overlay` so the release
   bundle can run the same seam as source.

This creates a real seam with two adapters: the current JS stand-in and the new
native/WASM compiled-core adapter. The leverage is that renderer tests remain at
the arena interface. The locality is that native-core export shape, arena ABI,
and bundle packaging each change in one module instead of leaking into the
renderer.

## Not In This Slice

- General widget library.
- Multi-window scheduling.
- Native overlay GPU backend.
- Full compiler cleanup.
- JSON compatibility removal.
